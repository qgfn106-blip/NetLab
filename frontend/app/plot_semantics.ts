// C-3 / N-14：帧数据 → 绘图语义的唯一映射。
// 老 canvas（drawWbSubplot）与内嵌 PlotKitRenderer 都使用本模块，避免线宽/字段/降采样各写一套。
import { PLOT_SEMANTICS } from './contracts.js';

export { PLOT_SEMANTICS };

export interface FrameSeriesPoint {
  x: number[];
  y: number[];
}

export interface PlotLineLayer {
  kind: 'line';
  data: { x: string; y: string };
  style: { color: string; width: number };
  label: string;
  legend: boolean;
}

/** 把 time/values 两列帧数据映射为绘图坐标点（同源、同一降采样上限）。 */
export function frameSeriesToPoints(
  time: readonly number[],
  values: readonly number[],
  limit: number = PLOT_SEMANTICS.maxPoints,
): FrameSeriesPoint {
  const n = Math.min(time.length, values.length, limit);
  const x: number[] = new Array(n);
  const y: number[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    x[i] = time[i];
    y[i] = values[i];
  }
  return { x, y };
}

/** 两条渲染路径共享的曲线样式。 */
export function plotLineStyle(): { mode: 'lines'; width: number; marker: { symbol: string } } {
  return { mode: 'lines', width: PLOT_SEMANTICS.lineWidth, marker: { symbol: '' } };
}

/** 构造 PlotKit 图层，字段引用与线宽均来自唯一语义。 */
export function buildPlotLineLayers(
  signals: readonly string[],
  columns: Record<string, ArrayLike<number> | undefined>,
  colorForKey: (key: string) => string,
): PlotLineLayer[] {
  const layers: PlotLineLayer[] = [];
  for (const key of signals) {
    const values = columns[key];
    if (!values || !values.length) continue;
    layers.push({
      kind: 'line',
      data: { x: PLOT_SEMANTICS.timeField, y: key },
      style: { color: colorForKey(key), width: PLOT_SEMANTICS.lineWidth },
      label: key,
      legend: true,
    });
  }
  return layers;
}
