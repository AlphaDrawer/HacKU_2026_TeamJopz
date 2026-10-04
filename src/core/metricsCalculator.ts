import type {
  GaitCycle,
  GaitEvent,
  Metric,
  PoseFrame,
  ScaleInfo,
  ValidSegment,
} from '../contracts/types'
import {
  LEFT_ANKLE,
  RIGHT_ANKLE,
  LEFT_KNEE,
  VISIBILITY_THRESHOLD,
  DEFAULT_SHANK_RATIO,
  MAX_STEP_GAP_MS,
  MIN_ALTERNATING_STEP_GAP_MS,
  ANKLE_SEPARABLE_RATIO,
  SEPARABLE_PASS_RATIO,
  SYM_GREEN,
  SYM_YELLOW,
  CV_GREEN,
  CV_YELLOW,
  CV_SCORE_SCALE,
  SPEED_GREEN_MIN,
  SPEED_GREEN_MAX,
  SPEED_YELLOW_MIN,
  STRIDE_GREEN_MIN,
  STRIDE_GREEN_MAX,
  STRIDE_YELLOW_MIN,
  VIRTUAL_WIDTH_PX as W,
  VIRTUAL_HEIGHT_PX as H,
} from './constants'

/**
 * metricsCalculator（§4.1 / §5.3）：从带事件/周期的中段计算四项主指标。
 *
 *  - symmetry：时间域交替对称度 0–100（越大越好）。asym%=|meanL-meanR|/
 *    (meanL+meanR)*100，symmetry=100-asym%。
 *  - stability：左右交替步间隔的稳健变异系数 rCV%（MAD 估计）平均后换算
 *    成 0–100 稳定度得分（越大越好）；level 仍按内部 rCV% 判定，
 *    hint 注明「数值越大表示步频越稳定」。18s 样本下 MAD 不会被单个
 *    误检/错误着地高度拉偏（旧标准差 CV 会在 ~10%–80% 间剧烈跳变）。
 *  - speed：中段髋中心物理速度（m/s），仅在尺度校准时可信。
 *  - strideLength：同侧相邻重击间髋位移的物理步幅（m）。
 * 另输出内部诊断 GaitDiagnostics（左右踝可分性），不改契约。纯函数。
 */

export interface GaitDiagnostics {
  /** 双侧踝可见帧中，踝水平距/小腿长 ≥ 阈值的占比 */
  separableFrameRatio: number
  meanSeparationNorm: number
  bothAnkleVisibleRatio: number
  /** 视角可分性是否达标（§3.3 门控用） */
  separable: boolean
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length

/** 中位数（偶数个时取中间两值的算术平均，即标准中位数） */
export function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y)
  const n = s.length
  if (n === 0) return NaN
  const mid = Math.floor(n / 2)
  return n % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * 稳健变异系数 rCV%（基于 MAD）：
 *   med = median(a)，MAD = median(|v - med|)，
 *   rSD = 1.4826 * MAD，rCV% = rSD / med * 100。
 * 样本少于 2 个、或中位数 ≤ 0（无有效间隔）时返回 null。
 */
export function robustCvPercent(a: number[]): number | null {
  if (a.length < 2) return null
  const med = median(a)
  if (!(med > 0)) return null
  const mad = median(a.map((v) => Math.abs(v - med)))
  const rsd = 1.4826 * mad
  return (rsd / med) * 100
}

export function buildCycles(segments: ValidSegment[]): GaitCycle[] {
  const cycles: GaitCycle[] = []
  for (const seg of segments) {
    for (const side of ['left', 'right'] as const) {
      const ts = seg.events
        .filter((e) => e.type === 'heelStrike' && e.side === side)
        .map((e) => e.timestampMs)
      for (let i = 0; i < ts.length - 1; i++) {
        cycles.push({ side, startMs: ts[i], endMs: ts[i + 1], durationMs: ts[i + 1] - ts[i] })
      }
    }
  }
  return cycles
}

export function countStrikes(segments: ValidSegment[]): { left: number; right: number } {
  let left = 0
  let right = 0
  for (const seg of segments) {
    for (const e of seg.events) {
      if (e.type !== 'heelStrike') continue
      if (e.side === 'left') left++
      else right++
    }
  }
  return { left, right }
}

interface TimingResult {
  symmetry: number | null
  /** 左右两侧稳健变异系数 rCV% 的平均（越小越好） */
  rcv: number | null
  meanStepMs: number | null
  intervalsL: number[]
  intervalsR: number[]
}

