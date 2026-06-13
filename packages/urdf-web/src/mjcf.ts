/**
 * URDF + scene → MJCF compiler. Turns the editor's world (a URDF robot, free
 * boxes to grasp, the ground plane) into one MuJoCo model the WASM runtime can
 * load, so playback can run real contact dynamics instead of kinematic replay.
 *
 * Scope: fixed-base robots, collision geometry only (visual meshes are for the
 * three.js side; MuJoCo can't read .dae anyway). Mimic joints become equality
 * constraints. Self-collision is masked off via contype/conaffinity — robot
 * geoms collide with the scene (cubes, ground) but not with each other, which
 * sidesteps the adjacent-link instabilities raw URDFs are full of.
 *
 * Frames: URDF and MuJoCo are both Z-up — positions pass through unchanged.
 * (The three.js editor is Y-up; convert at the boundary, not here.)
 */

export interface MJCFBox {
  name: string;
  /** Half extents, meters (MuJoCo box convention). */
  halfExtents: [number, number, number];
  /** Z-up world position. */
  pos: [number, number, number];
  mass?: number;
  /** Free bodies get a freejoint (7 qpos appended after robot joints). */
  free?: boolean;
}

export interface URDFToMJCFOptions {
  /** Scene boxes (cubes to grasp, a table slab, …). */
  objects?: MJCFBox[];
  /** Emit an infinite ground plane at z=0. Default true. */
  ground?: boolean;
  timestep?: number;
  /** Asset directory prefix used in mesh file= attributes. Default "assets". */
  meshDir?: string;
  /** Position-actuator gains. */
  kpRevolute?: number;
  kvRevolute?: number;
  kpPrismatic?: number;
  kvPrismatic?: number;
}

export interface MJCFMeshRef {
  /** Sanitized asset name used in <mesh name=…> / <geom mesh=…>. */
  asset: string;
  /** Raw URDF filename attribute (package:// or relative) — caller resolves + supplies bytes. */
  path: string;
  /** File name to write under meshDir (asset + original extension). */
  file: string;
  scale?: [number, number, number];
}

export interface MJCFResult {
  xml: string;
  meshes: MJCFMeshRef[];
  /** Movable joints in MJCF tree order = qpos order (all 1-dof). */
  jointNames: string[];
  /** Actuated joints in <actuator> order = ctrl order (mimic joints excluded). */
  actuators: string[];
  /** Free bodies in qpos-append order (7 dof each, after jointNames). */
  freeBodies: string[];
  warnings: string[];
}

interface UrdfJoint {
  name: string;
  type: string;
  parent: string;
  child: string;
  originXyz: [number, number, number];
  originRpy: [number, number, number];
  axis: [number, number, number];
  lower?: number;
  upper?: number;
  effort?: number;
  damping?: number;
  friction?: number;
  mimic?: { joint: string; multiplier: number; offset: number };
}

const num3 = (s: string | null | undefined, fallback: [number, number, number]): [number, number, number] => {
  if (!s) return fallback;
  const v = s.trim().split(/\s+/).map(Number);
  return [v[0] ?? fallback[0], v[1] ?? fallback[1], v[2] ?? fallback[2]];
};

const fmt = (n: number): string => {
  const r = Math.abs(n) < 1e-12 ? 0 : n;
  return String(Number(r.toPrecision(10)));
};
const vec = (v: number[]): string => v.map(fmt).join(" ");

/** Fixed-axis (extrinsic) XYZ rpy → quaternion [w,x,y,z] (MJCF order). R = Rz·Ry·Rx. */
export function rpyToQuat(r: number, p: number, y: number): [number, number, number, number] {
  const cr = Math.cos(r / 2);
  const sr = Math.sin(r / 2);
  const cp = Math.cos(p / 2);
  const sp = Math.sin(p / 2);
  const cy = Math.cos(y / 2);
  const sy = Math.sin(y / 2);
  return [
    cy * cp * cr + sy * sp * sr,
    cy * cp * sr - sy * sp * cr,
    cy * sp * cr + sy * cp * sr,
    sy * cp * cr - cy * sp * sr,
  ];
}

const isIdentityRpy = (rpy: [number, number, number]): boolean => rpy.every((v) => Math.abs(v) < 1e-9);

