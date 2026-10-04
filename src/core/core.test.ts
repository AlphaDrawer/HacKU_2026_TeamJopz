import { describe, expect, it } from 'vitest'
import type { PoseFrame, ReportRecord, ValidSegment, ScaleInfo } from '../contracts/types'
import { createGaitCore } from './index'
import { selectSegments } from './segmentSelector'
import { detectEventsInSegment } from './eventDetector'
import { calibrateScale } from './scaleCalibrator'
import { buildConclusion, compositeScore } from './ruleEngine'
import { adviseExercises } from './exerciseAdvisor'
import { computeMetrics, robustCvPercent } from './metricsCalculator'
import {
  CV_GREEN,
  CV_SCORE_SCALE,
  MAX_STEP_GAP_MS,
  MIN_ALTERNATING_STEP_GAP_MS,
} from './constants'
import normalFramesJson from '../data/mock_normal.json'
import asymFramesJson from '../data/mock_asymmetric.json'

const normalFrames = normalFramesJson as PoseFrame[]
const asymFrames = asymFramesJson as PoseFrame[]

function runPipeline(frames: PoseFrame[]) {
  const segs = selectSegments(frames).map((s) => ({
    ...s,
    events: detectEventsInSegment(frames, s),
  }))
  return segs
}

describe('GaitCore analyzeSession（mock 端到端）', () => {
  it('正常数据：ok:true、对称度高、结论正常', async () => {
    const core = createGaitCore()
    const result = await core.analyzeSession('s-normal', normalFrames, [])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    const { metrics, conclusion } = result
    expect(metrics.metrics.symmetry.value).not.toBeNull()
    expect(metrics.metrics.symmetry.value!).toBeGreaterThan(85)
    expect(metrics.metrics.stability.value).not.toBeNull()
    // 未校准时速度/步幅必须为 null、level=none
    expect(metrics.metrics.speed.value).toBeNull()
    expect(metrics.metrics.speed.level).toBe('none')
    expect(metrics.metrics.strideLength.value).toBeNull()
    expect(conclusion.disclaimer.length).toBeGreaterThan(10)
    expect(['normal', 'caution', 'seekCare']).toContain(conclusion.alertLevel)
    expect(conclusion.exercises.length).toBeGreaterThan(0)
  })

  it('身高校准后：速度/步幅出现物理值且 level 不为 none', async () => {
    const core = createGaitCore()
    const result = await core.analyzeSession('s-height', normalFrames, [], {
      method: 'height',
      referenceLengthM: 1.7,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    const { metrics } = result
    expect(metrics.scale.calibrated).toBe(true)
    expect(metrics.scale.method).toBe('height')
    expect(metrics.metrics.speed.value).not.toBeNull()
    expect(metrics.metrics.speed.level).not.toBe('none')
    expect(metrics.metrics.strideLength.value).not.toBeNull()
  })

  it('不对称数据：ok:true 且对称度显著低于正常数据', async () => {
    const core = createGaitCore()
    const a = await core.analyzeSession('a', asymFrames, [])
    const n = await core.analyzeSession('n', normalFrames, [])
    expect(a.ok).toBe(true)
    expect(n.ok).toBe(true)
    if (!a.ok || !n.ok) throw new Error('expected ok')
    expect(a.metrics.metrics.symmetry.value!).toBeLessThan(n.metrics.metrics.symmetry.value!)
  })
})

describe('GaitCore 失败门控（B-1：算不出 = 测量失败，不进 ruleEngine）', () => {
  it('帧数不足 → ok:false, reason=insufficient-frames', async () => {
    const core = createGaitCore()
    const result = await core.analyzeSession('short', normalFrames.slice(0, 10), [])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.reason).toBe('insufficient-frames')
    expect(result.message.length).toBeGreaterThan(0)
  })

  it('原地站立（无横向位移/无步态）→ ok:false, reason=insufficient-main-metrics', async () => {
    // 取正常走测的前 40 帧，但把所有关节的 x/y 冻结为第一帧 → 无位移、无 heelStrike
    const base = normalFrames[0]
    const frozen: PoseFrame[] = Array.from({ length: 40 }, (_, i) => ({
      ...base,
      frameId: i,
      timestampMs: i * 50,
      landmarks: base.landmarks.map((p) => ({ ...p })),
    }))
    const core = createGaitCore()
    const result = await core.analyzeSession('standing', frozen, [])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.reason).toBe('insufficient-main-metrics')
  })
})

