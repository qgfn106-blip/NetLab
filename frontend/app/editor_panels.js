import { clamp } from "../app.utils.js";
import { $, $$, canvas, chartCanvas } from "./dom.js";
import { drawChart } from "./chart_draw.js";
import { state, ui } from "./state.js";
import { clearScene, openExport } from "./scene_actions.js";
import { nearestFrame, recordingStale, stopReplayTimer, updateReplayUI, enterReplay, leaveReplay, toggleReplayPlayback, setWorkspaceButtons } from "./analysis_replay.js";
import { decodeProbeKey, renderSignalList } from "./signal_list.js";
import { isFormTarget } from "./ui.js";
import { toast } from "./desktop.js";
import { requestDraw } from "./canvas_render.js";
import { drawPhase, phaseFrameCount, phaseStateKeys, resizePhase, setPhaseIndex, stopPhasePlay, togglePhasePlay } from "./phase.js";
import { markProjectDirty, saveProject } from "./project.js";
import { sendPhaseToPlotKit, exportAnalysisCsv } from "./analysis.js";
import { closeModal } from "./dialogs_build.js";
import { selectAll, copySelection, pasteClipboard, undo, redo } from "./commands.js";
import { updateInfoBar } from "./shell_view.js";
import { SHELL_KEYS } from "./editor_consts.js";
import { bindPanelNavigation, syncChromeEdges, initNetworkSidebar } from "./editor_runtime.js";
import { colorForKey, fitView, resizeChart, resizeGraph, zoomCenter, initMenus, control, openPrecomputeDialog, shutdownApp, switchWorkspace, centerPlacement, closePopups, openAddMenu, showHelp, autoLayout, deleteSelection, cancelWireTool, scheduleChartDraw } from "./editor_services.js";
function initStatusToggles() {
  const bind = (id, key, label) => {
    const node = $(`#${id}`);
    if (!node) return;
    const sync = () => {
      const active = Boolean(state.ui?.[key]);
      node.classList.toggle("active", active);
      if (label) node.textContent = label(active);
    };
    node.addEventListener("click", () => {
      state.ui[key] = !state.ui[key];
      sync();
      markProjectDirty();
      requestDraw();
      toast(`${node.textContent}\uFF1A${state.ui[key] ? "\u5F00" : "\u5173"}`, "info", 1600);
    });
    sync();
  };
  bind("stGrid", "showGrid");
  bind("stSnap", "snap");
  bind("stSnapMark", "snapMarkers");
  bind("stOrtho", "circuitOrthogonal");
  bind("stDrawing", "drawingMode");
  const styleBtn = $("#stNodeStyle");
  if (styleBtn) {
    const labels = { circle: "\u8282\u70B9\xB7\u5706", dot: "\u8282\u70B9\xB7\u70B9", box: "\u8282\u70B9\xB7\u6846" };
    const order = ["circle", "dot", "box"];
    const sync = () => {
      styleBtn.textContent = labels[state.ui.nodeStyle || "circle"];
    };
    styleBtn.addEventListener("click", () => {
      const index = order.indexOf(state.ui.nodeStyle || "circle");
      state.ui.nodeStyle = order[(index + 1) % order.length];
      sync();
      markProjectDirty();
      requestDraw();
      toast(`\u8282\u70B9\u6837\u5F0F\uFF1A${styleBtn.textContent}`, "info", 1800);
    });
    sync();
  }
}
function applyPanelHidden(hidden, persist = true) {
  ui.main.classList.toggle("panel-hidden", hidden);
  ui.panel?.classList.toggle("collapsed", hidden);
  if (ui.panelHanger) {
    ui.panelHanger.textContent = hidden ? "\u2039" : "\u203A";
    ui.panelHanger.title = hidden ? "\u5C55\u5F00\u53F3\u4FA7\u9762\u677F" : "\u6536\u8D77\u53F3\u4FA7\u9762\u677F";
    ui.panelHanger.setAttribute("aria-expanded", hidden ? "false" : "true");
  }
  if (persist) {
    try {
      localStorage.setItem(SHELL_KEYS.panelCollapsed, hidden ? "1" : "0");
    } catch (error) {
    }
  }
  setTimeout(() => {
    syncChromeEdges();
    resizeGraph();
    resizeChart();
    resizePhase();
  }, 60);
}
function togglePanel() {
  applyPanelHidden(!ui.main.classList.contains("panel-hidden"));
}
function initPanelChrome() {
  let hidden = false;
  let width = 0;
  try {
    hidden = localStorage.getItem(SHELL_KEYS.panelCollapsed) === "1";
    width = Number(localStorage.getItem(SHELL_KEYS.panelWidth)) || 0;
  } catch (error) {
    hidden = false;
  }
  if (width >= 260 && width <= 720) ui.main.style.setProperty("--panel-w", `${Math.round(width)}px`);
  applyPanelHidden(hidden, false);
  ui.panelHanger?.addEventListener("click", togglePanel);
  const handle = ui.panelResize;
  if (!handle) return;
  let dragging = false;
  let startX = 0;
  let startWidth = 0;
  const panelVar = () => "--panel-w";
  const currentWidth = () => {
    const rect = ui.panel?.getBoundingClientRect();
    if (rect && rect.width > 0) return rect.width;
    const value = parseFloat(getComputedStyle(ui.main).getPropertyValue(panelVar()));
    return Number.isFinite(value) && value > 0 ? value : 388;
  };
  handle.addEventListener("pointerdown", (event) => {
    if (ui.main.classList.contains("panel-hidden")) return;
    dragging = true;
    startX = event.clientX;
    startWidth = currentWidth();
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add("panel-dragging");
    event.preventDefault();
  });
  handle.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const next = clamp(Math.round(startWidth - (event.clientX - startX)), 260, 720);
    ui.main.style.setProperty(panelVar(), `${next}px`);
    ui.main.style.setProperty("--panel-edge", `${next}px`);
  });
  const finish = (event) => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("panel-dragging");
    try {
      localStorage.setItem(SHELL_KEYS.panelWidth, String(Math.round(currentWidth())));
    } catch (error) {
    }
    syncChromeEdges();
    resizeGraph();
    resizeChart();
    resizePhase();
    if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  };
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
}
function initShell() {
  initMenus();
  initNetworkSidebar();
  initPanelChrome();
  updateInfoBar();
  requestAnimationFrame(syncChromeEdges);
}
function bindStaticEvents() {
  ui.exitBtn?.addEventListener("click", () => void shutdownApp());
  ui.runBtn.addEventListener("click", () => void control("toggle"));
  $("#btnStep").addEventListener("click", () => void control("step", 1));
  $("#btnReset").addEventListener("click", () => void control("reset"));
  $("#btnAdd").addEventListener("click", () => {
    const place = centerPlacement();
    openAddMenu(16, 88, place.x, place.y);
  });
  $("#btnLayout").addEventListener("click", () => void autoLayout());
  $("#btnFit").addEventListener("click", () => fitView(true));
  $("#btnZoomIn").addEventListener("click", () => zoomCenter(1.2));
  $("#btnZoomOut").addEventListener("click", () => zoomCenter(1 / 1.2));
  $("#btnClear").addEventListener("click", () => void clearScene());
  if (ui.workspaceSwitch) {
    $$("button[data-workspace]", ui.workspaceSwitch).forEach((buttonNode) => {
      buttonNode.addEventListener("click", () => void switchWorkspace(buttonNode.dataset.workspace));
    });
  }
  setWorkspaceButtons();
  bindPanelNavigation();
  if (ui.vectorNode) {
    ui.vectorNode.addEventListener("change", () => {
      state.phaseNode = ui.vectorNode.value;
      state.phaseIndex = null;
      stopPhasePlay();
      drawPhase();
    });
  }
  if (ui.vectorTrail) {
    ui.vectorTrail.addEventListener("change", () => {
      const value = Number(ui.vectorTrail.value);
      if (!Number.isFinite(value)) return;
      state.phaseTrail = clamp(Math.round(value), 20, 1200);
      ui.vectorTrail.value = String(state.phaseTrail);
      drawPhase();
    });
  }
  if (ui.phasePlay) {
    ui.phasePlay.addEventListener("click", togglePhasePlay);
  }
  if (ui.phaseStep) {
    ui.phaseStep.addEventListener("click", () => {
      const total = phaseFrameCount();
      if (!total) return;
      stopPhasePlay();
      const current = state.phaseIndex == null ? total - 1 : state.phaseIndex;
      setPhaseIndex(current + 1 >= total ? 0 : current + 1);
    });
  }
  if (ui.phaseLoop) {
    ui.phaseLoop.addEventListener("change", () => {
      state.phaseLoop = Boolean(ui.phaseLoop.checked);
    });
  }
  if (ui.phaseExport) {
    ui.phaseExport.addEventListener("click", () => {
      const node = (state.scene?.nodes || []).find((item) => item.name === state.phaseNode);
      const stateKeys = node ? phaseStateKeys(node) : [];
      const keys = stateKeys.length >= 2 ? stateKeys.slice(0, 2) : node ? [`n:${node.name}:x`, `n:${node.name}:y`] : null;
      void exportAnalysisCsv(keys, "phase");
    });
  }
  if (ui.phasePlotkit) {
    ui.phasePlotkit.addEventListener("click", () => void sendPhaseToPlotKit());
  }
  if (ui.phaseFrame) {
    ui.phaseFrame.addEventListener("input", () => {
      stopPhasePlay();
      setPhaseIndex(Number(ui.phaseFrame.value));
    });
  }
  ui.chartWindow.addEventListener("change", () => {
    const value = Number(ui.chartWindow.value);
    if (!Number.isFinite(value) || value < 0.1 || value > 120) {
      toast("\u65F6\u95F4\u7A97\u5FC5\u987B\u5728 0.1\u2013120 s \u4E4B\u95F4", "error", 3e3);
      ui.chartWindow.value = String(state.chart.window);
      return;
    }
    state.chart.window = value;
    scheduleChartDraw();
  });
  ui.signalSearch.addEventListener("input", () => {
    state.chart.filter = ui.signalSearch.value;
    renderSignalList();
  });
  ui.btnClearChart.addEventListener("click", () => {
    state.frames = [];
    state.chart.hover = null;
    stopReplayTimer();
    state.replay.active = false;
    state.replay.index = 0;
    state.replay.recordingRevision = null;
    updateReplayUI();
    drawChart({ colorForKey, decodeProbeKey, nearestFrame, state: { chart: state.chart, chartSize: state.chartSize, frames: state.frames, replay: state.replay } });
    toast("\u8F68\u8FF9\u5DF2\u6E05\u7A7A\uFF0C\u65B0\u7684\u91C7\u6837\u4F1A\u7EE7\u7EED\u7ED8\u5236", "ok", 2e3);
  });
  if (ui.chartTimeline) {
    ui.chartTimeline.addEventListener("input", () => {
      enterReplay(Number(ui.chartTimeline.value));
    });
  }
  if (ui.topTimeline) {
    ui.topTimeline.addEventListener("input", () => {
      enterReplay(Number(ui.topTimeline.value));
    });
    ui.topTimeline.addEventListener("dblclick", () => {
      leaveReplay();
      toast("\u5DF2\u56DE\u5230\u5B9E\u65F6\u5F55\u5236", "info", 1600);
    });
  }
  if (ui.btnReplay) {
    ui.btnReplay.addEventListener("click", () => toggleReplayPlayback());
  }
  try {
    const storedSpeed = Number(localStorage.getItem("netlab.replaySpeed"));
    if (Number.isFinite(storedSpeed) && storedSpeed >= 5 && storedSpeed <= 240) {
      state.replay.speed = storedSpeed;
    }
  } catch (error) {
  }
  if (ui.replaySpeed) {
    ui.replaySpeed.addEventListener("input", () => {
      state.replay.speed = clamp(Number(ui.replaySpeed.value) || 60, 5, 240);
      try {
        localStorage.setItem("netlab.replaySpeed", String(state.replay.speed));
      } catch (error) {
      }
      updateReplayUI();
    });
  }
  if (ui.btnPrecompute) {
    ui.btnPrecompute.addEventListener("click", () => openPrecomputeDialog("solve"));
  }
  if (ui.btnLive) {
    ui.btnLive.addEventListener("click", () => {
      leaveReplay();
      toast("\u5DF2\u56DE\u5230\u5B9E\u65F6\u5F55\u5236", "info", 1800);
    });
  }
  if (ui.btnResolve) {
    ui.btnResolve.addEventListener("click", async () => {
      if (!recordingStale()) return;
      leaveReplay();
      await control("reset");
      await control("run", void 0, { skipWarn: true });
      toast("\u573A\u666F\u5DF2\u4FEE\u6539\uFF0C\u65E7\u8BB0\u5F55\u6E05\u9664\u5E76\u91CD\u65B0\u6C42\u89E3", "ok", 2400);
    });
  }
  if (ui.chartLoop) {
    ui.chartLoop.addEventListener("change", () => {
      state.chart.loop = Boolean(ui.chartLoop.checked);
      toast(`\u5FAA\u73AF\u56DE\u653E\uFF1A${state.chart.loop ? "\u5F00" : "\u5173"}`, "info", 1600);
    });
  }
  updateReplayUI();
  chartCanvas.addEventListener("pointermove", (event) => {
    const rect = chartCanvas.getBoundingClientRect();
    state.chart.hover = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
    scheduleChartDraw();
  });
  chartCanvas.addEventListener("pointerleave", () => {
    state.chart.hover = null;
    scheduleChartDraw();
  });
  document.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".popup")) return;
    closePopups();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (state.shuttingDown) return;
    if (event.key === "Escape") {
      closePopups();
      if (state.wireTool) cancelWireTool();
      if (!ui.modal.classList.contains("hidden")) closeModal();
      return;
    }
    const formTarget = isFormTarget(event.target);
    const buttonTarget = formTarget && event.target.tagName === "BUTTON";
    if (formTarget && !(buttonTarget && (event.ctrlKey || event.metaKey))) return;
    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase();
      if (key === "s" && event.altKey) {
        event.preventDefault();
        void saveProject(true);
      } else if (key === "s") {
        event.preventDefault();
        void saveProject(false);
      } else if (key === "e" && event.shiftKey) {
        event.preventDefault();
        void openExport(state.workspace === "network" ? "scene-data" : "schematic");
      } else if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) void redo();
        else void undo();
      } else if (key === "y") {
        event.preventDefault();
        void redo();
      } else if (key === "c") {
        event.preventDefault();
        copySelection(false);
      } else if (key === "x") {
        event.preventDefault();
        copySelection(true);
      } else if (key === "v") {
        event.preventDefault();
        void pasteClipboard();
      } else if (key === "a") {
        event.preventDefault();
        selectAll();
      }
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      void control("toggle");
    } else if (event.key === "s" || event.key === "S") {
      event.preventDefault();
      void control("step", 1);
    } else if (event.key === "r" || event.key === "R") {
      event.preventDefault();
      void control("reset");
    } else if (state.workspace === "network" && (event.key === "f" || event.key === "F")) {
      event.preventDefault();
      fitView(true);
    } else if (state.workspace === "network" && (event.key === "a" || event.key === "A")) {
      event.preventDefault();
      const place = centerPlacement();
      openAddMenu(state.canvasSize.w / 2, state.canvasSize.h / 2, place.x, place.y);
    } else if (state.workspace === "network" && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault();
      void deleteSelection();
    } else if (state.workspace === "network" && (event.key === "+" || event.key === "=")) {
      event.preventDefault();
      zoomCenter(1.2);
    } else if (state.workspace === "network" && (event.key === "-" || event.key === "_")) {
      event.preventDefault();
      zoomCenter(1 / 1.2);
    } else if (event.key === "?") {
      event.preventDefault();
      showHelp();
    }
  });
  canvas.tabIndex = 0;
  canvas.addEventListener("focus", () => {
  });
}
export {
  applyPanelHidden,
  bindStaticEvents,
  initPanelChrome,
  initShell,
  initStatusToggles,
  togglePanel
};
