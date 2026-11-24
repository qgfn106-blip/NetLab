/* 分析曲线图的 PlotKit spec 组装（render 层纯函数）。
 * 从 analysis_chart.ts 抽出，只依赖信封/外观/视图状态，不触碰 DOM 与实例生命周期。
 */
import { MARKER_COLORS, MARKER_SYMBOLS, nyquistExtras } from './analysis_chart_detail.js';
import type { ChartAppearance } from './analysis_chart_appearance.js';
import type { AnalysisAxis, AnalysisEnvelope, AnalysisMarker, ChartView } from './analysis_chart_types.js';

function panelFor(envelope: AnalysisEnvelope, axisId: string): number {
  if (envelope.kind !== 'bode') return 0;
  if (axisId === 'phase_deg') return 1;
  return 0;
}

function panelCount(envelope: AnalysisEnvelope): number {
  if (envelope.kind !== 'bode') return 1;
  return envelope.curves.some((curve) => curve.axes[1] === 'phase_deg') ? 2 : 1;
}

function resolvedScale(setting: 'auto' | 'linear' | 'log', axis: AnalysisAxis | undefined): 'linear' | 'log' {
  if (setting !== 'auto') return setting;
  return axis?.scale === 'log10' ? 'log' : 'linear';
}

function gridView(a: ChartAppearance): Record<string, unknown> {
  return {
    grid: a.grid,
    grid_x: a.grid_x,
    grid_y: a.grid_y,
    grid_width: a.grid_width,
    grid_style: a.grid_style,
    grid_opacity: a.grid_opacity,
    ...(a.grid_color ? { grid_color: a.grid_color } : {}),
  };
}

export function buildChartSpec(
  envelope: AnalysisEnvelope,
  axes: Map<string, AnalysisAxis>,
  appearance: ChartAppearance,
  view: ChartView | null,
  visibleCategories: Set<string>,
  pinned: AnalysisMarker | null,
): unknown {
    const layers: unknown[] = [];
    const panels = panelCount(envelope);
    const a = appearance;
    const grid = gridView(a);
    const numberOrNull = (raw: string): number | null => {
      if (!raw.trim()) return null;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const limitPair = (minRaw: string, maxRaw: string): [number, number] | null => {
      const min = numberOrNull(minRaw);
      const max = numberOrNull(maxRaw);
      return min !== null && max !== null && min < max ? [min, max] : null;
    };
    const dashFor = (curveId: string, legacy: boolean): number[] => {
      const style = a.curve_styles[curveId];
      if (!style) return legacy ? [7, 4] : [];
      if (style === 'dashed') return [7, 4];
      if (style === 'dotted') return [2, 3];
      if (style === 'dashdot') return [8, 3, 2, 3];
      return [];
    };
    const xlim = limitPair(a.x_min, a.x_max) || view?.xlim;
    for (const curve of envelope.curves) {
      const slot = panelFor(envelope, curve.axes[1]);
      const yAxis = axes.get(curve.axes[1]);
      const xAxis = axes.get(curve.axes[0]);
      const detailColor = typeof curve.detail?.color === 'string' ? curve.detail.color : '';
      const baseColor = detailColor || (curve.id.includes('phase') ? '#7a6fb0' : (curve.id.includes('loop') ? '#c98a2e' : '#9b7247'));
      const color = a.curve_colors[curve.id] || baseColor;
      const lineWidth = a.curve_widths[curve.id] || a.line_width;
      const ylim = limitPair(a.y_min, a.y_max) || view?.ylims[slot];
      const autoYLabel = yAxis ? yAxis.label + (yAxis.unit ? ' (' + yAxis.unit + ')' : '') : '';
      const autoXLabel = xAxis ? xAxis.label + (xAxis.unit ? ' (' + xAxis.unit + ')' : '') : '';
      const yLabel = slot === 1 ? (a.ylabel2.trim() || autoYLabel) : (a.ylabel.trim() || autoYLabel);
      const xLabel = slot === panels - 1 ? (a.xlabel.trim() || autoXLabel) : '';
      layers.push({
        kind: 'line',
        subplot: slot,
        label: a.curve_labels[curve.id] || curve.label,
        legend: a.legend,
        data: { x: curve.id + ':x', y: curve.id + ':y' },
        view: {
          xlim,
          ylim,
          xscale: resolvedScale(a.xscale, xAxis),
          yscale: resolvedScale(a.yscale, yAxis),
          ylabel: yLabel,
          xlabel: xLabel,
          ...grid,
        },
        style: { color, width: lineWidth, dash: dashFor(curve.id, curve.style === 'dashed'), opacity: 1 },
      });
    }
    for (const extra of nyquistExtras(envelope)) {
      layers.push({
        kind: 'line',
        subplot: 0,
        label: extra.label,
        legend: false,
        data: { x: extra.name + ':x', y: extra.name + ':y' },
        view: { xlim: view?.xlim, ylim: view?.ylims[0], xscale: 'linear', yscale: 'linear', ...grid },
        style: { color: extra.color, width: 1.1, dash: [4, 4], opacity: 0.8 },
      });
    }
    for (const marker of envelope.markers) {
      if (!a.show_markers) break;
      if (!visibleCategories.has(marker.category)) continue;
      const slot = panelFor(envelope, marker.axis_y);
      const markerXAxis = axes.get(marker.axis_x) || (envelope.curves.length ? axes.get(envelope.curves[0].axes[0]) : undefined);
      const color = MARKER_COLORS[marker.category] || '#9b7247';
      layers.push({
        kind: 'scatter',
        subplot: slot,
        label: a.show_annotations ? marker.label : '',
        legend: false,
        data: { x: [marker.x], y: [marker.y] },
        view: { xlim: view?.xlim, ylim: view?.ylims[slot], xscale: resolvedScale(a.xscale, markerXAxis), yscale: resolvedScale(a.yscale, axes.get(marker.axis_y)), ...grid },
        style: { color, width: 1.4, opacity: 1, marker: { size: pinned?.id === marker.id ? 12 : 9, symbol: MARKER_SYMBOLS[marker.shape] || 'circle' } },
      });
    }
    const figure: Record<string, unknown> = {
      subplots: panels,
      ncols: panels > 1 && a.panel_layout === 'row' ? 2 : 1,
      fonts: { title: a.font_title, axis: a.font_axis, tick: a.font_tick, legend: a.font_legend, annotation: a.font_axis },
    };
    if (a.figure_width > 0 || a.figure_height > 0) {
      figure.size = [a.figure_width > 0 ? a.figure_width : 12.2, a.figure_height > 0 ? a.figure_height : 5.6];
    }
    if (a.facecolor.trim()) figure.facecolor = a.facecolor.trim();
    if (a.text_color.trim()) figure.text_color = a.text_color.trim();
    if (a.axis_color.trim()) figure.axis_color = a.axis_color.trim();
    if (a.title.trim()) figure.title = a.title.trim();
    return { figure, layers };
}
