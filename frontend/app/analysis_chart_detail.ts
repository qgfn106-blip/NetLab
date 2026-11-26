/* 分析图辅助：格式化、标记摘要、Nyquist 叠加与右侧详情栏。
 * 只做展示与纯数学，不参与任何频响或稳定性判定。
 */
import type { AnalysisCurve, AnalysisEnvelope, AnalysisMarker } from './analysis_chart_types.js';

export const MARKER_COLORS: Record<string, string> = {
  stability: '#d05a5a',
  response: '#9b7247',
  margin: '#c98a2e',
  loop: '#7a6fb0',
};

export const MARKER_SYMBOLS: Record<string, string> = {
  pole: 'cross',
  zero: 'circle',
  cross_gain: 'diamond',
  cross_phase: 'triangle',
  peak: 'square',
  cutoff: 'circle',
  gm: 'diamond',
  pm: 'diamond',
  nyquist_crit: 'cross',
};

export const DETAIL_LABELS: Record<string, string> = {
  frequency_hz: '频率 (Hz)',
  magnitude_db: '幅值 (dB)',
  phase_deg: '相位 (°)',
  slope_db_per_dec: '局部斜率 (dB/dec)',
  slope_deg_per_dec: '相位斜率 (°/dec)',
  real: '实部 (Re)',
  imag: '虚部 (Im)',
  magnitude: '幅值 |L|',
  loop_magnitude: '回路增益 |L|',
  gain_margin_db: '增益裕度 (dB)',
  phase_margin_deg: '相位裕度 (°)',
  margin_frequency_hz: '裕度频率 (Hz)',
  closed_loop_stable: '闭环稳定',
  output: '输出',
  element: '断裂元件',
};

export function escapeDetailHtml(text: unknown): string {
  return String(text ?? '').replace(/[&<>"]/g, (ch) => (
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[ch]
  ));
}

export function asNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function fmtDetail(value: unknown, digits = 4, unit = ''): string {
  const num = asNumber(value);
  if (num === null) return '—';
  const abs = Math.abs(num);
  const text = (abs !== 0 && (abs < 1e-3 || abs >= 1e5)) ? num.toExponential(3) : String(Number(num.toFixed(digits)));
  return unit ? text + ' ' + unit : text;
}

export function fmtFrequency(hz: number | null): string {
  if (hz === null || !Number.isFinite(hz)) return '—';
  const abs = Math.abs(hz);
  if (abs >= 1e9) return fmtDetail(hz / 1e9, 3, 'GHz');
  if (abs >= 1e6) return fmtDetail(hz / 1e6, 3, 'MHz');
  if (abs >= 1e3) return fmtDetail(hz / 1e3, 3, 'kHz');
  return fmtDetail(hz, 3, 'Hz');
}

export { clampRange } from './analysis_chart_model.js';

export function categoryLabel(category: string): string {
  return ({ stability: '稳定/极点', response: '响应', margin: '裕度', loop: '回路' } as Record<string, string>)[category] || category;
}

export function pointSummary(curve: AnalysisCurve, index: number): string {
  const x = curve.x[index];
  const y = curve.y[index];
  const parts: string[] = [];
  if (curve.axes[0] === 'f') parts.push('f = ' + fmtFrequency(x));
  else parts.push(curve.axes[0] + ' = ' + fmtDetail(x));
  if (curve.axes[1] === 'mag_db') parts.push('|H| = ' + fmtDetail(y, 3, 'dB'));
  else if (curve.axes[1] === 'phase_deg') parts.push('∠H = ' + fmtDetail(y, 2, '°'));
  else if (curve.axes[1] === 'value') parts.push('值 = ' + fmtDetail(y));
  else parts.push(curve.axes[1] + ' = ' + fmtDetail(y));
  const slopes = curve.detail?.slope_db_per_dec;
  if (Array.isArray(slopes) && Number.isFinite(Number(slopes[index]))) parts.push('斜率 ' + fmtDetail(slopes[index], 2, 'dB/dec'));
  return parts.join(' · ');
}

export function markerSummary(marker: AnalysisMarker): string {
  const detail = marker.detail || {};
  const parts: string[] = [];
  if (marker.axis_x === 'f') parts.push('f = ' + fmtFrequency(marker.x));
  if (Number.isFinite(marker.y)) parts.push(fmtDetail(marker.y, 3));
  for (const key of ['gain_margin_db', 'phase_margin_deg', 'real', 'imag']) {
    const value = asNumber(detail[key]);
    if (value !== null) parts.push(DETAIL_LABELS[key] + ' = ' + fmtDetail(value, 3));
  }
  return parts.join(' · ');
}

