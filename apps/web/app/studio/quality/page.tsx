"use client";

/**
 * Dataset QC bench — stage 3 of the data-QC workbench.
 * Drop a batch of trajectory files (.npz), every clip is replayed through FK
 * and scored (foot skating / penetration / joint limits / teleports). The
 * table filters by score, rows expand into the per-issue list, and the
 * selected (clean) episodes export as a zip plus a JSON report.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadURDFFromURL,
  parseNpz,
  motionFromNpz,
  fitJointCount,
  analyzeClip,
  buildZip,
  type MotionClip,
  type QCReport,
  type URDFRobot,
} from "@urdflow/urdf-web";

const ROBOT_URDF = "/robots/g1/g1_29dof_spherehand.urdf";

const BUILTIN = [
  { name: "climb_00.npz", url: "/datasets/omniretarget/climb_00.npz" },
  { name: "chair_carry.npz", url: "/datasets/omniretarget/chair_carry.npz" },
];

interface Row {
  name: string;
  bytes: Uint8Array;
  clip: MotionClip;
  report: QCReport;
  selected: boolean;
}

function movableJoints(robot: URDFRobot): string[] {
  return Object.entries(robot.joints)
    .filter(([, j]) => {
      const t = (j as { jointType?: string }).jointType;
      const mimic = (j as { mimicJoint?: unknown }).mimicJoint;
      return t !== "fixed" && !mimic;
    })
    .map(([name]) => name);
}

function scoreColor(s: number): string {
  return s >= 90 ? "text-emerald-400" : s >= 70 ? "text-amber-400" : "text-red-400";
}

function download(name: string, data: ArrayBuffer | string, mime: string): void {
  const blob = typeof data === "string" ? new Blob([data], { type: mime }) : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DatasetPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState("Loading robot model…");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [minScore, setMinScore] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const robotRef = useRef<URDFRobot | null>(null);
  const jointsRef = useRef<string[]>([]);

  useEffect(() => {
    let alive = true;
    loadURDFFromURL(ROBOT_URDF)
      .then((robot) => {
        if (!alive) return;
        robotRef.current = robot;
        jointsRef.current = movableJoints(robot);
        setStatus("");
      })
      .catch((e) => setStatus(`Robot load failed: ${e.message}`));
    return () => {
      alive = false;
    };
  }, []);

  const analyzeFiles = useCallback(async (files: { name: string; buffer: ArrayBuffer }[]) => {
    const robot = robotRef.current;
    if (!robot) return;
    const movable = jointsRef.current;
    setProgress({ done: 0, total: files.length });
    const newRows: Row[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      try {
        let clip = motionFromNpz(await parseNpz(f.buffer));
        const nRobotOnly = clip.dim - 7;
        const nWithObject = clip.dim - 14;
        if (nRobotOnly <= movable.length) clip = fitJointCount(clip, nRobotOnly);
        else if (nWithObject > 0 && nWithObject <= movable.length) clip = fitJointCount(clip, nWithObject);
        else throw new Error(`width ${clip.dim} doesn't match the robot`);
        const report = analyzeClip(robot, clip, { jointNames: movable });
        newRows.push({ name: f.name, bytes: new Uint8Array(f.buffer), clip, report, selected: report.score >= 90 });
      } catch (e) {
        console.warn(`Analysis failed ${f.name}:`, e);
      }
      setProgress({ done: i + 1, total: files.length });
      await new Promise((r) => setTimeout(r, 0)); // let the UI breathe
    }
    setProgress(null);
    setRows((prev) => {
      const names = new Set(newRows.map((r) => r.name));
      return [...prev.filter((r) => !names.has(r.name)), ...newRows];
    });
  }, []);

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = [...e.dataTransfer.files].filter((f) => f.name.endsWith(".npz"));
      if (files.length === 0) {
        setStatus("Please drop .npz trajectory files");
        return;
      }
      setStatus("");
      const loaded = await Promise.all(files.map(async (f) => ({ name: f.name, buffer: await f.arrayBuffer() })));
      void analyzeFiles(loaded);
    },
    [analyzeFiles],
  );

  const loadBuiltin = useCallback(async () => {
    const loaded = await Promise.all(
      BUILTIN.map(async (b) => ({ name: b.name, buffer: await fetch(b.url).then((r) => r.arrayBuffer()) })),
    );
    void analyzeFiles(loaded);
  }, [analyzeFiles]);

  const visible = rows.filter((r) => r.report.score >= minScore);
  const selectedRows = rows.filter((r) => r.selected);

  const exportZip = useCallback(() => {
    if (selectedRows.length === 0) return;
    const zip = buildZip(selectedRows.map((r) => ({ name: r.name, data: r.bytes })));
    download(`urdflow_dataset_${selectedRows.length}clips.zip`, zip, "application/zip");
  }, [selectedRows]);

  const exportReport = useCallback(() => {
    const report = {
      generator: "URDFlow data-QC",
      date: new Date().toISOString(),
      robot: ROBOT_URDF,
      clips: rows.map((r) => ({
        name: r.name,
        frames: r.report.frames,
        duration: r.report.duration,
        score: r.report.score,
        metrics: r.report.metrics,
        issues: r.report.issues,
      })),
    };
    download("urdflow_qc_report.json", JSON.stringify(report, null, 2), "application/json");
  }, [rows]);

  return (
    <div
      className="min-h-full bg-[#10141a] text-zinc-200"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center border-4 border-dashed border-cyan-400/70 bg-cyan-400/10 text-xl font-semibold text-cyan-200">
          Drop to batch-QC .npz trajectories
        </div>
      )}

      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-50">Dataset QC Bench</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Drop a batch of .npz trajectories → score them → filter out the bad ones → export a clean dataset
            </p>
          </div>
          <div className="flex gap-2 text-sm">
            <button onClick={loadBuiltin} className="rounded bg-white/10 px-3 py-1.5 hover:bg-white/20">
              Load samples
            </button>
          </div>
        </div>

        {status && <div className="mt-6 text-sm text-amber-300">{status}</div>}
        {progress && (
          <div className="mt-6">
            <div className="mb-1 text-xs text-zinc-400">
              Analyzing {progress.done}/{progress.total}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded bg-white/10">
              <div
                className="h-full bg-cyan-500 transition-all"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {rows.length === 0 && !progress && !status && (
          <div className="mt-16 rounded-xl border border-dashed border-white/15 py-20 text-center text-zinc-500">
            Drop .npz trajectory files here (multi-select), or click “Load samples” to try it
          </div>
        )}

        {rows.length > 0 && (
          <>
            <div className="mt-6 flex flex-wrap items-center gap-4 text-sm">
              <span className="text-zinc-400">
                {rows.length} clips · {selectedRows.length} selected
              </span>
              <label className="flex items-center gap-2 text-zinc-400">
                score ≥ <span className="tabular-nums text-zinc-200">{minScore}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={minScore}
                  onChange={(e) => setMinScore(Number(e.target.value))}
                  className="w-32 accent-cyan-500"
                />
              </label>
              <div className="ml-auto flex gap-2">
                <button
                  onClick={exportReport}
                  className="rounded bg-white/10 px-3 py-1.5 hover:bg-white/20"
                >
                  Export report JSON
                </button>
                <button
                  onClick={exportZip}
                  disabled={selectedRows.length === 0}
                  className="rounded bg-emerald-600/90 px-3 py-1.5 font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
                >
                  Export selected ({selectedRows.length}) as zip
                </button>
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-xl border border-white/10">
              <table className="w-full text-sm">
                <thead className="bg-white/5 text-left text-xs text-zinc-400">
                  <tr>
                    <th className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={visible.length > 0 && visible.every((r) => r.selected)}
                        onChange={(e) =>
                          setRows((rs) =>
                            rs.map((r) => (r.report.score >= minScore ? { ...r, selected: e.target.checked } : r)),
                          )
                        }
                      />
                    </th>
                    <th className="px-3 py-2">File</th>
                    <th className="px-3 py-2 text-right">Length</th>
                    <th className="px-3 py-2 text-right">Score</th>
                    <th className="px-3 py-2 text-right">Skate</th>
                    <th className="px-3 py-2 text-right">Penet.</th>
                    <th className="px-3 py-2 text-right">Limit</th>
                    <th className="px-3 py-2 text-right">Telep.</th>
                    <th className="px-3 py-2 text-right">Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {visible
                    .slice()
                    .sort((a, b) => a.report.score - b.report.score)
                    .map((r) => (
                      <DatasetRow
                        key={r.name}
                        row={r}
                        expanded={expanded === r.name}
                        onToggleExpand={() => setExpanded((x) => (x === r.name ? null : r.name))}
                        onToggleSelect={() =>
                          setRows((rs) => rs.map((x) => (x.name === r.name ? { ...x, selected: !x.selected } : x)))
                        }
                      />
                    ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-zinc-500">
              Robot: Unitree G1 (sphere hand) · metrics: foot skate / ground penetration / joint limits /
              base teleports · clips ≥ 90 selected by default
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function DatasetRow({
  row,
  expanded,
  onToggleExpand,
  onToggleSelect,
}: {
  row: Row;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleSelect: () => void;
}) {
  const m = row.report.metrics;
  return (
    <>
      <tr className="border-t border-white/5 hover:bg-white/5">
        <td className="px-3 py-2">
          <input type="checkbox" checked={row.selected} onChange={onToggleSelect} />
        </td>
        <td className="cursor-pointer px-3 py-2 font-mono text-xs" onClick={onToggleExpand}>
          {row.name}
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-zinc-400">{row.report.duration.toFixed(1)}s</td>
        <td className={`px-3 py-2 text-right text-base font-bold tabular-nums ${scoreColor(row.report.score)}`}>
          {row.report.score}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{(m.footSkateDistance * 100).toFixed(1)}cm</td>
        <td className="px-3 py-2 text-right tabular-nums">{(m.maxPenetration * 100).toFixed(1)}cm</td>
        <td className="px-3 py-2 text-right tabular-nums">{m.limitViolationFrames}</td>
        <td className="px-3 py-2 text-right tabular-nums">{m.teleportCount}</td>
        <td className="cursor-pointer px-3 py-2 text-right tabular-nums text-cyan-300" onClick={onToggleExpand}>
          {row.report.issues.length} {expanded ? "▾" : "▸"}
        </td>
      </tr>
      {expanded && row.report.issues.length > 0 && (
        <tr className="border-t border-white/5 bg-black/30">
          <td colSpan={9} className="px-6 py-3">
            <ul className="space-y-1 text-xs text-zinc-300">
              {row.report.issues.map((issue, i) => (
                <li key={i}>
                  <span className="tabular-nums text-zinc-500">{issue.time.toFixed(1)}s</span> · {issue.detail}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}
