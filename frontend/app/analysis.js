import { state } from "./state.js";
import { jsonRequest } from "./net.js";
import { toast } from "./desktop.js";
import { fmt } from "../app.utils.js";
import { $ } from "./dom.js";
import { nodeByName } from "./model.js";
const analysisActions = {};
function setAnalysisActions(actions) {
  Object.assign(analysisActions, actions);
}
function task(run, options) {
  return analysisActions.task(run, options);
}
function downloadText(text, filename) {
  analysisActions.downloadText(text, filename);
}
function phaseStateKeys(node) {
  return analysisActions.phaseStateKeys(node);
}
function C(value) {
  return analysisActions.C(value);
}
function tokens() {
  return analysisActions.tokens();
}
function analysisSignalKey() {
  if (state.chart.selected.size) return [...state.chart.selected][0];
  const keys = state.sim?.probe_keys || [];
  return keys[0] || "";
}
async function analysisGet(path, query) {
  const qs = query ? `?${new URLSearchParams(query)}` : "";
  return task(() => jsonRequest(`${path}${qs}`, "GET"), { dirty: false });
}
function setAnalysisOutput(text) {
  state.analysisLast = text;
  const out = $("#analysisOut");
  if (out) out.textContent = text;
}
async function runAnalysisMetrics() {
  const key = analysisSignalKey();
  if (!key) return toast("\u8FD8\u6CA1\u6709\u5F55\u5236\u6570\u636E\uFF1A\u5148\u8FD0\u884C\u4E00\u6BB5\u65F6\u95F4", "info", 2600);
  const response = await analysisGet("/api/analysis/metrics", { keys: key });
  if (!response) return;
  const item = response.items?.[key];
  if (!item || item.ok === false) {
    setAnalysisOutput(JSON.stringify(item || response, null, 2));
    return;
  }
  setAnalysisOutput(
    [
      `\u4FE1\u53F7 ${key}\uFF08${item.samples} \u70B9\uFF09`,
      `\u521D\u503C ${fmt(item.initial, 5)} \u2192 \u7EC8\u503C ${fmt(item.final, 5)}`,
      `min ${fmt(item.min, 5)}  max ${fmt(item.max, 5)}  mean ${fmt(item.mean, 5)}  rms ${fmt(item.rms, 5)}`,
      `\u8D85\u8C03 ${fmt(item.overshoot_pct, 2)}%   \u4E0A\u5347\u65F6\u95F4 ${item.rise_time == null ? "\u2014" : fmt(item.rise_time, 5) + " s"}`,
      `\u8C03\u8282\u65F6\u95F4(\xB1${item.settle_band_pct}%) ${item.settling_time == null ? "\u2014" : fmt(item.settling_time, 5) + " s"}`,
      `\u6765\u6E90\uFF1A${item.source}`,
      `\u8017\u65F6 ${response.elapsed_ms ?? "?"} ms`
    ].join("\n")
  );
}
async function runAnalysisSpectrum() {
  const key = analysisSignalKey();
  if (!key) return toast("\u8FD8\u6CA1\u6709\u5F55\u5236\u6570\u636E\uFF1A\u5148\u8FD0\u884C\u4E00\u6BB5\u65F6\u95F4", "info", 2600);
  const response = await analysisGet("/api/analysis/spectrum", { key });
  if (!response) return;
  state.analysisSpectrum = response;
  const peaks = (response.peaks || []).map((p) => `${fmt(p.freq, 3)} Hz  |X|=${fmt(p.magnitude, 4)}`).join("\n");
  setAnalysisOutput([`FFT\uFF08${response.window} \u7A97\uFF0Cdt=${fmt(response.dt, 5)} s\uFF09`, peaks, `\u6765\u6E90\uFF1A${response.source}`].join("\n"));
  drawAnalysisSpectrum();
}
async function runAnalysisPeriod() {
  const key = analysisSignalKey();
  if (!key) return toast("\u8FD8\u6CA1\u6709\u5F55\u5236\u6570\u636E\uFF1A\u5148\u8FD0\u884C\u4E00\u6BB5\u65F6\u95F4", "info", 2600);
  const response = await analysisGet("/api/analysis/period", { key });
  if (!response) return;
  if (!response.ok) {
    setAnalysisOutput(`\u5468\u671F\u63A8\u8350\uFF1A\u5931\u8D25
\u539F\u56E0\uFF1A${response.reason}
\u8BCA\u65AD\uFF1A${response.diagnosis}`);
    return;
  }
  const lines = [`\u5468\u671F\u63A8\u8350\uFF1AT \u2248 ${fmt(response.period, 5)} s\uFF08score ${fmt(response.score, 3)}\uFF0C${fmt(response.cycles, 2)} \u4E2A\u5468\u671F\uFF09`];
  for (const item of response.candidates || []) lines.push(`  \u5019\u9009 ${fmt(item.period, 5)} s  score ${fmt(item.score, 3)}`);
  lines.push(`\u8BCA\u65AD\uFF1A${response.diagnosis}`);
  lines.push(`\u6765\u6E90\uFF1A${response.source}`);
  setAnalysisOutput(lines.join("\n"));
}
async function runAnalysisMath() {
  const response = await analysisGet("/api/analysis/math");
  if (!response) return;
  const lines = (response.rows || []).map((row) => `${row.name} (${row.kind})
  ${row.formula || "\uFF08\u65E0\u516C\u5F0F\uFF09"}`);
  setAnalysisOutput([`\u6570\u5B66\u5F62\u5F0F\uFF08${(response.rows || []).length} \u4E2A\u8282\u70B9\uFF09`, ...lines, `\u6765\u6E90\uFF1A${response.source}`].join("\n"));
}
async function runAnalysisTransfer() {
  const input = $("#analysisInputNode")?.value?.trim();
  const output = $("#analysisOutputNode")?.value?.trim();
  if (!input || !output) return toast("\u586B\u5199\u8F93\u5165/\u8F93\u51FA\u8282\u70B9\u540D", "info", 2400);
  const out = $("#analysisTFOut");
  if (out) out.textContent = "\u5206\u6790\u4E2D\u2026";
  try {
    const response = await jsonRequest("/api/analysis/tf", "POST", {
      input_node: input,
      output_node: output,
      points: 240
    });
    if (!response.ok) {
      const reason = `\u4F20\u9012\u51FD\u6570\uFF1A\u65E0\u6CD5\u89E3\u6790
\u539F\u56E0\uFF1A${response.reason || "\u672A\u77E5\u539F\u56E0"}`;
      if (out) out.textContent = reason;
      setAnalysisOutput(reason);
      return;
    }
    state.analysisTF = response;
    const summary = analysisTFSummary(response);
    if (out) out.textContent = summary;
    setAnalysisOutput([`\u7F51\u7EDC\u603B\u4F20\u51FD\uFF08${input} \u2192 ${output}\uFF09`, summary].join("\n"));
    drawAnalysisTF();
  } catch (error) {
    const reason = `\u4F20\u9012\u51FD\u6570\uFF1A\u5931\u8D25
\u539F\u56E0\uFF1A${error?.message || error}`;
    if (out) out.textContent = reason;
    setAnalysisOutput(reason);
    state.analysisTF = null;
    drawAnalysisTF();
  }
}
function fmtComplex(value) {
  const real = Number(value?.real ?? value?.re ?? 0);
  const imag = Number(value?.imag ?? value?.im ?? 0);
  if (!Number.isFinite(real) || !Number.isFinite(imag)) return "\u2014";
  if (Math.abs(imag) < 1e-9) return fmt(real, 4);
  const sign = imag < 0 ? "\u2212" : "+";
  return `${fmt(real, 4)} ${sign} ${fmt(Math.abs(imag), 4)}j`;
}
function analysisTFSummary(data) {
  const step = data.step || {};
  const metrics = step.metrics || {};
  const stability = { stable: "\u7A33\u5B9A", marginal: "\u4E34\u754C\u7A33\u5B9A", unstable: "\u4E0D\u7A33\u5B9A" }[data.stability] || data.stability || "\u672A\u77E5";
  const lines = [
    `G(s) = ${data.expression}`,
    `\u9636\u6570 ${data.order}\uFF0C\u76F8\u5BF9\u9636 ${data.relative_order}`,
    `\u6781\u70B9\uFF1A${(data.poles || []).map(fmtComplex).join(", ") || "\u65E0"}`,
    `\u96F6\u70B9\uFF1A${(data.zeros || []).map(fmtComplex).join(", ") || "\u65E0"}`,
    `DC \u589E\u76CA\uFF1A${data.dc_gain_finite ? fmt(data.dc_gain, 5) : "\u221E\uFF08\u542B\u79EF\u5206\u73AF\u8282\uFF09"}`,
    `\u7A33\u5B9A\u6027\uFF1A${stability}`
  ];
  if (metrics.final !== null && metrics.final !== void 0) {
    lines.push(
      `\u9636\u8DC3\uFF1A\u7EC8\u503C ${fmt(metrics.final, 5)}\uFF0C\u5CF0\u503C ${fmt(metrics.peak_value, 5)} @ ${fmt(metrics.peak_time, 3)} s\uFF0C\u8D85\u8C03 ${fmt(metrics.overshoot_pct, 2)}%\uFF0C\u4E0A\u5347 ${fmt(metrics.rise_time, 3)} s\uFF0C\u8C03\u8282 ${fmt(metrics.settling_time, 3)} s\uFF0C\u7A33\u6001\u8BEF\u5DEE ${fmt(metrics.steady_state_error, 4)}`
    );
  } else if (step.stable === false) {
    lines.push("\u9636\u8DC3\uFF1A\u7CFB\u7EDF\u4E0D\u7A33\u5B9A\uFF0C\u65F6\u57DF\u6307\u6807\u4E0D\u9002\u7528");
  }
  for (const item of data.assumptions || []) lines.push(`\u5047\u8BBE\uFF1A${item}`);
  return lines.join("\n");
}
async function runAnalysisTF() {
  const node = $("#analysisTFNode")?.value?.trim() || "";
  const expr = $("#analysisTFExpr")?.value?.trim() || "";
  if (!node && !expr) return toast("\u9009\u62E9\u4F20\u9012\u51FD\u6570\u8282\u70B9\u6216\u8F93\u5165 s \u57DF\u8868\u8FBE\u5F0F", "info", 2400);
  const out = $("#analysisTFOut");
  if (out) out.textContent = "\u5206\u6790\u4E2D\u2026";
  try {
    const response = await jsonRequest("/api/analysis/tf", "POST", {
      node: node || null,
      expr: node ? null : expr,
      points: 240
    });
    state.analysisTF = response;
    if (out) out.textContent = analysisTFSummary(response);
    drawAnalysisTF();
  } catch (error) {
    state.analysisTF = null;
    const text = `\u4F20\u9012\u51FD\u6570\u5206\u6790\uFF1A\u5931\u8D25
\u539F\u56E0\uFF1A${error?.message || error}`;
    if (out) out.textContent = text;
    drawAnalysisTF();
  }
}
function drawAnalysisTF() {
  const canvas = $("#analysisTFChart");
  const data = state.analysisTF;
  if (!canvas || !data) return;
  attachTfCursor();
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 360;
  const height = canvas.clientHeight || 210;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const view = $("#analysisTFView")?.value || "bode";
  if (view === "step") drawTFStep(ctx, data, width, height);
  else if (view === "poles") drawTFPoles(ctx, data, width, height);
  else drawTFBode(ctx, data, width, height);
}
function tfRange(values) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) return [0, 1];
  let low = Math.min(...finite);
  let high = Math.max(...finite);
  if (high - low < 1e-9) {
    low -= 1;
    high += 1;
  }
  const pad = (high - low) * 0.1;
  return [low - pad, high + pad];
}
function drawTFBode(ctx, data, width, height) {
  const bode = data.bode || {};
  const omega = (bode.omega || []).map(Number);
  const magnitude = (bode.magnitude_db || []).map(Number);
  const phase = (bode.phase_deg || []).map(Number);
  if (omega.length < 2 || !magnitude.some(Number.isFinite)) return;
  const left = 44;
  const right = 10;
  const top = 12;
  const bottom = 20;
  const gap = 16;
  const plotWidth = Math.max(24, width - left - right);
  const plotHeight = Math.max(28, (height - top - bottom - gap) / 2);
  const phaseTop = top + plotHeight + gap;
  const logMin = Math.log10(Math.max(omega[0], 1e-9));
  const logMax = Math.log10(Math.max(omega[omega.length - 1], 1e-8));
  const logSpan = Math.max(logMax - logMin, 1e-9);
  const xAt = (index) => left + plotWidth * ((Math.log10(Math.max(omega[index], 1e-9)) - logMin) / logSpan);
  const grid = tokens().tfGrid;
  const axis = tokens().tfAxis;
  ctx.font = '9px "Cascadia Code", Consolas, monospace';
  const panel = (base, values, color, unit) => {
    const [low, high] = tfRange(values);
    ctx.strokeStyle = grid;
    ctx.fillStyle = C("#7b7266");
    ctx.textAlign = "right";
    for (let index = 0; index <= 3; index += 1) {
      const y = base + plotHeight * index / 3;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + plotWidth, y);
      ctx.stroke();
      ctx.fillText(fmt(high - (high - low) * index / 3, 2), left - 4, y + 3);
    }
    ctx.textAlign = "left";
    ctx.fillText(unit, 3, base + 8);
    ctx.strokeStyle = axis;
    ctx.beginPath();
    ctx.moveTo(left, base + plotHeight + 0.5);
    ctx.lineTo(left + plotWidth, base + plotHeight + 0.5);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    let started = false;
    for (let index = 0; index < Math.min(omega.length, values.length); index += 1) {
      const value = values[index];
      if (!Number.isFinite(value)) {
        started = false;
        continue;
      }
      const x = xAt(index);
      const y = base + plotHeight * (1 - (value - low) / Math.max(high - low, 1e-9));
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  };
  panel(top, magnitude, C("#a8541f"), "dB");
  panel(phaseTop, phase, C("#3f6f8f"), "deg");
  ctx.strokeStyle = grid;
  ctx.fillStyle = C("#7b7266");
  ctx.textAlign = "center";
  let decades = 0;
  for (let exponent = Math.ceil(logMin); exponent <= Math.floor(logMax); exponent += 1) {
    const x = left + plotWidth * ((exponent - logMin) / logSpan);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, phaseTop + plotHeight);
    ctx.stroke();
    ctx.fillText(`10^${exponent}`, x, height - 5);
    decades += 1;
  }
  if (!decades) {
    ctx.textAlign = "left";
    ctx.fillText(fmt(omega[0], 2), left, height - 5);
    ctx.textAlign = "right";
    ctx.fillText(fmt(omega[omega.length - 1], 2), left + plotWidth, height - 5);
  }
  ctx.textAlign = "left";
  ctx.fillStyle = C("#7b7266");
  ctx.fillText("rad/s", left + plotWidth - 34, height - 5);
  const cursor = state.tfCursor;
  if (cursor != null && cursor >= 0 && cursor < omega.length) {
    const x = xAt(cursor);
    ctx.save();
    ctx.strokeStyle = C("rgba(168, 84, 31, 0.55)");
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, phaseTop + plotHeight);
    ctx.stroke();
    ctx.setLineDash([]);
    const dot = (base, value) => {
      if (!Number.isFinite(value)) return;
      const [low, high] = tfRange(base === top ? magnitude : phase);
      const y = base + plotHeight * (1 - (value - low) / Math.max(high - low, 1e-9));
      ctx.fillStyle = C("#a8541f");
      ctx.strokeStyle = tokens().tfDotRing;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(x, y, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };
    dot(top, magnitude[cursor]);
    dot(phaseTop, phase[cursor]);
    const label = `\u03C9=${fmt(omega[cursor], 3)}  |G|=${fmt(magnitude[cursor], 2)} dB  \u2220=${fmt(phase[cursor], 1)}\xB0`;
    ctx.font = '10px "Cascadia Code", Consolas, monospace';
    const labelWidth = ctx.measureText(label).width + 12;
    ctx.fillStyle = tokens().tfCalloutBg;
    ctx.strokeStyle = C("rgba(168, 84, 31, 0.35)");
    ctx.beginPath();
    ctx.roundRect(left + 4, top + 3, Math.min(labelWidth, plotWidth - 8), 30, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C("#5f3a20");
    ctx.textAlign = "left";
    ctx.fillText(label, left + 10, top + 15);
    ctx.font = '8px "Cascadia Code", Consolas, monospace';
    ctx.fillStyle = C("#8a7b68");
    ctx.fillText("\u62D6\u52A8\u8BFB\u6570 \xB7 \u2190 \u2192 \u5438\u9644\u91C7\u6837\u70B9\uFF08Shift \xD710\uFF09", left + 10, top + 27);
    ctx.restore();
  }
}
function tfBodeCursorFromEvent(event, clamp = false) {
  const data = state.analysisTF;
  const canvas = $("#analysisTFChart");
  const bode = data?.bode;
  if (!canvas || !bode?.omega?.length) return null;
  const rect = canvas.getBoundingClientRect();
  const left = 44;
  const right = 10;
  const width = rect.width;
  const plotWidth = Math.max(24, width - left - right);
  let x = event.clientX - rect.left;
  if (clamp) {
    x = Math.max(left, Math.min(left + plotWidth, x));
  } else if (x < left || x > left + plotWidth) {
    return null;
  }
  const omega = bode.omega.map(Number);
  const logMin = Math.log10(Math.max(omega[0], 1e-9));
  const logMax = Math.log10(Math.max(omega[omega.length - 1], 1e-8));
  const target = logMin + (x - left) / plotWidth * Math.max(logMax - logMin, 1e-9);
  let best = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < omega.length; index += 1) {
    const distance = Math.abs(Math.log10(Math.max(omega[index], 1e-9)) - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}
function attachTfCursor() {
  const canvas = $("#analysisTFChart");
  if (!canvas || canvas.dataset.tfCursor === "1") return;
  canvas.dataset.tfCursor = "1";
  canvas.tabIndex = 0;
  canvas.style.cursor = "crosshair";
  const active = () => ($("#analysisTFView")?.value || "bode") === "bode";
  const move = (event, clamp = false) => {
    if (!active()) return;
    const index = tfBodeCursorFromEvent(event, clamp);
    if (index == null) return;
    state.tfCursor = index;
    drawAnalysisTF();
  };
  canvas.addEventListener("mousemove", (event) => {
    move(event, state.tfDragging);
  });
  canvas.addEventListener("mousedown", (event) => {
    if (!active()) return;
    state.tfDragging = true;
    canvas.style.cursor = "grabbing";
    move(event, true);
    event.preventDefault();
  });
  window.addEventListener("mouseup", () => {
    if (!state.tfDragging) return;
    state.tfDragging = false;
    canvas.style.cursor = "crosshair";
  });
  canvas.addEventListener("mouseleave", () => {
    if (state.tfDragging || state.tfCursor == null) return;
    state.tfCursor = null;
    drawAnalysisTF();
  });
  canvas.addEventListener("keydown", (event) => {
    if (!active() || state.tfCursor == null) return;
    const omegaLength = state.analysisTF?.bode?.omega?.length || 0;
    if (!omegaLength) return;
    const step = event.shiftKey ? 10 : 1;
    if (event.key === "ArrowLeft") {
      state.tfCursor = Math.max(0, state.tfCursor - step);
    } else if (event.key === "ArrowRight") {
      state.tfCursor = Math.min(omegaLength - 1, state.tfCursor + step);
    } else {
      return;
    }
    event.preventDefault();
    drawAnalysisTF();
  });
}
function drawTFStep(ctx, data, width, height) {
  const step = data.step || {};
  const time = (step.t || []).map(Number);
  const values = (step.y || []).map(Number);
  if (time.length < 2 || !values.some(Number.isFinite)) return;
  const left = 46;
  const right = 10;
  const top = 12;
  const bottom = 20;
  const plotWidth = Math.max(24, width - left - right);
  const plotHeight = Math.max(24, height - top - bottom);
  const [low, high] = tfRange(values);
  const xAt = (index) => left + plotWidth * ((time[index] - time[0]) / Math.max(time[time.length - 1] - time[0], 1e-9));
  const yAt = (value) => top + plotHeight * (1 - (value - low) / Math.max(high - low, 1e-9));
  const grid = tokens().tfGrid;
  const axis = tokens().tfAxis;
  ctx.font = '9px "Cascadia Code", Consolas, monospace';
  ctx.strokeStyle = grid;
  ctx.fillStyle = C("#7b7266");
  ctx.textAlign = "right";
  for (let index = 0; index <= 3; index += 1) {
    const y = top + plotHeight * index / 3;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left + plotWidth, y);
    ctx.stroke();
    ctx.fillText(fmt(high - (high - low) * index / 3, 3), left - 4, y + 3);
  }
  ctx.strokeStyle = axis;
  ctx.beginPath();
  ctx.moveTo(left, top + plotHeight + 0.5);
  ctx.lineTo(left + plotWidth, top + plotHeight + 0.5);
  ctx.stroke();
  const metrics = step.metrics || {};
  if (Number.isFinite(metrics.final)) {
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = tokens().tfGhostLine;
    ctx.beginPath();
    ctx.moveTo(left, yAt(metrics.final));
    ctx.lineTo(left + plotWidth, yAt(metrics.final));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.strokeStyle = C("#a8541f");
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let started = false;
  for (let index = 0; index < Math.min(time.length, values.length); index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) {
      started = false;
      continue;
    }
    const x = xAt(index);
    const y = yAt(value);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  if (Number.isFinite(metrics.peak_value) && Number.isFinite(metrics.peak_time)) {
    let peakIndex = 0;
    let best = Infinity;
    for (let index = 0; index < Math.min(time.length, values.length); index += 1) {
      if (!Number.isFinite(time[index])) continue;
      const distance = Math.abs(time[index] - metrics.peak_time);
      if (distance < best) {
        best = distance;
        peakIndex = index;
      }
    }
    const px = xAt(peakIndex);
    const py = yAt(metrics.peak_value);
    ctx.fillStyle = C("#8a4b12");
    ctx.beginPath();
    ctx.arc(px, py, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = px > left + plotWidth * 0.66 ? "right" : "left";
    ctx.fillText(
      `\u5CF0\u503C ${fmt(metrics.peak_value, 3)} @ ${fmt(metrics.peak_time, 3)} s`,
      px + (ctx.textAlign === "right" ? -5 : 5),
      Math.max(top + 9, py - 6)
    );
  }
  ctx.fillStyle = C("#7b7266");
  ctx.textAlign = "left";
  ctx.fillText("0 s", left, height - 5);
  ctx.textAlign = "right";
  ctx.fillText(`${fmt(time[time.length - 1], 3)} s`, left + plotWidth, height - 5);
}
function drawTFPoles(ctx, data, width, height) {
  const poles = data.poles || [];
  const zeros = data.zeros || [];
  const left = 18;
  const right = 10;
  const top = 12;
  const bottom = 18;
  const plotWidth = Math.max(24, width - left - right);
  const plotHeight = Math.max(24, height - top - bottom);
  const all = [...poles, ...zeros];
  let extent = 1;
  for (const point of all) {
    extent = Math.max(extent, Math.abs(Number(point.real) || 0), Math.abs(Number(point.imag) || 0));
  }
  extent *= 1.15;
  const cx = left + plotWidth / 2;
  const cy = top + plotHeight / 2;
  const scale = Math.min(plotWidth / (2 * extent), plotHeight / (2 * extent));
  const xAt = (real) => cx + real * scale;
  const yAt = (imag) => cy - imag * scale;
  ctx.fillStyle = tokens().tfLeftTint;
  ctx.fillRect(left, top, plotWidth / 2, plotHeight);
  const grid = tokens().tfGrid;
  const axis = tokens().tfAxisStrong;
  ctx.strokeStyle = grid;
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(cx, top + plotHeight);
  ctx.moveTo(left, cy);
  ctx.lineTo(left + plotWidth, cy);
  ctx.stroke();
  ctx.strokeStyle = axis;
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(cx, top + plotHeight);
  ctx.moveTo(left, cy);
  ctx.lineTo(left + plotWidth, cy);
  ctx.stroke();
  ctx.font = '9px "Cascadia Code", Consolas, monospace';
  ctx.fillStyle = C("#7b7266");
  ctx.textAlign = "center";
  ctx.fillText("Re", left + plotWidth - 10, cy - 4);
  ctx.textAlign = "left";
  ctx.fillText("Im", cx + 4, top + 8);
  for (const point of zeros) {
    const x = xAt(Number(point.real) || 0);
    const y = yAt(Number(point.imag) || 0);
    ctx.strokeStyle = C("#3f6f8f");
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const point of poles) {
    const x = xAt(Number(point.real) || 0);
    const y = yAt(Number(point.imag) || 0);
    ctx.strokeStyle = C("#a8541f");
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x - 4, y - 4);
    ctx.lineTo(x + 4, y + 4);
    ctx.moveTo(x + 4, y - 4);
    ctx.lineTo(x - 4, y + 4);
    ctx.stroke();
  }
  ctx.fillStyle = C("#7b7266");
  ctx.textAlign = "left";
  ctx.fillText("\xD7 \u6781\u70B9   \u25CB \u96F6\u70B9", left + 2, top + 9);
}
function exportTFStateSpace() {
  const space = state.analysisTF?.state_space;
  if (!space) {
    toast("\u5F53\u524D\u4F20\u9012\u51FD\u6570\u6CA1\u6709 A/B/C/D\uFF08\u9759\u6001\u589E\u76CA\u6216 z \u57DF\u7ED3\u679C\uFF09", "info", 3200);
    return;
  }
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  downloadText(JSON.stringify({ version: 1, state_space: space }, null, 2), `netlab-state-space-${stamp}.json`);
  toast(`\u5DF2\u5BFC\u51FA ${space.order} \u9636 A/B/C/D`, "ok", 2600);
}
async function sendCurveToPlotKit(name, x, y, xLabel, yLabel) {
  if (!Array.isArray(x) || !Array.isArray(y) || x.length < 2 || x.length !== y.length) {
    toast("\u8FD9\u6761\u66F2\u7EBF\u4E3A\u7A7A\uFF0C\u65E0\u6CD5\u53D1\u9001\u5230 PlotKit", "info", 2800);
    return null;
  }
  try {
    const response = await jsonRequest("/api/plotkit/analysis", "POST", {
      name,
      x,
      y,
      x_label: xLabel,
      y_label: yLabel
    });
    if (!response?.ok) {
      toast(`PlotKit \u63A5\u6536\u5931\u8D25\uFF1A${response?.reason || "\u672A\u6302\u8F7D"}`, "error", 4200);
      return null;
    }
    toast(`\u5DF2\u53D1\u9001\u300C${response.label}\u300D\u5230 PlotKit\uFF08${response.points} \u70B9\uFF09`, "ok", 3200);
    return response;
  } catch (error) {
    toast(`PlotKit \u63A5\u6536\u5931\u8D25\uFF1A${error.message}`, "error", 4200);
    return null;
  }
}
async function sendTFToPlotKit() {
  const step = state.analysisTF?.step;
  if (!step?.t || !step?.y) {
    toast("\u5148\u63A8\u5BFC\u4E00\u6761\u4F20\u9012\u51FD\u6570\u9636\u8DC3\u54CD\u5E94", "info", 3e3);
    return;
  }
  await sendCurveToPlotKit("TF \u9636\u8DC3\u54CD\u5E94", step.t, step.y, "t / s", "\u5E45\u503C");
}
function phaseSeriesForPlotKit() {
  const node = nodeByName(state.phaseNode);
  if (!node) return null;
  const frames = state.frames || [];
  const pairs = [];
  const stateKeys = phaseStateKeys(node);
  if (stateKeys.length >= 2) pairs.push([stateKeys[0], stateKeys[1]]);
  pairs.push(
    [`n:${node.name}:x`, `n:${node.name}:y`],
    [`n:${node.name}:vx`, `n:${node.name}:vy`],
    [`n:${node.name}:x1`, `n:${node.name}:x2`]
  );
  for (const [keyX, keyY] of pairs) {
    const points = frames.filter(
      (frame) => typeof frame.v?.[keyX] === "number" && typeof frame.v?.[keyY] === "number"
    );
    if (points.length >= 2) {
      return {
        name: `\u76F8\u56FE ${node.name}`,
        x: points.map((frame) => frame.v[keyX]),
        y: points.map((frame) => frame.v[keyY]),
        xLabel: keyX.split(":").pop(),
        yLabel: keyY.split(":").pop()
      };
    }
  }
  return null;
}
async function sendPhaseToPlotKit() {
  const series = phaseSeriesForPlotKit();
  if (!series) {
    toast("\u5F53\u524D\u76F8\u56FE\u6CA1\u6709\u53EF\u53D1\u9001\u7684\u8F68\u8FF9", "info", 3e3);
    return;
  }
  await sendCurveToPlotKit(series.name, series.x, series.y, series.xLabel, series.yLabel);
}
async function exportAnalysisCsv(keys = null, defaultName = "analysis") {
  const name = window.prompt("CSV \u6587\u4EF6\u540D\uFF08\u5199\u5165 exports/\uFF0C\u540C\u540D\u81EA\u52A8\u52A0\u5E8F\u53F7\uFF09", defaultName);
  if (name === null) return;
  const key = analysisSignalKey();
  const wanted = Array.isArray(keys) && keys.length ? keys : key ? [key] : null;
  const response = await task(
    () => jsonRequest("/api/analysis/export", "POST", { name: name || defaultName, keys: wanted, decimate: 1 })
  );
  if (!response) return;
  setAnalysisOutput(`\u5DF2\u5BFC\u51FA ${response.rows} \u884C \u2192 ${response.path}
\u5217\uFF1A${(response.columns || []).join(", ")}`);
  toast(`CSV \u5DF2\u5199\u5165 ${response.path}`, "ok", 3400);
}
function drawAnalysisSpectrum() {
  const canvas = $("#analysisChart");
  const data = state.analysisSpectrum;
  if (!canvas || !data) return;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 320;
  const height = canvas.clientHeight || 150;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const mags = data.magnitude || [];
  const freqs = data.freqs || [];
  if (!mags.length) return;
  const peak = Math.max(...mags.filter((v) => Number.isFinite(v)), 1e-12);
  const n = Math.min(mags.length, 400);
  const bw = width / n;
  for (let index = 0; index < n; index += 1) {
    const value = mags[index] / peak;
    const barH = Math.max(0, Math.min(1, value)) * (height - 18);
    ctx.fillStyle = index === 0 ? tokens().nyqLabel : C("rgba(168, 84, 31, 0.55)");
    ctx.fillRect(index * bw, height - 14 - barH, Math.max(1, bw - 0.5), barH);
  }
  ctx.strokeStyle = tokens().tfAxisSoft;
  ctx.beginPath();
  ctx.moveTo(0, height - 14.5);
  ctx.lineTo(width, height - 14.5);
  ctx.stroke();
  ctx.fillStyle = C("#7b7266");
  ctx.font = '9px "Cascadia Code", Consolas, monospace';
  ctx.fillText("0 Hz", 2, height - 3);
  const maxFreq = freqs.length ? freqs[Math.min(freqs.length - 1, 399)] : 0;
  ctx.fillText(`${fmt(maxFreq, 1)} Hz`, width - 44, height - 3);
}
export {
  analysisGet,
  analysisSignalKey,
  analysisTFSummary,
  attachTfCursor,
  drawAnalysisSpectrum,
  drawAnalysisTF,
  drawTFBode,
  drawTFPoles,
  drawTFStep,
  exportAnalysisCsv,
  exportTFStateSpace,
  fmtComplex,
  phaseSeriesForPlotKit,
  runAnalysisMath,
  runAnalysisMetrics,
  runAnalysisPeriod,
  runAnalysisSpectrum,
  runAnalysisTF,
  runAnalysisTransfer,
  sendCurveToPlotKit,
  sendPhaseToPlotKit,
  sendTFToPlotKit,
  setAnalysisActions,
  setAnalysisOutput,
  tfBodeCursorFromEvent,
  tfRange
};
