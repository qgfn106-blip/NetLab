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
    toast("DC \u5DE5\u4F5C\u70B9 / AC \u626B\u9891\u53EA\u5728\u7535\u8DEF\u6A21\u5F0F\u4E0B\u53EF\u7528", "error", 4e3);
    return;
  }
  win.hidden = false;
  raiseFloatWindow(win);
  fillAcSources();
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
export {
  analEscape,
  analNum,
  analToken,
  analysisWarn,
  closeAnalysis,
  drawAcChart,
  fillAcSources,
  openAnalysis,
  runAcSweep,
  runOperatingPoint,
  selectAnalTab
};
