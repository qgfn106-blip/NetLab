/* 分析工作台布局树（v2）纯数据操作。
 *
 * Tab → SplitTree → Leaf 两级模型：
 *  - split 表示左右（row）或上下（column）两栏，ratio 为第一栏占比；
 *  - tabs 表示同一区域的标签页组，第一阶段子节点只允许 canvas 叶子；
 *  - auto 表示旧的网格/平铺自动排列，仅用于兼容与排列预设。
 * 本模块不依赖 DOM，便于单元测试与工程序列化。
 */
import type { WorkbenchCanvasRec } from './analysis_workbench_layout.js';

export type LayoutNode =
  | { type: 'canvas'; canvasId: string }
  | { type: 'split'; axis: 'row' | 'column'; ratio: number; first: LayoutNode; second: LayoutNode }
  | { type: 'tabs'; active: string; children: Array<{ type: 'canvas'; canvasId: string }> }
  | { type: 'auto'; canvasIds: string[] };

export interface WorkbenchTabRec {
  id: string;
  title: string;
  root: LayoutNode;
}

export interface WorkbenchLayoutRecV2 {
  tabs: WorkbenchTabRec[];
  activeTab: string;
}

export type LayoutPreset = 'auto' | 'row' | 'column' | 'tabs';
export const LAYOUT_PRESETS: Array<[LayoutPreset, string]> = [
  ['auto', '自动网格'],
  ['row', '左右分栏'],
  ['column', '上下分栏'],
  ['tabs', '标签页'],
];

const RATIO_MIN = 0.15;
const RATIO_MAX = 0.85;

