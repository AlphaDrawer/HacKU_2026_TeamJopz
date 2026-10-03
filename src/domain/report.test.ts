import { describe, expect, it } from "vitest";
import {
  SCREENING_DISCLAIMER,
  emptyMetricSet,
  firstMeasuredMetric,
  isFiniteMeasurement,
  isSevere,
  makeMetric,
  metricList,
  newSessionId,
  unavailableRecord,
} from "./report";

describe("report 领域助手（v1.1 契约）", () => {
  it("unavailableRecord：显式未测、不造假分、键名与结构符合 v1.1", () => {
    const record = unavailableRecord(1234);
    expect(record.createdAtMs).toBe(1234);
    expect(record.sessionId).toBeTruthy();
    expect(record.durationSec).toBe(0);
    // 四个指标全部为 null
    expect(metricList(record.metrics).map((m) => m.value)).toEqual([null, null, null, null]);
    // value=null 时 level 必须为 none
    expect(metricList(record.metrics).every((m) => m.level === "none")).toBe(true);
    expect(record.conclusion.alertLevel).toBe("normal");
    expect(record.conclusion.overallScore).toBe(0);
    expect(record.conclusion.disclaimer).toBe(SCREENING_DISCLAIMER);
    // 顶层键集合（v1.1：无 status / id / measuredAt）
    expect(Object.keys(record).sort()).toEqual([
      "conclusion",
      "createdAtMs",
      "durationSec",
      "metrics",
      "sessionId",
    ]);
  });

  it("isFiniteMeasurement：至少一个有限数值才算有效测量", () => {
    const base = unavailableRecord();
    expect(isFiniteMeasurement(base)).toBe(false);

    // 给 symmetry 一个有限值 -> 有效
    const goodId = newSessionId();
    const goodMetrics: typeof base.metrics = {
      ...emptyMetricSet(goodId, 0),
      metrics: {
        ...emptyMetricSet(goodId, 0).metrics,
        symmetry: makeMetric({
          key: "symmetry", label: "左右對稱", value: 82, unit: "%",
          calibrated: true, confidence: 0.9, hint: "", level: "green",
        }),
      },
    };
    const good = { ...base, metrics: goodMetrics };
    expect(isFiniteMeasurement(good)).toBe(true);

    // NaN / Infinity 一律判无效
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const badMetrics: typeof base.metrics = {
        ...emptyMetricSet(goodId, 0),
        metrics: {
          ...emptyMetricSet(goodId, 0).metrics,
          symmetry: makeMetric({
            key: "symmetry", label: "左右對稱", value: bad, unit: "%",
            calibrated: true, confidence: 0.9, hint: "", level: "red",
          }),
        },
      };
      expect(isFiniteMeasurement({ ...base, metrics: badMetrics })).toBe(false);
    }
  });

  it("makeMetric：value=null 时强制 level=none，即便传了别的等级", () => {
    const m = makeMetric({
      key: "speed", label: "步速", value: null, unit: "m/s",
      calibrated: false, confidence: 0, hint: "", level: "red",
    });
    expect(m.level).toBe("none");
  });

  it("firstMeasuredMetric / isSevere 便捷判断", () => {
    expect(firstMeasuredMetric(emptyMetricSet("s", 0))).toBeNull();
    expect(isSevere("seekCare")).toBe(true);
    expect(isSevere("caution")).toBe(false);
  });
});
