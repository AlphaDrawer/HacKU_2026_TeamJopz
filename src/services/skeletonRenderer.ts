/**
 * skeletonRenderer.ts（骨架绘制器，修复版）
 * ------------------------------------------------------------------
 * 修复点（对照任务要求）：
 *  1) object-fit:contain 映射：归一化坐标先按【视频自身宽高】还原成
 *     内容像素，再等比缩放置入画布（见 computeContain），骨架与视频
 *     不再因宽高比不同而错位。
 *  2) 左踝 = 红，右踝 = 蓝（旧版全绿）。
 *  3) 周期标记：把传入的 heelStrike 事件在对应踝位置画琥珀色圆环。
 *
 * 纯绘制工具：draw 一帧，不保存临床数据、不读 DOM 树（只在给定 canvas
 * 的 2D context 上作画）。
 */
import type { PoseFrame } from "../contracts/types";
import { COLORS } from "../ui/constants";
import { computeContain, type FitTransform } from "../ui/viewFit";

/** MediaPipe Pose 连接关系（只取演示需要的躯干+四肢主要段） */
const CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [11, 12], // 肩
  [11, 23], [12, 24], // 躯干
  [23, 24], // 髋
  [11, 13], [13, 15], // 左臂
  [12, 14], [14, 16], // 右臂
  [23, 25], [25, 27], // 左腿
  [24, 26], [26, 28], // 右腿
];

const LEFT_ANKLE = 27;
const RIGHT_ANKLE = 28;
const JOINTS_TO_DRAW = new Set([11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]);

/** 周期标记：事件时间 → 侧别（测量视图在完成后传入） */
export interface CycleMark {
  timestampMs: number;
  side: "left" | "right";
}

export interface DrawOptions {
  /** 视频内容宽高（用于 contain 映射） */
  videoWidth: number;
  videoHeight: number;
  /** 当前帧，可选（无帧时只清屏） */
  frame?: PoseFrame | null;
  /** 周期标记，默认无 */
  cycleMarks?: CycleMark[];
}

export class SkeletonRenderer {
  private ctx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法取得 Canvas 2D 环境");
    this.ctx = context;
  }

  /** 按 CSS 尺寸同步画布内部分辨率（考虑高分屏） */
  resize(cssWidth: number, cssHeight: number, devicePixelRatio = window.devicePixelRatio || 1): void {
    this.canvas.width = Math.round(cssWidth * devicePixelRatio);
    this.canvas.height = Math.round(cssHeight * devicePixelRatio);
    this.ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  draw(options: DrawOptions): void {
    const cssWidth = this.canvas.clientWidth;
    const cssHeight = this.canvas.clientHeight;
    this.ctx.clearRect(0, 0, cssWidth, cssHeight);

    if (!options.frame) return;

    const fit: FitTransform = computeContain(
      options.videoWidth,
      options.videoHeight,
      cssWidth,
      cssHeight,
    );

    // 归一化(0..1) → 内容像素 → 画布像素（contain）
    const project = (index: number): { x: number; y: number } => {
      const lm = options.frame!.landmarks[index];
      return {
        x: fit.offsetX + lm.x * options.videoWidth * fit.scale,
        y: fit.offsetY + lm.y * options.videoHeight * fit.scale,
      };
    };

    // 1) 骨架连线
    this.ctx.lineWidth = 3;
    this.ctx.strokeStyle = COLORS.BONE;
    this.ctx.lineCap = "round";
    CONNECTIONS.forEach(([a, b]) => {
      const pa = project(a);
      const pb = project(b);
      this.ctx.beginPath();
      this.ctx.moveTo(pa.x, pa.y);
      this.ctx.lineTo(pb.x, pb.y);
      this.ctx.stroke();
    });

    // 2) 关节点（踝按左右着色，其余统一深色）
    JOINTS_TO_DRAW.forEach((index) => {
      const p = project(index);
      let color: string = COLORS.JOINT;
      let radius = 4;
      if (index === LEFT_ANKLE) {
        color = COLORS.LEFT;
        radius = 7;
      } else if (index === RIGHT_ANKLE) {
        color = COLORS.RIGHT;
        radius = 7;
      }
      this.ctx.beginPath();
      this.ctx.fillStyle = color;
      this.ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      this.ctx.fill();
    });

    // 3) 周期标记：在对应时间最近帧的踝位置画琥珀圆环
    const marks = options.cycleMarks ?? [];
    if (marks.length && options.frame) {
      this.ctx.strokeStyle = COLORS.CYCLE;
      this.ctx.lineWidth = 2;
      marks.forEach((mark) => {
        // 只在与当前帧时间接近的标记上画，避免整段视频叠满环
        if (Math.abs(mark.timestampMs - options.frame!.timestampMs) > 40) return;
        const ankleIndex = mark.side === "left" ? LEFT_ANKLE : RIGHT_ANKLE;
        const p = project(ankleIndex);
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
        this.ctx.stroke();
      });
    }
  }
}
