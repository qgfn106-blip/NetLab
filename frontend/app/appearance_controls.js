import { CANVAS_DARK, CANVAS_LIGHT } from "../theme.tokens.js";
import { ACCENT_SWATCHES, PREF_DEFAULTS, applyAppearance, setPref, syncPrefControls, writePrefCache } from "./appearance.js";
import { api, jsonRequest } from "./net.js";
import { button } from "./ui.js";
import { themeKey } from "./theme.js";
import { markProjectDirty } from "./project.js";
import { requestDraw } from "./canvas_render.js";
import { $ } from "./dom.js";
import { state } from "./state.js";
import { toast } from "./desktop.js";
let appearanceControlActions = {
  openIroColorPopover: (_anchor, _value, _onChange) => {
  }
};
function setAppearanceControlActions(actions) {
  appearanceControlActions = actions;
}
function initAppearanceControls() {
  $("#segTheme")?.addEventListener("click", (event) => {
    const target = event.target.closest("button[data-value]");
    if (target) void setPref("theme", target.dataset.value);
  });
  $("#segMotion")?.addEventListener("click", (event) => {
    const target = event.target.closest("button[data-value]");
    if (target) void setPref("motion", target.dataset.value);
  });
  $("#segPerf")?.addEventListener("click", (event) => {
    const target = event.target.closest("button[data-value]");
    if (target) void setPref("perf", target.dataset.value);
  });
  $("#segInfoBar")?.addEventListener("click", (event) => {
    const target = event.target.closest("button[data-value]");
    if (!target) return;
    state.prefs.infobar = target.dataset.value !== "off";
    applyAppearance();
  });
  const bindDrawingSeg = (id, apply) => {
    $(id)?.addEventListener("click", (event) => {
      const target = event.target.closest("button[data-value]");
      if (!target) return;
      apply(String(target.dataset.value || ""));
      markProjectDirty();
      requestDraw();
      syncPrefControls();
    });
  };
  bindDrawingSeg("#segSheet", (value) => {
    state.ui.drawingSheet = value;
  });
  bindDrawingSeg("#segDrawLabels", (value) => {
    state.ui.drawingLabels = value === "on";
  });
  bindDrawingSeg("#segDrawPage", (value) => {
    state.ui.drawingPage = Math.max(1, Math.min(9, Number(value) || 1));
  });
  $("#segAutosave")?.addEventListener("click", (event) => {
    const target = event.target.closest("button[data-value]");
    if (!target) return;
    void saveAutosaveSetting({ autosave_enabled: target.dataset.value === "on" });
  });
  $("#selAutosaveInterval")?.addEventListener("change", () => {
    const seconds = Number($("#selAutosaveInterval").value);
    if (Number.isFinite(seconds)) void saveAutosaveSetting({ autosave_interval_seconds: seconds });
  });
  const bindAppearSeg = (id, key, numeric) => {
    $(id)?.addEventListener("click", (event) => {
      const target = event.target.closest("button[data-value]");
      if (!target) return;
      const raw = String(target.dataset.value || "");
      void setPref(key, numeric ? Number(raw) : raw);
    });
  };
  bindAppearSeg("#segFont", "fontScale", true);
  bindAppearSeg("#segDensity", "density", false);
  bindAppearSeg("#segRadius", "radius", true);
  bindAppearSeg("#segLine", "lineWidth", true);
  bindAppearSeg("#segChart", "chartPalette", false);
  $("#rngTone")?.addEventListener("input", () => {
    const input = $("#rngTone");
    state.prefs.surfaceTone = Number(input.value) || 0;
    applyAppearance();
    const toneLabel = $("#rngToneVal");
    const tone = Number(state.prefs.surfaceTone);
    if (toneLabel) toneLabel.textContent = tone === 0 ? "0" : tone > 0 ? `+${tone.toFixed(2)}` : tone.toFixed(2);
  });
  $("#rngTone")?.addEventListener("change", () => {
    writePrefCache();
  });
  const swatches = $("#accentSwatches");
  if (swatches) {
    for (const value of ACCENT_SWATCHES) {
      const node = button(value ? "" : "A", "swatch", () => {
        if (themeKey() === "dark") void setPref("accentDark", value);
        else void setPref("accent", value);
      });
      node.dataset.value = value;
      node.title = value ? `\u5F3A\u8C03\u8272 ${value}` : "\u9ED8\u8BA4\u5F3A\u8C03\u8272\uFF08\u8DDF\u968F\u4E3B\u9898\uFF09";
      if (!value) node.classList.add("default");
      node.style.background = value || "linear-gradient(135deg, #9b7247 50%, #eae5e1 50%)";
      node.dataset.swatch = value || "default";
      swatches.appendChild(node);
    }
    const custom = button("", "swatch swatch-custom");
    custom.dataset.value = "__custom__";
    custom.title = "\u81EA\u5B9A\u4E49\u5F3A\u8C03\u8272";
    custom.addEventListener("click", () => {
      const dark = themeKey() === "dark";
      const current = (dark ? state.prefs.accentDark : state.prefs.accent) || "";
      const seed = current || (dark ? CANVAS_DARK.accent : CANVAS_LIGHT.accent);
      appearanceControlActions.openIroColorPopover(custom, seed, (hex) => {
        if (dark) void setPref("accentDark", hex);
        else void setPref("accent", hex);
      });
    });
    swatches.appendChild(custom);
  }
  $("#btnResetAppearance")?.addEventListener("click", () => void resetAppearance());
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if ((state.prefs.theme || "system") === "system") applyAppearance();
  });
}
async function resetAppearance() {
  state.prefs = { ...state.prefs, ...PREF_DEFAULTS };
  applyAppearance();
  try {
    const response = await jsonRequest("/api/settings", "PATCH", {
      theme: PREF_DEFAULTS.theme,
      ui_motion: PREF_DEFAULTS.motion,
      ui_perf: PREF_DEFAULTS.perf,
      ui_accent: PREF_DEFAULTS.accent
    });
    state.settings = response.settings || state.settings;
    toast("\u5916\u89C2\u5DF2\u6062\u590D\u9ED8\u8BA4", "ok", 2e3);
  } catch (error) {
    toast(`\u5916\u89C2\u5DF2\u6062\u590D\u9ED8\u8BA4\uFF08\u672C\u5730\uFF09\uFF1B\u540E\u7AEF\u672A\u540C\u6B65\uFF1A${error.message}`, "warn", 3200);
  }
}
async function saveAutosaveSetting(patch) {
  state.project.autosave = patch.autosave_enabled !== void 0 ? patch.autosave_enabled : state.project.autosave;
  if (patch.autosave_interval_seconds) state.project.autosaveInterval = patch.autosave_interval_seconds * 1e3;
  syncPrefControls();
  try {
    const response = await jsonRequest("/api/settings", "PATCH", patch);
    state.settings = response.settings || state.settings;
    toast(patch.autosave_enabled === false ? "\u81EA\u52A8\u4FDD\u5B58\u5DF2\u5173\u95ED" : patch.autosave_enabled ? "\u81EA\u52A8\u4FDD\u5B58\u5DF2\u5F00\u542F" : "\u5FEB\u7167\u95F4\u9694\u5DF2\u66F4\u65B0", "ok", 2e3);
  } catch (error) {
    toast(`\u8BBE\u7F6E\u4FDD\u5B58\u5931\u8D25\uFF1A${error.message}`, "error", 3600);
  }
}
function formatQualityNumber(value, unit = "") {
  if (value === null || value === void 0) return "\u2014";
  if (!Number.isFinite(value)) return String(value);
  return `${value.toLocaleString("zh-CN", { maximumFractionDigits: 6 })}${unit}`;
}
function setQualityText(selector, text) {
  const node = $(selector);
  if (node) node.textContent = text;
}
async function refreshTelemetryQuality() {
  const status = $("#diagStatus");
  if (status) status.textContent = "\u8BFB\u53D6\u4E2D\u2026";
  try {
    const payload = await api("/api/diagnostics/telemetry");
    const quality = payload?.telemetry || {};
    const assumptions = (quality.assumptions || []).filter((item) => item.trim().length > 0);
    const missing = [];
    if (quality.sample_dt === null || quality.sample_dt === void 0) missing.push("sample_dt");
    if (quality.interp_error_bound === null || quality.interp_error_bound === void 0) missing.push("interp_error_bound");
    if (quality.delay_bound === null || quality.delay_bound === void 0) missing.push("delay_bound");
    setQualityText("#diagSampleDt", formatQualityNumber(quality.sample_dt, " s"));
    setQualityText(
      "#diagQuantBits",
      quality.quant_bits === null || quality.quant_bits === void 0 ? "\u672A\u542F\u7528\u91CF\u5316" : `${quality.quant_bits} bit`
    );
    setQualityText(
      "#diagInterpBound",
      quality.interp_error_bound === null || quality.interp_error_bound === void 0 ? "\u672A\u58F0\u660E" : `${formatQualityNumber(quality.interp_error_bound)}${quality.interp_error_bound_method ? `\uFF08${quality.interp_error_bound_method}\uFF09` : ""}`
    );
    setQualityText("#diagFifoDepth", formatQualityNumber(quality.fifo_depth, " \u5E27"));
    setQualityText(
      "#diagDelayBound",
      quality.delay_bound === null || quality.delay_bound === void 0 ? "\u672A\u58F0\u660E" : `${formatQualityNumber(quality.delay_bound, " s")}${quality.delay_bound_method ? `\uFF08${quality.delay_bound_method}\uFF09` : ""}`
    );
    setQualityText("#diagAssumptions", assumptions.length ? `\u5047\u8BBE\uFF1A${assumptions.join("\uFF1B")}` : "\u5047\u8BBE\uFF1A\u2014");
    if (status) {
      status.textContent = missing.length ? `\u4E0D\u5B8C\u6574\uFF1A\u7F3A\u5C11 ${missing.join("\u3001")}` : "\u5B8C\u6574\uFF08\u53EF\u7528\uFF09";
      status.dataset.state = missing.length ? "partial" : "ok";
    }
  } catch (error) {
    if (status) {
      status.textContent = `\u8BFB\u53D6\u5931\u8D25\uFF1A${error.message}`;
      status.dataset.state = "error";
    }
  }
}
export {
  formatQualityNumber,
  initAppearanceControls,
  refreshTelemetryQuality,
  resetAppearance,
  saveAutosaveSetting,
  setAppearanceControlActions,
  setQualityText
};
