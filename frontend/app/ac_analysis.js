import { operatingPointRequest } from "./analysis_client.js";
import { $, $$ } from "./dom.js";
import { clampFloatWindow, raiseFloatWindow } from "./float.js";
import { state } from "./state.js";
import { toast } from "./desktop.js";
import { openAnalysisWorkbench } from "./analysis_workbench.js";
function _dispDigits() {
  const n = Number((state.prefs || {}).numericDigits ?? 6);
  return Number.isFinite(n) ? Math.max(3, Math.min(17, Math.round(n))) : 6;
}
function analEscape(text) {
  return String(text ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
}
function analNum(value, digits = _dispDigits()) {
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
function niceAxisTicks(min, max, target = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return { min: 0, max: 1, step: 1, values: [0, 1] };
  }
  const rough = (max - min) / Math.max(2, target);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalized = rough / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const low = Math.floor(min / step) * step;
  const high = Math.ceil(max / step) * step;
  const values = [];
  for (let value = low, index = 0; value <= high + step * 0.5 && index < 100; value += step, index += 1) {
    values.push(Number(value.toPrecision(_dispDigits())));
  }
  return { min: low, max: high, step, values };
}
function niceAxisLabel(value) {
  if (!Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) return value.toExponential(2);
  return String(Number(value.toPrecision(_dispDigits())));
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
  clampFloatWindow(win);
  const mapped = tab === "ac" || tab === "bypass" || tab === "wb-analysis" ? "workbench" : tab;
  selectAnalTab(mapped);
  if (mapped === "workbench") {
    if (tab === "wb-analysis") openAnalysisWorkbench();
    else openAnalysisWorkbench(tab === "bypass" ? "time" : "bode");
  }
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
  if (tab === "workbench" && !$("#analWorkbench")) {
    toast("\u5206\u6790\u5DE5\u4F5C\u53F0\u5BB9\u5668\u7F3A\u5931", "error", 4e3);
  }
}
async function runOperatingPoint() {
  analysisWarn();
  const body = $("#analOpTable");
  const meta = $("#analOpMeta");
  if (meta) meta.textContent = "\u6C42\u89E3\u4E2D\u2026";
  try {
    const data = await operatingPointRequest();
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
export {
  analEscape,
  analNum,
  analToken,
  analysisWarn,
  closeAnalysis,
  niceAxisLabel,
  niceAxisTicks,
  openAnalysis,
  runOperatingPoint,
  selectAnalTab
};
