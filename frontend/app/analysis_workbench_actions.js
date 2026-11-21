import { transferSummaryHtml } from "./analysis_workbench_results.js";
import { LAYOUT_PRESETS } from "./analysis_workbench_layout_tree.js";
import { workbenchExportRequest } from "./analysis_client.js";
import { toast } from "./desktop.js";
import {
  KIND_LABELS,
  describeRunStatus,
  escapeHtml,
  optionHtml,
  shortFingerprint,
  loopFeedbackOutput
} from "./analysis_workbench_meta.js";
class WorkbenchActions {
  constructor() {
    this.workspace = null;
    this.session = null;
    this.sessionId = "";
    this.params = { f_start: 1, f_stop: 1e5, points: 121, step_dt: 1e-5, step_duration: 5e-3, feedback_sign: 1 };
    this.frequencyPath = "descriptor_linearized";
    this.loopCandidates = [];
    this.busy = false;
    this.compareMode = false;
    this.compareSelection = /* @__PURE__ */ new Set();
    this.lastRuns = {};
    this.exportFormat = "png";
    this.exportScope = "subcanvas";
    this.lastCursor = null;
  }
  renderToolbar() {
    const active = this.activeState();
    const kind = this.currentKind();
    const selected = this.selectedCanvas();
    const hasCanvas = Boolean(selected);
    const cache = this.runForCanvas(this.workspace?.activeCanvas?.canvas_id)?.cache;
    const stale = cache && cache["stale"] === true;
    this.toolbarHost.innerHTML = [
      '<div class="awb-toolbar-title"><b>' + (hasCanvas ? KIND_LABELS[kind] : "\u672A\u9009\u62E9\u753B\u5E03") + "</b><span>" + escapeHtml(hasCanvas ? selected?.title || active?.label || "\u2014" : "\u8BF7\u9009\u62E9\u6216\u65B0\u5EFA\u753B\u5E03") + "</span></div>",
      '<div class="awb-toolbar-meta">' + this.cacheBadge() + "</div>",
      '<div class="awb-toolbar-actions">',
      this.compareMode ? '<button type="button" class="btn tiny" data-awb="compare-run">\u5BF9\u6BD4\u9009\u4E2D\u72B6\u6001</button>' : "",
      '  <button type="button" class="btn tiny awb-icon-btn" data-awb="sidebar-collapse" title="\u6298\u53E0/\u5C55\u5F00\u5DE6\u4FA7\u5BFC\u822A">\u25E7</button>',
      '  <button type="button" class="btn tiny awb-icon-btn" data-awb="detail-collapse" title="\u6298\u53E0/\u5C55\u5F00\u53F3\u4FA7\u8BE6\u60C5">\u25E8</button>',
      '  <button type="button" class="btn tiny awb-icon-btn" data-awb="focus" title="\u4E13\u6CE8\u6A21\u5F0F\uFF08Esc \u9000\u51FA\uFF09">\u26F6</button>',
      '  <select class="awb-select tiny" data-awb="layout" title="\u753B\u5E03\u5E03\u5C40">' + LAYOUT_PRESETS.map(([preset, label]) => optionHtml(preset, label, (this.workspace?.layout || "auto") === preset)).join("") + "</select>",
      '  <select class="awb-select tiny" data-awb="export-format" title="\u5BFC\u51FA\u683C\u5F0F">' + ["png", "svg", "pdf", "spec", "csv", "json", "zip"].map((fmt) => optionHtml(fmt, fmt.toUpperCase(), fmt === this.exportFormat)).join("") + "</select>",
      '  <select class="awb-select tiny" data-awb="export-scope" title="\u5BFC\u51FA\u8303\u56F4">' + optionHtml("subcanvas", "\u5F53\u524D\u753B\u5E03", this.exportScope === "subcanvas") + optionHtml("canvas", "\u5168\u90E8\u72B6\u6001", this.exportScope === "canvas") + "</select>",
      '  <button type="button" class="btn tiny" data-awb="export"' + (hasCanvas ? "" : " disabled") + ">\u5BFC\u51FA</button>",
      '  <button type="button" class="btn tiny primary" data-awb="run"' + (hasCanvas ? "" : " disabled") + ">\u8FD0\u884C" + (stale ? "\uFF08\u7ED3\u679C\u5DF2\u8FC7\u671F\uFF09" : "") + "</button>",
      "</div>"
    ].join("");
    this.toolbarHost.querySelector('[data-awb="run"]')?.addEventListener("click", () => {
      void this.run();
    });
    this.toolbarHost.querySelector('[data-awb="layout"]')?.addEventListener("change", (event) => {
      this.setLayoutPreset(event.target.value || "auto");
    });
    this.toolbarHost.querySelector('[data-awb="sidebar-collapse"]')?.addEventListener("click", () => this.toggleSidebar());
    this.toolbarHost.querySelector('[data-awb="detail-collapse"]')?.addEventListener("click", () => this.toggleDetail());
    this.toolbarHost.querySelector('[data-awb="focus"]')?.addEventListener("click", () => this.toggleFocus());
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
    const kind = this.currentKind();
    const canvas = this.selectedCanvas();
    if (this.exportScope === "subcanvas" && !canvas) {
      toast("\u8BF7\u9009\u62E9\u4E00\u4E2A\u753B\u5E03\u540E\u518D\u5BFC\u51FA", "error", 4e3);
      return;
    }
    if (!this.runForCanvas(canvas?.canvas_id) && !this.session?.results?.length) {
      toast("\u8BF7\u5148\u8FD0\u884C\u5206\u6790\u518D\u5BFC\u51FA", "error", 4e3);
      return;
    }
    const allIds = this.session?.states?.map((item) => item.state_id) || [active.state_id];
    const compared = this.compareMode && this.compareSelection.size >= 2 ? [...this.compareSelection] : allIds;
    const stateIds = this.exportScope === "canvas" ? compared : [active.state_id];
    const resultIds = this.exportScope === "subcanvas" ? canvas?.result_keys?.length ? canvas.result_keys : canvas?.result_key ? [canvas.result_key] : void 0 : void 0;
    try {
      this.toolbarHost.classList.add("busy");
      const response = await workbenchExportRequest({
        session_id: this.sessionId,
        scope: this.exportScope,
        canvas_id: this.exportScope === "subcanvas" ? canvas?.canvas_id || kind : void 0,
        state_ids: stateIds,
        kind: kind === "metrics" ? void 0 : kind,
        format: this.exportFormat,
        ...resultIds ? { result_ids: resultIds } : {},
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
  runForCanvas(canvasId) {
    if (!canvasId) return null;
    return this.lastRuns[canvasId] || null;
  }
  cacheBadge() {
    if (!this.workspace?.activeCanvas) return '<span class="awb-badge">\u672A\u9009\u62E9\u753B\u5E03</span>';
    const run = this.runForCanvas(this.workspace.activeCanvas.canvas_id);
    const cache = run?.cache;
    if (!cache) return '<span class="awb-badge">\u5C1A\u672A\u8FD0\u884C</span>';
    if (cache["stale"] === true) return '<span class="awb-badge stale">\u7ED3\u679C\u5DF2\u8FC7\u671F</span>';
    return '<span class="awb-badge">' + (cache["cached"] === true ? "\u7F13\u5B58\u547D\u4E2D" : "\u5DF2\u8BA1\u7B97") + " \xB7 " + shortFingerprint(run?.fingerprint) + "</span>";
  }
  renderStatus() {
    if (!this.workspace?.activeCanvas) {
      if (this.transferHost) this.transferHost.innerHTML = "";
      this.statusHost.textContent = "\u672A\u9009\u62E9\u753B\u5E03";
      return;
    }
    const active = this.activeState();
    const run = this.runForCanvas(this.workspace.activeCanvas.canvas_id);
    const summary = describeRunStatus(run?.envelope);
    if (this.transferHost) this.transferHost.innerHTML = transferSummaryHtml(run?.raw);
    const lines = [
      "\u72B6\u6001\uFF1A" + (active?.label || "\u2014"),
      "\u6307\u7EB9\uFF1A" + shortFingerprint(active?.fingerprint),
      "\u6765\u6E90\uFF1A" + summary.source,
      "\u7A33\u5B9A\uFF1A" + summary.stability
    ];
    if (this.lastCursor) {
      lines.push("\u5149\u6807\uFF1A" + this.lastCursor.frequency.toPrecision(7) + (this.lastCursor.unit ? " " + this.lastCursor.unit : ""));
    }
    this.statusHost.textContent = lines.join(" \xB7 ");
  }
  async runParams(kind = this.currentKind()) {
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
    if (kind === "bode" || kind === "poles") params.frequency_path = this.frequencyPath;
    const loopKind = kind === "loop" || kind === "loop_closed" || kind === "loop_step";
    if (loopKind || kind === "nyquist") {
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
      const feedbackOutput = loopFeedbackOutput(this.loopCandidates, element, output);
      if (feedbackOutput && feedbackOutput !== output) {
        params.output = feedbackOutput;
        const outputSelect = this.navHost.querySelector('[data-awb="output"]');
        if (outputSelect) outputSelect.value = feedbackOutput;
        toast(`\u95ED\u73AF\u5206\u6790\u8F93\u51FA\u5DF2\u81EA\u52A8\u6539\u4E3A\u53CD\u9988\u8282\u70B9 ${feedbackOutput}\uFF08\u907F\u514D\u53D6\u5230\u76D1\u6D4B\u7EA7\u5BFC\u81F4\u73AF\u8DEF\u4E00\u81F4\u6027\u544A\u8B66\uFF09`, "warn", 6e3);
      }
    }
    return params;
  }
}
export {
  WorkbenchActions
};
