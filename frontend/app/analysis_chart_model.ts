/* 分析曲线图：纯视图模型层。
 *
 * 只包含数值区间、轴分面与视图覆盖等纯函数，不触 DOM、不依赖 render/interaction，
 * 供 facade（analysis_chart.ts）与 interaction 层复用（P3-05 分层）。
 */
import type { AnalysisAxis, AnalysisEnvelope, ChartView } from './analysis_chart_types.js';

export function clampRange(lo: number, hi: number): [number, number] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (hi - lo > 1e-12) return [lo, hi];
  const pad = Math.max(Math.abs(lo) * 0.1, 1e-9);
  return [lo - pad, hi + pad];
}

export function paddedRange(lo: number, hi: number, fraction = 0.05): [number, number] {
  const [a, b] = clampRange(lo, hi);
  const span = b - a;
  return [a - span * fraction, b + span * fraction];
}

export function logSafeRange(lo: number, hi: number): [number, number] {
  if (!(lo > 0) || !(hi > 0)) return [1, 10];
  const la = Math.log10(lo) - 0.02;
  const lb = Math.log10(hi) + 0.02;
  return [Math.pow(10, la), Math.pow(10, lb)];
}

export function axisMap(envelope: AnalysisEnvelope): Map<string, AnalysisAxis> {
  return new Map(envelope.axes.map((axis) => [axis.id, axis]));
}

export function panelCount(envelope: AnalysisEnvelope): number {
  if (envelope.kind !== 'bode') return 1;
  return envelope.curves.some((curve) => curve.axes[1] === 'phase_deg') ? 2 : 1;
}

export function panelFor(envelope: AnalysisEnvelope, axisId: string): number {
  if (envelope.kind !== 'bode') return 0;
  if (axisId === 'phase_deg') return 1;
  return 0;
}

export function overridesFromView(view: ChartView | null): Record<number, { xlim?: number[]; ylim?: number[] }> {
  if (!view) return {};
  const out: Record<number, { xlim?: number[]; ylim?: number[] }> = {};
  for (const [slotText, ylim] of Object.entries(view.ylims)) {
    out[Number(slotText)] = { xlim: view.xlim, ylim };
  }
  return out;
}
