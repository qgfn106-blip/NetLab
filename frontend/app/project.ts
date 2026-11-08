// S5-23 工程文件（.netlab）：保存 / 打开 / 自动保存 / 恢复（从 app.ts 原样迁出）
import type { ProjectRec, LimitsRec, RailItemRec } from './types.js';
import { state, ui } from './state.js';
import { el, div, button } from './ui.js';
import { api, jsonRequest } from './net.js';
import { desktopBridge, callBridge, isDesktop, showBanner, toast } from './desktop.js';
import { baseName } from '../app.utils.js';
import { activeTab } from './model.js';

type ProjectAction = (...args: any[]) => any;
const projectActions: Record<string, ProjectAction> = {};
export function setProjectActions(actions: Record<string, ProjectAction>): void {
  Object.assign(projectActions, actions);
}
function projectConfirmModal(...a: any[]) { return projectActions.confirmModal(...a); }
function applySnapshot(...a: any[]) { return projectActions.applySnapshot(...a); }
function syncProjectContext(...a: any[]) { return projectActions.syncProjectContext(...a); }
function applyProjectUi(...a: any[]) { return projectActions.applyProjectUi(...a); }
function renderScenePanel(...a: any[]) { return projectActions.renderScenePanel(...a); }
function projectRenderInspector(...a: any[]) { return projectActions.renderInspector(...a); }
function renderSignalList(...a: any[]) { return projectActions.renderSignalList(...a); }
function fetchNetworks(...a: any[]) { return projectActions.fetchNetworks(...a); }
function fitView(...a: any[]) { return projectActions.fitView(...a); }
function chooseModeModal(...a: any[]) { return projectActions.chooseModeModal(...a); }
function projectTask<T>(run: () => T | Promise<T>, options?: Record<string, unknown>): Promise<T | null> { return projectActions.task(run, options); }
function showHelp(...a: any[]) { return projectActions.showHelp(...a); }

let projectFileInput: HTMLInputElement | null = null;
export function setProjectFileInput(input: HTMLInputElement | null): void { projectFileInput = input; }

  /* ======================================================================
   * 8.5 工程文件（.netlab）：保存 / 打开 / 自动保存 / 恢复
   * ==================================================================== */

  const AUTOSAVE_KEY = 'netlab.autosave.v1';
  export const AUTOSAVE_ENABLED_KEY = 'netlab.autosave.enabled';
  const RECENT_KEY = 'netlab.recent.v1';

export function markProjectDirty() {
    if (!state.booted && !state.scene) return;
    if (!state.project.dirty) {
      state.project.dirty = true;
      const bridge = desktopBridge() as (NetlabDesktopApi & { setDirty?: (dirty: boolean) => void }) | null;
      if (bridge && typeof bridge.setDirty === 'function') {
        try {
          bridge.setDirty(true);
        } catch (error) {
          /* 桥不可用时只影响窗口标题提示 */
        }
      }
    }
    updateProjectPanel();
  }

export function projectSaved() {
    state.project.dirty = false;
    state.project.autosavedAt = 0;
    const bridge = desktopBridge() as (NetlabDesktopApi & { setDirty?: (dirty: boolean) => void }) | null;
    if (bridge && typeof bridge.setDirty === 'function') {
      try {
        bridge.setDirty(false);
      } catch (error) {
        /* 忽略 */
      }
      void callBridge('clearAutosave', []);
    } else {
      try {
        localStorage.removeItem(AUTOSAVE_KEY);
      } catch (error) {
        /* 忽略 */
      }
    }
    updateProjectPanel();
  }

export function rememberRecent(path: string, name: string) {
    if (!path) return;
    const entry: { path: string; name: string; at?: number } = { path, name: name || baseName(path), at: Date.now() };
    state.project.recent = [entry]
      .concat(state.project.recent.filter((item) => item.path !== path))
      .slice(0, 6);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(state.project.recent));
    } catch (error) {
      /* 忽略 */
    }
  }

