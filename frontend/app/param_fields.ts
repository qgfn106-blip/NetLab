// S5-15：参数表单项、预设与数据行助手（从 app.ts 拆出，M 轮）
import { el, div, button, clone } from './ui.js';
import { state, ui } from './state.js';
import { $, $$ } from './dom.js';
import { clamp } from '../app.utils.js';
import { PREFIXABLE_UNITS, trimNumber, savedUnitFactor, bestUnitFactor, parseSmartValue, numberedField, unitStorageKey, UNIT_PREFIXES, valueToText } from './fields.js';
import { specDefaults } from './model.js';
import type { ParamSpec, SpecRec } from './types.js';

export type TypeLabelHelpFn = (label: HTMLElement, param: ParamSpec) => void;
let typeLabelHelpFn: TypeLabelHelpFn | null = null;

export function setTypeLabelHelp(fn: TypeLabelHelpFn) {
  typeLabelHelpFn = fn;
}

export function markDirty() {
  state.inspectorDirty = true;
  const save = ui.inspector.querySelector('[data-role="save"]');
  if (save) {
    save.textContent = '应用修改 •';
    save.classList.add('dirty');
  }
  const badge = ui.inspector.querySelector('[data-role="dirty-badge"]');
  if (badge) badge.classList.remove('hidden');
}

export function clearDirty() {
  state.inspectorDirty = false;
  const save = ui.inspector.querySelector('[data-role="save"]');
  if (save) {
    save.textContent = '应用修改';
    save.classList.remove('dirty');
  }
  const badge = ui.inspector.querySelector('[data-role="dirty-badge"]');
  if (badge) badge.classList.add('hidden');
}

