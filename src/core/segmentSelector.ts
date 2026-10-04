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
  MARCH_ENTER_QUANTILE,
  MARCH_ENTER_FLOOR_PX_S,
  MARCH_EXIT_RATIO,
  RUN_NOISE_BAND_PX_S,
  RUN_MIN_MS,
  RUN_MIN_NET_PX,
  MARCH_SMOOTH_WINDOW,
  MARCH_STEADY_BAND,
  VIRTUAL_WIDTH_PX as W,
  VIRTUAL_HEIGHT_PX as H,
} from './constants'

/**
 * segmentSelector（§4.1；v1.3 鲁棒模式判定 + 自适应踏步入段）：只保留稳定
 * 中段，剔除起步/转身/止步。
 *
 * 两种模式（v1.3 起按【持续同向位移段 run 结构】判定，替代 v1.2 的全段
 * 髋中心 x 极差单特征）：
 *  1) 走行模式（locomotion）：髋中心 x 速度判态，正=out、负=back、近 0=
 *     站定，滞回阈值防抖；两端按 ±40% 中位速度做稳态裁边。
 *  2) 原地踏步模式（march，房间空间不足）：髋水平速度≈0，改以【双侧踝垂直
 *     节奏】为据：踝 y 周期性起伏（踏步抬腿）→ 垂直速度活动能量；居中平滑
 *     压掉着地/摆动顶点的瞬时零速，再以滞回阈值切出活动段，按中位能量带
 *     裁边，仍削掉起步/止步的前/后弱拍。原地无 out/back 方向语义，direction
 *     复用固定值 'out'（不触碰冻结契约；前端勿把它当走行方向展示）。
 *
 * 入段阈值（v1.3）：取整段平滑能量的分位数（自适应取景距离/抬膝高低），
 * 并设绝对噪声地板防止站姿抖动被相对放大；出段阈值按入段 ×比例滞回。
 *
 * 段内连续无效 ≤250ms 桥接不断段（转身/长时间丢失才切段），桥接帧不参与
 * 速度、能量与裁边。纯函数，输出待填事件/周期的切段。
 */

export type GaitMode = 'locomotion' | 'march'
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

/** 切段阶段可观测诊断（事件检出前的部分；heelStrike 统计由调用方补齐） */
export interface SegmentSelectionInfo {
  mode: GaitMode
  /** 髋中心 x 全段摆幅（虚拟 px；仅诊断参照） */
  hipRangePx: number
  /** v1.2 旧判定阈值（诊断参照，不再参与判定） */
  marchHipRangePx: number
  segmentCount: number
  segments: Array<{
    startMs: number
    endMs: number
    durationMs: number
    direction: 'out' | 'back'
  }>
  energyMedianPxS: number
  energyPeakPxS: number
  /** v1.3 自适应入段/出段阈值（px/s） */
  energyEnterPxS: number
  energyExitPxS: number
  /** v1.2 旧固定入段阈值（诊断参照） */
  legacyEnterPxS: number
}

