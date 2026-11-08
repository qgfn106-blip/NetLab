// PlotKit 内嵌窗口与 VS Code 浮窗（S5-37 从 app.ts 迁出）
import { api, plotkitFrameUrl } from './net.js';
import { placeFloatWindow, raiseFloatWindow } from './float.js';
import { $, stage } from './dom.js';
import { state } from './state.js';
import { toast } from './desktop.js';

let frameActions = { setStatusHint: (_text: string, _tone?: string): void => {} };

export function setPlotkitFrameActions(actions: { setStatusHint: (text: string, tone?: string) => void }): void {
  frameActions = actions;
}

export let plotkitReady = false;

export function layoutPlotkitWindow() {
    const win = $('#plotkitWin');
    if (!win) return;
    win.classList.toggle('docked', Boolean(state.plotkitDock));
    const dock = $('#plotkitDock');
    if (dock) dock.classList.toggle('on', Boolean(state.plotkitDock));
    if (!state.plotkitDock) {
      if (!win.hidden) placeFloatWindow(win, 'plotkitGeo');
      return;
    }
    // 停靠 = 贴在画布区右侧，占 62% 宽、72% 高；跟随窗口尺寸变化
    const stage = $('#graph')?.closest('.stage') || $('#graph')?.parentElement;
    const rect = stage?.getBoundingClientRect();
    if (!rect || rect.width < 240) return;
    const width = Math.max(560, Math.round(rect.width * 0.72));
    const height = Math.max(320, Math.round(rect.height * 0.78));
    win.style.left = `${Math.round(rect.left + rect.width - width - 16)}px`;
    win.style.top = `${Math.round(rect.top + 16)}px`;
    win.style.width = `${width}px`;
    win.style.height = `${height}px`;
  }

export function togglePlotkitDock() {
    const win = $('#plotkitWin');
    if (!win || win.hidden) return;
    state.plotkitDock = !state.plotkitDock;
    if (!state.plotkitDock) {
      win.style.left = '';
      win.style.top = '';
      win.style.width = '';
      win.style.height = '';
    }
    layoutPlotkitWindow();
  }

export function ensurePlotkitFrame() {
    const frame = $('#plotkitFrame');
    if (frame && !plotkitReady) {
      (frame as HTMLIFrameElement).src = plotkitFrameUrl({ embed: '1' });
      plotkitReady = true;
    }
    return frame;
  }

  // 三种承载方式：嵌进右侧「分析 → 绘图」页签 / 浮窗 / 独立浏览器窗口
export function placePlotkit(mode: string) {
    const frame = ensurePlotkitFrame();
    const win = $('#plotkitWin');
    const host = $('#plotkitInlineHost');
    const floatBody = $('#plotkitWin .plotkit-body');
    state.plotkitMode = mode;
    if (!frame) {
      if (mode === 'popup') toast('绘图 iframe 不存在，已改为独立窗口', 'warn', 2400);
      return;
    }
    if (mode === 'inline') {
      if (win) win.hidden = true;
      if (host) {
        host.hidden = false;
        host.appendChild(frame);
      }
      (document.querySelector('[data-sub="plotkit"]') as HTMLElement)?.click();
      if (typeof frameActions.setStatusHint === 'function') frameActions.setStatusHint('绘图已嵌在右侧面板 · 点「浮出窗口」可拖到画布上');
    } else if (mode === 'float') {
      if (host) host.hidden = true;
      if (floatBody) floatBody.appendChild(frame);
      openPlotkit();
    } else if (mode === 'popup') {
      const url = plotkitFrameUrl({ embed: '1' });
      const popup = window.open(url, 'netlab-plotkit', 'width=1180,height=820');
      if (popup) {
        toast('已在独立窗口打开绘图', 'ok', 2400);
        if (typeof frameActions.setStatusHint === 'function') frameActions.setStatusHint('独立绘图窗口 · 数据与主界面同源');
      } else {
        toast('浏览器拦截了弹出窗口，请允许后重试', 'warn', 3200);
      }
    }
  }

export function openPlotkit() {
    const win = $('#plotkitWin');
    if (!win) return;
    ensurePlotkitFrame();
    win.hidden = false;
    win.classList.remove('minimized');
    layoutPlotkitWindow();
    if (typeof raiseFloatWindow === 'function') raiseFloatWindow(win);
  }

export function closePlotkit() {
    const win = $('#plotkitWin');
    if (!win) return;
    win.hidden = true;
    win.classList.remove('minimized', 'maximized');
    state.plotkitGeo = null;
  }

  // ---- VS Code 代码工作区（非模态浮窗；iframe 直连本地 code server） ----------
export let vscodeStarting: Promise<unknown> | null = null;

export async function ensureVscodeFrame() {
    const frame = $('#vscodeFrame');
    if (!frame) return null;
    if (frame.dataset.ready === '1') return frame;
    if (vscodeStarting) return vscodeStarting;
    const status = $('#vscodeStatus');
    if (status) {
      status.hidden = false;
      status.textContent = '正在启动 VS Code Server…';
    }
    vscodeStarting = (async () => {
      try {
        const info = await api('/api/vscode/status?start=1', { timeoutMs: 60000 });
        if (!info || !info.url) {
          throw new Error((info && info.error) || 'VS Code Server 不可用');
        }
        (frame as HTMLIFrameElement).src = info.url;
        frame.dataset.ready = '1';
        if (status) status.hidden = true;
        try { localStorage.setItem('netlab.vscode.used', '1'); } catch (e) {}
        return frame;
      } catch (error) {
        if (status) {
          status.hidden = false;
          status.textContent = `VS Code 启动失败：${(error as Error).message}`;
        }
        toast(`VS Code 启动失败：${(error as Error).message}`, 'warn', 5000);
        return null;
      } finally {
        vscodeStarting = null;
      }
    })();
    return vscodeStarting;
  }

export async function openVscode() {
    const win = $('#vscodeWin');
    if (!win) return;
    win.hidden = false;
    win.classList.remove('minimized');
    placeFloatWindow(win, 'vscodeGeo');
    raiseFloatWindow(win);
    await ensureVscodeFrame();
  }

export function closeVscode() {
    const win = $('#vscodeWin');
    if (!win) return;
    win.hidden = true;
    win.classList.remove('minimized', 'maximized');
    state.vscodeGeo = null;
  }

  // 用过一次 VS Code 后，下次启动应用时后台静默预热（拉起 server + 预载 21MB 包，
  // 让下一次点开是热缓存 ~1.7s，而不是冷启动 5–8s）。仅对老用户生效，新人首次不预载。
export function vscodeWasUsed() {
    try { return localStorage.getItem('netlab.vscode.used') === '1'; } catch (e) { return false; }
  }

export function maybePrewarmVscode() {
    if (!vscodeWasUsed()) return;
    setTimeout(() => { void ensureVscodeFrame(); }, 2500);
  }