export function loadRecent() {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      const items = raw ? JSON.parse(raw) : [];
      state.project.recent = Array.isArray(items)
        ? items.filter((item) => item && typeof item.path === 'string').slice(0, 6)
        : [];
    } catch (error) {
      state.project.recent = [];
    }
  }

export function updateProjectPanel() {
    const pane = ui.scenePane;
    if (!pane) return;
    const pathNode = pane.querySelector('[data-role="project-path"]');
    if (pathNode) {
      const parts = [];
      if (state.project.path) {
        parts.push(baseName(state.project.path));
      } else {
        parts.push(isDesktop() ? '尚未保存到文件' : '浏览器模式：保存为下载文件');
      }
      parts.push(state.project.dirty ? '● 有未保存修改' : '已保存');
      if (state.project.autosavedAt) {
        const at = new Date(state.project.autosavedAt);
        parts.push(`自动保存 ${at.toLocaleTimeString('zh-CN', { hour12: false })}`);
      }
      pathNode.textContent = parts.join(' · ');
      (pathNode as HTMLElement).title = state.project.path || '';
      pathNode.classList.toggle('dirty', state.project.dirty);
    }
    const nameInput = pane.querySelector('[data-role="project-name"]');
    if (nameInput && document.activeElement !== nameInput) {
      (nameInput as HTMLInputElement).value = state.project.name || '';
    }
    const autosaveInput = pane.querySelector('[data-role="project-autosave"]');
    if (autosaveInput) (autosaveInput as HTMLInputElement).checked = Boolean(state.project.autosave);
    const recentBox = pane.querySelector('[data-role="project-recent"]');
    if (recentBox) {
      recentBox.replaceChildren();
      recentBox.appendChild(el('span', null, '最近工程'));
      if (!state.project.recent.length) {
        recentBox.appendChild(div('help', '（暂无）'));
        return;
      }
      for (const item of state.project.recent) {
        const chip = button(item.name || baseName(item.path), 'chip', () => {
          if (isDesktop()) void openProjectPath(item.path);
          else toast('浏览器模式无法直接打开本地路径，请使用「打开工程」选择文件', 'info', 4000);
        });
        chip.title = item.path;
        recentBox.appendChild(chip);
      }
    }
  }

export async function buildProjectPayload() {
    const response = await api('/api/project/export', {
      method: 'POST',
      body: JSON.stringify({
        name: state.project.name || null,
        ui: {
          view: state.view,
          tab: activeTab(),
          workspace: state.workspace,
          grid: {
            snap: Boolean(state.ui.snap),
            size: Number(state.ui.grid) || 20,
            show: state.ui.showGrid !== false,
            markers: state.ui.snapMarkers !== false,
            orthogonal: state.ui.circuitOrthogonal !== false,
          },
          symbol: state.ui.symbol,
          nodeStyle: state.ui.nodeStyle || 'circle',
          drawingMode: Boolean(state.ui.drawingMode),
          drawingSheet: String(state.ui.drawingSheet || 'A3'),
          drawingLabels: Boolean(state.ui.drawingLabels),
          drawingPage: Math.max(1, Math.min(9, Number(state.ui.drawingPage) || 1)),
          cardDetail: state.ui.cardDetail !== false,
          cardValue: state.ui.cardValue !== false,
          symbolScale: Number(state.ui.symbolScale) || 1.2,
          glyphColor: state.ui.glyphColor || '#1f5f5b',
        },
      }),
    });
    return response && response.project ? response.project : null;
  }

export function projectDownloadText(text: string, filename: string) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

