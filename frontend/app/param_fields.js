import { el, div, button, clone } from "./ui.js";
import { state, ui } from "./state.js";
import { $$ } from "./dom.js";
import { PREFIXABLE_UNITS, trimNumber, savedUnitFactor, bestUnitFactor, parseSmartValue, numberedField, unitStorageKey, UNIT_PREFIXES, valueToText } from "./fields.js";
import { specDefaults } from "./model.js";
let typeLabelHelpFn = null;
function setTypeLabelHelp(fn) {
  typeLabelHelpFn = fn;
}
function markDirty() {
  state.inspectorDirty = true;
  const save = ui.inspector.querySelector('[data-role="save"]');
  if (save) {
    save.textContent = "\u5E94\u7528\u4FEE\u6539 \u2022";
    save.classList.add("dirty");
  }
  const badge = ui.inspector.querySelector('[data-role="dirty-badge"]');
  if (badge) badge.classList.remove("hidden");
}
function clearDirty() {
  state.inspectorDirty = false;
  const save = ui.inspector.querySelector('[data-role="save"]');
  if (save) {
    save.textContent = "\u5E94\u7528\u4FEE\u6539";
    save.classList.remove("dirty");
  }
  const badge = ui.inspector.querySelector('[data-role="dirty-badge"]');
  if (badge) badge.classList.add("hidden");
}
function buildParamField(param, value) {
  const wrap = div("field");
  wrap.dataset.param = param.key;
  wrap.dataset.type = param.type || "float";
  wrap.dataset.label = param.label || param.key;
  const labelText = param.label || param.key;
  const type = param.type || "float";
  if (type === "bool") {
    const row = div("switch-row");
    row.appendChild(el("span", null, labelText));
    const input = el("input");
    input.type = "checkbox";
    input.checked = Boolean(value);
    input.dataset.role = "param-input";
    row.appendChild(input);
    wrap.appendChild(row);
  } else {
    const prefixable = type === "float" && PREFIXABLE_UNITS.has(String(param.unit || ""));
    const fieldLabel = numberedField(labelText, prefixable ? "" : param.unit || "");
    typeLabelHelpFn?.(fieldLabel, param);
    wrap.appendChild(fieldLabel);
    let control;
    let unitSelect = null;
    if (type === "choice") {
      control = el("select");
      for (const choice of param.choices || []) {
        const option = el("option", null, choice.label || choice.value);
        option.value = choice.value;
        if (String(value) === String(choice.value)) option.selected = true;
        control.appendChild(option);
      }
    } else if (type === "float" || type === "int") {
      control = el("input");
      control.type = "number";
      control.step = param.step !== void 0 && param.step !== null ? String(param.step) : type === "int" ? "1" : "any";
      if (param.min !== void 0 && param.min !== null) control.min = String(param.min);
      if (param.max !== void 0 && param.max !== null) control.max = String(param.max);
      control.value = value === void 0 || value === null ? "" : String(value);
      if (prefixable) {
        const factor = savedUnitFactor(param) || bestUnitFactor(Number(value) || 0);
        if (!savedUnitFactor(param)) {
          try {
            localStorage.setItem(unitStorageKey(param), String(factor));
          } catch (error) {
          }
        }
        control.value = trimNumber((Number(value) || 0) / factor);
        control.step = "any";
        if (param.min !== void 0 && param.min !== null) control.min = String(Number(param.min) / factor);
        if (param.max !== void 0 && param.max !== null) control.max = String(Number(param.max) / factor);
        unitSelect = el("select");
        unitSelect.className = "unit-select";
        unitSelect.dataset.role = "param-unit";
        unitSelect.dataset.baseMin = param.min !== void 0 && param.min !== null ? String(param.min) : "";
        unitSelect.dataset.baseMax = param.max !== void 0 && param.max !== null ? String(param.max) : "";
        for (const item of UNIT_PREFIXES) {
          const option = el("option", null, `${item.prefix}${param.unit}`);
          option.value = String(item.factor);
          unitSelect.appendChild(option);
        }
        unitSelect.value = String(factor);
        unitSelect.dataset.factor = String(factor);
        unitSelect.addEventListener("change", () => {
          const oldFactor = Number(unitSelect.dataset.factor) || 1;
          const nextFactor = Number(unitSelect.value) || 1;
          const number = Number(control.value);
          if (Number.isFinite(number)) control.value = trimNumber(number * oldFactor / nextFactor);
          unitSelect.dataset.factor = String(nextFactor);
          try {
            localStorage.setItem(unitStorageKey(param), String(nextFactor));
          } catch (error) {
          }
          const baseMin = unitSelect.dataset.baseMin;
          const baseMax = unitSelect.dataset.baseMax;
          control.min = baseMin === "" ? "" : String(Number(baseMin) / nextFactor);
          control.max = baseMax === "" ? "" : String(Number(baseMax) / nextFactor);
        });
      }
    } else if (type === "node") {
      control = el("select");
      const empty = el("option", null, "\uFF08\u672A\u8BBE\u7F6E\uFF09");
      empty.value = "";
      control.appendChild(empty);
      for (const node of state.scene?.nodes || []) {
        const option = el("option", null, `${node.name} \xB7 ${node.kind}`);
        option.value = node.id;
        if (value === node.id) option.selected = true;
        control.appendChild(option);
      }
    } else if (type === "json" || type === "matrix" || type === "list" || type === "mapping") {
      control = el("textarea");
      if (type === "matrix" || param.key === "A" || param.key === "B" || param.key === "C" || param.key === "D") {
        control.classList.add("tall");
      }
      control.value = JSON.stringify(value === void 0 ? param.default : value, null, 2);
      control.spellcheck = false;
      control.addEventListener("blur", () => {
        try {
          JSON.parse(control.value);
          control.classList.remove("invalid");
        } catch (error) {
          control.classList.add("invalid");
        }
      });
    } else {
      control = el("input");
      control.type = "text";
      control.value = value === void 0 || value === null ? "" : String(value);
      if (param.placeholder) control.placeholder = param.placeholder;
      if (param.key === "expr") control.classList.add("mono");
    }
    control.dataset.role = "param-input";
    if (param.placeholder && (type === "json" || type === "matrix" || type === "list" || type === "mapping")) {
      control.placeholder = param.placeholder;
    }
    if (unitSelect) {
      const unitRow = div("param-unit-row");
      unitRow.append(control, unitSelect);
      wrap.appendChild(unitRow);
    } else {
      wrap.appendChild(control);
    }
  }
  if (param.help) wrap.appendChild(div("help", param.help));
  return wrap;
}
function applyPresetOnModelChange(container, spec) {
  const presets = spec.presets || {};
  const modelField = container.querySelector('[data-param="model"]');
  if (!modelField || !Object.keys(presets).length) return;
  const select = modelField.querySelector("select");
  if (!select) return;
  select.addEventListener("change", () => {
    const preset = presets[select.value];
    if (!preset) return;
    for (const [key, value] of Object.entries(preset)) {
      const field = container.querySelector(`[data-param="${key}"]`);
      const input = field ? field.querySelector("input") : null;
      if (!input) continue;
      const unit = field.querySelector('[data-role="param-unit"]');
      const factor = unit ? Number(unit.value) || 1 : 1;
      input.value = trimNumber(Number(value) / factor);
    }
  });
}
const WAVE_FIELDS = {
  dc: ["offset"],
  sine: ["offset", "amplitude", "frequency", "phase", "delay"],
  square: ["offset", "amplitude", "frequency", "phase", "delay"],
  triangle: ["offset", "amplitude", "frequency", "phase", "delay"],
  saw: ["offset", "amplitude", "frequency", "phase", "delay"],
  pulse: ["offset", "amplitude", "frequency", "phase", "duty", "delay"],
  step: ["offset", "amplitude", "delay"],
  ramp: ["offset", "amplitude", "delay"]
};
function applyWaveFieldVisibility(container) {
  const waveField = container.querySelector('[data-param="wave"]');
  const select = waveField ? waveField.querySelector("select") : null;
  if (!select) return;
  const allowed = new Set(WAVE_FIELDS[select.value] || []);
  for (const field of container.querySelectorAll(".field[data-param]")) {
    const key = field.dataset.param;
    if (key === "wave") continue;
    field.hidden = !allowed.has(key);
  }
  const hint = waveField.querySelector('[data-role="wave-hint"]');
  if (hint) {
    hint.textContent = select.value === "dc" ? "DC \u6A21\u5F0F\u53EA\u4F7F\u7528\u300C\u504F\u7F6E / \u76F4\u6D41\u7535\u538B\u300D\uFF1B\u5E45\u503C\u3001\u9891\u7387\u7B49\u4E0D\u53C2\u4E0E\u8BA1\u7B97\u3002" : "\u5468\u671F\u6CE2\u5F62\u4F7F\u7528\u504F\u7F6E + \u5E45\u503C + \u9891\u7387\uFF08\u65B9\u6CE2/\u8109\u51B2\u53E6\u6709\u5360\u7A7A\u6BD4\uFF09\u3002";
  }
}
function buildWaveFieldVisibility(container) {
  const waveField = container.querySelector('[data-param="wave"]');
  if (!waveField) return;
  const select = waveField.querySelector("select");
  if (!select) return;
  if (!waveField.querySelector('[data-role="wave-hint"]')) {
    const hint = div("help");
    hint.dataset.role = "wave-hint";
    waveField.appendChild(hint);
  }
  select.addEventListener("change", () => applyWaveFieldVisibility(container));
  applyWaveFieldVisibility(container);
}
function buildParamFields(spec, params) {
  const container = div("params-grid");
  container.dataset.role = "params";
  if (!spec || !Array.isArray(spec.params) || !spec.params.length) {
    container.appendChild(div("help", "\u8BE5\u7C7B\u578B\u6CA1\u6709\u53EF\u8C03\u53C2\u6570\u3002"));
    return container;
  }
  const values = Object.assign({}, specDefaults(spec), params || {});
  for (const param of spec.params) {
    if (!(param.key in values)) values[param.key] = clone(param.default);
    container.appendChild(buildParamField(param, values[param.key]));
  }
  applyPresetOnModelChange(container, spec);
  buildWaveFieldVisibility(container);
  return container;
}
function collectParamValues(container) {
  const values = {};
  for (const wrapper of $$("[data-param]", container)) {
    const key = wrapper.dataset.param;
    const type = wrapper.dataset.type;
    const label = wrapper.dataset.label || key;
    const input = wrapper.querySelector("input, select, textarea");
    if (!input) continue;
    if (type === "bool") {
      values[key] = Boolean(input.checked);
    } else if (type === "float" || type === "int") {
      const text = String(input.value).trim();
      if (!text) throw new Error(`\u53C2\u6570\u300C${label}\u300D\u4E0D\u80FD\u4E3A\u7A7A`);
      const number = Number(text);
      if (!Number.isFinite(number)) throw new Error(`\u53C2\u6570\u300C${label}\u300D\u5FC5\u987B\u662F\u6709\u9650\u6570\u5B57`);
      if (type === "int" && !Number.isInteger(number)) throw new Error(`\u53C2\u6570\u300C${label}\u300D\u5FC5\u987B\u662F\u6574\u6570`);
      const unitSelect = wrapper.querySelector('[data-role="param-unit"]');
      values[key] = unitSelect ? number * (Number(unitSelect.value) || 1) : number;
    } else if (type === "json" || type === "matrix" || type === "list" || type === "mapping") {
      try {
        values[key] = JSON.parse(input.value);
      } catch (error) {
        input.classList.add("invalid");
        throw new Error(`\u53C2\u6570\u300C${label}\u300D\u4E0D\u662F\u5408\u6CD5 JSON`);
      }
    } else {
      values[key] = input.value;
    }
  }
  return values;
}
function dataRow(key, value) {
  const row = div("data-row");
  const keyInput = el("input");
  keyInput.type = "text";
  keyInput.className = "data-key";
  keyInput.placeholder = "\u5B57\u6BB5";
  keyInput.value = key;
  keyInput.spellcheck = false;
  const valueInput = el("input");
  valueInput.type = "text";
  valueInput.className = "data-val";
  valueInput.placeholder = "\u6570\u503C / \u6587\u672C / JSON";
  valueInput.value = valueToText(value);
  valueInput.spellcheck = false;
  const remove = button("\xD7", "icon-btn", () => {
    row.remove();
    markDirty();
  });
  remove.title = "\u5220\u9664\u8BE5\u5B57\u6BB5";
  keyInput.addEventListener("input", markDirty);
  valueInput.addEventListener("input", markDirty);
  row.append(keyInput, valueInput, remove);
  return row;
}
function collectData(container) {
  const result = {};
  for (const row of $$(".data-row", container)) {
    const key = row.querySelector(".data-key").value.trim();
    if (!key) continue;
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      throw new Error(`\u6570\u636E\u5B57\u6BB5\u300C${key}\u300D\u91CD\u590D`);
    }
    result[key] = parseSmartValue(row.querySelector(".data-val").value);
  }
  return result;
}
export {
  applyPresetOnModelChange,
  applyWaveFieldVisibility,
  buildParamField,
  buildParamFields,
  buildWaveFieldVisibility,
  clearDirty,
  collectData,
  collectParamValues,
  dataRow,
  markDirty,
  setTypeLabelHelp
};
