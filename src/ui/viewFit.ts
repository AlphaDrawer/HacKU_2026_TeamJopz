/**
 * ui/viewFit.ts（object-fit: contain 映射工具）
 * ------------------------------------------------------------------
 * 计算把一个「源矩形（视频）」等比缩放进「目标矩形（画布/容器）」
 * 时的 letterbox 变换（contain：完整显示、可能留黑边）。
 *
 * 关键点是【归一化坐标要用源视频自身宽高比】换算，而不是直接乘画布
 * 宽高——否则当视频与画布宽高比不一致时，骨架会相对视频拉伸/错位
 * （这正是旧版 SkeletonRenderer 的 bug 根因）。
 */

export interface FitTransform {
  /** 等比缩放比例（源像素 → 目标像素，宽高同一比例） */
  scale: number;
  /** 内容在目标矩形内的左上偏移（letterbox 留白） */
  offsetX: number;
  offsetY: number;
  /** 内容实际绘制宽高 */
  drawWidth: number;
  drawHeight: number;
}

/**
 * 计算 contain 变换。
 * @param sourceW/H 视频内容宽高
 * @param targetW/H 画布/容器宽高
 */
export function computeContain(
  sourceW: number,
  sourceH: number,
  targetW: number,
  targetH: number,
): FitTransform {
  const scale = Math.min(targetW / sourceW, targetH / sourceH);
  const drawWidth = sourceW * scale;
  const drawHeight = sourceH * scale;
  return {
    scale,
    offsetX: (targetW - drawWidth) / 2,
    offsetY: (targetH - drawHeight) / 2,
    drawWidth,
    drawHeight,
  };
}
