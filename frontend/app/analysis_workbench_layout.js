import { emptyLayout, normalizeLayout } from "./analysis_workbench_layout_tree.js";
const WORKBENCH_SCHEMA = "netlab-analysis-workbench/2";
const LEGACY_WORKBENCH_SCHEMA = "netlab-analysis-workbench/1";
const WORKBENCH_KINDS = ["bode", "time", "nyquist", "loop", "loop_closed", "loop_step", "step_open", "nyquist_closed"];
function defaultWorkbenchUi() {
  return {
    schema: WORKBENCH_SCHEMA,
    active_analysis: "bode",
    canvases: [],
    layout: emptyLayout(),
    sizes: { sidebar: 280, detail: 320 },
    collapsed: { sidebar: false, detail: false },
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
    ...view ? { view_state: view } : {},
    ...typeof value.result_key === "string" && value.result_key ? { result_key: value.result_key } : {},
    ...Array.isArray(value.result_keys) ? { result_keys: value.result_keys.filter((item) => typeof item === "string" && item !== "") } : {}
  };
}
function readWorkbenchUi(value) {
  const ui = defaultWorkbenchUi();
  if (!isRecord(value)) return { ui, restored: false };
  const source = value;
  let restored = source.schema === WORKBENCH_SCHEMA;
  const seen = /* @__PURE__ */ new Set();
  const canvases = [];
  if (Array.isArray(source.canvases)) {
    source.canvases.forEach((item, index) => {
      const rec = normalizeCanvas(item, index);
      if (!rec || seen.has(rec.canvas_id)) return;
      seen.add(rec.canvas_id);
      rec.slot_id = canvases.length;
      canvases.push(rec);
    });
  }
  ui.canvases = canvases;
  ui.active_analysis = asKind(source.active_analysis) || "bode";
  const legacy = source.schema === LEGACY_WORKBENCH_SCHEMA || isRecord(source.layout) && !Array.isArray(source.layout.tabs);
  ui.layout = normalizeLayout(source.layout, canvases.map((canvas) => canvas.canvas_id), legacy);
  if (isRecord(source.sizes)) {
    ui.sizes = {
      sidebar: integer(source.sizes.sidebar, 280, 160, 640),
      detail: integer(source.sizes.detail, 320, 200, 720)
    };
  }
  if (isRecord(source.collapsed)) {
    ui.collapsed = {
      sidebar: source.collapsed.sidebar === true,
      detail: source.collapsed.detail === true
    };
  }
  if (Array.isArray(source.selected_state_ids)) {
    ui.selected_state_ids = [...new Set(source.selected_state_ids.filter((item) => typeof item === "string" && item !== ""))].slice(0, 8);
  }
  if (!restored && Array.isArray(source.canvases) && source.canvases.length) restored = true;
  return { ui, restored };
}
function writeWorkbenchUi(value) {
  return readWorkbenchUi(value).ui;
}
export {
  LEGACY_WORKBENCH_SCHEMA,
  WORKBENCH_KINDS,
  WORKBENCH_SCHEMA,
  defaultWorkbenchUi,
  readWorkbenchUi,
  writeWorkbenchUi
};