export async function saveProject(forceDialog = false) {
    const bridge = desktopBridge() as (NetlabDesktopApi & { setDirty?: (dirty: boolean) => void }) | null;
    let project = null;
    try {
      project = await buildProjectPayload();
    } catch (error) {
      toast(`保存失败：${(error as Error).message}`, 'error', 7000);
      return false;
    }
    if (!project) return false;
    const text = JSON.stringify(project, null, 2);
    const safeName = (state.project.name || 'netlab-project').replace(/[\\/:*?"<>|]+/g, '_');
    if (!bridge) {
      projectDownloadText(text, safeName.endsWith('.netlab') ? safeName : `${safeName}.netlab`);
      projectSaved();
      toast('工程已下载；浏览器模式请妥善保存该文件', 'ok', 3600);
      return true;
    }
    let path = '';
    if (!forceDialog && state.project.path) {
      path = (await callBridge('saveProjectTo', [state.project.path, text])) as string;
    }
    if (!path) {
      path = (await callBridge('saveProject', [text, safeName])) as string;
    }
    if (!path) return false;
    state.project.path = path;
    void syncProjectContext();
    state.project.name = baseName(path).replace(/\.netlab$/i, '') || state.project.name;
    rememberRecent(path, state.project.name);
    projectSaved();
    toast(`已保存：${baseName(path)}`, 'ok', 2600);
    return true;
  }

export async function importProjectText(text: string, path: string = '') {
    let project = null;
    try {
      project = JSON.parse(text);
    } catch (error) {
      toast(`工程 JSON 解析失败：${(error as Error).message}`, 'error', 7000);
      return false;
    }
    if (!project || typeof project !== 'object' || Array.isArray(project)) {
      toast('工程文件必须是 JSON 对象', 'error', 6000);
      return false;
    }
    const extensions = Array.isArray(project.extensions) ? project.extensions : [];
    let trust = false;
    if (extensions.length) {
      const body = div('trust-body');
      body.appendChild(
        el(
          'p',
          null,
          `该工程带有 ${extensions.length} 个 Python 扩展。启用后它们会在后端本进程以完整权限执行——这不是沙箱。只有确认来源可信时才继续。`,
        ),
      );
      const list = div('trust-list');
      for (const item of extensions.slice(0, 10)) {
        const row = div('trust-row');
        row.appendChild(el('b', null, String(item.kind || item.filename || '扩展')));
        row.appendChild(el('span', 'badge gray', String(item.type === 'method' ? '连接' : '节点')));
        const hash = String(item.sha256 || '').trim();
        row.appendChild(el('code', null, hash ? `sha256 ${hash.slice(0, 16)}…` : '无校验和'));
        list.appendChild(row);
      }
      if (extensions.length > 10) {
        list.appendChild(div('help', `… 另有 ${extensions.length - 10} 个未列出`));
      }
      body.appendChild(list);
      const warn = div('help trust-warn');
      warn.textContent = '选择「拒绝」后工程不会被载入；扩展代码保持不执行。';
      body.appendChild(warn);
      trust = (await projectConfirmModal('工程包含 Python 扩展', ((body)), '信任并载入', true)) as boolean;
      if (!trust) {
        toast('已取消：未启用工程内扩展，工程未载入', 'info', 5000);
        return false;
      }
    }
    let response = null;
    try {
      response = await api('/api/project/import', {
        method: 'POST',
        body: JSON.stringify({ project, trust_extensions: trust }),
      });
    } catch (error) {
      toast(`工程载入失败：${(error as Error).message}`, 'error', 8000);
      showBanner(`工程载入失败：${(error as Error).message}`);
      return false;
    }
    if (!response || !response.scene) return false;
    state.selection = { type: null, id: null };
    state.inspectorId = null;
    state.inspectorDirty = false;
    state.frames = [];
    state.values.clear();
    state.nodeValues.clear();
    state.edgeValues.clear();
    applySnapshot({ scene: response.scene, sim: response.sim, limits: (state.limits as LimitsRec | undefined) });
    state.cursor = Number(response.sim?.cursor || 0);
    applyProjectUi(response.ui);
    state.project.name = String(project.name || state.project.name || '未命名工程').slice(0, 120);
    state.project.path = path || '';
    void syncProjectContext();
    if (path) rememberRecent(path, state.project.name);
    projectSaved();
    renderScenePanel();
    projectRenderInspector();
    renderSignalList();
    await fetchNetworks();
    fitView();
    toast(`工程已载入：${state.project.name}`, 'ok', 3000);
    const rails = response.migration?.rails || [];
    if (rails.length) {
      // R21/D42：旧比较器/运放 OUT− 已断开；接地者行为不变，非地者提示复核。
      const lines = rails.slice(0, 6).map((item: RailItemRec) => {
        const risk = item.net_is_ground ? '地，行为不变' : '非地，请复核';
        return `· ${item.network || ''} ${item.device}：断开 OUT− → ${item.removed_net}（${risk}）`;
      });
      const more = rails.length > 6 ? `；… 共 ${rails.length} 条` : '';
      showBanner(`已自动迁移 ${rails.length} 个比较器/运放为单端输出：${lines.join('；')}${more}`);
      toast(`已迁移 ${rails.length} 个运放的旧输出端（R21）`, 'info', 6000);
    }
    return true;
  }

export async function openProject() {
    const bridge = desktopBridge() as (NetlabDesktopApi & { setDirty?: (dirty: boolean) => void }) | null;
    if (bridge) {
      const text = await callBridge('openProject', []);
      if (text) await importProjectText((text as string), ((await callBridge('currentPath', [])) as string) || '');
      return;
    }
    projectFileInput!.click();
  }

export async function openProjectPath(path: string) {
    const bridge = desktopBridge() as (NetlabDesktopApi & { setDirty?: (dirty: boolean) => void }) | null;
    if (!bridge) return;
    const text = await callBridge('openProjectPath', [path]);
    if (text) await importProjectText((text as string), path);
  }

export async function newProject() {
    const mode = await chooseModeModal();
    if (!mode) return;
    const labels: Record<string, string> = { signal: '信号流', circuit: '电路', vector: '矢量场' };
    const confirmed = await projectConfirmModal(
      '新建工程？',
      `将创建空白「${labels[mode]}」场景；当前场景会被替换，未保存的修改将丢失。`,
      '新建',
      true,
    );
    if (!confirmed) return;
    const response = await projectTask(
      () => jsonRequest(`/api/scene/clear?mode=${encodeURIComponent(mode)}`, 'POST'),
      { dirty: false },
    );
    if (!response) return;
    state.selection = { type: null, id: null };
    state.inspectorId = null;
    state.frames = [];
    state.values.clear();
    state.nodeValues.clear();
    state.edgeValues.clear();
    applySnapshot(response);
    state.cursor = Number(response.sim?.cursor || 0);
    state.project.name = '未命名工程';
    state.project.path = '';
    void syncProjectContext();
    projectSaved();
    renderScenePanel();
    projectRenderInspector();
    renderSignalList();
    fitView();
    toast('已新建空白工程', 'ok', 2200);
  }

export async function recoverAutosave() {
    const bridge = desktopBridge() as (NetlabDesktopApi & { setDirty?: (dirty: boolean) => void }) | null;
    let text = '';
    if (bridge) {
      if (!(await callBridge('hasAutosave', []))) {
        toast('没有可恢复的自动保存', 'info', 2600);
        return false;
      }
      text = (await callBridge('recoverAutosave', [])) as string;
    } else {
      try {
        const raw = localStorage.getItem(AUTOSAVE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        text = parsed && typeof parsed.text === 'string' ? parsed.text : '';
      } catch (error) {
        text = '';
      }
      if (!text) {
        toast('没有可恢复的自动保存', 'info', 2600);
        return false;
      }
    }
    if (!text) return false;
    const confirmed = await projectConfirmModal(
      '恢复自动保存？',
      '自动保存来自上一次未正常退出的会话，载入会替换当前场景。',
      '恢复',
      false,
    );
    if (!confirmed) return false;
    return importProjectText(text, state.project.path || '');
  }

export async function autosaveProject() {
    if (!state.project.autosave || !state.project.dirty || !state.booted) return;
    try {
      // R16/D16：工程已有落盘路径时，自动保存只写工程 backups/ 快照，绝不覆盖正本。
      if (state.project.path) {
        const response = await jsonRequest('/api/workspace/snapshot', 'POST', {
          path: state.project.path,
          name: state.project.name,
        });
        if (response && response.saved) {
          state.project.autosavedAt = Date.now();
          updateProjectPanel();
        }
        return;
      }
      const project = await buildProjectPayload();
      if (!project) return;
      const text = JSON.stringify(project);
      const bridge = desktopBridge() as (NetlabDesktopApi & { setDirty?: (dirty: boolean) => void }) | null;
      if (bridge) {
        const path = await callBridge('autosave', [text]);
        if (path) state.project.autosavedAt = Date.now();
      } else {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ at: Date.now(), text }));
        state.project.autosavedAt = Date.now();
      }
      updateProjectPanel();
    } catch (error) {
      // 自动保存失败不打断使用；只在控制台留下痕迹，状态栏不刷屏。
      console.warn('autosave failed', error);
    }
  }

