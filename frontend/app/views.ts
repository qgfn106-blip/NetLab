// 外壳/网络侧栏/分析面板/块面板视图层（P3-06 views 抽取；行为等价，工厂闭包注入依赖）。
import { clamp } from '../app.utils.js';
import { ENDPOINTS } from './endpoints.js';
import { state, ui } from './state.js';
import { el, div, button } from './ui.js';
import { toast } from './desktop.js';
import { jsonRequest } from './net.js';
import { canvas } from './dom.js';
import { decodeProbeKey, renderSignalList } from './signal_list.js';
import { blockBadges, modulePortList } from './ui_helpers.js';
import { modulePorts } from './device_pins.js';
import { schedulePhaseDraw } from './phase.js';
import { analysisSignalKey, analysisTFSummary, drawAnalysisSpectrum, drawAnalysisTF, exportAnalysisCsv, exportTFStateSpace, runAnalysisMath, runAnalysisMetrics, runAnalysisPeriod, runAnalysisSpectrum, runAnalysisTF, runAnalysisTransfer, sendTFToPlotKit } from './analysis.js';
import type { TfDataRec, PerfRowRec, BlockItem } from './types.js';

export interface ViewsDeps {
  task<T>(run: () => T | Promise<T>, options?: { dirty?: boolean; history?: boolean; silent?: boolean }): Promise<T | null>;
  scheduleChartDraw(): void;
  resizeGraph(): void;
  resizeChart(): void;
  shellKeys: { netWidth: string; netCollapsed: string; panelCollapsed: string; panelWidth: string };
  addNetwork(): Promise<void>;
  renameNetwork(networkId?: string): Promise<void>;
  deleteNetwork(): Promise<void>;
  refreshBlocks(): Promise<void>;
  importBlockFile(): Promise<void>;
  encapsulateSelection(): Promise<void>;
  saveCurrentAsBlockCopy(): Promise<void>;
  openPluginManager(): Promise<void>;
  openViewDesigner(): Promise<void>;
  closeInternalNetwork(): Promise<void>;
  retryDegradedProject(): Promise<void>;
  describeBlockPorts(spec: BlockItem): string;
  instantiateBlockFromLibrary(blockId: string): Promise<void>;
  openModuleInternal(blockId: string, block?: BlockItem): void;
  compareBuiltinBlock(spec: BlockItem): Promise<void>;
  renameLibraryBlock(spec: BlockItem): Promise<void>;
  deleteLibraryBlock(spec: BlockItem): Promise<void>;
}

