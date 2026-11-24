/* 画布/标签页 id 生成与布局树深拷贝（model 层纯函数）。 */
import type { LayoutNode } from './analysis_workbench_layout_tree.js';

export function newCanvasId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch (error) {
    /* 回落到时间戳 id */
  }
  return 'canvas-' + Date.now().toString(36) + '-' + Math.random().toString(16).slice(2, 10);
}

export function newTabId(): string {
  return 'tab-' + Date.now().toString(36) + '-' + Math.random().toString(16).slice(2, 6);
}

export function cloneNodeWithNewIds(node: LayoutNode, map: Map<string, string>): LayoutNode {
  if (node.type === 'canvas') {
    const id = newCanvasId();
    map.set(node.canvasId, id);
    return { type: 'canvas', canvasId: id };
  }
  if (node.type === 'auto') {
    return { type: 'auto', canvasIds: node.canvasIds.map((id) => {
      const copy = newCanvasId();
      map.set(id, copy);
      return copy;
    }) };
  }
  if (node.type === 'tabs') {
    const children = node.children.map((child) => {
      const id = newCanvasId();
      map.set(child.canvasId, id);
      return { type: 'canvas' as const, canvasId: id };
    });
    return { type: 'tabs', active: children[0]?.canvasId || '', children };
  }
  return {
    type: 'split',
    axis: node.axis,
    ratio: node.ratio,
    first: cloneNodeWithNewIds(node.first, map),
    second: cloneNodeWithNewIds(node.second, map),
  };
}

export function containsTabsNode(node: LayoutNode, canvasId: string): boolean {
  if (node.type === 'canvas') return false;
  if (node.type === 'auto') return false;
  if (node.type === 'tabs') return node.children.some((child) => child.canvasId === canvasId);
  return containsTabsNode(node.first, canvasId) || containsTabsNode(node.second, canvasId);
}
