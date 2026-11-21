/* 分析结果在显示层的合并与表格渲染（不持有会话/画布状态）。 */
import type { AnalysisEnvelope, AnalysisMarker } from './analysis_chart.js';
import { STATE_COLORS, escapeHtml } from './analysis_workbench_meta.js';


export interface TransferInfo {
  supported?: boolean;
  expression?: string;
  order?: number;
  relative_order?: number;
  reason?: string;
}

function readTransfer(value: unknown): TransferInfo | null {
  if (!value || typeof value !== 'object') return null;
  const info = value as TransferInfo;
  if (info.supported !== true || typeof info.expression !== 'string' || !info.expression) return null;
  return info;
}

function transferItemHtml(label: string, info: TransferInfo, output: string): string {
  const order = typeof info.order === 'number' ? String(info.order) : '—';
  const relative = typeof info.relative_order === 'number' ? String(info.relative_order) : '—';
  const suffix = output ? ' · 输出 ' + escapeHtml(output) : '';
  return '<span class="anal-transfer-item"><b>' + label + '</b> = <code>' + escapeHtml(info.expression || '') +
    '</code><span class="anal-transfer-meta">阶数 ' + order + ' · 相对阶 ' + relative + suffix + '</span></span>';
}

export function transferSummaryHtml(raw?: Record<string, unknown>): string {
  if (!raw) return '';
  const openLoop = readTransfer(raw['transfer_function']);
  const closedLoop = readTransfer(raw['closed_loop_transfer_function']);
  const role = raw['transfer_role'] === 'closed_loop' ? 'closed_loop' : 'open_loop';
  const output = typeof raw['output'] === 'string' ? raw['output'] : '';
  const items: string[] = [];
  if (role === 'closed_loop') {
    if (openLoop) items.push(transferItemHtml('闭环 T(s)', openLoop, output));
  } else {
    if (openLoop) items.push(transferItemHtml('开环 G(s)', openLoop, output));
    if (closedLoop) items.push(transferItemHtml('闭环 T(s)', closedLoop, output));
  }
  if (!items.length) return '';
  return '<div class="anal-transfer" data-awb="transfer">' + items.join('') + '</div>';
}

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
