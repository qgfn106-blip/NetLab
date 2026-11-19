/* 统一分析工作台：会话/状态、分析导航、PlotKit 画布与右侧证据栏。
 *
 * 数值一律来自后端工作台 API（/api/analysis/workbench/*），前端只做：
 *  - 快照当前电路为可恢复状态；
 *  - 选择状态与端口、发起分析、缓存失效；
 *  - 把返回的 netlab-analysis-result/1 信封交给 AnalysisChart；
 *  - 多状态对比时把各自信封叠到同一坐标系（只做显示层合并）。
 */
import { isAnalysisEnvelope, type AnalysisEnvelope } from './analysis_chart.js';
import { compareTableHtml, mergeCompareEnvelopes, metricsHtml } from './analysis_workbench_results.js';
import { readWorkbenchUi, writeWorkbenchUi, type LayoutMode, type WorkbenchUiRec } from './analysis_workbench_layout.js';
import { AnalysisCanvasWorkspace } from './analysis_workbench_canvas.js';
import {
  analysisLoopsRequest,
  workbenchCompareRequest,
  workbenchCreateSessionRequest,
  workbenchExportRequest,
  workbenchInvalidateRequest,
  workbenchRunRequest,
  workbenchSessionRequest,
  workbenchSessionsRequest,
  workbenchStatePayload,
  workbenchStateRequest,
} from './analysis_client.js';
import { toast } from './desktop.js';
import { state } from './state.js';
import type { CircuitPayload, CompareResponse, RunResponse, SessionResponse, StateResponse, WorkbenchSessionRec, WorkbenchStateRec } from './analysis_workbench_types.js';

import {
  KIND_HINTS, KIND_LABELS, STATE_COLORS, describeRunStatus, escapeHtml,
  loopElementOptions, num, optionHtml, shortFingerprint, type AnalysisKind,
} from './analysis_workbench_meta.js';

const LAYOUT_OPTIONS: Array<[LayoutMode, string]> = [['grid', '网格'], ['tile', '平铺'], ['split', '分割'], ['max', '最大化']];

export class AnalysisWorkbench {
  private readonly host: HTMLElement;
  private readonly options: { onKindChange?: (kind: AnalysisKind) => void };
  private workspace: AnalysisCanvasWorkspace | null = null;
  private initialUi: WorkbenchUiRec;
  private restoredUi: boolean;
  private mounting = false;
  private sizes = { sidebar: 280, detail: 320 };
  private detailHost!: HTMLElement;
  private navHost!: HTMLElement;
  private contextHost!: HTMLElement;
  private toolbarHost!: HTMLElement;
  private statusHost!: HTMLElement;
  private session: WorkbenchSessionRec | null = null;
  private sessionId = '';
  private activeKind: AnalysisKind = 'bode';
  private params = { f_start: 1, f_stop: 1e5, points: 121, step_dt: 1e-5, step_duration: 5e-3, feedback_sign: 1 };
  private frequencyPath = 'descriptor_linearized';
  private circuit: CircuitPayload | null = null;
  private loopCandidates: Array<Record<string, unknown>> = [];
  private busy = false;
  private compareMode = false;
  private compareSelection = new Set<string>();
  private layout: LayoutMode = 'grid';
  private mounted = false;
  private lastRun: RunResponse | null = null;
  private lastRuns: Partial<Record<AnalysisKind, RunResponse>> = {};
  private exportFormat = 'png';
  private exportScope: 'subcanvas' | 'canvas' = 'subcanvas';

  constructor(host: HTMLElement, options: { onKindChange?: (kind: AnalysisKind) => void } = {}) {
    this.host = host;
    this.options = options;
    const saved = readWorkbenchUi((state.ui as unknown as Record<string, unknown>)['analysis_workbench']);
    this.initialUi = saved.ui;
    this.restoredUi = saved.restored;
    this.activeKind = saved.ui.active_analysis;
    this.layout = saved.ui.layout.mode;
    this.sizes = { ...saved.ui.sizes };
    this.compareSelection = new Set(saved.ui.selected_state_ids);
  }

