const MARKER_COLORS = {
  stability: "#d05a5a",
  response: "#9b7247",
  margin: "#c98a2e",
  loop: "#7a6fb0"
};
const MARKER_SYMBOLS = {
  pole: "cross",
  zero: "circle",
  cross_gain: "diamond",
  cross_phase: "triangle",
  peak: "square",
  cutoff: "circle",
  gm: "diamond",
  pm: "diamond",
  nyquist_crit: "cross"
};
const DETAIL_LABELS = {
  frequency_hz: "\u9891\u7387 (Hz)",
  magnitude_db: "\u5E45\u503C (dB)",
  phase_deg: "\u76F8\u4F4D (\xB0)",
  slope_db_per_dec: "\u5C40\u90E8\u659C\u7387 (dB/dec)",
  slope_deg_per_dec: "\u76F8\u4F4D\u659C\u7387 (\xB0/dec)",
  real: "\u5B9E\u90E8 (Re)",
  imag: "\u865A\u90E8 (Im)",
  magnitude: "\u5E45\u503C |L|",
  loop_magnitude: "\u56DE\u8DEF\u589E\u76CA |L|",
  gain_margin_db: "\u589E\u76CA\u88D5\u5EA6 (dB)",
  phase_margin_deg: "\u76F8\u4F4D\u88D5\u5EA6 (\xB0)",
  margin_frequency_hz: "\u88D5\u5EA6\u9891\u7387 (Hz)",
  closed_loop_stable: "\u95ED\u73AF\u7A33\u5B9A",
  output: "\u8F93\u51FA",
  element: "\u65AD\u88C2\u5143\u4EF6"
};
function escapeDetailHtml(text) {
  return String(text ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
}
function asNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}
function fmtDetail(value, digits = 4, unit = "") {
  const num = asNumber(value);
  if (num === null) return "\u2014";
  const abs = Math.abs(num);
  const text = abs !== 0 && (abs < 1e-3 || abs >= 1e5) ? num.toExponential(3) : String(Number(num.toFixed(digits)));
  return unit ? text + " " + unit : text;
}
function fmtFrequency(hz) {
  if (hz === null || !Number.isFinite(hz)) return "\u2014";
  const abs = Math.abs(hz);
  if (abs >= 1e9) return fmtDetail(hz / 1e9, 3, "GHz");
  if (abs >= 1e6) return fmtDetail(hz / 1e6, 3, "MHz");
  if (abs >= 1e3) return fmtDetail(hz / 1e3, 3, "kHz");
  return fmtDetail(hz, 3, "Hz");
}
import { clampRange } from "./analysis_chart_model.js";
function categoryLabel(category) {
  return { stability: "\u7A33\u5B9A/\u6781\u70B9", response: "\u54CD\u5E94", margin: "\u88D5\u5EA6", loop: "\u56DE\u8DEF" }[category] || category;
}
function pointSummary(curve, index) {
  const x = curve.x[index];
  const y = curve.y[index];
  const parts = [];
  if (curve.axes[0] === "f") parts.push("f = " + fmtFrequency(x));
  else parts.push(curve.axes[0] + " = " + fmtDetail(x));
  if (curve.axes[1] === "mag_db") parts.push("|H| = " + fmtDetail(y, 3, "dB"));
  else if (curve.axes[1] === "phase_deg") parts.push("\u2220H = " + fmtDetail(y, 2, "\xB0"));
  else if (curve.axes[1] === "value") parts.push("\u503C = " + fmtDetail(y));
  else parts.push(curve.axes[1] + " = " + fmtDetail(y));
  const slopes = curve.detail?.slope_db_per_dec;
  if (Array.isArray(slopes) && Number.isFinite(Number(slopes[index]))) parts.push("\u659C\u7387 " + fmtDetail(slopes[index], 2, "dB/dec"));
  return parts.join(" \xB7 ");
}
function markerSummary(marker) {
  const detail = marker.detail || {};
  const parts = [];
  if (marker.axis_x === "f") parts.push("f = " + fmtFrequency(marker.x));
  if (Number.isFinite(marker.y)) parts.push(fmtDetail(marker.y, 3));
  for (const key of ["gain_margin_db", "phase_margin_deg", "real", "imag"]) {
    const value = asNumber(detail[key]);
    if (value !== null) parts.push(DETAIL_LABELS[key] + " = " + fmtDetail(value, 3));
  }
  return parts.join(" \xB7 ");
}
function axisAt(result, px, py) {
  if (!result) return null;
  for (const axis of result.axes) {
    if (px >= axis.box.x && px <= axis.box.x + axis.box.w && py >= axis.box.y && py <= axis.box.y + axis.box.h) return axis;
  }
  return result.axes[0] || null;
}
function zoomRange(range, anchor, factor, log) {
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
function nyquistExtras(envelope) {
  if (envelope.kind !== "nyquist") return [];
  const circleX = [];
  const circleY = [];
  for (let i = 0; i <= 144; i++) {
    const angle = i / 144 * Math.PI * 2;
    circleX.push(Math.cos(angle));
    circleY.push(Math.sin(angle));
  }
  return [{ name: "unit-circle", label: "\u5355\u4F4D\u5706", color: "#6c7a89", x: circleX, y: circleY }];
}
function drawNyquistDirections(ctx, envelope, axes) {
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
      ctx.strokeStyle = "#9b7247";
      ctx.fillStyle = "#9b7247";
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
    ctx.fillStyle = "#d05a5a";
    ctx.font = '11px "Microsoft YaHei UI", sans-serif';
    ctx.fillText("-1", minus + 5, zero - 5);
    ctx.restore();
  }
}
function renderAnalysisDetail(host, envelope, pinned, onPin) {
  host.innerHTML = "";
  if (!envelope) {
    host.innerHTML = '<div class="analysis-detail-empty">\u8FD0\u884C\u4E00\u6B21\u5206\u6790\u540E\uFF0C\u8FD9\u91CC\u7ED9\u51FA\u6307\u6807\u3001\u8BC1\u636E\u4E0E\u5173\u952E\u70B9\u7D22\u5F15\u3002</div>';
    return;
  }
  if (pinned) {
    const rows = Object.entries(pinned.detail || {}).map(([key, value]) => "<tr><th>" + escapeDetailHtml(DETAIL_LABELS[key] || key) + '</th><td class="num">' + escapeDetailHtml(fmtDetail(value, 6)) + "</td></tr>").join("");
    host.innerHTML = '<div class="analysis-detail-head"><b>' + escapeDetailHtml(pinned.label) + '</b><span class="analysis-marker-shape">' + escapeDetailHtml(pinned.shape) + '</span></div><div class="analysis-detail-actions"><button type="button" class="analysis-tool-btn" data-unpin="1">\u53D6\u6D88\u56FA\u5B9A</button></div><table class="analysis-detail-table"><tbody>' + (rows || "<tr><td>\u65E0\u9644\u52A0\u8BE6\u60C5</td></tr>") + "</tbody></table>";
    host.querySelector("[data-unpin]")?.addEventListener("click", () => onPin(null));
    return;
  }
  const metrics = envelope.metrics || {};
  const items = [];
  const add = (label, value, digits = 4, unit = "") => {
    const num = asNumber(value);
    if (num !== null) items.push([label, fmtDetail(num, digits, unit)]);
    else if (typeof value === "boolean") items.push([label, value ? "\u662F" : "\u5426"]);
  };
  add("\u7A33\u5B9A", metrics["stable"]);
  add("\u5E26\u5BBD", metrics["bandwidth_hz"], 4, "Hz");
  add("\u8C10\u632F\u5CF0", metrics["resonant_peak_db"], 3, "dB");
  add("DC \u589E\u76CA", metrics["metrics"]?.["dc_gain"]);
  add("\u76F8\u4F4D\u88D5\u5EA6", metrics["metrics"]?.["phase_margin_deg"], 2, "\xB0");
  add("\u589E\u76CA\u88D5\u5EA6", metrics["metrics"]?.["gain_margin_db"], 2, "dB");
  if (!items.length) items.push(["\u72B6\u6001", envelope.kind]);
  host.innerHTML = '<div class="analysis-detail-section"><h4>\u6307\u6807</h4><div class="analysis-metrics-grid">' + items.map(([label, value]) => "<div><span>" + escapeDetailHtml(label) + "</span><b>" + escapeDetailHtml(value) + "</b></div>").join("") + "</div></div>" + markerIndexHtml(envelope) + warningsHtml(envelope) + evidenceHtml(envelope);
  host.querySelectorAll("[data-marker-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const marker = envelope.markers.find((item) => item.id === button.dataset.markerId);
      if (marker) onPin(marker);
    });
  });
}
function markerIndexHtml(envelope) {
  if (!envelope.markers.length) return "";
  const rows = envelope.markers.map((marker) => '<button type="button" class="analysis-marker-item" data-marker-id="' + escapeDetailHtml(marker.id) + '"><span class="analysis-marker-dot" style="--cat-color:' + escapeDetailHtml(MARKER_COLORS[marker.category] || "#9b7247") + '"></span><span class="analysis-marker-name">' + escapeDetailHtml(marker.label) + '</span><span class="analysis-marker-value">' + escapeDetailHtml(markerSummary(marker)) + "</span></button>").join("");
  return '<div class="analysis-detail-section"><h4>\u5173\u952E\u70B9\u7D22\u5F15 <small>' + envelope.markers.length + ' \u4E2A</small></h4><div class="analysis-marker-list">' + rows + "</div></div>";
}
function warningsHtml(envelope) {
  if (!envelope.warnings?.length) return "";
  return '<div class="analysis-detail-section"><h4>\u8B66\u544A</h4><ul class="analysis-warning-list">' + envelope.warnings.map((warning) => '<li class="sev-' + escapeDetailHtml(warning.severity || "warning") + '"><code>' + escapeDetailHtml(warning.code) + "</code> " + escapeDetailHtml(warning.message) + "</li>").join("") + "</ul></div>";
}
function evidenceHtml(envelope) {
  const evidence = envelope.evidence || {};
  const entries = Object.entries(evidence).filter(([, value]) => ["string", "number", "boolean"].includes(typeof value));
  if (!entries.length && !envelope.fingerprint) return "";
  return '<div class="analysis-detail-section"><h4>\u8BC1\u636E</h4><dl class="analysis-evidence">' + entries.map(([key, value]) => "<dt>" + escapeDetailHtml(key) + "</dt><dd>" + escapeDetailHtml(value) + "</dd>").join("") + (envelope.fingerprint ? '<dt>fingerprint</dt><dd class="mono">' + escapeDetailHtml(envelope.fingerprint.slice(0, 16)) + "\u2026</dd>" : "") + "</dl></div>";
}
export {
  DETAIL_LABELS,
  MARKER_COLORS,
  MARKER_SYMBOLS,
  asNumber,
  axisAt,
  categoryLabel,
  clampRange,
  drawNyquistDirections,
  escapeDetailHtml,
  fmtDetail,
  fmtFrequency,
  markerSummary,
  nyquistExtras,
  pointSummary,
  renderAnalysisDetail,
  zoomRange
};
