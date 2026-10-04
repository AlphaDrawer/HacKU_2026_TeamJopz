/**
 * mockGaitCore.ts（GaitCore 的可替换假实现 · 严格实现冻结接口）
 * ------------------------------------------------------------------
 * 用途：在不加载真实 MediaPipe 模型/wasm 的情况下（如纯 Node 单测），用
 * 确定性合成姿态打通并验证整条链路：
 *   假帧 → analyzeSession → AnalyzeResult →（成功）存库 → 历史
 *
 * 本类【精确实现】 contracts 里的 GaitCore 接口（§5.5 / §9），可与真实
 * createGaitCore() 无缝替换：
 *   - initPose(modelAssetUrl) ：无真实模型，直接置为就绪（忽略 url）
 *   - inferFrame(...)         ：返回一帧合成 PoseFrame（永不 null）
 *   - analyzeSession(...)     ：返回 AnalyzeResult（成功 ok:true；
 *                               可构造时指定 failReason 模拟 ok:false）
 *
 * 数值均为合成演示用；真实测量走 src/core，本类只用于测试与离线演示。
 */
import type {
  AnalyzeFailureReason,
  AnalyzeResult,
  GaitConclusion,
  GaitCore,
  GaitEvent,
  GaitMetrics,
  PoseFrame,
  ReportRecord,
  ScaleHint,
  Side,
} from "../contracts/types";
import { makeMetric, SCREENING_DISCLAIMER } from "../domain/report";
import { POSE_INDEX, generateFakeFrame } from "./fakePose";

/** 同侧相邻着地最小间隔（ms），平坦站姿去重 */
const MIN_SAME_FOOT_GAP_MS = 450;
/** 峰到摆动谷的最小落差（归一化），低于此不算一次抬腿 */
const SWING_DROP = 0.02;
/** 对称/稳定阈值与 core 常量保持一致（演示着色用） */
const SYM_GREEN = 80;
const CV_GREEN = 8;
const CV_YELLOW = 15;
const CV_SCORE_SCALE = 4;

/** 要判定主指标有效，至少需要的有效着地数（与真实 core 的最小样本一致） */
const MIN_STRIKES = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface SideState {
  lastStrikeMs: number;
  swingMinY: number;
}

function newSideState(): SideState {
  return { lastStrikeMs: -Infinity, swingMinY: Infinity };
}

/**
 * 演示级 heelStrike 检测：踝着地 = 踝 y 的局部【最大值】（y 向下），
 * 且两击之间必须真的抬过腿（谷确认），避免站姿平坦平台一击多点。
 */
export function detectFakeHeelStrikes(frames: PoseFrame[]): GaitEvent[] {
  const events: GaitEvent[] = [];
  const state: Record<Side, SideState> = { left: newSideState(), right: newSideState() };

  for (let i = 1; i < frames.length - 1; i += 1) {
    const prev = frames[i - 1];
    const curr = frames[i];
    const next = frames[i + 1];

    (["left", "right"] as Side[]).forEach((foot) => {
      const idx = foot === "left" ? POSE_INDEX.LEFT_ANKLE : POSE_INDEX.RIGHT_ANKLE;
      const yOf = (f: PoseFrame): number => f.landmarks[idx].y;
      const y = yOf(curr);
      if (y < state[foot].swingMinY) state[foot].swingMinY = y;

      const isLocalMax = yOf(prev) < y && y >= yOf(next);
      const enoughGap = curr.timestampMs - state[foot].lastStrikeMs >= MIN_SAME_FOOT_GAP_MS;
      const droppedEnough = y - state[foot].swingMinY >= SWING_DROP;

      if (isLocalMax && enoughGap && droppedEnough) {
        events.push({
          type: "heelStrike",
          side: foot,
          timestampMs: curr.timestampMs,
          confidence: 0.8,
        });
        state[foot].lastStrikeMs = curr.timestampMs;
        state[foot].swingMinY = y;
      }
    });
  }

  return events.sort((a, b) => a.timestampMs - b.timestampMs);
}

