import { isAnalysisEnvelope } from "./analysis_chart.js";
import { compareTableHtml, mergeCompareEnvelopes, metricsHtml } from "./analysis_workbench_results.js";
import { readWorkbenchUi, writeWorkbenchUi, WORKBENCH_SCHEMA } from "./analysis_workbench_layout.js";
import { emptyLayout } from "./analysis_workbench_layout_tree.js";
import { AnalysisCanvasWorkspace } from "./analysis_workbench_canvas.js";
import {
  workbenchCreateSessionRequest,
  workbenchInvalidateRequest,
  workbenchRunRequest,
  workbenchSessionRequest,
  workbenchSessionsRequest,
  workbenchStatePayload,
  workbenchStateRequest
} from "./analysis_client.js";
import { toast } from "./desktop.js";
import { state } from "./state.js";
import {
  KIND_HINTS,
  KIND_LABELS,
  electricalCircuitNodes,
  escapeHtml,
  independentCircuitSources,
  loopElementOptions,
  optionHtml,
  shortFingerprint
} from "./analysis_workbench_meta.js";
import { WorkbenchActions } from "./analysis_workbench_actions.js";
import { loopListHtml } from "./analysis_workbench_loops.js";
class AnalysisWorkbench extends WorkbenchActions {
  constructor(host, options = {}) {
    super();
    this.mounting = false;
    this.sizes = { sidebar: 280, detail: 320 };
    this.collapsed = { sidebar: false, detail: false };
    /** 用户显式选择；窄屏自动折叠不覆盖它，恢复宽屏时还原。 */
    this.preferredCollapsed = { sidebar: false, detail: false };
    this.responsiveNarrow = false;
    this.responsiveObserver = null;
    this.focusMode = false;
    this.activeKind = "bode";
    /** 仅用户显式切换分析类型时才更新；自动打开/工程载入不得覆盖工程保存的当前分析。 */
    this.persistedKind = "bode";
    this.circuit = null;
    this.mounted = false;
    this.host = host;
    this.options = options;
    const saved = readWorkbenchUi(state.ui["analysis_workbench"]);
    this.initialUi = saved.ui;
    this.restoredUi = saved.restored;
    this.activeKind = saved.ui.active_analysis;
    this.persistedKind = saved.ui.active_analysis;
    this.sizes = { ...saved.ui.sizes };
    this.collapsed = { ...saved.ui.collapsed };
    this.preferredCollapsed = { ...saved.ui.collapsed };
    this.compareSelection = new Set(saved.ui.selected_state_ids);
  }
  mount() {
    if (this.mounted) return;
    this.mounted = true;
    this.host.classList.add("awb");
    this.host.innerHTML = [
      '<div class="awb-context" data-awb="context"></div>',
      '<div class="awb-body">',
      '  <aside class="awb-nav" data-awb="nav"></aside>',
      '  <div class="awb-resize" data-awb-resize="nav" title="\u62D6\u52A8\u8C03\u6574\u5BFC\u822A\u5BBD"></div>',
      '  <section class="awb-stage">',
      '    <div class="awb-toolbar" data-awb="toolbar"></div>',
      '    <div class="awb-transfer-host" data-awb="transfer-host"></div>',
      '    <div class="awb-canvas-host" data-awb="chart"></div>',
      "  </section>",
      '  <div class="awb-resize" data-awb-resize="detail" title="\u62D6\u52A8\u8C03\u6574\u8BE6\u60C5\u5BBD"></div>',
      '  <aside class="awb-detail" data-awb="detail"></aside>',
      "</div>",
      '<div class="awb-status" data-awb="status"></div>'
    ].join("");
    this.contextHost = this.host.querySelector('[data-awb="context"]');
    this.navHost = this.host.querySelector('[data-awb="nav"]');
    this.detailHost = this.host.querySelector('[data-awb="detail"]');
    this.toolbarHost = this.host.querySelector('[data-awb="toolbar"]');
    this.transferHost = this.host.querySelector('[data-awb="transfer-host"]');
    const chartHost = this.host.querySelector('[data-awb="chart"]');
    this.statusHost = this.host.querySelector('[data-awb="status"]');
    this.spawnWorkspace(chartHost);
    this.applySizes();
    this.applyChrome();
    this.observeResponsiveChrome();
    this.host.querySelectorAll("[data-awb-resize]").forEach((handle) => {
      handle.addEventListener("pointerdown", (event) => this.beginResize(event, handle));
    });
    this.applyLayout();
    this.host.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
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
  async open(kind) {
    this.reloadSavedUi();
    this.host.dataset.awbReady = "0";
    this.mount();
    this.setKind(kind || this.initialUi.active_analysis, false);
    await this.ensureSession();
    if (!this.session?.states.length) await this.snapshotCurrent("\u5F53\u524D\u7535\u8DEF");
    else this.syncCircuitFromState();
    this.renderAll();
    await this.restoreCanvasResults(kind || this.initialUi.active_analysis);
    this.setKind(kind || this.initialUi.active_analysis, false);
    this.host.dataset.awbReady = "1";
  }
  spawnWorkspace(chartHost) {
    this.mounting = true;
    this.workspace = new AnalysisCanvasWorkspace(chartHost, this.detailHost, this.initialUi.canvases, this.initialUi.layout, {
      onCursor: (frequency, source, canvasId, unit, axisKey) => this.onCursor(frequency, source, canvasId, unit, axisKey),
      onPin: () => this.renderToolbar(),
      onChange: () => this.onWorkspaceChange()
    });
    this.mounting = false;
    this.applyLayout();
  }
  reloadSavedUi() {
    const saved = readWorkbenchUi(state.ui["analysis_workbench"]);
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
      const chartHost = this.host.querySelector('[data-awb="chart"]');
      if (chartHost) this.spawnWorkspace(chartHost);
      this.applySizes();
      this.applyChrome();
      this.syncResponsiveChrome();
    }
  }
  setKind(kind, persistActive = true) {
    if (persistActive) this.persistedKind = kind;
    this.activeKind = kind;
    this.options.onKindChange?.(kind);
    if (this.mounted) {
      if (kind !== "metrics") this.workspace?.activateKind(kind);
      this.renderNav();
      this.renderToolbar();
      this.renderStatus();
      this.persist();
      if (kind === "loop") void this.loadLoopGroupsIfNeeded();
    }
  }
  destroy() {
    this.responsiveObserver?.disconnect();
    this.responsiveObserver = null;
    this.workspace?.destroy();
    this.workspace = null;
    this.host.innerHTML = "";
    this.mounted = false;
  }
  renderAll() {
    this.renderContext();
    this.renderNav();
    this.renderToolbar();
    this.renderStatus();
    this.workspace?.refreshActiveDetail();
  }
  /** 当前生效的分析类型：以活动画布为准，无活动画布时回落到上次导航类型。 */
  currentKind() {
    return this.workspace?.activeKind || this.activeKind;
  }
  selectedCanvas() {
    return this.workspace?.activeCanvas || null;
  }
  /** 画布选择变化：同步命令上下文（工具栏/详情/导出/运行）到新的活动画布。 */
  onWorkspaceChange() {
    if (this.mounting) return;
    const kind = this.workspace?.activeKind;
    if (kind) this.activeKind = kind;
    if (!this.workspace?.activeCanvas) this.lastCursor = null;
    this.renderNav();
    this.renderToolbar();
    this.renderStatus();
  }
  /** 清除本地结果缓存与画布结果（状态/参数变化后防止旧结果冒充新结果）。 */
  clearLocalResults() {
    this.lastRuns = {};
    this.lastCursor = null;
    this.workspace?.clearAllEnvelopes();
  }
  /** 按已有画布逐个恢复结果（同类型多画布也各自恢复），服务端有缓存时直接命中。 */
  async restoreCanvasResults(desired) {
    const canvases = (this.workspace?.canvases || []).filter((canvas) => canvas.kind !== "metrics");
    for (const canvas of canvases) {
      this.workspace?.activate(canvas.canvas_id);
      await this.run(canvas.kind);
    }
    if (canvases.length) this.workspace?.activateKind(desired);
    this.renderAll();
  }
  renderContext() {
    const active = this.activeState();
    this.contextHost.innerHTML = [
      '<div class="awb-context-main">',
      "  <b>\u7535\u8DEF\u5206\u6790\u5DE5\u4F5C\u53F0</b>",
      '  <span class="awb-chip">' + escapeHtml(this.session?.name || "\u672A\u8FDE\u63A5\u4F1A\u8BDD") + "</span>",
      '  <span class="awb-context-hint">' + escapeHtml(KIND_HINTS[this.activeKind]) + "</span>",
      "</div>",
      '<div class="awb-context-actions">',
      '  <label class="awb-inline">\u72B6\u6001 <select data-awb="state-select">' + this.stateOptions(active?.state_id) + "</select></label>",
      '  <button type="button" class="btn tiny" data-awb="snapshot">\u5FEB\u7167\u5F53\u524D\u7535\u8DEF</button>',
      '  <button type="button" class="btn tiny" data-awb="update">\u66F4\u65B0\u9009\u4E2D\u72B6\u6001</button>',
      '  <button type="button" class="btn tiny" data-awb="invalidate">\u6807\u8BB0\u8FC7\u671F</button>',
      '  <label class="awb-inline"><input type="checkbox" data-awb="compare"' + (this.compareMode ? " checked" : "") + "> \u5BF9\u6BD4</label>",
      "</div>"
    ].join("");
    this.contextHost.querySelector('[data-awb="state-select"]')?.addEventListener("change", (event) => {
      const value = event.target.value;
      if (value) void this.selectState(value);
    });
    this.contextHost.querySelector('[data-awb="snapshot"]')?.addEventListener("click", () => {
      void this.snapshotCurrent("\u72B6\u6001 " + ((this.session?.states.length || 0) + 1));
    });
    this.contextHost.querySelector('[data-awb="update"]')?.addEventListener("click", () => {
      void this.updateSelectedState();
    });
    this.contextHost.querySelector('[data-awb="invalidate"]')?.addEventListener("click", () => {
      void this.invalidateSession();
    });
    this.contextHost.querySelector('[data-awb="compare"]')?.addEventListener("change", (event) => {
      this.compareMode = event.target.checked;
      this.renderNav();
      this.renderToolbar();
      if (this.compareMode) void this.runCompare();
    });
  }
  stateOptions(selected) {
    const states = this.session?.states || [];
    if (!states.length) return '<option value="">\uFF08\u65E0\u72B6\u6001\uFF09</option>';
    return states.map((item) => optionHtml(item.state_id, item.label + " \xB7 " + shortFingerprint(item.fingerprint), item.state_id === selected)).join("");
  }
  renderNav() {
    const active = this.activeState();
    const activeId = active?.state_id || "";
    const kinds = ["bode", "time", "nyquist", "loop", "loop_closed", "loop_step", "poles", "metrics"].map(
      (kind) => '<button type="button" class="awb-nav-item' + (kind === this.activeKind ? " active" : "") + '" data-kind="' + kind + '"><span class="awb-nav-label">' + KIND_LABELS[kind] + '</span><span class="awb-nav-sub">' + this.kindSub(kind) + "</span></button>"
    ).join("");
    const states = (this.session?.states || []).map((item) => {
      const selected = item.state_id === activeId;
      const checked = this.compareSelection.has(item.state_id);
      return '<label class="awb-state-item' + (selected ? " selected" : "") + '">' + (this.compareMode ? '<input type="checkbox" data-compare-state="' + escapeHtml(item.state_id) + '"' + (checked ? " checked" : "") + ">" : "") + '<button type="button" class="awb-state-button" data-state-id="' + escapeHtml(item.state_id) + '"><span>' + escapeHtml(item.label) + '</span><span class="awb-state-meta">' + shortFingerprint(item.fingerprint) + "</span></button></label>";
    }).join("") || '<div class="awb-empty">\u8FD8\u6CA1\u6709\u72B6\u6001\u3002\u70B9\u4E0A\u65B9\u300C\u5FEB\u7167\u5F53\u524D\u7535\u8DEF\u300D\u3002</div>';
    const activeElement = String(active?.loop_element || "");
    const allowVirtual = this.activeKind === "loop" || this.activeKind === "loop_closed" || this.activeKind === "loop_step";
    const loopOptions = loopElementOptions(this.loopCandidates, activeElement, allowVirtual);
    const needLoop = allowVirtual || this.activeKind === "nyquist";
    const loopPanel = this.activeKind === "loop" ? '<div class="awb-nav-title">\u73AF\u8DEF\u7F29\u7565\u56FE</div>' + loopListHtml(this.loopGroups, this.selectedLoopId, this.loopCandidates) : "";
    this.navHost.innerHTML = [
      '<div class="awb-nav-title">\u5206\u6790</div>',
      '<div class="awb-nav-kinds">' + kinds + "</div>",
      loopPanel,
      '<div class="awb-nav-title">\u72B6\u6001</div>',
      '<div class="awb-state-list">' + states + "</div>",
      '<div class="awb-nav-title">\u53C2\u6570</div>',
      '<div class="awb-params">',
      '  <label>\u8F93\u5165\u6E90 <select data-awb="input">' + this.sourceOptions(active?.input_source) + "</select></label>",
      '  <label>\u8F93\u51FA <select data-awb="output">' + this.outputOptions(active?.output) + "</select></label>",
      '  <label>f \u8D77 <input type="number" data-awb="f-start" min="0.000001" step="any" value="' + this.params.f_start + '"></label>',
      '  <label>f \u6B62 <input type="number" data-awb="f-stop" min="0.000001" step="any" value="' + this.params.f_stop + '"></label>',
      '  <label>\u70B9\u6570 <input type="number" data-awb="points" min="2" max="2001" step="1" value="' + this.params.points + '"></label>',
      this.activeKind === "bode" || this.activeKind === "poles" ? '  <label>\u9891\u54CD\u901A\u8DEF <select data-awb="frequency-path">' + optionHtml("descriptor_linearized", "\u63CF\u8FF0\u5668\u7EBF\u6027\u5316", this.frequencyPath === "descriptor_linearized") + optionHtml("fft_trajectory", "FFT \u8FD1\u4F3C\uFF08\u4E0D\u5224\u7A33\uFF09", this.frequencyPath === "fft_trajectory") + "</select></label>" : "",
      '  <label>\u9636\u8DC3 dt <input type="number" data-awb="step-dt" min="0.000000001" step="any" value="' + this.params.step_dt + '"></label>',
      '  <label>\u65F6\u957F <input type="number" data-awb="step-duration" min="0.000001" step="any" value="' + this.params.step_duration + '"></label>',
      needLoop ? '  <label>\u65AD\u73AF\u5143\u4EF6 <select data-awb="element">' + loopOptions + "</select></label>" : "",
      needLoop ? '  <label>\u53CD\u9988\u7B26\u53F7 <select data-awb="feedback"><option value="1"' + (this.params.feedback_sign === 1 ? " selected" : "") + '>\u6B63\u53CD\u9988\uFF081\uFF09</option><option value="-1"' + (this.params.feedback_sign === -1 ? " selected" : "") + ">\u8D1F\u53CD\u9988\uFF08-1\uFF09</option></select></label>" : "",
      "</div>"
    ].join("");
    this.navHost.querySelectorAll("[data-kind]").forEach((button) => {
      button.addEventListener("click", () => {
        this.setKind(button.getAttribute("data-kind"));
        void this.loadLoopCandidatesIfNeeded();
        void this.loadLoopGroupsIfNeeded();
        if (!this.busy) void this.run();
      });
    });
    this.navHost.querySelectorAll("[data-state-id]").forEach((button) => {
      button.addEventListener("click", () => {
        void this.selectState(button.getAttribute("data-state-id") || "");
      });
    });
    this.bindLoopNavHandlers();
    this.navHost.querySelectorAll("[data-compare-state]").forEach((input) => {
      input.addEventListener("change", () => {
        const id = input.getAttribute("data-compare-state") || "";
        if (input.checked) this.compareSelection.add(id);
        else this.compareSelection.delete(id);
        this.renderToolbar();
      });
    });
    this.bindParamInputs();
  }
  kindSub(kind) {
    if (kind === "bode") return "\u9891\u54CD \xB7 \u6781\u70B9/\u96F6\u70B9";
    if (kind === "time") return "\u9636\u8DC3 \xB7 \u5CF0\u503C/\u8C03\u8282";
    if (kind === "nyquist") return "\u8F6E\u5ED3 \xB7 P/N/Z";
    if (kind === "loop") return "\u65AD\u73AF \xB7 G/H/T";
    return "\u5DE5\u4F5C\u70B9 \xB7 \u7A33\u5B9A\u6027";
  }
  sourceOptions(selected) {
    const sources = independentCircuitSources(this.circuit?.nodes, this.circuit?.edges);
    if (!sources.length) return optionHtml("", "\uFF08\u65E0\u72EC\u7ACB\u6E90\uFF09", true);
    return sources.map((source) => optionHtml(
      source.name,
      source.name + " \xB7 " + source.kind,
      source.name === String(selected || "")
    )).join("");
  }
  outputOptions(selected) {
    const nodes = electricalCircuitNodes(this.circuit?.nodes);
    const names = nodes.map((node) => String(node.name || "")).filter(Boolean);
    if (!names.length) return optionHtml("", "\uFF08\u65E0\u8282\u70B9\uFF09", true);
    return names.map((name) => optionHtml(name, name, name === String(selected || ""))).join("");
  }
  bindParamInputs() {
    const bindNumber = (selector, key) => {
      const input = this.navHost.querySelector(selector);
      input?.addEventListener("change", () => {
        const value = Number(input.value);
        if (Number.isFinite(value)) this.params[key] = value;
      });
    };
    bindNumber('[data-awb="f-start"]', "f_start");
    bindNumber('[data-awb="f-stop"]', "f_stop");
    bindNumber('[data-awb="points"]', "points");
    bindNumber('[data-awb="step-dt"]', "step_dt");
    bindNumber('[data-awb="step-duration"]', "step_duration");
    const feedback = this.navHost.querySelector('[data-awb="feedback"]');
    feedback?.addEventListener("change", () => {
      this.params.feedback_sign = Number(feedback.value) === -1 ? -1 : 1;
    });
    const frequencyPath = this.navHost.querySelector('[data-awb="frequency-path"]');
    frequencyPath?.addEventListener("change", () => {
      this.frequencyPath = frequencyPath.value === "fft_trajectory" ? "fft_trajectory" : "descriptor_linearized";
    });
  }
  activeState() {
    const session = this.session;
    if (!session) return void 0;
    const activeId = session.active_state_id || session.selected_state_id;
    return session.states.find((item) => item.state_id === activeId) || session.states[0];
  }
  async ensureSession() {
    if (this.sessionId) {
      try {
        const response = await workbenchSessionRequest(this.sessionId);
        if (response.session) {
          this.session = response.session;
          return;
        }
      } catch (error) {
        this.sessionId = "";
      }
    }
    try {
      const listed = await workbenchSessionsRequest();
      const first = listed.sessions?.[0];
      if (first) {
        this.sessionId = first.session_id;
      } else {
        const created = await workbenchCreateSessionRequest("\u7535\u8DEF\u5206\u6790");
        if (!created.session) throw new Error("\u521B\u5EFA\u5206\u6790\u4F1A\u8BDD\u5931\u8D25");
        this.sessionId = created.session.session_id;
      }
      const loaded = await workbenchSessionRequest(this.sessionId);
      if (!loaded.session) throw new Error("\u8BFB\u53D6\u5206\u6790\u4F1A\u8BDD\u5931\u8D25");
      this.session = loaded.session;
    } catch (error) {
      this.statusHost.textContent = "\u5206\u6790\u4F1A\u8BDD\u4E0D\u53EF\u7528\uFF1A" + error.message;
      toast("\u5206\u6790\u4F1A\u8BDD\u4E0D\u53EF\u7528\uFF1A" + error.message, "error", 5e3);
    }
  }
  syncCircuitFromState() {
    const active = this.activeState();
    if (active?.circuit) this.setCircuit(active.circuit, active);
    this.loadLoopCandidatesIfNeeded();
  }
  setCircuit(circuit, active) {
    this.circuit = circuit;
    const ranges = active?.ranges || {};
    for (const key of ["f_start", "f_stop", "points", "step_dt", "step_duration"]) {
      const value = Number(ranges[key]);
      if (Number.isFinite(value)) this.params[key] = value;
    }
    if (typeof active?.feedback_sign === "number") this.params.feedback_sign = active.feedback_sign;
  }
  async snapshotCurrent(label) {
    if (this.busy) return;
    this.busy = true;
    try {
      const payload = await workbenchStatePayload(label, true);
      if (!payload.state) throw new Error("\u5F53\u524D\u7535\u8DEF\u5FEB\u7167\u5931\u8D25");
      const statePayload = payload.state;
      this.circuit = statePayload.circuit || null;
      const options = this.portDefaults();
      const response = await workbenchStateRequest({
        session_id: this.sessionId,
        action: "add",
        state: { ...statePayload, ...options, ranges: this.rangesPayload() },
        select: true
      });
      if (response.session) this.session = response.session;
      this.clearLocalResults();
      this.renderAll();
      this.loadLoopCandidatesIfNeeded();
    } catch (error) {
      toast("\u5FEB\u7167\u5931\u8D25\uFF1A" + error.message, "error", 5e3);
    } finally {
      this.busy = false;
    }
  }
  portDefaults() {
    const active = this.activeState();
    const input = this.navHost.querySelector('[data-awb="input"]')?.value || active?.input_source || String(independentCircuitSources(this.circuit?.nodes, this.circuit?.edges)[0]?.name || "");
    const nodes = electricalCircuitNodes(this.circuit?.nodes);
    const preferred = nodes.find((node) => String(node.name || "").toLowerCase() === "out") || nodes.find((node) => /out|vout|load/i.test(String(node.name || ""))) || nodes[nodes.length - 1];
    const output = this.navHost.querySelector('[data-awb="output"]')?.value || active?.output || String(preferred?.name || "");
    return { input_source: input, output };
  }
  async updateSelectedState() {
    const active = this.activeState();
    if (!active || !this.sessionId || this.busy) return;
    try {
      const payload = await workbenchStatePayload(active.label, true);
      if (!payload.state) throw new Error("\u5F53\u524D\u7535\u8DEF\u5FEB\u7167\u5931\u8D25");
      this.circuit = payload.state.circuit || null;
      const response = await workbenchStateRequest({
        session_id: this.sessionId,
        action: "update",
        state_id: active.state_id,
        changes: { circuit: payload.state.circuit, ...this.portDefaults(), ranges: this.rangesPayload() },
        select: true
      });
      if (response.session) this.session = response.session;
      this.clearLocalResults();
      toast("\u5DF2\u66F4\u65B0\u72B6\u6001\u300C" + active.label + "\u300D\u7684\u7535\u8DEF\u5FEB\u7167", "info", 3e3);
      this.renderAll();
    } catch (error) {
      toast("\u66F4\u65B0\u72B6\u6001\u5931\u8D25\uFF1A" + error.message, "error", 5e3);
    }
  }
  async selectState(stateId) {
    if (!stateId || !this.sessionId) return;
    try {
      const response = await workbenchStateRequest({ session_id: this.sessionId, action: "select", state_id: stateId, select: true });
      if (response.session) this.session = response.session;
      this.clearLocalResults();
      this.syncCircuitFromState();
      this.renderAll();
      if (this.activeKind !== "metrics") void this.run();
    } catch (error) {
      toast("\u9009\u62E9\u72B6\u6001\u5931\u8D25\uFF1A" + error.message, "error", 5e3);
    }
  }
  async invalidateSession() {
    if (!this.sessionId) return;
    try {
      await workbenchInvalidateRequest({ session_id: this.sessionId, reason: "\u5F53\u524D\u7535\u8DEF\u5DF2\u4FEE\u6539" });
      this.compareSelection.clear();
      this.clearLocalResults();
      this.renderAll();
      toast("\u4F1A\u8BDD\u7ED3\u679C\u5DF2\u6807\u8BB0\u8FC7\u671F\uFF1B\u91CD\u65B0\u8FD0\u884C\u53EF\u5237\u65B0\u3002", "warn", 3e3);
    } catch (error) {
      toast("\u6807\u8BB0\u8FC7\u671F\u5931\u8D25\uFF1A" + error.message, "error", 5e3);
    }
  }
  rangesPayload() {
    return {
      f_start: this.params.f_start,
      f_stop: this.params.f_stop,
      points: Math.round(this.params.points),
      step_dt: this.params.step_dt,
      step_duration: this.params.step_duration
    };
  }
  refreshNavigation() {
    this.renderNav();
  }
  activeAnalysisKind() {
    return this.activeKind;
  }
  async run(targetKind) {
    if (this.busy) return;
    const kind = targetKind || this.currentKind();
    const active = this.activeState();
    const sessionId = this.sessionId;
    if (!active || !sessionId) {
      toast("\u8BF7\u5148\u5FEB\u7167\u5F53\u524D\u7535\u8DEF\u5E76\u9009\u62E9\u72B6\u6001", "error", 4e3);
      return;
    }
    const stateId = active.state_id;
    const canvasId = this.workspace?.activeCanvas?.canvas_id || "";
    if (!canvasId) {
      toast("\u8BF7\u9009\u62E9\u4E00\u4E2A\u753B\u5E03", "error", 4e3);
      return;
    }
    this.busy = true;
    this.toolbarHost.classList.add("busy");
    try {
      let response;
      if (kind === "metrics") {
        response = await workbenchRunRequest({ session_id: sessionId, state_id: stateId, kind: "metrics", params: {} });
      } else {
        const params = await this.runParams(kind);
        if (!params) return;
        response = await workbenchRunRequest({ session_id: sessionId, state_id: stateId, kind, params });
        if (!response.envelope || !isAnalysisEnvelope(response.envelope)) throw new Error("\u540E\u7AEF\u672A\u8FD4\u56DE\u5408\u6CD5\u5206\u6790\u4FE1\u5C01");
      }
      if (sessionId !== this.sessionId || stateId !== this.activeState()?.state_id || kind !== this.currentKind()) return;
      if (!this.workspace?.hasCanvas(canvasId)) return;
      this.lastRuns[canvasId] = response;
      if (kind === "metrics") {
        this.renderMetrics(response.raw || {});
      } else {
        const key = typeof response.cache?.["key"] === "string" ? response.cache["key"] : void 0;
        const target = canvasId;
        if (target) this.workspace?.setEnvelope(target, response.envelope, key);
      }
      this.renderToolbar();
      this.renderStatus();
    } catch (error) {
      toast("\u5206\u6790\u5931\u8D25\uFF1A" + error.message, "error", 6500);
      this.statusHost.textContent = "\u5206\u6790\u5931\u8D25\uFF1A" + error.message;
    } finally {
      this.busy = false;
      this.toolbarHost.classList.remove("busy");
    }
  }
  async runCompare() {
    const ids = Array.from(this.compareSelection);
    if (ids.length < 2) {
      toast("\u5BF9\u6BD4\u81F3\u5C11\u9009\u62E9\u4E24\u4E2A\u72B6\u6001", "warn", 4e3);
      return;
    }
    const MAX_COMPARE = 8;
    if (ids.length > MAX_COMPARE) {
      toast("\u4E00\u6B21\u6700\u591A\u5BF9\u6BD4 " + MAX_COMPARE + " \u4E2A\u72B6\u6001\uFF0C\u5F53\u524D\u5DF2\u9009 " + ids.length + " \u4E2A\uFF0C\u8BF7\u51CF\u5C11\u540E\u518D\u8BD5", "error", 5e3);
      return;
    }
    if (this.busy || !this.sessionId) return;
    const sessionId = this.sessionId;
    const kind = this.currentKind();
    const canvasId = this.workspace?.activeCanvas?.canvas_id || "";
    if (!canvasId) {
      toast("\u8BF7\u9009\u62E9\u4E00\u4E2A\u753B\u5E03", "error", 4e3);
      return;
    }
    this.busy = true;
    try {
      const params = await this.runParams(kind);
      if (!params) return;
      const results = [];
      const resultKeys = [];
      for (const stateId of ids) {
        const response = await workbenchRunRequest({ session_id: sessionId, state_id: stateId, kind, params });
        if (response.envelope && isAnalysisEnvelope(response.envelope)) {
          const label = this.session?.states.find((item) => item.state_id === stateId)?.label || stateId;
          results.push({ state_id: stateId, label, envelope: response.envelope });
          const key = typeof response.cache?.["key"] === "string" ? response.cache["key"] : void 0;
          if (key) resultKeys.push(key);
        }
      }
      if (results.length < 2) throw new Error("\u81F3\u5C11\u4E24\u4E2A\u72B6\u6001\u8FD4\u56DE\u4E86\u53EF\u5BF9\u6BD4\u7ED3\u679C");
      if (sessionId !== this.sessionId || kind !== this.currentKind() || !this.workspace?.hasCanvas(canvasId)) return;
      const merged = this.mergeEnvelopes(results);
      this.workspace?.setEnvelope(canvasId, merged, void 0, resultKeys);
      this.renderCompareTable(results);
      this.statusHost.textContent = "\u5BF9\u6BD4 " + results.length + " \u4E2A\u72B6\u6001 \xB7 " + KIND_LABELS[kind];
    } catch (error) {
      toast("\u5BF9\u6BD4\u5931\u8D25\uFF1A" + error.message, "error", 6500);
    } finally {
      this.busy = false;
    }
  }
  mergeEnvelopes(results) {
    return mergeCompareEnvelopes(results);
  }
  renderCompareTable(results) {
    if (!this.detailHost) return;
    this.detailHost.innerHTML = compareTableHtml(results);
  }
  renderMetrics(raw) {
    if (!this.detailHost) return;
    this.detailHost.innerHTML = metricsHtml(raw);
  }
  onCursor(frequency, source, canvasId = "", unit = "", axisKey = "") {
    void source;
    this.workspace?.setCursor(frequency, canvasId, unit, axisKey);
    if (frequency === null) {
      this.lastCursor = null;
      this.renderStatus();
      return;
    }
    this.lastCursor = { frequency, unit, canvasId };
    this.renderStatus();
  }
  beginResize(event, handle) {
    event.preventDefault();
    const target = handle.getAttribute("data-awb-resize");
    const startX = event.clientX;
    const style = getComputedStyle(this.host);
    const startNav = parseFloat(style.getPropertyValue("--awb-nav-width")) || this.sizes.sidebar;
    const startDetail = parseFloat(style.getPropertyValue("--awb-detail-width")) || this.sizes.detail;
    const move = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      if (target === "nav") {
        this.sizes.sidebar = Math.max(180, Math.min(420, startNav + dx));
        this.host.style.setProperty("--awb-nav-width", this.sizes.sidebar + "px");
      } else {
        this.sizes.detail = Math.max(220, Math.min(520, startDetail - dx));
        this.host.style.setProperty("--awb-detail-width", this.sizes.detail + "px");
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      this.persist();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  applySizes() {
    this.host.style.setProperty("--awb-nav-width", this.sizes.sidebar + "px");
    this.host.style.setProperty("--awb-detail-width", this.sizes.detail + "px");
  }
  /** 侧栏折叠/专注模式只改变外壳，不触碰画布布局树。 */
  applyChrome() {
    this.host.dataset.navCollapsed = this.collapsed.sidebar ? "true" : "false";
    this.host.dataset.detailCollapsed = this.collapsed.detail ? "true" : "false";
    this.host.dataset.focus = this.focusMode ? "true" : "false";
    this.host.classList.toggle("awb-focus", this.focusMode);
  }
  /** 工作台宽度 < 1100px 时自动折叠导航与详情；恢复宽屏时还原用户偏好。 */
  observeResponsiveChrome() {
    this.responsiveObserver?.disconnect();
    this.responsiveObserver = null;
    this.responsiveNarrow = false;
    this.syncResponsiveChrome();
    if (typeof ResizeObserver === "undefined") return;
    this.responsiveObserver = new ResizeObserver(() => this.syncResponsiveChrome());
    this.responsiveObserver.observe(this.host);
  }
  syncResponsiveChrome() {
    const width = this.host.clientWidth;
    if (!width) return;
    const narrow = width < 1100;
    if (narrow === this.responsiveNarrow) return;
    this.responsiveNarrow = narrow;
    this.collapsed = narrow ? { sidebar: true, detail: true } : { ...this.preferredCollapsed };
    this.applyChrome();
  }
  toggleSidebar() {
    this.collapsed.sidebar = !this.collapsed.sidebar;
    this.preferredCollapsed.sidebar = this.collapsed.sidebar;
    this.applyChrome();
    this.persist();
  }
  toggleDetail() {
    this.collapsed.detail = !this.collapsed.detail;
    this.preferredCollapsed.detail = this.collapsed.detail;
    this.applyChrome();
    this.persist();
  }
  toggleFocus() {
    this.focusMode = !this.focusMode;
    this.applyChrome();
    this.persist();
  }
  setLayoutPreset(preset) {
    this.workspace?.setPreset(preset);
  }
  applyLayout() {
    this.host.dataset.layout = this.workspace?.layout || "auto";
  }
  persist() {
    try {
      const uiState = state.ui;
      const canvases = this.workspace?.persist() || [];
      uiState.analysis_workbench = writeWorkbenchUi({
        schema: WORKBENCH_SCHEMA,
        active_analysis: this.persistedKind,
        canvases,
        layout: this.workspace?.layoutTree || emptyLayout(),
        sizes: this.sizes,
        collapsed: this.preferredCollapsed,
        selected_state_ids: Array.from(this.compareSelection)
      });
    } catch (error) {
    }
  }
}
let sharedWorkbench = null;
function analysisWorkbench() {
  if (!sharedWorkbench) {
    const host = document.getElementById("analWorkbench");
    if (!host) throw new Error("\u7F3A\u5C11\u5206\u6790\u5DE5\u4F5C\u53F0\u5BB9\u5668 #analWorkbench");
    sharedWorkbench = new AnalysisWorkbench(host);
    sharedWorkbench.mount();
  }
  return sharedWorkbench;
}
function openAnalysisWorkbench(kind) {
  const workbench = analysisWorkbench();
  void workbench.open(kind);
}
export {
  AnalysisWorkbench,
  analysisWorkbench,
  openAnalysisWorkbench
};
