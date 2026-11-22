import { clamp } from "../app.utils.js";
import { state, ui } from "./state.js";
const FLOAT_MARGIN = 8;
const FLOAT_TOP = 0;
const FLOAT_GRAB_X = 160;
const FLOAT_GRAB_Y = 40;
function clampFloatWindow(root) {
  if (!root || root.hidden) return;
  if (root.classList.contains("maximized") || root.classList.contains("minimized")) return;
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
  const positioned = root.classList.contains("moved") || !!root.style.left || !!root.style.top;
  if (!positioned && Math.abs(width - measuredWidth) < 1 && Math.abs(height - measuredHeight) < 1) return;
  const rect = root.getBoundingClientRect();
  const left = clamp(rect.left, minLeft, maxLeft);
  const top = clamp(rect.top, minTop, maxTop);
  if (Math.abs(left - rect.left) < 1 && Math.abs(top - rect.top) < 1 && Math.abs(width - measuredWidth) < 1 && Math.abs(height - measuredHeight) < 1) return;
  root.classList.add("moved");
  root.style.left = `${Math.round(left)}px`;
  root.style.top = `${Math.round(top)}px`;
  root.style.width = `${Math.round(width)}px`;
  root.style.height = `${Math.round(height)}px`;
}
function placeFloatWindow(root, key) {
  if (!root) return;
  const geo = state[key];
  if (!geo) {
    root.classList.remove("moved");
    root.style.left = "";
    root.style.top = "";
    root.style.width = "";
    root.style.height = "";
    clampFloatWindow(root);
    return;
  }
  root.classList.add("moved");
  root.style.left = `${geo.left}px`;
  root.style.top = `${geo.top}px`;
  root.style.width = `${geo.width}px`;
  root.style.height = `${geo.height}px`;
  clampFloatWindow(root);
}
function placeDocWindow() {
  placeFloatWindow(ui.docWin, "docGeo");
}
function raiseFloatWindow(root) {
  if (!root) return;
  const cur = state.floatZ || 131;
  state.floatZ = cur >= 138 ? 132 : cur + 1;
  root.style.zIndex = String(state.floatZ);
}
function toggleFloatMaximize(root, key) {
  if (!root) return;
  if (!root.classList.contains("maximized")) {
    const rect = root.getBoundingClientRect();
    state[key] = {
      left: rect.left,
      top: rect.top,
      width: root.offsetWidth,
      height: root.offsetHeight
    };
    root.classList.remove("minimized");
    root.classList.add("maximized");
    return;
  }
  root.classList.remove("maximized");
  placeFloatWindow(root, key);
}
function initFloatWindow(root, key, spec = {}) {
  if (!root) return;
  if (root.dataset.floatBound === "1") return;
  root.dataset.floatBound = "1";
  const minWidth = spec.minWidth || 420;
  const minHeight = spec.minHeight || 320;
  root.addEventListener("pointerdown", () => raiseFloatWindow(root), true);
  const head = root.querySelector(".floatwin-head");
  if (head) {
    let drag = null;
    head.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      if (root.classList.contains("maximized") || root.classList.contains("minimized")) return;
      const rect = root.getBoundingClientRect();
      drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
      head.setPointerCapture(event.pointerId);
    });
    head.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const rect = root.getBoundingClientRect();
      const keepX = Math.min(FLOAT_GRAB_X, rect.width);
      const keepY = Math.min(FLOAT_GRAB_Y, rect.height);
      const minLeft = FLOAT_MARGIN - (rect.width - keepX);
      const maxLeft = Math.max(minLeft, window.innerWidth - keepX - FLOAT_MARGIN);
      const maxTop = Math.max(FLOAT_TOP, window.innerHeight - keepY - FLOAT_MARGIN);
      state[key] = {
        left: clamp(event.clientX - drag.dx, minLeft, maxLeft),
        top: clamp(event.clientY - drag.dy, FLOAT_TOP, maxTop),
        width: rect.width,
        height: rect.height
      };
      placeFloatWindow(root, key);
    });
    const stopDrag = () => {
      drag = null;
    };
    head.addEventListener("pointerup", stopDrag);
    head.addEventListener("pointercancel", stopDrag);
    head.addEventListener("dblclick", (event) => {
      if (event.target.closest("button")) return;
      toggleFloatMaximize(root, key);
    });
  }
  root.querySelector(".floatwin-min")?.addEventListener("click", () => {
    if (root.classList.contains("minimized")) {
      root.classList.remove("minimized");
      placeFloatWindow(root, key);
    } else {
      root.classList.remove("maximized");
      root.classList.add("minimized");
    }
  });
  root.querySelector(".floatwin-max")?.addEventListener("click", () => toggleFloatMaximize(root, key));
  const grip = root.querySelector(".floatwin-resize");
  if (grip) {
    let resize = null;
    grip.addEventListener("pointerdown", (event) => {
      if (root.classList.contains("maximized") || root.classList.contains("minimized")) return;
      const rect = root.getBoundingClientRect();
      resize = { x: event.clientX, y: event.clientY, w: rect.width, h: rect.height, left: rect.left, top: rect.top };
      grip.setPointerCapture(event.pointerId);
    });
    grip.addEventListener("pointermove", (event) => {
      if (!resize) return;
      state[key] = {
        left: resize.left,
        top: resize.top,
        width: clamp(resize.w + event.clientX - resize.x, minWidth, Math.max(minWidth, window.innerWidth - resize.left - 12)),
        height: clamp(resize.h + event.clientY - resize.y, minHeight, Math.max(minHeight, window.innerHeight - resize.top - 12))
      };
      placeFloatWindow(root, key);
    });
    const stopResize = () => {
      resize = null;
    };
    grip.addEventListener("pointerup", stopResize);
    grip.addEventListener("pointercancel", stopResize);
  }
  const onViewportChange = () => {
    if (root.hidden) return;
    if (root.classList.contains("maximized") || root.classList.contains("minimized")) return;
    placeFloatWindow(root, key);
  };
  window.addEventListener("resize", onViewportChange);
  window.addEventListener("orientationchange", onViewportChange);
  document.addEventListener("fullscreenchange", onViewportChange);
}
export {
  clampFloatWindow,
  initFloatWindow,
  placeDocWindow,
  placeFloatWindow,
  raiseFloatWindow,
  toggleFloatMaximize
};
