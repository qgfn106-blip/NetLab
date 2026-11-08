// S5-14：参数值格式化、类型选择与单位前缀助手（从 app.ts 拆出，M 轮）
import { fmt } from '../app.utils.js';
import { el } from './ui.js';
import { $$ } from './dom.js';
import { state } from './state.js';
import type { ParamSpec, SpecRec } from './types.js';

export function formatAny(value: unknown) {
  if (typeof value === 'number') return fmt(value, 5);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') {
    const text = JSON.stringify(value);
    return text.length > 140 ? `${text.slice(0, 140)}…` : text;
  }
  return String(value);
}

export function valueToText(value: unknown) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value, null, 0);
  return String(value);
}

export function parseSmartValue(text: string) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
    const number = Number(trimmed);
    if (Number.isFinite(number)) return number;
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      throw new Error('数据字段看起来是 JSON，但格式不合法');
    }
  }
  return trimmed;
}

export function kindListFor(role: string) {
  if (!state.catalog) return [];
  if (role === 'node') {
    if (state.mode === 'circuit') return state.catalog.circuit_nodes || [];
    const computes = state.catalog.computes || [];
    if (state.mode === 'vector') {
      return computes.slice().sort((a, b) => {
        const rank = (item: SpecRec) => (item.group === '矢量' ? 0 : 1);
        return rank(a) - rank(b);
      });
    }
    return computes;
  }
  if (state.mode === 'circuit') return state.catalog.elements || [];
  const methods = state.catalog.methods || [];
  if (state.mode === 'vector') {
    return methods.slice().sort((a, b) => {
      const rank = (item: SpecRec) => (item.group === '矢量' ? 0 : 1);
      return rank(a) - rank(b);
    });
  }
  return methods;
}

export function buildKindSelect(role: string, currentKind: string, currentId: string | null = null) {
  const select = el('select');
  select.dataset.role = 'kind';
  const list = kindListFor(role);
  const groups = new Map();
  for (const spec of list) {
    // 保留当前节点的 kind（块节点仍能显示自己），但不允许改成不可手动创建的 kind。
    if (spec.addable === false && spec.kind !== currentKind) continue;
    const group = spec.group || '';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(spec);
  }
  const appendOption = (parent: HTMLElement, spec: SpecRec) => {
    const option = el('option', null, spec.label);
    option.value = spec.kind;
    if (spec.kind === currentKind) option.selected = true;
    parent.appendChild(option);
  };
  if (state.mode !== 'circuit' && role === 'node') {
    for (const [group, specs] of groups) {
      const wrapper = group ? el('optgroup') : select;
      if (group) (wrapper as HTMLOptGroupElement).label = group;
      specs.forEach((spec: SpecRec) => appendOption(wrapper, spec));
      if (group) select.appendChild(wrapper);
    }
  } else {
    for (const specs of groups.values()) specs.forEach((spec: SpecRec) => appendOption(select, spec));
  }
  if (!$$('option', select).some((option) => (option as HTMLInputElement).value === currentKind)) {
    const option = el('option', null, currentKind || '—');
    option.value = currentKind || '';
    option.selected = true;
    select.appendChild(option);
  }
  return select;
}

export function numberedField(labelText: string, unitText: string) {
  const label = el('label');
  label.appendChild(el('span', null, labelText));
  if (unitText) label.appendChild(el('em', null, unitText));
  return label;
}

// R22 追加：常用电学单位允许切前缀，避免被迫输入 1e-6 这类数字。
export const UNIT_PREFIXES = [
  { factor: 1e-12, prefix: 'p' },
  { factor: 1e-9, prefix: 'n' },
  { factor: 1e-6, prefix: 'µ' },
  { factor: 1e-3, prefix: 'm' },
  { factor: 1, prefix: '' },
  { factor: 1e3, prefix: 'k' },
  { factor: 1e6, prefix: 'M' },
];
export const PREFIXABLE_UNITS = new Set(['F', 'H', 'Ω', 'V', 'A', 's', 'Hz']);

export function unitStorageKey(param: ParamSpec) {
  return `netlab.unit.${param.key}.${param.unit || ''}`;
}

export function savedUnitFactor(param: ParamSpec) {
  try {
    const raw = localStorage.getItem(unitStorageKey(param));
    const factor = Number(raw);
    if (Number.isFinite(factor) && factor > 0) return factor;
  } catch (error) {
    // localStorage 不可用时退回自动前缀
  }
  return 0;
}

export function bestUnitFactor(value: number) {
  const magnitude = Math.abs(Number(value) || 0);
  if (!magnitude) return 1;
  for (const item of UNIT_PREFIXES) {
    if (magnitude < item.factor * 1000) return item.factor;
  }
  return UNIT_PREFIXES[UNIT_PREFIXES.length - 1].factor;
}

export function trimNumber(value: number) {
  if (!Number.isFinite(value)) return '';
  return String(Number(value.toPrecision(12)));
}
