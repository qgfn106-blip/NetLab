import { $, $$ } from "./dom.js";
import { state } from "./state.js";
import { setGroupSub, setPanelGroup } from "./ui_helpers.js";
import { openSettings } from "./settings_guide.js";
import { renderExtensionPanel, renderSpecPane } from "./spec_panel.js";
import { drawPhase, renderVectorNodeList, resizePhase } from "./phase.js";
import { requestDraw } from "./canvas_render.js";
import { renderWorkbenchAnalysis, renderWorkbenchState } from "./analysis_workbench_panel.js";
let deps;
const PANEL_GROUPS = {
  inspect: { group: "inspect" },
  "node-fn": { group: "fn", role: "node" },
  "edge-fn": { group: "fn", role: "edge" },
  spec: { group: "fn" },
  blocks: { group: "modules", sub: "blocks" },
  ext: { group: "modules", sub: "ext" },
  chart: { group: "analysis", sub: "chart" },
  inst: { group: "analysis", sub: "inst" },
  vector: { group: "analysis", sub: "vector" },
  analysis: { group: "analysis", sub: "analysis" },
  plotkit: { group: "analysis", sub: "plotkit" },
  "wb-analysis": { group: "workbench", sub: "wb-analysis" },
  "wb-state": { group: "workbench", sub: "wb-state" }
};
function defaultTabForGroup(group) {
  if (group === "fn") return state.fnRole === "edge" ? "edge-fn" : "node-fn";
  if (group === "modules") {
    const sub = $('.panel-group[data-group="modules"] .group-subnav [data-sub].active');
    return sub ? sub.dataset.sub : "blocks";
  }
  if (group === "analysis") {
    const sub = $('.panel-group[data-group="analysis"] .group-subnav [data-sub].active');
    return sub ? sub.dataset.sub : "chart";
  }
  if (group === "workbench") {
    const sub = $('.panel-group[data-group="workbench"] .group-subnav [data-sub].active');
    return sub ? sub.dataset.sub : "wb-analysis";
  }
  return "inspect";
}
function switchTab(name) {
  if (name === "scene") {
    openSettings("project");
    return;
  }
  const conf = PANEL_GROUPS[name] || PANEL_GROUPS.inspect;
  if (conf.role) {
    state.fnRole = conf.role;
    state.specKind = "";
    setGroupSub("fn", conf.role);
  }
  setPanelGroup(conf.group);
  if (conf.sub) setGroupSub(conf.group, conf.sub);
  if (conf.group === "fn") {
    const note = $("#fnNote");
    if (note) note.textContent = state.fnRole === "edge" ? "\u8FDE\u63A5\u51FD\u6570" : "\u8282\u70B9\u51FD\u6570";
    renderSpecPane();
    requestDraw();
  }
  if (conf.sub === "chart") {
    deps.resizeChart();
    deps.scheduleChartDraw();
  }
  if (conf.sub === "vector") {
    resizePhase();
    renderVectorNodeList();
    drawPhase();
  }
  if (conf.sub === "plotkit") {
    $("#btnOpenPlotkit")?.focus({ preventScroll: true });
  }
  deps.notifyPlotkit(conf.sub === "plotkit");
  if (conf.sub === "analysis") deps.renderAnalysisPanel();
  if (conf.sub === "wb-analysis") renderWorkbenchAnalysis();
  if (conf.sub === "wb-state") void renderWorkbenchState();
  if (conf.sub === "blocks") deps.renderBlocksPanel();
  if (conf.sub === "ext") renderExtensionPanel();
}
function bindPanelNavigation() {
  $$(".panel-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const group = tab.dataset.group;
      switchTab(group === "inspect" ? "inspect" : defaultTabForGroup(group));
    });
  });
  $$("#panel .group-subnav").forEach((nav) => {
    nav.addEventListener("click", (event) => {
      const target = event.target.closest("button");
      if (!target) return;
      if (target.dataset.fnrole) {
        state.fnRole = target.dataset.fnrole;
        state.specKind = "";
        switchTab(target.dataset.fnrole === "edge" ? "edge-fn" : "node-fn");
      } else if (target.dataset.sub) {
        switchTab(target.dataset.sub);
      }
    });
  });
  setPanelGroup("inspect");
  setGroupSub("modules", "blocks");
  setGroupSub("analysis", "chart");
  setGroupSub("workbench", "wb-analysis");
}
function initRouter(d) {
  deps = d;
  return { switchTab, bindPanelNavigation };
}
export {
  bindPanelNavigation,
  initRouter,
  switchTab
};
