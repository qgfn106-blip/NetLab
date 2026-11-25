// 行为选择、剪贴板、撤销/重做命令层（由 app.ts 的 S3 抽取；行为等价）。
import { ENDPOINTS } from './endpoints.js';
import { applySnapshot } from './store.js';
import { state } from './state.js';
import { toast } from './desktop.js';
import { openConfirmModal as confirmModal } from './dialogs_build.js';
import { jsonRequest } from './net.js';
import { requestDraw } from './canvas_render.js';
import { captureSceneSnapshot } from './ui_helpers.js';
import { markProjectDirty } from './project.js';
import type { ClipboardRec } from './types.js';

export interface CommandsDeps {
  task<T>(run: () => T | Promise<T>, options?: { dirty?: boolean; history?: boolean; silent?: boolean }): Promise<T | null>;
  selectEntity(type: string | null, id: string | null, force?: boolean): Promise<void>;
  renderInspector(): void;
  deleteSelection(): Promise<void>;
  refreshState(quiet?: boolean): Promise<void>;
}

let deps: CommandsDeps;

export function initCommands(d: CommandsDeps): void {
  deps = d;
}


export function clearSelection() {
  state.selection = { type: null, id: null };
  state.inspectorId = null;
  state.inspectorDirty = false;
  state.multi.nodes.clear();
  state.multi.edges.clear();
  deps.renderInspector();
  requestDraw();
}

export function multiSelection() {
  const nodes = new Set(state.multi?.nodes || []);
  const edges = new Set(state.multi?.edges || []);
  if (state.selection.type === 'node' && state.selection.id) nodes.add(state.selection.id);
  if (state.selection.type === 'edge' && state.selection.id) edges.add(state.selection.id);
  return { nodes, edges };
}

export function toggleMultiSelection(type: string, id: string) {
  if (type === 'node') {
    if (state.multi.nodes.has(id)) state.multi.nodes.delete(id);
    else state.multi.nodes.add(id);
  } else if (type === 'edge') {
    if (state.multi.edges.has(id)) state.multi.edges.delete(id);
    else state.multi.edges.add(id);
  }
  if ((state.multi.nodes.size + state.multi.edges.size) === 1) {
    const onlyNode = state.multi.nodes.values().next().value;
    const onlyEdge = state.multi.edges.values().next().value;
    if (onlyNode) void deps.selectEntity('node', onlyNode);
    else if (onlyEdge) void deps.selectEntity('edge', onlyEdge);
  } else {
    requestDraw();
  }
  toast(`已选 ${state.multi.nodes.size} 节点 / ${state.multi.edges.size} 连接`, 'info', 1600);
}

export function selectAll() {
  state.multi.nodes = new Set((state.scene?.nodes || []).map((node) => node.id));
  state.multi.edges = new Set((state.scene?.edges || []).map((edge) => edge.id));
  requestDraw();
  toast(`已全选 ${state.multi.nodes.size} 节点 / ${state.multi.edges.size} 连接`, 'info', 1800);
}

function clipboardPayload(): ClipboardRec | null {
  const { nodes, edges } = multiSelection();
  if (!nodes.size && !edges.size) return null;
  const nodeSet = new Set(nodes);
  const edgeList = (state.scene?.edges || []).filter(
    (edge) => edges.has(edge.id) || (nodeSet.has(edge.source) && nodeSet.has(edge.target)),
  );
  return {
    networkId: state.currentNetwork?.id || '',
    nodes: (state.scene?.nodes || [])
      .filter((node) => nodeSet.has(node.id))
      .map((node) => JSON.parse(JSON.stringify(node))),
    edges: edgeList.map((edge) => JSON.parse(JSON.stringify(edge))),
  };
}

export function copySelection(cut = false) {
  const payload = clipboardPayload();
  if (!payload) {
    toast('先在画布上选择节点或连线（Ctrl+单击 / Ctrl+拖框）', 'info', 2600);
    return;
  }
  state.clipboard = payload;
  if (cut) {
    void deps.deleteSelection();
    toast(`已剪切 ${payload.nodes.length} 节点 / ${payload.edges.length} 连接`, 'ok', 2200);
  } else {
    toast(`已复制 ${payload.nodes.length} 节点 / ${payload.edges.length} 连接`, 'ok', 2200);
  }
}

function uniquePasteName(base: string, reserved: Set<string>) {
  const existing = new Set((state.scene?.nodes || []).map((node) => node.name));
  let candidate = `${String(base || 'node').slice(0, 24)}_copy`;
  let index = 2;
  while (existing.has(candidate) || reserved.has(candidate)) {
    candidate = `${String(base || 'node').slice(0, 22)}_c${index++}`;
  }
  reserved.add(candidate);
  return candidate.slice(0, 32);
}

