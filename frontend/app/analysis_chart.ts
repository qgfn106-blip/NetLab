/* 分析曲线图：把后端 netlab-analysis-result/1 信封交给 PlotKit 渲染内核，
 * 前端只负责视图选择、联动光标与标记索引，不重复计算任何数值。
 *
 * 设计要点（规格 D2/D6/D8）：
 *  - 数据来自信封 axes/curves/markers，不在前端做频响或稳定性推导；
 *  - Bode 用上下两个共享频率轴的子图；时域/Nyquist 单图；
 *  - 滚轮缩放、拖拽平移、Shift+拖拽框选、双击复位；
 *  - 悬停给出频率/幅值/相位/局部斜率，标记点悬停展开 detail、点击固定到右侧详情栏；
 *  - Nyquist 叠加 -1 点、单位圆与方向箭头，P/N/Z 证据由后端 metrics 提供。
 */
import {
  MARKER_COLORS,
  MARKER_SYMBOLS,
  asNumber,
  axisAt,
  categoryLabel,
  drawNyquistDirections,
  escapeDetailHtml,
  fmtDetail,
  fmtFrequency,
  markerSummary,
  nyquistExtras,
  pointSummary,
  renderAnalysisDetail,
  zoomRange,
} from './analysis_chart_detail.js';
import { axisMap, clampRange, logSafeRange, overridesFromView, paddedRange, panelCount, panelFor } from './analysis_chart_model.js';
import { boxSelectionRange, nearestCurve, nearestMarker } from './analysis_chart_interaction.js';
import { loadPlot2D, type Plot2DApi, type PlotAxis, type PlotRenderResult } from './analysis_chart_plot.js';
import { chartXAxisKey, chartXUnit, cursorAxisCompatible } from './analysis_chart_utils.js';
import {
  cloneChartAppearance,
  normalizeChartAppearance,
  type ChartAppearance,
} from './analysis_chart_appearance.js';
import { buildChartSpec } from './analysis_chart_spec.js';
export { isAnalysisEnvelope } from './analysis_chart_utils.js';

import type {
  AnalysisAxis,
  AnalysisCurve,
  AnalysisEnvelope,
  AnalysisMarker,
  AnalysisWarning,
  AnalysisChartViewState,
  ChartView,
} from './analysis_chart_types.js';

export type {
  AnalysisAxis,
  AnalysisCurve,
  AnalysisEnvelope,
  AnalysisMarker,
  AnalysisWarning,
} from './analysis_chart_types.js';

export interface AnalysisChartEvents {
  onCursor?(frequency: number | null, source: string, unit?: string, axisKey?: string): void;
  onPin?(marker: AnalysisMarker | null): void;
  onViewChange?(): void;
}

export interface AnalysisChartOptions {
  title?: string;
  detailHost?: HTMLElement | null;
  events?: AnalysisChartEvents;
  height?: number;
  /** 子图外观设置（标题、轴、网格、图例）；缺省用默认值。 */
  appearance?: unknown;
}


export class AnalysisChart {
  private readonly host: HTMLElement;
  private readonly options: AnalysisChartOptions;
  private readonly toolbar: HTMLElement;
  private readonly canvasWrap: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly overlay: HTMLCanvasElement;
  private readonly tooltip: HTMLElement;
  private readonly readout: HTMLElement;
  private detailHost: HTMLElement | null;
  private envelope: AnalysisEnvelope | null = null;
  private api: Plot2DApi | null = null;
  private renderResult: PlotRenderResult | null = null;
  private width = 0;
  private height = 0;
  private view: ChartView | null = null;
  private appearance: ChartAppearance;
  private visibleCategories = new Set<string>();
  private pinned: AnalysisMarker | null = null;
  private hovered: AnalysisMarker | null = null;
  private hoverPoint: { px: number; py: number; frequency: number | null } | null = null;
  private cursorFrequency: number | null = null;
  private cursorSource = '';
  private boxZoom = false;
  private drag: {
    mode: 'pan' | 'box';
    slot: number;
    startPx: number;
    startPy: number;
    currentPx: number;
    currentPy: number;
    view: ChartView;
    panAnchor?: number;
  } | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private frame = 0;
  private destroyed = false;

