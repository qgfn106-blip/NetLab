import { createAnalysisChart } from "./analysis_chart.js";
import { KIND_LABELS } from "./analysis_workbench_meta.js";
function newCanvasId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch (error) {
  }
  return "canvas-" + Date.now().toString(36) + "-" + Math.random().toString(16).slice(2, 10);
}
class AnalysisCanvasWorkspace {
  constructor(host, detailHost, saved, layout, events) {
    this.entries = [];
    this.activeId = "";
    this.layoutMode = "grid";
    this.host = host;
    this.detailHost = detailHost;
    this.events = events;
    this.root = document.createElement("div");
    this.root.className = "awb-canvas-grid";
    this.host.append(this.root);
    this.setLayout(layout, false);
    for (const rec of saved) this.addCanvas(rec);
    if (saved.length) this.activate(saved[0].canvas_id);
  }
  get canvases() {
    return this.entries.map((entry) => ({ ...entry.rec }));
  }
  get activeCanvasId() {
    return this.activeId;
  }
  /** 当前活动画布的分析类型；无活动画布时返回 null（空选择状态）。 */
  get activeKind() {
    const entry = this.entries.find((item) => item.rec.canvas_id === this.activeId);
    return entry ? entry.rec.kind : null;
  }
  /** 当前活动画布的登记记录；无活动画布时返回 null。 */
  get activeCanvas() {
    const entry = this.entries.find((item) => item.rec.canvas_id === this.activeId);
    return entry ? { ...entry.rec } : null;
  }
  hasKind(kind) {
    return this.entries.some((entry) => entry.rec.kind === kind);
  }
  hasCanvas(canvasId) {
    return this.entries.some((entry) => entry.rec.canvas_id === canvasId);
  }
  activateKind(kind) {
    const existing = this.entries.find((entry) => entry.rec.kind === kind);
    if (existing) {
      this.activate(existing.rec.canvas_id);
      return existing.rec.canvas_id;
    }
    const rec = {
      canvas_id: newCanvasId(),
      kind,
      figure_id: "f1",
      slot_id: this.entries.length,
      title: KIND_LABELS[kind]
    };
    this.addCanvas(rec);
    this.activate(rec.canvas_id);
    return rec.canvas_id;
  }
  activate(canvasId) {
    if (!this.entries.some((entry) => entry.rec.canvas_id === canvasId)) return;
    if (this.activeId === canvasId) {
      this.applyActiveClass();
      return;
    }
    const previous = this.entries.find((entry) => entry.rec.canvas_id === this.activeId);
    previous?.chart.setDetailHost(null);
    this.activeId = canvasId;
    this.applyActiveClass();
    const current = this.entries.find((entry) => entry.rec.canvas_id === canvasId);
    current?.chart.setDetailHost(this.detailHost);
    this.events.onChange?.();
  }
  closeCanvas(canvasId) {
    const index = this.entries.findIndex((entry2) => entry2.rec.canvas_id === canvasId);
    if (index < 0) return;
    const [entry] = this.entries.splice(index, 1);
    entry.chart.destroy();
    entry.tile.remove();
    if (this.activeId === canvasId) {
      this.activeId = "";
      const next = this.entries[Math.max(0, index - 1)];
      if (next) this.activate(next.rec.canvas_id);
    }
    this.applyActiveClass();
    this.events.onChange?.();
  }
  setLayout(mode, notify = true) {
    this.layoutMode = mode;
    this.root.dataset.layout = mode;
    if (mode === "max" && this.activeId) this.root.dataset.active = this.activeId;
    if (notify) this.events.onChange?.();
  }
  get layout() {
    return this.layoutMode;
  }
  setEnvelope(canvasId, envelope, resultKey, resultKeys) {
    const entry = this.entries.find((item) => item.rec.canvas_id === canvasId);
    if (!entry) return;
    const savedView = entry.viewState;
    entry.chart.setEnvelope(envelope);
    entry.rec.result_key = resultKey;
    entry.rec.result_keys = resultKeys && resultKeys.length ? resultKeys : void 0;
    if (savedView) {
      entry.chart.applyViewState(savedView);
      entry.viewState = void 0;
    }
  }
  /** 清除所有子画布结果（状态/参数变化后防止旧曲线冒充新结果）。 */
  clearAllEnvelopes() {
    for (const entry of this.entries) {
      entry.chart.setEnvelope(null);
      entry.rec.result_key = void 0;
      entry.rec.result_keys = void 0;
      entry.viewState = void 0;
    }
  }
  setCursor(frequency, sourceCanvasId = "", unit = "", axisKey = "") {
    for (const entry of this.entries) {
      if (entry.rec.canvas_id === sourceCanvasId) continue;
      entry.chart.setCursorFrequency(frequency, "linked", unit, axisKey);
    }
  }
  refreshActiveDetail() {
    const active = this.entries.find((entry) => entry.rec.canvas_id === this.activeId);
    active?.chart.setDetailHost(this.detailHost);
  }
  persist() {
    return this.entries.map((entry) => {
      const view = entry.chart.getViewState() || entry.viewState;
      return {
        ...entry.rec,
        ...view ? { view_state: view } : {}
      };
    });
  }
  destroy() {
    for (const entry of this.entries) entry.chart.destroy();
    this.entries.length = 0;
    this.root.remove();
  }
  addCanvas(rec) {
    const tile = document.createElement("section");
    tile.className = "awb-canvas-tile";
    tile.dataset.canvasId = rec.canvas_id;
    const head = document.createElement("header");
    head.className = "awb-canvas-head";
    const title = document.createElement("span");
    title.className = "awb-canvas-title";
    title.textContent = rec.title || KIND_LABELS[rec.kind];
    const chip = document.createElement("span");
    chip.className = "awb-canvas-chip";
    chip.textContent = KIND_LABELS[rec.kind];
    const spacer = document.createElement("span");
    spacer.className = "awb-canvas-spacer";
    const max = document.createElement("button");
    max.type = "button";
    max.className = "awb-canvas-btn";
    max.title = "\u6700\u5927\u5316/\u8FD8\u539F\u6B64\u5B50\u753B\u5E03";
    max.textContent = "\u2922";
    max.addEventListener("click", (event) => {
      event.stopPropagation();
      this.activate(rec.canvas_id);
      this.setLayout(this.layoutMode === "max" ? "grid" : "max");
    });
    const close = document.createElement("button");
    close.type = "button";
    close.className = "awb-canvas-btn";
    close.title = "\u5173\u95ED\u5B50\u753B\u5E03\uFF08\u4ECE\u5DE6\u4FA7\u5BFC\u822A\u53EF\u91CD\u5F00\uFF09";
    close.textContent = "\xD7";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      this.closeCanvas(rec.canvas_id);
    });
    head.append(title, chip, spacer, max, close);
    const body = document.createElement("div");
    body.className = "awb-canvas-body";
    tile.append(head, body);
    tile.addEventListener("pointerdown", () => this.activate(rec.canvas_id));
    this.root.append(tile);
    const chart = createAnalysisChart(body, {
      title: rec.title || KIND_LABELS[rec.kind],
      detailHost: null,
      events: {
        onCursor: (frequency, source, unit, axisKey) => this.events.onCursor?.(frequency, source, rec.canvas_id, unit, axisKey),
        onPin: () => this.events.onPin?.(rec.canvas_id),
        onViewChange: () => this.events.onChange?.()
      }
    });
    this.entries.push({ rec: { ...rec, title: rec.title || KIND_LABELS[rec.kind] }, tile, body, chart, viewState: rec.view_state });
  }
  applyActiveClass() {
    this.root.dataset.active = this.activeId;
    for (const entry of this.entries) {
      entry.tile.classList.toggle("active", entry.rec.canvas_id === this.activeId);
    }
  }
}
export {
  AnalysisCanvasWorkspace
};