export async function pasteClipboard() {
  const clipboard = state.clipboard;
  if (!clipboard || (!clipboard.nodes.length && !clipboard.edges.length)) {
    toast('剪贴板为空：先 Ctrl+C 复制选中对象', 'info', 2400);
    return;
  }
  if (clipboard.networkId && clipboard.networkId !== (state.currentNetwork?.id || '')) {
    const confirmed = await confirmModal(
      '跨网络粘贴？',
      '剪贴板来自另一个网络。连接与参数会保留绑定，但跨层语义请自行确认。',
      '粘贴',
      false,
    );
    if (!confirmed) return;
  }
  const offset = 28;
  await pushUndoSnapshot();
  const reserved = new Set();
  const idMap = new Map();
  const pastedNodeIds: string[] = [];
  const pastedEdgeIds: string[] = [];
  let nodesCreated = 0;
  let edgesCreated = 0;
  for (const node of clipboard.nodes) {
    const payload = {
      name: uniquePasteName(node.name, (reserved as Set<string>)),
      kind: node.kind,
      params: node.params || {},
      data: node.data || {},
      position: {
        x: (Number(node.position?.x) || 0) + offset,
        y: (Number(node.position?.y) || 0) + offset,
      },
      size: node.size || {},
    };
    const response = await deps.task(() => jsonRequest(ENDPOINTS.nodes, 'POST', payload), { history: false });
    if (!response?.node) continue;
    idMap.set(node.id, response.node.id);
    pastedNodeIds.push(response.node.id);
    nodesCreated += 1;
  }
  for (const edge of clipboard.edges) {
    const source = idMap.get(edge.source);
    const target = idMap.get(edge.target);
    if (!source || !target) continue;
    const response = await deps.task(
      () => jsonRequest(ENDPOINTS.edges, 'POST', {
        source,
        target,
        kind: edge.kind,
        params: edge.params || {},
        delay: Boolean(edge.delay),
        enabled: edge.enabled !== false,
        auto_delay: false,
        route: edge.route || 'auto',
        waypoints: edge.waypoints || [],
        anchors: edge.anchors || {},
      }),
      { history: false },
    );
    if (response) {
      pastedEdgeIds.push(response.id || response.edge?.id || '');
      edgesCreated += 1;
    }
  }
  await deps.refreshState(true);
  state.multi.nodes = new Set(pastedNodeIds);
  state.multi.edges = new Set(pastedEdgeIds.filter(Boolean));
  state.selection = pastedNodeIds.length ? { type: 'node', id: pastedNodeIds[0] } : { type: null, id: null };
  requestDraw();
  toast(`已粘贴 ${nodesCreated} 节点 / ${edgesCreated} 连接`, 'ok', 2600);
}


export async function pushUndoSnapshot() {
  const snapshot = await captureSceneSnapshot();
  if (!snapshot) return;
  state.undoStack.push(snapshot);
  if (state.undoStack.length > 100) state.undoStack.shift();
  state.redoStack.length = 0;
}

async function restoreSceneSnapshot(payload: Record<string, unknown>) {
  const current = await captureSceneSnapshot();
  // 库文件（blocks）用当前值：撤销不得复活已删除的库模块（D25）。
  const merged = { ...payload, blocks: current?.blocks || [] };
  await jsonRequest(ENDPOINTS.control, 'POST', { action: 'pause' });
  const response = await jsonRequest(ENDPOINTS.scene, 'POST', merged);
  if (!response?.scene) return;
  clearSelection();
  applySnapshot(response);
  deps.renderInspector();
  markProjectDirty();
}

export async function undo() {
  const snapshot = state.undoStack.pop();
  if (!snapshot) {
    toast('没有可撤销的操作', 'info', 2000);
    return;
  }
  const current = await captureSceneSnapshot();
  if (current) state.redoStack.push(current);
  await deps.task(() => restoreSceneSnapshot((snapshot as Record<string, unknown>)), { dirty: true, history: false });
  toast('已撤销', 'ok', 1600);
}

export async function redo() {
  const snapshot = state.redoStack.pop();
  if (!snapshot) {
    toast('没有可重做的操作', 'info', 2000);
    return;
  }
  const current = await captureSceneSnapshot();
  if (current) state.undoStack.push(current);
  await deps.task(() => restoreSceneSnapshot((snapshot as Record<string, unknown>)), { dirty: true, history: false });
  toast('已重做', 'ok', 1600);
}