  constructor(host: HTMLElement, options: AnalysisChartOptions = {}) {
    this.host = host;
    this.options = options;
    this.appearance = normalizeChartAppearance(options.appearance);
    this.detailHost = options.detailHost || null;
    this.host.classList.add('analysis-chart-host');
    this.host.innerHTML = '';
    this.toolbar = document.createElement('div');
    this.toolbar.className = 'analysis-chart-toolbar';
    this.canvasWrap = document.createElement('div');
    this.canvasWrap.className = 'analysis-chart-canvas-wrap';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'analysis-chart-canvas';
    this.canvas.setAttribute('aria-label', options.title || '分析曲线');
    this.overlay = document.createElement('canvas');
    this.overlay.className = 'analysis-chart-overlay';
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'analysis-chart-tooltip';
    this.tooltip.hidden = true;
    this.readout = document.createElement('div');
    this.readout.className = 'analysis-chart-readout';
    this.readout.textContent = '等待分析结果…';
    this.canvasWrap.append(this.canvas, this.overlay, this.tooltip);
    this.host.append(this.toolbar, this.canvasWrap, this.readout);
    this.bindEvents();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.scheduleRender());
      this.resizeObserver.observe(this.canvasWrap);
    }
    void loadPlot2D().then((api) => {
      this.api = api;
      if (!api) {
        this.readout.textContent = 'PlotKit 渲染内核未加载：分析图不可用（请检查插件安装）。';
        return;
      }
      this.scheduleRender();
    });
  }

  setEnvelope(envelope: AnalysisEnvelope | null): void {
    this.envelope = envelope;
    this.pinned = null;
    this.hovered = null;
    this.view = null;
    this.visibleCategories = new Set((envelope?.markers || []).map((marker) => marker.category));
    this.canvasWrap.classList.toggle('is-nyquist', envelope?.kind === 'nyquist');
    if (envelope) this.readout.textContent = '滚轮缩放 · 拖拽平移 · Shift+拖拽框选 · 双击复位';
    this.renderToolbar();
    this.renderDetail();
    this.scheduleRender();
  }

  getEnvelope(): AnalysisEnvelope | null {
    return this.envelope;
  }

  getAppearance(): ChartAppearance {
    return cloneChartAppearance(this.appearance);
  }

  setAppearance(value: unknown): void {
    this.appearance = normalizeChartAppearance(value);
    this.scheduleRender();
    this.notifyView();
  }

  /** 切换右侧详情栏归属（多子画布时只有当前子画布写入详情）。 */
  setDetailHost(host: HTMLElement | null): void {
    this.detailHost = host;
    if (host) this.renderDetail();
  }

  getViewState(): AnalysisChartViewState | null {
    if (!this.envelope) return null;
    const view = this.view || this.baseView(this.envelope);
    return {
      xlim: [view.xlim[0], view.xlim[1]],
      ylims: Object.fromEntries(Object.entries(view.ylims).map(([slot, range]) => [slot, [range[0], range[1]]])) as Record<string, [number, number]>,
      visible_categories: [...this.visibleCategories],
      pinned_marker_id: this.pinned?.id || null,
    };
  }

  applyViewState(state: unknown): boolean {
    if (!this.envelope || !state || typeof state !== 'object') return false;
    const rec = state as Partial<AnalysisChartViewState>;
    const xlim = Array.isArray(rec.xlim) ? rec.xlim : null;
    if (!xlim || xlim.length !== 2 || !xlim.every((value) => Number.isFinite(value)) || !(xlim[0] < xlim[1])) return false;
    const ylims: Record<number, [number, number]> = {};
    const sourceYlims = rec.ylims && typeof rec.ylims === 'object' ? rec.ylims : {};
    for (const [slot, range] of Object.entries(sourceYlims)) {
      if (!Array.isArray(range) || range.length !== 2 || !range.every((value) => Number.isFinite(value)) || !(range[0] < range[1])) continue;
      ylims[Number(slot)] = [range[0], range[1]];
    }
    this.view = { xlim: [xlim[0], xlim[1]], ylims };
    const wanted = Array.isArray(rec.visible_categories) ? rec.visible_categories.filter((item): item is string => typeof item === 'string') : [];
    this.visibleCategories = wanted.length
      ? new Set(wanted)
      : new Set((this.envelope.markers || []).map((marker) => marker.category));
    const pinnedId = typeof rec.pinned_marker_id === 'string' ? rec.pinned_marker_id : '';
    this.pinned = pinnedId ? (this.envelope.markers || []).find((marker) => marker.id === pinnedId) || null : null;
    this.renderToolbar();
    this.renderDetail();
    this.scheduleRender();
    return true;
  }

  /** 外部（工作台状态切换/删除）导致详情栏需要重绘时调用。 */
  refreshDetail(): void {
    this.renderDetail();
  }


  setCursorFrequency(frequency: number | null, source = 'external', unit = '', axisKey = ''): void {
    if (frequency !== null && !cursorAxisCompatible(this.envelope, axisKey)) return;
    this.cursorFrequency = frequency;
    this.cursorSource = source;
    this.drawOverlay();
  }

  resetView(): void {
    this.view = this.envelope ? this.baseView(this.envelope) : null;
    this.scheduleRender();
    this.notifyView();
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.host.innerHTML = '';
  }

  private bindEvents(): void {
    this.canvasWrap.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    this.canvasWrap.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    this.canvasWrap.addEventListener('pointermove', (event) => this.onPointerMove(event));
    this.canvasWrap.addEventListener('pointerup', (event) => this.onPointerUp(event));
    this.canvasWrap.addEventListener('pointercancel', (event) => this.onPointerUp(event));
    this.canvasWrap.addEventListener('pointerleave', () => {
      this.tooltip.hidden = true;
      this.hovered = null;
      this.hoverPoint = null;
      this.cursorFrequency = null;
      this.cursorSource = '';
      this.drawOverlay();
      // 离开图表必须清除自身游标并广播，否则链接游标/状态栏会残留上一张图的值。
      this.options.events?.onCursor?.(null, 'chart', chartXUnit(this.envelope), chartXAxisKey(this.envelope));
    });
    this.canvasWrap.addEventListener('dblclick', () => this.resetView());
  }

  private renderToolbar(): void {
    this.toolbar.innerHTML = '';
    const title = document.createElement('span');
    title.className = 'analysis-chart-title';
    title.textContent = this.options.title || '分析图';
    this.toolbar.append(title);
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'analysis-tool-btn';
    reset.textContent = '复位';
    reset.title = '恢复默认坐标（也可双击图面）';
    reset.addEventListener('click', () => this.resetView());
    const box = document.createElement('button');
    box.type = 'button';
    box.className = 'analysis-tool-btn';
    box.textContent = '框选';
    box.title = '开启框选缩放；按住 Shift 拖拽也可临时框选';
    box.classList.toggle('on', this.boxZoom);
    box.addEventListener('click', () => {
      this.boxZoom = !this.boxZoom;
      box.classList.toggle('on', this.boxZoom);
    });
    this.toolbar.append(reset, box);
    const categories = new Map<string, number>();
    for (const marker of this.envelope?.markers || []) {
      categories.set(marker.category, (categories.get(marker.category) || 0) + 1);
    }
    if (categories.size) {
      const group = document.createElement('div');
      group.className = 'analysis-chart-toggles';
      for (const [category, count] of categories) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'analysis-cat-toggle';
        button.classList.toggle('on', this.visibleCategories.has(category));
        button.style.setProperty('--cat-color', MARKER_COLORS[category] || '#9b7247');
        button.textContent = '' + categoryLabel(category) + ' (' + count + ')';
        button.addEventListener('click', () => {
          if (this.visibleCategories.has(category)) this.visibleCategories.delete(category);
          else this.visibleCategories.add(category);
          button.classList.toggle('on', this.visibleCategories.has(category));
          this.scheduleRender();
          this.notifyView();
        });
        group.append(button);
      }
      this.toolbar.append(group);
    }
  }

  private baseView(envelope: AnalysisEnvelope): ChartView {
    const axes = axisMap(envelope);
    const panels = panelCount(envelope);
    const ylimits: Record<number, [number, number]> = {};
    let xMin = Infinity;
    let xMax = -Infinity;
    for (let slot = 0; slot < panels; slot++) ylimits[slot] = [Infinity, -Infinity];
    for (const curve of envelope.curves) {
      const xAxis = axes.get(curve.axes[0]);
      const yAxis = axes.get(curve.axes[1]);
      if (!xAxis || !yAxis) continue;
      const slot = panelFor(envelope, curve.axes[1]);
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
      const slot = panelFor(envelope, marker.axis_y);
      ylimits[slot][0] = Math.min(ylimits[slot][0], marker.y);
      ylimits[slot][1] = Math.max(ylimits[slot][1], marker.y);
    }
    if (!Number.isFinite(xMin) || !Number.isFinite(xMax)) xMin = 0, xMax = 1;
    const xAxis = envelope.curves.length ? axes.get(envelope.curves[0].axes[0]) : null;
    let xlim: [number, number];
    if (xAxis && xAxis.scale === 'log10') xlim = logSafeRange(Math.max(xMin, Number.MIN_VALUE), Math.max(xMax, xMin * 10));
    else xlim = paddedRange(xMin, xMax, 0.02);
    for (let slot = 0; slot < panels; slot++) {
      const [lo, hi] = ylimits[slot];
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) ylimits[slot] = [-1, 1];
      else ylimits[slot] = paddedRange(lo, hi, 0.08);
    }
    if (envelope.kind === 'nyquist') {
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

  private scheduleRender(): void {
    if (this.destroyed || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private tokens(): Record<string, string> {
    const style = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) => (style.getPropertyValue(name) || '').trim() || fallback;
    const a = this.appearance;
    const out: Record<string, string> = {
      paper: token('--paper', '#111'),
      plot: token('--paper-2', '#181818'),
      text: token('--ink', '#eee'),
      muted: token('--muted', '#888'),
      grid: token('--line', '#333'),
      accent: token('--accent', '#9b7247'),
    };
    if (a && typeof a.facecolor === 'string' && a.facecolor.trim()) {
      out.paper = a.facecolor.trim();
      out.plot = a.facecolor.trim();
    }
    if (a && typeof a.text_color === 'string' && a.text_color.trim()) out.text = a.text_color.trim();
    if (a && typeof a.axis_color === 'string' && a.axis_color.trim()) {
      out.muted = a.axis_color.trim();
      out.grid = a.axis_color.trim();
    }
    return out;
  }

  private render(): void {
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
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';
    this.overlay.width = Math.round(width * dpr);
    this.overlay.height = Math.round(height * dpr);
    this.overlay.style.width = width + 'px';
    this.overlay.style.height = height + 'px';
    if (!this.view) this.view = this.baseView(envelope);
    const axes = axisMap(envelope);
    const spec = this.buildSpec(envelope, axes);
    const store = this.buildStore();
    try {
      this.renderResult = api.render(this.canvas, spec, store, {
        dpr,
        width,
        height,
        tokens: this.tokens(),
        overrides: overridesFromView(this.view),
      });
    } catch (error) {
      this.readout.textContent = '绘图失败：' + (error as Error).message;
      return;
    }
    this.drawOverlay();
    this.updateReadout();
  }

  private buildStore(): { get(name: string): { values: Float32Array } | null } {
    const data = new Map<string, Float32Array>();
    const envelope = this.envelope;
    if (envelope) {
      for (const curve of envelope.curves) {
        data.set(curve.id + ':x', Float32Array.from(curve.x));
        data.set(curve.id + ':y', Float32Array.from(curve.y));
      }
      for (const extra of nyquistExtras(envelope)) {
        data.set(extra.name + ':x', Float32Array.from(extra.x));
        data.set(extra.name + ':y', Float32Array.from(extra.y));
      }
    }
    return { get: (name: string) => data.has(name) ? { values: data.get(name)! } : null };
  }

  private resolvedScale(setting: 'auto' | 'linear' | 'log', axis: AnalysisAxis | undefined): 'linear' | 'log' {
    if (setting !== 'auto') return setting;
    return axis?.scale === 'log10' ? 'log' : 'linear';
  }

  private gridView(): Record<string, unknown> {
    const a = this.appearance;
    return {
      grid: a.grid,
      grid_x: a.grid_x,
      grid_y: a.grid_y,
      grid_width: a.grid_width,
      grid_style: a.grid_style,
      grid_opacity: a.grid_opacity,
      ...(a.grid_color ? { grid_color: a.grid_color } : {}),
    };
  }

  private buildSpec(envelope: AnalysisEnvelope, axes: Map<string, AnalysisAxis>): unknown {
    return buildChartSpec(envelope, axes, this.appearance, this.view, this.visibleCategories, this.pinned);
  }

  private onWheel(event: WheelEvent): void {
    if (!this.view || !this.envelope) return;
    const rect = this.canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const axis = axisAt(this.renderResult, px, py);
    if (!axis) return;
    event.preventDefault();
    const factor = event.deltaY > 0 ? 1.22 : 0.82;
    const axisX = this.envelope.curves.length ? axisMap(this.envelope).get(this.envelope.curves[0].axes[0]) : null;
    const anchorX = axis.sx.from(px);
    this.view.xlim = zoomRange(this.view.xlim, anchorX, factor, axisX?.scale === 'log10');
    const anchorY = axis.sy.from(py);
    this.view.ylims[axis.slot] = zoomRange(this.view.ylims[axis.slot], anchorY, factor, false);
    this.scheduleRender();
    this.notifyView();
  }

  private onPointerDown(event: PointerEvent): void {
    if (!this.view || !this.renderResult) return;
    if (event.button !== 0) return;
    const rect = this.canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const axis = axisAt(this.renderResult, px, py);
    if (!axis) return;
    const box = this.boxZoom || event.shiftKey;
    this.drag = {
      mode: box ? 'box' : 'pan',
      slot: axis.slot,
      startPx: px,
      startPy: py,
      currentPx: px,
      currentPy: py,
      view: { xlim: [...this.view.xlim], ylims: Object.fromEntries(Object.entries(this.view.ylims).map(([k, v]) => [k, [...v] as [number, number]])) },
    };
    this.canvasWrap.setPointerCapture(event.pointerId);
    this.canvasWrap.classList.add(box ? 'is-boxing' : 'is-panning');
  }

  private onPointerMove(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    if (this.drag && this.view) {
      this.drag.currentPx = px;
      this.drag.currentPy = py;
      if (this.drag.mode === 'pan') {
        const axis = axisAt(this.renderResult, px, py);
        if (axis) {
          const startAxis = this.renderResult?.axes.find((item) => item.slot === this.drag!.slot);
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

  private onPointerUp(event: PointerEvent): void {
    if (!this.drag) return;
    const drag = this.drag;
    this.drag = null;
    this.canvasWrap.classList.remove('is-boxing', 'is-panning');
    if (this.canvasWrap.hasPointerCapture(event.pointerId)) this.canvasWrap.releasePointerCapture(event.pointerId);
    if (drag.mode === 'box' && this.view && this.renderResult) {
      const axis = this.renderResult.axes.find((item) => item.slot === drag.slot);
      const range = axis ? boxSelectionRange(axis, drag.startPx, drag.startPy, drag.currentPx, drag.currentPy) : null;
      if (range) {
        this.view.xlim = range.xlim;
        this.view.ylims[drag.slot] = range.ylim;
      }
    }
    this.scheduleRender();
    this.notifyView();
  }

  private hoverAt(px: number, py: number): void {
    const envelope = this.envelope;
    if (!envelope || !this.renderResult) return;
    const axis = axisAt(this.renderResult, px, py);
    if (!axis) return;
    const bestMarker = nearestMarker(envelope, axis, this.visibleCategories, px, py);
    this.hovered = bestMarker;
    if (bestMarker) {
      this.tooltip.innerHTML = '<b>' + escapeDetailHtml(bestMarker.label) + '</b><span>' + escapeDetailHtml(markerSummary(bestMarker)) + '</span>';
      this.tooltip.hidden = false;
      this.positionTooltip(px, py);
      this.cursorFrequency = bestMarker.x;
      this.drawOverlay();
      this.updateReadout(bestMarker);
      this.options.events?.onCursor?.(bestMarker.x, 'chart', chartXUnit(this.envelope), chartXAxisKey(this.envelope));
      return;
    }
    const curve = nearestCurve(envelope, axis, px);
    if (!curve) {
      this.tooltip.hidden = true;
      this.hoverPoint = null;
      this.cursorFrequency = null;
      this.drawOverlay();
      this.options.events?.onCursor?.(null, 'chart', chartXUnit(this.envelope), chartXAxisKey(this.envelope));
      return;
    }
    const index = curve.index;
    const x = curve.curve.x[index];
    const y = curve.curve.y[index];
    this.hoverPoint = { px, py, frequency: x };
    this.cursorFrequency = x;
    this.tooltip.innerHTML = '<b>' + escapeDetailHtml(curve.curve.label) + '</b><span>' + escapeDetailHtml(pointSummary(curve.curve, index)) + '</span>';
    this.tooltip.hidden = false;
    this.positionTooltip(px, py);
    this.drawOverlay();
    this.updateReadout(null, curve.curve, index);
    this.options.events?.onCursor?.(x, 'chart', chartXUnit(this.envelope), chartXAxisKey(this.envelope));
  }

  private updateReadout(marker: AnalysisMarker | null = null, curve?: AnalysisCurve, index?: number): void {
    if (!this.envelope) {
      this.readout.textContent = '等待分析结果…';
      return;
    }
    if (marker) {
      this.readout.textContent = marker.label + ' · ' + markerSummary(marker) + ' · 点击可固定到详情栏';
      return;
    }
    if (curve && index !== undefined) {
      this.readout.textContent = curve.label + ' · ' + pointSummary(curve, index);
      return;
    }
    const metrics = this.envelope.metrics || {};
    const parts = ['点/曲线来自后端信封'];
    const stable = metrics['stable'];
    if (typeof stable === 'boolean') parts.push('稳定：' + (stable ? '是' : '否'));
    const bandwidth = asNumber(metrics['bandwidth_hz']);
    if (bandwidth !== null) parts.push('带宽 ' + fmtFrequency(bandwidth));
    this.readout.textContent = parts.join(' · ') + ' · 滚轮缩放，拖拽平移';
  }

  private positionTooltip(px: number, py: number): void {
    const maxX = this.width - 210;
    const maxY = this.height - 70;
    this.tooltip.style.left = Math.max(4, Math.min(px + 14, maxX)) + 'px';
    this.tooltip.style.top = Math.max(4, Math.min(py + 12, maxY)) + 'px';
  }

  private drawOverlay(): void {
    const ctx = this.overlay.getContext('2d');
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
        ctx.strokeStyle = 'rgba(155,114,71,.55)';
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
        ctx.strokeStyle = 'rgba(255,255,255,.25)';
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
      const slot = panelFor(this.envelope!, active.axis_y);
      const axis = axes.find((item) => item.slot === slot);
      const px = axis?.sx.to(active.x);
      const py = axis?.sy.to(active.y);
      if (axis && px != null && py != null) {
        ctx.save();
        ctx.strokeStyle = MARKER_COLORS[active.category] || '#9b7247';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, active === this.pinned ? 10 : 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    if (this.envelope?.kind === 'nyquist') drawNyquistDirections(ctx, this.envelope, axes);
    if (this.drag?.mode === 'box') {
      ctx.save();
      ctx.fillStyle = 'rgba(155,114,71,.16)';
      ctx.strokeStyle = 'rgba(155,114,71,.75)';
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


  private notifyView(): void {
    this.options.events?.onViewChange?.();
  }

  private renderDetail(): void {
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

export function createAnalysisChart(host: HTMLElement, options: AnalysisChartOptions = {}): AnalysisChart {
  return new AnalysisChart(host, options);
}
