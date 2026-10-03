import type { PoseFrame } from '../domain/report'

const CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
]

/** Draws adapter-provided normalized keypoints. No inference is performed here. */
export function drawSkeleton(canvas: HTMLCanvasElement, frame: PoseFrame | null): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const rect = canvas.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(rect.width * dpr)
  canvas.height = Math.round(rect.height * dpr)
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, rect.width, rect.height)
  if (!frame) return
  ctx.strokeStyle = '#b9f36b'
  ctx.fillStyle = '#f2ffdf'
  ctx.lineWidth = 3
  for (const [a, b] of CONNECTIONS) {
    const first = frame.keypoints[a]
    const second = frame.keypoints[b]
    if (!first || !second || first.score < 0.5 || second.score < 0.5) continue
    ctx.beginPath()
    ctx.moveTo(first.x * rect.width, first.y * rect.height)
    ctx.lineTo(second.x * rect.width, second.y * rect.height)
    ctx.stroke()
  }
  frame.keypoints.forEach((point) => {
    if (point.score < 0.5) return
    ctx.beginPath()
    ctx.arc(point.x * rect.width, point.y * rect.height, 4, 0, Math.PI * 2)
    ctx.fill()
  })
}