export interface SegmentSelectionResult {
  mode: GaitMode
  segments: ValidSegment[]
  info: SegmentSelectionInfo
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

/** 分位数（线性插值；0<=q<=1），空序列返回 0 */
function quantile(nums: number[], q: number): number {
  const a = [...nums].sort((x, y) => x - y)
  if (a.length === 0) return 0
  if (a.length === 1) return a[0]
  const pos = (a.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (pos - lo)
}

interface Run {
  durationMs: number
  netPx: number
}

/**
 * 把髋水平速度切成「持续同向位移段」：连续同号且 |v|≥噪声带的速度序列，
 * 段的物理时长覆盖从首速度帧到末速度所达帧，净位移取段两端髋 x 之差。
 * 踏步的左右晃/站立噪声切不出长 run；走路（含小范围来回走）每趟都是
 * 一个又长又远的 run。
 */
function computeRuns(s: Sample[]): Run[] {
  const runs: Run[] = []
  let a = -1
  let sign = 0
  const flush = (b: number) => {
    if (a < 0) return
    // 速度帧 a..b，物理端点为样本 a 与样本 b+1
    const endIdx = b + 1
    if (endIdx < s.length) {
      runs.push({
        durationMs: s[endIdx].t - s[a].t,
        netPx: Math.abs(s[endIdx].x - s[a].x),
      })
    }
    a = -1
    sign = 0
  }
  for (let i = 0; i < s.length; i++) {
    const q = s[i]
    if (!q.ok || !Number.isFinite(q.v) || Math.abs(q.v) < RUN_NOISE_BAND_PX_S) {
      flush(i - 1)
      continue
    }
    const vsign = q.v > 0 ? 1 : -1
    if (a < 0) {
      a = i
      sign = vsign
    } else if (vsign !== sign) {
      flush(i - 1)
      a = i
      sign = vsign
    }
  }
  flush(s.length - 2) // 末帧 v=NaN，最后一个速度帧至多是 length-2
  return runs
}

/**
 * 模式判定（v1.3）：存在同时满足持续时长与净位移下限的同向 run → 走行；
 * 否则原地踏步。比全段极差鲁棒：踏步时身体即使明显左右晃（全段极差很大），
 * 其往复运动也切不出持续 1.5s 以上、净位移 ≥180px 的单向 run。
 */
function detectMode(s: Sample[]): GaitMode {
  const walkLike = computeRuns(s).some(
    (r) => r.durationMs >= RUN_MIN_MS && r.netPx >= RUN_MIN_NET_PX,
  )
  return walkLike ? 'locomotion' : 'march'
}

/** 供 analyzeSession 判断本会话是否原地踏步；踏步时强制无物理尺度（speed/stride=null） */
export function isMarchSession(frames: PoseFrame[]): boolean {
  return detectMode(buildSamples(frames)) === 'march'
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

/**
 * v1.3 自适应踏步能量阈值：
 *  入段 = max(噪声地板, 全段能量分位数)；出段 = 入段 ×比例（滞回）。
 * 分位数随取景距离/抬膝高低自适应；地板排除「纯站姿微小抖动」级噪声
 * （即便入段，仍有门控2每侧 ≥3 strike 兜底）。
 */
function marchEnergyThresholds(s: Sample[]): { enter: number; exit: number } {
  const energies = s.filter((q) => q.ok).map((q) => q.energy)
  const enter = Math.max(MARCH_ENTER_FLOOR_PX_S, quantile(energies, MARCH_ENTER_QUANTILE))
  return { enter, exit: enter * MARCH_EXIT_RATIO }
}

/**
 * 切段并返回完整可观测诊断（SegmentSelectionInfo）。
 * selectSegments 为本函数的轻量包装（仅取 ValidSegment[]）。
 */
export function selectSegmentsWithInfo(frames: PoseFrame[]): SegmentSelectionResult {
  const s = buildSamples(frames)
  const mode = detectMode(s)
  const { enter: enterThreshold, exit: exitThreshold } = marchEnergyThresholds(s)
  const segments: ValidSegment[] = []
  let state: State = 'idle'
  let segStartIdx = -1
  const present = (q: Sample) => q.ok || q.bridged

  const close = (endIdx: number) => {
    if (segStartIdx < 0) return
    const inSeg = s.slice(segStartIdx, endIdx + 1).filter((q) => present(q))
    const real = inSeg.filter((q) => q.ok)
    const trimmed = mode === 'march' ? trimMarchSteady(inSeg) : trimSteady(inSeg)
    let start = trimmed?.start ?? real[0]?.t
    let end = trimmed?.end ?? real[real.length - 1]?.t
    // v1.3 安全回退：裁边只应削弱拍，绝不能把段裁到短于 MIN_SEGMENT_MS
    // （能量波动大时中位数带会把有效段切得过碎）；裁短了就退回真实边界。
    if (
      mode === 'march' &&
      start != null &&
      end != null &&
      end - start < MIN_SEGMENT_MS
    ) {
      start = real[0]?.t
      end = real[real.length - 1]?.t
    }
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
        if (q.ok && q.energy >= enterThreshold) {
          state = 'march'
          segStartIdx = i
        }
      } else if (q.ok && q.energy < exitThreshold) {
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

  segments.sort((a, b) => a.startMs - b.startMs)

  const validSamples = s.filter((q) => q.ok)
  const xs = validSamples.map((q) => q.x)
  const energies = validSamples.map((q) => q.energy)
  const info: SegmentSelectionInfo = {
    mode,
    hipRangePx: xs.length ? Math.max(...xs) - Math.min(...xs) : 0,
    marchHipRangePx: MARCH_HIP_RANGE_PX,
    segmentCount: segments.length,
    segments: segments.map((seg) => ({
      startMs: seg.startMs,
      endMs: seg.endMs,
      durationMs: seg.endMs - seg.startMs,
      direction: seg.direction,
    })),
    energyMedianPxS: median(energies.filter((v) => v > 0)),
    energyPeakPxS: energies.length ? Math.max(...energies) : 0,
    energyEnterPxS: enterThreshold,
    energyExitPxS: exitThreshold,
    legacyEnterPxS: 120,
  }
  return { mode, segments, info }
}

export function selectSegments(frames: PoseFrame[]): ValidSegment[] {
  return selectSegmentsWithInfo(frames).segments
}
