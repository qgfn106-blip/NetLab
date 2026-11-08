// 画布绘制编排（S5-33 从 app.ts 迁出）
import { C, tokens } from './colors.js';
import { ctx } from './dom.js';
import { state, ui } from './state.js';
import { devicePinScreen, portIn, portOut, screenToWorld, worldToScreen } from './geometry.js';
import { drawGrid } from './canvas_base.js';
import { drawEdges } from './canvas_edges.js';
import { drawNodes } from './canvas_nodes.js';
import { edgeById, nodeById } from './model.js';
import { themeKey } from './theme.js';

export const SHEET_SIZES: Record<string, { w: number; h: number; label: string }> = {
    A4: { w: 297, h: 210, label: 'A4' },
    A3: { w: 420, h: 297, label: 'A3' },
    A2: { w: 594, h: 420, label: 'A2' },
    A1: { w: 841, h: 594, label: 'A1' },
  };

export function drawDrawingFrame(width: number, height: number) {
    if (state.scene?.mode !== 'circuit') return;
    const sheet = SHEET_SIZES[String(state.ui?.drawingSheet || 'A3')] || SHEET_SIZES.A3;
    const page = Math.max(1, Math.min(9, Number(state.ui?.drawingPage) || 1));
    const margin = 12;
    const scale = Math.min((width - margin * 2) / sheet.w, (height - margin * 2) / sheet.h);
    const pw = sheet.w * scale;
    const ph = sheet.h * scale;
    const x = (width - pw) / 2;
    const y = (height - ph) / 2;
    ctx.save();
    ctx.fillStyle = C('#fffdf8');
    ctx.fillRect(x, y, pw, ph);
    ctx.strokeStyle = C('#3b352c');
    ctx.lineWidth = 2.2;
    ctx.strokeRect(x, y, pw, ph);
    ctx.lineWidth = 0.9;
    ctx.strokeRect(x + 4, y + 4, pw - 8, ph - 8);

    // 分区刻度：纵向 1..8、横向 A..F（GB/T 14689 简化）。
    const cols = 8;
    const rows = 6;
    ctx.font = '9px "Cascadia Code", Consolas, monospace';
    ctx.fillStyle = C('#5b554b');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 1; i < cols; i += 1) {
      const gx = x + (pw * i) / cols;
      ctx.beginPath(); ctx.moveTo(gx, y + 4); ctx.lineTo(gx, y + 12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gx, y + ph - 4); ctx.lineTo(gx, y + ph - 12); ctx.stroke();
      ctx.fillText(String(i), gx, y + 16);
      ctx.fillText(String(i), gx, y + ph - 16);
    }
    for (let i = 1; i < rows; i += 1) {
      const gy = y + (ph * i) / rows;
      ctx.beginPath(); ctx.moveTo(x + 4, gy); ctx.lineTo(x + 12, gy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + pw - 4, gy); ctx.lineTo(x + pw - 12, gy); ctx.stroke();
      ctx.fillText(String.fromCharCode(64 + i), x + 16, gy);
      ctx.fillText(String.fromCharCode(64 + i), x + pw - 16, gy);
    }

    // 标题栏（GB 简化块），固定贴右下。
    const boxW = Math.min(pw * 0.58, 180 * scale);
    const boxH = Math.min(ph * 0.22, 56 * scale);
    const bx = x + pw - 4 - boxW;
    const by = y + ph - 4 - boxH;
    ctx.fillStyle = C('#fffdf8');
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = C('#3b352c');
    ctx.lineWidth = 1.1;
    ctx.strokeRect(bx, by, boxW, boxH);
    ctx.beginPath();
    ctx.moveTo(bx, by + boxH * 0.52); ctx.lineTo(bx + boxW, by + boxH * 0.52);
    ctx.moveTo(bx + boxW * 0.62, by); ctx.lineTo(bx + boxW * 0.62, by + boxH);
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = C('#11100e');
    ctx.font = '600 11px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.fillText(state.project?.name || '未命名工程', bx + 8, by + 14);
    ctx.font = '9px "Cascadia Code", Consolas, monospace';
    ctx.fillStyle = C('#6f695f');
    ctx.fillText(`${state.currentNetwork?.name || '网络'} · ${sheet.label} · 第 ${page} 页`, bx + 8, by + 30);
    ctx.fillText(`比例 1:1 · ${pipeModeLabel(state.scene?.mode || '')}`, bx + 8, by + boxH - 12);
    ctx.textAlign = 'right';
    ctx.fillText('NetLab / GB', bx + boxW - 8, by + 14);
    ctx.fillText(new Date().toISOString().slice(0, 10), bx + boxW - 8, by + boxH - 12);
    ctx.restore();
  }

export function pipeModeLabel(mode: string) {
    if (mode === 'circuit') return '电路';
    if (mode === 'vector') return '矢量场';
    if (mode === 'signal') return '信号流';
    return mode;
  }

