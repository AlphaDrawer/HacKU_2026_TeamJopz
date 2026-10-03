/**
 * ui/trendChart.ts（历史趋势小图）
 * ------------------------------------------------------------------
 * 用 SVG 绘制某个指标随时间的折线（symmetry / stability）。
 * 纯展示组件：输入 ReportRecord[]，输出一个 SVGElement，不做任何
 * 临床推算；value=null 的记录跳过不连点。
 */
import type { MetricKey, ReportRecord } from "../contracts/types";

const WIDTH = 320;
const HEIGHT = 120;
const PADDING = 28;

/** 数值越大越好（symmetry）；stability 是越小越好，这里仅画原始值 */
export function buildTrendChart(records: ReportRecord[], metricKey: MetricKey): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
  svg.setAttribute("class", "trend-chart");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${metricKey} 趨勢圖`);

  // 取有数值的点
  const points: Array<{ index: number; value: number }> = [];
  records.forEach((record, index) => {
    const value = record.metrics.metrics[metricKey].value;
    if (value !== null && Number.isFinite(value)) points.push({ index, value });
  });

  if (points.length === 0) {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", String(WIDTH / 2));
    text.setAttribute("y", String(HEIGHT / 2));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("class", "trend-empty");
    text.textContent = "暫無足夠資料";
    svg.appendChild(text);
    return svg;
  }

  // 值域（上下各留 10% 余量，避免贴边）
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const lo = min - span * 0.1;
  const hi = max + span * 0.1;

  const xOf = (index: number): number => {
    const denom = records.length - 1 || 1;
    return PADDING + (index / denom) * (WIDTH - PADDING * 2);
  };
  const yOf = (value: number): number =>
    HEIGHT - PADDING - ((value - lo) / (hi - lo || 1)) * (HEIGHT - PADDING * 2);

  // 基线
  const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "#286b55");
  line.setAttribute("stroke-width", "2.5");
  line.setAttribute("stroke-linejoin", "round");
  line.setAttribute("stroke-linecap", "round");
  line.setAttribute("points", points.map((p) => `${xOf(p.index)},${yOf(p.value)}`).join(" "));
  svg.appendChild(line);

  // 数据点
  points.forEach((p) => {
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", String(xOf(p.index)));
    dot.setAttribute("cy", String(yOf(p.value)));
    dot.setAttribute("r", "3.2");
    dot.setAttribute("fill", "#286b55");
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = `${p.value}`;
    dot.appendChild(title);
    svg.appendChild(dot);
  });

  return svg;
}