function isRecordNode(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampRatio(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0.5;
  return Math.max(RATIO_MIN, Math.min(RATIO_MAX, parsed));
}

export function emptyLayout(): WorkbenchLayoutRecV2 {
  return { tabs: [], activeTab: '' };
}

export function canvasNode(canvasId: string): LayoutNode {
  return { type: 'canvas', canvasId };
}

export function collectCanvasIds(node: LayoutNode | null): string[] {
  if (!node) return [];
  if (node.type === 'canvas') return [node.canvasId];
  if (node.type === 'auto') return [...node.canvasIds];
  if (node.type === 'tabs') return node.children.map((child) => child.canvasId);
  return [...collectCanvasIds(node.first), ...collectCanvasIds(node.second)];
}

export function firstCanvasId(node: LayoutNode | null): string {
  if (!node) return '';
  if (node.type === 'canvas') return node.canvasId;
  if (node.type === 'auto') return node.canvasIds[0] || '';
  if (node.type === 'tabs') return node.children[0]?.canvasId || '';
  return firstCanvasId(node.first) || firstCanvasId(node.second);
}

/** 把画布 id 列表按平衡树组织；preset=tabs 时压成一个标签页组。 */
export function rootForCanvasIds(canvasIds: string[], preset: LayoutPreset = 'auto'): LayoutNode | null {
  const ids = Array.from(new Set(canvasIds.filter(Boolean)));
  if (!ids.length) return null;
  if (ids.length === 1 && preset !== 'tabs') return canvasNode(ids[0]);
  if (preset === 'tabs') {
    if (ids.length === 1) return canvasNode(ids[0]);
    return { type: 'tabs', active: ids[0], children: ids.map((id) => ({ type: 'canvas' as const, canvasId: id })) };
  }
  if (preset === 'auto') {
    if (ids.length === 1) return canvasNode(ids[0]);
    return { type: 'auto', canvasIds: ids };
  }
  const axis: 'row' | 'column' = preset === 'row' ? 'row' : 'column';
  const build = (items: string[]): LayoutNode => {
    if (items.length === 1) return canvasNode(items[0]);
    const mid = Math.ceil(items.length / 2);
    return { type: 'split', axis, ratio: 0.5, first: build(items.slice(0, mid)), second: build(items.slice(mid)) };
  };
  return build(ids);
}

function normalizeNode(value: unknown, valid: Set<string>, used: Set<string>): LayoutNode | null {
  if (!isRecordNode(value)) return null;
  const type = value.type;
  if (type === 'canvas') {
    const id = typeof value.canvasId === 'string' ? value.canvasId : '';
    if (!valid.has(id) || used.has(id)) return null;
    used.add(id);
    return canvasNode(id);
  }
  if (type === 'split') {
    const first = normalizeNode(value.first, valid, used);
    const second = normalizeNode(value.second, valid, used);
    if (!first || !second) return first || second;
    const axis = value.axis === 'column' ? 'column' : 'row';
    return { type: 'split', axis, ratio: clampRatio(value.ratio), first, second };
  }
  if (type === 'tabs') {
    const children: Array<{ type: 'canvas'; canvasId: string }> = [];
    const rawChildren = Array.isArray(value.children) ? value.children : [];
    for (const child of rawChildren) {
      const node = normalizeNode(child, valid, used);
      if (node && node.type === 'canvas') children.push(node);
    }
    if (!children.length) return null;
    if (children.length === 1) return children[0];
    const active = typeof value.active === 'string' && children.some((child) => child.canvasId === value.active)
      ? value.active
      : children[0].canvasId;
    return { type: 'tabs', active, children };
  }
  if (type === 'auto') {
    const rawIds = Array.isArray(value.canvasIds) ? value.canvasIds : [];
    const ids: string[] = [];
    for (const raw of rawIds) {
      if (typeof raw !== 'string' || !valid.has(raw) || used.has(raw)) continue;
      used.add(raw);
      ids.push(raw);
    }
    if (!ids.length) return null;
    if (ids.length === 1) return canvasNode(ids[0]);
    return { type: 'auto', canvasIds: ids };
  }
  return null;
}

/** v1 layout（mode/rows/cols/order）→ v2 单标签页。 */
export function migrateV1Layout(value: unknown, canvasIds: string[]): WorkbenchLayoutRecV2 {
  const order = isRecordNode(value) && Array.isArray(value.order)
    ? value.order.filter((id): id is string => typeof id === 'string' && canvasIds.includes(id))
    : [];
  const ids = order.length ? order : canvasIds;
  if (!ids.length) return emptyLayout();
  const mode = isRecordNode(value) && typeof value.mode === 'string' ? value.mode : 'grid';
  const preset: LayoutPreset = mode === 'split' ? 'row' : 'auto';
  const root = rootForCanvasIds(ids, preset);
  return { tabs: root ? [{ id: 'tab-1', title: '主视图', root }] : [], activeTab: root ? 'tab-1' : '' };
}

function appendMissing(root: LayoutNode | null, ids: string[]): LayoutNode | null {
  if (!ids.length) return root;
  if (!root) return rootForCanvasIds(ids, 'auto');
  const current = collectCanvasIds(root);
  const missing = ids.filter((id) => !current.includes(id));
  if (!missing.length) return root;
  if (root.type === 'auto') return { type: 'auto', canvasIds: [...root.canvasIds, ...missing] };
  if (root.type === 'tabs') {
    const children = [...root.children, ...missing.map((id) => ({ type: 'canvas' as const, canvasId: id }))];
    return { type: 'tabs', active: root.active, children };
  }
  // 复杂树统一把缺失画布作为右侧一个 auto 面板并入。
  return { type: 'split', axis: 'row', ratio: 0.7, first: root, second: rootForCanvasIds(missing, 'auto')! };
}

/** 规范化任意来源的 v2 layout；无效数据回落到按 canvasIds 生成默认布局。 */
export function normalizeLayout(value: unknown, canvasIds: string[], legacy: boolean): WorkbenchLayoutRecV2 {
  if (legacy || (isRecordNode(value) && !Array.isArray(value.tabs))) return migrateV1Layout(value, canvasIds);
  if (!isRecordNode(value)) return migrateV1Layout(null, canvasIds);
  const valid = new Set(canvasIds);
  const used = new Set<string>();
  const tabs: WorkbenchTabRec[] = [];
  const rawTabs = Array.isArray(value.tabs) ? value.tabs : [];
  const seenTabIds = new Set<string>();
  rawTabs.forEach((raw, index) => {
    if (!isRecordNode(raw)) return;
    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : 'tab-' + (index + 1);
    if (seenTabIds.has(id)) return;
    const root = normalizeNode(raw.root, valid, used);
    if (!root) return;
    seenTabIds.add(id);
    const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : ('视图 ' + (tabs.length + 1));
    tabs.push({ id, title, root });
  });
  const missing = canvasIds.filter((id) => valid.has(id) && !used.has(id));
  if (missing.length) {
    if (tabs.length) tabs[tabs.length - 1].root = appendMissing(tabs[tabs.length - 1].root, missing)!;
    else {
      const root = rootForCanvasIds(missing, 'auto');
      if (root) tabs.push({ id: 'tab-1', title: '主视图', root });
    }
  }
  if (!tabs.length) return emptyLayout();
  const activeTab = typeof value.activeTab === 'string' && tabs.some((tab) => tab.id === value.activeTab)
    ? value.activeTab
    : tabs[0].id;
  return { tabs, activeTab };
}

export function findTab(layout: WorkbenchLayoutRecV2, tabId: string): WorkbenchTabRec | null {
  return layout.tabs.find((tab) => tab.id === tabId) || null;
}

export function findCanvasTab(layout: WorkbenchLayoutRecV2, canvasId: string): WorkbenchTabRec | null {
  return layout.tabs.find((tab) => collectCanvasIds(tab.root).includes(canvasId)) || null;
}

export function replaceLeaf(node: LayoutNode, targetId: string, replacement: LayoutNode): LayoutNode {
  if (node.type === 'canvas') return node.canvasId === targetId ? replacement : node;
  if (node.type === 'auto') return node;
  if (node.type === 'tabs') {
    return {
      type: 'tabs',
      active: node.active === targetId ? firstCanvasId(replacement) : node.active,
      children: node.children.map((child) => ({ type: 'canvas' as const, canvasId: child.canvasId === targetId ? firstCanvasId(replacement) : child.canvasId })),
    };
  }
  return { ...node, first: replaceLeaf(node.first, targetId, replacement), second: replaceLeaf(node.second, targetId, replacement) };
}

export function removeLeaf(node: LayoutNode, canvasId: string): LayoutNode | null {
  if (node.type === 'canvas') return node.canvasId === canvasId ? null : node;
  if (node.type === 'auto') {
    const ids = node.canvasIds.filter((id) => id !== canvasId);
    if (!ids.length) return null;
    if (ids.length === 1) return canvasNode(ids[0]);
    return { type: 'auto', canvasIds: ids };
  }
  if (node.type === 'tabs') {
    const children = node.children.filter((child) => child.canvasId !== canvasId);
    if (!children.length) return null;
    if (children.length === 1) return children[0];
    return { type: 'tabs', active: node.active === canvasId ? children[0].canvasId : node.active, children };
  }
  const first = removeLeaf(node.first, canvasId);
  const second = removeLeaf(node.second, canvasId);
  if (!first) return second;
  if (!second) return first;
  return { ...node, first, second };
}

export function removeCanvasFromLayout(layout: WorkbenchLayoutRecV2, canvasId: string): WorkbenchLayoutRecV2 {
  const tabs: WorkbenchTabRec[] = [];
  for (const tab of layout.tabs) {
    const root = removeLeaf(tab.root, canvasId);
    if (root) tabs.push({ ...tab, root });
  }
  let activeTab = layout.activeTab;
  if (!tabs.some((tab) => tab.id === activeTab)) activeTab = tabs[0]?.id || '';
  return { tabs, activeTab };
}

/** 向指定标签页追加画布；没有标签页时新建。 */
export function appendCanvas(layout: WorkbenchLayoutRecV2, canvasId: string, tabId = ''): WorkbenchLayoutRecV2 {
  const tabs = layout.tabs.map((tab) => ({ ...tab }));
  let target = tabs.find((tab) => tab.id === tabId) || tabs.find((tab) => tab.id === layout.activeTab) || tabs[tabs.length - 1];
  if (!target) {
    const root = rootForCanvasIds([canvasId], 'auto')!;
    const id = 'tab-' + Date.now().toString(36);
    return { tabs: [{ id, title: '主视图', root }], activeTab: id };
  }
  target.root = appendMissing(target.root, [canvasId])!;
  return { tabs, activeTab: target.id };
}

function containsCanvasInTabs(node: LayoutNode, canvasId: string): boolean {
  if (node.type === 'tabs') return node.children.some((child) => child.canvasId === canvasId);
  if (node.type === 'split') return containsCanvasInTabs(node.first, canvasId) || containsCanvasInTabs(node.second, canvasId);
  return false;
}

/** 将 target 画布替换为 split(target, dragged)，position 表示 dragged 落在哪一侧。 */
export function splitCanvasInLayout(
  layout: WorkbenchLayoutRecV2,
  targetId: string,
  draggedId: string,
  axis: 'row' | 'column',
  position: 'before' | 'after',
): WorkbenchLayoutRecV2 {
  const without = removeCanvasFromLayout(layout, draggedId);
  const tabs = without.tabs.map((tab) => {
    if (!collectCanvasIds(tab.root).includes(targetId)) return tab;
    const dragged: LayoutNode = canvasNode(draggedId);
    const target: LayoutNode = canvasNode(targetId);
    const split: LayoutNode = position === 'before'
      ? { type: 'split', axis, ratio: 0.5, first: dragged, second: target }
      : { type: 'split', axis, ratio: 0.5, first: target, second: dragged };
    if (containsCanvasInTabs(tab.root, targetId)) {
      // tabs 子节点只能是 canvas：分割整个标签页区域，保留组内其他画布。
      const root: LayoutNode = position === 'before'
        ? { type: 'split', axis, ratio: 0.5, first: dragged, second: tab.root }
        : { type: 'split', axis, ratio: 0.5, first: tab.root, second: dragged };
      return { ...tab, root };
    }
    return { ...tab, root: replaceLeaf(tab.root, targetId, split) };
  });
  return { ...without, tabs };
}

function insertIntoCanvasTabs(node: LayoutNode, targetId: string, draggedId: string): LayoutNode {
  if (node.type === 'tabs') {
    if (!node.children.some((child) => child.canvasId === targetId)) return node;
    return { type: 'tabs', active: draggedId, children: [...node.children, { type: 'canvas', canvasId: draggedId }] };
  }
  if (node.type === 'canvas') {
    if (node.canvasId !== targetId) return node;
    return {
      type: 'tabs',
      active: draggedId,
      children: [
        { type: 'canvas', canvasId: targetId },
        { type: 'canvas', canvasId: draggedId },
      ],
    };
  }
  if (node.type === 'split') {
    return { ...node, first: insertIntoCanvasTabs(node.first, targetId, draggedId), second: insertIntoCanvasTabs(node.second, targetId, draggedId) };
  }
  return node;
}

/** 把 dragged 合并进 target 所在标签页组；两者不在同一组时把 target 叶子升级为 tabs。 */
export function mergeCanvasIntoTabs(layout: WorkbenchLayoutRecV2, targetId: string, draggedId: string): WorkbenchLayoutRecV2 {
  const without = removeCanvasFromLayout(layout, draggedId);
  const tabs = without.tabs.map((tab) => (
    collectCanvasIds(tab.root).includes(targetId)
      ? { ...tab, root: insertIntoCanvasTabs(tab.root, targetId, draggedId) }
      : tab
  ));
  return { ...without, tabs };
}

/** 排列当前标签页根节点。 */
export function arrangeRoot(root: LayoutNode, preset: LayoutPreset): LayoutNode | null {
  return rootForCanvasIds(collectCanvasIds(root), preset);
}

export function layoutPresetOf(root: LayoutNode): LayoutPreset {
  if (root.type === 'auto') return 'auto';
  if (root.type === 'tabs') return 'tabs';
  if (root.type === 'canvas') return 'auto';
  return root.axis === 'row' ? 'row' : 'column';
}

/** 新建/复制标签页时用的浅拷贝画布记录工厂。 */
export function cloneCanvasRec(rec: WorkbenchCanvasRec, canvasId: string, title: string): WorkbenchCanvasRec {
  return { ...rec, canvas_id: canvasId, title, view_state: rec.view_state ? JSON.parse(JSON.stringify(rec.view_state)) : undefined };
}
