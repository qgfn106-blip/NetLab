const WORKBENCH_SCHEMA = "netlab-analysis-workbench/1";
const WORKBENCH_KINDS = ["bode", "time", "nyquist", "loop", "metrics", "poles", "loop_closed", "loop_step"];
const WORKBENCH_LAYOUT_MODES = ["grid", "tile", "split", "max"];
function defaultWorkbenchUi() {
  return {
    schema: WORKBENCH_SCHEMA,
    active_analysis: "bode",
    canvases: [],
    layout: { mode: "grid", rows: 1, cols: 1, order: [] },
    sizes: { sidebar: 280, detail: 320 },
    selected_state_ids: []
  };
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asKind(value) {
  return WORKBENCH_KINDS.includes(value) ? value : null;
}
function integer(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}
function normalizeCanvas(value, index) {
  if (!isRecord(value)) return null;
  const kind = asKind(value.kind);
  const id = typeof value.canvas_id === "string" ? value.canvas_id.trim() : "";
  if (!kind || !id) return null;
  const view = isRecord(value.view_state) ? value.view_state : void 0;
  return {
    canvas_id: id,
    kind,
    figure_id: typeof value.figure_id === "string" && value.figure_id ? value.figure_id : "f1",
    slot_id: integer(value.slot_id, index, 0, 63),
    title: typeof value.title === "string" && value.title ? value.title : "",
    ...view ? { view_state: view } : {}
  };
}
function readWorkbenchUi(value) {
  const ui = defaultWorkbenchUi();
  if (!isRecord(value)) return { ui, restored: false };
  const source = value;
  const seen = /* @__PURE__ */ new Set();
  const canvases = [];
  if (Array.isArray(source.canvases)) {
    for (const [index, item] of source.canvases.entries()) {
      const canvas = normalizeCanvas(item, index);
      if (!canvas || seen.has(canvas.canvas_id)) continue;
      seen.add(canvas.canvas_id);
      canvases.push(canvas);
    }
  }
  ui.canvases = canvases;
  const active = asKind(source.active_analysis);
  ui.active_analysis = active || canvases[0]?.kind || "bode";
  const layout = isRecord(source.layout) ? source.layout : {};
  if (WORKBENCH_LAYOUT_MODES.includes(layout.mode)) {
    ui.layout.mode = layout.mode;
  }
  ui.layout.rows = integer(layout.rows, 1, 1, 8);
  ui.layout.cols = integer(layout.cols, 1, 1, 8);
  const order = Array.isArray(layout.order) ? layout.order.filter((id) => typeof id === "string" && seen.has(id)) : [];
  ui.layout.order = order.length ? order : canvases.map((canvas) => canvas.canvas_id);
  const sizes = isRecord(source.sizes) ? source.sizes : {};
  ui.sizes.sidebar = integer(sizes.sidebar, 280, 160, 640);
  ui.sizes.detail = integer(sizes.detail, 320, 200, 720);
  if (Array.isArray(source.selected_state_ids)) {
    ui.selected_state_ids = [...new Set(source.selected_state_ids.filter((id) => typeof id === "string" && id !== ""))].slice(0, 8);
  }
  return { ui, restored: true };
}
function writeWorkbenchUi(value) {
  return readWorkbenchUi(value).ui;
}
export {
  WORKBENCH_KINDS,
  WORKBENCH_LAYOUT_MODES,
  WORKBENCH_SCHEMA,
  defaultWorkbenchUi,
  readWorkbenchUi,
  writeWorkbenchUi
};