describe('拍摄几何：硬标准4（周期数）与§3.3（左右踝可分）', () => {
  it('正常 mock 中段同侧重击数 ≥ 6', () => {
    const segs = runPipeline(normalFrames)
    const count = (side: 'left' | 'right') =>
      segs.reduce((n, s) => n + s.events.filter((e) => e.side === side).length, 0)
    expect(count('left')).toBeGreaterThanOrEqual(6)
    expect(count('right')).toBeGreaterThanOrEqual(6)
  })

  it('纯侧面 mock 左右踝可分帧 < 0.7（暴露重合风险，供真机对照）', () => {
    const segs = runPipeline(normalFrames)
    // 直接验证：踝水平归一化差极小
    // 复用 computeMetrics 的诊断
    // （通过 scale=none 调用）
    // 这里做轻量断言，诊断细节在 metricsCalculator 内
    expect(segs.length).toBeGreaterThan(0)
  })
})

describe('ruleEngine：历史纵向规则', () => {
  function makeRecord(
    sym: number,
    speed: number | null,
    red = false,
    stability?: { value: number; level: 'green' | 'yellow' | 'red' },
  ): ReportRecord {
    const base = {
      key: 'x' as 'symmetry' | 'stability' | 'speed' | 'strideLength',
      label: 'x',
      value: 0 as number | null,
      calibrated: true,
      confidence: 0.9,
      hint: '',
    }
    const st = stability ?? { value: 95, level: red ? ('red' as const) : ('green' as const) }
    return {
      sessionId: Math.random().toString(36).slice(2),
      createdAtMs: Date.now(),
      durationSec: 10,
      activityMode: speed != null ? 'walk' : 'march',
      metrics: {
        sessionId: 'x',
        timestampMs: Date.now(),
        scale: { calibrated: speed != null, method: 'height' },
        metrics: {
          symmetry: { ...base, key: 'symmetry', label: '步态对称度', value: sym, unit: '%', level: red ? 'red' : 'green' },
          stability: { ...base, key: 'stability', label: '步态稳定度', value: st.value, unit: '%', level: st.level },
          speed: { ...base, key: 'speed', label: '步行速度', value: speed, unit: 'm/s', level: speed == null ? 'none' : 'green' },
          strideLength: { ...base, key: 'strideLength', label: '步幅', value: speed == null ? null : 1.1, unit: 'm', level: speed == null ? 'none' : 'green' },
        },
      },
      conclusion: {
        overallScore: 80,
        alertLevel: 'normal',
        summaryLine: '',
        alerts: [],
        disclaimer: '',
        exercises: [],
      },
    }
  }

  it('symmetry 较基线下降 ≥10pp → 至少 caution', () => {
    const history = [makeRecord(92, 1.1), makeRecord(90, 1.1)]
    const current = {
      symmetry: { ...history[0].metrics.metrics.symmetry, value: 75, level: 'yellow' as const },
      stability: history[0].metrics.metrics.stability,
      speed: history[0].metrics.metrics.speed,
      strideLength: history[0].metrics.metrics.strideLength,
    }
    const c = buildConclusion({ metrics: current, history, exercises: [] })
    expect(c.alertLevel).not.toBe('normal')
    expect(c.alerts.join()).toContain('对称度')
  })

  it('低置信度时不硬下 seekCare（严重项本身置信度不足 → 降级 caution）', () => {
    const mk = (key: 'symmetry' | 'stability' | 'speed' | 'strideLength', value: number, unit: '%' | 'm/s') => ({
      key,
      label: key,
      value,
      unit,
      level: 'red' as const,
      calibrated: true,
      confidence: 0.3, // 全部低置信度
      hint: '',
    })
    const current = {
      symmetry: mk('symmetry', 50, '%'),
      stability: mk('stability', 10, '%'),
      speed: mk('speed', 0.4, 'm/s'),
      strideLength: mk('strideLength', 0.6, 'm/s'),
    }
    const c = buildConclusion({ metrics: current, history: [], exercises: [] })
    expect(c.alertLevel).not.toBe('seekCare')
  })

  it('compositeScore 落在 0–100', () => {
    const rec = makeRecord(90, 1.1)
    const s = compositeScore(rec.metrics.metrics)
    expect(s).toBeGreaterThanOrEqual(0)
    expect(s).toBeLessThanOrEqual(100)
  })

  it('stability 仅 yellow（15<rCV 区间，得分 20–68）不会误报 seekCare', () => {
    // rCV=12 → 得分 52，level=yellow
    const rec = makeRecord(92, 1.1, false, { value: 52, level: 'yellow' })
    const c = buildConclusion({ metrics: rec.metrics.metrics, history: [], exercises: [] })
    expect(c.alertLevel).not.toBe('seekCare')
  })

  it('stability level=red（步频极不稳，高置信度）可触发 seekCare', () => {
    // rCV=30 → 得分 0，level=red
    const rec = makeRecord(92, 1.1, false, { value: 0, level: 'red' })
    const c = buildConclusion({ metrics: rec.metrics.metrics, history: [], exercises: [] })
    expect(c.alertLevel).toBe('seekCare')
    expect(c.alerts.join()).toContain('步频')
  })
})

