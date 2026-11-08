import { fmt } from "../app.utils.js";
import { el } from "./ui.js";
import { $$ } from "./dom.js";
import { state } from "./state.js";
function formatAny(value) {
  if (typeof value === "number") return fmt(value, 5);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null || value === void 0) return "\u2014";
  if (typeof value === "object") {
    const text = JSON.stringify(value);
    return text.length > 140 ? `${text.slice(0, 140)}\u2026` : text;
  }
  return String(value);
}
function valueToText(value) {
  if (typeof value === "string") return value;
  if (value === null || value === void 0) return "";
  if (typeof value === "object") return JSON.stringify(value, null, 0);
  return String(value);
}
function parseSmartValue(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
    const number = Number(trimmed);
    if (Number.isFinite(number)) return number;
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      throw new Error("\u6570\u636E\u5B57\u6BB5\u770B\u8D77\u6765\u662F JSON\uFF0C\u4F46\u683C\u5F0F\u4E0D\u5408\u6CD5");
    }
  }
  return trimmed;
}
function kindListFor(role) {
  if (!state.catalog) return [];
  if (role === "node") {
    if (state.mode === "circuit") return state.catalog.circuit_nodes || [];
    const computes = state.catalog.computes || [];
    if (state.mode === "vector") {
      return computes.slice().sort((a, b) => {
        const rank = (item) => item.group === "\u77E2\u91CF" ? 0 : 1;
        return rank(a) - rank(b);
      });
    }
    return computes;
  }
  if (state.mode === "circuit") return state.catalog.elements || [];
  const methods = state.catalog.methods || [];
  if (state.mode === "vector") {
    return methods.slice().sort((a, b) => {
      const rank = (item) => item.group === "\u77E2\u91CF" ? 0 : 1;
      return rank(a) - rank(b);
    });
  }
  return methods;
}
function buildKindSelect(role, currentKind, currentId = null) {
  const select = el("select");
  select.dataset.role = "kind";
  const list = kindListFor(role);
  const groups = /* @__PURE__ */ new Map();
  for (const spec of list) {
    if (spec.addable === false && spec.kind !== currentKind) continue;
    const group = spec.group || "";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(spec);
  }
  const appendOption = (parent, spec) => {
    const option = el("option", null, spec.label);
    option.value = spec.kind;
    if (spec.kind === currentKind) option.selected = true;
    parent.appendChild(option);
  };
  if (state.mode !== "circuit" && role === "node") {
    for (const [group, specs] of groups) {
      const wrapper = group ? el("optgroup") : select;
      if (group) wrapper.label = group;
      specs.forEach((spec) => appendOption(wrapper, spec));
      if (group) select.appendChild(wrapper);
    }
  } else {
    for (const specs of groups.values()) specs.forEach((spec) => appendOption(select, spec));
  }
  if (!$$("option", select).some((option) => option.value === currentKind)) {
    const option = el("option", null, currentKind || "\u2014");
    option.value = currentKind || "";
    option.selected = true;
    select.appendChild(option);
  }
  return select;
}
function numberedField(labelText, unitText) {
  const label = el("label");
  label.appendChild(el("span", null, labelText));
  if (unitText) label.appendChild(el("em", null, unitText));
  return label;
}
const UNIT_PREFIXES = [
  { factor: 1e-12, prefix: "p" },
  { factor: 1e-9, prefix: "n" },
  { factor: 1e-6, prefix: "\xB5" },
  { factor: 1e-3, prefix: "m" },
  { factor: 1, prefix: "" },
  { factor: 1e3, prefix: "k" },
  { factor: 1e6, prefix: "M" }
];
const PREFIXABLE_UNITS = /* @__PURE__ */ new Set(["F", "H", "\u03A9", "V", "A", "s", "Hz"]);
function unitStorageKey(param) {
  return `netlab.unit.${param.key}.${param.unit || ""}`;
}
function savedUnitFactor(param) {
  try {
    const raw = localStorage.getItem(unitStorageKey(param));
    const factor = Number(raw);
    if (Number.isFinite(factor) && factor > 0) return factor;
  } catch (error) {
  }
  return 0;
}
function bestUnitFactor(value) {
  const magnitude = Math.abs(Number(value) || 0);
  if (!magnitude) return 1;
  for (const item of UNIT_PREFIXES) {
    if (magnitude < item.factor * 1e3) return item.factor;
  }
  return UNIT_PREFIXES[UNIT_PREFIXES.length - 1].factor;
}
function trimNumber(value) {
  if (!Number.isFinite(value)) return "";
  return String(Number(value.toPrecision(12)));
}
export {
  PREFIXABLE_UNITS,
  UNIT_PREFIXES,
  bestUnitFactor,
  buildKindSelect,
  formatAny,
  kindListFor,
  numberedField,
  parseSmartValue,
  savedUnitFactor,
  trimNumber,
  unitStorageKey,
  valueToText
};
