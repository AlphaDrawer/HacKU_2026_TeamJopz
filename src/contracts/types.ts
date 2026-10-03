/**
 * GaitTrace 冻结接口契约（技术规范 v1.1 §5）
 * ---------------------------------------------------------------
 * 本文件是 UI 层与算法层之间【唯一】的数据边界，冻结后任何一方
 * MUST NOT 单方面修改；需要变更时按规范 §9 走双方同意 + 升版本流程。
 *
 * 规范强度：字段命名、可空性与单位均为 MUST。
 */

// ---------- §5.1 关键点与帧 ----------

export interface Landmark {
  /** 归一化 0..1（相对宽） */
  x: number;
  /** 归一化 0..1（相对高） */
  y: number;
  /** 相对深度 */
  z: number;
  /** 可见度 0..1 */
  visibility: number;
}

export interface PoseFrame {
  frameId: number;
  /** 设备时间戳（毫秒）；禁止用帧数计时 */
  timestampMs: number;
  /** MediaPipe 33 点，按官方索引 */
  landmarks: Landmark[];
  /** 本帧推理耗时（毫秒，诊断用） */
  inferMs: number;
}

// ---------- §5.2 事件、周期、切段 ----------

export type Side = "left" | "right";
export type GaitEventType = "heelStrike" | "toeOff";

export interface GaitEvent {
  type: GaitEventType;
  side: Side;
  timestampMs: number;
  confidence: number;
}

export interface GaitCycle {
  side: Side;
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface ValidSegment {
  startMs: number;
  endMs: number;
  direction: "out" | "back";
  events: GaitEvent[];
  cycles: GaitCycle[];
}

// ---------- §5.3 指标与结论 ----------

export interface ScaleInfo {
  calibrated: boolean;
  pixelsPerMeter?: number;
  method?: "tile" | "step" | "height" | "manual" | "none";
  confidence?: number;
}

export type MetricLevel = "green" | "yellow" | "red" | "none";

export type MetricKey = "symmetry" | "stability" | "speed" | "strideLength";

export interface Metric {
  key: MetricKey;
  label: string;
  /** 主指标非空；校准项不可信时为 null */
  value: number | null;
  unit: "%" | "m/s" | "m" | "cv";
  /** value=null 时 MUST 为 "none" */
  level: MetricLevel;
  calibrated: boolean;
  confidence: number;
  hint: string;
}

export interface GaitMetrics {
  sessionId: string;
  timestampMs: number;
  scale: ScaleInfo;
  metrics: {
    symmetry: Metric;
    stability: Metric;
    speed: Metric;
    strideLength: Metric;
  };
}

export type AlertLevel = "normal" | "caution" | "seekCare";

export interface Exercise {
  id: string;
  name: string;
  applicable: string;
  steps: string[];
  cautions: string[];
  imageUrl?: string;
}

export interface GaitConclusion {
  /** 0..100 */
  overallScore: number;
  alertLevel: AlertLevel;
  summaryLine: string;
  alerts: string[];
  disclaimer: string;
  exercises: Exercise[];
}

export interface ReportRecord {
  /** 由前端生成、全链路唯一标识（建议 crypto.randomUUID） */
  sessionId: string;
  createdAtMs: number;
  durationSec: number;
  metrics: GaitMetrics;
  conclusion: GaitConclusion;
}

// ---------- §5.4 存储 ----------

export interface ReportStore {
  save(record: ReportRecord): Promise<void>;
  /** 按 createdAt 升序 */
  getAll(): Promise<ReportRecord[]>;
  getByRange(fromMs: number, toMs: number): Promise<ReportRecord[]>;
  delete(sessionId: string): Promise<void>;
}

// ---------- §5.5 算法层总入口 ----------

export type ScaleHint = {
  method: ScaleInfo["method"];
  referenceLengthM?: number;
};

/** analyzeSession 失败原因（§3.2：主指标算不出 = 测量失败，非疾病结论） */
export type AnalyzeFailureReason =
  | "insufficient-frames"
  | "insufficient-main-metrics"
  | "low-confidence";

export type AnalyzeResult =
  | { ok: true; metrics: GaitMetrics; conclusion: GaitConclusion }
  | { ok: false; reason: AnalyzeFailureReason; message: string };

export interface GaitCore {
  initPose(modelAssetUrl: string): Promise<void>;
  /** 返回 null = 本帧未得到有效姿态（跳过/计数，非崩溃） */
  inferFrame(video: HTMLVideoElement, timestampMs: number): Promise<PoseFrame | null>;
  analyzeSession(
    sessionId: string,
    frames: PoseFrame[],
    history: ReportRecord[],
    scaleHint?: ScaleHint
  ): Promise<AnalyzeResult>;
}
