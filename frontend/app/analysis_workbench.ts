/* 统一分析工作台：会话/状态、分析导航、PlotKit 画布与右侧证据栏。
 *
 * 数值一律来自后端工作台 API（/api/analysis/workbench/*），前端只做：
 *  - 快照当前电路为可恢复状态；
 *  - 选择状态与端口、发起分析、缓存失效；
 *  - 把返回的 netlab-analysis-result/1 信封交给 AnalysisChart；
 *  - 多状态对比时把各自信封叠到同一坐标系（只做显示层合并）。
 */
import { isAnalysisEnvelope, type AnalysisEnvelope } from './analysis_chart.js';
import { compareTableHtml, mergeCompareEnvelopes, metricsHtml, transferSummaryHtml } from './analysis_workbench_results.js';
import { readWorkbenchUi, writeWorkbenchUi, WORKBENCH_SCHEMA, type WorkbenchCanvasRec, type WorkbenchUiRec } from './analysis_workbench_layout.js';
import { emptyLayout, type LayoutPreset } from './analysis_workbench_layout_tree.js';
import { applyWorkbenchChrome, applyWorkbenchCursor, applyWorkbenchSizes, beginWorkbenchResize, buildWorkbenchUiRecord } from './analysis_workbench_chrome.js';
import { AnalysisCanvasWorkspace } from './analysis_workbench_canvas.js';
import {
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
  KIND_HINTS, KIND_LABELS, STATE_COLORS, describeRunStatus, electricalCircuitNodes, escapeHtml,
  independentCircuitSources, loopElementOptions, num, optionHtml, shortFingerprint, type AnalysisKind,
} from './analysis_workbench_meta.js';
import { WorkbenchActions } from './analysis_workbench_actions.js';
import { loopListHtml } from './analysis_workbench_loops.js';


export class AnalysisWorkbench extends WorkbenchActions {
  private readonly options: { onKindChange?: (kind: AnalysisKind) => void };
  private initialUi: WorkbenchUiRec;
  private restoredUi: boolean;
  private mounting = false;
  private sizes = { sidebar: 280, detail: 320 };
  private collapsed = { sidebar: false, detail: false };
  /** 用户显式选择；窄屏自动折叠不覆盖它，恢复宽屏时还原。 */
  private preferredCollapsed = { sidebar: false, detail: false };
  private responsiveNarrow = false;
  private responsiveObserver: ResizeObserver | null = null;
  private focusMode = false;
  private detailHost!: HTMLElement;
  private contextHost!: HTMLElement;
  private activeKind: AnalysisKind = 'bode';
  /** 仅用户显式切换分析类型时才更新；自动打开/工程载入不得覆盖工程保存的当前分析。 */
  private persistedKind: AnalysisKind = 'bode';
  private circuit: CircuitPayload | null = null;
  private mounted = false;

