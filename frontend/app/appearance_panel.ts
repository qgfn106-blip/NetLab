// R40 P-B：元素级外观面板（多选批量、扩展颜色、线型、对比度护栏）。
import type { AppearanceRec, EdgeItem, NodeItem } from './types.js';
import { state } from './state.js';
import { edgeById, nodeById, selectedEdge, selectedNode } from './model.js';
import { button, div, el } from './ui.js';
import { tokens } from './colors.js';
import { toast } from './desktop.js';
import { requestDraw } from './canvas_render.js';

export interface AppearanceTarget {
  kind: 'node' | 'edge';
  item: NodeItem | EdgeItem;
}

export interface AppearancePatch {
  kind: 'node' | 'edge';
  id: string;
  appearance: AppearanceRec | null;
}

export interface AppearancePanelOptions {
  pushUndo: () => void;
  persist: (kind: 'node' | 'edge', id: string, appearance: AppearanceRec | null) => Promise<void>;
  /** 批量提交（SceneEdit 事务端点）；缺省时逐条回退到 persist。 */
  persistElements?: (items: AppearancePatch[]) => Promise<void>;
}

export function collectAppearanceTargets(): AppearanceTarget[] {
  const targets: AppearanceTarget[] = [];
  const multiNodes = state.multi?.nodes || new Set<string>();
  const multiEdges = state.multi?.edges || new Set<string>();
  if (multiNodes.size || multiEdges.size) {
    for (const id of multiNodes) {
      const item = nodeById(id);
      if (item) targets.push({ kind: 'node', item });
    }
    for (const id of multiEdges) {
      const item = edgeById(id);
      if (item) targets.push({ kind: 'edge', item });
    }
  }
  if (!targets.length) {
    const node = selectedNode();
    const edge = node ? null : selectedEdge();
    if (node) targets.push({ kind: 'node', item: node });
    else if (edge) targets.push({ kind: 'edge', item: edge });
  }
  return targets;
}

export function appearancePanelTitle(targets: AppearanceTarget[]): string {
  return targets.length > 1 ? `元素外观（已选 ${targets.length} 项）` : '元素外观（当前选中项）';
}

function channelLum(hex: string, index: number): number {
  const value = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function contrastRatio(a: string, b: string): number {
  const la = 0.2126 * channelLum(a, 0) + 0.7152 * channelLum(a, 1) + 0.0722 * channelLum(a, 2);
  const lb = 0.2126 * channelLum(b, 0) + 0.7152 * channelLum(b, 1) + 0.0722 * channelLum(b, 2);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function renderAppearancePanel(
  rows: HTMLElement,
  targets: AppearanceTarget[],
  options: AppearancePanelOptions,
): void {
  if (!targets.length) {
    rows.appendChild(div('help', '先在画布上选中一个或多个节点/连线，再回到这里设置元素外观。'));
    return;
  }
  options.pushUndo();
  const hasNode = targets.some((target) => target.kind === 'node');
  const primary = targets[0].item;
  const app: AppearanceRec = { ...(primary.appearance || {}) };
  const setField = (key: keyof AppearanceRec, value: string | number | undefined): void => {
    for (const target of targets) {
      const next: AppearanceRec = { ...(target.item.appearance || {}) };
      if (value === undefined) delete next[key];
      else (next as Record<string, unknown>)[key] = value;
      target.item.appearance = next;
    }
    requestDraw();
  };
  const persist = async (): Promise<void> => {
    const weak = targets.some((target) => {
      const current = target.item.appearance || {};
      return Boolean(current.fillColor && current.textColor && contrastRatio(current.fillColor, current.textColor) < 3);
    });
    if (weak) {
      toast('填充色与文字色对比度不足 3:1，请调整后再保存', 'warn');
      return;
    }
    const patches: AppearancePatch[] = targets.map((target) => {
      const current = target.item.appearance || {};
      return { kind: target.kind, id: target.item.id, appearance: Object.keys(current).length ? current : null };
    });
    if (options.persistElements) {
      await options.persistElements(patches);
      return;
    }
    for (const patch of patches) {
      await options.persist(patch.kind, patch.id, patch.appearance);
    }
  };
  const addColor = (key: keyof AppearanceRec, labelText: string, fallback: string): void => {
    const field = div('ui-field wide');
    field.appendChild(el('span', null, labelText));
    const input = el('input');
    input.type = 'color';
    input.value = String((app as Record<string, unknown>)[key] || fallback);
    input.addEventListener('input', () => { setField(key, input.value); });
    input.addEventListener('change', () => { void persist(); });
    field.appendChild(input);
    rows.appendChild(field);
  };
  addColor('strokeColor', '线条/描边', app.color || tokens().edgeDefault);
  if (hasNode) addColor('fillColor', '填充色', '#faf8f2');
  addColor('textColor', '文字色', '#11100e');
  if (hasNode) {
    addColor('portColor', '端口色', '#1f5f5b');
    addColor('tickColor', '刻度/选中色', '#a8541f');
  }
  const styleField = div('ui-field wide');
  styleField.appendChild(el('span', null, '线型'));
  const styleInput = el('select');
  for (const style of ['solid', 'dashed', 'dotted']) {
    const option = el('option', null, style);
    option.value = style;
    styleInput.appendChild(option);
  }
  styleInput.value = app.lineStyle || 'solid';
  styleInput.addEventListener('change', () => { setField('lineStyle', styleInput.value); void persist(); });
  styleField.appendChild(styleInput);
  rows.appendChild(styleField);
  const addRange = (key: 'opacity' | 'lineWidth' | 'fontSize', labelText: string, min: number, max: number, step: number, fallback: number): void => {
    const field = div('ui-field wide');
    field.appendChild(el('span', null, labelText));
    const input = el('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    const currentValue = app[key];
    input.value = String(currentValue !== undefined ? currentValue : fallback);
    input.addEventListener('input', () => { setField(key, Number(input.value)); });
    input.addEventListener('change', () => { void persist(); });
    field.appendChild(input);
    rows.appendChild(field);
  };
  addRange('opacity', '透明度', 0.05, 1, 0.05, 1);
  addRange('lineWidth', '线宽', 0.5, 12, 0.1, hasNode ? 1 : 1.15);
  addRange('fontSize', '标签字号', 6, 48, 0.5, 12);
  const clearRow = div('modal-actions');
  clearRow.appendChild(button('清除选中项外观覆盖', 'btn tiny', () => {
    for (const target of targets) target.item.appearance = {};
    requestDraw();
    for (const target of targets) {
      void options.persist(target.kind, target.item.id, null);
    }
    toast('已清除选中项的外观覆盖', 'ok');
  }));
  rows.appendChild(clearRow);
}