export function drawLinkPreview() {
    const tool = state.wireTool;
    if (tool?.first) {
      const first = tool.first;
      const node = nodeById((first.nodeId as string | null));
      if (!node) return;
      const start = first.kind === 'pin'
        ? devicePinScreen(node, (first.pin as string))
        : worldToScreen(node.position || { x: 0, y: 0 });
      const end = state.pointer
        ? { x: state.pointer.x, y: state.pointer.y }
        : start;
      ctx.save();
      ctx.strokeStyle = C('rgba(168, 84, 31, .55)');
      ctx.lineWidth = 1.7;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(start.x, start.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = C('rgba(168, 84, 31, .25)');
      ctx.fill();
      ctx.strokeStyle = C('#a8541f');
      ctx.stroke();
      ctx.restore();
      return;
    }
    const drag = state.drag;
    if (!drag || (drag.type !== 'link' && drag.type !== 'pin')) return;
    const source = nodeById((drag.sourceId as string | null));
    if (!source) return;
    const start = drag.type === 'pin'
      ? devicePinScreen(source, (drag.pin as string))
      : portOut(source);
    const target = drag.targetId ? nodeById(drag.targetId) : null;
    const end = target ? portIn(target) : { x: state.pointer.x, y: state.pointer.y };
    const bend = Math.max(34, Math.abs(end.x - start.x) * 0.35);
    ctx.save();
    ctx.strokeStyle = target ? C('#a8541f') : C('rgba(168, 84, 31, .45)');
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.bezierCurveTo(start.x + bend, start.y, end.x - bend, end.y, end.x, end.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(end.x, end.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = C('#a8541f');
    ctx.fill();
    ctx.restore();
  }

export function drawGraph() {
    const { w, h, dpr } = state.canvasSize;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawGrid(w, h);

    if (!state.scene || !(state.scene.nodes || []).length) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = C('#8e8477');
      ctx.font = '13px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillText('画布为空 · 点击左侧「节点」或从「场景」载入模板', w / 2, h / 2);
      ctx.font = '10px "Cascadia Code", Consolas, monospace';
      ctx.fillStyle = C('#a49a89');
      ctx.fillText('拖拽移动 · 从右侧端口拖出连接 · 滚轮缩放 · 双击编辑', w / 2, h / 2 + 24);
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

export function drawSelectionBox() {
    const drag = state.drag;
    if (!drag || drag.type !== 'box') return;
    const x = Math.min((drag.startX as number), (drag.x as number));
    const y = Math.min((drag.startY as number), (drag.y as number));
    const w = Math.abs(drag.x! - drag.startX!);
    const h = Math.abs(drag.y! - drag.startY!);
    ctx.save();
    // 固定半透明：深色主题下若走 C() 的 legacy 映射，某些 token 会退化成近黑实心
    const dark = themeKey() === 'dark';
    ctx.fillStyle = dark ? 'rgba(197, 161, 107, .16)' : 'rgba(168, 84, 31, .10)';
    ctx.strokeStyle = dark ? 'rgba(197, 161, 107, .70)' : 'rgba(168, 84, 31, .65)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.restore();
  }

export function drawDragHud() {
    const { w, h } = state.canvasSize;
    const drag = state.drag;
    let target = null;
    let label = '';
    if (drag && drag.type === 'waypoint') {
      const edge = edgeById((drag.id as string | null));
      const point = edge?.waypoints?.[drag.index as number];
      if (point) {
        target = worldToScreen(point);
        label = `拐点 ${drag.index! + 1}`;
      }
    } else if (drag && drag.type === 'node') {
      const node = nodeById((drag.id as string | null));
      if (node?.position) {
        target = worldToScreen(node.position);
        label = '节点';
      }
    } else if (drag && drag.type === 'endpoint') {
      const pointer = state.pointer;
      if (pointer) {
        target = { x: pointer.x, y: pointer.y };
        label = '端点';
      }
    } else if (state.hoverWaypoint) {
      const edge = edgeById(state.hoverWaypoint.edgeId);
      const point = edge?.waypoints?.[state.hoverWaypoint.index];
      if (point) {
        target = worldToScreen((point as { x: number; y: number; }));
        label = `拐点 ${state.hoverWaypoint.index + 1}`;
      }
    }
    if (!target) return;
    const world = screenToWorld(target.x, target.y);
    ctx.save();
    // 十字准线：让用户看清拐点落在网格的哪里。
    ctx.strokeStyle = C('rgba(168, 84, 31, .28)');
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(0, target.y);
    ctx.lineTo(w, target.y);
    ctx.moveTo(target.x, 0);
    ctx.lineTo(target.x, h);
    ctx.stroke();
    ctx.setLineDash([]);
    // 拐点标记
    ctx.beginPath();
    ctx.arc(target.x, target.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = C('rgba(168, 84, 31, .18)');
    ctx.fill();
    ctx.strokeStyle = C('#a8541f');
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // 坐标标签（画布内偏移，避免贴边裁切）
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
    ctx.strokeStyle = C('rgba(168, 84, 31, .75)');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect
      ? ctx.roundRect(bx, by, boxW, boxH, 4)
      : ctx.rect(bx, by, boxW, boxH);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C('#5a3a24');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + padding, by + boxH / 2 + 0.5);
    ctx.restore();
  }

export function requestDraw() {
    state.needsDraw = true;
  }

export const __graphMs: number[] = [];
export function __dbgGraph(ms: number) {
    __graphMs.push(Math.round(ms * 10) / 10);
    if (__graphMs.length > 300) __graphMs.splice(0, 150);
    (window as Window & { __graphMs?: number[] }).__graphMs = __graphMs;
  }

export function animationLoop(timestamp: number) {
    if (state.shuttingDown) return;
    if (state.workspace === 'network') {
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