export interface AxisLike {
  slot: number;
  box: { x: number; y: number; w: number; h: number };
  sx: { to(value: number): number | null; from(px: number): number };
  sy: { to(value: number): number | null; from(px: number): number };
}

export function axisAt<T extends AxisLike>(result: { axes: T[] } | null, px: number, py: number): T | null {
  if (!result) return null;
  for (const axis of result.axes) {
    if (px >= axis.box.x && px <= axis.box.x + axis.box.w && py >= axis.box.y && py <= axis.box.y + axis.box.h) return axis;
  }
  return result.axes[0] || null;
}

export function zoomRange(range: [number, number], anchor: number, factor: number, log: boolean): [number, number] {
  if (log && range[0] > 0 && range[1] > 0 && anchor > 0) {
    const lo = Math.log10(range[0]);
    const hi = Math.log10(range[1]);
    const a = Math.log10(anchor);
    const nextLo = a + (lo - a) * factor;
    const nextHi = a + (hi - a) * factor;
    return [Math.pow(10, nextLo), Math.pow(10, nextHi)];
  }
  return [anchor + (range[0] - anchor) * factor, anchor + (range[1] - anchor) * factor];
}

export function nyquistExtras(envelope: AnalysisEnvelope): Array<{ name: string; label: string; color: string; x: number[]; y: number[] }> {
  if (envelope.kind !== 'nyquist') return [];
  const circleX: number[] = [];
  const circleY: number[] = [];
  for (let i = 0; i <= 144; i++) {
    const angle = (i / 144) * Math.PI * 2;
    circleX.push(Math.cos(angle));
    circleY.push(Math.sin(angle));
  }
  return [{ name: 'unit-circle', label: '单位圆', color: '#6c7a89', x: circleX, y: circleY }];
}

export function drawNyquistDirections(ctx: CanvasRenderingContext2D, envelope: AnalysisEnvelope, axes: AxisLike[]): void {
  const axis = axes[0];
  if (!axis) return;
  for (const curve of envelope.curves) {
    if (curve.x.length < 8) continue;
    for (const fraction of [0.25, 0.55, 0.8]) {
      const index = Math.max(1, Math.min(curve.x.length - 2, Math.round((curve.x.length - 1) * fraction)));
      const x0 = axis.sx.to(curve.x[index - 1]);
      const y0 = axis.sy.to(curve.y[index - 1]);
      const x1 = axis.sx.to(curve.x[index]);
      const y1 = axis.sy.to(curve.y[index]);
      if (x0 == null || y0 == null || x1 == null || y1 == null) continue;
      const angle = Math.atan2(y1 - y0, x1 - x0);
      const size = 7;
      ctx.save();
      ctx.strokeStyle = '#9b7247';
      ctx.fillStyle = '#9b7247';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - size * Math.cos(angle - 0.4), y1 - size * Math.sin(angle - 0.4));
      ctx.lineTo(x1 - size * Math.cos(angle + 0.4), y1 - size * Math.sin(angle + 0.4));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  const minus = axis.sx.to(-1);
  const zero = axis.sy.to(0);
  if (minus != null && zero != null) {
    ctx.save();
    ctx.fillStyle = '#d05a5a';
    ctx.font = '11px "Microsoft YaHei UI", sans-serif';
    ctx.fillText('-1', minus + 5, zero - 5);
    ctx.restore();
  }
}

export function renderAnalysisDetail(
  host: HTMLElement,
  envelope: AnalysisEnvelope | null,
  pinned: AnalysisMarker | null,
  onPin: (marker: AnalysisMarker | null) => void,
): void {
  host.innerHTML = '';
  if (!envelope) {
    host.innerHTML = '<div class="analysis-detail-empty">运行一次分析后，这里给出指标、证据与关键点索引。</div>';
    return;
  }
  if (pinned) {
    const rows = Object.entries(pinned.detail || {}).map(([key, value]) => (
      '<tr><th>' + escapeDetailHtml(DETAIL_LABELS[key] || key) + '</th><td class="num">' + escapeDetailHtml(fmtDetail(value, 6)) + '</td></tr>'
    )).join('');
    host.innerHTML = '<div class="analysis-detail-head"><b>' + escapeDetailHtml(pinned.label) + '</b>'
      + '<span class="analysis-marker-shape">' + escapeDetailHtml(pinned.shape) + '</span></div>'
      + '<div class="analysis-detail-actions"><button type="button" class="analysis-tool-btn" data-unpin="1">取消固定</button></div>'
      + '<table class="analysis-detail-table"><tbody>' + (rows || '<tr><td>无附加详情</td></tr>') + '</tbody></table>';
    host.querySelector('[data-unpin]')?.addEventListener('click', () => onPin(null));
    return;
  }
  const metrics = envelope.metrics || {};
  const items: Array<[string, string]> = [];
  const add = (label: string, value: unknown, digits = 4, unit = '') => {
    const num = asNumber(value);
    if (num !== null) items.push([label, fmtDetail(num, digits, unit)]);
    else if (typeof value === 'boolean') items.push([label, value ? '是' : '否']);
  };
  add('稳定', metrics['stable']);
  add('带宽', metrics['bandwidth_hz'], 4, 'Hz');
  add('谐振峰', metrics['resonant_peak_db'], 3, 'dB');
  add('DC 增益', (metrics['metrics'] as Record<string, unknown> | undefined)?.['dc_gain']);
  add('相位裕度', (metrics['metrics'] as Record<string, unknown> | undefined)?.['phase_margin_deg'], 2, '°');
  add('增益裕度', (metrics['metrics'] as Record<string, unknown> | undefined)?.['gain_margin_db'], 2, 'dB');
  if (envelope.source?.['loop_gain_kind'] === 'asymptotic_opamp') {
    items.push(['回路增益', '理想化运放近似（×1000）']);
  }
  if (!items.length) items.push(['状态', envelope.kind]);
  host.innerHTML = '<div class="analysis-detail-section"><h4>指标</h4><div class="analysis-metrics-grid">'
    + items.map(([label, value]) => '<div><span>' + escapeDetailHtml(label) + '</span><b>' + escapeDetailHtml(value) + '</b></div>').join('')
    + '</div></div>'
    + markerIndexHtml(envelope)
    + warningsHtml(envelope)
    + evidenceHtml(envelope);
  host.querySelectorAll<HTMLElement>('[data-marker-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const marker = envelope.markers.find((item) => item.id === button.dataset.markerId);
      if (marker) onPin(marker);
    });
  });
}

