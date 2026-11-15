import { canvas } from "./dom.js";
import { state } from "./state.js";
import { MAX_FRAMES } from "./constants.js";
function roundRectPath(context, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + w - radius, y);
  context.quadraticCurveTo(x + w, y, x + w, y + radius);
  context.lineTo(x + w, y + h - radius);
  context.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  context.lineTo(x + radius, y + h);
  context.quadraticCurveTo(x, y + h, x, y + h - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}
function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}
function frameCap() {
  const keys = Math.max(1, Number(state.sim?.probe_keys?.length) || state.values.size || 1);
  return Math.min(MAX_FRAMES, Math.max(600, Math.floor(25e4 / keys)));
}
export {
  frameCap,
  pointerPosition,
  roundRectPath
};
