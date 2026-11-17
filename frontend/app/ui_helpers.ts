// S1a：从 app.ts 单 IIFE 外提的零依赖 UI/DOM 小工具（函数体字节等价，未加参数/未改时序）。
// 依据 F-01 依赖审计（NetlabExtras/scratch/b7_design/03_F01_DEPENDENCY_AUDIT_READONLY.md）。
// 本模块不 import state/canvas/ctx 或任何可变全局；仅 import 纯工具函数与类型。
import { $, $$ } from './dom.js';
import { el, div, button } from './ui.js';
import { jsonRequest } from './net.js';
import { numberedField } from './fields.js';
import { requestDraw } from './canvas_render.js';
import type { BlockItem, PortSpec, IroGlobal, NodeItem, EdgeItem, AppearanceRec } from './types.js';
import type { ApiOptions } from './net.js';

export function openIroColorPopover(anchor: HTMLElement, value: string, onChange: (value: string) => void) {
  document.querySelectorAll('.iro-popover').forEach((node) => node.remove());
  if (!(window as Window & { iro?: IroGlobal }).iro || typeof (window as Window & { iro?: IroGlobal }).iro!.ColorPicker !== 'function') {
    anchor.click();
    return;
  }
  const pop = div('iro-popover');
  const rect = anchor.getBoundingClientRect();
  pop.style.position = 'fixed';
  pop.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 260))}px`;
  pop.style.top = `${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 300))}px`;
  pop.style.zIndex = '20000';
  pop.style.padding = '10px';
  pop.style.borderRadius = '10px';
  pop.style.background = 'var(--panel-bg)';
  pop.style.boxShadow = '0 12px 36px rgba(0,0,0,.24)';
  pop.style.border = '1px solid var(--line, #ccd4d8)';
  const host = div('iro-host');
  pop.appendChild(host);
  pop.appendChild(button('关闭', 'btn tiny', () => pop.remove()));
  document.body.appendChild(pop);
  const picker = new (window as Window & { iro?: IroGlobal }).iro!.ColorPicker(host, { width: 220, color: value || '#000000' });
  picker.on('color:change', (color: { hexString: string }) => onChange(color.hexString));
  setTimeout(() => {
    const close = (event: MouseEvent) => {
      if (pop.contains((event.target as Node | null)) || event.target === anchor) return;
      pop.remove();
      document.removeEventListener('pointerdown', close);
    };
    document.addEventListener('pointerdown', close);
  }, 0);
}
export function setGroupSub(group: string, sub: string) {
  const host = $(`.panel-group[data-group="${group}"]`);
  if (!host) return;
  const attr = group === 'fn' ? 'fnrole' : 'sub';
  $$(`[data-${attr}]`, host).forEach((node) => {
    node.classList.toggle('active', node.dataset[attr] === sub);
  });
  if (group === 'modules' || group === 'analysis' || group === 'workbench') {
    $$('.tab-pane', host).forEach((pane) => {
      pane.classList.toggle('hidden', pane.id !== `tab-${sub}`);
    });
  }
}
export function blockBadges(spec: BlockItem) {
  const badges = [
    spec.mode,
    spec.model || 'behavioral',
    `v${spec.version}`,
    `${spec.node_count} 节点`,
    `${(spec.inputs || []).length} 入 / ${(spec.outputs || []).length} 出`,
  ];
  if (spec.builtin) badges.unshift('内置');
  return badges;
}
export function numberInput(value: number, options: ApiOptions = {}) {
  const input = el('input');
  input.type = 'number';
  if (options.min !== undefined) input.min = String(options.min);
  if (options.max !== undefined) input.max = String(options.max);
  if (options.step !== undefined) input.step = String(options.step);
  input.value = String(value);
  return input;
}
export function modulePortList(block: BlockItem) {
  return (block?.ports || []).map((port: PortSpec) => ({
    name: String(port.name || 'port'),
    direction: String(port.direction || (port.dtype === 'electrical' ? 'inout' : 'input')),
    dtype: String(port.dtype || ''),
    net: String(port.net || ''),
  }));
}
export async function captureSceneSnapshot() {
  try {
    return await jsonRequest('/api/scene/export', 'GET');
  } catch (error) {
    return null;
  }
}
export function fieldFor(labelText: string, unitText: string, input: HTMLInputElement) {
  const wrapper = div('field');
  wrapper.appendChild(numberedField(labelText, unitText));
  wrapper.appendChild(input);
  return wrapper;
}
export function wbFmtAxis(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e4 || abs < 1e-3)) return value.toExponential(1);
  return String(Math.round(value * 1000) / 1000);
}
export function wbToggleInArray(arr: string[], value: string, on: boolean): void {
  const index = arr.indexOf(value);
  if (on && index < 0) arr.push(value);
  else if (!on && index >= 0) arr.splice(index, 1);
}
export function setPanelGroup(group: string) {
  $$('.panel-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.group === group));
  $$('.panel-group').forEach((node) => node.classList.toggle('active', node.dataset.group === group));
}
export function previewElementAppearance(item: NodeItem | EdgeItem, appearance: AppearanceRec): void {
  item.appearance = { ...appearance };
  requestDraw();
}
export function plotkitFrames() {
  return [$('#plotkitFrame'), $('#plotkitInlineHost iframe')].filter(Boolean);
}
export function closeMenus() {
  $$('.menu.open').forEach((node) => node.classList.remove('open'));
}
export function wbBadge(text: string, cls: string): HTMLSpanElement {
  return el('span', cls, text);
}
