/**
 * walkingSkeleton.test.ts（端到端：假帧→AnalyzeResult→（成功）存库→历史；
 *                         失败分支不落库、无分数）
 * ------------------------------------------------------------------
 * 用内存版 ReportStore（不依赖浏览器 IndexedDB，node 环境即可跑）验证：
 *   MockGaitCore.inferFrame 造帧 → analyzeSession 返回 AnalyzeResult
 *     · ok:true  → assembleRecord 装配 → hasMainMetrics 守卫通过
 *                 → store.save → getAll 升序 / getByRange 正确
 *     · ok:false → 无 metrics/conclusion，调用方不落库（本测试断言不落库）
 *
 * 断言只验证“链路通 + 结构/排序契约 + 失败安全”，不把合成数值当临床结论。
 */
import { describe, expect, it } from "vitest";
import type {
  AnalyzeFailureReason,
  ReportRecord,
  ReportStore,
} from "../contracts/types";
import { MockGaitCore } from "./mockGaitCore";
import { generateFakeFrame } from "./fakePose";
import { assembleRecord, hasMainMetrics } from "../ui/measurementSession";

/** 极简内存仓库，实现 ReportStore 接口 */
class MemoryStore implements ReportStore {
  private rows: ReportRecord[] = [];

  async save(record: ReportRecord): Promise<void> {
    this.rows = this.rows.filter((r) => r.sessionId !== record.sessionId);
    this.rows.push(record);
  }
  async getAll(): Promise<ReportRecord[]> {
    return [...this.rows].sort((a, b) => a.createdAtMs - b.createdAtMs);
  }
  async getByRange(fromMs: number, toMs: number): Promise<ReportRecord[]> {
    return this.rows.filter((r) => r.createdAtMs >= fromMs && r.createdAtMs <= toMs);
  }
  async delete(sessionId: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.sessionId !== sessionId);
  }
}

/** 生成一段合成帧 */
function fakeFrames(fromMs = 0, toMs = 30000, step = 33): ReturnType<typeof generateFakeFrame>[] {
  const frames = [];
  let seq = 0;
  for (let ms = fromMs; ms <= toMs; ms += step) {
    seq += 1;
    frames.push(generateFakeFrame(ms, seq));
  }
  return frames;
}

describe("端到端链路（成功路径）", () => {
  it("造帧→分析成功→存库→历史：结构、排序、区间查询均正确", async () => {
    const core = new MockGaitCore();
    await core.initPose("ignored-model-url");

    const result = await core.analyzeSession("session-demo-1", fakeFrames(), []);

    // 成功结果契约
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("应返回 ok:true");
    const { metrics, conclusion } = result;
    expect(metrics.metrics.symmetry.value).not.toBeNull();
    expect(metrics.metrics.stability.value).not.toBeNull();
    expect(metrics.metrics.speed.value).toBeNull(); // 未标定必须为 null
    expect(metrics.metrics.strideLength.value).toBeNull();
    // value=null 时 level 必为 none
    expect(metrics.metrics.speed.level).toBe("none");
    expect(metrics.metrics.strideLength.level).toBe("none");
    expect(conclusion.disclaimer).toBeTruthy();

    const record = assembleRecord("session-demo-1", 1000, 30, metrics, conclusion, "march");
    expect(hasMainMetrics(metrics)).toBe(true);

    const store = new MemoryStore();
    await store.save(record);

    // 再加一条更晚的记录，验证升序
    const later = assembleRecord("session-demo-2", 2000, 30, metrics, conclusion, "march");
    await store.save(later);

    const all = await store.getAll();
    expect(all.map((r) => r.sessionId)).toEqual(["session-demo-1", "session-demo-2"]);

    const ranged = await store.getByRange(1500, 2500);
    expect(ranged.map((r) => r.sessionId)).toEqual(["session-demo-2"]);

    await store.delete("session-demo-1");
    expect((await store.getAll()).map((r) => r.sessionId)).toEqual(["session-demo-2"]);
  });
});

describe("端到端（失败路径：不落库、无分数）", () => {
  it("构造时指定 low-confidence → ok:false 且带 reason/message", async () => {
    const core = new MockGaitCore("low-confidence");
    const result = await core.analyzeSession("s", fakeFrames(), []);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("应返回 ok:false");
    expect(result.reason).toBe("low-confidence");
    expect(result.message).toBeTruthy();
  });

  it.each(["insufficient-frames", "insufficient-main-metrics", "low-confidence"] as AnalyzeFailureReason[])(
    "失败原因 %s 时调用方不落库",
    async (reason) => {
      const core = new MockGaitCore(reason);
      const result = await core.analyzeSession("s", fakeFrames(), []);
      expect(result.ok).toBe(false);

      // 模拟 measurementSession 的安全契约：失败绝不落库
      const store = new MemoryStore();
      if (result.ok) {
        await store.save(
          assembleRecord("s", 1, 1, result.metrics, result.conclusion, "march"),
        );
      }
      expect(await store.getAll()).toEqual([]);
    },
  );

  it("空帧 → insufficient-frames", async () => {
    const core = new MockGaitCore();
    const result = await core.analyzeSession("s", [], []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("insufficient-frames");
  });

  it("帧太少（检不到足够着地）→ insufficient-main-metrics", async () => {
    const core = new MockGaitCore();
    const result = await core.analyzeSession("s", fakeFrames(0, 100, 33), []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("insufficient-main-metrics");
  });

  it("hasMainMetrics：两主指标缺一即不放行", async () => {
    const core = new MockGaitCore();
    const result = await core.analyzeSession("s", fakeFrames(), []);
    if (!result.ok) throw new Error("应成功");
    const okMetrics = result.metrics;
    expect(hasMainMetrics(okMetrics)).toBe(true);

    // 抠掉 symmetry → 守卫失败
    const broken: typeof okMetrics = {
      ...okMetrics,
      metrics: {
        ...okMetrics.metrics,
        symmetry: { ...okMetrics.metrics.symmetry, value: null, level: "none" },
      },
    };
    expect(hasMainMetrics(broken)).toBe(false);
  });
});
