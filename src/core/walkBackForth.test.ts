import { describe, expect, it } from 'vitest'
import type { PoseFrame } from '../contracts/types'
import { createGaitCore } from './index'
import { selectSegments } from './segmentSelector'
import { detectEventsInSegment } from './eventDetector'

// ===========================================================================
// 来回走合成数据：小块区域内 out+back 两段，转身帧不进任何段、不污染间隔
// （与 core.test.ts 同风格的独立聚焦测试文件，自带轻量辅助函数）
// ===========================================================================

function runPipeline(frames: PoseFrame[]) {
  return selectSegments(frames).map((s) => ({
    ...s,
    events: detectEventsInSegment(frames, s),
  }))
}

describe('来回走合成数据（方向反转切 out/back 两段，转身不统计）', () => {
  const FPS = 20
  const FRAME_MS = 1000 / FPS
  const HIP_Y = 0.55
  const GROUND_Y = 0.82
  const SWING_RAISE = 0.05
  const CONTACT_HALF_MS = 25
  const IDLE_MS = 500
  const OUT_MS = 5000
  const TURN_MS = 1000
  const BACK_MS = 5000

  /** 在阶段 [start,end) 内：错开起点 250ms，按 250ms 交替调度 strike */
  function schedule(start: number, end: number, firstSide: 'left' | 'right') {
    const out: Array<{ side: 'left' | 'right'; t: number }> = []
    let side = firstSide
    for (let t = start + 250; t < end - 200; t += 250) {
      out.push({ side, t })
      side = side === 'left' ? 'right' : 'left'
    }
    return out
  }

  /**
   * 合成「原地站 0.5s → 匀速走出 5s → 原地转身 1s（髋可见但不移动）
   * → 匀速走回 5s」的会话。髋中心由 0.3 → 0.7 → 0.3（虚拟归一化 x），
   * 摆幅 0.4，按走行模式判定。
   */
  function walkBackForthFrames(): PoseFrame[] {
    const out0 = IDLE_MS
    const turn0 = out0 + OUT_MS
    const back0 = turn0 + TURN_MS
    const end = back0 + BACK_MS
    const strikes = [...schedule(out0, turn0, 'right'), ...schedule(back0, end, 'right')]
    const timesFor = (side: 'left' | 'right') =>
      strikes.filter((s) => s.side === side).map((s) => s.t)

    /** 与踏步合成同一风格：strike±25ms 落地，两击间正弦抬腿 */
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

    const n = Math.round(end / FRAME_MS)
    return Array.from({ length: n + 1 }, (_, k) => {
      const ms = Math.round(k * FRAME_MS)
      let hipCenter: number
      if (ms < out0) hipCenter = 0.3
      else if (ms < turn0) hipCenter = 0.3 + (0.4 * (ms - out0)) / OUT_MS
      else if (ms < back0) hipCenter = 0.7
      else hipCenter = 0.7 - (0.4 * (ms - back0)) / BACK_MS
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
      // 转身期间双脚落地、不产生 strike
      const turning = ms >= turn0 && ms < back0
      set(27, hipCenter - 0.04, turning ? GROUND_Y : ankleY(ms, timesFor('left')), 0.96)
      set(28, hipCenter + 0.04, turning ? GROUND_Y : ankleY(ms, timesFor('right')), 0.92)
      return { frameId: k, timestampMs: ms, landmarks: lms, inferMs: 10 }
    })
  }

  it('切出 ≥2 段且方向含 out 与 back，两段都贡献双侧事件', () => {
    const frames = walkBackForthFrames()
    const segs = runPipeline(frames)
    expect(segs.length).toBeGreaterThanOrEqual(2)
    const dirs = new Set(segs.map((s) => s.direction))
    expect(dirs.has('out')).toBe(true)
    expect(dirs.has('back')).toBe(true)
    // 每段每侧都至少 3 次 heelStrike
    for (const seg of segs) {
      expect(seg.events.filter((e) => e.side === 'left').length).toBeGreaterThanOrEqual(3)
      expect(seg.events.filter((e) => e.side === 'right').length).toBeGreaterThanOrEqual(3)
    }
  })

  it('转身帧不属于任何段：转身区间内无事件，段间不连续', () => {
    const frames = walkBackForthFrames()
    const segs = runPipeline(frames)
    const turn0 = IDLE_MS + OUT_MS
    const back0 = turn0 + TURN_MS
    // 转身区间 [5500,6500) 内不允许出现任何事件
    const inTurn = segs
      .flatMap((s) => s.events)
      .filter((e) => e.timestampMs >= turn0 && e.timestampMs < back0)
    expect(inTurn.length).toBe(0)
    // out 段在转身前结束、back 段在转身之后才开始（两段不拼接）
    const outSeg = segs.find((s) => s.direction === 'out')!
    const backSeg = segs.find((s) => s.direction === 'back')!
    expect(outSeg.endMs).toBeLessThanOrEqual(turn0)
    expect(backSeg.startMs).toBeGreaterThanOrEqual(back0)
  })

  it('analyzeSession：ok:true、activityMode=walk，门控全部通过', async () => {
    const frames = walkBackForthFrames()
    expect(frames.length).toBeGreaterThan(30) // 门控1：总帧数充足
    const core = createGaitCore()
    const result = await core.analyzeSession('walk-back-forth', frames, [])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.activityMode).toBe('walk')
    // 合并事件后每侧 heelStrike ≥3（门控2），对称/稳定主指标有效
    const segs = runPipeline(frames)
    const count = (side: 'left' | 'right') =>
      segs.reduce((n, s) => n + s.events.filter((e) => e.side === side).length, 0)
    expect(count('left')).toBeGreaterThanOrEqual(3)
    expect(count('right')).toBeGreaterThanOrEqual(3)
    expect(result.metrics.metrics.symmetry.value).not.toBeNull()
    expect(result.metrics.metrics.symmetry.value!).toBeGreaterThan(90)
    expect(result.metrics.metrics.stability.value).not.toBeNull()
    // 等间隔来回走、转身不进间隔 → rCV≈0，稳定度接近满分
    expect(result.metrics.metrics.stability.value!).toBeGreaterThanOrEqual(90)
    // 未校准：物理指标为 null
    expect(result.metrics.metrics.speed.value).toBeNull()
    expect(result.metrics.metrics.strideLength.value).toBeNull()
  })
})
