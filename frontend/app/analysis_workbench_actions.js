import { transferSummaryHtml } from "./analysis_workbench_results.js";
import { LAYOUT_PRESETS } from "./analysis_workbench_layout_tree.js";
import { analysisLoopCandidatesRequest, analysisLoopFromBreakRequest, analysisLoopsRequest, workbenchExportRequest } from "./analysis_client.js";
import { callBridge, isDesktop, toast } from "./desktop.js";
import {
  KIND_LABELS,
  describeRunStatus,
  escapeHtml,
  optionHtml,
  shortFingerprint,
  loopFeedbackOutput
} from "./analysis_workbench_meta.js";
import { controlledBreakForGroup } from "./analysis_workbench_loops.js";
class WorkbenchActions {
  constructor() {
    this.workspace = null;
    this.session = null;
    this.sessionId = "";
    this.params = { f_start: 1, f_stop: 1e5, points: 121, step_dt: 1e-5, step_duration: 5e-3, feedback_sign: 1 };
    this.frequencyPath = "descriptor_linearized";
    this.loopCandidates = [];
    this.loopGroups = [];
    this.selectedLoopId = "";
    this.selectedLoopGroup = null;
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
      hasCanvas ? '  <button type="button" class="btn tiny awb-icon-btn" data-awb="chart-settings" title="\u56FE\u8868\u8BBE\u7F6E\uFF08\u6807\u9898/\u5750\u6807\u8F74/\u7F51\u683C/\u56FE\u4F8B\uFF09">\u2699</button>' : "",
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
    this.toolbarHost.querySelector('[data-awb="chart-settings"]')?.addEventListener("click", () => {
      const id = this.selectedCanvas()?.canvas_id;
      if (id) this.workspace?.openChartSettings(id);
    });
  }
  async saveBlobViaDesktop(blob, filename) {
    if (!isDesktop()) return "unsupported";
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    const chunk = 32768;
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
    }
    const result = await callBridge("saveBytes", [filename, btoa(binary)]);
    if (typeof result !== "string") return "unsupported";
    if (result.startsWith("__error__")) throw new Error(result.slice("__error__".length));
    return result ? "saved" : "cancelled";
  }
  previewExport(blob, filename, format) {
    if (!["png", "svg", "pdf"].includes(format)) return Promise.resolve(true);
    const url = URL.createObjectURL(blob);
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "awb-export-preview";
      const card = document.createElement("div");
      card.className = "awb-export-preview-card";
      const heading = document.createElement("div");
      heading.className = "awb-export-preview-head";
      heading.textContent = "\u5BFC\u51FA\u9884\u89C8 \xB7 " + filename;
      const body = document.createElement("div");
      body.className = "awb-export-preview-body";
      if (format === "pdf") {
        const frame = document.createElement("iframe");
        frame.src = url;
        frame.title = filename;
        body.append(frame);
      } else {
        const image = document.createElement("img");
        image.src = url;
        image.alt = filename;
        body.append(image);
      }
      const actions = document.createElement("div");
      actions.className = "awb-export-preview-actions";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "btn";
      cancel.textContent = "\u53D6\u6D88";
      const save = document.createElement("button");
      save.type = "button";
      save.className = "btn primary";
      save.textContent = "\u4FDD\u5B58";
      actions.append(cancel, save);
      card.append(heading, body, actions);
      overlay.append(card);
      document.body.append(overlay);
      const close = (confirmed) => {
        document.removeEventListener("keydown", onKey, true);
        overlay.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 500);
        resolve(confirmed);
      };
      const onKey = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close(false);
        }
      };
      cancel.addEventListener("click", () => close(false));
      save.addEventListener("click", () => close(true));
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) close(false);
      });
      document.addEventListener("keydown", onKey, true);
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
        ...this.exportScope === "subcanvas" && canvas?.appearance ? { appearance: canvas.appearance } : {},
        source_path: void 0
      });
      const disposition = response.headers.get("Content-Disposition") || "";
      const matched = /filename="?([^";]+)"?/.exec(disposition);
      const fallback = `netlab-analysis.${this.exportFormat === "spec" ? "plotkit.json" : this.exportFormat}`;
      const filename = matched ? matched[1] : fallback;
      const blob = await response.blob();
      if (!await this.previewExport(blob, filename, this.exportFormat)) {
        toast("\u5DF2\u53D6\u6D88\u5BFC\u51FA", "info", 3e3);
        return;
      }
      const saved = await this.saveBlobViaDesktop(blob, filename);
      if (saved === "saved") {
        toast("\u5DF2\u4FDD\u5B58 " + filename, "success", 3e3);
        return;
      }
      if (saved === "cancelled") {
        toast("\u5DF2\u53D6\u6D88\u5BFC\u51FA", "info", 3e3);
        return;
      }
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
  async loadLoopCandidatesIfNeeded() {
    if (!["loop", "loop_closed", "loop_step", "nyquist", "step_open"].includes(this.activeAnalysisKind())) return;
    try {
      const response = await analysisLoopsRequest({});
      const branches = response.branch_candidates || [];
      this.loopCandidates = [...branches, ...response.candidates || response.items || []];
      this.refreshNavigation();
    } catch (error) {
      this.loopCandidates = [];
    }
  }
  async loadLoopGroupsIfNeeded() {
    if (this.activeAnalysisKind() !== "loop") return;
    try {
      const response = await analysisLoopCandidatesRequest({});
      this.loopGroups = response.loops || [];
      this.refreshNavigation();
    } catch (error) {
      this.loopGroups = [];
    }
  }
  /** 一次点击选中整条环路：记住成员与建议断点，并把可用的受控源断点同步到断环元件下拉。 */
  selectLoopGroup(group) {
    this.selectedLoopGroup = group;
    this.selectedLoopId = String(group.loop_id || "");
    this.params.feedback_sign = Number(group.feedback_sign) === -1 ? -1 : 1;
    const element = controlledBreakForGroup(group, this.loopCandidates);
    this.refreshNavigation();
    const select = this.navHost.querySelector('[data-awb="element"]');
    if (element && select) select.value = element;
    if (!element) {
      toast("\u8BE5\u73AF\u8DEF\u6CA1\u6709\u53EF\u65AD\u5F00\u7684 VCVS/VCCS \u53D7\u63A7\u6E90\uFF0C\u65E0\u6CD5\u5B9A\u4E49\u552F\u4E00\u5F00\u73AF L(s)\uFF0C\u4EC5\u663E\u793A\u95ED\u73AF T(s)", "info", 6e3);
    }
  }
  /** 电路模式：用户点选一条反馈支路后，由后端搜索包含它的闭合环并加入缩略图。 */
  async loopFromBreak(breakId) {
    if (!breakId) return;
    try {
      const response = await analysisLoopFromBreakRequest({ break_id: breakId });
      if (response.ok === false || !response.loop) {
        toast(String(response.reason || "\u8BE5\u652F\u8DEF\u4E0D\u5728\u95ED\u5408\u53CD\u9988\u73AF\u4E2D"), "error", 5e3);
        return;
      }
      const group = response.loop;
      const groupId = String(group.loop_id || "");
      this.loopGroups = [group, ...this.loopGroups.filter((item) => String(item.loop_id || "") !== groupId)];
      this.selectLoopGroup(group);
      await this.loadLoopCandidatesIfNeeded();
    } catch (error) {
      toast("\u6309\u652F\u8DEF\u9009\u73AF\u5931\u8D25\uFF1A" + (error instanceof Error ? error.message : String(error)), "error", 5e3);
    }
  }
  /** 绑定缩略图与候选断点的点击：一次点击选中整环或按支路搜索闭合环。 */
  bindLoopNavHandlers() {
    this.navHost.querySelectorAll("[data-loop-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.getAttribute("data-loop-id") || "";
        const group = this.loopGroups.find((item) => String(item.loop_id || "") === id);
        if (group) this.selectLoopGroup(group);
      });
    });
    this.navHost.querySelectorAll("[data-loop-break]").forEach((button) => {
      button.addEventListener("click", () => {
        void this.loopFromBreak(button.getAttribute("data-loop-break") || "");
      });
    });
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
    const openLoopKind = kind === "loop" || kind === "step_open";
    const closedLoopKind = kind === "loop_closed" || kind === "loop_step";
    const loopKind = openLoopKind || closedLoopKind;
    if (loopKind || kind === "nyquist") {
      const select = this.navHost.querySelector('[data-awb="element"]');
      let element = select?.value || "";
      if (this.selectedLoopGroup) {
        const loopElement = controlledBreakForGroup(this.selectedLoopGroup, this.loopCandidates);
        if (loopElement) element = loopElement;
      }
      if (element === "__virtual__" && !closedLoopKind) element = "";
      if (!element && this.loopCandidates.length) element = String(this.loopCandidates[0].element || "");
      if (!element && !loopKind) {
        await this.loadLoopCandidatesIfNeeded();
        element = String(this.loopCandidates[0]?.element || "");
      }
      if (!element && openLoopKind) {
        await this.loadLoopCandidatesIfNeeded();
        element = String(this.loopCandidates[0]?.element || "");
      }
      if (!element && openLoopKind) {
        toast("\u73AF\u8DEF\u5206\u6790\u5FC5\u987B\u9009\u62E9\u5B9E\u4F53\u65AD\u73AF\u70B9\uFF1B\u672A\u65AD\u73AF\u65E0\u6CD5\u6C42\u5F00\u73AF L(s)", "error", 5e3);
        return null;
      }
      if (!element && closedLoopKind && this.selectedLoopGroup) {
        toast("\u6240\u9009\u73AF\u8DEF\u4E0D\u542B VCVS/VCCS \u53D7\u63A7\u6E90\uFF0C\u65E0\u6CD5\u5B9A\u4E49\u552F\u4E00\u5F00\u73AF L(s)\uFF0C\u4EC5\u663E\u793A\u95ED\u73AF T(s)", "info", 5e3);
      }
      if (!element && closedLoopKind) element = "__virtual__";
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
