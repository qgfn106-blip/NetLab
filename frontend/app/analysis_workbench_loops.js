import { escapeHtml } from "./analysis_workbench_meta.js";
function textList(value) {
  return Array.isArray(value) ? value.map((item) => String(item || "")).filter(Boolean) : [];
}
function normalizeLoopGroup(raw) {
  const group = raw || {};
  return {
    loop_id: String(group.loop_id || ""),
    label: String(group.label || group.loop_id || ""),
    member_node_ids: textList(group.member_node_ids),
    member_node_names: textList(group.member_node_names),
    member_edge_ids: textList(group.member_edge_ids),
    member_edge_names: textList(group.member_edge_names),
    candidate_breaks: Array.isArray(group.candidate_breaks) ? group.candidate_breaks : [],
    suggested_break_id: String(group.suggested_break_id || ""),
    feedback_sign: Number(group.feedback_sign) === 1 || Number(group.feedback_sign) === -1 ? Number(group.feedback_sign) : null,
    feedback_sign_confirmed: group.feedback_sign_confirmed === true
  };
}
function shortName(name, max = 9) {
  return name.length > max ? name.slice(0, max - 1) + "\u2026" : name;
}
function loopThumbnailSvg(raw, accent = "#9b7247") {
  const group = normalizeLoopGroup(raw);
  const names = group.member_node_names?.length ? group.member_node_names : group.member_node_ids || [];
  const width = 180;
  const height = 122;
  if (names.length < 2) {
    return '<div class="awb-loop-empty" style="padding:6px 2px;color:var(--muted);font-size:11px">\u73AF\u8DEF\u6210\u5458\u4E0D\u8DB3\uFF0C\u65E0\u6CD5\u7ED8\u5236\u7F29\u7565\u56FE</div>';
  }
  const count = names.length;
  const cx = width / 2;
  const cy = height / 2 + 2;
  const radius = Math.min(width, height) * 0.34;
  const points = names.map((name, index) => {
    const angle = -Math.PI / 2 + 2 * Math.PI * index / count;
    return { name, x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });
  const edges = group.member_edge_names || [];
  const suggested = String(
    group.candidate_breaks && group.candidate_breaks[0] && group.candidate_breaks[0].name || ""
  );
  const segments = points.map((point, index) => {
    const next = points[(index + 1) % count];
    const edgeName = edges[index] || "";
    const isSuggested = edgeName !== "" && edgeName === suggested;
    const stroke = isSuggested ? accent : "var(--line-strong, #c9bda9)";
    const dash = isSuggested ? ' stroke-dasharray="4 3"' : "";
    return '<line x1="' + point.x.toFixed(1) + '" y1="' + point.y.toFixed(1) + '" x2="' + next.x.toFixed(1) + '" y2="' + next.y.toFixed(1) + '" stroke="' + stroke + '" stroke-width="' + (isSuggested ? 2 : 1.4) + '"' + dash + "/>";
  }).join("");
  const labels = edges.map((edgeName, index) => {
    const point = points[index];
    const next = points[(index + 1) % count];
    return '<text x="' + ((point.x + next.x) / 2).toFixed(1) + '" y="' + ((point.y + next.y) / 2 - 2).toFixed(1) + '" text-anchor="middle" font-size="8" fill="var(--muted, #8a7f70)">' + escapeHtml(shortName(edgeName, 7)) + "</text>";
  }).join("");
  const nodes = points.map(
    (point) => '<circle cx="' + point.x.toFixed(1) + '" cy="' + point.y.toFixed(1) + '" r="3.4" fill="' + accent + '"/><text x="' + point.x.toFixed(1) + '" y="' + (point.y - 6).toFixed(1) + '" text-anchor="middle" font-size="9" fill="var(--text-secondary, #5c5145)">' + escapeHtml(shortName(point.name, 8)) + "</text>"
  ).join("");
  return '<svg class="awb-loop-svg" viewBox="0 0 ' + width + " " + height + '" width="' + width + '" height="' + height + '" role="img" aria-label="\u73AF\u8DEF\u7F29\u7565\u56FE">' + segments + nodes + labels + "</svg>";
}
function loopListHtml(rawGroups, selectedLoopId, fallbackBreaks = []) {
  const groups = (rawGroups || []).map((item) => normalizeLoopGroup(item));
  const cards = groups.map((group) => {
    const selected = group.loop_id !== "" && group.loop_id === selectedLoopId;
    const breakName = String(
      group.candidate_breaks && group.candidate_breaks[0] && group.candidate_breaks[0].name || group.suggested_break_id || "\u2014"
    );
    const memberCount = group.member_node_names?.length || group.member_node_ids?.length || 0;
    const edgeCount = group.member_edge_names?.length || group.member_edge_ids?.length || 0;
    return '<button type="button" class="awb-loop-card' + (selected ? " selected" : "") + '" data-loop-id="' + escapeHtml(group.loop_id) + '" style="display:flex;flex-direction:column;gap:2px;padding:6px;border:1px solid ' + (selected ? "var(--accent)" : "var(--line)") + ";border-radius:9px;background:" + (selected ? "rgba(155,114,71,.1)" : "transparent") + ';cursor:pointer;text-align:left"><span class="awb-loop-head" style="font-size:12px;font-weight:600;color:var(--ink)">' + escapeHtml(group.label || group.loop_id || "\u73AF\u8DEF") + "</span>" + loopThumbnailSvg(group) + '<span class="awb-loop-meta" style="font-size:10px;color:var(--muted)">\u6210\u5458 ' + memberCount + " \u8282\u70B9 \xB7 " + edgeCount + " \u8FB9 \xB7 \u5EFA\u8BAE\u65AD\u70B9 " + escapeHtml(breakName) + "</span></button>";
  }).join("");
  const fallback = (fallbackBreaks || []).map((item) => {
    const name = String(item.element || item.name || "");
    if (!name) return "";
    const kind = String(item.kind || "");
    return '<button type="button" class="awb-loop-break" data-loop-break="' + escapeHtml(name) + '" style="display:block;width:100%;padding:5px 7px;border:1px dashed var(--line-strong);border-radius:8px;background:transparent;color:var(--text-secondary);cursor:pointer;text-align:left;font-size:11px">\u5019\u9009\u65AD\u70B9 ' + escapeHtml(name) + (kind ? " \xB7 " + escapeHtml(kind) : "") + "</button>";
  }).join("");
  if (!cards && !fallback) {
    return '<div class="awb-empty" style="padding:8px 2px;color:var(--muted);font-size:11px">\u672A\u68C0\u6D4B\u5230\u73AF\u8DEF\uFF1B\u53EF\u5728\u7535\u8DEF\u56FE\u70B9\u9009\u4E00\u6761\u53CD\u9988\u652F\u8DEF\u4F5C\u4E3A\u65AD\u70B9\u3002</div>';
  }
  return '<div class="awb-loop-list" style="display:flex;flex-direction:column;gap:5px">' + cards + fallback + "</div>";
}
function controlledBreakForGroup(rawGroup, breakCandidates) {
  const group = normalizeLoopGroup(rawGroup);
  const members = new Set(group.member_edge_names || []);
  for (const candidate of breakCandidates || []) {
    const kind = String(candidate.kind || "");
    const element = String(candidate.element || "");
    if ((kind === "vcvs" || kind === "vccs") && element && members.has(element)) return element;
  }
  return "";
}
function loopSelectionPayload(rawGroup) {
  const group = normalizeLoopGroup(rawGroup);
  const breaks = group.candidate_breaks || [];
  return {
    loop_id: group.loop_id,
    break_id: String(breaks[0]?.break_id || group.suggested_break_id || ""),
    feedback_sign: group.feedback_sign,
    member_node_ids: group.member_node_ids || [],
    member_edge_ids: group.member_edge_ids || []
  };
}
export {
  controlledBreakForGroup,
  loopListHtml,
  loopSelectionPayload,
  loopThumbnailSvg,
  normalizeLoopGroup
};
