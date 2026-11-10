import { PALETTE } from "./constants.js";
import { api } from "./net.js";
import { $, $$ } from "./dom.js";
import { chartPalette } from "./theme.js";
import { raiseFloatWindow } from "./float.js";
import { state } from "./state.js";
import { probeNamesForAc } from "./ac_probe.js";
import { toast } from "./desktop.js";
function analEscape(text) {
  return String(text ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
}
function analNum(value, digits = 6) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "\u2014";
  const abs = Math.abs(num);
  if (abs !== 0 && (abs < 1e-4 || abs >= 1e5)) return num.toExponential(3);
  return String(Number(num.toFixed(digits)));
}
function analToken(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name);
  return (value || "").trim() || fallback;
}
function analysisWarn() {
  toast("\u5206\u6790\u4F1A\u57FA\u4E8E\u5F53\u524D\u573A\u666F\u91CD\u65B0\u6C42\u89E3\uFF0C\u671F\u95F4\u5B9E\u65F6\u64AD\u653E\u4F1A\u6682\u505C\uFF1B\u53EF\u968F\u65F6\u5173\u95ED\u5206\u6790\u7A97\u3002", "warn", 4200);
}
function openAnalysis(tab = "op") {
  const win = $("#analWin");
  if (!win) return;
  if ((state.scene?.mode || state.mode) !== "circuit") {
    toast("\u7535\u8DEF\u5206\u6790\u53EA\u5728\u7535\u8DEF\u6A21\u5F0F\u4E0B\u53EF\u7528", "error", 4e3);
    return;
  }
  win.hidden = false;
  raiseFloatWindow(win);
  fillAcSources();
  fillBypassSources();
  selectAnalTab(tab);
}
function closeAnalysis() {
  const win = $("#analWin");
  if (win) win.hidden = true;
}
function selectAnalTab(tab) {
  for (const btn of $$(".anal-tab")) {
    btn.classList.toggle("active", btn.dataset.anal === tab);
  }
  for (const pane of $$(".anal-pane")) {
    pane.hidden = pane.dataset.analPane !== tab;
  }
  if (tab === "ac") requestAnimationFrame(() => drawAcChart());
  if (tab === "bypass") {
    fillBypassSources();
    requestAnimationFrame(() => drawBypassCharts());
  }
}
function fillAcSources() {
  const select = $("#analAcInput");
  if (!select) return;
  const previous = select.value;
  const nodes = state.scene?.nodes || [];
  const sources = nodes.filter((node) => {
    const kind = node.kind === "device" ? node.params?.element : node.kind;
    return kind === "vsource" || kind === "isource";
  });
  select.innerHTML = '<option value="">\u81EA\u52A8</option>' + sources.map((node) => `<option value="${analEscape(node.name)}">${analEscape(node.name)}</option>`).join("");
  if (sources.some((node) => node.name === previous)) select.value = previous;
}
async function runOperatingPoint() {
  analysisWarn();
  const body = $("#analOpTable");
  const meta = $("#analOpMeta");
  if (meta) meta.textContent = "\u6C42\u89E3\u4E2D\u2026";
  try {
    const data = await api("/api/operating-point");
    const result = data.result || {};
    const nodeRows = Object.entries(result.node_voltages || {}).map(([name, value]) => `<tr><td>${analEscape(name)}</td><td class="num">${analNum(value)}</td></tr>`).join("");
    const elementRows = Object.entries(result.elements || {}).map(([name, info]) => `<tr><td>${analEscape(name)}</td><td class="num">${analNum(info.current)}</td><td class="num">${analNum(info.voltage_difference)}</td><td class="num">${analNum(info.power)}</td></tr>`).join("");
    if (body) {
      body.innerHTML = "<table><caption>\u8282\u70B9\u7535\u538B\uFF08V\uFF09</caption><thead><tr><th>\u8282\u70B9</th><th>\u7535\u538B</th></tr></thead><tbody>" + (nodeRows || '<tr><td colspan="2">\u6CA1\u6709\u8282\u70B9</td></tr>') + "</tbody></table><table><caption>\u5143\u4EF6</caption><thead><tr><th>\u5143\u4EF6</th><th>\u7535\u6D41\uFF08A\uFF09</th><th>\u7AEF\u7535\u538B\uFF08V\uFF09</th><th>\u529F\u7387\uFF08W\uFF09</th></tr></thead><tbody>" + (elementRows || '<tr><td colspan="4">\u6CA1\u6709\u5143\u4EF6</td></tr>') + "</tbody></table>";
    }
    if (meta) {
      meta.textContent = `\u8FED\u4EE3 ${result.iterations ?? "\u2014"} \u6B65 \xB7 \u77E9\u9635 ${result.matrix_size ?? "\u2014"} \xB7 \u6B8B\u5DEE ${analNum(result.residual, 3)} \xB7 ${result.sparse ? "\u7A00\u758F" : "\u7A20\u5BC6"}` + (result.strategies?.length ? ` \xB7 ${result.strategies.join("/")}` : "");
    }
  } catch (error) {
    if (body) body.innerHTML = `<div class="anal-empty">${analEscape(error.message)}</div>`;
    if (meta) meta.textContent = "\u6C42\u89E3\u5931\u8D25";
    toast(`DC \u5DE5\u4F5C\u70B9\u5931\u8D25\uFF1A${error.message}`, "error", 6e3);
  }
}
async function runAcSweep() {
  analysisWarn();
  const meta = $("#analAcMeta");
  const params = new URLSearchParams();
  const input = $("#analAcInput")?.value || "";
  if (input) params.set("input", input);
  params.set("f_start", $("#analAcF1")?.value || "10");
  params.set("f_stop", $("#analAcF2")?.value || "1000000");
  params.set("points", $("#analAcPts")?.value || "121");
  params.set("scale", $("#analAcScale")?.value || "log");
  const probeNames = probeNamesForAc(state.scene?.nodes || []);
  if (probeNames.length) params.set("probes", probeNames.join(","));
  if (meta) meta.textContent = "\u626B\u9891\u4E2D\u2026";
  try {
    const data = await api(`/api/ac-sweep?${params.toString()}`);
    state.acResult = data.result || null;
    state.acRevision = state.scene?.revision ?? null;
    const result = state.acResult;
    const count = Object.keys(result?.probes || {}).length;
    if (meta) {
      meta.textContent = `${count} \u6761\u66F2\u7EBF \xB7 \u6FC0\u52B1 ${result?.input || "\u2014"} \xB7 ${result?.frequencies?.length || 0} \u70B9`;
    }
    drawAcChart();
  } catch (error) {
    state.acResult = null;
    if (meta) meta.textContent = "\u626B\u9891\u5931\u8D25";
    toast(`AC \u626B\u9891\u5931\u8D25\uFF1A${error.message}`, "error", 7e3);
    drawAcChart();
  }
}
function drawAcChart() {
  const canvas2 = $("#analAcCanvas");
  if (!canvas2) return;
  const rect = canvas2.getBoundingClientRect();
  if (rect.width < 40 || rect.height < 40) return;
  const dpr = window.devicePixelRatio || 1;
  canvas2.width = Math.round(rect.width * dpr);
  canvas2.height = Math.round(rect.height * dpr);
  const ctx2 = canvas2.getContext("2d");
  ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = rect.width;
  const H = rect.height;
  const ink = analToken("--ink", "#080a08");
  const muted = analToken("--muted", "#7b7266");
  const line = analToken("--line", "#d9d3c7");
  ctx2.clearRect(0, 0, W, H);
  const result = state.acResult;
  const legend = $("#analAcLegend");
  if (!result || !result.frequencies?.length) {
    if (legend) legend.innerHTML = "";
    ctx2.fillStyle = muted;
    ctx2.font = '12.5px "Microsoft YaHei UI", sans-serif';
    ctx2.fillText("\u9009\u62E9\u6FC0\u52B1\u4E0E\u9891\u7387\u8303\u56F4\u540E\u70B9\u300C\u5F00\u59CB\u626B\u9891\u300D", 16, 26);
    return;
  }
  const freqs = result.frequencies;
  const probes = Object.entries(result.probes || {});
  const scale = $("#analAcScale")?.value || "log";
  const f0 = freqs[0];
  const f1 = freqs[freqs.length - 1];
  const padL = 52;
  const padR = 14;
  const padT = 12;
  const gap = 30;
  const padB = 26;
  const magH = (H - padT - padB - gap) * 0.62;
  const phaseH = H - padT - padB - gap - magH;
  const magTop = padT;
  const phaseTop = padT + magH + gap;
  const plotW = Math.max(40, W - padL - padR);
  const xOf = (f) => {
    if (scale === "log") {
      const lo = Math.log10(Math.max(f0, 1e-9));
      const hi = Math.log10(Math.max(f1, 1e-9));
      const span2 = hi - lo || 1;
      return padL + (Math.log10(Math.max(f, 1e-9)) - lo) / span2 * plotW;
    }
    const span = f1 - f0 || 1;
    return padL + (f - f0) / span * plotW;
  };
  let minDb = 0;
  let maxDb = 0;
  for (const [, info] of probes) {
    for (const value of info.db || []) {
      if (!Number.isFinite(value)) continue;
      minDb = Math.min(minDb, value);
      maxDb = Math.max(maxDb, value);
    }
  }
  if (maxDb - minDb < 6) {
    maxDb += 3;
    minDb -= 3;
  } else {
    minDb -= 3;
    maxDb += 3;
  }
  const yMag = (db) => magTop + (1 - (db - minDb) / (maxDb - minDb || 1)) * magH;
  const yPhase = (deg) => phaseTop + (1 - (deg + 180) / 360) * phaseH;
  ctx2.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx2.strokeStyle = line;
  ctx2.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = magTop + magH * i / 4;
    ctx2.beginPath();
    ctx2.moveTo(padL, y);
    ctx2.lineTo(padL + plotW, y);
    ctx2.stroke();
    ctx2.fillStyle = muted;
    const value = maxDb - (maxDb - minDb) * i / 4;
    ctx2.fillText(`${value.toFixed(0)} dB`, 6, y + 4);
  }
  for (const deg of [-180, -90, 0, 90, 180]) {
    const y = yPhase(deg);
    ctx2.beginPath();
    ctx2.moveTo(padL, y);
    ctx2.lineTo(padL + plotW, y);
    ctx2.stroke();
    ctx2.fillStyle = muted;
    ctx2.fillText(`${deg}\xB0`, 18, y + 4);
  }
  const ticks = 5;
  for (let i = 0; i < ticks; i += 1) {
    const ratio = i / (ticks - 1);
    const f = scale === "log" ? 10 ** (Math.log10(f0) + (Math.log10(f1) - Math.log10(f0)) * ratio) : f0 + (f1 - f0) * ratio;
    const x = padL + plotW * ratio;
    ctx2.strokeStyle = line;
    ctx2.beginPath();
    ctx2.moveTo(x, magTop);
    ctx2.lineTo(x, magTop + magH + gap + phaseH);
    ctx2.stroke();
    ctx2.fillStyle = muted;
    const label = f >= 1e6 ? `${(f / 1e6).toFixed(1)}M` : f >= 1e3 ? `${(f / 1e3).toFixed(1)}k` : f >= 1 ? `${f.toFixed(0)}` : f.toExponential(0);
    ctx2.fillText(label, x - 8, H - 8);
  }
  const swatches = [];
  probes.forEach(([name, info], index) => {
    const chartMode = String(state.prefs && state.prefs.chartPalette || "theme");
    const series = chartMode === "theme" ? PALETTE : chartPalette();
    const color = series[index % series.length];
    swatches.push(`<span><i style="background:${color}"></i>${analEscape(name)}</span>`);
    const draw = (values, yFn) => {
      ctx2.beginPath();
      ctx2.strokeStyle = color;
      ctx2.lineWidth = 1.6;
      let started = false;
      for (let i = 0; i < freqs.length; i += 1) {
        const value = values?.[i];
        if (!Number.isFinite(value)) continue;
        const x = xOf(freqs[i]);
        const y = yFn(value);
        if (!started) {
          ctx2.moveTo(x, y);
          started = true;
        } else {
          ctx2.lineTo(x, y);
        }
      }
      if (started) ctx2.stroke();
    };
    draw(info.db, yMag);
    draw(info.phase_deg, yPhase);
  });
  if (legend) legend.innerHTML = swatches.join("");
  ctx2.fillStyle = ink;
  ctx2.font = '11.5px "Microsoft YaHei UI", sans-serif';
  ctx2.fillText("\u5E45\u503C", 6, magTop + 8);
  ctx2.fillText("\u76F8\u4F4D", 6, phaseTop + 10);
}
let bypassResult = null;
function bypassNodeKind(node) {
  return node.kind === "device" ? node.params?.element || "" : node.kind || "";
}
function fillBypassSources() {
  const input = $("#analBypassInput");
  const output = $("#analBypassOutput");
  const nodes = state.scene?.nodes || [];
  const edges = state.scene?.edges || [];
  if (input) {
    const previous = input.value;
    const edgeSources = edges.filter((edge) => ["vsource", "isource"].includes(edge.kind)).map((edge) => edge.name);
    const nodeSources = nodes.filter((node) => ["vsource", "isource"].includes(bypassNodeKind(node))).map((node) => node.name);
    const sources = Array.from(/* @__PURE__ */ new Set([...edgeSources, ...nodeSources]));
    input.innerHTML = '<option value="">\u81EA\u52A8</option>' + sources.map((name) => `<option value="${analEscape(name)}">${analEscape(name)}</option>`).join("");
    if (sources.includes(previous)) input.value = previous;
  }
  if (output) {
    const previous = output.value;
    const probes = nodes.filter((node) => node.kind !== "ground");
    output.innerHTML = probes.map((node) => `<option value="${analEscape(node.name)}">${analEscape(node.name)}</option>`).join("");
    if (probes.some((node) => node.name === previous)) output.value = previous;
  }
}
function bypassComplex(value) {
  if (!Array.isArray(value)) return "\u2014";
  const [re, im] = value;
  const real = analNum(re);
  const imag = Math.abs(im) < 1e-12 ? "0" : analNum(Math.abs(im));
  if (Math.abs(im) < 1e-12) return real;
  return `${real} ${im < 0 ? "\u2212" : "+"} j${imag}`;
}
function bypassTable(target, label, data) {
  const host = $(target);
  if (!host) return;
  const values = data?.finite || [];
  const rows = values.map((value, index) => `<tr><td>${index + 1}</td><td class="num">${bypassComplex(value)}</td></tr>`).join("");
  const notes = [];
  if (data?.infinite_count) notes.push(`\u65E0\u7A77\u6A21\u6001 ${data.infinite_count}`);
  if (data?.max_residual !== void 0) notes.push(`\u6B8B\u5DEE ${analNum(data.max_residual)}`);
  if (data?.regular === false) notes.push("QZ \u975E\u6B63\u5219");
  if (data?.siso === false) notes.push("MIMO \u672A\u6C42\u96F6\u70B9");
  host.innerHTML = `<div class="anal-meta">${label}\uFF08${values.length} \u4E2A\uFF09${notes.length ? ` \xB7 ${notes.join(" \xB7 ")}` : ""}</div>` + (rows ? `<table class="anal-table"><thead><tr><th>#</th><th>\u503C</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="anal-empty">\u65E0\u6709\u9650\u503C</div>');
}
function bypassPlotFrame(canvasEl, emptyText) {
  const rect = canvasEl.getBoundingClientRect();
  if (rect.width < 40 || rect.height < 40) return null;
  const dpr = window.devicePixelRatio || 1;
  canvasEl.width = Math.round(rect.width * dpr);
  canvasEl.height = Math.round(rect.height * dpr);
  const context = canvasEl.getContext("2d");
  if (!context) return null;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  if (!bypassResult) {
    context.fillStyle = analToken("--muted", "#7b7266");
    context.font = '12.5px "Microsoft YaHei UI", sans-serif';
    context.fillText(emptyText, 16, 26);
    return null;
  }
  return { context, width: rect.width, height: rect.height };
}
function drawBypassBode() {
  const canvasEl = $("#analBypassBode");
  if (!canvasEl) return;
  const frame = bypassPlotFrame(canvasEl, "\u9009\u62E9\u6FC0\u52B1\u4E0E\u8F93\u51FA\u540E\u70B9\u300CBode\u300D");
  if (!frame) return;
  const { context, width, height } = frame;
  const freqs = bypassResult?.bode?.frequencies || [];
  const probes = Object.entries(bypassResult?.bode?.probes || {});
  const legend = $("#analBypassLegend");
  if (!freqs.length || !probes.length) {
    context.fillStyle = analToken("--muted", "#7b7266");
    context.font = '12.5px "Microsoft YaHei UI", sans-serif';
    context.fillText("\u6CA1\u6709 Bode \u6570\u636E", 16, 26);
    if (legend) legend.innerHTML = "";
    return;
  }
  const info = probes[0][1];
  const db = info.db || [];
  const phase = info.phase_deg || [];
  const padL = 52;
  const padR = 14;
  const padT = 12;
  const padB = 26;
  const gap = 24;
  const plotW = Math.max(40, width - padL - padR);
  const magH = (height - padT - padB - gap) * 0.62;
  const phaseH = height - padT - padB - gap - magH;
  const phaseTop = padT + magH + gap;
  const logLo = Math.log10(Math.max(freqs[0], 1e-12));
  const logHi = Math.log10(Math.max(freqs[freqs.length - 1], 1e-12));
  const span = logHi - logLo || 1;
  const xOf = (f) => padL + (Math.log10(Math.max(f, 1e-12)) - logLo) / span * plotW;
  let minDb = 0;
  let maxDb = 0;
  for (const value of db) {
    if (!Number.isFinite(value)) continue;
    minDb = Math.min(minDb, value);
    maxDb = Math.max(maxDb, value);
  }
  if (maxDb - minDb < 6) {
    maxDb += 3;
    minDb -= 3;
  } else {
    minDb -= 3;
    maxDb += 3;
  }
  const yMag = (value) => padT + (1 - (value - minDb) / (maxDb - minDb || 1)) * magH;
  const yPhase = (value) => phaseTop + (1 - (value + 180) / 360) * phaseH;
  const line = analToken("--line", "#d9d3c7");
  const muted = analToken("--muted", "#7b7266");
  context.strokeStyle = line;
  context.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = padT + magH * i / 4;
    context.beginPath();
    context.moveTo(padL, y);
    context.lineTo(padL + plotW, y);
    context.stroke();
    context.fillStyle = muted;
    context.font = "10px ui-monospace, monospace";
    context.fillText(`${analNum(maxDb - (maxDb - minDb) * i / 4, 3)} dB`, 4, y + 3);
  }
  context.strokeStyle = PALETTE[0];
  context.lineWidth = 1.6;
  context.beginPath();
  db.forEach((value, index) => {
    const x = xOf(freqs[index]);
    const y = yMag(value);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  context.strokeStyle = PALETTE[1] || PALETTE[0];
  context.beginPath();
  phase.forEach((value, index) => {
    const x = xOf(freqs[index]);
    const y = yPhase(value);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  context.fillStyle = muted;
  context.font = "10.5px ui-monospace, monospace";
  context.fillText("\u5E45\u503C", 6, padT + 9);
  context.fillText("\u76F8\u4F4D", 6, phaseTop + 10);
  context.fillText(`${analNum(freqs[0], 3)} Hz`, padL, height - 7);
  context.fillText(`${analNum(freqs[freqs.length - 1], 3)} Hz`, width - padR - 54, height - 7);
  if (legend) {
    legend.innerHTML = `<span><i style="background:${PALETTE[0]}"></i>${analEscape(probes[0][0])} \u5E45\u503C</span><span><i style="background:${PALETTE[1] || PALETTE[0]}"></i>\u76F8\u4F4D</span>`;
  }
}
function drawBypassStep() {
  const canvasEl = $("#analBypassStep");
  if (!canvasEl) return;
  const frame = bypassPlotFrame(canvasEl, "\u8FD0\u884C\u65C1\u8DEF\u540E\u663E\u793A\u9636\u8DC3\u54CD\u5E94");
  if (!frame) return;
  const { context, width, height } = frame;
  const times = bypassResult?.step?.times || [];
  const values = bypassResult?.step?.values || [];
  if (!times.length || times.length !== values.length) {
    context.fillStyle = analToken("--muted", "#7b7266");
    context.font = '12.5px "Microsoft YaHei UI", sans-serif';
    context.fillText("\u6CA1\u6709\u9636\u8DC3\u6570\u636E", 16, 26);
    return;
  }
  const padL = 52;
  const padR = 14;
  const padT = 14;
  const padB = 26;
  const plotW = Math.max(40, width - padL - padR);
  const plotH = Math.max(30, height - padT - padB);
  const t0 = times[0];
  const t1 = times[times.length - 1];
  let minV = 0;
  let maxV = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    minV = Math.min(minV, value);
    maxV = Math.max(maxV, value);
  }
  if (maxV - minV < 1e-9) {
    maxV += 1e-6;
    minV -= 1e-6;
  }
  const yOf = (value) => padT + (1 - (value - minV) / (maxV - minV || 1)) * plotH;
  const xOf = (time) => padL + (time - t0) / (t1 - t0 || 1) * plotW;
  const line = analToken("--line", "#d9d3c7");
  const muted = analToken("--muted", "#7b7266");
  context.strokeStyle = line;
  context.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = padT + plotH * i / 4;
    context.beginPath();
    context.moveTo(padL, y);
    context.lineTo(padL + plotW, y);
    context.stroke();
    context.fillStyle = muted;
    context.font = "10px ui-monospace, monospace";
    context.fillText(analNum(maxV - (maxV - minV) * i / 4, 3), 4, y + 3);
  }
  context.strokeStyle = PALETTE[2] || PALETTE[0];
  context.lineWidth = 1.6;
  context.beginPath();
  values.forEach((value, index) => {
    const x = xOf(times[index]);
    const y = yOf(value);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  context.fillStyle = muted;
  context.font = "10.5px ui-monospace, monospace";
  context.fillText("V", 6, padT + 9);
  context.fillText(`${analNum(t0, 3)} s`, padL, height - 7);
  context.fillText(`${analNum(t1, 3)} s`, width - padR - 50, height - 7);
}
function drawBypassCharts() {
  drawBypassBode();
  drawBypassStep();
}
async function runCircuitBypass() {
  analysisWarn();
  const input = $("#analBypassInput")?.value || "";
  const output = $("#analBypassOutput")?.value || "";
  const meta = $("#analBypassMeta");
  if (!input || !output) {
    toast("\u65C1\u8DEF\u5206\u6790\u9700\u8981\u9009\u62E9\u6FC0\u52B1\u6E90\u4E0E\u8F93\u51FA\u8282\u70B9", "error", 5e3);
    return;
  }
  if (meta) meta.textContent = "\u6C42\u89E3\u4E2D\u2026";
  try {
    const opData = await api("/api/operating-point");
    const op = (opData.result || {}).node_voltages || null;
    const body = {
      mode: "circuit",
      input_source: input,
      output,
      operating_point: op,
      step_dt: Number($("#analBypassDt")?.value || 1e-5),
      step_duration: Number($("#analBypassDuration")?.value || 5e-3),
      f_start: Number($("#analBypassF1")?.value || 10),
      f_stop: Number($("#analBypassF2")?.value || 1e6),
      points: 121,
      scale: "log"
    };
    const data = await api("/api/analysis/tf", { method: "POST", body: JSON.stringify(body) });
    bypassResult = data;
    const result = bypassResult;
    const stateSpace = result?.state_space;
    const poleCount = result?.poles?.finite?.length || 0;
    const zeroCount = result?.zeros?.finite?.length || 0;
    if (meta) {
      meta.textContent = result ? `n=${stateSpace?.n ?? "\u2014"} \xB7 \u6781\u70B9 ${poleCount} \xB7 \u96F6\u70B9 ${zeroCount}${result.poles?.infinite_count ? ` \xB7 \u65E0\u7A77 ${result.poles.infinite_count}` : ""}${result.operating_point_supplied ? " \xB7 \u5DE5\u4F5C\u70B9\u7EBF\u6027\u5316" : ""}` : "\u65E0\u7ED3\u679C";
    }
    bypassTable("#analBypassPoles", "\u6781\u70B9", result?.poles);
    bypassTable("#analBypassZeros", "\u96F6\u70B9", result?.zeros);
    drawBypassCharts();
  } catch (error) {
    bypassResult = null;
    if (meta) meta.textContent = "\u65C1\u8DEF\u5206\u6790\u5931\u8D25";
    toast(`\u65C1\u8DEF\u5206\u6790\u5931\u8D25\uFF1A${error.message}`, "error", 7e3);
    bypassTable("#analBypassPoles", "\u6781\u70B9", void 0);
    bypassTable("#analBypassZeros", "\u96F6\u70B9", void 0);
    drawBypassCharts();
  }
}
export {
  analEscape,
  analNum,
  analToken,
  analysisWarn,
  closeAnalysis,
  drawAcChart,
  drawBypassBode,
  drawBypassCharts,
  drawBypassStep,
  fillAcSources,
  fillBypassSources,
  openAnalysis,
  runAcSweep,
  runCircuitBypass,
  runOperatingPoint,
  selectAnalTab
};