export function buildParamField(param: ParamSpec, value: unknown) {
  const wrap = div('field');
  wrap.dataset.param = param.key;
  wrap.dataset.type = (param.type || 'float') as string;
  wrap.dataset.label = (param.label || param.key) as string;
  const labelText = param.label || param.key;
  const type = param.type || 'float';

  if (type === 'bool') {
    const row = div('switch-row');
    row.appendChild(el('span', null, labelText as string));
    const input = el('input');
    input.type = 'checkbox';
    input.checked = Boolean(value);
    input.dataset.role = 'param-input';
    row.appendChild(input);
    wrap.appendChild(row);
  } else {
    const prefixable = type === 'float' && PREFIXABLE_UNITS.has(String(param.unit || ''));
    const fieldLabel = numberedField((labelText as string), prefixable ? '' : (param.unit || '') as string);
    typeLabelHelpFn?.(fieldLabel, param);
    wrap.appendChild(fieldLabel);
    let control: HTMLElement & { value?: string; type?: string; step?: string; min?: string; max?: string };
    let unitSelect: HTMLSelectElement | null = null;
    if (type === 'choice') {
      control = el('select');
      for (const choice of (param.choices as Array<{ label?: string; value: string }> || [])) {
        const option = el('option', null, choice.label || choice.value);
        option.value = choice.value;
        if (String(value) === String(choice.value)) option.selected = true;
        control.appendChild(option);
      }
    } else if (type === 'float' || type === 'int') {
      control = el('input');
      control.type = 'number';
      control.step = param.step !== undefined && param.step !== null
        ? String(param.step)
        : (type === 'int' ? '1' : 'a' + 'ny');
      if (param.min !== undefined && param.min !== null) control.min = String(param.min);
      if (param.max !== undefined && param.max !== null) control.max = String(param.max);
      control.value = value === undefined || value === null ? '' : String(value);
      if (prefixable) {
        const factor = savedUnitFactor(param) || bestUnitFactor(Number(value) || 0);
        if (!savedUnitFactor(param)) {
          try {
            localStorage.setItem(unitStorageKey(param), String(factor));
          } catch (error) {
            // localStorage 不可用时只影响本次会话
          }
        }
        control.value = trimNumber((Number(value) || 0) / factor);
        control.step = 'a' + 'ny';
        if (param.min !== undefined && param.min !== null) control.min = String(Number(param.min) / factor);
        if (param.max !== undefined && param.max !== null) control.max = String(Number(param.max) / factor);
        unitSelect = el('select');
        unitSelect.className = 'unit-select';
        unitSelect.dataset.role = 'param-unit';
        unitSelect.dataset.baseMin = param.min !== undefined && param.min !== null ? String(param.min) : '';
        unitSelect.dataset.baseMax = param.max !== undefined && param.max !== null ? String(param.max) : '';
        for (const item of UNIT_PREFIXES) {
          const option = el('option', null, `${item.prefix}${param.unit}`);
          option.value = String(item.factor);
          unitSelect.appendChild(option);
        }
        unitSelect.value = String(factor);
        unitSelect.dataset.factor = String(factor);
        unitSelect.addEventListener('change', () => {
          const oldFactor = Number(unitSelect!.dataset.factor) || 1;
          const nextFactor = Number(unitSelect!.value) || 1;
          const number = Number(control.value);
          if (Number.isFinite(number)) control.value = trimNumber((number * oldFactor) / nextFactor);
          unitSelect!.dataset.factor = String(nextFactor);
          try {
            localStorage.setItem(unitStorageKey(param), String(nextFactor));
          } catch (error) {
            // localStorage 不可用时只影响本次会话
          }
          const baseMin = unitSelect!.dataset.baseMin;
          const baseMax = unitSelect!.dataset.baseMax;
          control.min = baseMin === '' ? '' : String(Number(baseMin) / nextFactor);
          control.max = baseMax === '' ? '' : String(Number(baseMax) / nextFactor);
        });
      }
    } else if (type === 'node') {
      control = el('select');
      const empty = el('option', null, '（未设置）');
      empty.value = '';
      control.appendChild(empty);
      for (const node of state.scene?.nodes || []) {
        const option = el('option', null, `${node.name} · ${node.kind}`);
        option.value = node.id;
        if (value === node.id) option.selected = true;
        control.appendChild(option);
      }
    } else if (type === 'json' || type === 'matrix' || type === 'list' || type === 'mapping') {
      control = el('textarea');
      if (type === 'matrix' || param.key === 'A' || param.key === 'B' || param.key === 'C' || param.key === 'D') {
        control.classList.add('tall');
      }
      control.value = JSON.stringify(value === undefined ? param.default : value, null, 2);
      control.spellcheck = false;
      control.addEventListener('blur', () => {
        try {
          JSON.parse((control.value as string));
          control.classList.remove('invalid');
        } catch (error) {
          control.classList.add('invalid');
        }
      });
    } else {
      control = el('input');
      control.type = 'text';
      control.value = value === undefined || value === null ? '' : String(value);
      if (param.placeholder) (control as HTMLInputElement).placeholder = param.placeholder as string;
      if (param.key === 'expr') control.classList.add('mono');
    }
    control.dataset.role = 'param-input';
    if (param.placeholder && (type === 'json' || type === 'matrix' || type === 'list' || type === 'mapping')) {
      (control as HTMLInputElement).placeholder = param.placeholder as string;
    }
    if (unitSelect) {
      const unitRow = div('param-unit-row');
      unitRow.append(control, unitSelect);
      wrap.appendChild(unitRow);
    } else {
      wrap.appendChild(control);
    }
  }

  if (param.help) wrap.appendChild(div('help', (param.help as string | number | null | undefined)));
  return wrap;
}

export function applyPresetOnModelChange(container: HTMLElement, spec: SpecRec) {
  const presets = (spec.presets || {}) as Record<string, Record<string, unknown>>;
  const modelField = container.querySelector('[data-param="model"]');
  if (!modelField || !Object.keys(presets).length) return;
  const select = modelField.querySelector('select');
  if (!select) return;
  select.addEventListener('change', () => {
    const preset = presets[select.value];
    if (!preset) return;
    for (const [key, value] of Object.entries(preset)) {
      const field = container.querySelector(`[data-param="${key}"]`);
      const input = field ? field.querySelector('input') : null;
      if (!input) continue;
      const unit = field!.querySelector('[data-role="param-unit"]');
      const factor = unit ? (Number((unit as HTMLInputElement).value) || 1) : 1;
      input.value = trimNumber(Number(value) / factor);
    }
  });
}

// 电源波形：不同 wave 只显示实际参与计算的参数，避免 DC 还显示幅值/频率。
const WAVE_FIELDS = {
  dc: ['offset'],
  sine: ['offset', 'amplitude', 'frequency', 'phase', 'delay'],
  square: ['offset', 'amplitude', 'frequency', 'phase', 'delay'],
  triangle: ['offset', 'amplitude', 'frequency', 'phase', 'delay'],
  saw: ['offset', 'amplitude', 'frequency', 'phase', 'delay'],
  pulse: ['offset', 'amplitude', 'frequency', 'phase', 'duty', 'delay'],
  step: ['offset', 'amplitude', 'delay'],
  ramp: ['offset', 'amplitude', 'delay'],
};