function average(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

function cvPercent(values: number[]): number {
  if (values.length < 2) return 0;
  const m = average(values);
  if (m === 0) return 0;
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
  return (Math.sqrt(variance) / m) * 100;
}

/** 演示级指标：symmetry/CV 有值；speed/strideLength 未标定 → null */
function buildFakeMetrics(sessionId: string, frames: PoseFrame[], events: GaitEvent[]): GaitMetrics {
  const endMs = frames.length ? frames[frames.length - 1].timestampMs : 0;

  // 仅异侧相邻间隔算交替步
  const gaps: number[] = [];
  for (let i = 1; i < events.length; i += 1) {
    if (events[i].side !== events[i - 1].side) {
      gaps.push(events[i].timestampMs - events[i - 1].timestampMs);
    }
  }

  const leftGaps = gaps.filter((_, i) => events[i]?.side === "left");
  const rightGaps = gaps.filter((_, i) => events[i]?.side === "right");
  const meanLeft = average(leftGaps.length ? leftGaps : gaps);
  const meanRight = average(rightGaps.length ? rightGaps : gaps);
  const symmetry =
    meanLeft + meanRight > 0
      ? 100 - (Math.abs(meanLeft - meanRight) / ((meanLeft + meanRight) / 2)) * 100
      : 0;
  const rcv = cvPercent(gaps);
  // 对外仍给「越大越好」的稳定度得分；门控等级仍按内部 rCV 判定
  const stabilityScore = clamp(100 - rcv * CV_SCORE_SCALE, 0, 100);

  return {
    sessionId,
    timestampMs: endMs,
    scale: { calibrated: false, method: "none" },
    metrics: {
      symmetry: makeMetric({
        key: "symmetry", label: "步态对称度", value: Number(symmetry.toFixed(1)), unit: "%",
        calibrated: false, confidence: 0.8,
        hint: "合成数值：左右平均步间隔差异",
        level: symmetry >= SYM_GREEN ? "green" : "yellow",
      }),
      stability: makeMetric({
        key: "stability", label: "步态稳定度", value: Number(stabilityScore.toFixed(1)), unit: "%",
        calibrated: false, confidence: 0.8,
        hint: "数值越大表示步频越稳定。",
        level: rcv <= CV_GREEN ? "green" : rcv <= CV_YELLOW ? "yellow" : "red",
      }),
      speed: makeMetric({
        key: "speed", label: "步行速度", value: null, unit: "m/s",
        calibrated: false, confidence: 0, hint: "尺度未标定，无法换算为公制单位",
      }),
      strideLength: makeMetric({
        key: "strideLength", label: "步幅", value: null, unit: "m",
        calibrated: false, confidence: 0, hint: "尺度未标定，无法换算为公制单位",
      }),
    },
  };
}

/** GaitCore 的假实现：无外部资源、确定性输出，可按需模拟失败 */
export class MockGaitCore implements GaitCore {
  private ready = false;
  private frameSeq = 0;

  /**
   * @param failReason 传入任一失败原因后，analyzeSession 恒定返回
   *                   { ok:false, reason, message }，用于测试失败分支
   */
  constructor(private readonly failReason?: AnalyzeFailureReason) {}

  async initPose(modelAssetUrl: string): Promise<void> {
    void modelAssetUrl; // 演示实现忽略模型地址
    this.ready = true;
  }

  async inferFrame(video: HTMLVideoElement, timestampMs: number): Promise<PoseFrame | null> {
    void video; // 不读取真实视频
    if (!this.ready) return null;
    this.frameSeq += 1;
    return generateFakeFrame(timestampMs, this.frameSeq);
  }

  async analyzeSession(
    sessionId: string,
    frames: PoseFrame[],
    history: ReportRecord[],
    scaleHint?: ScaleHint,
  ): Promise<AnalyzeResult> {
    void history;
    void scaleHint;

    // 显式指定失败：模拟测量失败分支（不落库、无分数）
    if (this.failReason) {
      return {
        ok: false,
        reason: this.failReason,
        message: FAIL_MESSAGE[this.failReason],
      };
    }

    const events = detectFakeHeelStrikes(frames);

    // 样本不足：与真实 core 一致，返回 insufficient-* 而非硬造假分
    if (frames.length === 0) {
      return { ok: false, reason: "insufficient-frames", message: FAIL_MESSAGE["insufficient-frames"] };
    }
    if (events.length < MIN_STRIKES) {
      return {
        ok: false,
        reason: "insufficient-main-metrics",
        message: FAIL_MESSAGE["insufficient-main-metrics"],
      };
    }

    const metrics = buildFakeMetrics(sessionId, frames, events);

    const alertLevel = metrics.metrics.symmetry.level === "red" ? "seekCare"
      : metrics.metrics.symmetry.level === "yellow" || metrics.metrics.stability.level === "yellow"
        ? "caution"
        : "normal";

    const conclusion: GaitConclusion = {
      overallScore: Math.round(metrics.metrics.symmetry.value ?? 0),
      alertLevel,
      summaryLine: "本次测量完成。",
      alerts:
        alertLevel === "seekCare"
          ? ["检测到明显左右差异或步态不稳定，建议尽快由医护人员评估。"]
          : [],
      disclaimer: SCREENING_DISCLAIMER,
      exercises: [],
    };

    // 合成数据模拟原地踏步（speed/stride 为 null）
    return { ok: true, metrics, conclusion, activityMode: "march" };
  }
}

/** 各失败原因对应的用户可读信息（与真实 core 文案口径一致） */
const FAIL_MESSAGE: Record<AnalyzeFailureReason, string> = {
  "insufficient-frames": "有效画面不足，无法分析步态。",
  "insufficient-main-metrics": "未能可靠算出步态对称度与步态稳定度。",
  "low-confidence": "多数动作置信度偏低，结果不可靠。",
};