/** Rotate a symmetric inertia tensor into the parent frame: I' = R·I·Rᵀ. */
function rotateInertia(
  q: [number, number, number, number],
  ixx: number,
  iyy: number,
  izz: number,
  ixy: number,
  ixz: number,
  iyz: number,
): [number, number, number, number, number, number] {
  const [w, x, y, z] = q;
  // rotation matrix rows from quaternion
  const R = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
  const I = [
    [ixx, ixy, ixz],
    [ixy, iyy, iyz],
    [ixz, iyz, izz],
  ];
  const RI = R.map((row) => I.map((_, j) => row[0]! * I[0]![j]! + row[1]! * I[1]![j]! + row[2]! * I[2]![j]!));
  const out = R.map((_, i) =>
    R.map((rrow) => RI[i]![0]! * rrow[0]! + RI[i]![1]! * rrow[1]! + RI[i]![2]! * rrow[2]!),
  );
  return [out[0]![0]!, out[1]![1]!, out[2]![2]!, out[0]![1]!, out[0]![2]!, out[1]![2]!];
}

const sanitize = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, "_");

/** Compile a URDF robot plus scene boxes into a single MJCF document. */
export function urdfToMJCF(urdfXml: string, opts: URDFToMJCFOptions = {}): MJCFResult {
  const doc = new DOMParser().parseFromString(urdfXml, "text/xml");
  const robotEl = doc.querySelector("robot");
  if (!robotEl) throw new Error("not a URDF: missing <robot>");
  const robotName = sanitize(robotEl.getAttribute("name") ?? "robot");

  const warnings: string[] = [];
  const meshes = new Map<string, MJCFMeshRef>();
  const links = new Map<string, Element>();
  for (const l of Array.from(robotEl.querySelectorAll(":scope > link"))) {
    links.set(l.getAttribute("name") ?? "", l);
  }

  const joints: UrdfJoint[] = Array.from(robotEl.querySelectorAll(":scope > joint")).map((j) => {
    const origin = j.querySelector(":scope > origin");
    const axisEl = j.querySelector(":scope > axis");
    const limit = j.querySelector(":scope > limit");
    const dyn = j.querySelector(":scope > dynamics");
    const mimicEl = j.querySelector(":scope > mimic");
    const att = (e: Element | null, a: string): number | undefined => {
      const v = e?.getAttribute(a);
      return v == null ? undefined : Number(v);
    };
    return {
      name: j.getAttribute("name") ?? "",
      type: j.getAttribute("type") ?? "fixed",
      parent: j.querySelector(":scope > parent")?.getAttribute("link") ?? "",
      child: j.querySelector(":scope > child")?.getAttribute("link") ?? "",
      originXyz: num3(origin?.getAttribute("xyz"), [0, 0, 0]),
      originRpy: num3(origin?.getAttribute("rpy"), [0, 0, 0]),
      axis: num3(axisEl?.getAttribute("xyz"), [1, 0, 0]),
      lower: att(limit, "lower"),
      upper: att(limit, "upper"),
      effort: att(limit, "effort"),
      damping: att(dyn, "damping"),
      friction: att(dyn, "friction"),
      mimic: mimicEl
        ? {
            joint: mimicEl.getAttribute("joint") ?? "",
            multiplier: Number(mimicEl.getAttribute("multiplier") ?? 1),
            offset: Number(mimicEl.getAttribute("offset") ?? 0),
          }
        : undefined,
    };
  });

  // tree: root = the link that is nobody's child
  const childLinks = new Set(joints.map((j) => j.child));
  const roots = [...links.keys()].filter((l) => !childLinks.has(l));
  if (roots.length !== 1) {
    throw new Error(`URDF must have exactly one root link, found: ${roots.join(", ") || "none"}`);
  }
  const byParent = new Map<string, UrdfJoint[]>();
  for (const j of joints) {
    if (!byParent.has(j.parent)) byParent.set(j.parent, []);
    byParent.get(j.parent)!.push(j);
  }

  const jointNames: string[] = [];
  const actuators: UrdfJoint[] = [];
  const mimics: UrdfJoint[] = [];
  const meshDir = opts.meshDir ?? "assets";

  const originAttrs = (xyz: [number, number, number], rpy: [number, number, number]): string => {
    let s = ` pos="${vec(xyz)}"`;
    if (!isIdentityRpy(rpy)) s += ` quat="${vec(rpyToQuat(...rpy))}"`;
    return s;
  };

  /** Collision geoms of one link (robot collision mask: contype 1, collides with scene's 2). */
  const geomsOf = (linkName: string, indent: string): string => {
    const link = links.get(linkName);
    if (!link) return "";
    let out = "";
    for (const col of Array.from(link.querySelectorAll(":scope > collision"))) {
      const origin = col.querySelector(":scope > origin");
      const xyz = num3(origin?.getAttribute("xyz"), [0, 0, 0]);
      const rpy = num3(origin?.getAttribute("rpy"), [0, 0, 0]);
      const at = originAttrs(xyz, rpy);
      const box = col.querySelector("geometry > box");
      const cyl = col.querySelector("geometry > cylinder");
      const sph = col.querySelector("geometry > sphere");
      const mesh = col.querySelector("geometry > mesh");
      if (box) {
        const size = num3(box.getAttribute("size"), [0.01, 0.01, 0.01]);
        out += `${indent}<geom type="box" size="${vec(size.map((v) => v / 2))}"${at}/>\n`;
      } else if (cyl) {
        const r = Number(cyl.getAttribute("radius") ?? 0.01);
        const l = Number(cyl.getAttribute("length") ?? 0.01);
        out += `${indent}<geom type="cylinder" size="${fmt(r)} ${fmt(l / 2)}"${at}/>\n`;
      } else if (sph) {
        out += `${indent}<geom type="sphere" size="${fmt(Number(sph.getAttribute("radius") ?? 0.01))}"${at}/>\n`;
      } else if (mesh) {
        const file = mesh.getAttribute("filename") ?? "";
        if (!/\.(stl|obj|msh)$/i.test(file)) {
          warnings.push(`skipped unsupported collision mesh format: ${file}`);
          continue;
        }
        const scale = num3(mesh.getAttribute("scale"), [1, 1, 1]);
        const ext = file.split(".").pop()!.toLowerCase();
        const asset = sanitize(file.split("/").pop()!.replace(/\.[^.]+$/, "")) + "_" + meshes.size;
        let ref = [...meshes.values()].find((m) => m.path === file && String(m.scale) === String(scale));
        if (!ref) {
          ref = {
            asset,
            path: file,
            file: `${asset}.${ext}`,
            scale: scale.some((v) => v !== 1) ? scale : undefined,
          };
          meshes.set(asset, ref);
        }
        out += `${indent}<geom type="mesh" mesh="${ref.asset}"${at}/>\n`;
      }
    }
    return out;
  };

  const inertialOf = (linkName: string, indent: string): string => {
    const inertial = links.get(linkName)?.querySelector(":scope > inertial");
    if (!inertial) return "";
    const mass = Number(inertial.querySelector(":scope > mass")?.getAttribute("value") ?? 0);
    if (mass <= 0) return "";
    const origin = inertial.querySelector(":scope > origin");
    const xyz = num3(origin?.getAttribute("xyz"), [0, 0, 0]);
    const rpy = num3(origin?.getAttribute("rpy"), [0, 0, 0]);
    const ie = inertial.querySelector(":scope > inertia");
    const g = (a: string): number => Number(ie?.getAttribute(a) ?? 0);
    let full: [number, number, number, number, number, number] = [
      g("ixx"), g("iyy"), g("izz"), g("ixy"), g("ixz"), g("iyz"),
    ];
    if (full[0] <= 0 && full[1] <= 0 && full[2] <= 0) return ""; // bogus inertia — let the compiler infer
    // MJCF fullinertia cannot carry a quat — rotate the tensor into the link frame instead
    if (!isIdentityRpy(rpy)) full = rotateInertia(rpyToQuat(...rpy), ...full);
    return `${indent}<inertial pos="${vec(xyz)}" mass="${fmt(mass)}" fullinertia="${vec(full)}"/>\n`;
  };

  const emitBody = (linkName: string, viaJoint: UrdfJoint | null, depth: number): string => {
    const indent = "  ".repeat(depth);
    const inner = "  ".repeat(depth + 1);
    let s = `${indent}<body name="${sanitize(linkName)}"${viaJoint ? originAttrs(viaJoint.originXyz, viaJoint.originRpy) : ""}>\n`;
    if (viaJoint && viaJoint.type !== "fixed") {
      const t = viaJoint.type;
      if (t === "revolute" || t === "continuous" || t === "prismatic") {
        const mjType = t === "prismatic" ? "slide" : "hinge";
        let j = `${inner}<joint name="${sanitize(viaJoint.name)}" type="${mjType}" axis="${vec(viaJoint.axis)}"`;
        if (t !== "continuous" && viaJoint.lower != null && viaJoint.upper != null) {
          j += ` range="${fmt(viaJoint.lower)} ${fmt(viaJoint.upper)}"`;
        }
        if (viaJoint.damping) j += ` damping="${fmt(viaJoint.damping)}"`;
        if (viaJoint.friction) j += ` frictionloss="${fmt(viaJoint.friction)}"`;
        s += j + "/>\n";
        jointNames.push(viaJoint.name);
        if (viaJoint.mimic) mimics.push(viaJoint);
        else actuators.push(viaJoint);
      } else {
        warnings.push(`joint ${viaJoint.name}: unsupported type "${t}" treated as fixed`);
      }
    }
    s += inertialOf(linkName, inner);
    s += geomsOf(linkName, inner);
    for (const child of byParent.get(linkName) ?? []) s += emitBody(child.child, child, depth + 1);
    return s + `${indent}</body>\n`;
  };

  const robotBody = emitBody(roots[0]!, null, 2);

  // scene boxes — contype 2 collides with both robot (1↔2) and other scene geoms
  const freeBodies: string[] = [];
  let sceneXml = "";
  for (const o of opts.objects ?? []) {
    const name = sanitize(o.name);
    const geom = `<geom type="box" size="${vec(o.halfExtents)}"${o.mass ? ` mass="${fmt(o.mass)}"` : ""} contype="2" conaffinity="3" friction="2 0.02 0.001"/>`;
    if (o.free) {
      freeBodies.push(o.name);
      sceneXml += `    <body name="${name}" pos="${vec(o.pos)}">\n      <freejoint name="${name}_free"/>\n      ${geom}\n    </body>\n`;
    } else {
      sceneXml += `    <geom name="${name}" type="box" size="${vec(o.halfExtents)}" pos="${vec(o.pos)}" contype="2" conaffinity="3"/>\n`;
    }
  }

  const assetXml = [...meshes.values()]
    .map((m) => `    <mesh name="${m.asset}" file="${m.file}"${m.scale ? ` scale="${vec(m.scale)}"` : ""}/>`)
    .join("\n");

  // stiff tracking matters more than realism here: position actuators have no
  // gravity compensation, so PD sag directly offsets the EE — at kp 900 that is
  // still 2-3 cm, enough to push a 5 cm cube out of the gripper gap during the
  // approach. kp 2500 ≈ 5 mm sag (within real Franka impedance range, ≤3000).
  const kpR = opts.kpRevolute ?? 2500;
  const kvR = opts.kvRevolute ?? 120;
  const kpP = opts.kpPrismatic ?? 2000;
  const kvP = opts.kvPrismatic ?? 100;
  const actuatorXml = actuators
    .map((j) => {
      const prismatic = j.type === "prismatic";
      let a = `    <position name="${sanitize(j.name)}" joint="${sanitize(j.name)}" kp="${prismatic ? kpP : kpR}" kv="${prismatic ? kvP : kvR}"`;
      if (j.type !== "continuous" && j.lower != null && j.upper != null) {
        a += ` ctrlrange="${fmt(j.lower)} ${fmt(j.upper)}"`;
      }
      if (j.effort) a += ` forcerange="${fmt(-j.effort)} ${fmt(j.effort)}"`;
      return a + "/>";
    })
    .join("\n");

  const equalityXml = mimics
    .map(
      (j) =>
        `    <joint joint1="${sanitize(j.name)}" joint2="${sanitize(j.mimic!.joint)}" polycoef="${fmt(j.mimic!.offset)} ${fmt(j.mimic!.multiplier)} 0 0 0"/>`,
    )
    .join("\n");

  // usethread="false": MuJoCo ≥3.2 compiles mesh assets (convex hulls) on a
  // thread pool; the WASM pthread pool can't grow while the compiler blocks,
  // which deadlocks mj_loadXML for any model with ≥2 collision meshes.
  const xml = `<mujoco model="${robotName}_scene">
  <compiler angle="radian" meshdir="${meshDir}" balanceinertia="true" boundmass="0.001" boundinertia="1e-7" usethread="false"/>
  <option timestep="${fmt(opts.timestep ?? 0.002)}" integrator="implicitfast"/>
  <default>
    <geom contype="1" conaffinity="2" friction="1.5 0.01 0.001" condim="4"/>
  </default>
${assetXml ? `  <asset>\n${assetXml}\n  </asset>\n` : ""}  <worldbody>
${opts.ground === false ? "" : `    <geom name="ground" type="plane" size="10 10 0.1" contype="2" conaffinity="3"/>\n`}${robotBody}${sceneXml}  </worldbody>
${equalityXml ? `  <equality>\n${equalityXml}\n  </equality>\n` : ""}${actuatorXml ? `  <actuator>\n${actuatorXml}\n  </actuator>\n` : ""}</mujoco>
`;

  return {
    xml,
    meshes: [...meshes.values()],
    jointNames,
    actuators: actuators.map((j) => j.name),
    freeBodies,
    warnings,
  };
}
