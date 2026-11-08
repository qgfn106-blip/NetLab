// 设置窗与引导（S5-39 从 app.ts 迁出）
import { $, $$ } from './dom.js';
import { button } from './ui.js';
import { closeAnalysis, fillAcSources, selectAnalTab, runOperatingPoint, runAcSweep } from './ac_analysis.js';
import { initFloatWindow, placeFloatWindow, raiseFloatWindow } from './float.js';
import { modeLabel } from './model.js';
import { openDoc } from './docs.js';
import { openProject } from './project.js';
import { state, ui } from './state.js';
import { syncPrefControls } from './appearance.js';
import { toast } from './desktop.js';

let guideActions = {
  loadTemplate: async (_name: string, _label: string): Promise<void> => {},
  refreshTelemetryQuality: (): void => {},
  renderScenePanel: (): void => {},
  switchMode: (_mode: string, _opts?: { skipConfirm?: boolean }): void => {},
};

export function setGuideActions(actions: {
  loadTemplate: (name: string, label: string) => Promise<void>;
  refreshTelemetryQuality: () => void;
  renderScenePanel: () => void;
  switchMode: (mode: string, opts?: { skipConfirm?: boolean }) => void;
}): void {
  guideActions = actions;
}

export function openSettings(pane = 'project') {
    if (!ui.settingsWin) return;
    ui.settingsWin.hidden = false;
    ui.settingsWin.classList.remove('minimized');
    setSettingsPane(pane);
    if (!ui.scenePane || !ui.scenePane.dataset.ready) guideActions.renderScenePanel();
    placeFloatWindow(ui.settingsWin, 'settingsGeo');
    raiseFloatWindow(ui.settingsWin);
  }

export function closeSettings() {
    if (!ui.settingsWin) return;
    ui.settingsWin.classList.remove('minimized', 'maximized');
    ui.settingsWin.hidden = true;
  }

export function setSettingsPane(pane: string) {
    $$('#settingsWin .setwin-nav button[data-pane]').forEach((node) => {
      node.classList.toggle('active', node.dataset.pane === pane);
    });
    $$('#settingsWin .setwin-pane').forEach((node) => {
      node.classList.toggle('active', node.dataset.pane === pane);
    });
    const hint = $('#setWinHint');
    if (hint) {
      const hints: Record<string, string> = {
        project: 'SETTINGS · 工程级，随 .netlab 保存',
        view: 'SETTINGS · 全局外观偏好',
        interact: 'SETTINGS · 全局交互偏好',
        diag: 'SETTINGS · 只读诊断（P5 误差合同）',
      };
      hint.textContent = hints[pane] || '';
    }
    const main = ui.settingsWin?.querySelector('.setwin-main');
    if (main) main.scrollTop = 0;
    if (pane === 'diag') void guideActions.refreshTelemetryQuality();
  }

export function initSettingsWin() {
    $('#settingsWin .setwin-nav')?.addEventListener('click', (event: MouseEvent) => {
      const target = (event.target! as Element).closest('button[data-pane]') as HTMLElement | null;
      if (target) setSettingsPane((target.dataset.pane as string));
    });
    $('#btnDiagRefresh')?.addEventListener('click', () => void guideActions.refreshTelemetryQuality());
    ui.settingsClose?.addEventListener('click', closeSettings);
    $$('#settingsWin [data-doc]').forEach((node) => {
      node.addEventListener('click', () => openDoc(node.dataset.doc));
    });
    initFloatWindow(ui.settingsWin, 'settingsGeo', { minWidth: 520, minHeight: 380 });
  }

  // ---- 启动引导 -------------------------------------------------------------
  // 开始页每次启动必显：showGuide 不再受任何偏好控制（force 参数仅为兼容旧调用保留）。
export function showGuide(force = false) {
    if (!ui.guide) return;
    void force;
    state.prefs.guide = 'always';
    state.guideShown = true;
    document.body.classList.add('guide-open');
    ui.guide.hidden = false;
    selectGuideMode(state.guideMode || state.mode || 'signal');
    syncPrefControls();
  }

export function hideGuide() {
    if (!ui.guide) return;
    ui.guide.hidden = true;
    document.body.classList.remove('guide-open');
  }

export function selectGuideMode(mode: string) {
    const picked = ['signal', 'circuit', 'vector'].includes(mode) ? mode : 'signal';
    state.guideMode = picked;
    $$('.guide-mode').forEach((node) => {
      const on = node.dataset.mode === picked;
      node.classList.toggle('selected', on);
      node.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

export async function enterGuideScene() {
    const mode = state.guideMode || 'signal';
    // 进入场景只是隐藏本次开始页，不再写入任何「不再显示」偏好，下次启动仍会显示
    hideGuide();
    if (mode !== state.mode) {
      await guideActions.switchMode(mode, { skipConfirm: true });
    } else {
      toast(`${modeLabel(mode)}场景已就绪 · 空格运行`, 'ok', 2600);
    }
  }

export function initGuide() {
    if (!ui.guide) return;
    $$('.guide-mode').forEach((node) => {
      node.addEventListener('click', () => selectGuideMode((node.dataset.mode as string)));
    });
    // 开始页标题区 = 窗口拖动柄：拖动它移动整个窗口（仅桌面壳；浏览器没有窗口可动）。
    // 旧实现拖动的是卡片本身（translate），在整屏开始页里视觉上等于没反应，已移除。
    (() => {
      const handle = document.querySelector('#guide .guide-top');
      if (!handle) return;
      const desktop = window.netlabDesktop;
      if (!desktop || typeof desktop.attachWindowDrag !== 'function') return;
      (handle as HTMLElement).style.cursor = 'grab';
      desktop.attachWindowDrag((handle as HTMLElement), {
        dblclick: false,
        onStart: () => { (handle as HTMLElement).style.cursor = 'grabbing'; },
        onEnd: () => { (handle as HTMLElement).style.cursor = 'grab'; },
      });
    })();
    ui.guideEnter?.addEventListener('click', () => void enterGuideScene());
    ui.guideClose?.addEventListener('click', hideGuide);
    ui.guideDocs?.addEventListener('click', () => {
      // 保持引导层不退出：文档窗浮在开始页之上，关闭文档后仍回到开始页
      openDoc('quickstart');
    });
    ui.guideDemo?.addEventListener('click', () => {
      hideGuide();
      void guideActions.loadTemplate('signal_chain', '信号链示例');
    });
    ui.guideOpenProject?.addEventListener('click', () => void openProject());
    ui.guideSettings?.addEventListener('click', () => openSettings('view'));
    $$('#guide [data-doc]').forEach((node) => {
      node.addEventListener('click', (event: MouseEvent) => {
        event.stopPropagation();
        openDoc(node.dataset.doc);
      });
    });
    document.addEventListener('keydown', (event: KeyboardEvent) => {
      if ((event as Event as KeyboardEvent).key === 'Enter' && !ui.guide.hidden && !(event.target! as Element).closest('input, textarea, select')) {
        event.preventDefault();
        void enterGuideScene();
      }
    });
  }
