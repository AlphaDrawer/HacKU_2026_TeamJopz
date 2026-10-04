import type {
  AlertLevel,
  GaitConclusion,
  Metric,
  ReportRecord,
} from '../contracts/types'
import {
  SYM_SEVERE,
  SPEED_SEVERE,
  HISTORY_MIN_BASELINE,
  WORSEN_SYM_DROP_PP,
  SPEED_DECLINE_REL,
  LOW_CONFIDENCE_GATE,
  SCORE_WEIGHTS,
  SCORE_FULL,
  SCORE_FLOOR,
  SCORE_NEUTRAL,
  SPEED_SCORE_REF_MPS,
  SPEED_SCORE_FULL_MPS,
  STRIDE_SCORE_REF_M,
  STRIDE_SCORE_FULL_M,
  DISCLAIMER,
} from './constants'
import type { Exercise } from '../contracts/types'

/**
 * ruleEngine（§4.1 / §5.3）：把指标 + 个人历史 → 综合结论。
 *
 * 预警规则（满足任一即升级，受置信度约束）：
 *  1. 连续 2 次会话处于红（任意主指标 level=red）；
 *  2. 较个人基线加重：symmetry 较历史均值下降 ≥10pp；
 *  3. 步速连续下滑：本次速度较基线累计下降 ≥15%；
 *  4. 本次主指标单次严重异常（symmetry<60 / stability 内部 rCV 达红档
 *     （rCV>15）/ speed<0.5）。注：stability 对外 value 已是 0–100 得分，
 *     不再当 CV 使用，严重判定依据 level==='red'。
 * 低置信度（相关指标 confidence<0.55）时 MUST NOT 硬下 seekCare，
 * 最高只给 caution 并提示「结果不确定，建议重测」。常驻 disclaimer。
 * 纯函数（不查 DOM/DB；历史由调用方传入）。
 */

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

function metricScore(m: Metric): number {
  switch (m.key) {
    case 'symmetry':
      return m.value ?? 0
    case 'stability':
      // v1.2：value 本身就是 0–100 的稳定度得分（越大越好），直接返回
      return clamp(m.value ?? 0, 0, SCORE_FULL)
    case 'speed': {
      if (m.value == null) return SCORE_NEUTRAL
      // 0.6→40 … 1.2→100 的分段线性
      const span = SPEED_SCORE_FULL_MPS - SPEED_SCORE_REF_MPS
      return clamp(
        SCORE_FLOOR + ((m.value - SPEED_SCORE_REF_MPS) / span) * (SCORE_FULL - SCORE_FLOOR),
        0,
        SCORE_FULL
      )
    }
    case 'strideLength': {
      if (m.value == null) return SCORE_NEUTRAL
      const span = STRIDE_SCORE_FULL_M - STRIDE_SCORE_REF_M
      return clamp(
        SCORE_FLOOR + ((m.value - STRIDE_SCORE_REF_M) / span) * (SCORE_FULL - SCORE_FLOOR),
        0,
        SCORE_FULL
      )
    }
  }
}

export function compositeScore(metrics: {
  symmetry: Metric
  stability: Metric
  speed: Metric
  strideLength: Metric
}): number {
  const s =
    metricScore(metrics.symmetry) * SCORE_WEIGHTS.symmetry +
    metricScore(metrics.stability) * SCORE_WEIGHTS.stability +
    metricScore(metrics.speed) * SCORE_WEIGHTS.speed +
    metricScore(metrics.strideLength) * SCORE_WEIGHTS.strideLength
  return Math.round(clamp(s, 0, SCORE_FULL))
}

interface Flags {
  twoRed: boolean
  symWorsen: boolean
  speedDecline: boolean
  severeNow: boolean
  /** 各项「单次严重异常」命中情况（用于给出可指明原因的告警） */
  severeSym: boolean
  severeStability: boolean
  severeSpeed: boolean
  /** 触发 seekCare 的相关指标里是否存在低置信（用于 seekCare 门控） */
  lowConfTrigger: boolean
  /** 任意已测量指标是否低置信（仅用于 normal 档的「仅供参考」提示） */
  lowConfAny: boolean
}