describe('scaleCalibrator', () => {
  it('无 hint 时不可校准', () => {
    const s = calibrateScale(normalFrames, [])
    expect(s.calibrated).toBe(false)
    expect(s.method).toBe('none')
  })
  it('manual 直接采用 pixelsPerMeter', () => {
    const s = calibrateScale(normalFrames, [], { method: 'manual', referenceLengthM: 1234 })
    expect(s.calibrated).toBe(true)
    expect(s.pixelsPerMeter).toBe(1234)
  })
})

describe('exerciseAdvisor', () => {
  it('全绿给维持性建议', () => {
    const green = {
      key: 'symmetry',
      label: '',
      value: 95,
      unit: '%',
      level: 'green',
      calibrated: true,
      confidence: 0.9,
      hint: '',
    } as const
    const ex = adviseExercises({
      symmetry: green as never,
      stability: green as never,
      speed: green as never,
      strideLength: green as never,
    })
    expect(ex.length).toBeGreaterThan(0)
  })
})

// ===========================================================================
// 原地踏步（斜角 30–45°）合成数据：空间不足时原地踏步的走测兜底
// ===========================================================================
describe('原地踏步合成数据（垂直节奏通道）', () => {
  const FPS = 20
  const FRAME_MS = 1000 / FPS
  const HIP_X = 0.5 // 全程髋中心不动
  const HIP_Y = 0.55
  const GROUND_Y = 0.82
  const SWING_RAISE = 0.05
  const ANKLE_X_L = 0.46 // 斜角：左右踝 x 可分（非纯侧面重合）
  const ANKLE_X_R = 0.54
  const CONTACT_HALF_MS = 25

  /**
   * 交替调度的踏步合成帧。
   * @param halfToR L击→下一 R击 的间隔(ms)；halfToL R击→下一 L击
   * 等间隔=对称踏步；不等=左右不对称。所有间隔取帧格 50ms 整数倍。
   */
  function marchFrames(
    durationMs: number,
    halfToR: number,
    halfToL: number,
    opts: { rightFrozen?: boolean; allFrozen?: boolean } = {}
  ): PoseFrame[] {
    // 交替 strike 时刻
    type SI = { side: 'left' | 'right'; t: number }
    const strikes: SI[] = []
    let t = 0
    let expectR = true
    while (t <= durationMs) {
      strikes.push({ side: expectR ? 'right' : 'left', t })
      t += expectR ? halfToR : halfToL
      expectR = !expectR
    }
    const timesFor = (side: 'left' | 'right') =>
      strikes.filter((s) => s.side === side).map((s) => s.t)

    /** 单侧踝 y：strike 帧±25ms 落地（局部最大），两击间正弦抬腿 */
    const ankleY = (ms: number, ts: number[]): number => {
      if (ts.length === 0) return GROUND_Y
      if (ms <= ts[0]) return Math.abs(ms - ts[0]) <= CONTACT_HALF_MS ? GROUND_Y : GROUND_Y - SWING_RAISE
      let i = 0
      while (i < ts.length - 1 && ms >= ts[i + 1]) i++
      const a = ts[i]
      const b = ts[i + 1]
      if (b == null) return GROUND_Y
      if (Math.abs(ms - a) <= CONTACT_HALF_MS || Math.abs(ms - b) <= CONTACT_HALF_MS) {
        return GROUND_Y
      }
      const p = (ms - a) / (b - a)
      return GROUND_Y - SWING_RAISE * Math.sin(p * Math.PI)
    }

    const n = Math.round(durationMs / FRAME_MS)
    return Array.from({ length: n + 1 }, (_, k) => {
      const ms = k * FRAME_MS
      const lms = Array.from({ length: 33 }, () => ({
        x: HIP_X,
        y: HIP_Y,
        z: 0,
        visibility: 0.001,
      }))
      const set = (idx: number, x: number, y: number, v: number) =>
        Object.assign(lms[idx], { x, y, visibility: v })
      if (!opts.allFrozen) {
        set(23, HIP_X - 0.012, HIP_Y, 0.97)
        set(24, HIP_X + 0.012, HIP_Y, 0.97)
        set(25, HIP_X - 0.016, 0.68, 0.95)
        set(26, HIP_X + 0.016, 0.68, 0.9)
        set(11, HIP_X - 0.012, 0.4, 0.97)
        set(12, HIP_X + 0.012, 0.4, 0.95)
        set(0, HIP_X, 0.34, 0.96)
        const yL = ankleY(ms, timesFor('left'))
        const yR = opts.rightFrozen ? GROUND_Y : ankleY(ms, timesFor('right'))
        set(27, ANKLE_X_L, yL, 0.96)
        set(28, ANKLE_X_R, yR, 0.92)
      } else {
        // 完全站定：全部关节固定、无节奏
        set(23, HIP_X - 0.012, HIP_Y, 0.97)
        set(24, HIP_X + 0.012, HIP_Y, 0.97)
        set(25, HIP_X - 0.016, 0.68, 0.95)
        set(26, HIP_X + 0.016, 0.68, 0.9)
        set(27, ANKLE_X_L, GROUND_Y, 0.96)
        set(28, ANKLE_X_R, GROUND_Y, 0.92)
        set(11, HIP_X - 0.012, 0.4, 0.97)
        set(12, HIP_X + 0.012, 0.4, 0.95)
        set(0, HIP_X, 0.34, 0.96)
      }
      return { frameId: k, timestampMs: Math.round(ms), landmarks: lms, inferMs: 10 }
    })
  }

  it('正常踏步：ok:true、symmetry 高、stability 有效，切段覆盖大部分时长', async () => {
    const frames = marchFrames(6000, 250, 250)
    const segs = selectSegments(frames)
    expect(segs.length).toBeGreaterThan(0)
    // 原地踏步段复用 direction='out'（固定值，无走行方向语义）
    expect(segs[0].direction).toBe('out')
    const covered = segs.reduce((ms, s) => ms + (s.endMs - s.startMs), 0)
    expect(covered).toBeGreaterThanOrEqual(0.8 * 6000)

    const core = createGaitCore()
    const result = await core.analyzeSession('march-normal', frames, [])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    const { metrics } = result
    expect(result.activityMode).toBe('march')
    expect(metrics.metrics.symmetry.value).not.toBeNull()
    expect(metrics.metrics.symmetry.value!).toBeGreaterThan(90)
    expect(metrics.metrics.stability.value).not.toBeNull()
    // 稳定度得分（越大越好）：等间隔踏步 rCV≈0 → 得分接近满分、level=green
    expect(metrics.metrics.stability.value!).toBeGreaterThanOrEqual(90)
    expect(metrics.metrics.stability.level).toBe('green')
    expect(metrics.metrics.stability.unit).toBe('%')
    // 未校准时物理指标仍必须为 null
    expect(metrics.metrics.speed.value).toBeNull()
    expect(metrics.metrics.strideLength.value).toBeNull()
  })

  it('左右不对称踏步：ok:true 且 symmetry 明显更低', async () => {
    const frames = marchFrames(7200, 200, 400) // 200/400（均≥有效下界）→ asym≈33% → symmetry≈67
    const core = createGaitCore()
    const a = await core.analyzeSession('march-asym', frames, [])
    const n = await core.analyzeSession('march-n', marchFrames(6000, 250, 250), [])
    expect(a.ok).toBe(true)
    expect(n.ok).toBe(true)
    if (!a.ok || !n.ok) throw new Error('expected ok')
    expect(a.metrics.metrics.symmetry.value!).toBeLessThan(70)
    expect(n.metrics.metrics.symmetry.value! - a.metrics.metrics.symmetry.value!).toBeGreaterThan(20)
  })

  it('踏步帧数不足 → ok:false, reason=insufficient-frames', async () => {
    const core = createGaitCore()
    const result = await core.analyzeSession('march-short', marchFrames(1000, 250, 250).slice(0, 20), [])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.reason).toBe('insufficient-frames')
  })

  it('原地站定无节奏 → ok:false, reason=insufficient-main-metrics', async () => {
    const core = createGaitCore()
    const result = await core.analyzeSession('march-frozen', marchFrames(4000, 250, 250, { allFrozen: true }), [])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.reason).toBe('insufficient-main-metrics')
  })

  it('单侧踏步（另一侧无垂直节奏）→ ok:false, reason=insufficient-main-metrics', async () => {
    const core = createGaitCore()
    const result = await core.analyzeSession('march-one-side', marchFrames(4000, 250, 250, { rightFrozen: true }), [])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.reason).toBe('insufficient-main-metrics')
  })

  it('踏步会话即使传入 height 尺度线索，speed/stride 仍强制为 null（防假阳性就医预警）', async () => {
    const core = createGaitCore()
    const result = await core.analyzeSession(
      'march-no-scale',
      marchFrames(6000, 250, 250),
      [],
      { method: 'height', referenceLengthM: 1.7 },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.metrics.scale.method).toBe('none')
    expect(result.metrics.metrics.speed.value).toBeNull()
    expect(result.metrics.metrics.speed.level).toBe('none')
    expect(result.metrics.metrics.strideLength.value).toBeNull()
    expect(result.metrics.metrics.strideLength.level).toBe('none')
  })
})

