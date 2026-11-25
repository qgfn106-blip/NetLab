import { ENDPOINTS } from "./endpoints.js";
import { initSessionStore, applySnapshot } from "./store.js";
import { $, $$, stage } from "./dom.js";
import { drawModulePreview } from "./module_preview.js";
import { state, ui } from "./state.js";
import { initScenePanel, updateScenePanelValues } from "./scene_panel.js";
import { initSceneActions, renderScenePanel, switchMode, loadTemplate } from "./scene_actions.js";
import { initReplay } from "./analysis_replay.js";
import { initSignalList, decodeProbeKey, renderSignalList } from "./signal_list.js";
import { toast, showBanner, hideBanner } from "./desktop.js";
import { api } from "./net.js";
import { checkCacheQuietly } from "./cache.js";
import { C, tokens } from "./colors.js";
import { setTypeLabelHelp } from "./param_fields.js";
import { typeLabelHelp, setSwitchTab } from "./help_card.js";
import { nodeById, edgeById } from "./model.js";
import { requestDraw, animationLoop } from "./canvas_render.js";
import { openIroColorPopover } from "./ui_helpers.js";
import { phaseStateKeys, renderVectorNodeList, resizePhase, schedulePhaseDraw } from "./phase.js";
import { setInstrumentActions, resizeInstrument, initInstruments } from "./instruments.js";
import { circuitPinPath, wirePathPoints } from "./canvas_base.js";
import { setEmptyInspectorActions } from "./inspector_shell.js";
import { updateInspectorLive, setInspectorActions } from "./inspector.js";
import { setSpecPanelActions } from "./spec_panel.js";
import { setProjectActions, projectDownloadText as downloadText, maybeOfferRecovery, initProject } from "./project.js";
import { loadUiPrefs, setAppearanceActions } from "./appearance.js";
import { initAppearanceControls, refreshTelemetryQuality, setAppearanceControlActions } from "./appearance_controls.js";
import { setGeometryActions, nodeDiameter } from "./geometry.js";
import { setAnalysisActions } from "./analysis.js";
import { initPlotkitDataBar, setPlotkitDataActions } from "./plotkit_data.js";
import { initAnalWin, initDocWin, setWindowActions } from "./windows.js";
import { ensureDocs, setDocsActions } from "./docs.js";
import { initSettingsWin, showGuide, initGuide, setGuideActions } from "./settings_guide.js";
import { setPlotkitFrameActions } from "./plotkit_frame.js";
import { openConfirmModal as confirmModal, openModeModal as chooseModeModal } from "./dialogs_build.js";
import { initAnalysisWorkbenchPanel, syncProjectContext, renderCompareGrid, setWbSignalDock, getWbComparePayload } from "./analysis_workbench_panel.js";
import { initCommands, clearSelection } from "./commands.js";
import { initShellView, updateInfoBar } from "./shell_view.js";
import { createViews } from "./views.js";
import { createNetworkHandlers } from "./handlers.js";
import { initRouter } from "./router.js";
import { SHELL_KEYS } from "./editor_consts.js";
import { switchTab, fetchNetworks, switchNetwork, addNetwork, renameNetwork, deleteNetwork, openNetworkMenu, renderAnalysisPanel, syncChromeEdges } from "./editor_runtime.js";
import { setEditorRuntime } from "./editor_runtime.js";
import { bindStaticEvents, initShell, initStatusToggles } from "./editor_panels.js";
import { closeInternalNetwork, describeBlockPorts, encapsulateSelection, importBlockFile, initBlockDragDrop, initModuleWindow, instantiateBlockFromLibrary, openModuleInternal, refreshBlocks, retryDegradedProject, saveCurrentAsBlockCopy } from "./editor_blocks.js";
import { applyProjectUi, initFloatingMenu, setInfo, showFloatingMenu, snapSceneToGrid } from "./editor_shell.js";
import { attachParamHelp, ensureStoppedOnBoot, initShellKeys } from "./editor_help.js";
import { bindCanvas } from "./editor_interaction.js";
import { colorForKey, distance, fitView, resizeChart, resizeGraph, setStatusHint, syncUI, runTask as task, updateModeUI, updateRunButton, updateSignalKeyCache } from "./editor_base.js";
import { deleteEdge, deleteNode, deleteSelection, renderInspector, selectEntity } from "./editor_node_actions.js";
import { openPrecomputeDialog, pollLive, pollLoop, refreshState } from "./editor_loop.js";
import { patchEdgeGeometry, patchNodeGeometry, scheduleChartDraw } from "./editor_canvas_commands.js";
import { centerPlacement, newNetworkModal, notifyPlotkit, openAddMenu, showHelp } from "./editor_menus.js";
import { compareBuiltinBlock, deleteLibraryBlock, loadUiProfile, openPluginManager, openViewDesigner, renameLibraryBlock } from "./editor_appearance.js";
import { installEditorServices } from "./editor_registry.js";
let projectFileInput = null;
async function boot() {
  installEditorServices();
  await loadUiPrefs();
  initProject();
  initShell();
  initAppearanceControls();
  initSettingsWin();
  initGuide();
  initDocWin();
  initAnalWin();
  initPlotkitDataBar();
  initModuleWindow();
  initFloatingMenu();
  initShellKeys();
  bindStaticEvents();
  bindCanvas();
  resizeGraph();
  resizeChart();
  resizePhase();
  initInstruments();
  const observer = new ResizeObserver(() => {
    if (state.workspace === "network") resizeGraph();
    resizeChart();
    resizePhase();
    resizeInstrument();
  });
  observer.observe(stage);
  const chartWrap = $(".chart-wrap");
  if (chartWrap) observer.observe(chartWrap);
  const phaseWrap = $(".phase-wrap");
  if (phaseWrap) observer.observe(phaseWrap);
  $$(".scope-wrap").forEach((wrap) => observer.observe(wrap));
  window.addEventListener("resize", () => {
    syncChromeEdges();
    resizeGraph();
    resizeChart();
    resizePhase();
    resizeInstrument();
  });
  setInterval(() => {
    if (!ui.sessionClock) return;
    const now = /* @__PURE__ */ new Date();
    ui.sessionClock.textContent = `LOCAL SESSION \xB7 ${now.toLocaleTimeString("zh-CN", { hour12: false })}`;
  }, 1e3);
  requestAnimationFrame(animationLoop);
  try {
    const [catalog, snapshot] = await Promise.all([api(ENDPOINTS.catalog), api(ENDPOINTS.state)]);
    state.catalog = catalog.catalog;
    state.templates = catalog.templates || [];
    state.mode = snapshot.scene?.mode || "signal";
    applySnapshot(snapshot);
    await fetchNetworks();
    await refreshBlocks();
    initBlockDragDrop();
    initStatusToggles();
    state.cursor = Math.max(0, Number(snapshot.sim?.cursor || 0) - 600);
    renderScenePanel();
    await ensureDocs();
    renderSignalList();
    renderInspector();
    updateModeUI();
    fitView();
    if (Number(snapshot.sim?.cursor || 0) > 0) await pollLive();
    state.pollTimer = setTimeout(pollLoop, 220);
    state.stateTimer = setInterval(() => {
      if (state.sim?.running) void refreshState(true);
    }, 8e3);
    state.booted = true;
    await maybeOfferRecovery();
    await ensureStoppedOnBoot();
    showGuide();
    if (!state.sim?.running) {
      toast("\u753B\u5E03\u5DF2\u5C31\u7EEA\uFF1A\u7A7A\u683C\u8FD0\u884C\uFF0C\u53CC\u51FB\u8282\u70B9\u7F16\u8F91\uFF0C\u4ECE\u53F3\u4FA7\u7AEF\u53E3\u62D6\u51FA\u8FDE\u7EBF", "info", 4200);
    }
  } catch (error) {
    showBanner(`\u65E0\u6CD5\u8FDE\u63A5\u540E\u7AEF\uFF1A${error.message}`);
    toast(`\u521D\u59CB\u5316\u5931\u8D25\uFF1A${error.message}`, "error", 9e3);
    renderScenePanel();
    renderInspector();
  }
}
function bootEditor() {
  const viewHooks = {
    renderAnalysisPanel: () => {
    },
    renderBlocksPanel: () => {
    }
  };
  const routerRuntime = initRouter({
    resizeChart,
    scheduleChartDraw,
    notifyPlotkit,
    renderAnalysisPanel: () => viewHooks.renderAnalysisPanel(),
    renderBlocksPanel: () => viewHooks.renderBlocksPanel()
  });
  const handlersRuntime = createNetworkHandlers({
    task,
    renderInspector,
    fitView,
    newNetworkModal,
    refreshBlocks,
    encapsulateSelection,
    switchTab,
    openModuleInternal,
    closeInternalNetwork,
    showFloatingMenu
  });
  const viewsRuntime = createViews({
    task,
    scheduleChartDraw,
    resizeGraph,
    resizeChart,
    shellKeys: SHELL_KEYS,
    addNetwork,
    renameNetwork,
    deleteNetwork,
    refreshBlocks,
    importBlockFile,
    encapsulateSelection,
    saveCurrentAsBlockCopy,
    openPluginManager,
    openViewDesigner,
    closeInternalNetwork,
    retryDegradedProject,
    describeBlockPorts,
    instantiateBlockFromLibrary,
    openModuleInternal,
    compareBuiltinBlock,
    renameLibraryBlock,
    deleteLibraryBlock
  });
  viewHooks.renderAnalysisPanel = viewsRuntime.renderAnalysisPanel;
  viewHooks.renderBlocksPanel = viewsRuntime.renderBlocksPanel;
  setEditorRuntime({ ...routerRuntime, ...handlersRuntime, ...viewsRuntime });
  initSessionStore({
    scheduleChartDraw,
    clearSelection,
    requestDraw,
    updateModeUI,
    syncUI,
    updateInfoBar,
    showBanner,
    hideBanner,
    updateScenePanelValues,
    updateSignalKeyCache,
    updateInspectorLive,
    renderVectorNodeList,
    schedulePhaseDraw,
    nodeById,
    edgeById
  });
  initCommands({ task, selectEntity, renderInspector, deleteSelection, refreshState });
  initShellView({ setInfo, switchNetwork, renameNetwork, openNetworkMenu });
  initAnalysisWorkbenchPanel({ colorForKey, decodeProbeKey, openPrecomputeDialog, applySnapshot });
  initScenePanel({ task, syncUI, updateRunButton, applySnapshot, renderInspector, renderSignalList, fetchNetworks, fitView, snapSceneToGrid, updateModeUI });
  initSceneActions({ task, syncUI, updateRunButton, applySnapshot, renderInspector, renderSignalList, fetchNetworks, fitView, snapSceneToGrid, updateModeUI });
  initReplay({ scheduleChartDraw });
  initSignalList({ colorForKey, scheduleChartDraw });
  setTypeLabelHelp(typeLabelHelp);
  setSwitchTab(switchTab);
  setEmptyInspectorActions({ centerPlacement, openAddMenu, fitView });
  setInspectorActions({ deleteNode, patchNodeGeometry, nodeDiameter, deleteEdge, patchEdgeGeometry, syncUI, updateScenePanelValues, renderInspector, updateSignalKeyCache, refreshState });
  setSpecPanelActions({ attachParamHelp, confirmModal, renderInspector });
  setAnalysisActions({ task, downloadText, phaseStateKeys, C, tokens });
  setAppearanceActions({ drawModulePreview: () => drawModulePreview({ state, ui }), scheduleChartDraw });
  setPlotkitDataActions({ refreshState, renderAnalysisPanel, updateSignalKeyCache });
  setPlotkitFrameActions({ setStatusHint });
  setDocsActions({ loadTemplate });
  setGuideActions({ loadTemplate, refreshTelemetryQuality, renderScenePanel, switchMode });
  setAppearanceControlActions({ openIroColorPopover });
  setGeometryActions({ distance, circuitPinPath, wirePathPoints });
  setInstrumentActions({ scheduleChartDraw });
  setProjectActions({ confirmModal, applySnapshot, syncProjectContext, applyProjectUi, renderScenePanel, renderInspector, renderSignalList, fetchNetworks, fitView, chooseModeModal, task, showHelp });
  setWindowActions({ renderCompareGrid, setWbSignalDock, syncProjectContext, getWbComparePayload });
  loadUiProfile();
  boot();
  setTimeout(checkCacheQuietly, 6e3);
}
export {
  boot,
  bootEditor,
  projectFileInput
};
