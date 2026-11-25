import { ENDPOINTS } from "./endpoints.js";
import { applySnapshot } from "./store.js";
import { state } from "./state.js";
import { toast } from "./desktop.js";
import { openConfirmModal as confirmModal } from "./dialogs_build.js";
import { jsonRequest } from "./net.js";
import { requestDraw } from "./canvas_render.js";
import { captureSceneSnapshot } from "./ui_helpers.js";
import { markProjectDirty } from "./project.js";
let deps;
function initCommands(d) {
  deps = d;
}
function clearSelection() {
  state.selection = { type: null, id: null };
  state.inspectorId = null;
  state.inspectorDirty = false;
  state.multi.nodes.clear();
  state.multi.edges.clear();
  deps.renderInspector();
  requestDraw();
}
function multiSelection() {
  const nodes = new Set(state.multi?.nodes || []);
  const edges = new Set(state.multi?.edges || []);
  if (state.selection.type === "node" && state.selection.id) nodes.add(state.selection.id);
  if (state.selection.type === "edge" && state.selection.id) edges.add(state.selection.id);
  return { nodes, edges };
}
function toggleMultiSelection(type, id) {
  if (type === "node") {
    if (state.multi.nodes.has(id)) state.multi.nodes.delete(id);
    else state.multi.nodes.add(id);
  } else if (type === "edge") {
    if (state.multi.edges.has(id)) state.multi.edges.delete(id);
    else state.multi.edges.add(id);
  }
  if (state.multi.nodes.size + state.multi.edges.size === 1) {
    const onlyNode = state.multi.nodes.values().next().value;
    const onlyEdge = state.multi.edges.values().next().value;
    if (onlyNode) void deps.selectEntity("node", onlyNode);
    else if (onlyEdge) void deps.selectEntity("edge", onlyEdge);
  } else {
    requestDraw();
  }
  toast(`\u5DF2\u9009 ${state.multi.nodes.size} \u8282\u70B9 / ${state.multi.edges.size} \u8FDE\u63A5`, "info", 1600);
}
function selectAll() {
  state.multi.nodes = new Set((state.scene?.nodes || []).map((node) => node.id));
  state.multi.edges = new Set((state.scene?.edges || []).map((edge) => edge.id));
  requestDraw();
  toast(`\u5DF2\u5168\u9009 ${state.multi.nodes.size} \u8282\u70B9 / ${state.multi.edges.size} \u8FDE\u63A5`, "info", 1800);
}
function clipboardPayload() {
  const { nodes, edges } = multiSelection();
  if (!nodes.size && !edges.size) return null;
  const nodeSet = new Set(nodes);
  const edgeList = (state.scene?.edges || []).filter(
    (edge) => edges.has(edge.id) || nodeSet.has(edge.source) && nodeSet.has(edge.target)
  );
  return {
    networkId: state.currentNetwork?.id || "",
    nodes: (state.scene?.nodes || []).filter((node) => nodeSet.has(node.id)).map((node) => JSON.parse(JSON.stringify(node))),
    edges: edgeList.map((edge) => JSON.parse(JSON.stringify(edge)))
  };
}
function copySelection(cut = false) {
  const payload = clipboardPayload();
  if (!payload) {
    toast("\u5148\u5728\u753B\u5E03\u4E0A\u9009\u62E9\u8282\u70B9\u6216\u8FDE\u7EBF\uFF08Ctrl+\u5355\u51FB / Ctrl+\u62D6\u6846\uFF09", "info", 2600);
    return;
  }
  state.clipboard = payload;
  if (cut) {
    void deps.deleteSelection();
    toast(`\u5DF2\u526A\u5207 ${payload.nodes.length} \u8282\u70B9 / ${payload.edges.length} \u8FDE\u63A5`, "ok", 2200);
  } else {
    toast(`\u5DF2\u590D\u5236 ${payload.nodes.length} \u8282\u70B9 / ${payload.edges.length} \u8FDE\u63A5`, "ok", 2200);
  }
}
function uniquePasteName(base, reserved) {
  const existing = new Set((state.scene?.nodes || []).map((node) => node.name));
  let candidate = `${String(base || "node").slice(0, 24)}_copy`;
  let index = 2;
  while (existing.has(candidate) || reserved.has(candidate)) {
    candidate = `${String(base || "node").slice(0, 22)}_c${index++}`;
  }
  reserved.add(candidate);
  return candidate.slice(0, 32);
}
async function pasteClipboard() {
  const clipboard = state.clipboard;
  if (!clipboard || !clipboard.nodes.length && !clipboard.edges.length) {
    toast("\u526A\u8D34\u677F\u4E3A\u7A7A\uFF1A\u5148 Ctrl+C \u590D\u5236\u9009\u4E2D\u5BF9\u8C61", "info", 2400);
    return;
  }
  if (clipboard.networkId && clipboard.networkId !== (state.currentNetwork?.id || "")) {
    const confirmed = await confirmModal(
      "\u8DE8\u7F51\u7EDC\u7C98\u8D34\uFF1F",
      "\u526A\u8D34\u677F\u6765\u81EA\u53E6\u4E00\u4E2A\u7F51\u7EDC\u3002\u8FDE\u63A5\u4E0E\u53C2\u6570\u4F1A\u4FDD\u7559\u7ED1\u5B9A\uFF0C\u4F46\u8DE8\u5C42\u8BED\u4E49\u8BF7\u81EA\u884C\u786E\u8BA4\u3002",
      "\u7C98\u8D34",
      false
    );
    if (!confirmed) return;
  }
  const offset = 28;
  await pushUndoSnapshot();
  const reserved = /* @__PURE__ */ new Set();
  const idMap = /* @__PURE__ */ new Map();
  const pastedNodeIds = [];
  const pastedEdgeIds = [];
  let nodesCreated = 0;
  let edgesCreated = 0;
  for (const node of clipboard.nodes) {
    const payload = {
      name: uniquePasteName(node.name, reserved),
      kind: node.kind,
      params: node.params || {},
      data: node.data || {},
      position: {
        x: (Number(node.position?.x) || 0) + offset,
        y: (Number(node.position?.y) || 0) + offset
      },
      size: node.size || {}
    };
    const response = await deps.task(() => jsonRequest(ENDPOINTS.nodes, "POST", payload), { history: false });
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
      () => jsonRequest(ENDPOINTS.edges, "POST", {
        source,
        target,
        kind: edge.kind,
        params: edge.params || {},
        delay: Boolean(edge.delay),
        enabled: edge.enabled !== false,
        auto_delay: false,
        route: edge.route || "auto",
        waypoints: edge.waypoints || [],
        anchors: edge.anchors || {}
      }),
      { history: false }
    );
    if (response) {
      pastedEdgeIds.push(response.id || response.edge?.id || "");
      edgesCreated += 1;
    }
  }
  await deps.refreshState(true);
  state.multi.nodes = new Set(pastedNodeIds);
  state.multi.edges = new Set(pastedEdgeIds.filter(Boolean));
  state.selection = pastedNodeIds.length ? { type: "node", id: pastedNodeIds[0] } : { type: null, id: null };
  requestDraw();
  toast(`\u5DF2\u7C98\u8D34 ${nodesCreated} \u8282\u70B9 / ${edgesCreated} \u8FDE\u63A5`, "ok", 2600);
}
async function pushUndoSnapshot() {
  const snapshot = await captureSceneSnapshot();
  if (!snapshot) return;
  state.undoStack.push(snapshot);
  if (state.undoStack.length > 100) state.undoStack.shift();
  state.redoStack.length = 0;
}
async function restoreSceneSnapshot(payload) {
  const current = await captureSceneSnapshot();
  const merged = { ...payload, blocks: current?.blocks || [] };
  await jsonRequest(ENDPOINTS.control, "POST", { action: "pause" });
  const response = await jsonRequest(ENDPOINTS.scene, "POST", merged);
  if (!response?.scene) return;
  clearSelection();
  applySnapshot(response);
  deps.renderInspector();
  markProjectDirty();
}
async function undo() {
  const snapshot = state.undoStack.pop();
  if (!snapshot) {
    toast("\u6CA1\u6709\u53EF\u64A4\u9500\u7684\u64CD\u4F5C", "info", 2e3);
    return;
  }
  const current = await captureSceneSnapshot();
  if (current) state.redoStack.push(current);
  await deps.task(() => restoreSceneSnapshot(snapshot), { dirty: true, history: false });
  toast("\u5DF2\u64A4\u9500", "ok", 1600);
}
async function redo() {
  const snapshot = state.redoStack.pop();
  if (!snapshot) {
    toast("\u6CA1\u6709\u53EF\u91CD\u505A\u7684\u64CD\u4F5C", "info", 2e3);
    return;
  }
  const current = await captureSceneSnapshot();
  if (current) state.undoStack.push(current);
  await deps.task(() => restoreSceneSnapshot(snapshot), { dirty: true, history: false });
  toast("\u5DF2\u91CD\u505A", "ok", 1600);
}
export {
  clearSelection,
  copySelection,
  initCommands,
  multiSelection,
  pasteClipboard,
  pushUndoSnapshot,
  redo,
  selectAll,
  toggleMultiSelection,
  undo
};
