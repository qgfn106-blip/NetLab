/* 环路缩略图与一次点选整环的纯视图层工具。
 *
 * 只负责把后端 LoopGroup 契约渲染为可点击的 SVG 缩略图、生成候选断点列表，
 * 并把选中的环路规范化为分析请求所需的成员 id/断点信息；不读取 DOM、不改拓扑。
 */
import { escapeHtml } from './analysis_workbench_meta.js';

export interface LoopGroupRecord {
  loop_id?: string;
  label?: string;
  member_node_ids?: string[];
  member_node_names?: string[];
  member_edge_ids?: string[];
  member_edge_names?: string[];
  candidate_breaks?: Array<Record<string, unknown>>;
  suggested_break_id?: string;
  feedback_sign?: number | null;
}

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item || '')).filter(Boolean) : [];
}

export function normalizeLoopGroup(raw: Record<string, unknown> | null | undefined): LoopGroupRecord {
  const group = (raw || {}) as Record<string, unknown>;
  return {
    loop_id: String(group.loop_id || ''),
    label: String(group.label || group.loop_id || ''),
    member_node_ids: textList(group.member_node_ids),
    member_node_names: textList(group.member_node_names),
    member_edge_ids: textList(group.member_edge_ids),
    member_edge_names: textList(group.member_edge_names),
    candidate_breaks: Array.isArray(group.candidate_breaks)
      ? (group.candidate_breaks as Array<Record<string, unknown>>)
      : [],
    suggested_break_id: String(group.suggested_break_id || ''),
    feedback_sign: Number(group.feedback_sign) === 1 || Number(group.feedback_sign) === -1
      ? Number(group.feedback_sign)
      : null,
  };
}

function shortName(name: string, max = 9): string {
  return name.length > max ? name.slice(0, max - 1) + '…' : name;
}

