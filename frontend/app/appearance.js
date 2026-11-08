import { THEME_TOKENS, setRuntimeOverride } from "./colors.js";
import { jsonRequest } from "./net.js";
import { themeKey } from "./theme.js";
import { clamp } from "../app.utils.js";
import { drawPhase } from "./phase.js";
import { hexToRgbString, mixHex } from "./color.js";
import { $, $$ } from "./dom.js";
import { requestDraw } from "./canvas_render.js";
import { state, ui } from "./state.js";
import { toast } from "./desktop.js";
let appearanceActions = {
  drawModulePreview: () => {
  },
  scheduleChartDraw: () => {
  }
};
function setAppearanceActions(actions) {
  appearanceActions = actions;
}
const ACCENT_SWATCHES = ["", "#9b7247", "#565c46", "#3f5d6b", "#8a4234", "#6b6257", "#7a5a33", "#5f7a52"];
const PREF_CACHE_KEY = "netlab.ui.prefs";
const PREF_DEFAULTS = {
  theme: "system",
  motion: "low",
  perf: "perf",
  accent: "",
  accentDark: "",
  fontScale: 12,
  density: "standard",
  surfaceTone: 0,
  radius: 0,
  lineWidth: 1,
  chartPalette: "theme"
};
const FONT_SCALES = [11, 12, 13, 14];
const RADIUS_STEPS = [0, 2, 4];
const LINE_STEPS = [1, 1.5];
const CHART_MODES = ["theme", "high-contrast", "colorblind"];
function activeAccent(theme, pal) {
  const pref = state.prefs || {};
  const custom = theme === "dark" ? pref.accentDark : pref.accent;
  return typeof custom === "string" && custom ? custom : pal.accent;
}
function computeRuntimeOverride(theme) {
  const base = THEME_TOKENS[theme];
  const pref = state.prefs || {};
  const override = {};
  const accent = activeAccent(theme, base);
  if (accent && accent !== base.accent) {
    override.accent = accent;
    override.accentSoft = mixHex(base.paper, accent, 0.28);
  }
  const tone = clamp(Number(pref.surfaceTone) || 0, -1, 1);
  if (tone !== 0) {
    const anchor = tone > 0 ? base.toneWhite : base.toneBlack;
    if (anchor) {
      const amount = Math.abs(tone) * 0.16;
      for (const key of ["paper", "panel", "surface", "paper3"]) {
        if (base[key]) override[key] = mixHex(base[key], anchor, amount);
      }
    }
  }
  return override;
}
function applyAppearance() {
  const root = document.documentElement;
  const pref = state.prefs || {};
  const theme = resolveTheme(pref.theme || "system");
  root.dataset.theme = theme;
  root.dataset.motion = pref.motion || "low";
  root.dataset.perf = pref.perf || "perf";
  const fontScale = FONT_SCALES.includes(Number(pref.fontScale)) ? Number(pref.fontScale) : PREF_DEFAULTS.fontScale;
  root.dataset.font = String(fontScale);
  const density = ["compact", "standard", "loose"].includes(String(pref.density)) ? String(pref.density) : PREF_DEFAULTS.density;
  root.dataset.density = density;
  const lineWidth = LINE_STEPS.includes(Number(pref.lineWidth)) ? Number(pref.lineWidth) : PREF_DEFAULTS.lineWidth;
  root.dataset.line = String(lineWidth);
  const chartMode = CHART_MODES.includes(String(pref.chartPalette)) ? String(pref.chartPalette) : PREF_DEFAULTS.chartPalette;
  root.dataset.chart = chartMode;
  const radius = RADIUS_STEPS.includes(Number(pref.radius)) ? Number(pref.radius) : PREF_DEFAULTS.radius;
  root.style.setProperty("--radius", `${radius}px`);
  const pal = THEME_TOKENS[theme];
  const override = computeRuntimeOverride(theme);
  setRuntimeOverride(override);
  const accent = override.accent || pal.accent;
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--accent-rgb", hexToRgbString(accent));
  root.style.setProperty("--accent-soft", override.accentSoft || mixHex(pal.paper, accent, 0.28));
  root.style.setProperty("--accent-2", pal.accent2);
  root.style.setProperty("--green", pal.green);
  root.style.setProperty("--paper", override.paper || pal.paper);
  root.style.setProperty("--paper-2", override.panel || pal.panel);
  root.style.setProperty("--paper-3", override.surface || pal.surface);
  state.palette = pal;
  if (ui.infoBar) ui.infoBar.style.display = pref.infobar === false ? "none" : "";
  syncPrefControls();
  writePrefCache();
  if (state.booted) {
    requestDraw();
    appearanceActions.scheduleChartDraw();
    drawPhase();
    if (ui.moduleWin && !ui.moduleWin.hidden) appearanceActions.drawModulePreview();
  }
}
function resolveTheme(pref) {
  if (pref === "light" || pref === "dark") return pref;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function readPrefCache() {
  try {
    return JSON.parse(window.localStorage.getItem(PREF_CACHE_KEY) || "null");
  } catch (error) {
    return null;
  }
}
function writePrefCache() {
  try {
    window.localStorage.setItem(PREF_CACHE_KEY, JSON.stringify(state.prefs || {}));
  } catch (error) {
  }
}
async function loadUiPrefs() {
  const cached = readPrefCache();
  if (cached && typeof cached === "object") state.prefs = { ...state.prefs, ...cached };
  state.prefs.guide = "always";
  applyAppearance();
  try {
    const response = await jsonRequest("/api/settings", "GET");
    const stored = response.settings || {};
    state.settings = stored;
    state.prefs.theme = ["system", "light", "dark"].includes(stored.theme) ? stored.theme : "system";
    state.prefs.motion = ["off", "low", "med", "high"].includes(stored.ui_motion) ? stored.ui_motion : "low";
    state.prefs.perf = ["perf", "balanced", "quality"].includes(stored.ui_perf) ? stored.ui_perf : "perf";
    state.prefs.accent = typeof stored.ui_accent === "string" ? stored.ui_accent : "";
    state.prefs.guide = "always";
    if (typeof stored.autosave_enabled === "boolean") state.project.autosave = stored.autosave_enabled;
    const interval = Number(stored.autosave_interval_seconds);
    if (Number.isFinite(interval) && interval >= 5) state.project.autosaveInterval = interval * 1e3;
    applyAppearance();
  } catch (error) {
  }
  state.uiReady = true;
}
const PREF_SETTING_KEYS = { theme: "theme", motion: "ui_motion", perf: "ui_perf", accent: "ui_accent" };
async function setPref(key, value) {
  state.prefs[key] = value;
  applyAppearance();
  const settingKey = PREF_SETTING_KEYS[key];
  if (!settingKey) return;
  try {
    const response = await jsonRequest("/api/settings", "PATCH", { [settingKey]: value });
    state.settings = response.settings || state.settings;
  } catch (error) {
    toast(`\u504F\u597D\u4FDD\u5B58\u5931\u8D25\uFF1A${error.message}`, "warn", 3200);
  }
}
function syncPrefControls() {
  const prefs = state.prefs || {};
  const paint = (host, value) => {
    if (!host) return;
    $$("button[data-value]", host).forEach((node) => {
      const on = node.dataset.value === value;
      node.classList.toggle("active", on);
      node.setAttribute("aria-pressed", on ? "true" : "false");
    });
  };
  paint($("#segTheme"), prefs.theme || "system");
  paint($("#segMotion"), prefs.motion || "low");
  paint($("#segPerf"), prefs.perf || "perf");
  paint($("#segInfoBar"), prefs.infobar === false ? "off" : "on");
  paint($("#segSheet"), String(state.ui?.drawingSheet || "A3"));
  paint($("#segDrawLabels"), state.ui?.drawingLabels ? "on" : "off");
  paint($("#segDrawPage"), String(state.ui?.drawingPage || 1));
  paint($("#segAutosave"), state.project.autosave ? "on" : "off");
  if ($("#selAutosaveInterval")) $("#selAutosaveInterval").value = String(Math.round(state.project.autosaveInterval / 1e3));
  paint($("#segFont"), String(prefs.fontScale ?? PREF_DEFAULTS.fontScale));
  paint($("#segDensity"), String(prefs.density ?? PREF_DEFAULTS.density));
  paint($("#segRadius"), String(prefs.radius ?? PREF_DEFAULTS.radius));
  paint($("#segLine"), String(prefs.lineWidth ?? PREF_DEFAULTS.lineWidth));
  paint($("#segChart"), String(prefs.chartPalette ?? PREF_DEFAULTS.chartPalette));
  const toneInput = $("#rngTone");
  if (toneInput) {
    const tone = Number(prefs.surfaceTone ?? 0);
    if (document.activeElement !== toneInput) toneInput.value = String(tone);
    const toneLabel = $("#rngToneVal");
    if (toneLabel) toneLabel.textContent = tone === 0 ? "0" : tone > 0 ? `+${tone.toFixed(2)}` : tone.toFixed(2);
  }
  const swatches = $("#accentSwatches");
  if (swatches) {
    const activeVal = themeKey() === "dark" ? prefs.accentDark || "" : prefs.accent || "";
    const preset = ACCENT_SWATCHES.includes(activeVal);
    $$("button", swatches).forEach((node) => {
      const val = node.dataset.value || "";
      const on = val === "__custom__" ? !preset && !!activeVal : val === activeVal;
      node.classList.toggle("active", on);
      node.setAttribute("aria-pressed", on ? "true" : "false");
      if (val === "__custom__") node.style.background = activeVal && !preset ? activeVal : "";
    });
  }
}
export {
  ACCENT_SWATCHES,
  CHART_MODES,
  FONT_SCALES,
  LINE_STEPS,
  PREF_CACHE_KEY,
  PREF_DEFAULTS,
  PREF_SETTING_KEYS,
  RADIUS_STEPS,
  activeAccent,
  applyAppearance,
  computeRuntimeOverride,
  loadUiPrefs,
  readPrefCache,
  resolveTheme,
  setAppearanceActions,
  setPref,
  syncPrefControls,
  writePrefCache
};
