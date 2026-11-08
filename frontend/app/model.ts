// S5-13：选择器与显示数据助手（从 app.ts 拆出，M 轮）
import { fmt } from '../app.utils.js';
import { $ } from './dom.js';
import { clone } from './ui.js';
import { state } from './state.js';
import type { DataHolder, EdgeItem, NodeItem, SpecRec } from './types.js';

  export function activeTab(): string {
    const group = $('.panel-group.active')?.dataset.group || 'inspect';
    if (group === 'fn') return state.fnRole === 'edge' ? 'edge-fn' : 'node-fn';
    if (group === 'analysis' || group === 'modules' || group === 'workbench') {
      const sub = $('.panel-group.active .group-subnav [data-sub].active');
      if (sub) return sub.dataset.sub as string;
      return group === 'modules' ? 'blocks' : group === 'workbench' ? 'wb-analysis' : 'chart';
    }
    return 'inspect';
  }

  export function modeLabel(mode: string): string {
    if (mode === 'circuit') return '电路';
    if (mode === 'vector') return '矢量';
    return '信号流';
  }

  export function selectedNode(): NodeItem | null {
    return state.selection.type === 'node' ? nodeById(state.selection.id) : null;
  }

  export function selectedEdge(): EdgeItem | null {
    return state.selection.type === 'edge' ? edgeById(state.selection.id) : null;
  }

  export function nodeById(id: string | null): NodeItem | null {
    return state.scene?.nodes?.find((node) => node.id === id) || null;
  }

  export function edgeById(id: string | null): EdgeItem | null {
    return state.scene?.edges?.find((edge) => edge.id === id) || null;
  }

  export function nodeByName(name: string): NodeItem | null {
    return state.scene?.nodes?.find((node) => node.name === name) || null;
  }

  export function edgeByName(name: string): EdgeItem | null {
    return state.scene?.edges?.find((edge) => edge.name === name) || null;
  }

  export function getNodeSpec(kind: string): SpecRec | null {
    if (!state.catalog) return null;
    const list = state.mode === 'circuit' ? state.catalog.circuit_nodes : state.catalog.computes;
    return (list || []).find((spec: SpecRec) => spec.kind === kind) || null;
  }

  export function getEdgeSpec(kind: string): SpecRec | null {
    if (!state.catalog) return null;
    const list = state.mode === 'circuit' ? state.catalog.elements : state.catalog.methods;
    return (list || []).find((spec: SpecRec) => spec.kind === kind) || null;
  }

  export function specDefaults(spec: SpecRec | null): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    if (!spec || !Array.isArray(spec.params)) return result;
    for (const param of spec.params) {
      result[param.key] = clone(param.default);
    }
    return result;
  }

  export function uniqueNodeName(base: string): string {
    const names = new Set((state.scene?.nodes || []).map((node) => node.name));
    let index = 1;
    let candidate = `${base}${index}`;
    while (names.has(candidate)) {
      index += 1;
      candidate = `${base}${index}`;
    }
    return candidate.slice(0, 32);
  }

  export function hasGroundNode(): boolean {
    return (state.scene?.nodes || []).some((node) => node.kind === 'ground');
  }

  export function displayDataFor(record: DataHolder, liveMap: Map<string, Record<string, unknown>>) {
    const merged = Object.assign({}, record?.data || {});
    const live = liveMap.get((record?.name as string));
    if (live) {
      for (const [key, value] of Object.entries(live)) {
        if (typeof value === 'number' && Number.isFinite(value)) merged[key] = value;
      }
    }
    return merged;
  }

  export function nodeDisplayData(node: NodeItem) {
    return displayDataFor(node, state.nodeValues);
  }

  export function edgeDisplayData(edge: EdgeItem) {
    const merged = Object.assign({}, edge?.output || {}, edge?.state || {}) as Record<string, number>;
    const live = state.edgeValues.get(edge?.name);
    if (live) {
      for (const [key, value] of Object.entries(live)) {
        if (typeof value === 'number' && Number.isFinite(value)) merged[key] = value;
      }
    }
    return merged;
  }

  /* ======================================================================
   * 3. 画布尺寸、视图变换与渲染
   * ==================================================================== */

