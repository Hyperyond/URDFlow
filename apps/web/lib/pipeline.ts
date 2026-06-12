/**
 * The robot-data pipeline, as one source of truth shared by the sidebar nav
 * and the studio overview. Stages marked `live` are the working product;
 * `wip` stages are designed shells (frontend preview, backend deferred).
 */

export type StageStatus = "live" | "wip";

export interface Stage {
  id: string;
  index: string; // "01".."06"
  name: string; // Chinese label
  en: string; // English subtitle
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
    name: "采集",
    en: "Collect",
    href: "/studio/collect",
    status: "wip",
    blurb: "浏览器直连真机遥操作采集,或导入已有数据集。",
    edge: "零安装,WebSerial 直连 SO-101;不强制私有化部署。",
  },
  {
    id: "annotate",
    index: "02",
    name: "标注",
    en: "Annotate",
    href: "/studio/annotate",
    status: "wip",
    blurb: "任务语言、技能分段、关键帧标记,3D 同屏对齐。",
    edge: "标注直接挂在 3D 轨迹上,不是看视频拉时间轴。",
  },
  {
    id: "qc",
    index: "03",
    name: "质检",
    en: "Quality",
    href: "/dataset",
    status: "live",
    blurb: "批量回放打分:滑脚 / 穿模 / 限位 / 跳变,筛出可训练的数据。",
    edge: "懂机器人语义的自动质检 —— 别人靠人眼逐条看,我们替代质检员。",
  },
  {
    id: "playback",
    index: "04",
    name: "回放",
    en: "Playback",
    href: "/player",
    status: "live",
    blurb: "任意 URDF + 轨迹,浏览器 3D 回放,逐秒定位问题帧。",
    edge: "拖入即看,链接即分享,无需配环境。",
  },
  {
    id: "manage",
    index: "05",
    name: "管理",
    en: "Manage",
    href: "/studio/manage",
    status: "wip",
    blurb: "数据集托管、版本、质量门禁(CI 式),团队协作。",
    edge: "机器人数据集的 GitHub —— 不合格的数据进不来。",
  },
  {
    id: "train",
    index: "06",
    name: "训练",
    en: "Train",
    href: "/studio/train",
    status: "wip",
    blurb: "导出 LeRobot / 对接 holosoma,一键起训,浏览器看 checkpoint。",
    edge: "不重造训练框架,做它们最好用的前端。",
  },
];

export const stageById = (id: string) => STAGES.find((s) => s.id === id);