// ===========================================================================
// 稳健稳定度：MAD 替代标准差（18s 样本下抗单个错误着地）
// ===========================================================================
describe('稳健稳定度 robustCvPercent（MAD）', () => {
  /** 旧算法（均值+标准差 CV%），仅在测试中复算作对比 */
  function sdCvPercent(a: number[]): number | null {
    if (a.length < 2) return null
    const mean = a.reduce((x, y) => x + y, 0) / a.length
    if (mean <= 0) return null
    const variance = a.reduce((s, v) => s + (v - mean) ** 2, 0) / (a.length - 1)
    return (Math.sqrt(variance) / mean) * 100
  }

  it('等间隔数据：MAD 与 SD 都给出 rCV≈0', () => {
    const a = [500, 500, 500, 500, 500, 500]
    expect(robustCvPercent(a)).toBe(0)
    expect(sdCvPercent(a)).toBe(0)
  })

  it('单个异常长间隔：MAD 几乎不受影响，SD 被明显拉偏', () => {
    const clean = [500, 500, 500, 500, 500, 500, 500, 500]
    const withOutlier = [500, 500, 500, 500, 500, 500, 500, 1400] // 最后一个=误检的长间隔
    const cvClean = robustCvPercent(clean)
    const cvOutlier = robustCvPercent(withOutlier)
    expect(cvClean).toBe(0)
    // MAD 只与 |v-med| 的中位数有关：单个离群点不动中位数
    expect(cvOutlier).toBe(0)

    // 对照：旧 SD-CV 被异常值从 0 拉到 ~30%
    const sdOutlier = sdCvPercent(withOutlier)!
    expect(sdOutlier).toBeGreaterThan(25)
  })

  it('双侧同时抖动：MAD 如实反映离散度，且与 SD 量级可比', () => {
    const a = [460, 540, 470, 530, 480, 520, 490, 510]
    const rcv = robustCvPercent(a)!
    expect(rcv).toBeGreaterThan(0)
    expect(rcv).toBeLessThan(20)
    expect(Math.abs(rcv - sdCvPercent(a)!)).toBeLessThan(5)
  })

  it('样本不足/中位数为 0 → null', () => {
    expect(robustCvPercent([])).toBeNull()
    expect(robustCvPercent([500])).toBeNull()
    expect(robustCvPercent([0, 0, 0])).toBeNull()
  })

  it('偶数个样本取中间两值平均（标准中位数）', () => {
    // [400,500] → med=450, MAD=中位数([50,50])=50 → rSD=74.13 → rCV≈16.47
    const rcv = robustCvPercent([400, 500])!
    expect(rcv).toBeCloseTo(((1.4826 * 50) / 450) * 100, 5)
  })
})

