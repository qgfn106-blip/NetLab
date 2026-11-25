import { ENDPOINTS } from "./endpoints.js";
import { applySnapshot } from "./store.js";
import { state } from "./state.js";
import { toast } from "./desktop.js";
import { api, jsonRequest } from "./net.js";
import { modeLabel } from "./model.js";
import { openConfirmModal as confirmModal } from "./dialogs_build.js";
import { multiSelection } from "./commands.js";
import { renderNetworkList, updateInfoBar } from "./shell_view.js";
import { renderScenePanel } from "./scene_actions.js";
function createNetworkHandlers(deps) {
  const {
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
  } = deps;
  async function fetchNetworks(silent = true) {
    try {
      const response = await jsonRequest(ENDPOINTS.networks, "GET");
      state.networks = response.networks || [];
      state.currentNetwork = state.networks.find((item) => item.current) || state.networks[0] || null;
      renderNetworkList();
      updateInfoBar();
      return state.networks;
    } catch (error) {
      if (!silent) toast(`\u7F51\u7EDC\u5217\u8868\u8BFB\u53D6\u5931\u8D25\uFF1A${error.message}`, "error", 4e3);
      return state.networks;
    }
  }
  async function switchNetwork(networkId) {
    if (!networkId || networkId === state.currentNetwork?.id) return;
    const response = await task(
      () => jsonRequest(ENDPOINTS.networkActivate(networkId), "POST", {})
    );
    if (!response || !response.scene) return;
    state.selection = { type: null, id: null };
    state.inspectorId = null;
    state.inspectorDirty = false;
    state.frames = [];
    state.values.clear();
    state.nodeValues.clear();
    state.edgeValues.clear();
    applySnapshot({ scene: response.scene, sim: response.sim, limits: state.limits });
    state.cursor = Number(response.sim?.cursor || 0);
    await fetchNetworks();
    renderScenePanel();
    renderInspector();
    fitView();
    toast(`\u5DF2\u5207\u6362\u5230\u7F51\u7EDC\uFF1A${state.currentNetwork?.name || networkId}`, "ok", 2200);
  }
  async function addNetwork() {
    const choice = await newNetworkModal(state.mode);
    if (!choice) return;
    const payload = { mode: choice.mode };
    if (choice.name) payload.name = choice.name;
    const response = await task(() => jsonRequest(ENDPOINTS.networks, "POST", payload));
    if (!response) return;
    await fetchNetworks();
    const created = String(response.created || "");
    if (created) {
      await switchNetwork(created);
    }
    toast(`\u5DF2\u65B0\u5EFA\u7F51\u7EDC\uFF08${modeLabel(choice.mode)}\u6A21\u5F0F\uFF09`, "ok", 2600);
  }
  async function renameNetwork(networkId = state.currentNetwork?.id) {
    if (!networkId) return;
    const item = (state.networks || []).find((network) => network.id === networkId);
    const proposed = window.prompt("\u7F51\u7EDC\u540D\u79F0\uFF08\u6700\u957F 60 \u5B57\uFF09", item?.name || "");
    if (proposed === null) return;
    const response = await task(
      () => jsonRequest(ENDPOINTS.network(networkId), "PATCH", { name: proposed })
    );
    if (!response) return;
    await fetchNetworks();
    toast(`\u7F51\u7EDC\u5DF2\u6539\u540D\uFF1A${response.name}`, "ok", 2200);
  }
  async function deleteNetwork() {
    const network = state.currentNetwork;
    if (!network) return;
    if ((state.networks || []).length <= 1) {
      toast("\u5DE5\u7A0B\u81F3\u5C11\u9700\u8981\u4FDD\u7559\u4E00\u4E2A\u7F51\u7EDC", "error", 3200);
      return;
    }
    const confirmed = await confirmModal(
      `\u5220\u9664\u7F51\u7EDC\u300C${network.name}\u300D\uFF1F`,
      "\u8BE5\u7F51\u7EDC\u7684\u8282\u70B9\u4E0E\u8FDE\u63A5\u4F1A\u4E00\u5E76\u5220\u9664\uFF1B\u5DE5\u7A0B\u6B63\u672C\u4ECD\u53EF\u7528\u300C\u4FDD\u5B58\u5DE5\u7A0B\u300D\u8986\u76D6\u3002",
      "\u5220\u9664",
      true
    );
    if (!confirmed) return;
    const response = await task(
      () => jsonRequest(ENDPOINTS.network(network.id), "DELETE")
    );
    if (!response) return;
    await fetchNetworks();
    const snapshot = await api(ENDPOINTS.state);
    applySnapshot(snapshot);
    toast("\u7F51\u7EDC\u5DF2\u5220\u9664", "ok", 2200);
  }
  function openNetworkMenu(network, x, y) {
    const isCurrent = Boolean(network.current);
    const picked = isCurrent ? multiSelection().nodes.size : 0;
    const tempModule = String(network.name || "").startsWith("\u6A21\u5757 ");
    const moduleName = tempModule ? String(network.name).slice(3).trim() : "";
    const knownBlock = moduleName ? (state.blocks || []).find((block) => block.name === moduleName) : null;
    if (tempModule && !(state.blocks || []).length) void refreshBlocks();
    const items = [
      {
        label: "\u5C01\u88C5\u9009\u4E2D\u8282\u70B9\u4E3A\u6A21\u5757\u2026",
        hint: isCurrent ? picked ? `\u5DF2\u9009 ${picked} \u4E2A\u8282\u70B9` : "\u5148\u5728\u753B\u5E03\u4E0A Ctrl+\u5355\u51FB\u591A\u9009" : "\u5148\u5207\u6362\u5230\u8BE5\u7F51\u7EDC",
        disabled: !isCurrent || !picked,
        action: () => void encapsulateSelection()
      },
      {
        label: "\u6253\u5F00\u6A21\u5757\u5E93",
        hint: "\u5C01\u88C5 / \u5B9E\u4F8B\u5316 / \u6253\u5F00\u5185\u90E8",
        action: () => switchTab("blocks")
      },
      { sep: true },
      {
        label: "\u5728\u6A21\u5757\u5185\u90E8\u6D6E\u7A97\u4E2D\u6253\u5F00",
        hint: knownBlock ? `\u9884\u89C8\u300C${moduleName}\u300D\u5185\u90E8` : tempModule ? "\u6A21\u5757\u5E93\u91CC\u627E\u4E0D\u5230\u540C\u540D\u6A21\u5757" : "\u5148\u5207\u5230\u6A21\u5757\u5185\u90E8\u4E34\u65F6\u7F51\u7EDC",
        disabled: !knownBlock,
        action: () => {
          if (knownBlock) openModuleInternal(knownBlock.id);
        }
      },
      {
        label: "\u5173\u95ED\u6A21\u5757\u5185\u90E8\u4E34\u65F6\u7F51\u7EDC",
        disabled: !tempModule,
        action: () => void closeInternalNetwork()
      }
    ];
    showFloatingMenu(x, y, items, network.name);
  }
  return { fetchNetworks, switchNetwork, addNetwork, renameNetwork, deleteNetwork, openNetworkMenu };
}
export {
  createNetworkHandlers
};
