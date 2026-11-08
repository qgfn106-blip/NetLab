import type { FloatGeo, FloatWindowSpec, State } from './types.js';
import { clamp } from '../app.utils.js';
import { state, ui } from './state.js';

  export function placeFloatWindow(root: HTMLElement, key: string) {
    if (!root) return;
    const geo = (state as State & Record<string, FloatGeo | undefined>)[key];
    if (!geo) {
      root.classList.remove('moved');
      root.style.left = '';
      root.style.top = '';
      root.style.width = '';
      root.style.height = '';
      return;
    }
    root.classList.add('moved');
    root.style.left = `${geo.left}px`;
    root.style.top = `${geo.top}px`;
    root.style.width = `${geo.width}px`;
    root.style.height = `${geo.height}px`;
  }

  export function placeDocWindow() {
    placeFloatWindow(ui.docWin, 'docGeo');
  }

  // 非模态浮窗互不阻塞：最近一次点击/打开的窗抬到最上层（qcard 140 仍在最上）
  export function raiseFloatWindow(root: HTMLElement) {
    if (!root) return;
    const cur = state.floatZ || 131;
    state.floatZ = cur >= 138 ? 132 : cur + 1;
    root.style.zIndex = String(state.floatZ);
  }

  export function toggleFloatMaximize(root: HTMLElement, key: string) {
    if (!root) return;
    root.classList.toggle('maximized');
    if (!root.classList.contains('maximized')) placeFloatWindow(root, key);
  }

  export function initFloatWindow(root: HTMLElement, key: string, spec: FloatWindowSpec = {}) {
    if (!root) return;
    const minWidth = spec.minWidth || 420;
    const minHeight = spec.minHeight || 320;
    root.addEventListener('pointerdown', () => raiseFloatWindow(root), true);
    const head = root.querySelector('.floatwin-head');
    if (head) {
      let drag: { dx: number; dy: number } | null = null;
      (head as HTMLElement).addEventListener('pointerdown', (event: PointerEvent) => {
        if ((event.target! as Element).closest('button')) return;
        if (root.classList.contains('maximized') || root.classList.contains('minimized')) return;
        const rect = root.getBoundingClientRect();
        drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
        head.setPointerCapture(event.pointerId);
      });
      (head as HTMLElement).addEventListener('pointermove', (event: PointerEvent) => {
        if (!drag) return;
        const rect = root.getBoundingClientRect();
        // 标题栏始终留在视口内，且窗口底边不越界（否则右下角缩放柄会移到屏幕外）
        const maxTop = Math.max(40, window.innerHeight - rect.height - 8);
        const maxLeft = Math.max(8, window.innerWidth - 140);
        (state as State & Record<string, FloatGeo>)[key] = {
          left: clamp(event.clientX - drag.dx, 8, maxLeft),
          top: clamp(event.clientY - drag.dy, 40, maxTop),
          width: rect.width,
          height: rect.height,
        };
        placeFloatWindow(root, key);
      });
      const stopDrag = () => { drag = null; };
      head.addEventListener('pointerup', stopDrag);
      head.addEventListener('pointercancel', stopDrag);
      (head as HTMLElement).addEventListener('dblclick', (event: MouseEvent) => {
        if ((event.target! as Element).closest('button')) return;
        toggleFloatMaximize(root, key);
      });
    }
    root.querySelector('.floatwin-min')?.addEventListener('click', () => {
      root.classList.toggle('minimized');
    });
    root.querySelector('.floatwin-max')?.addEventListener('click', () => toggleFloatMaximize(root, key));
    const grip = root.querySelector('.floatwin-resize');
    if (grip) {
      let resize: { x: number; y: number; w: number; h: number; left: number; top: number } | null = null;
      (grip as HTMLElement).addEventListener('pointerdown', (event: PointerEvent) => {
        if (root.classList.contains('maximized') || root.classList.contains('minimized')) return;
        const rect = root.getBoundingClientRect();
        resize = { x: event.clientX, y: event.clientY, w: rect.width, h: rect.height, left: rect.left, top: rect.top };
        grip.setPointerCapture(event.pointerId);
      });
      (grip as HTMLElement).addEventListener('pointermove', (event: PointerEvent) => {
        if (!resize) return;
        (state as State & Record<string, FloatGeo>)[key] = {
          left: resize.left,
          top: resize.top,
          width: clamp(resize.w + event.clientX - resize.x, minWidth, Math.max(minWidth, window.innerWidth - resize.left - 12)),
          height: clamp(resize.h + event.clientY - resize.y, minHeight, Math.max(minHeight, window.innerHeight - resize.top - 12)),
        };
        placeFloatWindow(root, key);
      });
      const stopResize = () => { resize = null; };
      grip.addEventListener('pointerup', stopResize);
      grip.addEventListener('pointercancel', stopResize);
    }
  }
