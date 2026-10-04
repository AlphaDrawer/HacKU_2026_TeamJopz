/**
 * report.ts（UI 侧报告领域助手）
 * ------------------------------------------------------------------
 * 本文件【不再自定义契约】：所有类型一律来自冻结契约
 * `src/contracts/types.ts`（v1.1 §5），这里只 import、不重定义。
 *
 * 职责（只做与 UI 报告相关的纯数据装配/校验，不做任何临床推算）：
 *  - unavailableRecord()：构造一条「本次未能测量」的占位报告。
 *    v1.1 的 ReportRecord 已无 status 字段，因此「未测」用
 *    「四个指标 value 全为 null + conclusion 说明未取得有效画面」来表达。
 *  - isFiniteMeasurement()：落库前守卫，要求至少一个指标有数值、
 *    且所有非空指标都是有限数（防 NaN / Infinity 污染历史与趋势）。
 *  - 一组构造 Metric / GaitMetrics 的小工具，供 mock 与（未来）真实
 *    core 的接线复用。
 */
import type {
  AlertLevel,
  GaitConclusion,
  GaitMetrics,
  Metric,
  MetricKey,
  MetricLevel,
  ReportRecord,
  ScaleInfo,
} from "../contracts/types";

/** 全程常驻的筛查免责声明（规范 §4.4 强制） */
export const SCREENING_DISCLAIMER =
  "本结果用于筛查与自我追踪，不构成医学诊断；如有疑虑请由医护人员评估。";

const METRIC_ORDER: readonly MetricKey[] = ["symmetry", "stability", "speed", "strideLength"];

/** 生成一个 sessionId：优先原生 UUID，否则时间+随机兜底 */
export function newSessionId(now = Date.now()): string {
  return globalThis.crypto?.randomUUID?.() ?? `${now}-${Math.random().toString(36).slice(2)}`;
}

/** 单个指标槽的构造器（value=null 时 level 强制为 "none"，符合契约） */
export function makeMetric(init: {
  key: MetricKey;
  label: string;
  value: number | null;
  unit: Metric["unit"];
  calibrated: boolean;
  confidence: number;
  hint: string;
  level?: MetricLevel;
}): Metric {
  const value = init.value;
  const level: MetricLevel =
    value === null ? "none" : (init.level ?? "none");
  return {
    key: init.key,
    label: init.label,
    value,
    unit: init.unit,
    level,
    calibrated: init.calibrated,
    confidence: init.confidence,
    hint: init.hint,
  };
}

/** 四个指标全为 null 的指标集（未测量 / 模型未接入时使用） */
export function emptyMetricSet(sessionId: string, timestampMs: number, scale?: ScaleInfo): GaitMetrics {
  const noScale: ScaleInfo = scale ?? { calibrated: false, method: "none" };
  return {
    sessionId,
    timestampMs,
    scale: noScale,
    metrics: {
      symmetry: makeMetric({
        key: "symmetry", label: "步态对称度", value: null, unit: "%",
        calibrated: false, confidence: 0, hint: "暂无有效测量",
      }),
      stability: makeMetric({
        key: "stability", label: "步态稳定度", value: null, unit: "%",
        calibrated: false, confidence: 0, hint: "暂无有效测量",
      }),
      speed: makeMetric({
        key: "speed", label: "步行速度", value: null, unit: "m/s",
        calibrated: false, confidence: 0, hint: "尺度未标定",
      }),
      strideLength: makeMetric({
        key: "strideLength", label: "步幅", value: null, unit: "m",
        calibrated: false, confidence: 0, hint: "尺度未标定",
      }),
    },
  };
}

/** 把指标集展平为有序数组（symmetry → stability → speed → strideLength） */
export function metricList(metrics: GaitMetrics): Metric[] {
  return METRIC_ORDER.map((key) => metrics.metrics[key]);
}

function buildUnavailableConclusion(now: number): GaitConclusion {
  void now;
  return {
    overallScore: 0,
    alertLevel: "normal", // 未测量不是危险，也不渲染灯号
    summaryLine: "本次未取得足够的有效画面，没有产生测量结果。",
    alerts: [],
    disclaimer: SCREENING_DISCLAIMER,
    exercises: [],
  };
}

/**
 * 构造一条「未能测量」占位报告（不落视频/关键点，仅本地文本）。
 * 保留旧 API 的语义：显式、不造假分。
 */
export function unavailableRecord(now = Date.now()): ReportRecord {
  const sessionId = newSessionId(now);
  return {
    sessionId,
    createdAtMs: now,
    durationSec: 0,
    // 占位记录没有真实运动；默认 march 以满足 MUST 字段
    activityMode: "march",
    metrics: emptyMetricSet(sessionId, now),
    conclusion: buildUnavailableConclusion(now),
  };
}

/** 取指标集中第一个有数值的指标（用于判断「是否真的测到东西」） */
export function firstMeasuredMetric(metrics: GaitMetrics): Metric | null {
  return metricList(metrics).find((m) => m.value !== null) ?? null;
}

/**
 * 落库前有效性守卫：
 *  - 至少一个指标有数值；
 *  - 所有非空数值都是有限数。
 * 满足才视为一次「有效测量」。
 */
export function isFiniteMeasurement(record: ReportRecord): boolean {
  const list = metricList(record.metrics);
  const hasValue = list.some((m) => m.value !== null);
  const allFinite = list.every((m) => m.value === null || Number.isFinite(m.value));
  return hasValue && allFinite;
}

/** UI 便捷判断：结论是否达到需要立即关注的等级（§4.4 单次严重异常预警） */
export function isSevere(alertLevel: AlertLevel): boolean {
  return alertLevel === "seekCare";
}
