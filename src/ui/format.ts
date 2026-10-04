/**
 * ui/format.ts（指标显示数值格式化）
 * ------------------------------------------------------------------
 * 只负责【显示层】的数字格式化，绝不修改 Metric 存储的原始 value。
 * 纯函数、不依赖 DOM，可在 Node 环境下单测。
 *
 * 统一口径：
 *  - 百分比类（symmetry、stability 得分）：四舍五入到整数；
 *  - 速度 m/s：保留 1 位小数；
 *  - 步幅 m：保留 2 位小数；
 *  - value 为 null / 非有限数：显示「—」。
 */
import type { Metric, MetricKey } from "../contracts/types";

/**
 * 稳健的四舍五入（half-up）到指定小数位。
 * 先放大成整数再取整，规避 Number.toFixed 的浮点误差与银行家舍入
 * （如 0.95*10 在浮点下是 9.499…，toFixed 会错误得到 "0.9"）。
 */
export function roundHalfUp(value: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** null / NaN / Infinity 一律显示为占位符「—」 */
export function dashIfMissing(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : String(value);
}

/** 百分比：四舍五入到整数 */
export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${roundHalfUp(value, 0)}%`;
}

/** 速度（m/s）：保留 1 位小数 */
export function formatSpeed(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${roundHalfUp(value, 1).toFixed(1)} m/s`;
}

/** 步幅（m）：保留 2 位小数 */
export function formatStride(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${roundHalfUp(value, 2).toFixed(2)} m`;
}

/**
 * 按指标类型统一格式化展示文本（含单位）。
 * stability 与 symmetry 同按百分比处理。
 */
export function formatMetric(metric: Metric): string {
  switch (metric.key) {
    case "symmetry":
    case "stability":
      return formatPercent(metric.value);
    case "speed":
      return formatSpeed(metric.value);
    case "strideLength":
      return formatStride(metric.value);
  }
}

/** 按 MetricKey 取原始数值并格式化为不带单位的纯数字文本（坐标轴/标签用） */
export function formatMetricValue(key: MetricKey, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  switch (key) {
    case "symmetry":
    case "stability":
      return String(roundHalfUp(value, 0));
    case "speed":
      return roundHalfUp(value, 1).toFixed(1);
    case "strideLength":
      return roundHalfUp(value, 2).toFixed(2);
  }
}
