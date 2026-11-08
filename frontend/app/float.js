import { clamp } from "../app.utils.js";
import { state, ui } from "./state.js";
function placeFloatWindow(root, key) {
  if (!root) return;
  const geo = state[key];
  if (!geo) {
    root.classList.remove("moved");
    root.style.left = "";
    root.style.top = "";
    root.style.width = "";
    root.style.height = "";
    return;
  }
  root.classList.add("moved");
  root.style.left = `${geo.left}px`;
  root.style.top = `${geo.top}px`;
  root.style.width = `${geo.width}px`;
  root.style.height = `${geo.height}px`;
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
  root.classList.toggle("maximized");
  if (!root.classList.contains("maximized")) placeFloatWindow(root, key);
}
function initFloatWindow(root, key, spec = {}) {
  if (!root) return;
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
      const maxTop = Math.max(40, window.innerHeight - rect.height - 8);
      const maxLeft = Math.max(8, window.innerWidth - 140);
      state[key] = {
        left: clamp(event.clientX - drag.dx, 8, maxLeft),
        top: clamp(event.clientY - drag.dy, 40, maxTop),
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
    root.classList.toggle("minimized");
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
}
export {
  initFloatWindow,
  placeDocWindow,
  placeFloatWindow,
  raiseFloatWindow,
  toggleFloatMaximize
};
