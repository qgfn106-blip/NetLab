import { ENDPOINTS } from "./endpoints.js";
import { applySnapshot } from "./store.js";
import { drawModulePreview } from "./module_preview.js";
import { state, ui } from "./state.js";
import { el, div } from "./ui.js";
import { toast, showBanner } from "./desktop.js";
import { jsonRequest } from "./net.js";
import { placeFloatWindow, raiseFloatWindow, initFloatWindow } from "./float.js";
import { screenToWorld } from "./geometry.js";
import { openConfirmModal as confirmModal } from "./dialogs_build.js";
import { clearSelection, multiSelection } from "./commands.js";
import { MODULE_DIR_LABEL } from "./editor_consts.js";
import { switchTab, fetchNetworks, deleteNetwork, renderBlocksPanel, renderModuleSide } from "./editor_runtime.js";
import { fitView, task, centerPlacement, selectEntity, refreshState } from "./editor_services.js";
async function refreshBlocks() {
  const response = await task(() => jsonRequest(ENDPOINTS.blocks, "GET"), { dirty: false });
  if (!response) return;
  state.blocks = response.blocks || [];
  state.blocksLibrary = response.library || "";
  renderBlocksPanel();
}
async function instantiateBlockFromLibrary(blockId) {
  const place = centerPlacement();
  const response = await task(
    () => jsonRequest(ENDPOINTS.blockInstantiate, "POST", {
      block_id: blockId,
      position: { x: Math.round(place.x), y: Math.round(place.y) }
    })
  );
  if (!response) return;
  applySnapshot(response);
  await refreshBlocks();
  if (response.instance?.block_node) {
    await selectEntity("node", response.instance.block_node, true);
    switchTab("inspect");
  }
  toast("\u6A21\u5757\u5DF2\u5B9E\u4F8B\u5316\u5230\u753B\u5E03", "ok", 2400);
}
async function encapsulateSelection() {
  const liveNodes = new Set((state.scene?.nodes || []).map((node) => node.id));
  const picked = [...multiSelection().nodes];
  const nodes = picked.filter((id) => liveNodes.has(id));
  if (picked.length && !nodes.length) {
    await refreshState(false);
    toast("\u753B\u5E03\u5DF2\u8FC7\u671F\uFF08\u8282\u70B9\u5DF2\u4E0D\u5728\u5F53\u524D\u573A\u666F\uFF09\uFF0C\u5DF2\u5237\u65B0\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u8981\u5C01\u88C5\u7684\u8282\u70B9", "error", 5200);
    return;
  }
  if (!nodes.length) {
    toast("\u5148\u5728\u753B\u5E03\u4E0A\u9009\u4E2D\u8981\u5C01\u88C5\u7684\u8282\u70B9\uFF08Ctrl+\u5355\u51FB\u591A\u9009\uFF09", "info", 3200);
    return;
  }
  const proposed = window.prompt("\u6A21\u5757\u540D\u79F0\uFF08\u6700\u957F 32 \u5B57\uFF09", "\u6A21\u5757");
  if (proposed === null) return;
  let response = null;
  try {
    response = await jsonRequest(ENDPOINTS.blockEncapsulate, "POST", {
      node_ids: nodes,
      name: proposed,
      model: state.blocksStructural ? "structural" : "behavioral"
    });
  } catch (error) {
    await refreshState(false);
    toast(`\u5C01\u88C5\u5931\u8D25\uFF1A${error.message || error}`, "error", 6e3);
    return;
  }
  if (!response) return;
  applySnapshot({ scene: response.scene, sim: response.sim, limits: state.limits });
  state.multi.nodes.clear();
  state.multi.edges.clear();
  clearSelection();
  await refreshBlocks();
  toast(`\u5DF2\u5C01\u88C5\u4E3A\u6A21\u5757\u300C${response.block.name}\u300D\u5E76\u5199\u5165\u5E93`, "ok", 3e3);
}
async function retryDegradedProject() {
  const response = await task(() => jsonRequest(ENDPOINTS.projectRetry, "POST", {}));
  if (!response) return;
  applySnapshot({ scene: response.scene, sim: response.sim, limits: state.limits });
  if (response.degraded) {
    toast("\u5E93\u6587\u4EF6\u4ECD\u7F3A\u5931\uFF0C\u5DF2\u4FDD\u6301\u964D\u7EA7\u53EA\u8BFB", "error", 3200);
  } else {
    toast("\u5DF2\u89E3\u9664\u964D\u7EA7\u53EA\u8BFB\uFF0C\u53EF\u4EE5\u8FD0\u884C", "ok", 2800);
  }
  await refreshBlocks();
}
async function closeInternalNetwork() {
  const network = state.currentNetwork;
  if (!network || !String(network.name || "").startsWith("\u6A21\u5757 ")) {
    toast("\u5F53\u524D\u7F51\u7EDC\u4E0D\u662F\u6A21\u5757\u5185\u90E8\u4E34\u65F6\u7F51\u7EDC", "info", 2600);
    return;
  }
  await deleteNetwork();
  await refreshBlocks();
}
function initBlockDragDrop() {
  const graph = ui.graph;
  if (!graph) return;
  graph.addEventListener("dragover", (event) => {
    if (!event.dataTransfer || !event.dataTransfer.types.includes("text/netlab-block")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  graph.addEventListener("drop", async (event) => {
    const blockId = event.dataTransfer?.getData("text/netlab-block");
    if (!blockId) return;
    event.preventDefault();
    const rect = graph.getBoundingClientRect();
    const world = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    const response = await task(
      () => jsonRequest(ENDPOINTS.blockInstantiate, "POST", {
        block_id: blockId,
        position: { x: Math.round(world.x), y: Math.round(world.y) }
      })
    );
    if (!response) return;
    applySnapshot(response);
    if (response.instance?.block_node) {
      await selectEntity("node", response.instance.block_node, true);
    }
    toast("\u6A21\u5757\u5DF2\u62D6\u5165\u753B\u5E03\u5E76\u5B9E\u4F8B\u5316", "ok", 2400);
  });
}
async function openBlockInternal(blockId) {
  const response = await task(
    () => jsonRequest(ENDPOINTS.blockOpenInternal(blockId), "POST", {})
  );
  if (!response) return false;
  applySnapshot({ scene: response.scene, sim: response.sim, limits: state.limits });
  await fetchNetworks();
  fitView();
  toast("\u5DF2\u5728\u4E34\u65F6\u7F51\u7EDC\u4E2D\u6253\u5F00\u6A21\u5757\u5185\u90E8", "ok", 3e3);
  return true;
}
function describeBlockPorts(spec) {
  const ports = Array.isArray(spec?.ports) ? spec.ports : [];
  if (String(spec?.mode || "") === "circuit" && ports.length) {
    const grouped = { input: [], output: [], inout: [] };
    for (const port of ports) {
      const bucket = grouped[port.direction] || grouped.inout;
      bucket.push(port.name);
    }
    const parts = [];
    for (const key of ["input", "output", "inout"]) {
      if (grouped[key].length) parts.push(`${MODULE_DIR_LABEL[key]} ${grouped[key].join("/")}`);
    }
    return parts.join("   ") || "\u65E0\u7AEF\u53E3";
  }
  const inputs = (spec?.inputs || []).map((port) => port.name).join(", ") || "\u2014";
  const outputs = (spec?.outputs || []).map((port) => port.name).join(", ") || "\u2014";
  return `${inputs} \u2192 ${outputs}`;
}
function layoutModuleWindow() {
  if (!ui.moduleWin) return;
  ui.moduleWin.classList.toggle("docked", Boolean(state.moduleDock));
  if (ui.moduleDock) ui.moduleDock.classList.toggle("on", Boolean(state.moduleDock));
}
function openModuleInternal(blockId, block) {
  const run = async () => {
    let target = block;
    if (!target) {
      const response = await task(
        () => jsonRequest(ENDPOINTS.block(blockId), "GET"),
        { dirty: false }
      );
      if (!response?.block) return;
      target = response.block;
    }
    state.moduleBlock = target;
    if (ui.moduleWinTitle) ui.moduleWinTitle.textContent = target.name || target.id || "\u6A21\u5757\u5185\u90E8";
    if (ui.moduleWinHint) {
      const suffix = target.builtin ? " \xB7 \u5185\u7F6E\u7ED3\u6784\u53EA\u8BFB\uFF0C\u53EF\u53E6\u5B58\u526F\u672C" : "";
      ui.moduleWinHint.textContent = `MODULE \xB7 ${(target.nodes || []).length} \u8282\u70B9 \xB7 v${Number(target.version || 1)}${suffix}`;
    }
    if (ui.moduleEdit) {
      ui.moduleEdit.textContent = target.builtin ? "\u5728\u4E34\u65F6\u7F51\u7EDC\u4E2D\u53E6\u5B58\u526F\u672C" : "\u5728\u4E34\u65F6\u7F51\u7EDC\u4E2D\u7F16\u8F91";
    }
    renderModuleSide(target);
    ui.moduleWin.hidden = false;
    layoutModuleWindow();
    if (!state.moduleDock) {
      placeFloatWindow(ui.moduleWin, "moduleGeo");
      raiseFloatWindow(ui.moduleWin);
    }
    requestAnimationFrame(() => drawModulePreview({ state, ui }));
  };
  void run();
}
function closeModuleInternal() {
  if (!ui.moduleWin || ui.moduleWin.hidden) return;
  ui.moduleWin.hidden = true;
  toast("\u5DF2\u5173\u95ED\u6A21\u5757\u5185\u90E8\u89C6\u56FE", "info", 1800);
}
function toggleModuleDock() {
  if (!ui.moduleWin) return;
  state.moduleDock = !state.moduleDock;
  layoutModuleWindow();
  if (state.moduleDock) {
    ui.moduleWin.hidden = false;
    ui.moduleWin.classList.remove("moved");
    ui.moduleWin.style.left = "";
    ui.moduleWin.style.top = "";
    ui.moduleWin.style.width = "";
    ui.moduleWin.style.height = "";
    requestAnimationFrame(() => drawModulePreview({ state, ui }));
  } else {
    placeFloatWindow(ui.moduleWin, "moduleGeo");
    raiseFloatWindow(ui.moduleWin);
    requestAnimationFrame(() => drawModulePreview({ state, ui }));
  }
}
function initModuleWindow() {
  if (!ui.moduleWin) return;
  initFloatWindow(ui.moduleWin, "moduleGeo", { minWidth: 520, minHeight: 340 });
  ui.moduleWinClose?.addEventListener("click", () => closeModuleInternal());
  ui.moduleDock?.addEventListener("click", () => toggleModuleDock());
  ui.moduleEdit?.addEventListener("click", () => {
    const block = state.moduleBlock;
    if (!block?.id) return;
    void openBlockInternal(block.id).then((ok) => {
      if (ok) closeModuleInternal();
    });
  });
  ui.moduleAddInstance?.addEventListener("click", () => {
    const block = state.moduleBlock;
    if (!block?.id) return;
    void instantiateBlockFromLibrary(block.id);
  });
  if (ui.moduleStage && typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(() => {
      if (!ui.moduleWin?.hidden) drawModulePreview({ state, ui });
    });
    observer.observe(ui.moduleStage);
  }
}
async function saveCurrentAsBlockCopy() {
  const proposed = window.prompt("\u526F\u672C\u6A21\u5757\u540D\u79F0\uFF08\u65B0 id\uFF0Cv1\uFF09", `${state.currentNetwork?.name || "\u6A21\u5757"}-copy`);
  if (proposed === null) return;
  const response = await task(
    () => jsonRequest(ENDPOINTS.blockSaveCopy, "POST", { name: proposed })
  );
  if (!response) return;
  await refreshBlocks();
  await fetchNetworks();
  toast(`\u5DF2\u53E6\u5B58\u4E3A\u6A21\u5757\u526F\u672C\u300C${response.block.name}\u300D\uFF08id=${response.block.id}\uFF09`, "ok", 3400);
}
async function importBlockFile() {
  const input = el("input");
  input.type = "file";
  input.accept = ".block,application/json";
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const report = await task(
        () => jsonRequest(ENDPOINTS.blockValidate, "POST", { payload }),
        { dirty: false }
      );
      if (!report) return;
      if (!report.ok) {
        const lines = (report.blocking || []).map((item) => `\xB7 [${item.code}] ${item.message}`);
        showBanner(`\u6A21\u5757\u6821\u9A8C\u672A\u901A\u8FC7\uFF1A${lines.join("\uFF1B")}`);
        toast("\u6A21\u5757\u6821\u9A8C\u672A\u901A\u8FC7\uFF0C\u5DF2\u963B\u6B62\u5BFC\u5165\uFF08\u62A5\u544A\u89C1\u9876\u90E8\u6A2A\u5E45\uFF09", "error", 6e3);
        return;
      }
      if ((report.warnings || []).length) {
        const body = div("help");
        body.textContent = (report.warnings || []).map((item) => `\xB7 [${item.code}] ${item.message}`).join("\uFF1B");
        const proceed = await confirmModal(
          `\u6A21\u5757\u6709 ${report.warnings.length} \u6761\u8B66\u544A`,
          body,
          "\u4ECD\u7136\u5BFC\u5165",
          false
        );
        if (!proceed) return;
      }
      const response = await task(
        () => jsonRequest(ENDPOINTS.blockImport, "POST", { payload })
      );
      if (!response) return;
      await refreshBlocks();
      toast(`\u5DF2\u5BFC\u5165\u6A21\u5757 v${response.version}\uFF08\u5E72\u8DD1 ${report.summary?.dry_run || "skipped"}\uFF09`, "ok", 3e3);
    } catch (error) {
      toast(`\u5BFC\u5165\u5931\u8D25\uFF1A${error.message}`, "error", 5e3);
    }
  });
  input.click();
}
export {
  closeInternalNetwork,
  closeModuleInternal,
  describeBlockPorts,
  encapsulateSelection,
  importBlockFile,
  initBlockDragDrop,
  initModuleWindow,
  instantiateBlockFromLibrary,
  layoutModuleWindow,
  openBlockInternal,
  openModuleInternal,
  refreshBlocks,
  retryDegradedProject,
  saveCurrentAsBlockCopy,
  toggleModuleDock
};
