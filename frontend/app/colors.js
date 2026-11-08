import { CANVAS_LIGHT, CANVAS_DARK } from "../theme.tokens.js";
import { themeKey } from "./theme.js";
import { hexToRgb, mixHex } from "./color.js";
const THEME_TOKENS = { light: CANVAS_LIGHT, dark: CANVAS_DARK };
const COLOR_ALIAS = {
  "#a8541f": "accent",
  "#1f5f5b": "accent2",
  "#6f695f": "muted",
  "#969083": "dim",
  "#11100e": "ink",
  "#faf8f2": "panel",
  "#f7f4ec": "paper",
  "#fffdf8": "surface",
  "#f2efe7": "paper",
  "#bcb3a1": "line",
  "#cfc6b5": "gridAxis",
  "#e7e1d5": "paper3"
};
let RT_OVERRIDE = {};
function tokens() {
  const base = THEME_TOKENS[themeKey()];
  return RT_OVERRIDE && Object.keys(RT_OVERRIDE).length ? { ...base, ...RT_OVERRIDE } : base;
}
const LEGACY_RGB = {
  "168,84,31": "accent",
  "31,95,91": "accent2",
  "142,47,36": "red",
  "79,107,64": "green",
  "176,118,42": "amber"
};
function C(value) {
  const raw = String(value || "").trim();
  const legacy = raw.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+))?\s*\)$/i);
  if (legacy) {
    const target = LEGACY_RGB[`${legacy[1]},${legacy[2]},${legacy[3]}`];
    const hex = target ? tokens()[target] : "";
    const rgb = hex ? hexToRgb(hex) : null;
    if (rgb) return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${legacy[4] ?? 1})`;
  }
  const token = COLOR_ALIAS[raw.toLowerCase()];
  if (token) return tokens()[token];
  if (themeKey() === "dark") return mixHex(raw, "#e0e3dc", 0.42);
  return raw;
}
function setRuntimeOverride(next) {
  RT_OVERRIDE = next || {};
}
function getRuntimeOverride() {
  return RT_OVERRIDE;
}
export {
  C,
  THEME_TOKENS,
  getRuntimeOverride,
  setRuntimeOverride,
  tokens
};