function timing(segments: ValidSegment[]): TimingResult {
  // 交替步只在【单个切段内部】配对：段与段之间隔着转身/暂停，跨段的时间
  // 差不是步间隔，必须排除（旧版把跨段击合并排序后再配，会混入转身耗时）。
  const intervalsL: number[] = []
  const intervalsR: number[] = []
  let totalStrikes = 0
  for (const seg of segments) {
    const strikes = seg.events
      .filter((e) => e.type === 'heelStrike')
      .sort((a, b) => a.timestampMs - b.timestampMs)
    totalStrikes += strikes.length
    for (let i = 1; i < strikes.length; i++) {
      if (strikes[i].side === strikes[i - 1].side) continue // 仅异侧相邻才算交替步
      const gap = strikes[i].timestampMs - strikes[i - 1].timestampMs
      if (gap <= 0 || gap > MAX_STEP_GAP_MS) continue
      // 下界保护：小于 200ms 的交替间隔生理上不可能，按误检剔除
      if (gap < MIN_ALTERNATING_STEP_GAP_MS) continue
      if (strikes[i].side === 'left') intervalsL.push(gap)
      else intervalsR.push(gap)
    }
  }
  if (totalStrikes < 4) {
    return { symmetry: null, rcv: null, meanStepMs: null, intervalsL, intervalsR }
  }
  if (intervalsL.length < 2 || intervalsR.length < 2) {
    return { symmetry: null, rcv: null, meanStepMs: null, intervalsL, intervalsR }
  }

  const mL = mean(intervalsL)
  const mR = mean(intervalsR)
  const asymPct = (Math.abs(mL - mR) / (mL + mR)) * 100
  const symmetry = Math.max(0, 100 - asymPct)

  // 稳健离散度（MAD）：对每侧独立计算 rCV%，再取两侧均值
  const rcvL = robustCvPercent(intervalsL)
  const rcvR = robustCvPercent(intervalsR)
  const rcvAvg = rcvL !== null && rcvR !== null ? (rcvL + rcvR) / 2 : null

  return { symmetry, rcv: rcvAvg, meanStepMs: mean([...intervalsL, ...intervalsR]), intervalsL, intervalsR }
}

const hipX = (f: PoseFrame) => ((f.landmarks[23].x + f.landmarks[24].x) / 2) * W

/** 中段物理速度（m/s）：每段 |髋位移| / 时长，再按时长加权平均 */
function physicalSpeed(
  frames: PoseFrame[],
  segments: ValidSegment[],
  ppm: number | undefined
): number | null {
  if (!ppm || ppm <= 0) return null
  let dist = 0
  let durMs = 0
  for (const seg of segments) {
    const inSeg = frames.filter((f) => f.timestampMs >= seg.startMs && f.timestampMs <= seg.endMs)
    const first = inSeg[0]
    const last = inSeg[inSeg.length - 1]
    if (!first || !last) continue
    dist += Math.abs(hipX(last) - hipX(first)) / ppm
    durMs += last.timestampMs - first.timestampMs
  }
  return durMs > 0 ? dist / (durMs / 1000) : null
}

/** 物理步幅（m）：同侧相邻重击间髋位移 / ppm，取中位 */
function physicalStride(
  frames: PoseFrame[],
  segments: ValidSegment[],
  ppm: number | undefined
): number | null {
  if (!ppm || ppm <= 0) return null
  const byT = new Map(frames.map((f) => [f.timestampMs, f]))
  const vals: number[] = []
  for (const seg of segments) {
    for (const side of ['left', 'right'] as const) {
      const ts = seg.events
        .filter((e) => e.type === 'heelStrike' && e.side === side)
        .map((e) => e.timestampMs)
        .sort((a, b) => a - b)
      for (let i = 1; i < ts.length; i++) {
        const a = byT.get(ts[i])
        const b = byT.get(ts[i - 1])
        if (!a || !b) continue
        const d = Math.abs(hipX(a) - hipX(b)) / ppm
        if (d > 0) vals.push(d)
      }
    }
  }
  vals.sort((x, y) => x - y)
  return vals.length ? vals[Math.floor(vals.length / 2)] : null
}

function levelSym(v: number | null): Metric['level'] {
  if (v == null) return 'none'
  if (v >= SYM_GREEN) return 'green'
  if (v >= SYM_YELLOW) return 'yellow'
  return 'red'
}
function levelCv(v: number | null): Metric['level'] {
  if (v == null) return 'none'
  if (v <= CV_GREEN) return 'green'
  if (v <= CV_YELLOW) return 'yellow'
  return 'red'
}
function levelSpeed(v: number | null): Metric['level'] {
  if (v == null) return 'none'
  if (v >= SPEED_GREEN_MIN && v <= SPEED_GREEN_MAX) return 'green'
  if (v >= SPEED_YELLOW_MIN) return 'yellow'
  return 'red'
}
function levelStride(v: number | null): Metric['level'] {
  if (v == null) return 'none'
  if (v >= STRIDE_GREEN_MIN && v <= STRIDE_GREEN_MAX) return 'green'
  if (v >= STRIDE_YELLOW_MIN) return 'yellow'
  return 'red'
}

