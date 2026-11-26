// 外壳视图：顶部信息条与左侧网络列表（由 app.ts 的 S4 抽取；行为等价）。
import { state, ui } from './state.js';
import { el, div } from './ui.js';
import type { SimRec } from './types.js';

export interface ShellViewDeps {
  setInfo(key: string, value: unknown): void;
  switchNetwork(networkId: string): Promise<void>;
  renameNetwork(networkId?: string): Promise<void>;
  openNetworkMenu(network: any, x: number, y: number): void;
}

let deps: ShellViewDeps;

export function initShellView(d: ShellViewDeps): void {
  deps = d;
}

export function updateInfoBar() {
  if (!ui.infoBar) return;
  const modeLabel = { signal: '信号流', circuit: '电路', vector: '矢量' }[state.mode] || state.mode || '—';
  const network = state.currentNetwork?.name || '网络 1';
  const total = state.networks?.length || 1;
  const sim = (state.sim || {}) as SimRec;
  deps.setInfo('project', `${state.project.name || '未命名工程'}${state.project.dirty ? ' *' : ''}`);
  deps.setInfo('network', total > 1 ? `${network} (${total})` : network);
  deps.setInfo('mode', modeLabel);
  const nodes = state.scene?.nodes?.length || 0;
  const edges = state.scene?.edges?.length || 0;
  deps.setInfo('counts', `节点 ${nodes} · 连线 ${edges}`);
  const dt = Number(sim.config?.dt ?? sim.dt ?? state.scene?.sim?.dt ?? 0);
  const dtMs = dt * 1000;
  const dtText = dt >= 1
    ? `${dt.toFixed(dt % 1 ? 2 : 0)} s`
    : `${dtMs >= 10 ? dtMs.toFixed(0) : dtMs >= 1 ? dtMs.toFixed(1) : dtMs.toFixed(2)} ms`;
  deps.setInfo('dt', `dt ${dtText}`);
  deps.setInfo('time', `t ${Number(sim.time || 0).toFixed(3)} s`);
  deps.setInfo('steps', `step ${Number(sim.steps || 0)}`);
  const alerts = Number(sim.alerts ?? sim.warnings ?? 0) || 0;
  const alertNode = ui.infoBar.querySelector('[data-info="alerts"]');
  if (alertNode) {
    alertNode.textContent = `告警 ${alerts}`;
    alertNode.classList.toggle('has-alert', alerts > 0);
  }
  const run = ui.infoBar.querySelector('[data-info="run"]');
  if (run) {
    run.textContent = sim.running ? '运行中' : '停止';
    run.classList.toggle('stopped', !sim.running);
  }
}

export function renderNetworkList() {
  if (!ui.networkList) return;
  ui.networkList.replaceChildren();
  for (const network of state.networks || []) {
    const item = el('button', 'network-item');
    item.type = 'button';
    item.setAttribute('role', 'option');
    item.dataset.networkId = network.id;
    item.classList.toggle('current', Boolean(network.current));
    item.setAttribute('aria-selected', network.current ? 'true' : 'false');
    item.title = `${network.name} · ${network.mode} · ${network.nodes} 节点 / ${network.edges} 连接`;
    const dot = div('dot');
    const label = el('span', null, network.name);
    const meta = el('span', 'meta', network.nodes as number);
    item.append(dot, label, meta);
    item.addEventListener('click', () => void deps.switchNetwork(network.id));
    item.addEventListener('dblclick', () => void deps.renameNetwork(network.id));
    item.addEventListener('contextmenu', (event: MouseEvent) => {
      event.preventDefault();
      deps.openNetworkMenu(network, event.clientX, event.clientY);
    });
    ui.networkList.appendChild(item);
  }
}
