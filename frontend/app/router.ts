import { $, $$ } from './dom.js';
import { state } from './state.js';
import { setGroupSub, setPanelGroup } from './ui_helpers.js';
import { openSettings } from './settings_guide.js';
import { renderExtensionPanel, renderSpecPane } from './spec_panel.js';
import { drawPhase, renderVectorNodeList, resizePhase } from './phase.js';
import { requestDraw } from './canvas_render.js';
import { renderWorkbenchAnalysis, renderWorkbenchState } from './analysis_workbench_panel.js';

export interface RouterDeps {
  resizeChart(): void;
  scheduleChartDraw(): void;
  notifyPlotkit(visible: boolean): void;
  renderAnalysisPanel(): void;
  renderBlocksPanel(): void;
}

let deps: RouterDeps;

const PANEL_GROUPS: Record<string, { group: string; role?: string; sub?: string }> = {
  inspect: { group: 'inspect' },
  'node-fn': { group: 'fn', role: 'node' },
  'edge-fn': { group: 'fn', role: 'edge' },
  spec: { group: 'fn' },
  blocks: { group: 'modules', sub: 'blocks' },
  ext: { group: 'modules', sub: 'ext' },
  chart: { group: 'analysis', sub: 'chart' },
  inst: { group: 'analysis', sub: 'inst' },
  vector: { group: 'analysis', sub: 'vector' },
  analysis: { group: 'analysis', sub: 'analysis' },
  plotkit: { group: 'analysis', sub: 'plotkit' },
  'wb-analysis': { group: 'workbench', sub: 'wb-analysis' },
  'wb-state': { group: 'workbench', sub: 'wb-state' },
};

function defaultTabForGroup(group: string) {
  if (group === 'fn') return state.fnRole === 'edge' ? 'edge-fn' : 'node-fn';
  if (group === 'modules') {
    const sub = $('.panel-group[data-group="modules"] .group-subnav [data-sub].active');
    return sub ? sub.dataset.sub : 'blocks';
  }
  if (group === 'analysis') {
    const sub = $('.panel-group[data-group="analysis"] .group-subnav [data-sub].active');
    return sub ? sub.dataset.sub : 'chart';
  }
  if (group === 'workbench') {
    const sub = $('.panel-group[data-group="workbench"] .group-subnav [data-sub].active');
    return sub ? sub.dataset.sub : 'wb-analysis';
  }
  return 'inspect';
}

export function switchTab(name: string) {
  if (name === 'scene') {
    openSettings('project');
    return;
  }
  const conf = PANEL_GROUPS[name] || PANEL_GROUPS.inspect;
  if (conf.role) {
    state.fnRole = conf.role;
    state.specKind = '';
    setGroupSub('fn', conf.role);
  }
  setPanelGroup(conf.group);
  if (conf.sub) setGroupSub(conf.group, conf.sub);
  if (conf.group === 'fn') {
    const note = $('#fnNote');
    if (note) note.textContent = state.fnRole === 'edge' ? '连接函数' : '节点函数';
    renderSpecPane();
    requestDraw();
  }
  if (conf.sub === 'chart') {
    deps.resizeChart();
    deps.scheduleChartDraw();
  }
  if (conf.sub === 'vector') {
    resizePhase();
    renderVectorNodeList();
    drawPhase();
  }
  if (conf.sub === 'plotkit') {
    // 侧栏只放入口；真正的绘图在非模态浮窗里（iframe 懒加载）
    $('#btnOpenPlotkit')?.focus({ preventScroll: true });
  }
  // 让 PlotKit 知道自己是"看得见"还是"被切走了"：看不见就停掉实时出图，
  // 否则面板藏在别的页签后面还在按 1Hz 出 100–200ms 的图，白烧 CPU。
  deps.notifyPlotkit(conf.sub === 'plotkit');
  if (conf.sub === 'analysis') deps.renderAnalysisPanel();
  if (conf.sub === 'wb-analysis') renderWorkbenchAnalysis();
  if (conf.sub === 'wb-state') void renderWorkbenchState();
  if (conf.sub === 'blocks') deps.renderBlocksPanel();
  if (conf.sub === 'ext') renderExtensionPanel();
}

export function bindPanelNavigation() {
  $$('.panel-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const group = tab.dataset.group;
      switchTab(group === 'inspect' ? 'inspect' : (defaultTabForGroup(group as string) as string));
    });
  });
  $$('#panel .group-subnav').forEach((nav) => {
    nav.addEventListener('click', (event: MouseEvent) => {
      const target = (event.target! as Element).closest('button');
      if (!target) return;
      if (target.dataset.fnrole) {
        state.fnRole = target.dataset.fnrole;
        state.specKind = '';
        switchTab(target.dataset.fnrole === 'edge' ? 'edge-fn' : 'node-fn');
      } else if (target.dataset.sub) {
        switchTab(target.dataset.sub);
      }
    });
  });
  setPanelGroup('inspect');
  setGroupSub('modules', 'blocks');
  setGroupSub('analysis', 'chart');
  setGroupSub('workbench', 'wb-analysis');
}

export function initRouter(d: RouterDeps) {
  deps = d;
  return { switchTab, bindPanelNavigation };
}