function avgConfidence(events: GaitEvent[]): number {
  return events.length ? mean(events.map((e) => e.confidence)) : 0
}

export interface ComputedMetrics {
  symmetry: Metric
  stability: Metric
  speed: Metric
  strideLength: Metric
  diagnostics: GaitDiagnostics
  cycles: GaitCycle[]
}

/** 左右踝可分性诊断（§3.3），内部输出供真机验证 */
function separation(frames: PoseFrame[], segments: ValidSegment[]): GaitDiagnostics {
  const bounds = segments.map((s) => [s.startMs, s.endMs])
  const inMid = (t: number) => bounds.some(([a, b]) => t >= a && t <= b)
  let n = 0
  let both = 0
  let separable = 0
  let sepSum = 0
  for (const f of frames) {
    if (!inMid(f.timestampMs)) continue
    n++
    const la = f.landmarks[LEFT_ANKLE]
    const ra = f.landmarks[RIGHT_ANKLE]
    if (la.visibility < VISIBILITY_THRESHOLD || ra.visibility < VISIBILITY_THRESHOLD) continue
    both++
    let shank = H * DEFAULT_SHANK_RATIO
    const lk = f.landmarks[LEFT_KNEE]
    if (lk.visibility >= VISIBILITY_THRESHOLD) {
      shank = Math.max(1, Math.hypot((lk.x - la.x) * W, (lk.y - la.y) * H))
    }
    const sepNorm = (Math.abs(la.x - ra.x) * W) / shank
    sepSum += sepNorm
    if (sepNorm >= ANKLE_SEPARABLE_RATIO) separable++
  }
  const ratio = both > 0 ? separable / both : 0
  return {
    separableFrameRatio: ratio,
    meanSeparationNorm: both > 0 ? sepSum / both : 0,
    bothAnkleVisibleRatio: n > 0 ? both / n : 0,
    separable: ratio >= SEPARABLE_PASS_RATIO,
  }
}

export function computeMetrics(
  frames: PoseFrame[],
  segments: ValidSegment[],
  scale: ScaleInfo
): ComputedMetrics {
  const cycles = buildCycles(segments)
  const t = timing(segments)
  const ppm = scale.pixelsPerMeter
  const sp = physicalSpeed(frames, segments, scale.calibrated ? ppm : undefined)
  const st = physicalStride(frames, segments, scale.calibrated ? ppm : undefined)
  const conf = avgConfidence(segments.flatMap((s) => s.events))

  const calibrated = scale.calibrated
  const symmetry: Metric = {
    key: 'symmetry',
    label: '步态对称度',
    value: t.symmetry,
    unit: '%',
    level: levelSym(t.symmetry),
    calibrated: true,
    confidence: conf,
    hint: '基于左右交替步的时间；数值越大越对称。',
  }
  const stability: Metric = {
    key: 'stability',
    label: '步态稳定度',
    // 对外为 0–100 稳定度得分（越大越好）：100 - rCV*4，截断到 0..100
    value:
      t.rcv === null
        ? null
        : Math.max(0, Math.min(100, 100 - t.rcv * CV_SCORE_SCALE)),
    unit: '%',
    // level 仍按内部 rCV% 判定，保持门控/医疗语义不变
    level: levelCv(t.rcv),
    calibrated: true,
    confidence: conf,
    hint: '数值越大表示步频越稳定。',
  }
  const speed: Metric = {
    key: 'speed',
    label: '步行速度',
    value: calibrated ? sp : null,
    unit: 'm/s',
    level: calibrated ? levelSpeed(sp) : 'none',
    calibrated,
    confidence: scale.confidence ?? 0,
    hint: calibrated ? '有效测量段的平均速度。' : '未完成尺度校准，无法给出物理速度。',
  }
  const strideLength: Metric = {
    key: 'strideLength',
    label: '步幅',
    value: calibrated ? st : null,
    unit: 'm',
    level: calibrated ? levelStride(st) : 'none',
    calibrated,
    confidence: scale.confidence ?? 0,
    hint: calibrated ? '同侧相邻跟着地之间的位移。' : '未完成尺度校准，无法给出物理步幅。',
  }

  return {
    symmetry,
    stability,
    speed,
    strideLength,
    diagnostics: separation(frames, segments),
    cycles,
  }
}
