/* 分析工作台的子画布登记与组合。
 *
 * 每个子画布一个 PlotKit 图表实例，登记 canvas_id/kind/figure_id/slot_id/title/view_state；
 * 布局（平铺/分割/最大化/网格）只改容器，不复制分析数据；右侧详情栏只跟随当前子画布。
 */
import { createAnalysisChart } from './analysis_chart.js';
import type { AnalysisChart, AnalysisEnvelope } from './analysis_chart.js';
import type { AnalysisKind } from './analysis_workbench_meta.js';
import { KIND_LABELS } from './analysis_workbench_meta.js';
import type { LayoutMode, WorkbenchCanvasRec, WorkbenchLayoutRec } from './analysis_workbench_layout.js';


export interface CanvasWorkspaceEvents {
  onCursor?(frequency: number | null, source: string, canvasId: string, unit?: string, axisKey?: string): void;
  onPin?(canvasId: string): void;
  onChange?(): void;
}

interface CanvasEntry {
  rec: WorkbenchCanvasRec;
  tile: HTMLElement;
  body: HTMLElement;
  chart: AnalysisChart;
  viewState?: Record<string, unknown>;
}

function newCanvasId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch (error) {
    /* 回落到时间戳 id */
  }
  return 'canvas-' + Date.now().toString(36) + '-' + Math.random().toString(16).slice(2, 10);
}

export class AnalysisCanvasWorkspace {
  private readonly host: HTMLElement;
  private readonly detailHost: HTMLElement;
  private readonly events: CanvasWorkspaceEvents;
  private readonly root: HTMLElement;
  private readonly entries: CanvasEntry[] = [];
  private activeId = '';
  private layoutMode: LayoutMode = 'grid';

  constructor(
    host: HTMLElement,
    detailHost: HTMLElement,
    saved: WorkbenchCanvasRec[],
    layout: LayoutMode,
    events: CanvasWorkspaceEvents,
  ) {
    this.host = host;
    this.detailHost = detailHost;
    this.events = events;
    this.root = document.createElement('div');
    this.root.className = 'awb-canvas-grid';
    this.host.append(this.root);
    this.setLayout(layout, false);
    for (const rec of saved) this.addCanvas(rec);
    if (saved.length) this.activate(saved[0].canvas_id);
  }

  get canvases(): WorkbenchCanvasRec[] {
    return this.entries.map((entry) => ({ ...entry.rec }));
  }

  get activeCanvasId(): string {
    return this.activeId;
  }

  /** 当前活动画布的分析类型；无活动画布时返回 null（空选择状态）。 */
  get activeKind(): AnalysisKind | null {
    const entry = this.entries.find((item) => item.rec.canvas_id === this.activeId);
    return entry ? entry.rec.kind : null;
  }

  /** 当前活动画布的登记记录；无活动画布时返回 null。 */
  get activeCanvas(): WorkbenchCanvasRec | null {
    const entry = this.entries.find((item) => item.rec.canvas_id === this.activeId);
    return entry ? { ...entry.rec } : null;
  }

  hasKind(kind: AnalysisKind): boolean {
    return this.entries.some((entry) => entry.rec.kind === kind);
  }

  hasCanvas(canvasId: string): boolean {
    return this.entries.some((entry) => entry.rec.canvas_id === canvasId);
  }

  activateKind(kind: AnalysisKind): string {
    const existing = this.entries.find((entry) => entry.rec.kind === kind);
    if (existing) {
      this.activate(existing.rec.canvas_id);
      return existing.rec.canvas_id;
    }
    const rec: WorkbenchCanvasRec = {
      canvas_id: newCanvasId(),
      kind,
      figure_id: 'f1',
      slot_id: this.entries.length,
      title: KIND_LABELS[kind],
    };
    this.addCanvas(rec);
    this.activate(rec.canvas_id);
    return rec.canvas_id;
  }