function markerIndexHtml(envelope: AnalysisEnvelope): string {
  if (!envelope.markers.length) return '';
  const rows = envelope.markers.map((marker) => (
    '<button type="button" class="analysis-marker-item" data-marker-id="' + escapeDetailHtml(marker.id) + '">'
    + '<span class="analysis-marker-dot" style="--cat-color:' + escapeDetailHtml(MARKER_COLORS[marker.category] || '#9b7247') + '"></span>'
    + '<span class="analysis-marker-name">' + escapeDetailHtml(marker.label) + '</span>'
    + '<span class="analysis-marker-value">' + escapeDetailHtml(markerSummary(marker)) + '</span></button>'
  )).join('');
  return '<div class="analysis-detail-section"><h4>关键点索引 <small>' + envelope.markers.length + ' 个</small></h4>'
    + '<div class="analysis-marker-list">' + rows + '</div></div>';
}

function warningsHtml(envelope: AnalysisEnvelope): string {
  if (!envelope.warnings?.length) return '';
  return '<div class="analysis-detail-section"><h4>警告</h4><ul class="analysis-warning-list">'
    + envelope.warnings.map((warning) => '<li class="sev-' + escapeDetailHtml(warning.severity || 'warning') + '">'
      + '<code>' + escapeDetailHtml(warning.code) + '</code> ' + escapeDetailHtml(warning.message) + '</li>').join('')
    + '</ul></div>';
}

function evidenceHtml(envelope: AnalysisEnvelope): string {
  const evidence = envelope.evidence || {};
  const entries = Object.entries(evidence).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value));
  if (!entries.length && !envelope.fingerprint) return '';
  return '<div class="analysis-detail-section"><h4>证据</h4><dl class="analysis-evidence">'
    + entries.map(([key, value]) => '<dt>' + escapeDetailHtml(key) + '</dt><dd>' + escapeDetailHtml(value) + '</dd>').join('')
    + (envelope.fingerprint ? '<dt>fingerprint</dt><dd class="mono">' + escapeDetailHtml(envelope.fingerprint.slice(0, 16)) + '…</dd>' : '')
    + '</dl></div>';
}