export function createViews(deps: ViewsDeps) {
  const {
    task, scheduleChartDraw, resizeGraph, resizeChart, shellKeys: SHELL_KEYS,
    addNetwork, renameNetwork, deleteNetwork, refreshBlocks, importBlockFile, encapsulateSelection,
    saveCurrentAsBlockCopy, openPluginManager, openViewDesigner, closeInternalNetwork,
    retryDegradedProject, describeBlockPorts, instantiateBlockFromLibrary, openModuleInternal,
    compareBuiltinBlock, renameLibraryBlock, deleteLibraryBlock,
  } = deps;
  const MODULE_DIR_GLYPH = { input: '→', output: '←', inout: '↔' } as const;

function renderAnalysisPanel() {
    const pane = ui.analysisPane;
    if (!pane) return;
    const host = div('blocks-host');
    const head = div('insp-head');
    const title = div('insp-title');
    title.append(el('h2', null, '分析（旁路）'), el('p', null, '只读录制数据；结论带来源，不写求解器'));
    head.appendChild(title);
    host.appendChild(head);
    const keys = state.probeKeys || [];
    const signal = el('select', 'input');
    for (const key of keys) {
      const option = el('option', null, decodeProbeKey(key).label);
      option.value = key;
      signal.appendChild(option);
    }
    const key = analysisSignalKey();
    if (key) signal.value = key;
    signal.addEventListener('change', () => {
      const chosen = String(signal.value || '');
      if (!chosen) return;
      state.chart.selected.clear();
      state.chart.selected.add(chosen);
      renderSignalList();
      scheduleChartDraw();
    });
    const keyRow = div('field-row');
    keyRow.append(el('label', null, '信号'), signal);
    host.appendChild(keyRow);
    const row = div('blocks-toolbar');
    row.append(
      button('指标', 'btn tiny primary', () => void runAnalysisMetrics()),
      button('频谱', 'btn tiny', () => void runAnalysisSpectrum()),
      button('周期', 'btn tiny', () => void runAnalysisPeriod()),
      button('数学形式', 'btn tiny', () => void runAnalysisMath()),
      button('导出 CSV', 'btn tiny', () => void exportAnalysisCsv()),
    );
    host.appendChild(row);
    const canvas = el('canvas', 'analysis-chart');
    canvas.id = 'analysisChart';
    host.appendChild(canvas);

    const transferRow = div('field-row');
    const inputNode = el('input', 'input');
    inputNode.id = 'analysisInputNode';
    inputNode.placeholder = '输入节点名';
    inputNode.value = state.scene?.nodes?.[0]?.name || '';
    const outputNode = el('input', 'input');
    outputNode.id = 'analysisOutputNode';
    outputNode.placeholder = '输出节点名';
    outputNode.value = state.scene?.nodes?.[state.scene.nodes.length - 1]?.name || '';
    transferRow.append(
      el('label', null, '传递函数'), inputNode, outputNode,
      button('推导', 'btn tiny', () => void runAnalysisTransfer()),
      button('导出 A/B/C/D', 'btn tiny', () => exportTFStateSpace()),
    );
    host.appendChild(transferRow);

    const tfSection = div('insp-section');
    tfSection.appendChild(el('h3', null, '传递函数分析（s 域）'));
    const tfNodes = (state.scene?.nodes || []).filter((node) => node.kind === 'transfer_function');
    const tfNode = el('select', 'input');
    tfNode.id = 'analysisTFNode';
    const tfDirect = el('option', null, '（用表达式）');
    tfDirect.value = '';
    tfNode.appendChild(tfDirect);
    for (const node of tfNodes) {
      const option = el('option', null, node.name);
      option.value = node.name;
      tfNode.appendChild(option);
    }
    const tfExpr = el('input', 'input');
    tfExpr.id = 'analysisTFExpr';
    tfExpr.placeholder = '如 (2*s+1)/(s^2+3*s+2)';
    tfExpr.value = '1/(s+1)';
    tfNode.addEventListener('change', () => {
      tfExpr.disabled = Boolean(tfNode.value);
    });
    const tfRow = div('field-row');
    tfRow.append(el('label', null, '节点 / 表达式'), tfNode, tfExpr);
    tfSection.appendChild(tfRow);

    const tfView = el('select', 'input');
    tfView.id = 'analysisTFView';
    for (const [value, label] of [
      ['bode', 'Bode 图'],
      ['step', '阶跃响应'],
      ['poles', '零极点图'],
    ]) {
      const option = el('option', null, label);
      option.value = value;
      tfView.appendChild(option);
    }
    tfView.addEventListener('change', () => drawAnalysisTF());
    const tfTools = div('field-row');
    tfTools.append(
      button('分析', 'btn tiny primary', () => void runAnalysisTF()),
      button('发送到 PlotKit', 'btn tiny', () => void sendTFToPlotKit()),
      el('label', null, '视图'),
      tfView,
    );
    tfSection.appendChild(tfTools);

    const tfCanvas = el('canvas', 'analysis-chart');
    tfCanvas.id = 'analysisTFChart';
    tfCanvas.style.height = '210px';
    tfSection.appendChild(tfCanvas);

    const tfOut = el('pre', 'analysis-out');
    tfOut.id = 'analysisTFOut';
    tfOut.textContent = state.analysisTF
      ? analysisTFSummary((state.analysisTF as TfDataRec))
      : '选传递函数节点或直接写 s 表达式，点「分析」得到 Bode / 阶跃 / 零极点。';
    tfSection.appendChild(tfOut);
    host.appendChild(tfSection);

    const out = el('pre', 'analysis-out');
    out.id = 'analysisOut';
    out.textContent = state.analysisLast || '选信号后运行指标/频谱/周期/数学形式；传递函数填节点名。';
    host.appendChild(out);

    const perf = div('insp-section');
    perf.appendChild(el('h3', null, '性能与超时（R13）'));
    const timeoutInput = el('input', 'input');
    timeoutInput.type = 'number';
    timeoutInput.id = 'analysisStepTimeout';
    timeoutInput.min = '0';
    timeoutInput.step = '0.5';
    timeoutInput.value = String(state.sim?.config?.step_timeout_ms ?? 0);
    const apply = button('应用单步上限', 'btn tiny', async () => {
      const response = await task(() => jsonRequest(ENDPOINTS.config, 'PATCH', { step_timeout_ms: Number(timeoutInput.value) || 0 }));
      if (response) toast('单步超时已更新（0=关闭）', 'ok', 2400);
    });
    const perfRow = div('field-row');
    perfRow.append(el('label', null, '单步上限 ms'), timeoutInput, apply);
    perf.appendChild(perfRow);
    const profileToggle = el('input');
    profileToggle.type = 'checkbox';
    profileToggle.id = 'analysisProfileEnabled';
    const profileButtons = div('field-row');
    profileButtons.append(
      el('label', null, '计时开关'), profileToggle,
      button('应用', 'btn tiny', async () => {
        const response = await task(() => jsonRequest(ENDPOINTS.profile, 'PATCH', {
          enabled: Boolean(profileToggle.checked),
        }));
        if (response) {
          profileToggle.checked = Boolean(response.enabled);
          toast(response.enabled ? '性能计时已开启' : '性能计时已关闭', 'ok', 2200);
        }
      }),
      button('清空', 'btn tiny', async () => {
        const response = await task(() => jsonRequest(ENDPOINTS.profile, 'PATCH', { reset: true }));
        if (response) toast('性能采样已清空', 'ok', 2000);
      }),
    );
    perf.appendChild(profileButtons);
    const profileOut = el('pre', 'analysis-out');
    profileOut.id = 'analysisProfile';
    profileOut.textContent = '点击刷新读取 /api/profile（默认关闭，开销可忽略）';
    perf.appendChild(
      button('刷新性能', 'btn tiny', async () => {
        const response = await task(() => jsonRequest(ENDPOINTS.profileTop(20), 'GET'), { dirty: false });
        if (!response) return;
        profileToggle.checked = Boolean(response.enabled);
        const rows = (response.entries || []).map(
          (item: PerfRowRec) => `${item.name}\t${item.count} 次\t总 ${item.total_ms} ms\t均 ${item.mean_ms} ms\t峰 ${item.max_ms} ms`,
        );
        profileOut.textContent = [
          `计时：${response.enabled ? '开' : '关'}  样本 ${response.samples}/${response.capacity}`,
          ...(rows.length ? rows : ['（暂无采样，开启计时后运行仿真）']),
        ].join('\n');
      }),
    );
    perf.appendChild(profileOut);
    host.appendChild(perf);

    pane.replaceChildren(host);
    if (state.analysisSpectrum) drawAnalysisSpectrum();
    if (state.analysisTF) drawAnalysisTF();
  }

function renderBlocksPanel() {
    const pane = ui.blocksPane;
    if (!pane) return;
    const host = div('blocks-host');
    const head = div('insp-head');
    const title = div('insp-title');
    title.append(
      el('h2', null, '模块库'),
      el('p', null, state.blocksLibrary ? `库目录：${state.blocksLibrary}` : '库目录：默认 library/'),
    );
    head.appendChild(title);
    host.appendChild(head);

    const toolbar = div('blocks-toolbar');
    const structuralRow = el('label', 'switch-row');
    structuralRow.appendChild(el('span', null, '封装为结构模型（可看内部）'));
    const structuralInput = el('input');
    structuralInput.type = 'checkbox';
    structuralInput.checked = Boolean(state.blocksStructural);
    structuralInput.addEventListener('change', () => {
      state.blocksStructural = Boolean(structuralInput.checked);
    });
    structuralRow.appendChild(structuralInput);
    toolbar.append(
      button('刷新', 'btn tiny', () => void refreshBlocks()),
      button('导入 .block', 'btn tiny', () => void importBlockFile()),
      button('封装选中', 'btn tiny primary', () => void encapsulateSelection()),
      button('另存为副本', 'btn tiny', () => void saveCurrentAsBlockCopy()),
      button('插件管理', 'btn tiny', () => void openPluginManager()),
      button('视图设计', 'btn tiny', () => void openViewDesigner()),
    );
    const closeBtn = button('关闭内部网络', 'btn tiny', () => void closeInternalNetwork());
    closeBtn.disabled = !String(state.currentNetwork?.name || '').startsWith('模块 ');
    closeBtn.title = closeBtn.disabled ? '当前不是模块内部临时网络' : '删除当前临时网络并返回上一层';
    toolbar.appendChild(closeBtn);
    if (state.sim?.degraded?.read_only) {
      toolbar.appendChild(button('补回后重试', 'btn tiny', () => void retryDegradedProject()));
    }
    host.appendChild(structuralRow);
    host.appendChild(toolbar);

    if (!state.blocks.length) {
      host.appendChild(
        div('help', '库中没有模块：选中画布节点后点「封装选中」，或用「导入 .block」载入已有模块。'),
      );
      pane.replaceChildren(host);
      return;
    }

    const list = div('block-list');
    for (const spec of state.blocks) {
      const item = div('block-item');
      const info = div('block-info');
      const name = el('strong', null, spec.name || spec.id);
      const badges = div('block-badges');
      for (const badge of blockBadges(((spec)))) badges.appendChild(el('span', 'badge gray', badge));
      info.append(name, badges);
      const ports = el('small', 'block-ports', describeBlockPorts(((spec))));
      info.appendChild(ports);
      item.draggable = true;
      item.addEventListener('dragstart', (event: MouseEvent) => {
        if (!(event as Event as DragEvent).dataTransfer) return;
        ((event as Event as DragEvent).dataTransfer as DataTransfer).setData('text/netlab-block', spec.id);
        ((event as Event as DragEvent).dataTransfer as DataTransfer).effectAllowed = 'copy';
      });
      const actions = div('block-actions');
      actions.appendChild(button('实例化', 'btn tiny primary', () => void instantiateBlockFromLibrary(spec.id)));
      const openBtn = button('打开内部', 'btn tiny', () => openModuleInternal(spec.id));
      openBtn.title = (spec.model || 'behavioral') !== 'structural'
        ? '打开内部浮窗（行为模型只看得到端口）'
        : '在内部浮窗中预览模块结构';
      actions.appendChild(openBtn);
      if (spec.builtin) {
        const compareBtn = button('行为/结构对比', 'btn tiny', () => void compareBuiltinBlock(((spec))));
        compareBtn.title = '运行行为快速模型与 structural 内部场景，对比同一输入的输出';
        actions.appendChild(compareBtn);
      }
      const renameBtn = button('改名', 'btn tiny', () => void renameLibraryBlock(((spec))));
      renameBtn.title = spec.builtin ? '内置模块只读，请先另存为副本' : '改模块名字（文件名同步改，引用不变）';
      renameBtn.disabled = Boolean(spec.builtin);
      actions.appendChild(renameBtn);
      const deleteBtn = button('删除', 'btn tiny danger', () => void deleteLibraryBlock(((spec))));
      deleteBtn.disabled = Boolean(spec.builtin);
      deleteBtn.title = spec.builtin ? '内置模块只读，不能删除' : '从库里删掉这个模块文件';
      actions.appendChild(deleteBtn);
      item.append(info, actions);
      list.appendChild(item);
    }
    host.appendChild(list);
    host.appendChild(
      div('help', '模块文件位于 library/blocks/<模块名>.block：一个模块一个文件，文件名就是模块名；库中只保留最新版。'),
    );
    pane.replaceChildren(host);
  }

function renderModuleSide(block: BlockItem) {
    const side = ui.modulePorts;
    if (side) {
      side.replaceChildren();
      const ports = modulePortList(block);
      side.appendChild(el('h4', null, `端口（${ports.length}）`));
      if (!ports.length) side.appendChild(div('help', '这个模块没有端口。'));
      for (const port of ports) {
        const row = div('port-row');
        row.appendChild(el('span', 'port-dir', MODULE_DIR_GLYPH[port.direction as keyof typeof MODULE_DIR_GLYPH] || '·'));
        const name = el('span', 'port-name', port.name);
        name.title = `${port.name} · ${port.direction}${port.net ? ` · ${port.net}` : ''}`;
        row.appendChild(name);
        row.appendChild(el('span', 'badge gray', port.dtype === 'electrical' ? '电气' : '信号'));
        side.appendChild(row);
      }
    }
    const meta = ui.moduleMeta;
    if (meta) {
      meta.replaceChildren();
      const rows = [
        ['节点', String((block?.nodes || []).length)],
        ['连线', String((block?.edges || []).length)],
        ['端口', String((block?.ports || []).length)],
        ['版本', `v${Number(block?.version || 1)}`],
        ['模型', block?.model === 'structural' ? '结构' : '行为'],
      ];
      for (const [key, value] of rows) {
        meta.appendChild(el('span', null, key));
        meta.appendChild(el('b', null, value));
      }
    }
  }

function syncChromeEdges() {
    if (!ui.main) return;
    if (ui.networks && !ui.main.classList.contains('net-hidden')) {
      const netWidth = Math.round(ui.networks.getBoundingClientRect().width);
      if (netWidth > 0) ui.main.style.setProperty('--net-edge', `${netWidth}px`);
    }
    if (ui.panel && !ui.main.classList.contains('panel-hidden')) {
      const panelWidth = Math.round(ui.panel.getBoundingClientRect().width);
      if (panelWidth > 0) ui.main.style.setProperty('--panel-edge', `${panelWidth}px`);
    }
  }

function applyNetCollapsed(collapsed: boolean) {
    ui.main.classList.toggle('net-hidden', collapsed);
    if (ui.netHanger) {
      ui.netHanger.textContent = collapsed ? '›' : '‹';
      ui.netHanger.title = collapsed ? '展开网络栏' : '收起网络栏';
      ui.netHanger.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }
    try {
      localStorage.setItem(SHELL_KEYS.netCollapsed, collapsed ? '1' : '0');
    } catch (error) {
      // 隐私模式忽略
    }
    setTimeout(() => {
      syncChromeEdges();
      resizeGraph();
      resizeChart();
      schedulePhaseDraw();
    }, 60);
  }

function toggleNetworks() {
    applyNetCollapsed(!ui.main.classList.contains('net-hidden'));
  }

function initNetworkSidebar() {
    if (!ui.networkList) return;
    let width = 0;
    let collapsed = false;
    try {
      width = Number(localStorage.getItem(SHELL_KEYS.netWidth)) || 0;
      collapsed = localStorage.getItem(SHELL_KEYS.netCollapsed) === '1';
    } catch (error) {
      width = 0;
    }
    if (width >= 140 && width <= 360) {
      ui.main.style.setProperty('--net-w', `${Math.round(width)}px`);
    }
    applyNetCollapsed(collapsed);

    ui.netHanger?.addEventListener('click', toggleNetworks);
    ui.netAdd?.addEventListener('click', () => void addNetwork());
    ui.netRename?.addEventListener('click', () => void renameNetwork());
    ui.netDelete?.addEventListener('click', () => void deleteNetwork());

    const handle = ui.netResize;
    if (!handle) return;
    let dragging = false;
    let startX = 0;
    let startWidth = 0;
    const currentWidth = () => {
      const rect = ui.networks?.getBoundingClientRect();
      if (rect && rect.width > 0) return rect.width;
      const value = parseFloat(getComputedStyle(ui.main).getPropertyValue('--net-w'));
      return Number.isFinite(value) ? value : 172;
    };
    handle.addEventListener('pointerdown', (event: PointerEvent) => {
      dragging = true;
      startX = event.clientX;
      startWidth = currentWidth();
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add('net-dragging');
      event.preventDefault();
    });
    handle.addEventListener('pointermove', (event: PointerEvent) => {
      if (!dragging) return;
      const next = clamp(Math.round(startWidth + event.clientX - startX), 140, 360);
      ui.main.style.setProperty('--net-w', `${next}px`);
      ui.main.style.setProperty('--net-edge', `${next}px`);
    });
    const finish = (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('net-dragging');
      try {
        localStorage.setItem(SHELL_KEYS.netWidth, String(Math.round(currentWidth())));
      } catch (error) {
        // 忽略
      }
      syncChromeEdges();
      resizeGraph();
      resizeChart();
      schedulePhaseDraw();
      if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  }
  return {
    renderAnalysisPanel, renderBlocksPanel, renderModuleSide,
    syncChromeEdges, applyNetCollapsed, toggleNetworks, initNetworkSidebar,
  };
}
