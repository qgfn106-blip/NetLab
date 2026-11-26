import { state } from "./state.js";
let deps = null;
function initSessionStore(next) {
  deps = next;
}
function store() {
  if (!deps) throw new Error("SessionStore \u5C1A\u672A\u521D\u59CB\u5316");
  return deps;
}
function applySnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || !snapshot.scene) return;
  const sim = snapshot.sim || state.sim;
  const previousCursor = state.cursor;
  const resetFrames = !state.sim || sim && sim.steps === 0 && sim.time === 0;
  state.scene = snapshot.scene;
  state.sim = sim;
  const nextRevision = snapshot.scene.revision ?? null;
  if (resetFrames || state.precomputedRevision != null && nextRevision !== state.precomputedRevision) {
    state.precomputedSeconds = null;
    state.precomputedRevision = null;
  }
  if (snapshot.limits) state.limits = snapshot.limits;
  state.mode = state.scene.mode || state.mode;
  if (resetFrames || sim && Number(sim.cursor) < previousCursor) {
    state.frames = [];
    state.values.clear();
    state.nodeValues.clear();
    state.edgeValues.clear();
    state.cursor = Number(sim?.cursor) || 0;
    store().scheduleChartDraw();
  }
  if (state.selection.type && !lookupSelection()) {
    store().clearSelection();
  }
  const liveNodes = new Set((state.scene?.nodes || []).map((node) => node.id));
  const liveEdges = new Set((state.scene?.edges || []).map((edge) => edge.id));
  let staleSelection = false;
  for (const id of [...state.multi?.nodes || []]) {
    if (!liveNodes.has(id)) {
      state.multi.nodes.delete(id);
      staleSelection = true;
    }
  }
  for (const id of [...state.multi?.edges || []]) {
    if (!liveEdges.has(id)) {
      state.multi.edges.delete(id);
      staleSelection = true;
    }
  }
  if (staleSelection) store().requestDraw();
  store().updateModeUI();
  store().syncUI();
  store().updateInfoBar();
  const degraded = sim && sim.degraded;
  if (degraded && degraded.read_only) {
    const missing = (degraded.missing || []).map((item) => `${item.id}@v${item.version}`).join("\u3001");
    store().showBanner(`\u964D\u7EA7\u53EA\u8BFB\uFF1A${degraded.message}${missing ? `\uFF08\u7F3A\u5931\uFF1A${missing}\uFF09` : ""}`);
    state.degradedBanner = true;
  } else if (state.degradedBanner) {
    state.degradedBanner = false;
    store().hideBanner();
  }
  store().updateScenePanelValues();
  store().updateSignalKeyCache();
  store().requestDraw();
  store().updateInspectorLive();
  store().renderVectorNodeList();
  store().schedulePhaseDraw();
}
function lookupSelection() {
  if (state.selection.type === "node") return store().nodeById(state.selection.id);
  if (state.selection.type === "edge") return store().edgeById(state.selection.id);
  return null;
}
export {
  applySnapshot,
  initSessionStore,
  lookupSelection
};
