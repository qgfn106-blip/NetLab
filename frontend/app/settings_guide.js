import { $, $$ } from "./dom.js";
import { initFloatWindow, placeFloatWindow, raiseFloatWindow } from "./float.js";
import { modeLabel } from "./model.js";
import { openDoc } from "./docs.js";
import { openProject } from "./project.js";
import { state, ui } from "./state.js";
import { syncPrefControls } from "./appearance.js";
import { toast } from "./desktop.js";
let guideActions = {
  loadTemplate: async (_name, _label) => {
  },
  refreshTelemetryQuality: () => {
  },
  renderScenePanel: () => {
  },
  switchMode: (_mode, _opts) => {
  }
};
function setGuideActions(actions) {
  guideActions = actions;
}
function openSettings(pane = "project") {
  if (!ui.settingsWin) return;
  ui.settingsWin.hidden = false;
  ui.settingsWin.classList.remove("minimized");
  setSettingsPane(pane);
  if (!ui.scenePane || !ui.scenePane.dataset.ready) guideActions.renderScenePanel();
  placeFloatWindow(ui.settingsWin, "settingsGeo");
  raiseFloatWindow(ui.settingsWin);
}
function closeSettings() {
  if (!ui.settingsWin) return;
  ui.settingsWin.classList.remove("minimized", "maximized");
  ui.settingsWin.hidden = true;
}
function setSettingsPane(pane) {
  $$("#settingsWin .setwin-nav button[data-pane]").forEach((node) => {
    node.classList.toggle("active", node.dataset.pane === pane);
  });
  $$("#settingsWin .setwin-pane").forEach((node) => {
    node.classList.toggle("active", node.dataset.pane === pane);
  });
  const hint = $("#setWinHint");
  if (hint) {
    const hints = {
      project: "SETTINGS \xB7 \u5DE5\u7A0B\u7EA7\uFF0C\u968F .netlab \u4FDD\u5B58",
      view: "SETTINGS \xB7 \u5168\u5C40\u5916\u89C2\u504F\u597D",
      interact: "SETTINGS \xB7 \u5168\u5C40\u4EA4\u4E92\u504F\u597D",
      diag: "SETTINGS \xB7 \u53EA\u8BFB\u8BCA\u65AD\uFF08P5 \u8BEF\u5DEE\u5408\u540C\uFF09"
    };
    hint.textContent = hints[pane] || "";
  }
  const main = ui.settingsWin?.querySelector(".setwin-main");
  if (main) main.scrollTop = 0;
  if (pane === "diag") void guideActions.refreshTelemetryQuality();
}
function initSettingsWin() {
  $("#settingsWin .setwin-nav")?.addEventListener("click", (event) => {
    const target = event.target.closest("button[data-pane]");
    if (target) setSettingsPane(target.dataset.pane);
  });
  $("#btnDiagRefresh")?.addEventListener("click", () => void guideActions.refreshTelemetryQuality());
  ui.settingsClose?.addEventListener("click", closeSettings);
  $$("#settingsWin [data-doc]").forEach((node) => {
    node.addEventListener("click", () => openDoc(node.dataset.doc));
  });
  initFloatWindow(ui.settingsWin, "settingsGeo", { minWidth: 520, minHeight: 380 });
}
function showGuide(force = false) {
  if (!ui.guide) return;
  void force;
  state.prefs.guide = "always";
  state.guideShown = true;
  document.body.classList.add("guide-open");
  ui.guide.hidden = false;
  selectGuideMode(state.guideMode || state.mode || "signal");
  syncPrefControls();
}
function hideGuide() {
  if (!ui.guide) return;
  ui.guide.hidden = true;
  document.body.classList.remove("guide-open");
}
function selectGuideMode(mode) {
  const picked = ["signal", "circuit", "vector"].includes(mode) ? mode : "signal";
  state.guideMode = picked;
  $$(".guide-mode").forEach((node) => {
    const on = node.dataset.mode === picked;
    node.classList.toggle("selected", on);
    node.setAttribute("aria-checked", on ? "true" : "false");
  });
}
async function enterGuideScene() {
  const mode = state.guideMode || "signal";
  hideGuide();
  if (mode !== state.mode) {
    await guideActions.switchMode(mode, { skipConfirm: true });
  } else {
    toast(`${modeLabel(mode)}\u573A\u666F\u5DF2\u5C31\u7EEA \xB7 \u7A7A\u683C\u8FD0\u884C`, "ok", 2600);
  }
}
function initGuide() {
  if (!ui.guide) return;
  $$(".guide-mode").forEach((node) => {
    node.addEventListener("click", () => selectGuideMode(node.dataset.mode));
  });
  (() => {
    const handle = document.querySelector("#guide .guide-top");
    if (!handle) return;
    const desktop = window.netlabDesktop;
    if (!desktop || typeof desktop.attachWindowDrag !== "function") return;
    handle.style.cursor = "grab";
    desktop.attachWindowDrag(handle, {
      dblclick: false,
      onStart: () => {
        handle.style.cursor = "grabbing";
      },
      onEnd: () => {
        handle.style.cursor = "grab";
      }
    });
  })();
  ui.guideEnter?.addEventListener("click", () => void enterGuideScene());
  ui.guideClose?.addEventListener("click", hideGuide);
  ui.guideDocs?.addEventListener("click", () => {
    openDoc("quickstart");
  });
  ui.guideDemo?.addEventListener("click", () => {
    hideGuide();
    void guideActions.loadTemplate("signal_chain", "\u4FE1\u53F7\u94FE\u793A\u4F8B");
  });
  ui.guideOpenProject?.addEventListener("click", () => void openProject());
  ui.guideSettings?.addEventListener("click", () => openSettings("view"));
  $$("#guide [data-doc]").forEach((node) => {
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      openDoc(node.dataset.doc);
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !ui.guide.hidden && !event.target.closest("input, textarea, select")) {
      event.preventDefault();
      void enterGuideScene();
    }
  });
}
export {
  closeSettings,
  enterGuideScene,
  hideGuide,
  initGuide,
  initSettingsWin,
  openSettings,
  selectGuideMode,
  setGuideActions,
  setSettingsPane,
  showGuide
};
