import { STATE_COLORS, escapeHtml } from "./analysis_workbench_meta.js";
function mergeCompareEnvelopes(results) {
  const base = JSON.parse(JSON.stringify(results[0].envelope));
  base.curves = [];
  base.markers = [];
  results.forEach((result, index) => {
    const color = STATE_COLORS[index % STATE_COLORS.length];
    for (const curve of result.envelope.curves) {
      const cloned = JSON.parse(JSON.stringify(curve));
      cloned.id = curve.id + "@" + result.state_id;
      cloned.label = result.label + " \xB7 " + curve.label;
      cloned.detail = { ...cloned.detail || {}, color };
      base.curves.push(cloned);
    }
    for (const marker of result.envelope.markers) {
      const cloned = JSON.parse(JSON.stringify(marker));
      cloned.id = marker.id + "@" + result.state_id;
      cloned.label = result.label + " \xB7 " + marker.label;
      base.markers.push(cloned);
    }
  });
  base.analysis_id = "compare-" + results.map((item) => item.state_id).join("-");
  return base;
}
function compareTableHtml(results) {
  const keys = /* @__PURE__ */ new Set();
  for (const result of results) {
    const metrics = result.envelope.metrics || {};
    for (const key of Object.keys(metrics)) if (!["metrics", "bode"].includes(key)) keys.add(key);
    const nested = metrics["metrics"];
    if (nested && typeof nested === "object") for (const key of Object.keys(nested)) keys.add(key);
  }
  const rows = Array.from(keys).slice(0, 24).map((key) => {
    const cells = results.map((result) => {
      const metrics = result.envelope.metrics || {};
      const nested = metrics["metrics"];
      const value = nested && typeof nested === "object" && key in nested ? nested[key] : metrics[key];
      return '<td class="num">' + escapeHtml(typeof value === "number" ? Number(value.toPrecision(7)) : value ?? "\u2014") + "</td>";
    }).join("");
    return "<tr><th>" + escapeHtml(key) + "</th>" + cells + "</tr>";
  }).join("");
  return '<div class="analysis-detail-section"><h4>\u591A\u72B6\u6001\u5BF9\u6BD4</h4><table class="analysis-detail-table"><thead><tr><th>\u6307\u6807</th>' + results.map((result, index) => '<th style="color:' + STATE_COLORS[index % STATE_COLORS.length] + '">' + escapeHtml(result.label) + "</th>").join("") + "</tr></thead><tbody>" + rows + "</tbody></table></div>";
}
function metricsHtml(raw) {
  const metrics = raw["metrics"] || raw;
  const rows = Object.entries(metrics).slice(0, 60).map(([key, value]) => {
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    return "<tr><th>" + escapeHtml(key) + '</th><td class="num">' + escapeHtml(text) + "</td></tr>";
  }).join("");
  return '<div class="analysis-detail-section"><h4>\u6307\u6807</h4><table class="analysis-detail-table"><tbody>' + (rows || "<tr><td>\u65E0\u6307\u6807</td></tr>") + "</tbody></table></div>";
}
export {
  compareTableHtml,
  mergeCompareEnvelopes,
  metricsHtml
};
