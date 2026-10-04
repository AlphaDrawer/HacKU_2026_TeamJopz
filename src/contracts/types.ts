/**
 * GaitTrace 冻结接口契约（技术规范 v1.2 §5）
 * ---------------------------------------------------------------
 * 本文件是 UI 层与算法层之间【唯一】的数据边界，冻结后任何一方
 * MUST NOT 单方面修改；需要变更时按规范 §9 走双方同意 + 升版本流程。
 *
 * v1.2 变更：ReportRecord 与 AnalyzeResult 成功分支新增 MUST 字段
 * activityMode（'march' | 'walk'）；stability Metric 语义由「CV% 越小
 * 越好」改为「稳定度得分 0–100，越大越好」（unit 由 'cv' 改为 '%'），
 * level 仍按内部稳健 rCV% 判定（CV_GREEN/CV_YELLOW）。
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

/** 本次测量的运动类型：march=原地踏步，walk=直线行走（v1.2 MUST） */
export type ActivityMode = "march" | "walk";

export interface ReportRecord {
  /** 由前端生成、全链路唯一标识（建议 crypto.randomUUID） */
  sessionId: string;
  createdAtMs: number;
  durationSec: number;
  /**
   * 运动类型（v1.2 MUST）：由算法层根据髋水平摆幅判定，
   * march=原地踏步（speed/stride 强制为 null），walk=直线行走。
   * 构造任何 ReportRecord 时 MUST 提供该字段。
   */
  activityMode: ActivityMode;
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

/**
 * 失败时的只读内部诊断（v1.3 新增可选字段；不改写任何门控决策，
 * 也不会在真机上自动放行）。仅在 ok:false 时可能出现，供 UI 诊断行
 * 展示，下次真机失败即可定位是「模式误判 / 入不了段 / 裁太短 /
 * 事件不足 / 低置信」哪一环。
 */
export interface SessionDebugInfo {
  /** 切段阶段判定的模式：march=原地踏步，locomotion=走行 */
  mode: "march" | "locomotion";
  /** 髋中心 x 全段摆幅（虚拟 px）与 v1.2 旧判定阈值 */
  hipRangePx: number;
  marchHipRangePx: number;
  /** 切出的段数与每段起止/时长/方向 */
  segmentCount: number;
  segments: Array<{
    startMs: number;
    endMs: number;
    durationMs: number;
    direction: "out" | "back";
  }>;
  /** 合并所有段后每侧 heelStrike 数（段数为 0 时均为 0） */
  strikesLeft: number;
  strikesRight: number;
  /** 段内关键关节（双髋/双踝）平均可见度 0..1（无段时为全会话均值） */
  meanJointVisibility: number;
  /** 平滑踝垂直能量的中位数/峰值（px/s）与自适应入段阈值、v1.2 旧阈值 */
  energyMedianPxS: number;
  energyPeakPxS: number;
  energyEnterPxS: number;
  legacyEnterPxS: number;
}

export type AnalyzeResult =
  | {
      ok: true;
      metrics: GaitMetrics;
      conclusion: GaitConclusion;
      /** 运动类型（v1.2 MUST）：march=原地踏步，walk=直线行走 */
      activityMode: ActivityMode;
    }
  | {
      ok: false;
      reason: AnalyzeFailureReason;
      message: string;
      /** v1.3 可选只读诊断（见 SessionDebugInfo） */
      debug?: SessionDebugInfo;
    };

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
