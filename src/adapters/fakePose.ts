/**
 * fakePose.ts（合成姿态生成：仅用于测试与离线演示）
 * ------------------------------------------------------------------
 * 目的：用确定性的数学公式生成「看起来在走路」的 PoseFrame（含左右踝
 * 交替摆动 + 整体向前平移），让
 *   假帧 → 事件 → AnalyzeResult →（成功）存库 → 历史
 * 这条链路可以端到端跑通并被测试覆盖，而无需加载真实模型/wasm。
 *
 * 【关键】这里产出的数值是【合成假数据】，绝不被当作真实临床结果；
 * 生产测量路径走 src/core，本文件不参与。
 *
 * 归一化坐标系：x/y 均为 0..1，y 向下为正（与 MediaPipe 一致）。
 */
import type { Landmark, PoseFrame } from "../contracts/types";

export const FAKE_VIDEO_WIDTH = 360;
export const FAKE_VIDEO_HEIGHT = 640;

/** 帧间隔 33ms ≈ 30fps */
export const FRAME_STEP_MS = 33;

/** 关键点数量（MediaPipe Pose 的 33 个点） */
const LANDMARK_COUNT = 33;

function baseLandmarks(): Landmark[] {
  const points: Landmark[] = [];
  for (let i = 0; i < LANDMARK_COUNT; i += 1) {
    points.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 });
  }
  return points;
}

/** MediaPipe Pose 关键点索引（只列本演示用到的） */
export const POSE_INDEX = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
} as const;

export interface FakeGaitOptions {
  /** 步态周期（ms/周期），默认 520ms */
  cycleMs?: number;
  /** 前进速度（归一化 x / 秒），用于让髋中心缓慢平移 */
  forwardPerSec?: number;
}

/**
 * 根据「已流逝时间」生成一帧合成姿态。
 * @param elapsedMs 从测量开始计的时间
 * @param frameId   单调帧号
 */
export function generateFakeFrame(elapsedMs: number, frameId: number, options: FakeGaitOptions = {}): PoseFrame {
  const cycleMs = options.cycleMs ?? 520;
  const forwardPerSec = options.forwardPerSec ?? 0.08;

  const points = baseLandmarks();
  const phase = (elapsedMs % cycleMs) / cycleMs; // 0..1 的步态相位
  const angle = phase * Math.PI * 2;

  // 髋中心随时间缓慢向右平移（去程），并夹在画面内
  const progress = (elapsedMs / 1000) * forwardPerSec;
  const hipX = Math.min(0.78, 0.22 + progress);
  const hipY = 0.52;

  // 左右踝垂直摆动：相位相差 π，保证左右交替；
  // 站立/着地时 y 更大（更靠下）→ 用 1 - cos 让谷底在相位 0
  const swing = 0.06;
  const leftLift = (1 - Math.cos(angle)) * 0.5; // 0(着地) .. 1(摆动中)
  const rightLift = (1 - Math.cos(angle + Math.PI)) * 0.5;

  const leftAnkleY = hipY + 0.24 - swing * leftLift;
  const rightAnkleY = hipY + 0.24 - swing * rightLift;
  const leftAnkleX = hipX - 0.05 + Math.sin(angle) * 0.02;
  const rightAnkleX = hipX + 0.05 - Math.sin(angle) * 0.02;

  const set = (index: number, x: number, y: number, visibility = 0.95): void => {
    points[index] = { x, y, z: 0, visibility };
  };

  set(POSE_INDEX.LEFT_SHOULDER, hipX - 0.05, hipY - 0.22, 0.9);
  set(POSE_INDEX.RIGHT_SHOULDER, hipX + 0.05, hipY - 0.22, 0.9);
  set(POSE_INDEX.LEFT_HIP, hipX - 0.03, hipY, 0.97);
  set(POSE_INDEX.RIGHT_HIP, hipX + 0.03, hipY, 0.97);
  set(POSE_INDEX.LEFT_KNEE, (hipX - 0.03 + leftAnkleX) / 2, (hipY + leftAnkleY) / 2, 0.96);
  set(POSE_INDEX.RIGHT_KNEE, (hipX + 0.03 + rightAnkleX) / 2, (hipY + rightAnkleY) / 2, 0.96);
  set(POSE_INDEX.LEFT_ANKLE, leftAnkleX, leftAnkleY, 0.96);
  set(POSE_INDEX.RIGHT_ANKLE, rightAnkleX, rightAnkleY, 0.92);

  return {
    frameId,
    timestampMs: elapsedMs,
    landmarks: points,
    inferMs: 1, // 合成推理极快
  };
}
