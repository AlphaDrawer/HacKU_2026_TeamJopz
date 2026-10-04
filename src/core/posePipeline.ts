import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from '@mediapipe/tasks-vision'
import type { PoseFrame } from '../contracts/types'

/**
 * posePipeline（§5.5）：MediaPipe PoseLandmarker 薄封装。
 * 不自己 getUserMedia、不查询 DOM；视频元素由前端传入。
 *  - 模型 URL 由 initPose(modelAssetUrl) 传入（前端用 BASE_URL 拼同源地址）；
 *  - WASM 运行时默认走同源 `<部署根>/wasm`：根目录从模型 URL 的 `/models/`
 *    前缀反推（GitHub Pages 子路径部署也成立），可被全局 __WASM_BASE__ 覆盖；
 *  - GPU 初始化失败回退 CPU；运行期推理异常自动降级 CPU（只降一次）；
 *  - initPose 幂等，避免多走几次后 WebGL 上下文泄漏。
 *
 * 说明：本模块含模型初始化副作用，不属于纯函数；core 其余算法模块保持纯函数。
 */

/**
 * 解析 wasm 所在目录（结尾带 "/"）。
 * 原先用 new URL('../../', import.meta.url) 推导，在 Pages 子路径部署时会回退
 * 到域名根目录（…/assets/index.js 的上两级已越过部署根），导致 wasm 404。
 * 改为从模型 URL 反推：`<…>/models/pose.task` → `<…>/wasm`。
 */
function resolveWasmBase(modelAssetUrl: string): string {
  const override = (globalThis as { __WASM_BASE__?: string }).__WASM_BASE__
  if (override) return override.endsWith('/') ? override : `${override}/`
  const mi = modelAssetUrl.indexOf('/models/')
  if (mi >= 0) {
    // 部署根 = 模型 URL 中 "/models/" 之前的部分；wasm 与 models 同级
    return `${modelAssetUrl.slice(0, mi + 1)}wasm/`
  }
  // 模型路径不符合 `<根>/models/…` 约定：按根路径部署的相对位置兜底
  return '/wasm/'
}

let landmarker: PoseLandmarker | null = null
let delegate: 'GPU' | 'CPU' = 'GPU'
let initPromise: Promise<void> | null = null
let downgradePromise: Promise<void> | null = null
let frameSeq = 0
let wasmDir = ''

async function create(delegateName: 'GPU' | 'CPU', modelAssetUrl: string, wasmDir: string): Promise<PoseLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(wasmDir)
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: modelAssetUrl, delegate: delegateName },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  })
}

async function build(modelAssetUrl: string): Promise<void> {
  wasmDir = resolveWasmBase(modelAssetUrl)
  try {
    landmarker = await create('GPU', modelAssetUrl, wasmDir)
    delegate = 'GPU'
  } catch {
    landmarker = await create('CPU', modelAssetUrl, wasmDir)
    delegate = 'CPU'
  }
}

export function initPose(modelAssetUrl: string): Promise<void> {
  if (landmarker) return Promise.resolve()
  if (!initPromise) {
    initPromise = build(modelAssetUrl).finally(() => {
      initPromise = null
    })
  }
  return initPromise
}

async function downgradeToCpu(modelAssetUrl: string): Promise<void> {
  if (delegate === 'CPU') return
  if (!downgradePromise) {
    downgradePromise = (async () => {
      const old = landmarker
      landmarker = await create('CPU', modelAssetUrl, wasmDir)
      delegate = 'CPU'
      old?.close()
    })().finally(() => {
      downgradePromise = null
    })
  }
  return downgradePromise
}

/** 未检出姿态返回 null（§5.5：null 非崩溃） */
export async function inferFrame(
  video: HTMLVideoElement,
  timestampMs: number,
  modelAssetUrl?: string
): Promise<PoseFrame | null> {
  if (!landmarker) throw new Error('posePipeline not initialized: call initPose first')
  const t0 = performance.now()
  let result: PoseLandmarkerResult
  try {
    result = landmarker.detectForVideo(video, timestampMs)
  } catch {
    if (delegate === 'GPU' && modelAssetUrl) {
      await downgradeToCpu(modelAssetUrl).catch(() => {})
    }
    return null
  }
  const inferMs = performance.now() - t0
  const lm = result.landmarks?.[0]
  if (!lm || lm.length === 0) return null
  frameSeq += 1
  return { frameId: frameSeq, timestampMs, landmarks: lm, inferMs }
}

export function activeDelegate(): 'GPU' | 'CPU' {
  return delegate
}
