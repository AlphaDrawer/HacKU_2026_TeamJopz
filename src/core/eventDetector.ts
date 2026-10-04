import type { GaitEvent, PoseFrame, Side, ValidSegment } from '../contracts/types'
import {
  LEFT_ANKLE,
  RIGHT_ANKLE,
  LEFT_HIP,
  RIGHT_HIP,
  LEFT_KNEE,
  RIGHT_KNEE,
  VISIBILITY_THRESHOLD,
  DEFAULT_SHANK_RATIO,
  MIN_STRIKE_GAP_MS,
  MIN_PROMINENCE_RATIO,
  PROMINENCE_WINDOW,
  STRIKE_SPEED_REF_PX_S,
  VIRTUAL_WIDTH_PX as W,
  VIRTUAL_HEIGHT_PX as H,
} from './constants'

/**
 * eventDetector（§4.1）：在中段直线段内检测左右 heelStrike。
 *
 * 侧面走测时，摆动期踝抬离地面、跟着地(heelStrike)时落回最低点。屏幕坐标
 * y 向下为正，故「着地」对应 y 的【局部最大值】，摆动中期对应局部最小。
 * 检测条件：踝 visibility≥0.5；同侧相邻重击间隔≥0.45s；峰相对邻域谷的
 * 落差≥平均小腿长 6%；并用「带谷确认的滞回」避免站姿坦平台一击多点。
 * 纯函数，输出事件，不碰 DOM。
 */

interface Pt {
  t: number
  y: number
  x: number
  vis: number
  vx: number
}

function sideIndices(side: Side) {
  return side === 'left'
    ? { ankle: LEFT_ANKLE, knee: LEFT_KNEE, hip: LEFT_HIP }
    : { ankle: RIGHT_ANKLE, knee: RIGHT_KNEE, hip: RIGHT_HIP }
}

const inSegment = (f: PoseFrame, seg: ValidSegment) =>
  f.timestampMs >= seg.startMs && f.timestampMs <= seg.endMs

function buildSeries(frames: PoseFrame[], seg: ValidSegment, side: Side): Pt[] {
  const { ankle } = sideIndices(side)
  const pts: Pt[] = frames
    .filter((f) => inSegment(f, seg))
    .map((f) => ({
      t: f.timestampMs,
      y: f.landmarks[ankle].y * H,
      x: f.landmarks[ankle].x * W,
      vis: f.landmarks[ankle].visibility,
      vx: 0,
    }))
  const dirSign = seg.direction === 'out' ? 1 : -1
  for (let i = 1; i < pts.length - 1; i++) {
    const dtSec = (pts[i + 1].t - pts[i - 1].t) / 1000
    pts[i].vx = dtSec > 0 ? (dirSign * (pts[i + 1].x - pts[i - 1].x)) / dtSec : 0
  }
  return pts
}

function meanShankLength(frames: PoseFrame[], seg: ValidSegment, side: Side): number {
  const { knee, hip } = sideIndices(side)
  let sum = 0
  let n = 0
  for (const f of frames) {
    if (!inSegment(f, seg)) continue
    const k = f.landmarks[knee]
    const h = f.landmarks[hip]
    if (k.visibility < VISIBILITY_THRESHOLD || h.visibility < VISIBILITY_THRESHOLD) continue
    sum += Math.hypot((k.x - h.x) * W, (k.y - h.y) * H)
    n++
  }
  return n > 0 ? sum / n : H * DEFAULT_SHANK_RATIO
}

function detectSideStrikes(
  pts: Pt[],
  minProminencePx: number
): Array<{ t: number; confidence: number }> {
  const peaks: number[] = []
  const isLocalMax = (i: number) => {
    const left = i > 0 ? pts[i - 1].y : -Infinity // 首帧：只要求不低于右侧
    const right = i < pts.length - 1 ? pts[i + 1].y : -Infinity // 末帧：只要求不低于左侧
    return pts[i].y >= left && pts[i].y >= right
  }
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    if (p.vis < VISIBILITY_THRESHOLD) continue
    // 站姿坦平台的一击多点由后面的「谷确认滞回」压制
    if (isLocalMax(i)) peaks.push(i)
  }

  const strikes: Array<{ t: number; confidence: number }> = []
  let lastAcceptedIdx = -1
  for (const i of peaks) {
    const p = pts[i]
    const lo = Math.max(0, i - PROMINENCE_WINDOW)
    const hi = Math.min(pts.length - 1, i + PROMINENCE_WINDOW)
    let valley = p.y
    for (let j = lo; j <= hi; j++) valley = Math.min(valley, pts[j].y)
    if (p.y - valley < minProminencePx) continue

    if (lastAcceptedIdx >= 0) {
      const last = pts[lastAcceptedIdx]
      if (p.t - last.t < MIN_STRIKE_GAP_MS) continue
      let between = p.y
      for (let j = lastAcceptedIdx + 1; j < i; j++) between = Math.min(between, pts[j].y)
      if (p.y - between < minProminencePx) continue
    }

    const speedFactor = Math.max(0, 1 - Math.abs(p.vx) / STRIKE_SPEED_REF_PX_S)
    const confidence = Math.min(1, 0.6 * p.vis + 0.4 * speedFactor)
    strikes.push({ t: p.t, confidence })
    lastAcceptedIdx = i
  }
  return strikes
}

/** 在一个切段上检测左右 heelStrike（按时间升序），写入 seg.events 的副本 */
export function detectEventsInSegment(
  frames: PoseFrame[],
  seg: ValidSegment
): GaitEvent[] {
  const events: GaitEvent[] = []
  for (const side of ['left', 'right'] as Side[]) {
    const pts = buildSeries(frames, seg, side)
    const shankPx = meanShankLength(frames, seg, side)
    for (const s of detectSideStrikes(pts, shankPx * MIN_PROMINENCE_RATIO)) {
      events.push({ type: 'heelStrike', side, timestampMs: s.t, confidence: s.confidence })
    }
  }
  return events.sort((a, b) => a.timestampMs - b.timestampMs)
}
