import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const SCENE_SCHEMA = {
  type: "object",
  properties: {
    cubes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          x: { type: "number", description: "meters, origin at the robot base" },
          z: { type: "number", description: "meters, origin at the robot base" },
          color: {
            type: "string",
            description: "optional CSS hex color, e.g. #f87171",
          },
        },
        required: ["x", "z"],
        additionalProperties: false,
      },
    },
    targets: {
      type: "array",
      items: {
        type: "object",
        properties: {
          x: { type: "number" },
          z: { type: "number" },
        },
        required: ["x", "z"],
        additionalProperties: false,
      },
    },
  },
  required: ["cubes", "targets"],
  additionalProperties: false,
} as const;

/**
 * Prompt → scene layout via Claude. The viewport is a top view: the robot base sits at
 * the origin, cubes are 5cm, and everything must land inside the reachable annulus.
 * Without an API key the client falls back to its local parser, so this route simply
 * reports 503.
 */
export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "no_api_key" }, { status: 503 });
  }
  let body: { prompt?: string; radius?: number; anchor?: { x: number; z: number } };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const prompt = (body.prompt ?? "").slice(0, 500).trim();
  if (!prompt) return NextResponse.json({ error: "empty_prompt" }, { status: 400 });
  const radius = Math.min(Math.max(body.radius ?? 0.35, 0.18), 0.9);
  const ax = body.anchor?.x ?? radius;
  const az = body.anchor?.z ?? 0;

  const client = new Anthropic();
  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1500,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SCENE_SCHEMA },
      },
      system: [
        "You design layouts for a robot-arm simulation scene. Output top-view coordinates (in meters) with the robot base at the origin (0,0).",
        `Reachability: distance to the origin must be between 0.14 and ${radius.toFixed(2)}; the comfortable work point is near (${ax.toFixed(2)}, ${az.toFixed(2)}).`,
        "Cubes are 0.05 m on a side; keep at least 0.09 m between the centers of any two objects (cube or target).",
        "`cubes` are the blocks to pick (up to 6, optional color); `targets` are drop-off points (up to 6). The grasp program places cube i at target i % targets.length, in order.",
        "Follow the user's description for count, color, and layout (row / grid / fan, etc.) so the arrangement matches the described industrial scene.",
      ].join("\n"),
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") {
      return NextResponse.json({ error: "no_output" }, { status: 502 });
    }
    const scene = JSON.parse(text.text) as { cubes: unknown; targets: unknown };
    return NextResponse.json({ scene });
  } catch (e) {
    const message = e instanceof Anthropic.APIError ? `${e.status}: ${e.message}` : String(e);
    return NextResponse.json({ error: "claude_failed", message }, { status: 502 });
  }
}