/** 生成不依赖主画布的环形缩略图：成员节点沿圆周均布，成员边连成闭合环。 */
export function loopThumbnailSvg(raw: Record<string, unknown> | null | undefined, accent = '#9b7247'): string {
  const group = normalizeLoopGroup(raw);
  const names = group.member_node_names?.length ? group.member_node_names : group.member_node_ids || [];
  const width = 180;
  const height = 122;
  if (names.length < 2) {
    return '<div class="awb-loop-empty" style="padding:6px 2px;color:var(--muted);font-size:11px">环路成员不足，无法绘制缩略图</div>';
  }
  const count = names.length;
  const cx = width / 2;
  const cy = height / 2 + 2;
  const radius = Math.min(width, height) * 0.34;
  const points = names.map((name, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / count;
    return { name, x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });
  const edges = group.member_edge_names || [];
  const suggested = String(
    (group.candidate_breaks && group.candidate_breaks[0] && group.candidate_breaks[0].name) || '',
  );
  const segments = points.map((point, index) => {
    const next = points[(index + 1) % count];
    const edgeName = edges[index] || '';
    const isSuggested = edgeName !== '' && edgeName === suggested;
    const stroke = isSuggested ? accent : 'var(--line-strong, #c9bda9)';
    const dash = isSuggested ? ' stroke-dasharray="4 3"' : '';
    return '<line x1="' + point.x.toFixed(1) + '" y1="' + point.y.toFixed(1) + '" x2="' + next.x.toFixed(1) + '" y2="' + next.y.toFixed(1) + '" stroke="' + stroke + '" stroke-width="' + (isSuggested ? 2 : 1.4) + '"' + dash + '/>';
  }).join('');
  const labels = edges.map((edgeName, index) => {
    const point = points[index];
    const next = points[(index + 1) % count];
    return '<text x="' + ((point.x + next.x) / 2).toFixed(1) + '" y="' + ((point.y + next.y) / 2 - 2).toFixed(1) + '" text-anchor="middle" font-size="8" fill="var(--muted, #8a7f70)">' + escapeHtml(shortName(edgeName, 7)) + '</text>';
  }).join('');
  const nodes = points.map((point) =>
    '<circle cx="' + point.x.toFixed(1) + '" cy="' + point.y.toFixed(1) + '" r="3.4" fill="' + accent + '"/>'
    + '<text x="' + point.x.toFixed(1) + '" y="' + (point.y - 6).toFixed(1) + '" text-anchor="middle" font-size="9" fill="var(--text-secondary, #5c5145)">' + escapeHtml(shortName(point.name, 8)) + '</text>'
  ).join('');
  return '<svg class="awb-loop-svg" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" role="img" aria-label="环路缩略图">' + segments + nodes + labels + '</svg>';
}

/** 环路卡片列表；电路模式还可传入候选断点，点击后按支路搜索闭合环。 */
export function loopListHtml(
  rawGroups: Array<Record<string, unknown>> | null | undefined,
  selectedLoopId: string,
  fallbackBreaks: Array<Record<string, unknown>> | null | undefined = [],
): string {
  const groups = (rawGroups || []).map((item) => normalizeLoopGroup(item));
  const cards = groups.map((group) => {
    const selected = group.loop_id !== '' && group.loop_id === selectedLoopId;
    const breakName = String(
      (group.candidate_breaks && group.candidate_breaks[0] && group.candidate_breaks[0].name) || group.suggested_break_id || '—',
    );
    const memberCount = (group.member_node_names?.length || group.member_node_ids?.length || 0);
    const edgeCount = (group.member_edge_names?.length || group.member_edge_ids?.length || 0);
    return '<button type="button" class="awb-loop-card' + (selected ? ' selected' : '') + '" data-loop-id="' + escapeHtml(group.loop_id) + '"'
      + ' style="display:flex;flex-direction:column;gap:2px;padding:6px;border:1px solid ' + (selected ? 'var(--accent)' : 'var(--line)') + ';border-radius:9px;background:' + (selected ? 'rgba(155,114,71,.1)' : 'transparent') + ';cursor:pointer;text-align:left">'
      + '<span class="awb-loop-head" style="font-size:12px;font-weight:600;color:var(--ink)">' + escapeHtml(group.label || group.loop_id || '环路') + '</span>'
      + loopThumbnailSvg(group as unknown as Record<string, unknown>)
      + '<span class="awb-loop-meta" style="font-size:10px;color:var(--muted)">成员 ' + memberCount + ' 节点 · ' + edgeCount + ' 边 · 建议断点 ' + escapeHtml(breakName) + '</span>'
      + '</button>';
  }).join('');
  const fallback = (fallbackBreaks || []).map((item) => {
    const name = String(item.element || item.name || '');
    if (!name) return '';
    const kind = String(item.kind || '');
    return '<button type="button" class="awb-loop-break" data-loop-break="' + escapeHtml(name) + '"'
      + ' style="display:block;width:100%;padding:5px 7px;border:1px dashed var(--line-strong);border-radius:8px;background:transparent;color:var(--text-secondary);cursor:pointer;text-align:left;font-size:11px">候选断点 ' + escapeHtml(name) + (kind ? ' · ' + escapeHtml(kind) : '') + '</button>';
  }).join('');
  if (!cards && !fallback) {
    return '<div class="awb-empty" style="padding:8px 2px;color:var(--muted);font-size:11px">未检测到环路；可在电路图点选一条反馈支路作为断点。</div>';
  }
  return '<div class="awb-loop-list" style="display:flex;flex-direction:column;gap:5px">' + cards + fallback + '</div>';
}

/** 在环路成员边中找可作现有受控源断环的元件（VCVS/VCCS）。 */
export function controlledBreakForGroup(
  rawGroup: Record<string, unknown> | null | undefined,
  breakCandidates: Array<Record<string, unknown>> | null | undefined,
): string {
  const group = normalizeLoopGroup(rawGroup);
  const members = new Set(group.member_edge_names || []);
  for (const candidate of breakCandidates || []) {
    const kind = String(candidate.kind || '');
    const element = String(candidate.element || '');
    if ((kind === 'vcvs' || kind === 'vccs') && element && members.has(element)) return element;
  }
  return '';
}

/** 选中环路后交给后端的成员快照（供虚拟探针/审计使用，不改电路）。 */
export function loopSelectionPayload(rawGroup: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const group = normalizeLoopGroup(rawGroup);
  const breaks = group.candidate_breaks || [];
  return {
    loop_id: group.loop_id,
    break_id: String(breaks[0]?.break_id || group.suggested_break_id || ''),
    feedback_sign: group.feedback_sign,
    member_node_ids: group.member_node_ids || [],
    member_edge_ids: group.member_edge_ids || [],
  };
}
