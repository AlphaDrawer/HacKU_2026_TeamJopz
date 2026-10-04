/**
 * measurementSession.ts（单次测量会话编排器）
 * ------------------------------------------------------------------
 * 只做流程编排、不做渲染，也【绝不自行推算临床数值】：
 *   1) core.initPose(modelUrl) 初始化模型
 *   2) 倒计时
 *   3) 主循环周期性 core.inferFrame 取帧（null = 本帧无姿态，仅计数）
 *   4) 到时读取历史 → core.analyzeSession 得 AnalyzeResult（契约 §9）：
 *        · { ok:true,  metrics, conclusion } → 有效才落库 → onDone
 *        · { ok:false, reason, message }     → 绝不落库、绝不显示分数
 *                                              → onFail（UI 引导重走）
 *   5) 收紧的落库守卫：symmetry / stability 两主指标 value 均为有限数才 save
 *
 * 视图通过回调更新画面，流程与渲染解耦。
 */
import type {
  ActivityMode,
  AnalyzeFailureReason,
  SessionDebugInfo,
  GaitCore,
  GaitMetrics,
  PoseFrame,
  ReportRecord,
  ReportStore,
  ScaleHint,
} from "../contracts/types";
import { newSessionId } from "../domain/report";
import { COUNTDOWN_SEC, LOOP_INTERVAL_MS, MEASUREMENT_DURATION_SEC } from "./constants";

/** 一次测量失败的结构化信息（供 UI 用大白话提示 + 重走入口） */
export interface SessionFailure {
  reason: AnalyzeFailureReason;
  message: string;
  /** v1.3 可选只读诊断（来自 analyzeSession 失败分支） */
  debug?: SessionDebugInfo;
}

export interface SessionCallbacks {
  onCountdown?(remain: number): void;
  onTick?(elapsedSec: number, totalSec: number): void;
  /** 每得到一帧有效姿态（null 帧不触发） */
  onFrame?(frame: PoseFrame): void;
  /** 无效帧计数变化（诊断用） */
  onMissing?(missingCount: number): void;
  onError?(error: unknown): void;
  /** 测量成功且已通过落库守卫（可能已落库） */
  onDone?(record: ReportRecord): void;
  /** 测量失败：不落库、无分数，UI 应提示重走 */
  onFail?(failure: SessionFailure): void;
}

/** 把 core 的 {metrics, conclusion} 与装配信息组合为落库报告 */
export function assembleRecord(
  sessionId: string,
  createdAtMs: number,
  durationSec: number,
  metrics: ReportRecord["metrics"],
  conclusion: ReportRecord["conclusion"],
  activityMode: ActivityMode,
): ReportRecord {
  return { sessionId, createdAtMs, durationSec, activityMode, metrics, conclusion };
}

/**
 * 收紧的落库守卫（B-1）：只有 symmetry 与 stability 两个时间量主指标
 * 都拿到【有限数】才允许落库。任一为 null / NaN / Infinity 都视为本次没测准，
 * 不污染历史与趋势。物理量 speed/strideLength 未标定时允许为 null，不参与守卫。
 */
export function hasMainMetrics(metrics: GaitMetrics): boolean {
  const { symmetry, stability } = metrics.metrics;
  return (
    symmetry.value !== null &&
    Number.isFinite(symmetry.value) &&
    stability.value !== null &&
    Number.isFinite(stability.value)
  );
}

export class MeasurementSession {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly frames: PoseFrame[] = [];
  private missingCount = 0;
  private running = false;
  private sessionId = "";

  constructor(
    private readonly core: GaitCore,
    private readonly store: ReportStore,
    private readonly video: HTMLVideoElement,
    private readonly modelUrl: string,
    private readonly callbacks: SessionCallbacks = {},
    /** 用户身高（厘米）；null/undefined = 不提供身高，按未校准处理 */
    private readonly heightCm: number | null = null,
  ) {}

  async start(): Promise<boolean> {
    if (this.running) return false;
    try {
      await this.core.initPose(this.modelUrl);

      for (let remain = COUNTDOWN_SEC; remain > 0; remain -= 1) {
        this.callbacks.onCountdown?.(remain);
        await wait(1000);
      }
      this.callbacks.onCountdown?.(0);

      this.running = true;
      this.sessionId = newSessionId();
      const startedAt = Date.now();
      await this.collect(startedAt);
      await this.finish(startedAt);
      return true;
    } catch (error) {
      this.callbacks.onError?.(error);
      return false;
    }
  }

  private collect(startedAt: number): Promise<void> {
    const totalMs = MEASUREMENT_DURATION_SEC * 1000;
    return new Promise((resolve) => {
      this.timer = setInterval(() => {
        const elapsedMs = Date.now() - startedAt;
        this.callbacks.onTick?.(
          Math.min(Math.floor(elapsedMs / 1000), MEASUREMENT_DURATION_SEC),
          MEASUREMENT_DURATION_SEC,
        );

        void this.core
          .inferFrame(this.video, elapsedMs)
          .then((frame) => {
            if (frame === null) {
              this.missingCount += 1;
              this.callbacks.onMissing?.(this.missingCount);
              return;
            }
            this.frames.push(frame);
            this.callbacks.onFrame?.(frame);
          })
          .catch(() => {
            // 单帧推理异常：按丢帧处理，不打断主循环
            this.missingCount += 1;
            this.callbacks.onMissing?.(this.missingCount);
          });

        if (elapsedMs >= totalMs) {
          this.clearTimer();
          resolve();
        }
      }, LOOP_INTERVAL_MS);
    });
  }

  private async finish(startedAt: number): Promise<void> {
    // 读取历史（升序），供规则引擎做纵向基线
    const history = await this.store.getAll();

    // 尺度提示：用户填了合法身高时按 height 校准（米）；否则不做物理标定。
    // 注意：即使传了身高，算法层在判定为原地踏步时仍会强制忽略尺度线索，
    // speed/stride 保持 null（见 core/index.ts）。
    const scaleHint: ScaleHint =
      this.heightCm !== null && this.heightCm > 0
        ? { method: "height", referenceLengthM: this.heightCm / 100 }
        : { method: "none" };

    const result = await this.core.analyzeSession(
      this.sessionId,
      this.frames,
      history,
      scaleHint,
    );

    this.running = false;

    // 契约 §9：测量失败 → 绝不落库、绝不给分，直接回调 onFail 引导重走
    if (!result.ok) {
      this.callbacks.onFail?.({
        reason: result.reason,
        message: result.message,
        debug: result.debug,
      });
      return;
    }

    const { metrics, conclusion, activityMode } = result;
    const durationSec = Math.round((Date.now() - startedAt) / 1000);
    const record = assembleRecord(
      this.sessionId,
      startedAt,
      durationSec,
      metrics,
      conclusion,
      activityMode,
    );

    // 收紧守卫：两主指标均为有限数才落库；否则按「没测准」处理，不落库
    if (hasMainMetrics(metrics)) {
      await this.store.save(record);
      this.callbacks.onDone?.(record);
    } else {
      this.callbacks.onFail?.({
        reason: "insufficient-main-metrics",
        message: "本次未能得到可靠的步态对称度与步态稳定度结果。",
      });
    }
  }

  cancel(): void {
    this.clearTimer();
    this.running = false;
  }

  private clearTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
