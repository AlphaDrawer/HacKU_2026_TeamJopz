/**
 * 生成 mock PoseFrame JSON（正常 / 不对称），落盘 src/data。
 * 纯脚本，不依赖 MediaPipe；用于 Node 下单测与 demo 演示。
 *
 * 建模：侧面横走（纯侧面 → 左右踝 x 几乎重合，专门暴露 §3.3 可分性问题）。
 * 坐标系 0..1，y 向下为正；帧率 25fps。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(__dirname, '../src/data')
mkdirSync(outDir, { recursive: true })

const FPS = 20
const FRAME_MS = 1000 / FPS // 50ms；半周期 250ms=5帧，峰值精确落在采样帧上
const PASS_MS = 3000
const PAUSE_MS = 1000
const TOTAL_MS = 4 * PASS_MS + 3 * PAUSE_MS // 15000
const START_X = 0.9
const END_X = 0.1
const GROUND_Y = 0.82
const SWING_RAISE = 0.05 // 摆动期踝抬升（归一化）
const ANKLE_X_OFFSET = 0.003 // 纯侧面远/近踝极小横向差
const HIP_X_OFFSET = 0.012
const SHO_X_OFFSET = 0.012
const VIS_NEAR = 0.96
const VIS_FAR = 0.88

/**
 * 构造一次趟的 strike 时间戳（交替调度）。
 * halfToL = 上一次 R 击 → 下一次 L 击的间隔；
 * halfToR = 上一次 L 击 → 下一次 R 击的间隔。
 * L@0, R@halfToR, L@halfToR+halfToL, ...
 */
function buildStrikes(halfToL, halfToR) {
  const events = []
  let t = 0
  let expectR = true
  while (t < PASS_MS) {
    events.push({ side: expectR ? 'L' : 'R', t })
    t += expectR ? halfToR : halfToL
    expectR = !expectR
  }
  return events
}

// 每趟匀速（不建模加速起步），速度大小全程一致；到端点暂停后反向。
// 这样稳态裁边不会切掉每趟的第一个 strike，避免交替序列错位。
const SPEED_X_PER_MS = Math.abs(START_X - END_X) / PASS_MS

function hipPos(globalMs) {
  const cycle = PASS_MS + PAUSE_MS
  const idx = Math.floor(globalMs / cycle)
  const into = globalMs - idx * cycle
  const outward = idx % 2 === 0
  if (into >= PASS_MS) return outward ? END_X : START_X // 暂停停在端点
  return outward
    ? START_X - SPEED_X_PER_MS * into
    : END_X + SPEED_X_PER_MS * into
}

/**
 * 单侧踝 y：只由「到最近 strike 时刻的时间」决定，纯局部、无跨趟依赖。
 *  - |d| ≤ 50ms：踝在地面（着地帧，y 最大）；
 *  - 否则在两次着地之间做对称抬腿，摆动中点（d=半间隔）踝最高。
 * 每个 strike 帧都是被抬腿帧夹住的明确局部最大。
 */
/**
 * 单侧踝 y。给定升序 strikeTimes，定位 globalMs 所处区间 [t_i, t_{i+1}]：
 *  - 恰在 strike 帧（±25ms）→ 地面（y 最大，唯一触地帧）；
 *  - 区间内 → 以中点为摆动顶点的对称抬腿。
 * 用区间索引定位，避免浮点 nearest/indexOf 出错。
 */
const CONTACT_HALF_MS = 25

function ankleY(globalMs, strikeTimes) {
  if (strikeTimes.length === 0) return GROUND_Y - SWING_RAISE
  if (globalMs <= strikeTimes[0]) {
    return Math.abs(globalMs - strikeTimes[0]) <= CONTACT_HALF_MS ? GROUND_Y : GROUND_Y - SWING_RAISE
  }
  // 找到 i 使 t_i <= globalMs < t_{i+1}
  let i = 0
  while (i < strikeTimes.length - 1 && globalMs >= strikeTimes[i + 1]) i++
  const a = strikeTimes[i]
  const b = strikeTimes[i + 1]
  if (Math.abs(globalMs - a) <= CONTACT_HALF_MS) return GROUND_Y
  if (b == null) return GROUND_Y - SWING_RAISE
  if (Math.abs(globalMs - b) <= CONTACT_HALF_MS) return GROUND_Y
  const span = b - a
  const p = span > 0 ? (globalMs - a) / span : 0
  // p=0/1 触地，p=0.5 摆动顶点
  return GROUND_Y - SWING_RAISE * Math.sin(p * Math.PI)
}

function landmarks(globalX, globalMs, strikesL, strikesR) {
  const lms = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.001 }))
  const set = (i, x, y, z, v) => Object.assign(lms[i], { x, y, z, visibility: v })

  const hipLx = globalX - HIP_X_OFFSET
  const hipRx = globalX + HIP_X_OFFSET
  const hipY = 0.55
  set(23, hipLx, hipY, -0.01, 0.97) // L hip
  set(24, hipRx, hipY, 0.01, 0.97) // R hip

  // 膝盖
  set(25, hipLx - 0.004, 0.68, -0.01, 0.95)
  set(26, hipRx + 0.004, 0.68, 0.01, 0.9)

  // 踝（近侧=左，x 更小；远侧=右，几乎重合）
  const ayL = ankleY(globalMs, strikesL)
  const ayR = ankleY(globalMs, strikesR)
  set(27, globalX - ANKLE_X_OFFSET, ayL, -0.005, VIS_NEAR)
  set(28, globalX + ANKLE_X_OFFSET, ayR, 0.005, VIS_FAR)

  // 肩
  set(11, globalX - SHO_X_OFFSET, 0.4, -0.01, 0.97)
  set(12, globalX + SHO_X_OFFSET, 0.4, 0.01, 0.95)
  // 鼻
  set(0, globalX, 0.34, 0, 0.96)

  return lms
}

function generate(name, halfToL, halfToR) {
  const frames = []
  const n = Math.floor(TOTAL_MS / FRAME_MS)
  let frameId = 0
  for (let k = 0; k <= n; k++) {
    const globalMs = k * FRAME_MS
    const cycle = PASS_MS + PAUSE_MS
    const passIdx = Math.floor(globalMs / cycle)
    const into = globalMs - passIdx * cycle
    if (into >= PASS_MS) continue // 暂停帧不录
    // 每趟内的 strike 局部时间
    const local = into
    const ev = buildStrikes(halfToL, halfToR)
    const gx = hipPos(globalMs)
    frames.push({
      frameId: frameId++,
      timestampMs: Math.round(globalMs),
      landmarks: landmarks(gx, local, ev.filter((e) => e.side === 'L').map((e) => e.t), ev.filter((e) => e.side === 'R').map((e) => e.t)),
      inferMs: 12,
    })
  }
  const path = resolve(outDir, `mock_${name}.json`)
  writeFileSync(path, JSON.stringify(frames))
  console.log(`[gen] ${name}: ${frames.length} frames -> ${path}`)
}

// 参数为该侧的完整步周期（ms），生成器内部取半作为交替间隔
// 参数为该侧完整步周期（ms），取帧格(50ms)整数倍以保证峰值落在采样帧上
generate('normal', 500, 500)
generate('asymmetric', 700, 400)
