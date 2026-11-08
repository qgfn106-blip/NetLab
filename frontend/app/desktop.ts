/* Netlab desktop bridge + toast/banner helpers (S5 split from app.ts; no behavior change). */
import { state, ui } from './state.js';
import { div, el } from './ui.js';

export function desktopBridge() {
    return window.netlabDesktop || null;
  }

export function isDesktop() {
    return Boolean(desktopBridge());
  }

export function callBridge(method: string, args: unknown[] = []) {
    const bridge = desktopBridge() as (NetlabDesktopApi & { setDirty?: (dirty: boolean) => void }) | null;
    if (!bridge || typeof (bridge as NetlabDesktopApi & Record<string, unknown>)[method] !== 'function') return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        (bridge as NetlabDesktopApi & Record<string, (...args: unknown[]) => unknown>)[method](...args, (result: unknown) => resolve(result));
      } catch (error) {
        toast(`桌面桥调用失败（${method}）：${(error as Error)?.message || error}`, 'error', 6000);
        resolve(null);
      }
    });
  }


  /* ======================================================================
   * 1. 网络请求与提示
   * ==================================================================== */


export function toast(message: string, type: string = 'info', timeout: number = 4200) {
    const node = div(`toast ${type}`, message);
    ui.toasts.appendChild(node);
    while (ui.toasts.children.length > 4) ui.toasts.firstChild!.remove();
    setTimeout(() => {
      node.style.opacity = '0';
      node.style.transform = 'translateY(4px)';
      node.style.transition = 'opacity .2s, transform .2s';
      setTimeout(() => node.remove(), 220);
    }, timeout);
    return node;
  }

export function showBanner(message: string): void {
    const text = String(message || '').trim();
    if (!text) return;
    ui.errorBanner.replaceChildren();
    const icon = el('span', null, '⚠');
    const body = el('span', null, text);
    body.style.flex = '1';
    const close = el<HTMLButtonElement>('button', null, '×');
    close.type = 'button';
    close.title = '关闭提示';
    close.addEventListener('click', () => {
      state.dismissedError = text;
      ui.errorBanner.classList.add('hidden');
    });
    ui.errorBanner.append(icon, body, close);
    ui.errorBanner.classList.remove('hidden');
  }

export function hideBanner(): void {
    ui.errorBanner.classList.add('hidden');
  }
