import type {
  GaitCore,
  GaitMetrics,
  PoseFrame,
  ReportRecord,
  ScaleHint,
  ValidSegment,
} from '../contracts/types'
import * as pipeline from './posePipeline'
import { selectSegments, isMarchSession } from './segmentSelector'
import { detectEventsInSegment } from './eventDetector'
import { calibrateScale } from './scaleCalibrator'
import { computeMetrics } from './metricsCalculator'
import { adviseExercises } from './exerciseAdvisor'
import { buildConclusion } from './ruleEngine'
import {
  ANKLE_INDICES,
  MIN_SESSION_FRAMES,
  MIN_HEEL_STRIKES_PER_SIDE,
  SESSION_MIN_CONFIDENCE,
} from './constants'

/**
 * createGaitCore（§5.5）：算法层唯一总入口。
 *
 * analyzeSession 编排（全部为可单测的纯函数，除模型初始化）：
 *   帧 → 切段(中段匀速) → 每段检 heelStrike → 尺度校准
 *      → 四项指标(含左右踝可分诊断) → 动作推荐 → 规则结论(历史纵向)
 *
 * 诊断（不改冻结契约）：左右踝可分性在 metricsCalculator 内部计算，
 * 供真机 Spike 验证；如需导出可由调用方在测试中直接引用 computeMetrics。
 */
export function createGaitCore(): GaitCore {
  let modelUrl = ''

  return {
    async initPose(modelAssetUrl: string) {
      modelUrl = modelAssetUrl
      await pipeline.initPose(modelAssetUrl)
    },

    inferFrame(video: HTMLVideoElement, timestampMs: number) {
      return pipeline.inferFrame(video, timestampMs, modelUrl)
    },

    async analyzeSession(
      sessionId: string,
      frames: PoseFrame[],
      history: ReportRecord[],
      scaleHint?: ScaleHint
    ) {
      // 门控 1：帧数不足，无法代表一次走测（§3.2 测量失败）
      if (frames.length < MIN_SESSION_FRAMES) {
        return {
          ok: false as const,
          reason: 'insufficient-frames',
          message: '本次测量时间太短，请完成全程（踏步或行走）后再停止。',
        }
      }

      // 原地踏步无平移物理意义：判定为 march 后忽略任何尺度线索，
      // 强制 speed/stride 为 null（防止误传 height 导致 speed≈0 的假阳性就医预警）
      const marchSession = isMarchSession(frames)
      const effectiveScaleHint = marchSession ? undefined : scaleHint

      // 1) 切段：只保留侧面横走的中段匀速段
      const rawSegments: ValidSegment[] = selectSegments(frames)
      // 2) 每段检测左右 heelStrike（写入事件副本）
      const segments: ValidSegment[] = rawSegments.map((seg) => ({
        ...seg,
        events: detectEventsInSegment(frames, seg),
      }))

      const allEvents = segments.flatMap((s) => s.events)

      // 门控 2：两个主指标（symmetry/stability）依赖左右两侧各自的
      // heelStrike；任一侧击数不足 → 主指标算不出，禁止拼「整体平稳」。
      const countBySide = { left: 0, right: 0 }
      for (const e of allEvents) countBySide[e.side] += 1
      if (
        countBySide.left < MIN_HEEL_STRIKES_PER_SIDE ||
        countBySide.right < MIN_HEEL_STRIKES_PER_SIDE
      ) {
        return {
          ok: false as const,
          reason: 'insufficient-main-metrics',
          message: '本次没有检测到有效步态，请把手机放在斜侧30–45°位置，让双脚左右错开，稳定踏步或在小范围内来回走后重试。',
        }
      }

      // 门控 3：整体事件置信度过低（骨架断续/遮挡严重），数值不可信
      const meanConfidence =
        allEvents.reduce((sum, e) => sum + e.confidence, 0) / allEvents.length
      if (meanConfidence < SESSION_MIN_CONFIDENCE) {
        return {
          ok: false as const,
          reason: 'low-confidence',
          message: '本次画面骨架不够清晰，请确保光线充足、全身入镜后重走。',
        }
      }

      // 3) 尺度校准（height/step/manual 决定物理尺度；踏步会话强制无尺度）
      const scale = calibrateScale(frames, allEvents, effectiveScaleHint)

      // 4) 四项主指标 + 左右踝可分诊断
      const computed = computeMetrics(frames, segments, scale)
      const metricsBundle = {
        symmetry: computed.symmetry,
        stability: computed.stability,
        speed: computed.speed,
        strideLength: computed.strideLength,
      }

      // 兜底：主指标虽有事件支撑但计算仍返回空值（极端边界），同样判失败
      if (
        metricsBundle.symmetry.value === null ||
        metricsBundle.stability.value === null
      ) {
        return {
          ok: false as const,
          reason: 'insufficient-main-metrics',
          message: '本次未测到有效步态，请重新测量。',
        }
      }

      // 5) 康复动作推荐
      const exercises = adviseExercises(metricsBundle)

      // 6) 规则引擎：结合历史纵向基线给三档结论
      const conclusion = buildConclusion({ metrics: metricsBundle, history, exercises })

      // 时间戳取本次最后一帧的采样时间（确定性、可在 Node 稳定复现）
      const metrics: GaitMetrics = {
        sessionId,
        timestampMs: frames[frames.length - 1].timestampMs,
        scale,
        metrics: metricsBundle,
      }

      return {
        ok: true as const,
        metrics,
        conclusion,
        activityMode: marchSession ? 'march' : 'walk',
      }
    },
  }
}

// 对接点导出
export { ANKLE_INDICES }
export type { GaitDiagnostics } from './metricsCalculator'
