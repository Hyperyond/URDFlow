import { clampScene, type SceneSpec } from "./sceneTypes";
import { buildScene } from "./scenes";

const CN_NUMS: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
const COLOR_WORDS: [RegExp, string][] = [
  [/红/, "#f87171"],
  [/绿/, "#4ade80"],
  [/蓝/, "#60a5fa"],
  [/黄/, "#fbbf24"],
  [/橙/, "#fb923c"],
  [/紫/, "#c084fc"],
];

const cap = (n: number) => Math.min(6, Math.max(1, n));

/** Number attached to a specific noun ("四个…方块", "2 targets") — not just any digit. */
function numNear(prompt: string, noun: RegExp): number | null {
  const m = prompt.match(new RegExp(`([0-9]+|[一两二三四五六])\\s*(?:个|块|颗|只)?[^,,。;;]*?(?:${noun.source})`));
  if (!m) return null;
  const tok = m[1]!;
  return cap(/^\d+$/.test(tok) ? parseInt(tok, 10) : (CN_NUMS[tok] ?? 3));
}

function countFrom(prompt: string, fallback: number): number {
  const digit = prompt.match(/(\d+)\s*(个|块|颗|只)?/);
  if (digit) return cap(parseInt(digit[1]!, 10));
  for (const [ch, n] of Object.entries(CN_NUMS)) {
    if (prompt.includes(ch + "个") || prompt.includes(ch + "块") || prompt.includes(ch + "颗")) return n;
  }
  return fallback;
}

/**
 * Offline fallback: a small Chinese/English keyword parser so the prompt box still
 * works without an API key. Covers counts, layouts (排/圈/格), colors, and the three
 * preset scene words.
 */
export function localSceneFromPrompt(
  prompt: string,
  anchor: { x: number; z: number; radius: number },
): SceneSpec {
  if (/流水线|传送|conveyor|assembly/i.test(prompt)) return buildScene("assembly", anchor);
  if (/分拣|拣选|sort/i.test(prompt)) return buildScene("sorting", anchor);
  if (/物流|仓储|码垛|logistic|pallet/i.test(prompt)) return buildScene("logistics", anchor);

  // bind counts to their nouns: "四个方块…两个目标" must not read the 2 as the cube count
  const n = numNear(prompt, /方块|立方|箱|物块|块|cube|box/i) ?? countFrom(prompt, 3);
  const colors = COLOR_WORDS.filter(([re]) => re.test(prompt)).map(([, c]) => c);
  const { x, z, radius } = anchor;
  const len = Math.hypot(x, z) || 1;
  const tx = -z / len;
  const tz = x / len;
  const cubes: SceneSpec["cubes"] = [];
  if (/圈|圆|circle|环/i.test(prompt)) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 0.9 - Math.PI * 0.45;
      cubes.push({
        x: Math.cos(a) * len * 0.95 * (x / len) - Math.sin(a) * len * 0.95 * (z / len) * -1,
        z: Math.sin(a) * len * 0.95 * (x / len) * -1 + Math.cos(a) * len * 0.95 * (z / len),
        color: colors[i % Math.max(1, colors.length)] ?? colors[0],
      });
    }
  } else if (/格|阵|grid|堆/i.test(prompt)) {
    for (let i = 0; i < n; i++) {
      const u = (i % 2) - 0.5;
      const v = Math.floor(i / 2) - 0.5;
      cubes.push({ x: x + tx * 0.09 * u + (x / len) * 0.07 * v, z: z + tz * 0.09 * u + (z / len) * 0.07 * v, color: colors[i % Math.max(1, colors.length)] ?? colors[0] });
    }
  } else {
    // default: a row across the workspace
    for (let i = 0; i < n; i++) {
      const u = i - (n - 1) / 2;
      cubes.push({ x: x + tx * 0.09 * u, z: z + tz * 0.09 * u, color: colors[i % Math.max(1, colors.length)] ?? colors[0] });
    }
  }
  const wantsTargets = !/不要目标|无目标|只要方块/.test(prompt);
  const tCount = numNear(prompt, /目标|放置|托盘|target/i) ?? (/同一个/.test(prompt) ? 1 : n);
  const targets: SceneSpec["targets"] = [];
  for (let i = 0; i < (wantsTargets ? tCount : 0); i++) {
    const a = 0.7 + (i / Math.max(1, tCount - 1) || 0) * 0.5;
    targets.push({ x: x * Math.cos(a) - z * Math.sin(a), z: x * Math.sin(a) + z * Math.cos(a) });
  }
  return clampScene({ cubes, targets }, radius);
}

/** Prompt → scene: try the server (Claude) first, fall back to the local parser. */
export async function sceneFromPrompt(
  prompt: string,
  anchor: { x: number; z: number; radius: number },
): Promise<{ scene: SceneSpec; source: "claude" | "local" }> {
  try {
    const res = await fetch("/api/scene", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, radius: anchor.radius, anchor: { x: anchor.x, z: anchor.z } }),
    });
    if (res.ok) {
      const data = (await res.json()) as { scene?: SceneSpec };
      if (data.scene && Array.isArray(data.scene.cubes)) {
        return { scene: clampScene(data.scene, anchor.radius), source: "claude" };
      }
    }
  } catch {
    // network/API unavailable — fall through to the local parser
  }
  return { scene: localSceneFromPrompt(prompt, anchor), source: "local" };
}