function evaluateFlags(
  m: { symmetry: Metric; stability: Metric; speed: Metric; strideLength: Metric },
  history: ReportRecord[]
): Flags {
  const ordered = [...history].sort((a, b) => a.createdAtMs - b.createdAtMs)

  const redNowMetrics = [m.symmetry, m.stability, m.speed, m.strideLength].filter(
    (x) => x.level === 'red'
  )
  const redNow = redNowMetrics.length > 0
  const prev = ordered[ordered.length - 1]
  const prevRed = prev
    ? [
        prev.metrics.metrics.symmetry,
        prev.metrics.metrics.stability,
        prev.metrics.metrics.speed,
        prev.metrics.metrics.strideLength,
      ].some((x) => x.level === 'red')
    : false
  const twoRed = redNow && prevRed

  let symWorsen = false
  let speedDecline = false
  if (ordered.length >= HISTORY_MIN_BASELINE) {
    const symBase = mean(
      ordered.map((h) => h.metrics.metrics.symmetry.value).filter((v): v is number => v != null)
    )
    if (m.symmetry.value != null && Number.isFinite(symBase)) {
      symWorsen = symBase - m.symmetry.value >= WORSEN_SYM_DROP_PP
    }
    const spBase = mean(
      ordered.map((h) => h.metrics.metrics.speed.value).filter((v): v is number => v != null)
    )
    if (m.speed.value != null && Number.isFinite(spBase) && spBase > 0) {
      speedDecline = (spBase - m.speed.value) / spBase >= SPEED_DECLINE_REL
    }
  }

  // 各项「单次严重异常」命中（用于给出可指明原因的告警）
  const severeSym = m.symmetry.value != null && m.symmetry.value < SYM_SEVERE
  // stability：v1.2 起 value 是得分而非 CV，严重判定以 level==='red'（内部 rCV>15）为准
  const severeStability = m.stability.level === 'red'
  const severeSpeed = m.speed.value != null && m.speed.value < SPEED_SEVERE

  const severeNow = severeSym || severeStability || severeSpeed

  // 全局：任意已测量（level!=='none'）指标低置信 → normal 档加「仅供参考」
  const lowConfAny = [m.symmetry, m.stability, m.speed, m.strideLength].some(
    (x) => x.level !== 'none' && x.confidence < LOW_CONFIDENCE_GATE
  )

  // seekCare 门控只看「真正触发 seekCare 的指标」：
  //  - severeNow：命中严重阈值的指标（sym<60 / stability level=red / speed<0.5）；
  //  - twoRed：本次处于红的指标。
  // 一个与触发无关的指标低置信，不应压掉真实的严重预警。
  const severeTriggerMetrics: Metric[] = []
  if (severeSym) severeTriggerMetrics.push(m.symmetry)
  if (severeStability) severeTriggerMetrics.push(m.stability)
  if (severeSpeed) severeTriggerMetrics.push(m.speed)
  const seekTriggerMetrics = severeNow
    ? severeTriggerMetrics
    : twoRed
      ? redNowMetrics
      : []
  const lowConfTrigger = seekTriggerMetrics.some((x) => x.confidence < LOW_CONFIDENCE_GATE)

  return {
    twoRed,
    symWorsen,
    speedDecline,
    severeNow,
    severeSym,
    severeStability,
    severeSpeed,
    lowConfTrigger,
    lowConfAny,
  }
}

function alertFromFlags(f: Flags): AlertLevel {
  if (f.twoRed || f.severeNow) return 'seekCare'
  if (f.symWorsen || f.speedDecline) return 'caution'
  return 'normal'
}

function summaryFor(level: AlertLevel, score: number): string {
  if (level === 'seekCare') return `综合评分 ${score}，发现较明显的步态异常，建议尽快咨询专业人士。`
  if (level === 'caution') return `综合评分 ${score}，步态较以往有所变化，建议留意并安排复查。`
  return `综合评分 ${score}，本次步态表现整体平稳。`
}

export interface RuleInput {
  metrics: {
    symmetry: Metric
    stability: Metric
    speed: Metric
    strideLength: Metric
  }
  history: ReportRecord[]
  exercises: Exercise[]
}

export function buildConclusion(input: RuleInput): GaitConclusion {
  const f = evaluateFlags(input.metrics, input.history)
  const score = compositeScore(input.metrics)
  let level = alertFromFlags(f)

  const alerts: string[] = []
  if (f.twoRed) alerts.push('连续两次测量出现红色指标。')
  // 单次严重异常：分别指明是哪项，便于用户理解（步频/对称/速度）
  if (f.severeSym) alerts.push('左右对称度本次明显偏低。')
  if (f.severeStability) alerts.push('步频稳定性本次明显偏差。')
  if (f.severeSpeed) alerts.push('步行速度本次明显偏慢。')
  if (f.symWorsen) alerts.push('对称度较个人基线明显下降。')
  if (f.speedDecline) alerts.push('步行速度较个人基线有所减慢。')

  // 低置信度安全门：触发 seekCare 的相关指标置信不足时，禁止硬下 seekCare
  if (level === 'seekCare' && f.lowConfTrigger) {
    level = 'caution'
    alerts.push('部分关键数据置信度偏低，结论不确定，建议按指引重测后再判断。')
  }
  if (f.lowConfAny && level === 'normal') {
    alerts.push('部分数据置信度偏低，结果仅供参考。')
  }

  return {
    overallScore: score,
    alertLevel: level,
    summaryLine: summaryFor(level, score),
    alerts,
    disclaimer: DISCLAIMER,
    exercises: input.exercises,
  }
}