  mount(): void {
    if (this.mounted) return;
    this.mounted = true;
    this.host.classList.add('awb');
    this.host.innerHTML = [
      '<div class="awb-context" data-awb="context"></div>',
      '<div class="awb-body">',
      '  <aside class="awb-nav" data-awb="nav"></aside>',
      '  <div class="awb-resize" data-awb-resize="nav" title="拖动调整导航宽"></div>',
      '  <section class="awb-stage">',
      '    <div class="awb-toolbar" data-awb="toolbar"></div>',
      '    <div class="awb-canvas-host" data-awb="chart"></div>',
      '  </section>',
      '  <div class="awb-resize" data-awb-resize="detail" title="拖动调整详情宽"></div>',
      '  <aside class="awb-detail" data-awb="detail"></aside>',
      '</div>',
      '<div class="awb-status" data-awb="status"></div>',
    ].join('');
    this.contextHost = this.host.querySelector('[data-awb="context"]') as HTMLElement;
    this.navHost = this.host.querySelector('[data-awb="nav"]') as HTMLElement;
    this.detailHost = this.host.querySelector('[data-awb="detail"]') as HTMLElement;
    this.toolbarHost = this.host.querySelector('[data-awb="toolbar"]') as HTMLElement;
    const chartHost = this.host.querySelector('[data-awb="chart"]') as HTMLElement;
    this.statusHost = this.host.querySelector('[data-awb="status"]') as HTMLElement;
    this.spawnWorkspace(chartHost);
    this.applySizes();
    this.host.querySelectorAll('[data-awb-resize]').forEach((handle) => {
      handle.addEventListener('pointerdown', (event) => this.beginResize(event as PointerEvent, handle as HTMLElement));
    });
    this.applyLayout();
    this.host.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Escape' && this.compareMode) {
        this.compareMode = false;
        this.renderContext();
      }
    });
    this.renderAll();
  }

  async open(kind?: AnalysisKind): Promise<void> {
    this.reloadSavedUi();
    this.mount();
    this.setKind(kind || this.initialUi.active_analysis);
    await this.ensureSession();
    if (!this.session?.states.length) await this.snapshotCurrent('当前电路');
    else this.syncCircuitFromState();
    this.renderAll();
    if (this.activeKind !== 'metrics') await this.run();
  }

  private spawnWorkspace(chartHost: HTMLElement): void {
    this.mounting = true;
    this.workspace = new AnalysisCanvasWorkspace(chartHost, this.detailHost, this.initialUi.canvases, this.layout, {
      onCursor: (frequency, source, canvasId) => this.onCursor(frequency, source, canvasId),
      onPin: () => this.renderToolbar(),
      onChange: () => { if (!this.mounting) this.persist(); },
    });
    this.mounting = false;
    this.applyLayout();
  }

  private reloadSavedUi(): void {
    const saved = readWorkbenchUi((state.ui as unknown as Record<string, unknown>)['analysis_workbench']);
    this.initialUi = saved.ui;
    this.restoredUi = saved.restored;
    this.layout = saved.ui.layout.mode;
    this.sizes = { ...saved.ui.sizes };
    this.compareSelection = new Set(saved.ui.selected_state_ids);
    if (this.mounted && this.workspace) {
      this.workspace.destroy();
      this.workspace = null;
      const chartHost = this.host.querySelector('[data-awb="chart"]') as HTMLElement | null;
      if (chartHost) this.spawnWorkspace(chartHost);
      this.applySizes();
    }
  }

  setKind(kind: AnalysisKind): void {
    this.activeKind = kind;
    this.options.onKindChange?.(kind);
    if (this.mounted) {
      if (kind !== 'metrics') this.workspace?.activateKind(kind);
      this.renderNav();
      this.renderToolbar();
      this.renderStatus();
      this.persist();
    }
  }

  destroy(): void {
    this.workspace?.destroy();
    this.workspace = null;
    this.host.innerHTML = '';
    this.mounted = false;
  }

  private renderAll(): void {
    this.renderContext();
    this.renderNav();
    this.renderToolbar();
    this.renderStatus();
    this.workspace?.refreshActiveDetail();
  }

  private renderContext(): void {
    const active = this.activeState();
    this.contextHost.innerHTML = [
      '<div class="awb-context-main">',
      '  <b>电路分析工作台</b>',
      '  <span class="awb-chip">' + escapeHtml(this.session?.name || '未连接会话') + '</span>',
      '  <span class="awb-context-hint">' + escapeHtml(KIND_HINTS[this.activeKind]) + '</span>',
      '</div>',
      '<div class="awb-context-actions">',
      '  <label class="awb-inline">状态 <select data-awb="state-select">' + this.stateOptions(active?.state_id) + '</select></label>',
      '  <button type="button" class="btn tiny" data-awb="snapshot">快照当前电路</button>',
      '  <button type="button" class="btn tiny" data-awb="update">更新选中状态</button>',
      '  <button type="button" class="btn tiny" data-awb="invalidate">标记过期</button>',
      '  <label class="awb-inline"><input type="checkbox" data-awb="compare"' + (this.compareMode ? ' checked' : '') + '> 对比</label>',
      '</div>',
    ].join('');
    this.contextHost.querySelector('[data-awb="state-select"]')?.addEventListener('change', (event) => {
      const value = (event.target as HTMLSelectElement).value;
      if (value) void this.selectState(value);
    });
    this.contextHost.querySelector('[data-awb="snapshot"]')?.addEventListener('click', () => { void this.snapshotCurrent('状态 ' + ((this.session?.states.length || 0) + 1)); });
    this.contextHost.querySelector('[data-awb="update"]')?.addEventListener('click', () => { void this.updateSelectedState(); });
    this.contextHost.querySelector('[data-awb="invalidate"]')?.addEventListener('click', () => { void this.invalidateSession(); });
    this.contextHost.querySelector('[data-awb="compare"]')?.addEventListener('change', (event) => {
      this.compareMode = (event.target as HTMLInputElement).checked;
      this.renderNav();
      this.renderToolbar();
      if (this.compareMode) void this.runCompare();
    });
  }

  private stateOptions(selected?: string | null): string {
    const states = this.session?.states || [];
    if (!states.length) return '<option value="">（无状态）</option>';
    return states.map((item) => optionHtml(item.state_id, item.label + ' · ' + shortFingerprint(item.fingerprint), item.state_id === selected)).join('');
  }

  private renderNav(): void {
    const active = this.activeState();
    const activeId = active?.state_id || '';
    const kinds = (['bode', 'time', 'nyquist', 'loop', 'loop_closed', 'loop_step', 'poles', 'metrics'] as AnalysisKind[]).map((kind) =>
      '<button type="button" class="awb-nav-item' + (kind === this.activeKind ? ' active' : '') + '" data-kind="' + kind + '">'
      + '<span class="awb-nav-label">' + KIND_LABELS[kind] + '</span><span class="awb-nav-sub">' + this.kindSub(kind) + '</span></button>'
    ).join('');
    const states = (this.session?.states || []).map((item) => {
      const selected = item.state_id === activeId;
      const checked = this.compareSelection.has(item.state_id);
      return '<label class="awb-state-item' + (selected ? ' selected' : '') + '">'
        + (this.compareMode ? '<input type="checkbox" data-compare-state="' + escapeHtml(item.state_id) + '"' + (checked ? ' checked' : '') + '>' : '')
        + '<button type="button" class="awb-state-button" data-state-id="' + escapeHtml(item.state_id) + '">'
        + '<span>' + escapeHtml(item.label) + '</span><span class="awb-state-meta">' + shortFingerprint(item.fingerprint) + '</span></button></label>';
    }).join('') || '<div class="awb-empty">还没有状态。点上方「快照当前电路」。</div>';
    const activeElement = String(active?.loop_element || '');
    const allowVirtual = this.activeKind === 'loop' || this.activeKind === 'loop_closed' || this.activeKind === 'loop_step';
    const loopOptions = loopElementOptions(this.loopCandidates, activeElement, allowVirtual);
    const needLoop = allowVirtual || this.activeKind === 'nyquist';
    this.navHost.innerHTML = [
      '<div class="awb-nav-title">分析</div>',
      '<div class="awb-nav-kinds">' + kinds + '</div>',
      '<div class="awb-nav-title">状态</div>',
      '<div class="awb-state-list">' + states + '</div>',
      '<div class="awb-nav-title">参数</div>',
      '<div class="awb-params">',
      '  <label>输入源 <select data-awb="input">' + this.sourceOptions(active?.input_source) + '</select></label>',
      '  <label>输出 <select data-awb="output">' + this.outputOptions(active?.output) + '</select></label>',
      '  <label>f 起 <input type="number" data-awb="f-start" min="0.000001" step="any" value="' + this.params.f_start + '"></label>',
      '  <label>f 止 <input type="number" data-awb="f-stop" min="0.000001" step="any" value="' + this.params.f_stop + '"></label>',
      '  <label>点数 <input type="number" data-awb="points" min="2" max="2001" step="1" value="' + this.params.points + '"></label>',
      (this.activeKind === 'bode' || this.activeKind === 'poles') ? '  <label>频响通路 <select data-awb="frequency-path">' + optionHtml('descriptor_linearized', '描述器线性化', this.frequencyPath === 'descriptor_linearized') + optionHtml('fft_trajectory', 'FFT 近似（不判稳）', this.frequencyPath === 'fft_trajectory') + '</select></label>' : '',
      '  <label>阶跃 dt <input type="number" data-awb="step-dt" min="0.000000001" step="any" value="' + this.params.step_dt + '"></label>',
      '  <label>时长 <input type="number" data-awb="step-duration" min="0.000001" step="any" value="' + this.params.step_duration + '"></label>',
      needLoop ? '  <label>断环元件 <select data-awb="element">' + loopOptions + '</select></label>' : '',
      needLoop ? '  <label>反馈符号 <select data-awb="feedback"><option value="1"' + (this.params.feedback_sign === 1 ? ' selected' : '') + '>正反馈（1）</option><option value="-1"' + (this.params.feedback_sign === -1 ? ' selected' : '') + '>负反馈（-1）</option></select></label>' : '',
      '</div>',
    ].join('');
    this.navHost.querySelectorAll('[data-kind]').forEach((button) => {
      button.addEventListener('click', () => {
        this.setKind(button.getAttribute('data-kind') as AnalysisKind);
        void this.loadLoopCandidatesIfNeeded();
        if (!this.busy) void this.run();
      });
    });
    this.navHost.querySelectorAll('[data-state-id]').forEach((button) => {
      button.addEventListener('click', () => { void this.selectState(button.getAttribute('data-state-id') || ''); });
    });
    this.navHost.querySelectorAll('[data-compare-state]').forEach((input) => {
      input.addEventListener('change', () => {
        const id = (input as HTMLInputElement).getAttribute('data-compare-state') || '';
        if ((input as HTMLInputElement).checked) this.compareSelection.add(id);
        else this.compareSelection.delete(id);
        this.renderToolbar();
      });
    });
    this.bindParamInputs();
  }

  private kindSub(kind: AnalysisKind): string {
    if (kind === 'bode') return '频响 · 极点/零点';
    if (kind === 'time') return '阶跃 · 峰值/调节';
    if (kind === 'nyquist') return '轮廓 · P/N/Z';
    if (kind === 'loop') return '断环 · G/H/T';
    return '工作点 · 稳定性';
  }

  private sourceOptions(selected?: string | null): string {
    const edges = this.circuit?.edges || [];
    const sources = edges.filter((edge) => ['vsource', 'isource'].includes(String(edge.kind || '')));
    if (!sources.length) return optionHtml('', '（无独立源）', true);
    return sources.map((edge) => {
      const name = String(edge.name || '');
      return optionHtml(name, name + ' · ' + String(edge.kind || ''), name === String(selected || ''));
    }).join('');
  }

  private outputOptions(selected?: string | null): string {
    const nodes = this.circuit?.nodes || [];
    const names = nodes
      .filter((node) => node.kind !== 'ground')
      .map((node) => String(node.name || ''))
      .filter(Boolean);
    if (!names.length) return optionHtml('', '（无节点）', true);
    return names.map((name) => optionHtml(name, name, name === String(selected || ''))).join('');
  }

  private bindParamInputs(): void {
    const bindNumber = (selector: string, key: keyof typeof this.params) => {
      const input = this.navHost.querySelector(selector) as HTMLInputElement | null;
      input?.addEventListener('change', () => {
        const value = Number(input.value);
        if (Number.isFinite(value)) this.params[key] = value;
      });
    };
    bindNumber('[data-awb="f-start"]', 'f_start');
    bindNumber('[data-awb="f-stop"]', 'f_stop');
    bindNumber('[data-awb="points"]', 'points');
    bindNumber('[data-awb="step-dt"]', 'step_dt');
    bindNumber('[data-awb="step-duration"]', 'step_duration');
    const feedback = this.navHost.querySelector('[data-awb="feedback"]') as HTMLSelectElement | null;
    feedback?.addEventListener('change', () => { this.params.feedback_sign = Number(feedback.value) === -1 ? -1 : 1; });
    const frequencyPath = this.navHost.querySelector('[data-awb="frequency-path"]') as HTMLSelectElement | null;
    frequencyPath?.addEventListener('change', () => { this.frequencyPath = frequencyPath.value === 'fft_trajectory' ? 'fft_trajectory' : 'descriptor_linearized'; });
  }

  private renderToolbar(): void {
    const active = this.activeState();
    const cache = this.lastRuns[this.activeKind]?.cache;
    const stale = cache && cache['stale'] === true;
    this.toolbarHost.innerHTML = [
      '<div class="awb-toolbar-title"><b>' + KIND_LABELS[this.activeKind] + '</b><span>' + escapeHtml(active?.label || '—') + '</span></div>',
      '<div class="awb-toolbar-meta">' + this.cacheBadge() + '</div>',
      '<div class="awb-toolbar-actions">',
      this.compareMode ? '<button type="button" class="btn tiny" data-awb="compare-run">对比选中状态</button>' : '',
      '  <select class="awb-select tiny" data-awb="layout" title="画布布局">' +
        LAYOUT_OPTIONS.map(([mode, label]) => optionHtml(mode, label, this.layout === mode)).join('') +
        '</select>',
      '  <select class="awb-select tiny" data-awb="export-format" title="导出格式">' +
        ['png', 'svg', 'pdf', 'spec', 'csv', 'json', 'zip'].map((fmt) => optionHtml(fmt, fmt.toUpperCase(), fmt === this.exportFormat)).join('') +
        '</select>',
      '  <select class="awb-select tiny" data-awb="export-scope" title="导出范围">' +
        optionHtml('subcanvas', '当前画布', this.exportScope === 'subcanvas') +
        optionHtml('canvas', '全部状态', this.exportScope === 'canvas') +
        '</select>',
      '  <button type="button" class="btn tiny" data-awb="export">导出</button>',
      '  <button type="button" class="btn tiny primary" data-awb="run">运行' + (stale ? '（结果已过期）' : '') + '</button>',
      '</div>',
    ].join('');
    this.toolbarHost.querySelector('[data-awb="run"]')?.addEventListener('click', () => { void this.run(); });
    (this.toolbarHost.querySelector('[data-awb="layout"]') as HTMLSelectElement | null)?.addEventListener('change', (event) => {
      this.layout = ((event.target as HTMLSelectElement).value || 'grid') as LayoutMode;
      this.applyLayout();
      this.persist();
    });
    this.toolbarHost.querySelector('[data-awb="compare-run"]')?.addEventListener('click', () => { void this.runCompare(); });
    (this.toolbarHost.querySelector('[data-awb="export-format"]') as HTMLSelectElement | null)?.addEventListener('change', (event) => {
      this.exportFormat = String((event.target as HTMLSelectElement).value || 'png');
    });
    (this.toolbarHost.querySelector('[data-awb="export-scope"]') as HTMLSelectElement | null)?.addEventListener('change', (event) => {
      this.exportScope = (event.target as HTMLSelectElement).value === 'canvas' ? 'canvas' : 'subcanvas';
    });
    this.toolbarHost.querySelector('[data-awb="export"]')?.addEventListener('click', () => { void this.exportResult(); });
  }

  private async exportResult(): Promise<void> {
    if (!this.sessionId) {
      toast('分析会话尚未就绪，无法导出', 'error', 4000);
      return;
    }
    const active = this.activeState();
    if (!active) {
      toast('请先快照并选择一个分析状态', 'error', 4000);
      return;
    }
    if (!this.lastRun && !this.session?.results?.length) {
      toast('请先运行分析再导出', 'error', 4000);
      return;
    }
    const allIds = this.session?.states?.map((item) => item.state_id) || [active.state_id];
    const selected = this.compareMode && this.compareSelection.size >= 2 ? [...this.compareSelection] : allIds;
    const stateIds = this.exportScope === 'canvas' ? selected : [active.state_id];
    try {
      this.toolbarHost.classList.add('busy');
      const response = await workbenchExportRequest({
        session_id: this.sessionId,
        scope: this.exportScope,
        canvas_id: this.exportScope === 'subcanvas' ? this.activeKind : undefined,
        state_ids: stateIds,
        kind: this.activeKind === 'metrics' ? undefined : this.activeKind,
        format: this.exportFormat,
        source_path: undefined,
      });
      const disposition = response.headers.get('Content-Disposition') || '';
      const matched = /filename="?([^";]+)"?/.exec(disposition);
      const fallback = `netlab-analysis.${this.exportFormat === 'spec' ? 'plotkit.json' : this.exportFormat}`;
      const filename = matched ? matched[1] : fallback;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('已导出 ' + filename, 'success', 3000);
    } catch (error) {
      toast('导出失败：' + (error as Error).message, 'error', 5000);
    } finally {
      this.toolbarHost.classList.remove('busy');
    }
  }

  private cacheBadge(): string {
    const cache = this.lastRun?.cache;
    if (!cache) return '<span class="awb-badge">尚未运行</span>';
    if (cache['stale'] === true) return '<span class="awb-badge stale">结果已过期</span>';
    return '<span class="awb-badge">' + (cache['cached'] === true ? '缓存命中' : '已计算') + ' · ' + shortFingerprint(this.lastRun?.fingerprint) + '</span>';
  }

  private renderStatus(): void {
    const active = this.activeState();
    const run = this.lastRuns[this.activeKind] || null;
    const metrics = run?.envelope?.metrics || {};
    const summary = describeRunStatus(run?.envelope);
    const lines = [
      '状态：' + (active?.label || '—'),
      '指纹：' + shortFingerprint(active?.fingerprint),
      '来源：' + summary.source,
      '稳定：' + summary.stability,
    ];
    this.statusHost.textContent = lines.join(' · ');
  }

  private activeState(): WorkbenchStateRec | undefined {
    const session = this.session;
    if (!session) return undefined;
    const activeId = session.active_state_id || session.selected_state_id;
    return session.states.find((item) => item.state_id === activeId) || session.states[0];
  }

  private async ensureSession(): Promise<void> {
    if (this.sessionId) {
      try {
        const response = await workbenchSessionRequest(this.sessionId) as SessionResponse;
        if (response.session) {
          this.session = response.session;
          return;
        }
      } catch (error) {
        this.sessionId = '';
      }
    }
    try {
      const listed = await workbenchSessionsRequest() as { sessions?: Array<{session_id: string; name: string}> };
      const first = listed.sessions?.[0];
      if (first) {
        this.sessionId = first.session_id;
      } else {
        const created = await workbenchCreateSessionRequest('电路分析') as SessionResponse;
        if (!created.session) throw new Error('创建分析会话失败');
        this.sessionId = created.session.session_id;
      }
      const loaded = await workbenchSessionRequest(this.sessionId) as SessionResponse;
      if (!loaded.session) throw new Error('读取分析会话失败');
      this.session = loaded.session;
    } catch (error) {
      this.statusHost.textContent = '分析会话不可用：' + (error as Error).message;
      toast('分析会话不可用：' + (error as Error).message, 'error', 5000);
    }
  }

  private syncCircuitFromState(): void {
    const active = this.activeState();
    if (active?.circuit) this.setCircuit(active.circuit, active);
    this.loadLoopCandidatesIfNeeded();
  }

  private setCircuit(circuit: CircuitPayload, active?: WorkbenchStateRec): void {
    this.circuit = circuit;
    const ranges = active?.ranges || {};
    for (const key of ['f_start', 'f_stop', 'points', 'step_dt', 'step_duration'] as const) {
      const value = Number(ranges[key]);
      if (Number.isFinite(value)) this.params[key] = value;
    }
    if (typeof active?.feedback_sign === 'number') this.params.feedback_sign = active.feedback_sign;
  }

  private async snapshotCurrent(label: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const payload = await workbenchStatePayload(label, true) as { state?: Record<string, unknown> };
      if (!payload.state) throw new Error('当前电路快照失败');
      const statePayload = payload.state;
      this.circuit = (statePayload.circuit as CircuitPayload) || null;
      const options = this.portDefaults();
      const response = await workbenchStateRequest({
        session_id: this.sessionId,
        action: 'add',
        state: { ...statePayload, ...options, ranges: this.rangesPayload() },
        select: true,
      }) as StateResponse;
      if (response.session) this.session = response.session;
      this.lastRun = null;
      this.renderAll();
      this.loadLoopCandidatesIfNeeded();
    } catch (error) {
      toast('快照失败：' + (error as Error).message, 'error', 5000);
    } finally {
      this.busy = false;
    }
  }

  private portDefaults(): Record<string, unknown> {
    const active = this.activeState();
    const input = (this.navHost.querySelector('[data-awb="input"]') as HTMLSelectElement | null)?.value
      || active?.input_source
      || String((this.circuit?.edges || []).find((edge) => String(edge.kind || '') === 'vsource')?.name || '');
    const nodes = (this.circuit?.nodes || []).filter((node) => node.kind !== 'ground');
    const preferred = nodes.find((node) => String(node.name || '').toLowerCase() === 'out')
      || nodes.find((node) => /out|vout|load/i.test(String(node.name || '')))
      || nodes[nodes.length - 1];
    const output = (this.navHost.querySelector('[data-awb="output"]') as HTMLSelectElement | null)?.value
      || active?.output
      || String(preferred?.name || '');
    return { input_source: input, output };
  }

  private async updateSelectedState(): Promise<void> {
    const active = this.activeState();
    if (!active || !this.sessionId || this.busy) return;
    try {
      const payload = await workbenchStatePayload(active.label, true) as { state?: Record<string, unknown> };
      if (!payload.state) throw new Error('当前电路快照失败');
      this.circuit = (payload.state.circuit as CircuitPayload) || null;
      const response = await workbenchStateRequest({
        session_id: this.sessionId,
        action: 'update',
        state_id: active.state_id,
        changes: { circuit: payload.state.circuit, ...this.portDefaults(), ranges: this.rangesPayload() },
        select: true,
      }) as StateResponse;
      if (response.session) this.session = response.session;
      this.lastRun = null;
      toast('已更新状态「' + active.label + '」的电路快照', 'info', 3000);
      this.renderAll();
    } catch (error) {
      toast('更新状态失败：' + (error as Error).message, 'error', 5000);
    }
  }

  private async selectState(stateId: string): Promise<void> {
    if (!stateId || !this.sessionId) return;
    try {
      const response = await workbenchStateRequest({ session_id: this.sessionId, action: 'select', state_id: stateId, select: true }) as StateResponse;
      if (response.session) this.session = response.session;
      this.lastRun = null;
      this.syncCircuitFromState();
      this.renderAll();
      if (this.activeKind !== 'metrics') void this.run();
    } catch (error) {
      toast('选择状态失败：' + (error as Error).message, 'error', 5000);
    }
  }

  private async invalidateSession(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await workbenchInvalidateRequest({ session_id: this.sessionId, reason: '当前电路已修改' });
      this.compareSelection.clear();
      this.lastRun = null;
      this.renderAll();
      toast('会话结果已标记过期；重新运行可刷新。', 'warn', 3000);
    } catch (error) {
      toast('标记过期失败：' + (error as Error).message, 'error', 5000);
    }
  }

  private rangesPayload(): Record<string, number> {
    return {
      f_start: this.params.f_start,
      f_stop: this.params.f_stop,
      points: Math.round(this.params.points),
      step_dt: this.params.step_dt,
      step_duration: this.params.step_duration,
    };
  }

  private async loadLoopCandidatesIfNeeded(): Promise<void> {
    if (this.activeKind !== 'loop' && this.activeKind !== 'nyquist') return;
    try {
      const response = await analysisLoopsRequest({}) as { candidates?: Array<Record<string, unknown>>; items?: Array<Record<string, unknown>> };
      this.loopCandidates = response.candidates || response.items || [];
      this.renderNav();
    } catch (error) {
      this.loopCandidates = [];
    }
  }

  private async run(): Promise<void> {
    if (this.busy) return;
    const active = this.activeState();
    if (!active || !this.sessionId) {
      toast('请先快照当前电路并选择状态', 'error', 4000);
      return;
    }
    this.busy = true;
    this.toolbarHost.classList.add('busy');
    try {
      if (this.activeKind === 'metrics') {
        const response = await workbenchRunRequest({ session_id: this.sessionId, state_id: active.state_id, kind: 'metrics', params: {} }) as RunResponse;
        this.lastRun = response;
        this.lastRuns[this.activeKind] = response;
        this.renderMetrics(response.raw || {});
      } else {
        const params = await this.runParams();
        if (!params) return;
        const response = await workbenchRunRequest({ session_id: this.sessionId, state_id: active.state_id, kind: this.activeKind, params }) as RunResponse;
        if (!response.envelope || !isAnalysisEnvelope(response.envelope)) throw new Error('后端未返回合法分析信封');
        this.lastRun = response;
        this.lastRuns[this.activeKind] = response;
        this.workspace?.activateKind(this.activeKind);
        this.workspace?.setEnvelope(this.activeKind, response.envelope);
      }
      this.renderToolbar();
      this.renderStatus();
    } catch (error) {
      toast('分析失败：' + (error as Error).message, 'error', 6500);
      this.statusHost.textContent = '分析失败：' + (error as Error).message;
    } finally {
      this.busy = false;
      this.toolbarHost.classList.remove('busy');
    }
  }

  private async runParams(): Promise<Record<string, unknown> | null> {
    const input = (this.navHost.querySelector('[data-awb="input"]') as HTMLSelectElement | null)?.value || '';
    const output = (this.navHost.querySelector('[data-awb="output"]') as HTMLSelectElement | null)?.value || '';
    if (!input || !output) {
      toast('请选择输入源与输出节点', 'error', 4000);
      return null;
    }
    const params: Record<string, unknown> = {
      input_source: input,
      output,
      f_start: this.params.f_start,
      f_stop: this.params.f_stop,
      points: Math.round(this.params.points),
      step_dt: this.params.step_dt,
      step_duration: this.params.step_duration,
    };
    if (this.activeKind === 'bode' || this.activeKind === 'poles') params.frequency_path = this.frequencyPath;
    const loopKind = this.activeKind === 'loop' || this.activeKind === 'loop_closed' || this.activeKind === 'loop_step';
    if (loopKind || this.activeKind === 'nyquist') {
      const select = this.navHost.querySelector('[data-awb="element"]') as HTMLSelectElement | null;
      let element = select?.value || '';
      if (element === '__virtual__' && !loopKind) element = '';
      if (!element && this.loopCandidates.length) element = String(this.loopCandidates[0].element || '');
      if (!element && !loopKind) {
        await this.loadLoopCandidatesIfNeeded();
        element = String(this.loopCandidates[0]?.element || '');
      }
      if (!element && loopKind) element = '__virtual__';
      if (!element) {
        toast('Nyquist 分析需要选择一个受控源作为断环点（VCVS/VCCS）', 'error', 5000);
        return null;
      }
      params.element = element;
      params.feedback_sign = this.params.feedback_sign;
    }
    return params;
  }

  private async runCompare(): Promise<void> {
    const ids = Array.from(this.compareSelection);
    if (ids.length < 2) {
      toast('对比至少选择两个状态', 'warn', 4000);
      return;
    }
    if (this.busy || !this.sessionId) return;
    this.busy = true;
    try {
      const params = await this.runParams();
      if (!params) return;
      const results: Array<{state_id: string; label: string; envelope: AnalysisEnvelope}> = [];
      for (const stateId of ids.slice(0, 8)) {
        const response = await workbenchRunRequest({ session_id: this.sessionId, state_id: stateId, kind: this.activeKind, params }) as RunResponse;
        if (response.envelope && isAnalysisEnvelope(response.envelope)) {
          const label = this.session?.states.find((item) => item.state_id === stateId)?.label || stateId;
          results.push({ state_id: stateId, label, envelope: response.envelope });
        }
      }
      if (results.length < 2) throw new Error('至少两个状态返回了可对比结果');
      const merged = this.mergeEnvelopes(results);
      this.workspace?.activateKind(this.activeKind);
      this.workspace?.setEnvelope(this.activeKind, merged);
      this.renderCompareTable(results);
      this.statusHost.textContent = '对比 ' + results.length + ' 个状态 · ' + KIND_LABELS[this.activeKind];
    } catch (error) {
      toast('对比失败：' + (error as Error).message, 'error', 6500);
    } finally {
      this.busy = false;
    }
  }

  private mergeEnvelopes(results: Array<{state_id: string; label: string; envelope: AnalysisEnvelope}>): AnalysisEnvelope {
    return mergeCompareEnvelopes(results);
  }

  private renderCompareTable(results: Array<{state_id: string; label: string; envelope: AnalysisEnvelope}>): void {
    if (!this.detailHost) return;
    this.detailHost.innerHTML = compareTableHtml(results);
  }

  private renderMetrics(raw: Record<string, unknown>): void {
    if (!this.detailHost) return;
    this.detailHost.innerHTML = metricsHtml(raw);
  }

  private onCursor(frequency: number | null, source: string, canvasId = ''): void {
    if (frequency === null) return;
    this.workspace?.setCursor(frequency, canvasId);
    this.statusHost.textContent = '光标 f = ' + frequency.toPrecision(7) + ' Hz · ' + source;
  }

  private beginResize(event: PointerEvent, handle: HTMLElement): void {
    event.preventDefault();
    const target = handle.getAttribute('data-awb-resize');
    const startX = event.clientX;
    const style = getComputedStyle(this.host);
    const startNav = parseFloat(style.getPropertyValue('--awb-nav-width')) || this.sizes.sidebar;
    const startDetail = parseFloat(style.getPropertyValue('--awb-detail-width')) || this.sizes.detail;
    const move = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      if (target === 'nav') {
        this.sizes.sidebar = Math.max(180, Math.min(420, startNav + dx));
        this.host.style.setProperty('--awb-nav-width', this.sizes.sidebar + 'px');
      } else {
        this.sizes.detail = Math.max(220, Math.min(520, startDetail - dx));
        this.host.style.setProperty('--awb-detail-width', this.sizes.detail + 'px');
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.persist();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  private applySizes(): void {
    this.host.style.setProperty('--awb-nav-width', this.sizes.sidebar + 'px');
    this.host.style.setProperty('--awb-detail-width', this.sizes.detail + 'px');
  }

  private applyLayout(): void {
    this.host.dataset.layout = this.layout;
    this.workspace?.setLayout(this.layout, false);
  }

  private persist(): void {
    try {
      const uiState = state.ui as unknown as Record<string, unknown>;
      const canvases = this.workspace?.persist() || [];
      uiState.analysis_workbench = writeWorkbenchUi({
        schema: 'netlab-analysis-workbench/1',
        active_analysis: this.activeKind,
        canvases,
        layout: { mode: this.layout, rows: 1, cols: 1, order: canvases.map((item) => item.canvas_id) },
        sizes: this.sizes,
        selected_state_ids: Array.from(this.compareSelection),
      });
    } catch (error) {
      /* 持久化失败不阻断分析 */
    }
  }
}

let sharedWorkbench: AnalysisWorkbench | null = null;

export function analysisWorkbench(): AnalysisWorkbench {
  if (!sharedWorkbench) {
    const host = document.getElementById('analWorkbench');
    if (!host) throw new Error('缺少分析工作台容器 #analWorkbench');
    sharedWorkbench = new AnalysisWorkbench(host);
    sharedWorkbench.mount();
  }
  return sharedWorkbench;
}

export function openAnalysisWorkbench(kind?: AnalysisKind): void {
  const workbench = analysisWorkbench();
  void workbench.open(kind);
}