  constructor(host: HTMLElement, options: { onKindChange?: (kind: AnalysisKind) => void } = {}) {
    super();
    this.host = host;
    this.options = options;
    const saved = readWorkbenchUi((state.ui as unknown as Record<string, unknown>)['analysis_workbench']);
    this.initialUi = saved.ui;
    this.restoredUi = saved.restored;
    this.activeKind = saved.ui.active_analysis;
    this.persistedKind = saved.ui.active_analysis;
    this.sizes = { ...saved.ui.sizes };
    this.collapsed = { ...saved.ui.collapsed };
    this.preferredCollapsed = { ...saved.ui.collapsed };
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
      '    <div class="awb-transfer-host" data-awb="transfer-host"></div>',
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
    this.transferHost = this.host.querySelector('[data-awb="transfer-host"]') as HTMLElement;
    const chartHost = this.host.querySelector('[data-awb="chart"]') as HTMLElement;
    this.statusHost = this.host.querySelector('[data-awb="status"]') as HTMLElement;
    this.spawnWorkspace(chartHost);
    this.applySizes();
    this.applyChrome();
    this.observeResponsiveChrome();
    this.host.querySelectorAll('[data-awb-resize]').forEach((handle) => {
      handle.addEventListener('pointerdown', (event) => this.beginResize(event as PointerEvent, handle as HTMLElement));
    });
    this.applyLayout();
    this.host.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key !== 'Escape') return;
      if (this.focusMode) {
        this.focusMode = false;
        this.applyChrome();
        this.persist();
      } else if (this.compareMode) {
        this.compareMode = false;
        this.renderContext();
      }
    });
    this.renderAll();
  }

  async open(kind?: AnalysisKind): Promise<void> {
    this.reloadSavedUi();
    this.host.dataset.awbReady = '0';
    this.mount();
    this.setKind(kind || this.initialUi.active_analysis, false);
    await this.ensureSession();
    if (!this.session?.states.length) await this.snapshotCurrent('当前电路');
    else this.syncCircuitFromState();
    this.renderAll();
    // 打开工作台时按画布逐个恢复结果（服务端缓存命中），避免非活动图空白。
    await this.restoreCanvasResults(kind || this.initialUi.active_analysis);
    // 恢复过程会切换活动画布，最后按工程保存的当前分析重新选中。
    this.setKind(kind || this.initialUi.active_analysis, false);
    this.host.dataset.awbReady = '1';
  }

  private spawnWorkspace(chartHost: HTMLElement): void {
    this.mounting = true;
    this.workspace = new AnalysisCanvasWorkspace(chartHost, this.detailHost, this.initialUi.canvases, this.initialUi.layout, {
      onCursor: (frequency, source, canvasId, unit, axisKey) => this.onCursor(frequency, source, canvasId, unit, axisKey),
      onPin: () => this.renderToolbar(),
      onChange: () => this.onWorkspaceChange(),
      onSettingsChange: () => this.persist(),
    });
    this.mounting = false;
    this.applyLayout();
  }

  private reloadSavedUi(): void {
    const saved = readWorkbenchUi((state.ui as unknown as Record<string, unknown>)['analysis_workbench']);
    this.initialUi = saved.ui;
    this.restoredUi = saved.restored;
    this.persistedKind = saved.ui.active_analysis;
    this.sizes = { ...saved.ui.sizes };
    this.collapsed = { ...saved.ui.collapsed };
    this.preferredCollapsed = { ...saved.ui.collapsed };
    this.compareSelection = new Set(saved.ui.selected_state_ids);
    this.responsiveNarrow = false;
    if (this.mounted && this.workspace) {
      this.workspace.destroy();
      this.workspace = null;
      const chartHost = this.host.querySelector('[data-awb="chart"]') as HTMLElement | null;
      if (chartHost) this.spawnWorkspace(chartHost);
      this.applySizes();
      this.applyChrome();
      this.syncResponsiveChrome();
    }
  }

  setKind(kind: AnalysisKind, persistActive = true, activateCanvas = true): void {
    if (persistActive) this.persistedKind = kind;
    this.activeKind = kind;
    this.options.onKindChange?.(kind);
    if (this.mounted) {
      if (kind !== 'metrics' && activateCanvas) this.workspace?.activateKind(kind);
      this.renderNav();
      this.renderToolbar();
      this.renderStatus();
      this.persist();
      if (kind === 'loop') void this.loadLoopGroupsIfNeeded();
    }
  }

  destroy(): void {
    this.responsiveObserver?.disconnect();
    this.responsiveObserver = null;
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

  /** 当前生效的分析类型：以活动画布为准，无活动画布时回落到上次导航类型。 */
  protected currentKind(): AnalysisKind {
    return this.workspace?.activeKind || this.activeKind;
  }

  protected selectedCanvas(): WorkbenchCanvasRec | null {
    return this.workspace?.activeCanvas || null;
  }

  /** 画布选择变化：同步命令上下文（工具栏/详情/导出/运行）到新的活动画布。 */
  private onWorkspaceChange(): void {
    if (this.mounting) return;
    const kind = this.workspace?.activeKind;
    if (kind) this.activeKind = kind;
    if (!this.workspace?.activeCanvas) this.lastCursor = null;
    this.renderNav();
    this.renderToolbar();
    this.renderStatus();
    // 画布选择变化不写回 active_analysis：仅显式 setKind（用户导航）才持久化当前分析，
    // 否则工程载入时的画布重建会把保存的“当前分析”覆盖成首个画布类型。
  }

  /** 清除本地结果缓存与画布结果（状态/参数变化后防止旧结果冒充新结果）。 */
  private clearLocalResults(): void {
    this.lastRuns = {};
    this.lastCursor = null;
    this.workspace?.clearAllEnvelopes();
  }

  /** 按已有画布逐个恢复结果（同类型多画布也各自恢复），服务端有缓存时直接命中。 */
  private async restoreCanvasResults(desired: AnalysisKind): Promise<void> {
    const canvases = (this.workspace?.canvases || []).filter((canvas) => canvas.kind !== 'metrics');
    for (const canvas of canvases) {
      this.workspace?.activate(canvas.canvas_id);
      await this.run(canvas.kind);
    }
    // 恢复过程会切换活动画布；结束后回到工程保存的当前分析，避免选择漂移。
    if (canvases.length) this.workspace?.activateKind(desired);
    this.renderAll();
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
    const activeNavKind = this.activeKind === 'loop_closed' ? 'bode'
      : this.activeKind === 'loop_step' ? 'time' : this.activeKind;
    const groups: Array<{ label: string; options: Array<{ kind: AnalysisKind; label: string; title: string }> }> = [
      { label: 'Bode 图', options: [
        { kind: 'loop', label: '开环 L(s)', title: 'Bode · 开环 L(s)' },
        { kind: 'bode', label: '闭环 T(s)', title: 'Bode' },
      ] },
      { label: '时域分析', options: [
        { kind: 'step_open', label: '开环', title: '时域 · 开环 L(s)' },
        { kind: 'time', label: '闭环', title: '时域' },
      ] },
      { label: '奈氏图', options: [
        { kind: 'nyquist', label: '开环', title: 'Nyquist' },
        { kind: 'nyquist_closed', label: '闭环', title: 'Nyquist · 闭环 T(s)' },
      ] },
    ];
    const kinds = groups.map((group) => {
      const groupActive = group.options.some((item) => item.kind === activeNavKind);
      const actions = group.options.map((item) =>
        '<button type="button" class="awb-nav-item awb-nav-action' + (item.kind === activeNavKind ? ' active' : '') + '" data-kind="' + item.kind + '" data-title="' + item.title + '">' + item.label + '</button>'
      ).join('');
      return '<div class="awb-nav-group' + (groupActive ? ' active' : '') + '">'
        + '<div class="awb-nav-group-title">' + group.label + '</div>'
        + '<div class="awb-nav-options">' + actions + '</div></div>';
    }).join('');
    const states = (this.session?.states || []).map((item) => {
      const selected = item.state_id === activeId;
      const checked = this.compareSelection.has(item.state_id);
      return '<label class="awb-state-item' + (selected ? ' selected' : '') + '">'
        + (this.compareMode ? '<input type="checkbox" data-compare-state="' + escapeHtml(item.state_id) + '"' + (checked ? ' checked' : '') + '>' : '')
        + '<button type="button" class="awb-state-button" data-state-id="' + escapeHtml(item.state_id) + '">'
        + '<span>' + escapeHtml(item.label) + '</span><span class="awb-state-meta">' + shortFingerprint(item.fingerprint) + '</span></button></label>';
    }).join('') || '<div class="awb-empty">还没有状态。点上方「快照当前电路」。</div>';
    const activeElement = String(active?.loop_element || '');
    const loopOptions = loopElementOptions(this.loopCandidates, activeElement, false);
    const needLoop = this.activeKind === 'loop' || this.activeKind === 'step_open' || this.activeKind === 'nyquist';
    const loopPanel = this.activeKind === 'loop'
      ? '<div class="awb-nav-title">环路缩略图</div>' + loopListHtml(this.loopGroups, this.selectedLoopId, this.loopCandidates)
      : '';
    this.navHost.innerHTML = [
      '<div class="awb-nav-title">分析</div>',
      '<div class="awb-nav-kinds">' + kinds + '</div>',
      loopPanel,
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
        void this.openAnalysis(button.getAttribute('data-kind') as AnalysisKind, button.getAttribute('data-title') || undefined);
      });
    });
    this.navHost.querySelectorAll('[data-state-id]').forEach((button) => {
      button.addEventListener('click', () => { void this.selectState(button.getAttribute('data-state-id') || ''); });
    });
    this.bindLoopNavHandlers();
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

  /** 点击子菜单总是新建画布，避免同类分析只能有一张图。 */
  private async openAnalysis(kind: AnalysisKind, title?: string): Promise<void> {
    this.setKind(kind, true, false);
    this.workspace?.addKind(kind, title || KIND_LABELS[kind]);
    this.renderNav();
    this.renderToolbar();
    this.renderStatus();
    await this.loadLoopCandidatesIfNeeded();
    await this.loadLoopGroupsIfNeeded();
    if (!this.busy) await this.run(kind);
  }

  private kindSub(kind: AnalysisKind): string {
    if (kind === 'bode') return '闭环频响 · 幅相/关键点';
    if (kind === 'time') return '闭环阶跃 · 峰值/调节';
    if (kind === 'nyquist') return '开环轮廓 · P/N/Z';
    if (kind === 'loop') return '断环 · 开环 L(s)';
    if (kind === 'loop_closed') return '闭环对照 · 合成/直接';
    if (kind === 'loop_step') return '闭环阶跃 · 峰值/调节';
    if (kind === 'step_open') return '断环 · 开环 L(s) 阶跃';
    if (kind === 'nyquist_closed') return '直接闭环 · T(s) 轮廓';
    return '工作点 · 稳定性';
  }

  private sourceOptions(selected?: string | null): string {
    const sources = independentCircuitSources(this.circuit?.nodes, this.circuit?.edges);
    if (!sources.length) return optionHtml('', '（无独立源）', true);
    return sources.map((source) => optionHtml(
      source.name,
      source.name + ' · ' + source.kind,
      source.name === String(selected || ''),
    )).join('');
  }

  private outputOptions(selected?: string | null): string {
    const nodes = electricalCircuitNodes(this.circuit?.nodes);
    const names = nodes
      .map((node) => String(node.name || ''))
      .filter(Boolean);
    if (!names.length) return optionHtml('', '（无节点）', true);
    const outputPort = nodes.find((node) => {
      const params = (node.params || {}) as Record<string, unknown>;
      return String(params.port_direction || '') === 'output';
    });
    const chosen = String(selected || outputPort?.name || names[0] || '');
    return names.map((name) => optionHtml(name, name, name === chosen)).join('');
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






  protected activeState(): WorkbenchStateRec | undefined {
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
      this.clearLocalResults();
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
      || String(independentCircuitSources(this.circuit?.nodes, this.circuit?.edges)[0]?.name || '');
    const nodes = electricalCircuitNodes(this.circuit?.nodes);
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
      this.clearLocalResults();
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
      this.clearLocalResults();
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
      this.clearLocalResults();
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

  protected refreshNavigation(): void { this.renderNav(); }
  protected activeAnalysisKind(): AnalysisKind { return this.activeKind; }

  protected async run(targetKind?: AnalysisKind): Promise<void> {
    if (this.busy) return;
    const kind = targetKind || this.currentKind();
    const active = this.activeState();
    const sessionId = this.sessionId;
    if (!active || !sessionId) {
      toast('请先快照当前电路并选择状态', 'error', 4000);
      return;
    }
    // 请求开始时冻结身份：会话/状态/分析类型/目标画布；只允许该身份落地结果。
    const stateId = active.state_id;
    const canvasId = this.workspace?.activeCanvas?.canvas_id || '';
    if (!canvasId) {
      toast('请选择一个画布', 'error', 4000);
      return;
    }
    this.busy = true;
    this.toolbarHost.classList.add('busy');
    try {
      let response: RunResponse;
      if (kind === 'metrics') {
        response = await workbenchRunRequest({ session_id: sessionId, state_id: stateId, kind: 'metrics', params: {} }) as RunResponse;
      } else {
        const params = await this.runParams(kind);
        if (!params) return;
        response = await workbenchRunRequest({ session_id: sessionId, state_id: stateId, kind, params }) as RunResponse;
        if (!response.envelope || !isAnalysisEnvelope(response.envelope)) throw new Error('后端未返回合法分析信封');
      }
      // 只有请求身份仍成立时才写入，防止慢响应把旧结果覆盖到新选择/新类型上。
      if (sessionId !== this.sessionId || stateId !== this.activeState()?.state_id || kind !== this.currentKind()) return;
      if (!this.workspace?.hasCanvas(canvasId)) return;
      this.lastRuns[canvasId] = response;
      if (kind === 'metrics') {
        this.renderMetrics(response.raw || {});
      } else {
        const key = typeof response.cache?.['key'] === 'string' ? response.cache['key'] : undefined;
        const target = canvasId;
        if (target) this.workspace?.setEnvelope(target, response.envelope as AnalysisEnvelope, key);
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


  protected async runCompare(): Promise<void> {
    const ids = Array.from(this.compareSelection);
    if (ids.length < 2) {
      toast('对比至少选择两个状态', 'warn', 4000);
      return;
    }
    const MAX_COMPARE = 8;
    if (ids.length > MAX_COMPARE) {
      toast('一次最多对比 ' + MAX_COMPARE + ' 个状态，当前已选 ' + ids.length + ' 个，请减少后再试', 'error', 5000);
      return;
    }
    if (this.busy || !this.sessionId) return;
    const sessionId = this.sessionId;
    const kind = this.currentKind();
    const canvasId = this.workspace?.activeCanvas?.canvas_id || '';
    if (!canvasId) {
      toast('请选择一个画布', 'error', 4000);
      return;
    }
    this.busy = true;
    try {
      const params = await this.runParams(kind);
      if (!params) return;
      const results: Array<{state_id: string; label: string; envelope: AnalysisEnvelope}> = [];
      const resultKeys: string[] = [];
      for (const stateId of ids) {
        const response = await workbenchRunRequest({ session_id: sessionId, state_id: stateId, kind, params }) as RunResponse;
        if (response.envelope && isAnalysisEnvelope(response.envelope)) {
          const label = this.session?.states.find((item) => item.state_id === stateId)?.label || stateId;
          results.push({ state_id: stateId, label, envelope: response.envelope });
          const key = typeof response.cache?.['key'] === 'string' ? response.cache['key'] : undefined;
          if (key) resultKeys.push(key);
        }
      }
      if (results.length < 2) throw new Error('至少两个状态返回了可对比结果');
      // 对比属于请求时的类型；若期间用户切换了分析类型，丢弃旧结果。
      if (sessionId !== this.sessionId || kind !== this.currentKind() || !this.workspace?.hasCanvas(canvasId)) return;
      const merged = this.mergeEnvelopes(results);
      this.workspace?.setEnvelope(canvasId, merged, undefined, resultKeys);
      this.renderCompareTable(results);
      this.statusHost.textContent = '对比 ' + results.length + ' 个状态 · ' + KIND_LABELS[kind];
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
    if (this.detailHost) this.detailHost.innerHTML = compareTableHtml(results);
  }

  private renderMetrics(raw: Record<string, unknown>): void {
    if (this.detailHost) this.detailHost.innerHTML = metricsHtml(raw);
  }

  private onCursor(frequency: number | null, source: string, canvasId = '', unit = '', axisKey = ''): void {
    void source;
    this.lastCursor = applyWorkbenchCursor(this.workspace, frequency, canvasId, unit, axisKey);
    this.renderStatus();
  }

  private beginResize(event: PointerEvent, handle: HTMLElement): void {
    beginWorkbenchResize(event, handle, this.host, this.sizes, () => this.persist());
  }

  private applySizes(): void {
    applyWorkbenchSizes(this.host, this.sizes);
  }

  /** 侧栏折叠/专注模式只改变外壳，不触碰画布布局树。 */
  private applyChrome(): void {
    applyWorkbenchChrome(this.host, this.collapsed, this.focusMode);
  }

  /** 工作台宽度 < 1100px 时自动折叠导航与详情；恢复宽屏时还原用户偏好。 */
  private observeResponsiveChrome(): void {
    this.responsiveObserver?.disconnect();
    this.responsiveObserver = null;
    this.responsiveNarrow = false;
    this.syncResponsiveChrome();
    if (typeof ResizeObserver === 'undefined') return;
    this.responsiveObserver = new ResizeObserver(() => this.syncResponsiveChrome());
    this.responsiveObserver.observe(this.host);
  }

  private syncResponsiveChrome(): void {
    const width = this.host.clientWidth;
    if (!width) return;
    const narrow = width < 1100;
    if (narrow === this.responsiveNarrow) return;
    this.responsiveNarrow = narrow;
    this.collapsed = narrow ? { sidebar: true, detail: true } : { ...this.preferredCollapsed };
    this.applyChrome();
  }

  protected toggleSidebar(): void {
    this.collapsed.sidebar = !this.collapsed.sidebar;
    this.preferredCollapsed.sidebar = this.collapsed.sidebar;
    this.applyChrome();
    this.persist();
  }

  protected toggleDetail(): void {
    this.collapsed.detail = !this.collapsed.detail;
    this.preferredCollapsed.detail = this.collapsed.detail;
    this.applyChrome();
    this.persist();
  }

  protected toggleFocus(): void {
    this.focusMode = !this.focusMode;
    this.applyChrome();
    this.persist();
  }

  protected setLayoutPreset(preset: LayoutPreset): void {
    this.workspace?.setPreset(preset);
  }

  protected applyLayout(): void { this.host.dataset.layout = this.workspace?.layout || 'auto'; }

  protected persist(): void {
    try {
      const uiState = state.ui as unknown as Record<string, unknown>;
      uiState.analysis_workbench = buildWorkbenchUiRecord(
        this.persistedKind,
        this.workspace?.persist() || [],
        this.workspace?.layoutTree || emptyLayout(),
        this.sizes,
        this.preferredCollapsed,
        Array.from(this.compareSelection),
      );
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
