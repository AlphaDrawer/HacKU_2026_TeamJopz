import type { PoseFrame, ValidSegment } from '../contracts/types'
import {
  LEFT_HIP,
  RIGHT_HIP,
  VISIBILITY_THRESHOLD,
  SEG_SPEED_ENTER_PX_S,
  SEG_SPEED_EXIT_PX_S,
  MIN_SEGMENT_MS,
  STEADY_BAND,
  MAX_INVALID_GAP_MS,
  VIRTUAL_WIDTH_PX as W,
} from './constants'

/**
 * segmentSelector（§4.1）：只保留中段直线匀速，剔除起步/转身/止步。
 *
 * 用髋中心 x 的速度判断走行态：正=去程 out，负=回程 back，近 0=站定；
 * 滞回阈值防抖。每段两端做 ±40% 中位速度的稳态裁边，削掉加/减速。
 * 段内连续无效 ≤250ms 做桥接不断段（转身/长时间丢失才切段），桥接帧
 * 不参与速度与裁边。纯函数，输出方向标记好、待填事件/周期的切段。
 */

type State = 'idle' | 'out' | 'back'

interface Sample {
  t: number
  x: number
  v: number
  ok: boolean
  bridged: boolean
}

function rawSamples(frames: PoseFrame[]): Sample[] {
  return frames.map((f) => {
    const lh = f.landmarks[LEFT_HIP]
    const rh = f.landmarks[RIGHT_HIP]
    const ok = lh.visibility >= VISIBILITY_THRESHOLD && rh.visibility >= VISIBILITY_THRESHOLD
    return { t: f.timestampMs, x: ((lh.x + rh.x) / 2) * W, v: NaN, ok, bridged: false }
  })
}

function markBridged(s: Sample[]): Sample[] {
  let i = 0
  while (i < s.length) {
    if (s[i].ok) {
      i++
      continue
    }
    let j = i
    while (j < s.length && !s[j].ok) j++
    const gapMs = s[j - 1].t - s[i].t
    const bounded = i > 0 && j < s.length
    if (bounded && gapMs <= MAX_INVALID_GAP_MS) {
      for (let k = i; k < j; k++) s[k].bridged = true
    }
    i = j
  }
  return s
}

function buildSamples(frames: PoseFrame[]): Sample[] {
  const s = markBridged(rawSamples(frames))
  // 前向差分：v[i] 由当前帧指向下一帧，首帧立即有速度，无两帧延迟，
  // 状态机在运动第一帧即可识别（末帧速度 NaN，不影响——末帧本就是止步点）。
  for (let i = 0; i < s.length - 1; i++) {
    if (!s[i].ok || !s[i + 1].ok) continue
    const dt = (s[i + 1].t - s[i].t) / 1000
    s[i].v = dt > 0 ? (s[i + 1].x - s[i].x) / dt : NaN
  }
  return s
}

function median(nums: number[]): number {
  const a = [...nums].sort((x, y) => x - y)
  return a[Math.floor(a.length / 2)] ?? 0
}

function trimSteady(samplesInSeg: Sample[]): { start: number; end: number } | null {
  // 边界帧因中心差分取不到速度（NaN），但不代表它们在加/减速；
  // 先按「能算出速度的帧」确定稳态区间，再把该区间覆盖到的真实帧时间范围
  // （含两端边界帧）作为切段边界，避免丢掉每趟的第一个 strike。
  const realAll = samplesInSeg.filter((q) => q.ok)
  const real = realAll.filter((q) => Number.isFinite(q.v))
  if (real.length < 4) return null
  const vmid = median(real.map((q) => Math.abs(q.v)).filter((v) => v > 0))
  const lo = vmid * (1 - STEADY_BAND)
  const hi = vmid * (1 + STEADY_BAND)
  const steady = real.filter((q) => Math.abs(q.v) >= lo && Math.abs(q.v) <= hi)
  if (steady.length < 2) return null
  const t0 = steady[0].t
  const t1 = steady[steady.length - 1].t
  const covered = realAll.filter((q) => q.t >= t0 && q.t <= t1)
  return { start: covered[0].t, end: covered[covered.length - 1].t }
}

export function selectSegments(frames: PoseFrame[]): ValidSegment[] {
  const s = buildSamples(frames)
  const segments: ValidSegment[] = []
  let state: State = 'idle'
  let segStartIdx = -1
  const present = (q: Sample) => q.ok || q.bridged

  const close = (endIdx: number) => {
    if (segStartIdx < 0) return
    const inSeg = s.slice(segStartIdx, endIdx + 1).filter((q) => present(q))
    const real = inSeg.filter((q) => q.ok)
    const trimmed = trimSteady(inSeg)
    const start = trimmed?.start ?? real[0]?.t
    const end = trimmed?.end ?? real[real.length - 1]?.t
    if (start != null && end != null && end - start >= MIN_SEGMENT_MS) {
      segments.push({
        startMs: start,
        endMs: end,
        direction: state === 'back' ? 'back' : 'out',
        events: [],
        cycles: [],
      })
    }
    segStartIdx = -1
    state = 'idle'
  }

  for (let i = 0; i < s.length; i++) {
    const q = s[i]
    if (!present(q)) {
      if (state !== 'idle') close(i - 1)
      continue
    }
    if (!q.ok || !Number.isFinite(q.v)) continue
    if (state === 'idle') {
      if (q.v > SEG_SPEED_ENTER_PX_S) {
        state = 'out'
        segStartIdx = i
      } else if (q.v < -SEG_SPEED_ENTER_PX_S) {
        state = 'back'
        segStartIdx = i
      }
    } else if (state === 'out') {
      if (q.v < -SEG_SPEED_ENTER_PX_S) close(i - 1)
      else if (Math.abs(q.v) < SEG_SPEED_EXIT_PX_S) close(i - 1)
    } else if (state === 'back') {
      if (q.v > SEG_SPEED_ENTER_PX_S) close(i - 1)
      else if (Math.abs(q.v) < SEG_SPEED_EXIT_PX_S) close(i - 1)
    }
  }
  if (state !== 'idle') close(s.length - 1)

  return segments.sort((a, b) => a.startMs - b.startMs)
}
