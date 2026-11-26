// 网络侧栏与网络菜单处理器（P3-06 handlers 抽取；行为等价，工厂闭包注入依赖）。
import { ENDPOINTS } from './endpoints.js';
import { applySnapshot } from './store.js';
import { state } from './state.js';
import { toast } from './desktop.js';
import { api, jsonRequest } from './net.js';
import { modeLabel } from './model.js';
import { openConfirmModal as confirmModal } from './dialogs_build.js';
import { multiSelection } from './commands.js';
import { renderNetworkList, updateInfoBar } from './shell_view.js';
import { renderScenePanel } from './scene_actions.js';
import type { LimitsRec, BlockItem, NetworkItem, MenuItemRec } from './types.js';

export interface NetworkHandlersDeps {
  task<T>(run: () => T | Promise<T>, options?: { dirty?: boolean; history?: boolean; silent?: boolean }): Promise<T | null>;
  renderInspector(): void;
  fitView(announce?: boolean): void;
  newNetworkModal(defaultMode?: string): Promise<{ name: string; mode: string } | null>;
  refreshBlocks(): Promise<void>;
  encapsulateSelection(): Promise<void>;
  switchTab(name: string): void;
  openModuleInternal(blockId: string, block?: BlockItem): void;
  closeInternalNetwork(): Promise<void>;
  showFloatingMenu(x: number, y: number, items: MenuItemRec[], title?: string): HTMLDivElement;
}

export function createNetworkHandlers(deps: NetworkHandlersDeps) {
  const {
    task, renderInspector, fitView, newNetworkModal, refreshBlocks, encapsulateSelection,
    switchTab, openModuleInternal, closeInternalNetwork, showFloatingMenu,
  } = deps;

async function fetchNetworks(silent = true) {
    try {
      const response = await jsonRequest(ENDPOINTS.networks, 'GET');
      state.networks = response.networks || [];
      state.currentNetwork = state.networks.find((item) => item.current) || state.networks[0] || null;
      renderNetworkList();
      updateInfoBar();
      return state.networks;
    } catch (error) {
      if (!silent) toast(`网络列表读取失败：${(error as Error).message}`, 'error', 4000);
      return state.networks;
    }
  }

async function switchNetwork(networkId: string) {
    if (!networkId || networkId === state.currentNetwork?.id) return;
    const response = await task(() =>
      jsonRequest(ENDPOINTS.networkActivate(networkId), 'POST', {}),
    );
    if (!response || !response.scene) return;
    state.selection = { type: null, id: null };
    state.inspectorId = null;
    state.inspectorDirty = false;
    state.frames = [];
    state.values.clear();
    state.nodeValues.clear();
    state.edgeValues.clear();
    applySnapshot({ scene: response.scene, sim: response.sim, limits: (state.limits as LimitsRec | undefined) });
    state.cursor = Number(response.sim?.cursor || 0);
    await fetchNetworks();
    renderScenePanel();
    renderInspector();
    fitView();
    toast(`已切换到网络：${state.currentNetwork?.name || networkId}`, 'ok', 2200);
  }

async function addNetwork() {
    const choice = await newNetworkModal(state.mode);
    if (!choice) return;
    const payload: Record<string, unknown> = { mode: choice.mode };
    if (choice.name) payload.name = choice.name;
    const response = await task(() => jsonRequest(ENDPOINTS.networks, 'POST', payload));
    if (!response) return;
    await fetchNetworks();
    const created = String(response.created || '');
    if (created) {
      await switchNetwork(created);
    }
    toast(`已新建网络（${modeLabel(choice.mode)}模式）`, 'ok', 2600);
  }

async function renameNetwork(networkId = state.currentNetwork?.id) {
    if (!networkId) return;
    const item = (state.networks || []).find((network) => network.id === networkId);
    const proposed = window.prompt('网络名称（最长 60 字）', item?.name || '');
    if (proposed === null) return;
    const response = await task(() =>
      jsonRequest(ENDPOINTS.network(networkId), 'PATCH', { name: proposed }),
    );
    if (!response) return;
    await fetchNetworks();
    toast(`网络已改名：${response.name}`, 'ok', 2200);
  }

async function deleteNetwork() {
    const network = state.currentNetwork;
    if (!network) return;
    if ((state.networks || []).length <= 1) {
      toast('工程至少需要保留一个网络', 'error', 3200);
      return;
    }
    const confirmed = await confirmModal(
      `删除网络「${network.name}」？`,
      '该网络的节点与连接会一并删除；工程正本仍可用「保存工程」覆盖。',
      '删除',
      true,
    );
    if (!confirmed) return;
    const response = await task(() =>
      jsonRequest(ENDPOINTS.network(network.id), 'DELETE'),
    );
    if (!response) return;
    await fetchNetworks();
    const snapshot = await api(ENDPOINTS.state);
    applySnapshot(snapshot);
    toast('网络已删除', 'ok', 2200);
  }

function openNetworkMenu(network: NetworkItem, x: number, y: number) {
    const isCurrent = Boolean(network.current);
    const picked = isCurrent ? multiSelection().nodes.size : 0;
    const tempModule = String(network.name || '').startsWith('模块 ');
    const moduleName = tempModule ? String(network.name).slice(3).trim() : '';
    const knownBlock = moduleName ? (state.blocks || []).find((block: BlockItem) => block.name === moduleName) : null;
    if (tempModule && !(state.blocks || []).length) void refreshBlocks();
    const items = [
      {
        label: '封装选中节点为模块…',
        hint: isCurrent
          ? (picked ? `已选 ${picked} 个节点` : '先在画布上 Ctrl+单击多选')
          : '先切换到该网络',
        disabled: !isCurrent || !picked,
        action: () => void encapsulateSelection(),
      },
      {
        label: '打开模块库',
        hint: '封装 / 实例化 / 打开内部',
        action: () => switchTab('blocks'),
      },
      { sep: true },
      {
        label: '在模块内部浮窗中打开',
        hint: knownBlock ? `预览「${moduleName}」内部` : tempModule ? '模块库里找不到同名模块' : '先切到模块内部临时网络',
        disabled: !knownBlock,
        action: () => {
          if (knownBlock) openModuleInternal(knownBlock.id);
        },
      },
      {
        label: '关闭模块内部临时网络',
        disabled: !tempModule,
        action: () => void closeInternalNetwork(),
      },
    ];
    showFloatingMenu(x, y, items, network.name);
  }
  return { fetchNetworks, switchNetwork, addNetwork, renameNetwork, deleteNetwork, openNetworkMenu };
}
