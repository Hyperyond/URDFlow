import { clampScene, type SceneSpec } from "./sceneTypes";
import { buildScene } from "./scenes";

const WORD_NUMS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const WORD_NUM_RE = "one|two|three|four|five|six";
const COLOR_WORDS: [RegExp, string][] = [
  [/red/i, "#f87171"],
  [/green/i, "#4ade80"],
  [/blue/i, "#60a5fa"],
  [/yellow/i, "#fbbf24"],
  [/orange/i, "#fb923c"],
  [/purple|violet/i, "#c084fc"],
];

const cap = (n: number) => Math.min(6, Math.max(1, n));

/** Number attached to a specific noun ("four cubes", "2 targets") — not just any digit. */
function numNear(prompt: string, noun: RegExp): number | null {
  const m = prompt.match(new RegExp(`([0-9]+|${WORD_NUM_RE})\\s+(?:\\w+\\s+){0,3}?(?:${noun.source})`, "i"));
  if (!m) return null;
  const tok = m[1]!.toLowerCase();
  return cap(/^\d+$/.test(tok) ? parseInt(tok, 10) : (WORD_NUMS[tok] ?? 3));
}

function countFrom(prompt: string, fallback: number): number {
  const digit = prompt.match(/\b(\d+)\b/);
  if (digit) return cap(parseInt(digit[1]!, 10));
  for (const [w, n] of Object.entries(WORD_NUMS)) {
    if (new RegExp(`\\b${w}\\b`, "i").test(prompt)) return n;
  }
  return fallback;
}

/**
 * Offline fallback: a small keyword parser so the prompt box still works without
 * an API key. Covers counts, layouts (row / circle / grid), colors, and the three
 * preset scene words.
 */
export function localSceneFromPrompt(
  prompt: string,
  anchor: { x: number; z: number; radius: number },
): SceneSpec {
  if (/conveyor|assembly/i.test(prompt)) return buildScene("assembly", anchor);
  if (/sort|pick/i.test(prompt)) return buildScene("sorting", anchor);
  if (/logistic|pallet|warehouse|stack/i.test(prompt)) return buildScene("logistics", anchor);

  // bind counts to their nouns: "four cubes … two targets" must not read the 2 as the cube count
  const n = numNear(prompt, /cubes?|blocks?|boxes?/i) ?? countFrom(prompt, 3);
  const colors = COLOR_WORDS.filter(([re]) => re.test(prompt)).map(([, c]) => c);
  const { x, z, radius } = anchor;
  const len = Math.hypot(x, z) || 1;
  const tx = -z / len;
  const tz = x / len;
  const cubes: SceneSpec["cubes"] = [];
  if (/circle|ring|arc/i.test(prompt)) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 0.9 - Math.PI * 0.45;
      cubes.push({
        x: Math.cos(a) * len * 0.95 * (x / len) - Math.sin(a) * len * 0.95 * (z / len) * -1,
        z: Math.sin(a) * len * 0.95 * (x / len) * -1 + Math.cos(a) * len * 0.95 * (z / len),
        color: colors[i % Math.max(1, colors.length)] ?? colors[0],
      });
    }
  } else if (/grid|array|cluster/i.test(prompt)) {
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
  const wantsTargets = !/no targets?|cubes? only|without targets?/i.test(prompt);
  const tCount = numNear(prompt, /targets?|drop|tray|bin/i) ?? (/same|single/i.test(prompt) ? 1 : n);
  // "targets far": push the drop-offs to the far edge of the (walkable) workspace
  const far = /far|distant|away/i.test(prompt);
  const tScale = far ? radius / (len || 1) : 1;
  const targets: SceneSpec["targets"] = [];
  for (let i = 0; i < (wantsTargets ? tCount : 0); i++) {
    const a = 0.7 + (i / Math.max(1, tCount - 1) || 0) * 0.5;
    targets.push({
      x: (x * Math.cos(a) - z * Math.sin(a)) * tScale,
      z: (x * Math.sin(a) + z * Math.cos(a)) * tScale,
    });
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
