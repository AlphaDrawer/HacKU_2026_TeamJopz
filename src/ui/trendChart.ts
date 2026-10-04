/**
 * ui/trendChart.ts（历史趋势小图）
 * ------------------------------------------------------------------
 * 用 SVG 绘制某个指标随时间的折线（symmetry / stability）。
 * 纯展示组件：输入 ReportRecord[]，输出一个 SVGElement，不做任何
 * 临床推算；value=null 的记录跳过不连点。
 *
 * symmetry/stability 对外都是 0–100、越大越好的百分制得分，因此
 * 纵轴固定 0–100；坐标轴刻度与点提示统一用整数格式化。
 */
import type { MetricKey, ReportRecord } from "../contracts/types";
import { formatPercent } from "./format";

const WIDTH = 320;
const HEIGHT = 140;
const PAD_TOP = 12;
const PAD_BOTTOM = 24;
const PAD_LEFT = 34;
const PAD_RIGHT = 12;

const CHART_W = WIDTH - PAD_LEFT - PAD_RIGHT;
const CHART_H = HEIGHT - PAD_TOP - PAD_BOTTOM;

/** 纵轴刻度（百分制） */
const TICKS = [0, 50, 100];

function svgEl<K extends string>(tag: K): SVGElement {
  return document.createElementNS("http://www.w3.org/2000/svg", tag);
}

/** symmetry / stability 均为 0–100 百分制；其他指标暂不支持趋势图 */
export function buildTrendChart(records: ReportRecord[], metricKey: MetricKey): SVGSVGElement {
  const svg = svgEl("svg") as SVGSVGElement;
  svg.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
  svg.setAttribute("class", "trend-chart");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${metricKey} 趋势图`);

  // 取有数值的点
  const points: Array<{ index: number; value: number }> = [];
  records.forEach((record, index) => {
    const value = record.metrics.metrics[metricKey].value;
    if (value !== null && Number.isFinite(value)) points.push({ index, value });
  });

  // 纵轴网格线与刻度（0/50/100）
  TICKS.forEach((tick) => {
    const y = yOf(tick);
    const grid = svgEl("line");
    grid.setAttribute("x1", String(PAD_LEFT));
    grid.setAttribute("x2", String(WIDTH - PAD_RIGHT));
    grid.setAttribute("y1", String(y));
    grid.setAttribute("y2", String(y));
    grid.setAttribute("class", "trend-grid");
    svg.appendChild(grid);
    const label = svgEl("text");
    label.setAttribute("x", String(PAD_LEFT - 5));
    label.setAttribute("y", String(y + 3.5));
    label.setAttribute("text-anchor", "end");
    label.setAttribute("class", "trend-tick");
    label.textContent = String(tick);
    svg.appendChild(label);
  });

  if (points.length === 0) {
    const text = svgEl("text");
    text.setAttribute("x", String(WIDTH / 2));
    text.setAttribute("y", String(HEIGHT / 2));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("class", "trend-empty");
    text.textContent = "暂无足够数据";
    svg.appendChild(text);
    return svg;
  }

  const xOf = (index: number): number => {
    const denom = records.length - 1 || 1;
    return PAD_LEFT + (index / denom) * CHART_W;
  };

  // 基线
  const line = svgEl("polyline");
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "#286b55");
  line.setAttribute("stroke-width", "2.5");
  line.setAttribute("stroke-linejoin", "round");
  line.setAttribute("stroke-linecap", "round");
  line.setAttribute("points", points.map((p) => `${xOf(p.index)},${yOf(p.value)}`).join(" "));
  svg.appendChild(line);

  // 数据点（提示文本用整数百分比，避免超长小数）
  points.forEach((p) => {
    const dot = svgEl("circle");
    dot.setAttribute("cx", String(xOf(p.index)));
    dot.setAttribute("cy", String(yOf(p.value)));
    dot.setAttribute("r", "3.2");
    dot.setAttribute("fill", "#286b55");
    const title = svgEl("title");
    title.textContent = formatPercent(p.value);
    dot.appendChild(title);
    svg.appendChild(dot);
  });

  return svg;
}

/** 百分制纵轴：100 在顶部，0 在底部 */
function yOf(value: number): number {
  const clamped = Math.max(0, Math.min(100, value));
  return PAD_TOP + (1 - clamped / 100) * CHART_H;
}
