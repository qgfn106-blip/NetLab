import { clamp } from "../app.utils.js";
import { ENDPOINTS } from "./endpoints.js";
import { state, ui } from "./state.js";
import { migrateSceneToDevices, clearScene, openExport } from "./scene_actions.js";
import { el, div } from "./ui.js";
import { normalizeCardFields } from "./card_fields.js";
import { applyGridPayload } from "./grid_prefs.js";
import { toast } from "./desktop.js";
import { jsonRequest } from "./net.js";
import { openCacheDialog } from "./cache.js";
import { SHEET_SIZES, requestDraw } from "./canvas_render.js";
import { closeMenus } from "./ui_helpers.js";
import { applyNumericProjectUi, markProjectDirty, saveProject, openProject, newProject, recoverAutosave } from "./project.js";
import { saveAutosaveSetting } from "./appearance_controls.js";
import { exportAnalysisCsv } from "./analysis.js";
import { openAnalysis } from "./ac_analysis.js";
import { openVscode } from "./plotkit_frame.js";
import { openDoc } from "./docs.js";
import { openSettings, showGuide } from "./settings_guide.js";
import { selectAll, copySelection, pasteClipboard, pushUndoSnapshot, undo, redo } from "./commands.js";
import { switchTab, fetchNetworks, addNetwork, renameNetwork, deleteNetwork, toggleNetworks } from "./editor_runtime.js";
import { control, openPrecomputeDialog, refreshState, shutdownApp, autoLayout, batchResizeSelection, deleteSelection, openWireDialog, fitView, task, zoomCenter, openViewDesigner, togglePanel, openDocSearch } from "./editor_services.js";
let floatingMenu = null;
function menuDefinition() {
  return [
    {
      label: "\u6587\u4EF6",
      items: [
        { label: "\u65B0\u5EFA\u5DE5\u7A0B", hint: "\u66FF\u6362\u5F53\u524D\u573A\u666F\uFF08\u672A\u4FDD\u5B58\u4F1A\u63D0\u793A\uFF09", action: () => void newProject() },
        { label: "\u6253\u5F00\u5DE5\u7A0B\u2026", action: () => void openProject() },
        { label: "\u4FDD\u5B58\u5DE5\u7A0B", action: () => void saveProject(false) },
        { label: "\u53E6\u5B58\u4E3A\u2026", action: () => void saveProject(true) },
        { sep: true },
        { label: "\u6062\u590D\u81EA\u52A8\u4FDD\u5B58", action: () => void recoverAutosave() },
        { label: "\u5BFC\u51FA\u573A\u666F JSON", hint: "Ctrl+Shift+E", action: () => void openExport("scene-data") },
        { label: "\u5BFC\u51FA\u539F\u7406\u56FE SVG\u2026", hint: "\u7EDF\u4E00\u5BFC\u51FA\u7A97\u53E3", action: () => void openExport("schematic") },
        { sep: true },
        { label: "\u9000\u51FA\u670D\u52A1", action: () => void shutdownApp() }
      ]
    },
    {
      label: "\u7F16\u8F91",
      items: [
        { label: "\u64A4\u9500", hint: "Ctrl+Z\uFF08100 \u6B65\uFF09", action: () => void undo() },
        { label: "\u91CD\u505A", hint: "Ctrl+Shift+Z", action: () => void redo() },
        { sep: true },
        { label: "\u590D\u5236", hint: "Ctrl+C", action: () => copySelection(false) },
        { label: "\u526A\u5207", hint: "Ctrl+X", action: () => copySelection(true) },
        { label: "\u7C98\u8D34", hint: "Ctrl+V\uFF08\u8DE8\u7F51\u7EDC\u9700\u786E\u8BA4\uFF09", action: () => void pasteClipboard() },
        { label: "\u5168\u9009", hint: "Ctrl+A", action: () => selectAll() },
        { sep: true },
        { label: "\u5220\u9664\u9009\u4E2D", hint: "Delete", action: () => void deleteSelection() },
        { label: "\u6279\u91CF\u8BBE\u7F6E\u5C3A\u5BF8\u2026", hint: "\u591A\u9009\u8282\u70B9/\u5668\u4EF6\u540E\u7EDF\u4E00\u5BBD\u6216\u76F4\u5F84", action: () => void batchResizeSelection() },
        { label: "\u6E05\u7A7A\u573A\u666F", action: () => void clearScene() }
      ]
    },
    {
      label: "\u89C6\u56FE",
      items: [
        { label: "\u9002\u914D\u89C6\u56FE", action: () => fitView(true) },
        { label: "\u653E\u5927", action: () => zoomCenter(1.2) },
        { label: "\u7F29\u5C0F", action: () => zoomCenter(1 / 1.2) },
        { label: "\u81EA\u52A8\u5E03\u5C40", action: () => void autoLayout() },
        { label: "\u5207\u6362\u7F51\u683C\u5438\u9644", hint: "Alt \u62D6\u52A8\u53EF\u4E34\u65F6\u6682\u505C", action: () => toggleSnap() },
        { label: "\u5207\u6362\u7B26\u53F7\u98CE\u683C", hint: "\u7ECF\u5178\u5706\u5F62 / GB \u77E9\u5F62\uFF08\u5DE5\u7A0B\u7EA7\uFF09", action: () => toggleSymbol() },
        { label: "\u89C6\u56FE\u8BBE\u8BA1\u2026", hint: "\u4E3B\u9898\u3001\u5E03\u5C40\u4E0E\u5143\u7D20\u5916\u89C2", action: () => void openViewDesigner() },
        { label: "\u663E\u793A / \u9690\u85CF\u5F15\u811A\u540D", hint: "\u5668\u4EF6\u6846\u5F15\u811A\u6807\u6CE8", action: () => {
          state.ui.showPins = state.ui.showPins === false;
          requestDraw();
        } },
        { sep: true },
        { label: "\u6536\u8D77 / \u5C55\u5F00\u5DE6\u4FA7\u7F51\u7EDC\u680F", action: () => toggleNetworks() },
        { label: "\u6536\u8D77 / \u5C55\u5F00\u53F3\u4FA7\u9762\u677F", action: () => togglePanel() }
      ]
    },
    {
      label: "\u5DE5\u7A0B \xB7 \u7F51\u7EDC",
      items: [
        { label: "\u65B0\u5EFA\u7F51\u7EDC", action: () => void addNetwork() },
        { label: "\u91CD\u547D\u540D\u5F53\u524D\u7F51\u7EDC\u2026", action: () => void renameNetwork() },
        { label: "\u5220\u9664\u5F53\u524D\u7F51\u7EDC\u2026", action: () => void deleteNetwork() },
        { sep: true },
        { label: "\u5237\u65B0\u7F51\u7EDC\u5217\u8868", action: () => void fetchNetworks(false) },
        { label: "\u5DE5\u7A0B\u6587\u4EF6\u4F4D\u7F6E", hint: "\u5F53\u524D\u4FDD\u5B58\u8DEF\u5F84", action: () => {
          const path = state.project.path || "\u5C1A\u672A\u4FDD\u5B58\uFF1A\u6587\u4EF6\u83DC\u5355\u53EF\u7528\u300C\u4FDD\u5B58\u5DE5\u7A0B\u300D\u843D\u76D8";
          toast(path, "info", 5e3);
        } }
      ]
    },
    {
      label: "\u8FD0\u884C",
      items: [
        { label: "\u9884\u8BA1\u7B97\u2026", hint: "\u7EDF\u4E00\u5165\u53E3\uFF1A\u5F53\u524D\u7F51\u7EDC / PlotKit / \u5DE5\u4F5C\u53F0\u72B6\u6001", action: () => openPrecomputeDialog() }
      ]
    },
    {
      label: "\u4EFF\u771F",
      items: [
        { label: "\u8FD0\u884C / \u6682\u505C", hint: "\u7A7A\u683C", action: () => void control("toggle") },
        { label: "\u5355\u6B65", hint: "S", action: () => void control("step") },
        { label: "\u65F6\u95F4\u5F52\u96F6", hint: "\u53EA\u5F52\u96F6\u8BA1\u65F6\u4E0E\u5F55\u5236\uFF0C\u4E0D\u6E05\u72B6\u6001", action: () => void control("zero") },
        { label: "\u91CD\u7F6E", hint: "\u6E05\u9664\u72B6\u6001\u4E0E\u65F6\u95F4", action: () => void control("reset") }
      ]
    },
    {
      label: "\u5206\u6790",
      items: [
        { label: "\u5206\u6790\u9762\u677F", action: () => switchTab("analysis") },
        { label: "\u5BFC\u51FA CSV", action: () => void exportAnalysisCsv() }
      ]
    },
    {
      label: "\u5DE5\u5177",
      items: [
        { label: "\u5168\u5C40\u641C\u7D22\u2026", hint: "Ctrl+K / R14", action: () => openDocSearch() },
        { sep: true },
        { label: "\u8282\u70B9\u51FD\u6570", action: () => switchTab("node-fn") },
        { label: "\u8FDE\u63A5\u51FD\u6570", action: () => switchTab("edge-fn") },
        { label: "\u6A21\u5757\u4E0E\u6269\u5C55", action: () => switchTab("blocks") },
        { sep: true },
        { label: "\u4EE3\u7801\u5DE5\u4F5C\u533A\uFF08VS Code\uFF09", hint: "\u672C\u5730 IDE \xB7 \u7EC8\u7AEF / \u6269\u5C55 / \u8C03\u8BD5", action: () => void openVscode() },
        { sep: true },
        { label: "\u6027\u80FD\u9762\u677F", action: () => switchTab("analysis") },
        { label: "\u7F13\u5B58\u4F53\u68C0\u4E0E\u6E05\u7406\u2026", hint: "\u53EA\u6E05\u53EF\u518D\u751F\u6210\u7684\u7F13\u5B58\uFF0C\u4E0D\u78B0\u5DE5\u7A0B\u4E0E\u81EA\u52A8\u4FDD\u5B58", action: () => openCacheDialog() },
        { label: "DC \u5DE5\u4F5C\u70B9\uFF08.op\uFF09", hint: "\u4E0D\u63A8\u8FDB\u4EFF\u771F\uFF0C\u9759\u9ED8\u89E3\u4E00\u6B21\u9759\u6001\u7535\u8DEF", action: () => openAnalysis("op") },
        { label: "\u7535\u8DEF\u5206\u6790\u5DE5\u4F5C\u53F0\u2026", hint: "Bode / \u65F6\u57DF / Nyquist / \u73AF\u8DEF \xB7 \u591A\u72B6\u6001\u5BF9\u6BD4", action: () => openAnalysis("wb-analysis") },
        { label: "\u8FC1\u79FB\u573A\u666F\u4E3A\u5668\u4EF6\u6A21\u578B\uFF08R20\uFF09", hint: "\u5143\u4EF6\u8FB9 \u2192 \u5668\u4EF6\u8282\u70B9 + \u5F15\u811A\u5BFC\u7EBF", action: () => void migrateSceneToDevices() },
        { label: "\u65B0\u5EFA\u8FDE\u7EBF\uFF08\u9009\u62E9\u7AEF\u70B9\uFF09\u2026", hint: "\u7F51\u7EDC\u2194\u7F51\u7EDC\u7EAF\u5BFC\u7EBF / \u5668\u4EF6\u5F15\u811A\u2194\u7F51\u7EDC", action: () => openWireDialog() }
      ]
    },
    {
      label: "\u8BBE\u7F6E",
      items: [
        { label: "\u5DE5\u7A0B\u8BBE\u7F6E\u2026", hint: "\u5DE5\u4F5C\u6A21\u5F0F / \u6A21\u677F / \u6587\u4EF6 / \u753B\u5E03\u7F51\u683C", action: () => openSettings("project") },
        { label: "\u89C6\u56FE\u4E0E\u5916\u89C2\u2026", hint: "\u4E3B\u9898 / \u5F3A\u8C03\u8272 / \u52A8\u6548 / \u6027\u80FD", action: () => openSettings("view") },
        { label: "\u4EA4\u4E92\u4E0E\u6587\u6863\u2026", hint: "\u542F\u52A8\u5F15\u5BFC / \u81EA\u52A8\u4FDD\u5B58 / \u5FEB\u6377\u952E", action: () => openSettings("interact") },
        { sep: true },
        { label: "\u91CD\u65B0\u6253\u5F00\u5F15\u5BFC\u9875", action: () => showGuide(true) },
        { label: "\u81EA\u52A8\u4FDD\u5B58", hint: state.project.autosave ? "\u5F53\u524D\uFF1A\u5F00" : "\u5F53\u524D\uFF1A\u5173", action: () => void saveAutosaveSetting({ autosave_enabled: !state.project.autosave }) }
      ]
    },
    {
      label: "\u5E2E\u52A9",
      items: [
        { label: "\u5FEB\u901F\u4E0A\u624B", action: () => openDoc("quickstart") },
        { label: "\u754C\u9762\u6307\u5357", action: () => openDoc("interface") },
        { label: "\u672F\u8BED\u8868", action: () => openDoc("glossary") },
        { label: "\u5E38\u89C1\u95EE\u9898", action: () => openDoc("faq") },
        { label: "\u5FEB\u6377\u952E", hint: "?", action: () => openDoc("shortcuts") },
        { sep: true },
        { label: "\u6587\u6863\u4E2D\u5FC3\uFF08\u641C\u7D22\uFF09", hint: "Ctrl+K", action: () => openDocSearch() },
        { label: "\u5173\u4E8E Netlab", action: () => toast("Netlab \xB7 \u62D3\u6251\u7F51\u7EDC / \u7535\u8DEF / \u70ED\u573A\u4EFF\u771F\uFF08\u672C\u5730\u8FD0\u884C\uFF09", "info", 4e3) }
      ]
    }
  ];
}
function initMenus() {
  const host = ui.menuItems;
  if (!host) return;
  host.replaceChildren();
  for (const menu of menuDefinition()) {
    const wrap = div("menu");
    const button2 = el("button", null, menu.label);
    button2.type = "button";
    button2.setAttribute("role", "menuitem");
    button2.setAttribute("aria-haspopup", "true");
    const panel = div("menu-panel");
    panel.setAttribute("role", "menu");
    for (const item of menu.items) {
      if (item.sep) {
        panel.appendChild(div("menu-sep"));
        continue;
      }
      const entry = el("button", "menu-item");
      entry.type = "button";
      entry.disabled = Boolean(item.disabled);
      entry.appendChild(el("strong", null, item.label));
      if (item.hint) entry.appendChild(el("small", null, item.hint));
      entry.addEventListener("click", () => {
        closeMenus();
        if (!item.disabled) item.action();
      });
      panel.appendChild(entry);
    }
    button2.addEventListener("click", (event) => {
      event.stopPropagation();
      const open = wrap.classList.contains("open");
      closeMenus();
      if (!open) wrap.classList.add("open");
    });
    wrap.append(button2, panel);
    host.appendChild(wrap);
  }
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".menu")) closeMenus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenus();
  });
}
function setInfo(key, value) {
  if (!ui.infoBar) return;
  const node = ui.infoBar.querySelector(`[data-info="${key}"]`);
  if (node) node.textContent = value;
}
function closeFloatingMenu() {
  if (!floatingMenu) return;
  floatingMenu.remove();
  floatingMenu = null;
}
function showFloatingMenu(x, y, items, title = "") {
  closeFloatingMenu();
  const box = div("ctxmenu");
  box.setAttribute("role", "menu");
  if (title) box.appendChild(div("ctxmenu-title", title));
  for (const item of items) {
    if (item.sep) {
      box.appendChild(div("menu-sep"));
      continue;
    }
    const entry = el("button", "menu-item");
    entry.type = "button";
    entry.disabled = Boolean(item.disabled);
    entry.appendChild(el("strong", null, item.label));
    if (item.hint) entry.appendChild(el("small", null, item.hint));
    entry.addEventListener("click", () => {
      closeFloatingMenu();
      if (!item.disabled) item.action();
    });
    box.appendChild(entry);
  }
  document.body.appendChild(box);
  const rect = box.getBoundingClientRect();
  box.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 8))}px`;
  box.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 8))}px`;
  floatingMenu = box;
  return box;
}
function initFloatingMenu() {
  document.addEventListener("pointerdown", (event) => {
    if (!floatingMenu) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(".ctxmenu")) closeFloatingMenu();
  }, true);
  window.addEventListener("blur", () => closeFloatingMenu());
  window.addEventListener("resize", () => closeFloatingMenu());
}
async function snapSceneToGrid() {
  const grid = Number(state.ui.grid) || 20;
  const snapValue = (value) => Math.round(value / grid) * grid;
  const nodes = (state.scene?.nodes || []).filter((node) => {
    const x = Number(node.position?.x || 0);
    const y = Number(node.position?.y || 0);
    return snapValue(x) !== Math.round(x) || snapValue(y) !== Math.round(y);
  });
  const edges = (state.scene?.edges || []).filter(
    (edge) => (edge.waypoints || []).some((point) => snapValue(point.x) !== Math.round(point.x) || snapValue(point.y) !== Math.round(point.y))
  );
  if (!nodes.length && !edges.length) {
    toast("\u6240\u6709\u8282\u70B9\u4E0E\u62D0\u70B9\u5DF2\u5728\u7F51\u683C\u4E0A", "info", 2200);
    return;
  }
  await pushUndoSnapshot();
  for (const node of nodes) {
    const position = { x: snapValue(Number(node.position.x) || 0), y: snapValue(Number(node.position.y) || 0) };
    await task(() => jsonRequest(ENDPOINTS.node(node.id), "PATCH", { position }), { history: false });
  }
  for (const edge of edges) {
    const waypoints = (edge.waypoints || []).map((point) => ({ x: snapValue(point.x), y: snapValue(point.y) }));
    await task(() => jsonRequest(ENDPOINTS.edge(edge.id), "PATCH", { waypoints }), { history: false });
  }
  await refreshState(true);
  toast(`\u5DF2\u6574\u7406 ${nodes.length} \u4E2A\u8282\u70B9\u3001${edges.length} \u6761\u8FDE\u7EBF\u5230 ${grid} \u7F51\u683C`, "ok", 2600);
}
function toggleSnap() {
  state.ui.snap = !state.ui.snap;
  toast(`\u7F51\u683C\u5438\u9644\u5DF2${state.ui.snap ? "\u5F00\u542F" : "\u5173\u95ED"}\uFF08Alt \u4E34\u65F6\u6682\u505C\uFF09`, "info", 2400);
  markProjectDirty();
}
function toggleSymbol() {
  state.ui.symbol = state.ui.symbol === "gb" ? "classic" : "gb";
  requestDraw();
  markProjectDirty();
  toast(`\u7B26\u53F7\u98CE\u683C\uFF1A${state.ui.symbol === "gb" ? "GB \u77E9\u5F62" : "\u7ECF\u5178\u5706\u5F62"}\uFF08\u4EC5\u672C\u5DE5\u7A0B\uFF09`, "info", 2600);
}
function applyProjectUi(uiSettings) {
  if (!uiSettings || typeof uiSettings !== "object") return;
  if (uiSettings.grid && typeof uiSettings.grid === "object") {
    applyGridPayload(state.ui, uiSettings.grid);
  }
  if (uiSettings.symbol === "gb" || uiSettings.symbol === "classic") {
    state.ui.symbol = uiSettings.symbol;
  }
  if (["circle", "dot", "box"].includes(uiSettings.nodeStyle)) state.ui.nodeStyle = uiSettings.nodeStyle;
  if (typeof uiSettings.drawingMode === "boolean") state.ui.drawingMode = uiSettings.drawingMode;
  if (typeof uiSettings.drawingSheet === "string" && SHEET_SIZES[uiSettings.drawingSheet]) state.ui.drawingSheet = uiSettings.drawingSheet;
  if (typeof uiSettings.drawingLabels === "boolean") state.ui.drawingLabels = uiSettings.drawingLabels;
  if (Number.isFinite(Number(uiSettings.drawingPage))) state.ui.drawingPage = Math.max(1, Math.min(9, Number(uiSettings.drawingPage)));
  if (typeof uiSettings.cardDetail === "boolean") state.ui.cardDetail = uiSettings.cardDetail;
  if (typeof uiSettings.cardValue === "boolean") state.ui.cardValue = uiSettings.cardValue;
  if (Array.isArray(uiSettings.cardFields)) {
    const next = normalizeCardFields(uiSettings.cardFields);
    state.ui.cardFields = next;
    state.ui.cardDetail = next.length > 0;
    state.ui.cardValue = next.includes("value");
  }
  if (Number.isFinite(Number(uiSettings.symbolScale))) state.ui.symbolScale = clamp(Number(uiSettings.symbolScale), 0.6, 2.5);
  if (typeof uiSettings.glyphColor === "string") state.ui.glyphColor = uiSettings.glyphColor;
  if (uiSettings.analysis_workbench && typeof uiSettings.analysis_workbench === "object") {
    state.ui.analysis_workbench = uiSettings.analysis_workbench;
  }
  applyNumericProjectUi(uiSettings);
  requestDraw();
}
export {
  applyProjectUi,
  closeFloatingMenu,
  floatingMenu,
  initFloatingMenu,
  initMenus,
  menuDefinition,
  setInfo,
  showFloatingMenu,
  snapSceneToGrid,
  toggleSnap,
  toggleSymbol
};