export function applyWaveFieldVisibility(container: HTMLElement) {
  const waveField = container.querySelector('[data-param="wave"]');
  const select = waveField ? waveField.querySelector('select') : null;
  if (!select) return;
  const allowed = new Set(WAVE_FIELDS[select.value as keyof typeof WAVE_FIELDS] || []);
  for (const field of container.querySelectorAll<HTMLElement>('.field[data-param]')) {
    const key = field.dataset.param as string;
    if (key === 'wave') continue;
    field.hidden = !allowed.has(key);
  }
  const hint = waveField!.querySelector('[data-role="wave-hint"]');
  if (hint) {
    hint.textContent = select.value === 'dc'
      ? 'DC 模式只使用「偏置 / 直流电压」；幅值、频率等不参与计算。'
      : '周期波形使用偏置 + 幅值 + 频率（方波/脉冲另有占空比）。';
  }
}

export function buildWaveFieldVisibility(container: HTMLElement) {
  const waveField = container.querySelector('[data-param="wave"]');
  if (!waveField) return;
  const select = waveField.querySelector('select');
  if (!select) return;
  if (!waveField.querySelector('[data-role="wave-hint"]')) {
    const hint = div('help');
    hint.dataset.role = 'wave-hint';
    waveField.appendChild(hint);
  }
  select.addEventListener('change', () => applyWaveFieldVisibility(container));
  applyWaveFieldVisibility(container);
}

export function buildParamFields(spec: SpecRec, params: Record<string, unknown>) {
  const container = div('params-grid');
  container.dataset.role = 'params';
  if (!spec || !Array.isArray(spec.params) || !spec.params.length) {
    container.appendChild(div('help', '该类型没有可调参数。'));
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

export function collectParamValues(container: HTMLElement): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const wrapper of $$('[data-param]', container)) {
    const key = wrapper.dataset.param as string;
    const type = wrapper.dataset.type;
    const label = wrapper.dataset.label || key;
    const input = wrapper.querySelector('input, select, textarea');
    if (!input) continue;
    if (type === 'bool') {
      values[key] = Boolean((input as HTMLInputElement).checked);
    } else if (type === 'float' || type === 'int') {
      const text = String((input as HTMLInputElement).value).trim();
      if (!text) throw new Error(`参数「${label}」不能为空`);
      const number = Number(text);
      if (!Number.isFinite(number)) throw new Error(`参数「${label}」必须是有限数字`);
      if (type === 'int' && !Number.isInteger(number)) throw new Error(`参数「${label}」必须是整数`);
      const unitSelect = wrapper.querySelector('[data-role="param-unit"]');
      values[key] = unitSelect ? number * (Number((unitSelect as HTMLInputElement).value) || 1) : number;
    } else if (type === 'json' || type === 'matrix' || type === 'list' || type === 'mapping') {
      try {
        values[key] = JSON.parse((input as HTMLInputElement).value);
      } catch (error) {
        input.classList.add('invalid');
        throw new Error(`参数「${label}」不是合法 JSON`);
      }
    } else {
      values[key] = (input as HTMLInputElement).value;
    }
  }
  return values;
}

export function dataRow(key: string, value: unknown) {
  const row = div('data-row');
  const keyInput = el('input');
  keyInput.type = 'text';
  keyInput.className = 'data-key';
  keyInput.placeholder = '字段';
  keyInput.value = key;
  keyInput.spellcheck = false;
  const valueInput = el('input');
  valueInput.type = 'text';
  valueInput.className = 'data-val';
  valueInput.placeholder = '数值 / 文本 / JSON';
  valueInput.value = valueToText(value);
  valueInput.spellcheck = false;
  const remove = button('×', 'icon-btn', () => {
    row.remove();
    markDirty();
  });
  remove.title = '删除该字段';
  keyInput.addEventListener('input', markDirty);
  valueInput.addEventListener('input', markDirty);
  row.append(keyInput, valueInput, remove);
  return row;
}

export function collectData(container: HTMLElement) {
  const result: Record<string, unknown> = {};
  for (const row of $$('.data-row', container)) {
    const key = (row!.querySelector('.data-key') as HTMLInputElement).value.trim();
    if (!key) continue;
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      throw new Error(`数据字段「${key}」重复`);
    }
    result[key] = parseSmartValue((row!.querySelector('.data-val') as HTMLInputElement).value);
  }
  return result;
}
