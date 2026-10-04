/**
 * marchRobust.test.ts（v1.3 稳健化回归）
 * ------------------------------------------------------------------
 * 固化真机两次失败暴露出的两类切段缺陷与安全不变量：
 *  1) 原地踏步但身体明显左右晃（髋中心全段摆幅远超旧 120px 阈值）：
 *     v1.2 误判 locomotion → 无段 → 门控2；v1.3 必须判 march、ok:true。
 *  2) 离镜头远/抬膝低（踝垂直能量低于旧固定 120px/s）但节奏清晰：
 *     v1.2 永不入段；v1.3 自适应阈值必须入段、ok:true。
 *  3) 安全不变量：站立仅小幅晃动（踝微噪声、无交替节奏）即使候选入段，
 *     也必须被门控2拒绝（每侧 heelStrike<3）；真走路/来回走仍判 walk。
 *
 * 4 道门控阈值（MIN_HEEL_STRIKES_PER_SIDE / MIN_SESSION_FRAMES /
 * SESSION_MIN_CONFIDENCE）均未放松，本文件只验证切段器与模式判定的鲁棒性。
 */
import { describe, expect, it } from 'vitest'
import type { PoseFrame } from '../contracts/types'
import { createGaitCore } from './index'
import {
  isMarchSession,
  selectSegmentsWithInfo,
} from './segmentSelector'

const FPS = 20
const FRAME_MS = 1000 / FPS
const HIP_X0 = 0.5
const HIP_Y = 0.55
const GROUND_Y = 0.82
const ANKLE_X_L = 0.46
const ANKLE_X_R = 0.54
const CONTACT_HALF_MS = 25

interface MarchGenOpts {
  swayPx?: number
  swayPeriodMs?: number
  swingRaise?: number
  halfToR?: number
  halfToL?: number
  standing?: boolean
  standNoise?: number
}

/** 与 core.test.ts 同风格的踏步合成器，增加身体左右晃 / 低抬膝 / 站姿噪声 */
function synthFrames(durationMs: number, opts: MarchGenOpts = {}): PoseFrame[] {
  const swayPx = opts.swayPx ?? 0
  const swayPeriodMs = opts.swayPeriodMs ?? 1000
  const swingRaise = opts.swingRaise ?? 0.05
  const halfToR = opts.halfToR ?? 250
  const halfToL = opts.halfToL ?? 250
  const standing = opts.standing ?? false
  const standNoise = opts.standNoise ?? 0

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

  const ankleY = (ms: number, ts: number[]): number => {
    if (ts.length === 0) return GROUND_Y
    if (ms <= ts[0])
      return Math.abs(ms - ts[0]) <= CONTACT_HALF_MS
        ? GROUND_Y
        : GROUND_Y - swingRaise
    let i = 0
    while (i < ts.length - 1 && ms >= ts[i + 1]) i++
    const a = ts[i]
    const b = ts[i + 1]
    if (b == null) return GROUND_Y
    if (Math.abs(ms - a) <= CONTACT_HALF_MS || Math.abs(ms - b) <= CONTACT_HALF_MS)
      return GROUND_Y
    const p = (ms - a) / (b - a)
    return GROUND_Y - swingRaise * Math.sin(p * Math.PI)
  }

  const n = Math.round(durationMs / FRAME_MS)
  return Array.from({ length: n + 1 }, (_, k) => {
    const ms = k * FRAME_MS
    const hipCenter =
      HIP_X0 + (swayPx / 1000) * Math.sin((2 * Math.PI * ms) / swayPeriodMs)
    const lms = Array.from({ length: 33 }, () => ({
      x: hipCenter,
      y: HIP_Y,
      z: 0,
      visibility: 0.001,
    }))
    const set = (idx: number, x: number, y: number, v: number) =>
      Object.assign(lms[idx], { x, y, visibility: v })
    set(23, hipCenter - 0.012, HIP_Y, 0.97)
    set(24, hipCenter + 0.012, HIP_Y, 0.97)
    set(25, hipCenter - 0.016, 0.68, 0.95)
    set(26, hipCenter + 0.016, 0.68, 0.9)
    set(11, hipCenter - 0.012, 0.4, 0.97)
    set(12, hipCenter + 0.012, 0.4, 0.95)
    set(0, hipCenter, 0.34, 0.96)
    // 站立小幅晃：踝 y 只有确定性高频微噪声、无交替节奏
    const microNoise = (seed: number) =>
      GROUND_Y +
      standNoise *
        (0.6 * Math.sin(2 * Math.PI * (ms / 130) + seed) +
          0.4 * Math.sin(2 * Math.PI * (ms / 210) + seed * 2))
    const yL = standing ? microNoise(0) : ankleY(ms, timesFor('left'))
    const yR = standing ? microNoise(1.7) : ankleY(ms, timesFor('right'))
    set(27, ANKLE_X_L, yL, 0.96)
    set(28, ANKLE_X_R, yR, 0.92)
    return { frameId: k, timestampMs: Math.round(ms), landmarks: lms, inferMs: 10 }
  })
}

