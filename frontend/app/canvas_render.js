import { C, tokens } from "./colors.js";
import { ctx } from "./dom.js";
import { state } from "./state.js";
import { devicePinScreen, portIn, portOut, screenToWorld, worldToScreen } from "./geometry.js";
import { drawGrid } from "./canvas_base.js";
import { drawEdges } from "./canvas_edges.js";
import { drawNodes } from "./canvas_nodes.js";
import { edgeById, nodeById } from "./model.js";
import { themeKey } from "./theme.js";
const SHEET_SIZES = {
  A4: { w: 297, h: 210, label: "A4" },
  A3: { w: 420, h: 297, label: "A3" },
  A2: { w: 594, h: 420, label: "A2" },
  A1: { w: 841, h: 594, label: "A1" }
};
function drawDrawingFrame(width, height) {
  if (state.scene?.mode !== "circuit") return;
  const sheet = SHEET_SIZES[String(state.ui?.drawingSheet || "A3")] || SHEET_SIZES.A3;
  const page = Math.max(1, Math.min(9, Number(state.ui?.drawingPage) || 1));
  const margin = 12;
  const scale = Math.min((width - margin * 2) / sheet.w, (height - margin * 2) / sheet.h);
  const pw = sheet.w * scale;
  const ph = sheet.h * scale;
  const x = (width - pw) / 2;
  const y = (height - ph) / 2;
  ctx.save();
  ctx.fillStyle = C("#fffdf8");
  ctx.fillRect(x, y, pw, ph);
  ctx.strokeStyle = C("#3b352c");
  ctx.lineWidth = 2.2;
  ctx.strokeRect(x, y, pw, ph);
  ctx.lineWidth = 0.9;
  ctx.strokeRect(x + 4, y + 4, pw - 8, ph - 8);
  const cols = 8;
  const rows = 6;
  ctx.font = '9px "Cascadia Code", Consolas, monospace';
  ctx.fillStyle = C("#5b554b");
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 1; i < cols; i += 1) {
    const gx = x + pw * i / cols;
    ctx.beginPath();
    ctx.moveTo(gx, y + 4);
    ctx.lineTo(gx, y + 12);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(gx, y + ph - 4);
    ctx.lineTo(gx, y + ph - 12);
    ctx.stroke();
    ctx.fillText(String(i), gx, y + 16);
    ctx.fillText(String(i), gx, y + ph - 16);
  }
  for (let i = 1; i < rows; i += 1) {
    const gy = y + ph * i / rows;
    ctx.beginPath();
    ctx.moveTo(x + 4, gy);
    ctx.lineTo(x + 12, gy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + pw - 4, gy);
    ctx.lineTo(x + pw - 12, gy);
    ctx.stroke();
    ctx.fillText(String.fromCharCode(64 + i), x + 16, gy);
    ctx.fillText(String.fromCharCode(64 + i), x + pw - 16, gy);
  }
  const boxW = Math.min(pw * 0.58, 180 * scale);
  const boxH = Math.min(ph * 0.22, 56 * scale);
  const bx = x + pw - 4 - boxW;
  const by = y + ph - 4 - boxH;
  ctx.fillStyle = C("#fffdf8");
  ctx.fillRect(bx, by, boxW, boxH);
  ctx.strokeStyle = C("#3b352c");
  ctx.lineWidth = 1.1;
  ctx.strokeRect(bx, by, boxW, boxH);
  ctx.beginPath();
  ctx.moveTo(bx, by + boxH * 0.52);
  ctx.lineTo(bx + boxW, by + boxH * 0.52);
  ctx.moveTo(bx + boxW * 0.62, by);
  ctx.lineTo(bx + boxW * 0.62, by + boxH);
  ctx.stroke();
  ctx.textAlign = "left";
  ctx.fillStyle = C("#11100e");
  ctx.font = '600 11px "Segoe UI", "Microsoft YaHei", sans-serif';
  ctx.fillText(state.project?.name || "\u672A\u547D\u540D\u5DE5\u7A0B", bx + 8, by + 14);
  ctx.font = '9px "Cascadia Code", Consolas, monospace';
  ctx.fillStyle = C("#6f695f");
  ctx.fillText(`${state.currentNetwork?.name || "\u7F51\u7EDC"} \xB7 ${sheet.label} \xB7 \u7B2C ${page} \u9875`, bx + 8, by + 30);
  ctx.fillText(`\u6BD4\u4F8B 1:1 \xB7 ${pipeModeLabel(state.scene?.mode || "")}`, bx + 8, by + boxH - 12);
  ctx.textAlign = "right";
  ctx.fillText("NetLab / GB", bx + boxW - 8, by + 14);
  ctx.fillText((/* @__PURE__ */ new Date()).toISOString().slice(0, 10), bx + boxW - 8, by + boxH - 12);
  ctx.restore();
}
function pipeModeLabel(mode) {
  if (mode === "circuit") return "\u7535\u8DEF";
  if (mode === "vector") return "\u77E2\u91CF\u573A";
  if (mode === "signal") return "\u4FE1\u53F7\u6D41";
  return mode;
}
function drawLinkPreview() {
  const tool = state.wireTool;
  if (tool?.first) {
    const first = tool.first;
    const node = nodeById(first.nodeId);
    if (!node) return;
    const start2 = first.kind === "pin" ? devicePinScreen(node, first.pin) : worldToScreen(node.position || { x: 0, y: 0 });
    const end2 = state.pointer ? { x: state.pointer.x, y: state.pointer.y } : start2;
    ctx.save();
    ctx.strokeStyle = C("rgba(168, 84, 31, .55)");
    ctx.lineWidth = 1.7;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(start2.x, start2.y);
    ctx.lineTo(end2.x, end2.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(start2.x, start2.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = C("rgba(168, 84, 31, .25)");
    ctx.fill();
    ctx.strokeStyle = C("#a8541f");
    ctx.stroke();
    ctx.restore();
    return;
  }
  const drag = state.drag;
  if (!drag || drag.type !== "link" && drag.type !== "pin") return;
  const source = nodeById(drag.sourceId);
  if (!source) return;
  const start = drag.type === "pin" ? devicePinScreen(source, drag.pin) : portOut(source);
  const target = drag.targetId ? nodeById(drag.targetId) : null;
  const end = target ? portIn(target) : { x: state.pointer.x, y: state.pointer.y };
  const bend = Math.max(34, Math.abs(end.x - start.x) * 0.35);
  ctx.save();
  ctx.strokeStyle = target ? C("#a8541f") : C("rgba(168, 84, 31, .45)");
  ctx.lineWidth = 1.6;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.bezierCurveTo(start.x + bend, start.y, end.x - bend, end.y, end.x, end.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(end.x, end.y, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = C("#a8541f");
  ctx.fill();
  ctx.restore();
}
function drawGraph() {
  const { w, h, dpr } = state.canvasSize;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  drawGrid(w, h);
  if (!state.scene || !(state.scene.nodes || []).length) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = C("#8e8477");
    ctx.font = '13px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.fillText("\u753B\u5E03\u4E3A\u7A7A \xB7 \u70B9\u51FB\u5DE6\u4FA7\u300C\u8282\u70B9\u300D\u6216\u4ECE\u300C\u573A\u666F\u300D\u8F7D\u5165\u6A21\u677F", w / 2, h / 2);
    ctx.font = '10px "Cascadia Code", Consolas, monospace';
    ctx.fillStyle = C("#a49a89");
    ctx.fillText("\u62D6\u62FD\u79FB\u52A8 \xB7 \u4ECE\u53F3\u4FA7\u7AEF\u53E3\u62D6\u51FA\u8FDE\u63A5 \xB7 \u6EDA\u8F6E\u7F29\u653E \xB7 \u53CC\u51FB\u7F16\u8F91", w / 2, h / 2 + 24);
    ctx.restore();
    return;
  }
  drawEdges(performance.now());
  drawLinkPreview();
  drawNodes();
  drawSelectionBox();
  drawDragHud();
  if (state.ui?.drawingMode) drawDrawingFrame(w, h);
}
function drawSelectionBox() {
  const drag = state.drag;
  if (!drag || drag.type !== "box") return;
  const x = Math.min(drag.startX, drag.x);
  const y = Math.min(drag.startY, drag.y);
  const w = Math.abs(drag.x - drag.startX);
  const h = Math.abs(drag.y - drag.startY);
  ctx.save();
  const dark = themeKey() === "dark";
  ctx.fillStyle = dark ? "rgba(197, 161, 107, .16)" : "rgba(168, 84, 31, .10)";
  ctx.strokeStyle = dark ? "rgba(197, 161, 107, .70)" : "rgba(168, 84, 31, .65)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
  ctx.restore();
}
function drawDragHud() {
  const { w, h } = state.canvasSize;
  const drag = state.drag;
  let target = null;
  let label = "";
  if (drag && drag.type === "waypoint") {
    const edge = edgeById(drag.id);
    const point = edge?.waypoints?.[drag.index];
    if (point) {
      target = worldToScreen(point);
      label = `\u62D0\u70B9 ${drag.index + 1}`;
    }
  } else if (drag && drag.type === "node") {
    const node = nodeById(drag.id);
    if (node?.position) {
      target = worldToScreen(node.position);
      label = "\u8282\u70B9";
    }
  } else if (drag && drag.type === "endpoint") {
    const pointer = state.pointer;
    if (pointer) {
      target = { x: pointer.x, y: pointer.y };
      label = "\u7AEF\u70B9";
    }
  } else if (state.hoverWaypoint) {
    const edge = edgeById(state.hoverWaypoint.edgeId);
    const point = edge?.waypoints?.[state.hoverWaypoint.index];
    if (point) {
      target = worldToScreen(point);
      label = `\u62D0\u70B9 ${state.hoverWaypoint.index + 1}`;
    }
  }
  if (!target) return;
  const world = screenToWorld(target.x, target.y);
  ctx.save();
  ctx.strokeStyle = C("rgba(168, 84, 31, .28)");
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(0, target.y);
  ctx.lineTo(w, target.y);
  ctx.moveTo(target.x, 0);
  ctx.lineTo(target.x, h);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(target.x, target.y, 6, 0, Math.PI * 2);
  ctx.fillStyle = C("rgba(168, 84, 31, .18)");
  ctx.fill();
  ctx.strokeStyle = C("#a8541f");
  ctx.lineWidth = 1.6;
  ctx.stroke();
  const text = `${label}  x ${world.x.toFixed(1)}  y ${world.y.toFixed(1)}`;
  ctx.font = '11px "Cascadia Code", Consolas, monospace';
  const padding = 7;
  const textWidth = ctx.measureText(text).width;
  const boxW = textWidth + padding * 2;
  const boxH = 22;
  let bx = target.x + 16;
  let by = target.y + 16;
  if (bx + boxW > w - 8) bx = target.x - 16 - boxW;
  if (by + boxH > h - 8) by = target.y - 16 - boxH;
  ctx.fillStyle = tokens().hudBg;
  ctx.strokeStyle = C("rgba(168, 84, 31, .75)");
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(bx, by, boxW, boxH, 4) : ctx.rect(bx, by, boxW, boxH);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = C("#5a3a24");
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, bx + padding, by + boxH / 2 + 0.5);
  ctx.restore();
}
function requestDraw() {
  state.needsDraw = true;
}
const __graphMs = [];
function __dbgGraph(ms) {
  __graphMs.push(Math.round(ms * 10) / 10);
  if (__graphMs.length > 300) __graphMs.splice(0, 150);
  window.__graphMs = __graphMs;
}
function animationLoop(timestamp) {
  if (state.shuttingDown) return;
  if (state.workspace === "network") {
    if (state.sim?.running && timestamp - (state.lastPaint || 0) >= 33) {
      state.lastPaint = timestamp;
      state.needsDraw = false;
      const __g0 = performance.now();
      drawGraph();
      __dbgGraph(performance.now() - __g0);
    } else if (state.needsDraw) {
      state.needsDraw = false;
      const __g0 = performance.now();
      drawGraph();
      __dbgGraph(performance.now() - __g0);
    }
  }
  requestAnimationFrame(animationLoop);
}
export {
  SHEET_SIZES,
  __dbgGraph,
  __graphMs,
  animationLoop,
  drawDragHud,
  drawDrawingFrame,
  drawGraph,
  drawLinkPreview,
  drawSelectionBox,
  pipeModeLabel,
  requestDraw
};