  activate(canvasId: string): void {
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

  closeCanvas(canvasId: string): void {
    const index = this.entries.findIndex((entry) => entry.rec.canvas_id === canvasId);
    if (index < 0) return;
    const [entry] = this.entries.splice(index, 1);
    entry.chart.destroy();
    entry.tile.remove();
    if (this.activeId === canvasId) {
      this.activeId = '';
      const next = this.entries[Math.max(0, index - 1)];
      if (next) this.activate(next.rec.canvas_id);
    }
    this.applyActiveClass();
    this.events.onChange?.();
  }

  setLayout(mode: LayoutMode, notify = true): void {
    this.layoutMode = mode;
    this.root.dataset.layout = mode;
    if (mode === 'max' && this.activeId) this.root.dataset.active = this.activeId;
    if (notify) this.events.onChange?.();
  }

  get layout(): LayoutMode {
    return this.layoutMode;
  }

  setEnvelope(canvasId: string, envelope: AnalysisEnvelope, resultKey?: string, resultKeys?: string[]): void {
    const entry = this.entries.find((item) => item.rec.canvas_id === canvasId);
    if (!entry) return;
    const savedView = entry.viewState;
    entry.chart.setEnvelope(envelope);
    entry.rec.result_key = resultKey;
    entry.rec.result_keys = resultKeys && resultKeys.length ? resultKeys : undefined;
    // 结果归属对外可见：E2E 可直接断言慢响应没有写到别的画布。
    if (resultKey) entry.tile.dataset.resultKey = resultKey;
    else delete entry.tile.dataset.resultKey;
    if (savedView) {
      entry.chart.applyViewState(savedView);
      entry.viewState = undefined;
    }
  }

  /** 清除所有子画布结果（状态/参数变化后防止旧曲线冒充新结果）。 */
  clearAllEnvelopes(): void {
    for (const entry of this.entries) {
      entry.chart.setEnvelope(null);
      entry.rec.result_key = undefined;
      entry.rec.result_keys = undefined;
      delete entry.tile.dataset.resultKey;
      entry.viewState = undefined;
    }
  }

  setCursor(frequency: number | null, sourceCanvasId = '', unit = '', axisKey = ''): void {
    for (const entry of this.entries) {
      if (entry.rec.canvas_id === sourceCanvasId) continue;
      // 轴兼容判断由 chart.setCursorFrequency 单点负责，避免两层重复守卫漂移。
      entry.chart.setCursorFrequency(frequency, 'linked', unit, axisKey);
    }
  }

  refreshActiveDetail(): void {
    const active = this.entries.find((entry) => entry.rec.canvas_id === this.activeId);
    active?.chart.setDetailHost(this.detailHost);
  }

  persist(): WorkbenchCanvasRec[] {
    return this.entries.map((entry) => {
      const view = entry.chart.getViewState() || entry.viewState;
      return {
        ...entry.rec,
        ...(view ? { view_state: view as Record<string, unknown> } : {}),
      };
    });
  }

  destroy(): void {
    for (const entry of this.entries) entry.chart.destroy();
    this.entries.length = 0;
    this.root.remove();
  }

  private addCanvas(rec: WorkbenchCanvasRec): void {
    const tile = document.createElement('section');
    tile.className = 'awb-canvas-tile';
    tile.dataset.canvasId = rec.canvas_id;
    const head = document.createElement('header');
    head.className = 'awb-canvas-head';
    const title = document.createElement('span');
    title.className = 'awb-canvas-title';
    title.textContent = rec.title || KIND_LABELS[rec.kind];
    const chip = document.createElement('span');
    chip.className = 'awb-canvas-chip';
    chip.textContent = KIND_LABELS[rec.kind];
    const spacer = document.createElement('span');
    spacer.className = 'awb-canvas-spacer';
    const max = document.createElement('button');
    max.type = 'button';
    max.className = 'awb-canvas-btn';
    max.title = '最大化/还原此子画布';
    max.textContent = '⤢';
    max.addEventListener('click', (event) => {
      event.stopPropagation();
      this.activate(rec.canvas_id);
      this.setLayout(this.layoutMode === 'max' ? 'grid' : 'max');
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'awb-canvas-btn';
    close.title = '关闭子画布（从左侧导航可重开）';
    close.textContent = '×';
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      this.closeCanvas(rec.canvas_id);
    });
    head.append(title, chip, spacer, max, close);
    const body = document.createElement('div');
    body.className = 'awb-canvas-body';
    tile.append(head, body);
    tile.addEventListener('pointerdown', () => this.activate(rec.canvas_id));
    this.root.append(tile);
    const chart = createAnalysisChart(body, {
      title: rec.title || KIND_LABELS[rec.kind],
      detailHost: null,
      events: {
        onCursor: (frequency, source, unit, axisKey) => this.events.onCursor?.(frequency, source, rec.canvas_id, unit, axisKey),
        onPin: () => this.events.onPin?.(rec.canvas_id),
        onViewChange: () => this.events.onChange?.(),
      },
    });
    this.entries.push({ rec: { ...rec, title: rec.title || KIND_LABELS[rec.kind] }, tile, body, chart, viewState: rec.view_state });
  }

  private applyActiveClass(): void {
    this.root.dataset.active = this.activeId;
    for (const entry of this.entries) {
      entry.tile.classList.toggle('active', entry.rec.canvas_id === this.activeId);
    }
  }
}
