/**
 * The robot-data pipeline, as one source of truth shared by the sidebar nav
 * and the studio overview. Stages marked `live` are the working product;
 * `wip` stages are designed shells (frontend preview, backend deferred).
 */

export type StageStatus = "live" | "wip";

export interface Stage {
  id: string;
  index: string; // "01".."06"
  name: string;
  href: string;
  status: StageStatus;
  blurb: string;
  /** what makes our take different from the incumbent platforms */
  edge: string;
}

export const STAGES: Stage[] = [
  {
    id: "collect",
    index: "01",
    name: "Collect",
    href: "/studio/collect",
    status: "wip",
    blurb: "Teleoperate a real robot straight from the browser, or import an existing dataset.",
    edge: "Zero install — WebSerial straight to an SO-101. No mandatory on-prem deploy.",
  },
  {
    id: "annotate",
    index: "02",
    name: "Annotate",
    href: "/studio/annotate",
    status: "wip",
    blurb: "Task language, skill segmentation and keyframes, aligned to the 3D trajectory.",
    edge: "Labels live on the 3D trajectory — not scrubbing a video timeline.",
  },
  {
    id: "qc",
    index: "03",
    name: "Quality",
    href: "/dataset",
    status: "live",
    blurb: "Batch replay and score: foot skate / penetration / joint limits / teleports — keep only the trainable clips.",
    edge: "Robot-aware QC that replaces the human inspector — others eyeball clips one by one.",
  },
  {
    id: "playback",
    index: "04",
    name: "Playback",
    href: "/player",
    status: "live",
    blurb: "Any URDF + trajectory, 3D replay in the browser, every issue seeked to its exact frame.",
    edge: "Drop it in and watch — share a link, no environment to set up.",
  },
  {
    id: "manage",
    index: "05",
    name: "Manage",
    href: "/studio/manage",
    status: "wip",
    blurb: "Dataset hosting, versioning, CI-style quality gates, and team collaboration.",
    edge: "GitHub for robot datasets — clips that fail QC don't get in.",
  },
  {
    id: "train",
    index: "06",
    name: "Train",
    href: "/studio/train",
    status: "wip",
    blurb: "Export to LeRobot / hand off to holosoma, launch a run, watch the checkpoint in the browser.",
    edge: "We don't rebuild the trainer — we're the best frontend for the ones that exist.",
  },
];

export const stageById = (id: string) => STAGES.find((s) => s.id === id);
