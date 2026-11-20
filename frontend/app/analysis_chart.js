import {
  MARKER_COLORS,
  MARKER_SYMBOLS,
  asNumber,
  axisAt,
  categoryLabel,
  clampRange,
  drawNyquistDirections,
  escapeDetailHtml,
  fmtFrequency,
  markerSummary,
  nyquistExtras,
  pointSummary,
  renderAnalysisDetail,
  zoomRange
} from "./analysis_chart_detail.js";
import { loadPlot2D } from "./analysis_chart_plot.js";
function paddedRange(lo, hi, fraction = 0.05) {
  const [a, b] = clampRange(lo, hi);
  const span = b - a;
  return [a - span * fraction, b + span * fraction];
}
function logSafeRange(lo, hi) {
  if (!(lo > 0) || !(hi > 0)) return [1, 10];
  const la = Math.log10(lo) - 0.02;
  const lb = Math.log10(hi) + 0.02;
  return [Math.pow(10, la), Math.pow(10, lb)];
}
function isAnalysisEnvelope(value) {
  if (!value || typeof value !== "object") return false;
  const rec = value;
  return rec.schema === "netlab-analysis-result/1" && typeof rec.kind === "string" && Array.isArray(rec.axes) && Array.isArray(rec.curves) && Array.isArray(rec.markers);
}
class AnalysisChart {
  constructor(host, options = {}) {
    this.envelope = null;
    this.api = null;
    this.renderResult = null;
    this.width = 0;
    this.height = 0;
    this.view = null;
    this.visibleCategories = /* @__PURE__ */ new Set();
    this.pinned = null;
    this.hovered = null;
    this.hoverPoint = null;
    this.cursorFrequency = null;
    this.cursorSource = "";
    this.boxZoom = false;
    this.drag = null;
    this.resizeObserver = null;
    this.frame = 0;
    this.destroyed = false;
    this.host = host;
    this.options = options;
    this.detailHost = options.detailHost || null;
    this.host.classList.add("analysis-chart-host");
    this.host.innerHTML = "";
    this.toolbar = document.createElement("div");
    this.toolbar.className = "analysis-chart-toolbar";
    this.canvasWrap = document.createElement("div");
    this.canvasWrap.className = "analysis-chart-canvas-wrap";
    this.canvas = document.createElement("canvas");
    this.canvas.className = "analysis-chart-canvas";
    this.canvas.setAttribute("aria-label", options.title || "\u5206\u6790\u66F2\u7EBF");
    this.overlay = document.createElement("canvas");
    this.overlay.className = "analysis-chart-overlay";
    this.tooltip = document.createElement("div");
    this.tooltip.className = "analysis-chart-tooltip";
    this.tooltip.hidden = true;
    this.readout = document.createElement("div");
    this.readout.className = "analysis-chart-readout";
    this.readout.textContent = "\u7B49\u5F85\u5206\u6790\u7ED3\u679C\u2026";
    this.canvasWrap.append(this.canvas, this.overlay, this.tooltip);
    this.host.append(this.toolbar, this.canvasWrap, this.readout);
    this.bindEvents();
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.scheduleRender());
      this.resizeObserver.observe(this.canvasWrap);
    }
    void loadPlot2D().then((api) => {
      this.api = api;
      if (!api) {
        this.readout.textContent = "PlotKit \u6E32\u67D3\u5185\u6838\u672A\u52A0\u8F7D\uFF1A\u5206\u6790\u56FE\u4E0D\u53EF\u7528\uFF08\u8BF7\u68C0\u67E5\u63D2\u4EF6\u5B89\u88C5\uFF09\u3002";
        return;
      }
      this.scheduleRender();
    });
  }
  setEnvelope(envelope) {
    this.envelope = envelope;
    this.pinned = null;
    this.hovered = null;
    this.view = null;
    this.visibleCategories = new Set((envelope?.markers || []).map((marker) => marker.category));
    this.canvasWrap.classList.toggle("is-nyquist", envelope?.kind === "nyquist");
    if (envelope) this.readout.textContent = "\u6EDA\u8F6E\u7F29\u653E \xB7 \u62D6\u62FD\u5E73\u79FB \xB7 Shift+\u62D6\u62FD\u6846\u9009 \xB7 \u53CC\u51FB\u590D\u4F4D";
    this.renderToolbar();
    this.renderDetail();
    this.scheduleRender();
  }
  getEnvelope() {
    return this.envelope;
  }
  /** 切换右侧详情栏归属（多子画布时只有当前子画布写入详情）。 */
  setDetailHost(host) {
    this.detailHost = host;
    if (host) this.renderDetail();
  }
  getViewState() {
    if (!this.envelope) return null;
    const view = this.view || this.baseView(this.envelope);
    return {
      xlim: [view.xlim[0], view.xlim[1]],
      ylims: Object.fromEntries(Object.entries(view.ylims).map(([slot, range]) => [slot, [range[0], range[1]]])),
      visible_categories: [...this.visibleCategories],
      pinned_marker_id: this.pinned?.id || null
    };
  }
  applyViewState(state) {
    if (!this.envelope || !state || typeof state !== "object") return false;
    const rec = state;
    const xlim = Array.isArray(rec.xlim) ? rec.xlim : null;
    if (!xlim || xlim.length !== 2 || !xlim.every((value) => Number.isFinite(value)) || !(xlim[0] < xlim[1])) return false;
    const ylims = {};
    const sourceYlims = rec.ylims && typeof rec.ylims === "object" ? rec.ylims : {};
    for (const [slot, range] of Object.entries(sourceYlims)) {
      if (!Array.isArray(range) || range.length !== 2 || !range.every((value) => Number.isFinite(value)) || !(range[0] < range[1])) continue;
      ylims[Number(slot)] = [range[0], range[1]];
    }
    this.view = { xlim: [xlim[0], xlim[1]], ylims };
    const wanted = Array.isArray(rec.visible_categories) ? rec.visible_categories.filter((item) => typeof item === "string") : [];
    this.visibleCategories = wanted.length ? new Set(wanted) : new Set((this.envelope.markers || []).map((marker) => marker.category));
    const pinnedId = typeof rec.pinned_marker_id === "string" ? rec.pinned_marker_id : "";
    this.pinned = pinnedId ? (this.envelope.markers || []).find((marker) => marker.id === pinnedId) || null : null;
    this.renderToolbar();
    this.renderDetail();
    this.scheduleRender();
    return true;
  }
  /** 外部（工作台状态切换/删除）导致详情栏需要重绘时调用。 */
  refreshDetail() {
    this.renderDetail();
  }
  /** 当前信封主 x 轴的物理单位（无则空串）。游标跨画布同步时用于校验轴兼容性。 */
  xUnit() {
    return this.envelope?.axes?.[0]?.unit || "";
  }
  /** 主 x 轴的稳定身份（单位|轴 id）；空单位轴也各有身份，避免 Hz/秒/无量纲互串。 */
  xAxisKey() {
    const axis = this.envelope?.axes?.[0];
    return axis ? (axis.unit || "") + "|" + axis.id : "";
  }
  setCursorFrequency(frequency, source = "external", unit = "", axisKey = "") {
    if (frequency !== null) {
      const targetKey = this.xAxisKey();
      if (!axisKey || !targetKey || axisKey !== targetKey) return;
    }
    this.cursorFrequency = frequency;
    this.cursorSource = source;
    this.drawOverlay();
  }
  resetView() {
    this.view = this.envelope ? this.baseView(this.envelope) : null;
    this.scheduleRender();
    this.notifyView();
  }
  destroy() {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.host.innerHTML = "";
  }
  bindEvents() {
    this.canvasWrap.addEventListener("wheel", (event) => this.onWheel(event), { passive: false });
    this.canvasWrap.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    this.canvasWrap.addEventListener("pointermove", (event) => this.onPointerMove(event));
    this.canvasWrap.addEventListener("pointerup", (event) => this.onPointerUp(event));
    this.canvasWrap.addEventListener("pointercancel", (event) => this.onPointerUp(event));
    this.canvasWrap.addEventListener("pointerleave", () => {
      this.tooltip.hidden = true;
      this.hovered = null;
      this.hoverPoint = null;
      this.cursorFrequency = null;
      this.cursorSource = "";
      this.drawOverlay();
      this.options.events?.onCursor?.(null, "chart", this.xUnit(), this.xAxisKey());
    });
    this.canvasWrap.addEventListener("dblclick", () => this.resetView());
  }
  renderToolbar() {
    this.toolbar.innerHTML = "";
    const title = document.createElement("span");
    title.className = "analysis-chart-title";
    title.textContent = this.options.title || "\u5206\u6790\u56FE";
    this.toolbar.append(title);
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "analysis-tool-btn";
    reset.textContent = "\u590D\u4F4D";
    reset.title = "\u6062\u590D\u9ED8\u8BA4\u5750\u6807\uFF08\u4E5F\u53EF\u53CC\u51FB\u56FE\u9762\uFF09";
    reset.addEventListener("click", () => this.resetView());
    const box = document.createElement("button");
    box.type = "button";
    box.className = "analysis-tool-btn";
    box.textContent = "\u6846\u9009";
    box.title = "\u5F00\u542F\u6846\u9009\u7F29\u653E\uFF1B\u6309\u4F4F Shift \u62D6\u62FD\u4E5F\u53EF\u4E34\u65F6\u6846\u9009";
    box.classList.toggle("on", this.boxZoom);
    box.addEventListener("click", () => {
      this.boxZoom = !this.boxZoom;
      box.classList.toggle("on", this.boxZoom);
    });
    this.toolbar.append(reset, box);
    const categories = /* @__PURE__ */ new Map();
    for (const marker of this.envelope?.markers || []) {
      categories.set(marker.category, (categories.get(marker.category) || 0) + 1);
    }
    if (categories.size) {
      const group = document.createElement("div");
      group.className = "analysis-chart-toggles";
      for (const [category, count] of categories) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "analysis-cat-toggle";
        button.classList.toggle("on", this.visibleCategories.has(category));
        button.style.setProperty("--cat-color", MARKER_COLORS[category] || "#9b7247");
        button.textContent = "" + categoryLabel(category) + " (" + count + ")";
        button.addEventListener("click", () => {
          if (this.visibleCategories.has(category)) this.visibleCategories.delete(category);
          else this.visibleCategories.add(category);
          button.classList.toggle("on", this.visibleCategories.has(category));
          this.scheduleRender();
          this.notifyView();
        });
        group.append(button);
      }
      this.toolbar.append(group);
    }
  }
  baseView(envelope) {
    const axes = this.axisMap(envelope);
    const panels = this.panelCount(envelope);
    const ylimits = {};
    let xMin = Infinity;
    let xMax = -Infinity;
    for (let slot = 0; slot < panels; slot++) ylimits[slot] = [Infinity, -Infinity];
    for (const curve of envelope.curves) {
      const xAxis2 = axes.get(curve.axes[0]);
      const yAxis = axes.get(curve.axes[1]);
      if (!xAxis2 || !yAxis) continue;
      const slot = this.panelFor(envelope, curve.axes[1]);
      for (const value of curve.x) {
        if (Number.isFinite(value)) {
          xMin = Math.min(xMin, value);
          xMax = Math.max(xMax, value);
        }
      }
      for (const value of curve.y) {
        if (Number.isFinite(value)) {
          ylimits[slot][0] = Math.min(ylimits[slot][0], value);
          ylimits[slot][1] = Math.max(ylimits[slot][1], value);
        }
      }
    }
    for (const marker of envelope.markers) {
      if (!Number.isFinite(marker.x) || !Number.isFinite(marker.y)) continue;
      const slot = this.panelFor(envelope, marker.axis_y);
      ylimits[slot][0] = Math.min(ylimits[slot][0], marker.y);
      ylimits[slot][1] = Math.max(ylimits[slot][1], marker.y);
    }
    if (!Number.isFinite(xMin) || !Number.isFinite(xMax)) xMin = 0, xMax = 1;
    const xAxis = envelope.curves.length ? axes.get(envelope.curves[0].axes[0]) : null;
    let xlim;
    if (xAxis && xAxis.scale === "log10") xlim = logSafeRange(Math.max(xMin, Number.MIN_VALUE), Math.max(xMax, xMin * 10));
    else xlim = paddedRange(xMin, xMax, 0.02);
    for (let slot = 0; slot < panels; slot++) {
      const [lo, hi] = ylimits[slot];
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) ylimits[slot] = [-1, 1];
      else ylimits[slot] = paddedRange(lo, hi, 0.08);
    }
    if (envelope.kind === "nyquist") {
      const width = Math.max(this.canvasWrap.clientWidth || 640, 240);
      const height = Math.max(this.canvasWrap.clientHeight || this.options.height || 360, 200);
      const boxRatio = Math.max(0.4, (width - 80) / Math.max(height - 70, 80));
      const maxAbs = Math.max(1.02, Math.abs(xlim[0]), Math.abs(xlim[1]), Math.abs(ylimits[0][0]), Math.abs(ylimits[0][1]));
      const yspan = maxAbs * 2.3;
      const xspan = yspan * boxRatio;
      xlim = [-xspan / 2, xspan / 2];
      ylimits[0] = [-yspan / 2, yspan / 2];
    }
    return { xlim, ylims: ylimits };
  }
  axisMap(envelope) {
    return new Map(envelope.axes.map((axis) => [axis.id, axis]));
  }
  panelCount(envelope) {
    if (envelope.kind !== "bode") return 1;
    return envelope.curves.some((curve) => curve.axes[1] === "phase_deg") ? 2 : 1;
  }
  panelFor(envelope, axisId) {
    if (envelope.kind !== "bode") return 0;
    if (axisId === "phase_deg") return 1;
    return 0;
  }
  scheduleRender() {
    if (this.destroyed || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }
  tokens() {
    const style = getComputedStyle(document.documentElement);
    const token = (name, fallback) => (style.getPropertyValue(name) || "").trim() || fallback;
    return {
      paper: token("--paper", "#111"),
      plot: token("--paper-2", "#181818"),
      text: token("--ink", "#eee"),
      muted: token("--muted", "#888"),
      grid: token("--line", "#333"),
      accent: token("--accent", "#9b7247")
    };
  }
  render() {
    if (this.destroyed) return;
    const envelope = this.envelope;
    const api = this.api;
    if (!envelope || !api) return;
    const width = Math.max(this.canvasWrap.clientWidth || 640, 180);
    const height = Math.max(this.canvasWrap.clientHeight || this.options.height || 360, 180);
    this.width = width;
    this.height = height;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = width + "px";
    this.canvas.style.height = height + "px";
    this.overlay.width = Math.round(width * dpr);
    this.overlay.height = Math.round(height * dpr);
    this.overlay.style.width = width + "px";
    this.overlay.style.height = height + "px";
    if (!this.view) this.view = this.baseView(envelope);
    const axes = this.axisMap(envelope);
    const spec = this.buildSpec(envelope, axes);
    const store = this.buildStore();
    try {
      this.renderResult = api.render(this.canvas, spec, store, {
        dpr,
        width,
        height,
        tokens: this.tokens(),
        overrides: this.overrides()
      });
    } catch (error) {
      this.readout.textContent = "\u7ED8\u56FE\u5931\u8D25\uFF1A" + error.message;
      return;
    }
    this.drawOverlay();
    this.updateReadout();
  }
  overrides() {
    if (!this.view) return {};
    const out = {};
    for (const [slotText, ylim] of Object.entries(this.view.ylims)) {
      out[Number(slotText)] = { xlim: this.view.xlim, ylim };
    }
    return out;
  }
  buildStore() {
    const data = /* @__PURE__ */ new Map();
    const envelope = this.envelope;
    if (envelope) {
      for (const curve of envelope.curves) {
        data.set(curve.id + ":x", Float32Array.from(curve.x));
        data.set(curve.id + ":y", Float32Array.from(curve.y));
      }
      for (const extra of nyquistExtras(envelope)) {
        data.set(extra.name + ":x", Float32Array.from(extra.x));
        data.set(extra.name + ":y", Float32Array.from(extra.y));
      }
    }
    return { get: (name) => data.has(name) ? { values: data.get(name) } : null };
  }
  buildSpec(envelope, axes) {
    const layers = [];
    const panels = this.panelCount(envelope);
    for (const curve of envelope.curves) {
      const slot = this.panelFor(envelope, curve.axes[1]);
      const yAxis = axes.get(curve.axes[1]);
      const xAxis = axes.get(curve.axes[0]);
      const detailColor = typeof curve.detail?.color === "string" ? curve.detail.color : "";
      const color = detailColor || (curve.id.includes("phase") ? "#7a6fb0" : curve.id.includes("loop") ? "#c98a2e" : "#9b7247");
      layers.push({
        kind: "line",
        subplot: slot,
        label: curve.label,
        legend: false,
        data: { x: curve.id + ":x", y: curve.id + ":y" },
        view: {
          xlim: this.view?.xlim,
          ylim: this.view?.ylims[slot],
          xscale: xAxis?.scale === "log10" ? "log" : "linear",
          yscale: "linear",
          ylabel: yAxis ? yAxis.label + (yAxis.unit ? " (" + yAxis.unit + ")" : "") : "",
          xlabel: slot === panels - 1 ? xAxis ? xAxis.label + (xAxis.unit ? " (" + xAxis.unit + ")" : "") : "" : "",
          grid: true
        },
        style: { color, width: 1.7, dash: curve.style === "dashed" ? [7, 4] : [], opacity: 1 }
      });
    }
    for (const extra of nyquistExtras(envelope)) {
      layers.push({
        kind: "line",
        subplot: 0,
        label: extra.label,
        legend: false,
        data: { x: extra.name + ":x", y: extra.name + ":y" },
        view: { xlim: this.view?.xlim, ylim: this.view?.ylims[0], xscale: "linear", yscale: "linear", grid: true },
        style: { color: extra.color, width: 1.1, dash: [4, 4], opacity: 0.8 }
      });
    }
    for (const marker of envelope.markers) {
      if (!this.visibleCategories.has(marker.category)) continue;
      const slot = this.panelFor(envelope, marker.axis_y);
      const markerXAxis = axes.get(marker.axis_x) || (envelope.curves.length ? axes.get(envelope.curves[0].axes[0]) : void 0);
      const color = MARKER_COLORS[marker.category] || "#9b7247";
      layers.push({
        kind: "scatter",
        subplot: slot,
        label: marker.label,
        legend: false,
        data: { x: [marker.x], y: [marker.y] },
        view: { xlim: this.view?.xlim, ylim: this.view?.ylims[slot], xscale: markerXAxis?.scale === "log10" ? "log" : "linear", yscale: "linear", grid: true },
        style: { color, width: 1.4, opacity: 1, marker: { size: this.pinned?.id === marker.id ? 12 : 9, symbol: MARKER_SYMBOLS[marker.shape] || "circle" } }
      });
    }
    return {
      figure: { subplots: panels, ncols: 1 },
      layers
    };
  }
  onWheel(event) {
    if (!this.view || !this.envelope) return;
    const rect = this.canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const axis = axisAt(this.renderResult, px, py);
    if (!axis) return;
    event.preventDefault();
    const factor = event.deltaY > 0 ? 1.22 : 0.82;
    const axisX = this.envelope.curves.length ? this.axisMap(this.envelope).get(this.envelope.curves[0].axes[0]) : null;
    const anchorX = axis.sx.from(px);
    this.view.xlim = zoomRange(this.view.xlim, anchorX, factor, axisX?.scale === "log10");
    const anchorY = axis.sy.from(py);
    this.view.ylims[axis.slot] = zoomRange(this.view.ylims[axis.slot], anchorY, factor, false);
    this.scheduleRender();
    this.notifyView();
  }
  onPointerDown(event) {
    if (!this.view || !this.renderResult) return;
    if (event.button !== 0) return;
    const rect = this.canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const axis = axisAt(this.renderResult, px, py);
    if (!axis) return;
    const box = this.boxZoom || event.shiftKey;
    this.drag = {
      mode: box ? "box" : "pan",
      slot: axis.slot,
      startPx: px,
      startPy: py,
      currentPx: px,
      currentPy: py,
      view: { xlim: [...this.view.xlim], ylims: Object.fromEntries(Object.entries(this.view.ylims).map(([k, v]) => [k, [...v]])) }
    };
    this.canvasWrap.setPointerCapture(event.pointerId);
    this.canvasWrap.classList.add(box ? "is-boxing" : "is-panning");
  }
  onPointerMove(event) {
    const rect = this.canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    if (this.drag && this.view) {
      this.drag.currentPx = px;
      this.drag.currentPy = py;
      if (this.drag.mode === "pan") {
        const axis = axisAt(this.renderResult, px, py);
        if (axis) {
          const startAxis = this.renderResult?.axes.find((item) => item.slot === this.drag.slot);
          if (startAxis) {
            const dx = axis.sx.from(px) - axis.sx.from(this.drag.startPx);
            const dy = axis.sy.from(py) - axis.sy.from(this.drag.startPy);
            const [x0, x1] = this.drag.view.xlim;
            this.view.xlim = [x0 - dx, x1 - dx];
            const [y0, y1] = this.drag.view.ylims[this.drag.slot];
            this.view.ylims[this.drag.slot] = [y0 - dy, y1 - dy];
          }
        }
      }
      this.drawOverlay();
      return;
    }
    this.hoverAt(px, py);
  }
  onPointerUp(event) {
    if (!this.drag) return;
    const drag = this.drag;
    this.drag = null;
    this.canvasWrap.classList.remove("is-boxing", "is-panning");
    if (this.canvasWrap.hasPointerCapture(event.pointerId)) this.canvasWrap.releasePointerCapture(event.pointerId);
    if (drag.mode === "box" && this.view && this.renderResult) {
      const axis = this.renderResult.axes.find((item) => item.slot === drag.slot);
      if (axis) {
        const x0 = axis.sx.from(Math.min(drag.startPx, drag.currentPx));
        const x1 = axis.sx.from(Math.max(drag.startPx, drag.currentPx));
        const y0 = axis.sy.from(Math.max(drag.startPy, drag.currentPy));
        const y1 = axis.sy.from(Math.min(drag.startPy, drag.currentPy));
        if (Math.abs(drag.currentPx - drag.startPx) > 4 && Math.abs(drag.currentPy - drag.startPy) > 4) {
          this.view.xlim = clampRange(Math.min(x0, x1), Math.max(x0, x1));
          this.view.ylims[drag.slot] = clampRange(Math.min(y0, y1), Math.max(y0, y1));
        }
      }
    }
    this.scheduleRender();
    this.notifyView();
  }
  hoverAt(px, py) {
    const envelope = this.envelope;
    if (!envelope || !this.renderResult) return;
    const axis = axisAt(this.renderResult, px, py);
    if (!axis) return;
    let bestMarker = null;
    let bestDist = 12;
    for (const marker of envelope.markers) {
      if (!this.visibleCategories.has(marker.category)) continue;
      if (this.panelFor(envelope, marker.axis_y) !== axis.slot) continue;
      const mx = axis.sx.to(marker.x);
      const my = axis.sy.to(marker.y);
      if (mx === null || my === null) continue;
      const dist = Math.hypot(mx - px, my - py);
      if (dist < bestDist) {
        bestDist = dist;
        bestMarker = marker;
      }
    }
    this.hovered = bestMarker;
    if (bestMarker) {
      this.tooltip.innerHTML = "<b>" + escapeDetailHtml(bestMarker.label) + "</b><span>" + escapeDetailHtml(markerSummary(bestMarker)) + "</span>";
      this.tooltip.hidden = false;
      this.positionTooltip(px, py);
      this.cursorFrequency = bestMarker.x;
      this.drawOverlay();
      this.updateReadout(bestMarker);
      this.options.events?.onCursor?.(bestMarker.x, "chart", this.xUnit(), this.xAxisKey());
      return;
    }
    const curve = this.nearestCurve(envelope, axis, px);
    if (!curve) {
      this.tooltip.hidden = true;
      this.hoverPoint = null;
      this.cursorFrequency = null;
      this.drawOverlay();
      this.options.events?.onCursor?.(null, "chart", this.xUnit(), this.xAxisKey());
      return;
    }
    const index = curve.index;
    const x = curve.curve.x[index];
    const y = curve.curve.y[index];
    this.hoverPoint = { px, py, frequency: x };
    this.cursorFrequency = x;
    this.tooltip.innerHTML = "<b>" + escapeDetailHtml(curve.curve.label) + "</b><span>" + escapeDetailHtml(pointSummary(curve.curve, index)) + "</span>";
    this.tooltip.hidden = false;
    this.positionTooltip(px, py);
    this.drawOverlay();
    this.updateReadout(null, curve.curve, index);
    this.options.events?.onCursor?.(x, "chart", this.xUnit(), this.xAxisKey());
  }
  nearestCurve(envelope, axis, px) {
    let best = null;
    for (const curve of envelope.curves) {
      if (this.panelFor(envelope, curve.axes[1]) !== axis.slot) continue;
      for (let i = 0; i < curve.x.length; i++) {
        const mx = axis.sx.to(curve.x[i]);
        if (mx === null) continue;
        const distance = Math.abs(mx - px);
        if (!best || distance < best.distance) best = { curve, index: i, distance };
      }
    }
    return best ? { curve: best.curve, index: best.index } : null;
  }
  updateReadout(marker = null, curve, index) {
    if (!this.envelope) {
      this.readout.textContent = "\u7B49\u5F85\u5206\u6790\u7ED3\u679C\u2026";
      return;
    }
    if (marker) {
      this.readout.textContent = marker.label + " \xB7 " + markerSummary(marker) + " \xB7 \u70B9\u51FB\u53EF\u56FA\u5B9A\u5230\u8BE6\u60C5\u680F";
      return;
    }
    if (curve && index !== void 0) {
      this.readout.textContent = curve.label + " \xB7 " + pointSummary(curve, index);
      return;
    }
    const metrics = this.envelope.metrics || {};
    const parts = ["\u70B9/\u66F2\u7EBF\u6765\u81EA\u540E\u7AEF\u4FE1\u5C01"];
    const stable = metrics["stable"];
    if (typeof stable === "boolean") parts.push("\u7A33\u5B9A\uFF1A" + (stable ? "\u662F" : "\u5426"));
    const bandwidth = asNumber(metrics["bandwidth_hz"]);
    if (bandwidth !== null) parts.push("\u5E26\u5BBD " + fmtFrequency(bandwidth));
    this.readout.textContent = parts.join(" \xB7 ") + " \xB7 \u6EDA\u8F6E\u7F29\u653E\uFF0C\u62D6\u62FD\u5E73\u79FB";
  }
  positionTooltip(px, py) {
    const maxX = this.width - 210;
    const maxY = this.height - 70;
    this.tooltip.style.left = Math.max(4, Math.min(px + 14, maxX)) + "px";
    this.tooltip.style.top = Math.max(4, Math.min(py + 12, maxY)) + "px";
  }
  drawOverlay() {
    const ctx = this.overlay.getContext("2d");
    const result = this.renderResult;
    if (!ctx || !result) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const axes = result.axes;
    const primary = axes[0];
    if (!primary) return;
    if (this.cursorFrequency !== null) {
      const px = primary.sx.to(this.cursorFrequency);
      if (px !== null) {
        ctx.save();
        ctx.strokeStyle = "rgba(155,114,71,.55)";
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        for (const axis of axes) {
          ctx.beginPath();
          ctx.moveTo(px, axis.box.y);
          ctx.lineTo(px, axis.box.y + axis.box.h);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    if (this.hoverPoint) {
      const axis = axisAt(this.renderResult, this.hoverPoint.px, this.hoverPoint.py);
      if (axis) {
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,.25)";
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(axis.box.x, this.hoverPoint.py);
        ctx.lineTo(axis.box.x + axis.box.w, this.hoverPoint.py);
        ctx.stroke();
        ctx.restore();
      }
    }
    const active = this.hovered || this.pinned;
    if (active) {
      const slot = this.panelFor(this.envelope, active.axis_y);
      const axis = axes.find((item) => item.slot === slot);
      const px = axis?.sx.to(active.x);
      const py = axis?.sy.to(active.y);
      if (axis && px != null && py != null) {
        ctx.save();
        ctx.strokeStyle = MARKER_COLORS[active.category] || "#9b7247";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, active === this.pinned ? 10 : 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    if (this.envelope?.kind === "nyquist") drawNyquistDirections(ctx, this.envelope, axes);
    if (this.drag?.mode === "box") {
      ctx.save();
      ctx.fillStyle = "rgba(155,114,71,.16)";
      ctx.strokeStyle = "rgba(155,114,71,.75)";
      ctx.lineWidth = 1;
      const x = Math.min(this.drag.startPx, this.drag.currentPx);
      const y = Math.min(this.drag.startPy, this.drag.currentPy);
      const w = Math.abs(this.drag.currentPx - this.drag.startPx);
      const h = Math.abs(this.drag.currentPy - this.drag.startPy);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }
  }
  notifyView() {
    this.options.events?.onViewChange?.();
  }
  renderDetail() {
    if (!this.detailHost) return;
    renderAnalysisDetail(this.detailHost, this.envelope, this.pinned, (marker) => {
      this.pinned = marker;
      this.options.events?.onPin?.(marker);
      this.renderDetail();
      this.scheduleRender();
      this.notifyView();
    });
  }
}
function createAnalysisChart(host, options = {}) {
  return new AnalysisChart(host, options);
}
export {
  AnalysisChart,
  createAnalysisChart,
  isAnalysisEnvelope
};