export async function maybeOfferRecovery() {
    const bridge = desktopBridge() as (NetlabDesktopApi & { setDirty?: (dirty: boolean) => void }) | null;
    let available = false;
    try {
      if (bridge) {
        available = Boolean(await callBridge('hasAutosave', []));
      } else {
        available = Boolean(localStorage.getItem(AUTOSAVE_KEY));
      }
    } catch (error) {
      available = false;
    }
    if (!available) return;
    const confirmed = await projectConfirmModal(
      '发现自动保存的工程',
      '上次会话可能未正常退出。是否载入自动保存的工程？选择取消则保留当前场景。',
      '载入自动保存',
      false,
    );
    if (confirmed) await recoverAutosave();
  }

export function initProject() {
    loadRecent();
    try {
      const flag = localStorage.getItem(AUTOSAVE_ENABLED_KEY);
      if (flag === '0') state.project.autosave = false;
    } catch (error) {
      /* 忽略 */
    }
    window.addEventListener('netlab-desktop-ready', () => {
      state.project.desktop = true;
      updateProjectPanel();
    });
    window.addEventListener('beforeunload', (event: BeforeUnloadEvent) => {
      if (!state.project.dirty || isDesktop()) return;
      event.preventDefault();
      event.returnValue = '工程有未保存的修改。';
      return event.returnValue;
    });
    ((window.netlabDesktopCommand as (name: string, payload: unknown) => void) as (name: string, payload: unknown) => void) = (name: string, payload: unknown) => {
      const command = String(name || '');
      if (command === 'new') void newProject();
      else if (command === 'open') void openProject();
      else if (command === 'open-path') void openProjectPath(String(payload || ''));
      else if (command === 'save') void saveProject(false);
      else if (command === 'saveAs') void saveProject(true);
      else if (command === 'recover') void recoverAutosave();
      else if (command === 'fit') fitView(true);
      else if (command === 'help') showHelp();
      else toast(`未知桌面命令：${command}`, 'info', 2600);
    };
    // 自动保存间隔来自用户设置（默认 60 s）；设置读取失败时用默认值。
    jsonRequest('/api/settings', 'GET')
      .then((response) => {
        const settings = (response && response.settings) || {};
        if (typeof settings.autosave_enabled === 'boolean') {
          state.project.autosave = settings.autosave_enabled;
        }
        const seconds = Number(settings.autosave_interval_seconds);
        if (Number.isFinite(seconds) && seconds >= 5) {
          state.project.autosaveInterval = seconds * 1000;
        }
        updateProjectPanel();
      })
      .catch(() => {});
    setInterval(() => void autosaveProject(), state.project.autosaveInterval);
    if (isDesktop()) state.project.desktop = true;
  }
