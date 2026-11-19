import { isAnalysisEnvelope } from "./analysis_chart.js";
import { compareTableHtml, mergeCompareEnvelopes, metricsHtml } from "./analysis_workbench_results.js";
import { readWorkbenchUi, writeWorkbenchUi } from "./analysis_workbench_layout.js";
import { AnalysisCanvasWorkspace } from "./analysis_workbench_canvas.js";
import {
  analysisLoopsRequest,
  workbenchCreateSessionRequest,
  workbenchExportRequest,
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
  describeRunStatus,
  escapeHtml,
  loopElementOptions,
  optionHtml,
  shortFingerprint
} from "./analysis_workbench_meta.js";
const LAYOUT_OPTIONS = [["grid", "\u7F51\u683C"], ["tile", "\u5E73\u94FA"], ["split", "\u5206\u5272"], ["max", "\u6700\u5927\u5316"]];
class AnalysisWorkbench {
  constructor(host, options = {}) {
    this.workspace = null;
    this.mounting = false;
    this.sizes = { sidebar: 280, detail: 320 };
    this.session = null;
    this.sessionId = "";
    this.activeKind = "bode";
    this.params = { f_start: 1, f_stop: 1e5, points: 121, step_dt: 1e-5, step_duration: 5e-3, feedback_sign: 1 };
    this.frequencyPath = "descriptor_linearized";
    this.circuit = null;
    this.loopCandidates = [];
    this.busy = false;
    this.compareMode = false;
    this.compareSelection = /* @__PURE__ */ new Set();
    this.layout = "grid";
    this.mounted = false;
    this.lastRun = null;
    this.lastRuns = {};
    this.exportFormat = "png";
    this.exportScope = "subcanvas";
    this.host = host;
    this.options = options;
    const saved = readWorkbenchUi(state.ui["analysis_workbench"]);
    this.initialUi = saved.ui;
    this.restoredUi = saved.restored;
    this.activeKind = saved.ui.active_analysis;
    this.layout = saved.ui.layout.mode;
    this.sizes = { ...saved.ui.sizes };
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
    const chartHost = this.host.querySelector('[data-awb="chart"]');
    this.statusHost = this.host.querySelector('[data-awb="status"]');
    this.spawnWorkspace(chartHost);
    this.applySizes();
    this.host.querySelectorAll("[data-awb-resize]").forEach((handle) => {
      handle.addEventListener("pointerdown", (event) => this.beginResize(event, handle));
    });
    this.applyLayout();
    this.host.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.compareMode) {
        this.compareMode = false;
        this.renderContext();
      }
    });
    this.renderAll();
  }
  async open(kind) {
    this.reloadSavedUi();
    this.mount();
    this.setKind(kind || this.initialUi.active_analysis);
    await this.ensureSession();
    if (!this.session?.states.length) await this.snapshotCurrent("\u5F53\u524D\u7535\u8DEF");
    else this.syncCircuitFromState();
    this.renderAll();
    if (this.activeKind !== "metrics") await this.run();
  }
  spawnWorkspace(chartHost) {
    this.mounting = true;
    this.workspace = new AnalysisCanvasWorkspace(chartHost, this.detailHost, this.initialUi.canvases, this.layout, {
      onCursor: (frequency, source, canvasId) => this.onCursor(frequency, source, canvasId),
      onPin: () => this.renderToolbar(),
      onChange: () => {
        if (!this.mounting) this.persist();
      }
    });
    this.mounting = false;
    this.applyLayout();
  }
  reloadSavedUi() {
    const saved = readWorkbenchUi(state.ui["analysis_workbench"]);
    this.initialUi = saved.ui;
    this.restoredUi = saved.restored;
    this.layout = saved.ui.layout.mode;
    this.sizes = { ...saved.ui.sizes };
    this.compareSelection = new Set(saved.ui.selected_state_ids);
    if (this.mounted && this.workspace) {
      this.workspace.destroy();
      this.workspace = null;
      const chartHost = this.host.querySelector('[data-awb="chart"]');
      if (chartHost) this.spawnWorkspace(chartHost);
      this.applySizes();
    }
  }
  setKind(kind) {
    this.activeKind = kind;
    this.options.onKindChange?.(kind);
    if (this.mounted) {
      if (kind !== "metrics") this.workspace?.activateKind(kind);
      this.renderNav();
      this.renderToolbar();
      this.renderStatus();
      this.persist();
    }
  }
  destroy() {
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
    this.navHost.innerHTML = [
      '<div class="awb-nav-title">\u5206\u6790</div>',
      '<div class="awb-nav-kinds">' + kinds + "</div>",
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
        if (!this.busy) void this.run();
      });
    });
    this.navHost.querySelectorAll("[data-state-id]").forEach((button) => {
      button.addEventListener("click", () => {
        void this.selectState(button.getAttribute("data-state-id") || "");
      });
    });
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
    const edges = this.circuit?.edges || [];
    const sources = edges.filter((edge) => ["vsource", "isource"].includes(String(edge.kind || "")));
    if (!sources.length) return optionHtml("", "\uFF08\u65E0\u72EC\u7ACB\u6E90\uFF09", true);
    return sources.map((edge) => {
      const name = String(edge.name || "");
      return optionHtml(name, name + " \xB7 " + String(edge.kind || ""), name === String(selected || ""));
    }).join("");
  }
  outputOptions(selected) {
    const nodes = this.circuit?.nodes || [];
    const names = nodes.filter((node) => node.kind !== "ground").map((node) => String(node.name || "")).filter(Boolean);
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
  renderToolbar() {
    const active = this.activeState();
    const cache = this.lastRuns[this.activeKind]?.cache;
    const stale = cache && cache["stale"] === true;
    this.toolbarHost.innerHTML = [
      '<div class="awb-toolbar-title"><b>' + KIND_LABELS[this.activeKind] + "</b><span>" + escapeHtml(active?.label || "\u2014") + "</span></div>",
      '<div class="awb-toolbar-meta">' + this.cacheBadge() + "</div>",
      '<div class="awb-toolbar-actions">',
      this.compareMode ? '<button type="button" class="btn tiny" data-awb="compare-run">\u5BF9\u6BD4\u9009\u4E2D\u72B6\u6001</button>' : "",
      '  <select class="awb-select tiny" data-awb="layout" title="\u753B\u5E03\u5E03\u5C40">' + LAYOUT_OPTIONS.map(([mode, label]) => optionHtml(mode, label, this.layout === mode)).join("") + "</select>",
      '  <select class="awb-select tiny" data-awb="export-format" title="\u5BFC\u51FA\u683C\u5F0F">' + ["png", "svg", "pdf", "spec", "csv", "json", "zip"].map((fmt) => optionHtml(fmt, fmt.toUpperCase(), fmt === this.exportFormat)).join("") + "</select>",
      '  <select class="awb-select tiny" data-awb="export-scope" title="\u5BFC\u51FA\u8303\u56F4">' + optionHtml("subcanvas", "\u5F53\u524D\u753B\u5E03", this.exportScope === "subcanvas") + optionHtml("canvas", "\u5168\u90E8\u72B6\u6001", this.exportScope === "canvas") + "</select>",
      '  <button type="button" class="btn tiny" data-awb="export">\u5BFC\u51FA</button>',
      '  <button type="button" class="btn tiny primary" data-awb="run">\u8FD0\u884C' + (stale ? "\uFF08\u7ED3\u679C\u5DF2\u8FC7\u671F\uFF09" : "") + "</button>",
      "</div>"
    ].join("");
    this.toolbarHost.querySelector('[data-awb="run"]')?.addEventListener("click", () => {
      void this.run();
    });
    this.toolbarHost.querySelector('[data-awb="layout"]')?.addEventListener("change", (event) => {
      this.layout = event.target.value || "grid";
      this.applyLayout();
      this.persist();
    });
    this.toolbarHost.querySelector('[data-awb="compare-run"]')?.addEventListener("click", () => {
      void this.runCompare();
    });
    this.toolbarHost.querySelector('[data-awb="export-format"]')?.addEventListener("change", (event) => {
      this.exportFormat = String(event.target.value || "png");
    });
    this.toolbarHost.querySelector('[data-awb="export-scope"]')?.addEventListener("change", (event) => {
      this.exportScope = event.target.value === "canvas" ? "canvas" : "subcanvas";
    });
    this.toolbarHost.querySelector('[data-awb="export"]')?.addEventListener("click", () => {
      void this.exportResult();
    });
  }
  async exportResult() {
    if (!this.sessionId) {
      toast("\u5206\u6790\u4F1A\u8BDD\u5C1A\u672A\u5C31\u7EEA\uFF0C\u65E0\u6CD5\u5BFC\u51FA", "error", 4e3);
      return;
    }
    const active = this.activeState();
    if (!active) {
      toast("\u8BF7\u5148\u5FEB\u7167\u5E76\u9009\u62E9\u4E00\u4E2A\u5206\u6790\u72B6\u6001", "error", 4e3);
      return;
    }
    if (!this.lastRun && !this.session?.results?.length) {
      toast("\u8BF7\u5148\u8FD0\u884C\u5206\u6790\u518D\u5BFC\u51FA", "error", 4e3);
      return;
    }
    const allIds = this.session?.states?.map((item) => item.state_id) || [active.state_id];
    const selected = this.compareMode && this.compareSelection.size >= 2 ? [...this.compareSelection] : allIds;
    const stateIds = this.exportScope === "canvas" ? selected : [active.state_id];
    try {
      this.toolbarHost.classList.add("busy");
      const response = await workbenchExportRequest({
        session_id: this.sessionId,
        scope: this.exportScope,
        canvas_id: this.exportScope === "subcanvas" ? this.activeKind : void 0,
        state_ids: stateIds,
        kind: this.activeKind === "metrics" ? void 0 : this.activeKind,
        format: this.exportFormat,
        source_path: void 0
      });
      const disposition = response.headers.get("Content-Disposition") || "";
      const matched = /filename="?([^";]+)"?/.exec(disposition);
      const fallback = `netlab-analysis.${this.exportFormat === "spec" ? "plotkit.json" : this.exportFormat}`;
      const filename = matched ? matched[1] : fallback;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2e3);
      toast("\u5DF2\u5BFC\u51FA " + filename, "success", 3e3);
    } catch (error) {
      toast("\u5BFC\u51FA\u5931\u8D25\uFF1A" + error.message, "error", 5e3);
    } finally {
      this.toolbarHost.classList.remove("busy");
    }
  }
  cacheBadge() {
    const cache = this.lastRun?.cache;
    if (!cache) return '<span class="awb-badge">\u5C1A\u672A\u8FD0\u884C</span>';
    if (cache["stale"] === true) return '<span class="awb-badge stale">\u7ED3\u679C\u5DF2\u8FC7\u671F</span>';
    return '<span class="awb-badge">' + (cache["cached"] === true ? "\u7F13\u5B58\u547D\u4E2D" : "\u5DF2\u8BA1\u7B97") + " \xB7 " + shortFingerprint(this.lastRun?.fingerprint) + "</span>";
  }
  renderStatus() {
    const active = this.activeState();
    const run = this.lastRuns[this.activeKind] || null;
    const metrics = run?.envelope?.metrics || {};
    const summary = describeRunStatus(run?.envelope);
    const lines = [
      "\u72B6\u6001\uFF1A" + (active?.label || "\u2014"),
      "\u6307\u7EB9\uFF1A" + shortFingerprint(active?.fingerprint),
      "\u6765\u6E90\uFF1A" + summary.source,
      "\u7A33\u5B9A\uFF1A" + summary.stability
    ];
    this.statusHost.textContent = lines.join(" \xB7 ");
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
      this.lastRun = null;
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
    const input = this.navHost.querySelector('[data-awb="input"]')?.value || active?.input_source || String((this.circuit?.edges || []).find((edge) => String(edge.kind || "") === "vsource")?.name || "");
    const nodes = (this.circuit?.nodes || []).filter((node) => node.kind !== "ground");
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
      this.lastRun = null;
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
      this.lastRun = null;
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
      this.lastRun = null;
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
  async loadLoopCandidatesIfNeeded() {
    if (this.activeKind !== "loop" && this.activeKind !== "nyquist") return;
    try {
      const response = await analysisLoopsRequest({});
      this.loopCandidates = response.candidates || response.items || [];
      this.renderNav();
    } catch (error) {
      this.loopCandidates = [];
    }
  }
  async run() {
    if (this.busy) return;
    const active = this.activeState();
    if (!active || !this.sessionId) {
      toast("\u8BF7\u5148\u5FEB\u7167\u5F53\u524D\u7535\u8DEF\u5E76\u9009\u62E9\u72B6\u6001", "error", 4e3);
      return;
    }
    this.busy = true;
    this.toolbarHost.classList.add("busy");
    try {
      if (this.activeKind === "metrics") {
        const response = await workbenchRunRequest({ session_id: this.sessionId, state_id: active.state_id, kind: "metrics", params: {} });
        this.lastRun = response;
        this.lastRuns[this.activeKind] = response;
        this.renderMetrics(response.raw || {});
      } else {
        const params = await this.runParams();
        if (!params) return;
        const response = await workbenchRunRequest({ session_id: this.sessionId, state_id: active.state_id, kind: this.activeKind, params });
        if (!response.envelope || !isAnalysisEnvelope(response.envelope)) throw new Error("\u540E\u7AEF\u672A\u8FD4\u56DE\u5408\u6CD5\u5206\u6790\u4FE1\u5C01");
        this.lastRun = response;
        this.lastRuns[this.activeKind] = response;
        this.workspace?.activateKind(this.activeKind);
        this.workspace?.setEnvelope(this.activeKind, response.envelope);
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
  async runParams() {
    const input = this.navHost.querySelector('[data-awb="input"]')?.value || "";
    const output = this.navHost.querySelector('[data-awb="output"]')?.value || "";
    if (!input || !output) {
      toast("\u8BF7\u9009\u62E9\u8F93\u5165\u6E90\u4E0E\u8F93\u51FA\u8282\u70B9", "error", 4e3);
      return null;
    }
    const params = {
      input_source: input,
      output,
      f_start: this.params.f_start,
      f_stop: this.params.f_stop,
      points: Math.round(this.params.points),
      step_dt: this.params.step_dt,
      step_duration: this.params.step_duration
    };
    if (this.activeKind === "bode" || this.activeKind === "poles") params.frequency_path = this.frequencyPath;
    const loopKind = this.activeKind === "loop" || this.activeKind === "loop_closed" || this.activeKind === "loop_step";
    if (loopKind || this.activeKind === "nyquist") {
      const select = this.navHost.querySelector('[data-awb="element"]');
      let element = select?.value || "";
      if (element === "__virtual__" && !loopKind) element = "";
      if (!element && this.loopCandidates.length) element = String(this.loopCandidates[0].element || "");
      if (!element && !loopKind) {
        await this.loadLoopCandidatesIfNeeded();
        element = String(this.loopCandidates[0]?.element || "");
      }
      if (!element && loopKind) element = "__virtual__";
      if (!element) {
        toast("Nyquist \u5206\u6790\u9700\u8981\u9009\u62E9\u4E00\u4E2A\u53D7\u63A7\u6E90\u4F5C\u4E3A\u65AD\u73AF\u70B9\uFF08VCVS/VCCS\uFF09", "error", 5e3);
        return null;
      }
      params.element = element;
      params.feedback_sign = this.params.feedback_sign;
    }
    return params;
  }
  async runCompare() {
    const ids = Array.from(this.compareSelection);
    if (ids.length < 2) {
      toast("\u5BF9\u6BD4\u81F3\u5C11\u9009\u62E9\u4E24\u4E2A\u72B6\u6001", "warn", 4e3);
      return;
    }
    if (this.busy || !this.sessionId) return;
    this.busy = true;
    try {
      const params = await this.runParams();
      if (!params) return;
      const results = [];
      for (const stateId of ids.slice(0, 8)) {
        const response = await workbenchRunRequest({ session_id: this.sessionId, state_id: stateId, kind: this.activeKind, params });
        if (response.envelope && isAnalysisEnvelope(response.envelope)) {
          const label = this.session?.states.find((item) => item.state_id === stateId)?.label || stateId;
          results.push({ state_id: stateId, label, envelope: response.envelope });
        }
      }
      if (results.length < 2) throw new Error("\u81F3\u5C11\u4E24\u4E2A\u72B6\u6001\u8FD4\u56DE\u4E86\u53EF\u5BF9\u6BD4\u7ED3\u679C");
      const merged = this.mergeEnvelopes(results);
      this.workspace?.activateKind(this.activeKind);
      this.workspace?.setEnvelope(this.activeKind, merged);
      this.renderCompareTable(results);
      this.statusHost.textContent = "\u5BF9\u6BD4 " + results.length + " \u4E2A\u72B6\u6001 \xB7 " + KIND_LABELS[this.activeKind];
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
  onCursor(frequency, source, canvasId = "") {
    if (frequency === null) return;
    this.workspace?.setCursor(frequency, canvasId);
    this.statusHost.textContent = "\u5149\u6807 f = " + frequency.toPrecision(7) + " Hz \xB7 " + source;
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
  applyLayout() {
    this.host.dataset.layout = this.layout;
    this.workspace?.setLayout(this.layout, false);
  }
  persist() {
    try {
      const uiState = state.ui;
      const canvases = this.workspace?.persist() || [];
      uiState.analysis_workbench = writeWorkbenchUi({
        schema: "netlab-analysis-workbench/1",
        active_analysis: this.activeKind,
        canvases,
        layout: { mode: this.layout, rows: 1, cols: 1, order: canvases.map((item) => item.canvas_id) },
        sizes: this.sizes,
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
