/* 分析曲线图：交互层纯函数。
 *
 * 负责指针命中测试（标记点、最近曲线）与框选区间换算，输出纯数据；
 * 不触 DOM、不读写图表实例状态（P3-05 分层，依赖 model 层）。
 */
import type { AnalysisCurve, AnalysisEnvelope, AnalysisMarker } from './analysis_chart_types.js';
import type { PlotAxis } from './analysis_chart_plot.js';
import { clampRange, panelFor } from './analysis_chart_model.js';

export function nearestMarker(
  envelope: AnalysisEnvelope,
  axis: PlotAxis,
  visibleCategories: Set<string>,
  px: number,
  py: number,
): AnalysisMarker | null {
  let bestMarker: AnalysisMarker | null = null;
  let bestDist = 12;
  for (const marker of envelope.markers) {
    if (!visibleCategories.has(marker.category)) continue;
    if (panelFor(envelope, marker.axis_y) !== axis.slot) continue;
    const mx = axis.sx.to(marker.x);
    const my = axis.sy.to(marker.y);
    if (mx === null || my === null) continue;
    const dist = Math.hypot(mx - px, my - py);
    if (dist < bestDist) {
      bestDist = dist;
      bestMarker = marker;
    }
  }
  return bestMarker;
}

export function nearestCurve(
  envelope: AnalysisEnvelope,
  axis: PlotAxis,
  px: number,
): { curve: AnalysisCurve; index: number } | null {
  let best: { curve: AnalysisCurve; index: number; distance: number } | null = null;
  for (const curve of envelope.curves) {
    if (panelFor(envelope, curve.axes[1]) !== axis.slot) continue;
    for (let i = 0; i < curve.x.length; i++) {
      const mx = axis.sx.to(curve.x[i]);
      if (mx === null) continue;
      const distance = Math.abs(mx - px);
      if (!best || distance < best.distance) best = { curve, index: i, distance };
    }
  }
  return best ? { curve: best.curve, index: best.index } : null;
}

export function boxSelectionRange(
  axis: PlotAxis,
  startPx: number,
  startPy: number,
  currentPx: number,
  currentPy: number,
): { xlim: [number, number]; ylim: [number, number] } | null {
  if (Math.abs(currentPx - startPx) <= 4 || Math.abs(currentPy - startPy) <= 4) return null;
  const x0 = axis.sx.from(Math.min(startPx, currentPx));
  const x1 = axis.sx.from(Math.max(startPx, currentPx));
  const y0 = axis.sy.from(Math.max(startPy, currentPy));
  const y1 = axis.sy.from(Math.min(startPy, currentPy));
  return { xlim: clampRange(Math.min(x0, x1), Math.max(x0, x1)), ylim: clampRange(Math.min(y0, y1), Math.max(y0, y1)) };
}
