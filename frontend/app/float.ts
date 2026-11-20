import type { FloatGeo, FloatWindowSpec, State } from './types.js';
import { clamp } from '../app.utils.js';
import { state, ui } from './state.js';

  const FLOAT_MARGIN = 8;
  const FLOAT_TOP = 40;
  // 大窗口无法整体放进视口时，至少要保留这么宽/高的抓取区，避免窗口被边界“钉死”。
  const FLOAT_GRAB_X = 160;
  const FLOAT_GRAB_Y = 40;

  // 浮窗允许部分移出视口：尺寸超出可视区时收缩，但位置只约束到标题栏/抓取区仍可见。
  // 这样 1180px 宽的窗口在 1440px 屏幕上仍能左右移动，而不是只能在几十像素内挪动。
  export function clampFloatWindow(root: HTMLElement) {
    if (!root || root.hidden) return;
    if (root.classList.contains('maximized') || root.classList.contains('minimized')) return;
    const measuredWidth = root.offsetWidth;
    const measuredHeight = root.offsetHeight;
    if (!measuredWidth || !measuredHeight) return;
    const width = Math.min(measuredWidth, Math.max(1, window.innerWidth - FLOAT_MARGIN * 2));
    const height = Math.min(measuredHeight, Math.max(1, window.innerHeight - FLOAT_TOP - FLOAT_MARGIN));
    const keepX = Math.min(FLOAT_GRAB_X, width);
    const keepY = Math.min(FLOAT_GRAB_Y, height);
    const minLeft = FLOAT_MARGIN - (width - keepX);
    const maxLeft = Math.max(minLeft, window.innerWidth - keepX - FLOAT_MARGIN);
    const minTop = FLOAT_TOP;
    const maxTop = Math.max(minTop, window.innerHeight - keepY - FLOAT_MARGIN);
    // 默认居中样式由 CSS 的 max-width/max-height 保证不越界；未拖动的窗口不再量取入场动画中的变换尺寸，
    // 否则 floatwin-in 的 scale(.994) 会被当成真实尺寸写死，首次打开会轻微收缩。
    const positioned = root.classList.contains('moved') || !!root.style.left || !!root.style.top;
    if (!positioned && Math.abs(width - measuredWidth) < 1 && Math.abs(height - measuredHeight) < 1) return;
    const rect = root.getBoundingClientRect();
    const left = clamp(rect.left, minLeft, maxLeft);
    const top = clamp(rect.top, minTop, maxTop);
    if (Math.abs(left - rect.left) < 1 && Math.abs(top - rect.top) < 1
      && Math.abs(width - measuredWidth) < 1 && Math.abs(height - measuredHeight) < 1) return;
    root.classList.add('moved');
    root.style.left = `${Math.round(left)}px`;
    root.style.top = `${Math.round(top)}px`;
    root.style.width = `${Math.round(width)}px`;
    root.style.height = `${Math.round(height)}px`;
  }

  export function placeFloatWindow(root: HTMLElement, key: string) {
    if (!root) return;
    const geo = (state as State & Record<string, FloatGeo | undefined>)[key];
    if (!geo) {
      root.classList.remove('moved');
      root.style.left = '';
      root.style.top = '';
      root.style.width = '';
      root.style.height = '';
      clampFloatWindow(root);
      return;
    }
    root.classList.add('moved');
    root.style.left = `${geo.left}px`;
    root.style.top = `${geo.top}px`;
    root.style.width = `${geo.width}px`;
    root.style.height = `${geo.height}px`;
    clampFloatWindow(root);
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
    if (!root.classList.contains('maximized')) {
      const rect = root.getBoundingClientRect();
      (state as State & Record<string, FloatGeo>)[key] = {
        left: rect.left,
        top: rect.top,
        width: root.offsetWidth,
        height: root.offsetHeight,
      };
      root.classList.remove('minimized');
      root.classList.add('maximized');
      return;
    }
    root.classList.remove('maximized');
    placeFloatWindow(root, key);
  }

  export function initFloatWindow(root: HTMLElement, key: string, spec: FloatWindowSpec = {}) {
    if (!root) return;
    if (root.dataset.floatBound === '1') return;
    root.dataset.floatBound = '1';
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
        const keepX = Math.min(FLOAT_GRAB_X, rect.width);
        const keepY = Math.min(FLOAT_GRAB_Y, rect.height);
        const minLeft = FLOAT_MARGIN - (rect.width - keepX);
        const maxLeft = Math.max(minLeft, window.innerWidth - keepX - FLOAT_MARGIN);
        const maxTop = Math.max(FLOAT_TOP, window.innerHeight - keepY - FLOAT_MARGIN);
        (state as State & Record<string, FloatGeo>)[key] = {
          left: clamp(event.clientX - drag.dx, minLeft, maxLeft),
          top: clamp(event.clientY - drag.dy, FLOAT_TOP, maxTop),
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
      if (root.classList.contains('minimized')) {
        root.classList.remove('minimized');
        placeFloatWindow(root, key);
      } else {
        root.classList.remove('maximized');
        root.classList.add('minimized');
      }
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
    const onViewportChange = () => {
      if (root.hidden) return;
      if (root.classList.contains('maximized') || root.classList.contains('minimized')) return;
      placeFloatWindow(root, key);
    };
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('orientationchange', onViewportChange);
    document.addEventListener('fullscreenchange', onViewportChange);
  }
