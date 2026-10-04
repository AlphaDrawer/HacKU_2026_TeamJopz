import type { PoseFrame, ScaleHint, ScaleInfo } from '../contracts/types'
import {
  NOSE,
  LEFT_ANKLE,
  RIGHT_ANKLE,
  VISIBILITY_THRESHOLD,
  BODY_NOSE_TO_ANKLE_RATIO,
  VIRTUAL_WIDTH_PX as W,
  VIRTUAL_HEIGHT_PX as H,
} from './constants'

/**
 * scaleCalibrator（§4.1 / §5.3）：把像素尺度换算成物理尺度（米）。
 *
 * 支持方式（由 ScaleHint 决定）：
 *  - height：输入身高，用「鼻-踝像素距 ≈ 0.875×身高」反推 pixelsPerMeter（默认）；
 *  - step：输入已知步长（米），用跨段平均步幅像素距反推；
 *  - manual：直接给出参考物的 pixelsPerMeter；
 *  - tile：预留（需地砖参考物），当前无数据时按 none 处理。
 * 未提供任何可用线索时 method='none'、calibrated=false，此时速度/步幅
 * 返回 value=null、level='none'，绝不硬报物理值。纯函数。
 */

function median(nums: number[]): number {
  const a = [...nums].filter(Number.isFinite).sort((x, y) => x - y)
  return a[Math.floor(a.length / 2)] ?? NaN
}

/** 跨全部帧的鼻-踝像素距中位数 */
function noseAnklePx(frames: PoseFrame[]): number {
  const ds: number[] = []
  for (const f of frames) {
    const n = f.landmarks[NOSE]
    const la = f.landmarks[LEFT_ANKLE]
    const ra = f.landmarks[RIGHT_ANKLE]
    if (n.visibility < VISIBILITY_THRESHOLD) continue
    const ankle =
      la.visibility >= VISIBILITY_THRESHOLD
        ? la
        : ra.visibility >= VISIBILITY_THRESHOLD
          ? ra
          : null
    if (!ankle) continue
    ds.push(Math.hypot((n.x - ankle.x) * W, (n.y - ankle.y) * H))
  }
  return median(ds)
}

/** 跨段平均步幅像素距（同侧相邻重击之间髋中心的水平位移中位数） */
export function meanStridePx(
  frames: PoseFrame[],
  events: { side: 'left' | 'right'; timestampMs: number }[]
): number {
  const byT = new Map(frames.map((f) => [f.timestampMs, f]))
  const hipX = (f: PoseFrame | undefined) =>
    f ? ((f.landmarks[23].x + f.landmarks[24].x) / 2) * W : NaN
  const ds: number[] = []
  for (const side of ['left', 'right'] as const) {
    const ts = events.filter((e) => e.side === side).map((e) => e.timestampMs).sort((a, b) => a - b)
    for (let i = 1; i < ts.length; i++) {
      const dx = Math.abs(hipX(byT.get(ts[i])) - hipX(byT.get(ts[i - 1])))
      if (Number.isFinite(dx) && dx > 0) ds.push(dx)
    }
  }
  return median(ds)
}

export function calibrateScale(
  frames: PoseFrame[],
  events: { side: 'left' | 'right'; timestampMs: number }[],
  hint?: ScaleHint
): ScaleInfo {
  if (hint?.method === 'manual') {
    const ppm = hint.referenceLengthM
    // manual 约定：referenceLengthM 直接作为 pixelsPerMeter 传入（由前端保证语义）
    if (ppm && ppm > 0) {
      return { calibrated: true, pixelsPerMeter: ppm, method: 'manual', confidence: 0.9 }
    }
  }

  if (hint?.method === 'height' && hint.referenceLengthM && hint.referenceLengthM > 0) {
    const dPx = noseAnklePx(frames)
    if (Number.isFinite(dPx) && dPx > 0) {
      const bodyM = hint.referenceLengthM * BODY_NOSE_TO_ANKLE_RATIO
      return {
        calibrated: true,
        pixelsPerMeter: dPx / bodyM,
        method: 'height',
        confidence: 0.75,
      }
    }
  }

  if (hint?.method === 'step' && hint.referenceLengthM && hint.referenceLengthM > 0) {
    const stridePx = meanStridePx(frames, events)
    if (Number.isFinite(stridePx) && stridePx > 0) {
      return {
        calibrated: true,
        pixelsPerMeter: stridePx / hint.referenceLengthM,
        method: 'step',
        confidence: 0.6,
      }
    }
  }

  if (hint?.method === 'tile') {
    // 地砖参考物需前端提供额外像素测量，当前契约未携带，按不可用处理
    return { calibrated: false, method: 'none', confidence: 0 }
  }

  return { calibrated: false, method: 'none', confidence: 0 }
}
