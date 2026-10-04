import type { PoseFrame, ValidSegment } from '../contracts/types'
import {
  LEFT_HIP,
  RIGHT_HIP,
  LEFT_ANKLE,
  RIGHT_ANKLE,
  VISIBILITY_THRESHOLD,
  SEG_SPEED_ENTER_PX_S,
  SEG_SPEED_EXIT_PX_S,
  MIN_SEGMENT_MS,
  STEADY_BAND,
  MAX_INVALID_GAP_MS,
  MARCH_HIP_RANGE_PX,
  MARCH_VERT_SPEED_ENTER_PX_S,
  MARCH_VERT_SPEED_EXIT_PX_S,
  MARCH_SMOOTH_WINDOW,
  MARCH_STEADY_BAND,
  VIRTUAL_WIDTH_PX as W,
  VIRTUAL_HEIGHT_PX as H,
} from './constants'

/**
 * segmentSelector（§4.1；v1.2 增加原地踏步通道）：只保留稳定中段，
 * 剔除起步/转身/止步。
 *
 * 两种模式（按全段髋中心水平摆幅自动判定）：
 *  1) 走行模式（默认）：髋中心 x 速度判态，正=out、负=back、近 0=站定，
 *     滞回阈值防抖；两端按 ±40% 中位速度做稳态裁边。
 *  2) 原地踏步模式（房间空间不足）：髋水平速度≈0，改以【双侧踝垂直节奏】
 *     为据：踝 y 周期性起伏（踏步抬腿）→ 垂直速度活动能量；居中平滑压掉
 *     着地/摆动顶点的瞬时零速，再以滞回阈值切出活动段，按中位能量带裁边，
 *     仍削掉起步/止步的前/后 1 拍。原地无 out/back 方向语义，direction
 *     复用固定值 'out'（不触碰冻结契约；前端勿把它当走行方向展示）。
 *
 * 段内连续无效 ≤250ms 桥接不断段（转身/长时间丢失才切段），桥接帧不参与
 * 速度、能量与裁边。纯函数，输出待填事件/周期的切段。
 */

type Mode = 'locomotion' | 'march'
type State = 'idle' | 'out' | 'back' | 'march'

interface Sample {
  t: number
  x: number
  v: number // 走行：髋中心水平速度 px/s
  ayL: number // 左踝 y（虚拟 px）
  ayR: number // 右踝 y（虚拟 px）
  ankOkL: boolean
  ankOkR: boolean
  energy: number // 踏步：平滑后的踝垂直活动能量 px/s
  ok: boolean // 髋可见（走行门控 / 桥接依据）
  bridged: boolean
}

function rawSamples(frames: PoseFrame[]): Sample[] {
  return frames.map((f) => {
    const lh = f.landmarks[LEFT_HIP]
    const rh = f.landmarks[RIGHT_HIP]
    const la = f.landmarks[LEFT_ANKLE]
    const ra = f.landmarks[RIGHT_ANKLE]
    const ok = lh.visibility >= VISIBILITY_THRESHOLD && rh.visibility >= VISIBILITY_THRESHOLD
    return {
      t: f.timestampMs,
      x: ((lh.x + rh.x) / 2) * W,
      v: NaN,
      ayL: la.y * H,
      ayR: ra.y * H,
      ankOkL: la.visibility >= VISIBILITY_THRESHOLD,
      ankOkR: ra.visibility >= VISIBILITY_THRESHOLD,
      energy: 0,
      ok,
      bridged: false,
    }
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
  // 走行：前向差分，首帧即有水平速度（末帧 NaN，末帧本就是止步点）
  for (let i = 0; i < s.length - 1; i++) {
    if (!s[i].ok || !s[i + 1].ok) continue
    const dt = (s[i + 1].t - s[i].t) / 1000
    s[i].v = dt > 0 ? (s[i + 1].x - s[i].x) / dt : NaN
  }
  // 踏步：双侧踝垂直速度取大（中心差分，双侧独立），再居中滑动平均，
  // 压掉着地/摆动顶点的瞬时 vy=0（约每拍 1 帧）。
  const rawVy: number[] = new Array(s.length).fill(0)
  for (let i = 1; i < s.length - 1; i++) {
    if (!s[i].ok) continue
    const dt = (s[i + 1].t - s[i - 1].t) / 1000
    if (dt <= 0) continue
    let e = 0
    if (s[i].ankOkL && s[i - 1].ok && s[i + 1].ok) {
      e = Math.max(e, Math.abs(s[i + 1].ayL - s[i - 1].ayL) / dt)
    }
    if (s[i].ankOkR && s[i - 1].ok && s[i + 1].ok) {
      e = Math.max(e, Math.abs(s[i + 1].ayR - s[i - 1].ayR) / dt)
    }
    rawVy[i] = e
  }
  const half = Math.floor(MARCH_SMOOTH_WINDOW / 2)
  for (let i = 0; i < s.length; i++) {
    let sum = 0
    let n = 0
    for (let j = Math.max(0, i - half); j <= Math.min(s.length - 1, i + half); j++) {
      sum += rawVy[j]
      n++
    }
    s[i].energy = n > 0 ? sum / n : 0
  }
  return s
}

function median(nums: number[]): number {
  const a = [...nums].sort((x, y) => x - y)
  return a[Math.floor(a.length / 2)] ?? 0
}

/** 模式判定：全段髋中心水平摆幅很小 → 原地踏步（站立/停顿帧不参与） */
function detectMode(s: Sample[]): Mode {
  const xs = s.filter((q) => q.ok).map((q) => q.x)
  if (xs.length < 2) return 'march'
  const range = Math.max(...xs) - Math.min(...xs)
  return range <= MARCH_HIP_RANGE_PX ? 'march' : 'locomotion'
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

/**
 * 踏步稳态裁边：用平滑活动能量的中位值带下界（只削前/后弱能量拍，
 * 不设上界——踏步本身无「匀速过冲」，上界只会误删正常强拍）。
 */
function trimMarchSteady(samplesInSeg: Sample[]): { start: number; end: number } | null {
  const realAll = samplesInSeg.filter((q) => q.ok)
  if (realAll.length < 4) return null
  const emid = median(realAll.map((q) => q.energy).filter((v) => v > 0))
  const lo = emid * (1 - MARCH_STEADY_BAND)
  const steady = realAll.filter((q) => q.energy >= lo)
  if (steady.length < 2) return null
  return { start: steady[0].t, end: steady[steady.length - 1].t }
}

export function selectSegments(frames: PoseFrame[]): ValidSegment[] {
  const s = buildSamples(frames)
  const mode = detectMode(s)
  const segments: ValidSegment[] = []
  let state: State = 'idle'
  let segStartIdx = -1
  const present = (q: Sample) => q.ok || q.bridged

  const close = (endIdx: number) => {
    if (segStartIdx < 0) return
    const inSeg = s.slice(segStartIdx, endIdx + 1).filter((q) => present(q))
    const real = inSeg.filter((q) => q.ok)
    const trimmed = mode === 'march' ? trimMarchSteady(inSeg) : trimSteady(inSeg)
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
    if (mode === 'march') {
      // 垂直节奏活动态：能量过 enter 入段，低于 exit 出段（滞回防抖）
      if (state === 'idle') {
        if (q.ok && q.energy >= MARCH_VERT_SPEED_ENTER_PX_S) {
          state = 'march'
          segStartIdx = i
        }
      } else if (q.ok && q.energy < MARCH_VERT_SPEED_EXIT_PX_S) {
        close(i - 1)
      }
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