describe('v1.3 模式判定：身体左右晃不再误判 locomotion', () => {
  it('髋摆幅≈300px（旧阈值 2.5 倍）的踏步仍判 march', () => {
    const frames = synthFrames(18000, { swayPx: 150, swayPeriodMs: 1000 })
    const info = selectSegmentsWithInfo(frames).info
    expect(info.hipRangePx).toBeGreaterThan(120)
    expect(info.mode).toBe('march')
    expect(isMarchSession(frames)).toBe(true)
  })

  it('慢晃（周期 3s、幅值 150px）往复运动仍判 march，不切成单向 run', () => {
    const frames = synthFrames(18000, { swayPx: 150, swayPeriodMs: 3000 })
    expect(selectSegmentsWithInfo(frames).info.mode).toBe('march')
  })

  it('端到端：明显左右晃的踏步 ok:true、activityMode=march、主指标有效', async () => {
    const frames = synthFrames(18000, { swayPx: 180, swayPeriodMs: 1200 })
    const result = await createGaitCore().analyzeSession('march-sway', frames, [])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.activityMode).toBe('march')
    expect(result.metrics.metrics.symmetry.value).not.toBeNull()
    expect(result.metrics.metrics.stability.value).not.toBeNull()
    expect(result.metrics.metrics.speed.value).toBeNull()
    expect(result.metrics.metrics.strideLength.value).toBeNull()
  })
})

describe('v1.3 踏步入段：能量分位数自适应取景距离/抬膝高低', () => {
  it('抬膝 0.012（能量峰值低于旧 120 阈值）仍能切出段', () => {
    const frames = synthFrames(18000, { swingRaise: 0.012 })
    const result = selectSegmentsWithInfo(frames)
    expect(result.info.energyPeakPxS).toBeLessThan(120)
    expect(result.info.energyEnterPxS).toBeLessThanOrEqual(result.info.energyPeakPxS)
    expect(result.info.segmentCount).toBeGreaterThan(0)
  })

  it('抬膝 0.008 + 轻微身体晃动：节奏清晰即可入段', () => {
    const frames = synthFrames(18000, {
      swingRaise: 0.008,
      swayPx: 60,
      swayPeriodMs: 1400,
    })
    expect(selectSegmentsWithInfo(frames).info.segmentCount).toBeGreaterThan(0)
  })

  it('端到端：远机位低抬膝踏步 ok:true、主指标有效', async () => {
    const frames = synthFrames(18000, { swingRaise: 0.012 })
    const result = await createGaitCore().analyzeSession('march-far', frames, [])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.activityMode).toBe('march')
    expect(result.metrics.metrics.symmetry.value).not.toBeNull()
    expect(result.metrics.metrics.stability.value).not.toBeNull()
  })
})

describe('v1.3 安全不变量：站姿小幅晃动绝不放行（门控2 原样保留）', () => {
  it('站立+踝微噪声（0.0015）：切不出段，ok:false/门控2', async () => {
    const frames = synthFrames(18000, { standing: true, standNoise: 0.0015 })
    const result = selectSegmentsWithInfo(frames)
    expect(result.info.segmentCount).toBe(0)
    const analyzed = await createGaitCore().analyzeSession('stand-noise', frames, [])
    expect(analyzed.ok).toBe(false)
    if (analyzed.ok) throw new Error('expected failure')
    expect(analyzed.reason).toBe('insufficient-main-metrics')
  })

  it('站立+较大踝微晃（0.003）仍被门控2拒绝，且失败分支带诊断', async () => {
    const frames = synthFrames(18000, { standing: true, standNoise: 0.003 })
    const analyzed = await createGaitCore().analyzeSession(
      'stand-noise-bigger',
      frames,
      [],
    )
    expect(analyzed.ok).toBe(false)
    if (analyzed.ok) throw new Error('expected failure')
    expect(analyzed.reason).toBe('insufficient-main-metrics')
    expect(analyzed.debug).toBeDefined()
    expect(analyzed.debug!.strikesLeft).toBeLessThan(3)
    expect(analyzed.debug!.strikesRight).toBeLessThan(3)
  })
})

describe('v1.3 模式判定不伤害真走路：walk 语义保持', () => {
  it('来回走数据仍判 locomotion/walk、含 out/back 段', async () => {
    const normalFrames = (await import('../data/mock_normal.json')).default as PoseFrame[]
    expect(selectSegmentsWithInfo(normalFrames).info.mode).toBe('locomotion')
    const result = await createGaitCore().analyzeSession('walk-check', normalFrames, [])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.activityMode).toBe('walk')
  })

  it('踏步能量诊断字段完整（模式/摆幅/段/能量统计均可读）', () => {
    const frames = synthFrames(18000, { swayPx: 150, swayPeriodMs: 1000 })
    const info = selectSegmentsWithInfo(frames).info
    expect(info).toMatchObject({
      mode: 'march',
      marchHipRangePx: 120,
      legacyEnterPxS: 120,
    })
    expect(info.energyMedianPxS).toBeGreaterThanOrEqual(0)
    expect(info.energyPeakPxS).toBeGreaterThan(0)
    expect(info.energyEnterPxS).toBeGreaterThanOrEqual(40)
  })
})
