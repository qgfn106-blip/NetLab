export type AnalysisKind = 'bode' | 'time' | 'nyquist' | 'loop' | 'metrics' | 'poles' | 'loop_closed' | 'loop_step';

export const KIND_LABELS: Record<AnalysisKind, string> = {
  bode: 'Bode',
  time: '时域',
  nyquist: 'Nyquist',
  loop: '环路',
  metrics: '指标',
  poles: '极点/零点',
  loop_closed: '闭环 Bode',
  loop_step: '闭环阶跃',
};

export const KIND_HINTS: Record<AnalysisKind, string> = {
  bode: '开环/闭环频响：幅值、相位、极点零点与关键点',
  time: '阶跃/脉冲响应：峰值、上升、调节时间',
  nyquist: '回路增益轮廓、-1 点包围与稳定裕度',
  loop: '显式断环 G/H/T，或未断环时按虚拟单位负反馈显示 G/(1+G)',
  metrics: '工作点与稳定性指标汇总',
  poles: '开环传函极点/零点与稳定裕度',
  loop_closed: '闭环 T(s)=L/(1+L)：合成与直接闭环幅相核对',
  loop_step: '闭环阶跃响应与稳定裕度',
};

export const STATE_COLORS = ['#9b7247', '#7a6fb0', '#4f8a8b', '#c05a7a', '#6f8f45', '#b07a3a'];

export function escapeHtml(text: unknown): string {
  return String(text ?? '').replace(/[&<>"]/g, (ch) => (
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[ch]
  ));
}

export function shortFingerprint(value: unknown): string {
  const text = String(value ?? '');
  return text ? text.slice(0, 12) : '—';
}

export function num(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function optionHtml(value: string, label: string, selected: boolean): string {
  return '<option value="' + escapeHtml(value) + '"' + (selected ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
}

export function loopElementOptions(candidates: Array<Record<string, unknown>>, activeElement: string, allowVirtual: boolean): string {
  const candidatesHtml = candidates.map((candidate) => {
    const element = String(candidate.element || '');
    return optionHtml(element, element + ' · ' + String(candidate.kind || ''), element === activeElement);
  }).join('');
  const virtualHtml = allowVirtual
    ? optionHtml('__virtual__', '虚拟单位负反馈（无实体环）', activeElement === '__virtual__' || (!activeElement && !candidates.length))
    : '';
  return candidatesHtml + virtualHtml || optionHtml('', '（先选择受控源）', true);
}

export function describeRunStatus(envelope: { source?: unknown; metrics?: unknown } | null | undefined): { source: string; stability: string } {
  const source = (envelope?.source || {}) as Record<string, unknown>;
  const metrics = (envelope?.metrics || {}) as Record<string, unknown>;
  const path = String(source['path'] || '');
  const approximate = metrics['approximate'] === true || source['approximate'] === true || path === 'fft_trajectory';
  const label = path === 'fft_trajectory' ? 'FFT 近似' : path === 'descriptor_linearized' ? '描述器线性化' : String(source['model'] || '—');
  const sourceText = label + (source['loop_origin'] === 'virtual_unit_feedback' ? ' · 虚拟单位负反馈' : '') + (approximate ? ' · 近似' : '');
  const stable = typeof metrics['stable'] === 'boolean' ? (metrics['stable'] ? '是' : '否') : approximate ? '不参与判稳' : '—';
  return { source: sourceText, stability: stable };
}