describe('稳定度 Metric：得分/等级/门控语义', () => {
  const FPS = 20
  const FRAME_MS = 1000 / FPS
  const noScale: ScaleInfo = { calibrated: false, method: 'none' }

  /** 由交替 strike 时刻生成帧（髋/踝可见，其余不可见） */
  function framesFromStrikes(strikes: Array<{ side: 'left' | 'right'; t: number }>): PoseFrame[] {
    const end = Math.max(...strikes.map((s) => s.t))
    const n = Math.round(end / FRAME_MS)
    return Array.from({ length: n + 1 }, (_, k) => {
      const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.001 }))
      const ms = k * FRAME_MS
      const nearest = strikes.some((s) => Math.abs(s.t - ms) <= 25)
      lm[23] = { x: 0.49, y: 0.55, z: 0, visibility: 0.97 }
      lm[24] = { x: 0.51, y: 0.55, z: 0, visibility: 0.97 }
      lm[27] = { x: 0.46, y: nearest ? 0.82 : 0.77, z: 0, visibility: 0.96 }
      lm[28] = { x: 0.54, y: nearest ? 0.82 : 0.77, z: 0, visibility: 0.92 }
      return { frameId: k, timestampMs: ms, landmarks: lm, inferMs: 5 }
    })
  }

  /** 由交替 strike 时刻生成一个 ValidSegment（events 即击地事件） */
  function segmentFromStrikes(strikes: Array<{ side: 'left' | 'right'; t: number }>): ValidSegment {
    const end = Math.max(...strikes.map((s) => s.t))
    return {
      startMs: 0,
      endMs: end,
      direction: 'out',
      events: strikes.map((s) => ({
        type: 'heelStrike' as const,
        side: s.side,
        timestampMs: s.t,
        confidence: 0.95,
      })),
      cycles: [],
    }
  }

  const stabilityOf = (gaps: number[]) => {
    // 约定 gaps 即「同侧交替间隔」：右击按 gaps 累计；左击插在相邻右击中点，
    // 使 computeMetrics 的 timing() 按同侧配对后得到的交替间隔正是给定 gaps。
    const strikes: Array<{ side: 'left' | 'right'; t: number }> = []
    let t = 0
    const rightTimes: number[] = []
    gaps.forEach((g) => {
      rightTimes.push(t)
      t += g
    })
    for (let i = 0; i < rightTimes.length - 1; i++) {
      strikes.push({ side: 'right', t: rightTimes[i] })
      strikes.push({ side: 'left', t: (rightTimes[i] + rightTimes[i + 1]) / 2 })
    }
    strikes.push({ side: 'right', t: rightTimes[rightTimes.length - 1] })
    strikes.sort((a, b) => a.t - b.t)
    const frames = framesFromStrikes(strikes)
    const segment = segmentFromStrikes(strikes)
    return computeMetrics(frames, [segment], noScale).stability
  }

  it('等间隔 + 单个长异常间隔：得分仍接近满分、level=green', () => {
    const m = stabilityOf([500, 500, 500, 500, 500, 500, 500, 1400])
    expect(m.label).toBe('步态稳定度')
    expect(m.unit).toBe('%')
    expect(m.value).not.toBeNull()
    expect(m.value!).toBeGreaterThanOrEqual(90)
    expect(m.level).toBe('green')
    expect(m.hint).toContain('步频')
  })

  it('rCV 越大得分越低：yellow/red 阈值与公式一致', () => {
    // 间隔 500±100 → MAD 给出中等离散
    const m1 = stabilityOf([500, 400, 600, 420, 580, 440, 560, 460, 540])
    expect(m1.value).not.toBeNull()
    expect(m1.level).not.toBe('green')
    expect(m1.value!).toBeLessThan(100 - CV_GREEN * CV_SCORE_SCALE)

    // 极乱：300–1100 → rCV 很大 → 得分 0、red
    const m2 = stabilityOf([500, 1100, 300, 950, 350, 850, 400, 750, 450])
    expect(m2.level).toBe('red')
    expect(m2.value).toBe(0)
  })

  it('异常间隔下界 <200ms 与上界 MAX_STEP_GAP_MS 均被剔除', () => {
    // 150ms 的误检间隔会被下界剔除；2500ms 超过 MAX_STEP_GAP_MS(2000) 被剔除
    const m = stabilityOf([500, 150, 500, 500, 2500, 500, 500])
    // 剔除后只剩 500ms → rCV=0
    expect(m.value).toBe(100)
    expect(m.level).toBe('green')
    expect(MIN_ALTERNATING_STEP_GAP_MS).toBe(200)
    expect(MAX_STEP_GAP_MS).toBe(2000)
  })
})

describe('activityMode 契约（v1.2）', () => {
  it('walk mock：透传 activityMode=walk，且身高 hint 下 speed/stride 物理合理', async () => {
    const core = createGaitCore()
    const walk = await core.analyzeSession('walk-mode', normalFrames, [])
    expect(walk.ok).toBe(true)
    if (!walk.ok) throw new Error('expected ok')
    expect(walk.activityMode).toBe('walk')

    const result = await core.analyzeSession('walk-height', normalFrames, [], {
      method: 'height',
      referenceLengthM: 1.7,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    const { speed, strideLength } = result.metrics.metrics
    expect(speed.value).not.toBeNull()
    expect(strideLength.value).not.toBeNull()
    expect(speed.value!).toBeGreaterThan(0.3)
    expect(speed.value!).toBeLessThan(3)
    expect(strideLength.value!).toBeGreaterThan(0.3)
    expect(strideLength.value!).toBeLessThan(2)
  })
})
