/* 分析结果在显示层的合并与表格渲染（不持有会话/画布状态）。 */
import type { AnalysisEnvelope, AnalysisMarker } from './analysis_chart.js';
import { STATE_COLORS, escapeHtml } from './analysis_workbench_meta.js';

export interface CompareResult {
  state_id: string;
  label: string;
  envelope: AnalysisEnvelope;
}

export function mergeCompareEnvelopes(results: CompareResult[]): AnalysisEnvelope {
  const base: AnalysisEnvelope = JSON.parse(JSON.stringify(results[0].envelope)) as AnalysisEnvelope;
  base.curves = [];
  base.markers = [];
  results.forEach((result, index) => {
    const color = STATE_COLORS[index % STATE_COLORS.length];
    for (const curve of result.envelope.curves) {
      const cloned: typeof curve = JSON.parse(JSON.stringify(curve)) as typeof curve;
      cloned.id = curve.id + '@' + result.state_id;
      cloned.label = result.label + ' · ' + curve.label;
      cloned.detail = { ...(cloned.detail || {}), color };
      base.curves.push(cloned);
    }
    for (const marker of result.envelope.markers) {
      const cloned: AnalysisMarker = JSON.parse(JSON.stringify(marker)) as AnalysisMarker;
      cloned.id = marker.id + '@' + result.state_id;
      cloned.label = result.label + ' · ' + marker.label;
      base.markers.push(cloned);
    }
  });
  base.analysis_id = 'compare-' + results.map((item) => item.state_id).join('-');
  return base;
}

export function compareTableHtml(results: CompareResult[]): string {
  const keys = new Set<string>();
  for (const result of results) {
    const metrics = result.envelope.metrics || {};
    for (const key of Object.keys(metrics)) if (!['metrics', 'bode'].includes(key)) keys.add(key);
    const nested = metrics['metrics'];
    if (nested && typeof nested === 'object') for (const key of Object.keys(nested as Record<string, unknown>)) keys.add(key);
  }
  const rows = Array.from(keys).slice(0, 24).map((key) => {
    const cells = results.map((result) => {
      const metrics = result.envelope.metrics || {};
      const nested = metrics['metrics'];
      const value = (nested && typeof nested === 'object' && key in (nested as Record<string, unknown>))
        ? (nested as Record<string, unknown>)[key]
        : metrics[key];
      return '<td class="num">' + escapeHtml(typeof value === 'number' ? Number(value.toPrecision(7)) : value ?? '—') + '</td>';
    }).join('');
    return '<tr><th>' + escapeHtml(key) + '</th>' + cells + '</tr>';
  }).join('');
  return '<div class="analysis-detail-section"><h4>多状态对比</h4>'
    + '<table class="analysis-detail-table"><thead><tr><th>指标</th>'
    + results.map((result, index) => '<th style="color:' + STATE_COLORS[index % STATE_COLORS.length] + '">' + escapeHtml(result.label) + '</th>').join('')
    + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

export function metricsHtml(raw: Record<string, unknown>): string {
  const metrics = (raw['metrics'] || raw) as Record<string, unknown>;
  const rows = Object.entries(metrics).slice(0, 60).map(([key, value]) => {
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return '<tr><th>' + escapeHtml(key) + '</th><td class="num">' + escapeHtml(text) + '</td></tr>';
  }).join('');
  return '<div class="analysis-detail-section"><h4>指标</h4><table class="analysis-detail-table"><tbody>'
    + (rows || '<tr><td>无指标</td></tr>') + '</tbody></table></div>';
}
