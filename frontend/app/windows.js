import { activeTab } from "./model.js";
import { closeAnalysis, runOperatingPoint, selectAnalTab } from "./ac_analysis.js";
import { closeDoc, searchDocs } from "./docs.js";
import { openAnalysisWorkbench } from "./analysis_workbench.js";
import { closePlotkit, closeVscode, layoutPlotkitWindow, maybePrewarmVscode, placePlotkit, togglePlotkitDock } from "./plotkit_frame.js";
import { initFloatWindow } from "./float.js";
import { $, $$ } from "./dom.js";
import { state, ui } from "./state.js";
let windowActions = {
  renderCompareGrid: (..._args) => {
  },
  setWbSignalDock: (..._args) => {
  },
  syncProjectContext: (..._args) => {
  },
  getWbComparePayload: () => null
};
function setWindowActions(actions) {
  windowActions = actions;
}
function initAnalWin() {
  const win = $("#analWin");
  if (!win) return;
  win.querySelector("#analWinClose")?.addEventListener("click", closeAnalysis);
  for (const btn of $$(".anal-tab")) {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.anal || "op";
      selectAnalTab(tab);
      if (tab === "workbench") openAnalysisWorkbench();
    });
  }
  $("#analRunOp")?.addEventListener("click", () => void runOperatingPoint());
  initFloatWindow(win, "analGeo", { minWidth: 560, minHeight: 420 });
  window.addEventListener("resize", () => {
    if (!win.hidden) window.dispatchEvent(new CustomEvent("netlab:analysis-resize"));
  });
}
function initDocWin() {
  if (!ui.docWin) return;
  ui.docWin.querySelector("#docWinClose")?.addEventListener("click", closeDoc);
  ui.docSearch?.addEventListener("input", () => searchDocs(ui.docSearch.value));
  ui.docSearch?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const first = ui.docResults.querySelector(".doc-hit");
      if (first) first.click();
    }
    if (event.key === "Escape") {
      ui.docSearch.value = "";
      searchDocs("");
    }
  });
  initFloatWindow(ui.docWin, "docGeo", { minWidth: 420, minHeight: 320 });
  const plotkitWin = $("#plotkitWin");
  if (plotkitWin) {
    initFloatWindow(plotkitWin, "plotkitGeo", { minWidth: 720, minHeight: 480 });
    $("#plotkitWinClose")?.addEventListener("click", closePlotkit);
    $("#plotkitDock")?.addEventListener("click", togglePlotkitDock);
    window.addEventListener("resize", () => {
      if (state.plotkitDock && !plotkitWin.hidden) layoutPlotkitWindow();
    });
    $("#btnOpenPlotkit")?.addEventListener("click", () => placePlotkit("float"));
    $("#btnPlotkitInline")?.addEventListener("click", () => placePlotkit("inline"));
    $("#btnPlotkitPopup")?.addEventListener("click", () => placePlotkit("popup"));
    $("#plotkitPopout")?.addEventListener("click", () => {
      closePlotkit();
      placePlotkit("popup");
    });
  }
  const vscodeWin = $("#vscodeWin");
  if (vscodeWin) {
    initFloatWindow(vscodeWin, "vscodeGeo", { minWidth: 720, minHeight: 520 });
    $("#vscodeWinClose")?.addEventListener("click", closeVscode);
    maybePrewarmVscode();
  }
  const wbSignalWin = $("#wbSignalWin");
  if (wbSignalWin) {
    initFloatWindow(wbSignalWin, "wbSignalGeo", { minWidth: 280, minHeight: 320 });
    $("#wbSignalWinClose")?.addEventListener("click", () => windowActions.setWbSignalDock(true));
    $("#wbSignalDockBtn")?.addEventListener("click", () => windowActions.setWbSignalDock(true));
    window.addEventListener("resize", () => {
      if (activeTab() === "wb-analysis" && windowActions.getWbComparePayload()) windowActions.renderCompareGrid();
    });
  }
  void windowActions.syncProjectContext();
}
export {
  initAnalWin,
  initDocWin,
  setWindowActions
};
