// 画布节点绘制（S5-31 从 app.ts 迁出）
import { C, tokens } from './colors.js';
import { ctx } from './dom.js';
import { state, ui } from './state.js';
import { clamp } from '../app.utils.js';
import { anchorPoint, nodeCenterScreen, nodeRect, vectorForNode } from './geometry.js';
import { isPinNode } from './device_pins.js';
import { appearanceOf, nodeById, selectedNode } from './model.js';
import { nodeColor, nodeKindLabel, nodeValueText } from './canvas_base.js';
import { drawGbCircuitNode, drawGbDeviceNode, drawGbFunctionGlyph } from './canvas_glyphs.js';

export function drawNodes() {
    const nodes = (state.scene?.nodes || []).slice();
    const selected = selectedNode();
    if (selected) {
      const index = nodes.findIndex((node) => node.id === selected.id);
      if (index >= 0) {
        nodes.splice(index, 1);
        nodes.push(selected);
      }
    }
    const k = state.view.k;
    const showDetail = state.ui.cardDetail !== false && k > 0.38;
    const showValue = state.ui.cardValue !== false && k > 0.52;
    const nameSize = clamp(12.5 * k, 6.5, 17);
    const metaSize = clamp(7.5 * k, 5, 11);
    const valueSize = clamp(8.6 * k, 5, 12);

    for (const node of nodes) {
      const rect = nodeRect(node);
      if (rect.x + rect.w < -50 || rect.y + rect.h < -50 || rect.x > state.canvasSize.w + 50 || rect.y > state.canvasSize.h + 50) {
        continue;
      }
      const isPrimary = state.selection.type === 'node' && state.selection.id === node.id;
      const isSelected = isPrimary || state.multi?.nodes?.has(node.id);
      const isHovered = state.hover?.type === 'node' && state.hover.id === node.id;
      const ap = appearanceOf(node);
      const fontOverride = ap.fontSize;
      const accent = ap.color ? ap.color : nodeColor(node);
      const cx = rect.cx;
      const cy = rect.cy;
      const radius = rect.r;

      ctx.save();
      if (ap.opacity !== undefined) ctx.globalAlpha = clamp(ap.opacity, 0.05, 1);
      const gbStyle = state.ui?.symbol === 'gb';
      const isDeviceNode = isPinNode(node);
      let customLabel = false;
      if (isDeviceNode) {
        customLabel = true;
        drawGbDeviceNode(ctx, node, rect, accent, isSelected, isHovered, k);
      } else if (gbStyle) {
        customLabel = true;
        const isCircuitTerminal = state.scene?.mode === 'circuit'
          && (node.kind === 'node' || node.kind === 'ground');
        if (isCircuitTerminal) {
          drawGbCircuitNode(ctx, node, cx, cy, radius, accent, isSelected, isHovered, k);
        } else {
          drawGbFunctionGlyph(ctx, node, cx, cy, radius, accent, isSelected, isHovered, k);
        }
      } else {
        // 外圈与纸面圆盘
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 5, 0, Math.PI * 2);
        ctx.strokeStyle = isSelected ? C('#a8541f') : isHovered ? tokens().nodeRingHover : C('#cfc6b5');
        ctx.lineWidth = isSelected ? 1.6 : 1;
        if (!isSelected && !isHovered) ctx.setLineDash([2, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? tokens().nodeFillSelected : C('#faf8f2');
        ctx.fill();
        if (isSelected) { ctx.shadowColor = tokens().nodeShadow; ctx.shadowBlur = Math.max(6, 9 * k); }
        ctx.strokeStyle = ap.color ? ap.color : isSelected ? C('#a8541f') : C('#bcb3a1');
        ctx.lineWidth = ap.lineWidth !== undefined ? ap.lineWidth : isSelected ? 2.2 : 1;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // 顶部彩色弧线，作为类型标识
        ctx.beginPath();
        ctx.arc(cx, cy, radius - 2.5, -Math.PI * 0.78, -Math.PI * 0.22);
        ctx.strokeStyle = accent;
        ctx.lineWidth = clamp(2.4 * k, 1.2, 3.5);
        ctx.stroke();
      }

      // 矢量箭头：优先速度，其次位置 / 状态
      const vector = vectorForNode(node);
      if (vector) {
        // 画布 y 轴向下；物理平面 y 轴向上，因此取反。
        const angle = Math.atan2(-vector.vy, vector.vx);
        const length = radius + clamp(7 + 13 * Math.tanh(vector.magnitude), 7, 26);
        const sx = cx + Math.cos(angle) * (radius * 0.38);
        const sy = cy + Math.sin(angle) * (radius * 0.38);
        const ex = cx + Math.cos(angle) * length;
        const ey = cy + Math.sin(angle) * length;
        ctx.strokeStyle = vector.source === 'velocity' ? C('rgba(168, 84, 31, .5)') : C('rgba(31, 95, 91, .45)');
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.fillStyle = vector.source === 'velocity' ? C('rgba(168, 84, 31, .8)') : C('rgba(31, 95, 91, .75)');
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - 5 * Math.cos(angle - 0.42), ey - 5 * Math.sin(angle - 0.42));
        ctx.lineTo(ex - 5 * Math.cos(angle + 0.42), ey - 5 * Math.sin(angle + 0.42));
        ctx.closePath();
        ctx.fill();
      }

      if (showDetail && !customLabel) {
        const pad = radius * 0.3;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = isSelected ? tokens().nodeMetaSel : accent;
        ctx.font = `600 ${metaSize}px "Cascadia Code", Consolas, monospace`;
        ctx.fillText(nodeKindLabel(node), cx, cy - radius * 0.56, radius * 1.42);

        ctx.fillStyle = isSelected ? tokens().nodeNameSel : C('#11100e');
        ctx.font = `700 ${fontOverride ?? nameSize}px "Segoe UI", "Microsoft YaHei", sans-serif`;
        const maxNameWidth = radius * 1.55;
        let name = node.name;
        if (ctx.measureText(name).width > maxNameWidth) {
          while (name.length > 2 && ctx.measureText(`${name}…`).width > maxNameWidth) name = name.slice(0, -1);
          name += '…';
        }
        ctx.fillText(name, cx, cy - radius * 0.06);

        if (showValue) {
          ctx.fillStyle = isSelected ? tokens().nodeValueSel : C('#6f695f');
          ctx.font = `${fontOverride ?? valueSize}px "Cascadia Code", Consolas, monospace`;
          const text = node.kind === 'ground' ? '0 V · REF' : nodeValueText(node);
          ctx.fillText(text, cx, cy + radius * 0.38, radius * 1.55);
        }

        if (isSelected) {
          ctx.fillStyle = C('#a8541f');
          ctx.font = `600 ${metaSize}px "Cascadia Code", Consolas, monospace`;
          ctx.fillText('●', cx, cy - radius - 13);
          ctx.fillStyle = C('#7b7266');
          ctx.font = `${metaSize}px "Cascadia Code", Consolas, monospace`;
          ctx.fillText(node.id.slice(-4), cx + radius * 0.9, cy - radius - 13);
        }
      } else if (showDetail && customLabel) {
        const nameSize2 = clamp(10.5 * k, 6.5, 13);
        const valueSize2 = clamp(8.6 * k, 5, 12);
        const labelY = node.kind === 'device'
          ? rect.y + rect.h + Math.max(11, 11 * k)
          : cy + (radius < 20 ? Math.max(14, radius + 8) : radius * 0.62);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = C('#11100e');
        ctx.font = `600 ${fontOverride ?? nameSize2}px "Segoe UI", "Microsoft YaHei", sans-serif`;
        ctx.fillText(node.name, cx, labelY, 96);
        if (showValue && state.scene?.mode !== 'circuit') {
          ctx.fillStyle = C('#6f695f');
          ctx.font = `${fontOverride ?? valueSize2}px "Cascadia Code", Consolas, monospace`;
          const text = node.kind === 'ground' ? '0 V · REF' : nodeValueText(node);
          ctx.fillText(text, cx, labelY + (fontOverride ?? nameSize2) + 3, 96);
        }
      } else {
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.2;
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = ap.opacity !== undefined ? clamp(ap.opacity, 0.05, 1) : 1;
      }

      if (isSelected) {
        const tick = 6;
        ctx.strokeStyle = C('#a8541f');
        ctx.lineWidth = 1;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          ctx.beginPath();
          ctx.moveTo(cx + dx * (radius + 7), cy + dy * (radius + 7));
          ctx.lineTo(cx + dx * (radius + 7 + tick), cy + dy * (radius + 7 + tick));
          ctx.stroke();
        }
      }

      // 端口：电路 GB 小节点沿实际连线方向；其他模式保持左入右出
      const portRadius = clamp(3.4 * k, 2, 5);
      const circuitPorts = state.scene?.mode === 'circuit'
        && !state.ui?.drawingMode
        && state.ui?.symbol === 'gb'
        && state.ui?.nodeStyle !== 'box'
        && (node.kind === 'node' || node.kind === 'ground');
      if (circuitPorts) {
        const points: Array<{ x: number; y: number }> = [];
        for (const edge of state.scene!.edges || []) {
          if (!edge.enabled || (edge.source !== node.id && edge.target !== node.id)) continue;
          const other = nodeById(edge.source === node.id ? edge.target : edge.source);
          if (!other) continue;
          const otherCenter = nodeCenterScreen(other);
          const anchor = edge.source === node.id
            ? (edge.anchors?.source || 'auto')
            : (edge.anchors?.target || 'auto');
          const point = anchorPoint(node, anchor, otherCenter);
          if (!points.some((item) => Math.hypot(item.x - point.x, item.y - point.y) < 2)) points.push(point);
        }
        for (const point of points) {
          ctx.beginPath();
          ctx.arc(point.x, point.y, portRadius - 0.4, 0, Math.PI * 2);
          ctx.fillStyle = C('#faf8f2');
          ctx.fill();
          ctx.strokeStyle = C('#8e8477');
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.restore();
        continue;
      }
      const inPoint = { x: cx - radius, y: cy };
      const outPoint = { x: cx + radius, y: cy };
      const linkingSource = state.drag?.type === 'link' && state.drag.sourceId === node.id;
      ctx.fillStyle = C('#faf8f2');
      ctx.strokeStyle = C('#8e8477');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(inPoint.x, inPoint.y, portRadius - 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(outPoint.x, outPoint.y, linkingSource ? portRadius + 1.5 : portRadius, 0, Math.PI * 2);
      ctx.fillStyle = linkingSource ? C('#a8541f') : C('#faf8f2');
      ctx.strokeStyle = linkingSource ? C('#a8541f') : accent;
      ctx.lineWidth = 1.2;
      ctx.fill();
      ctx.stroke();

      if (isPrimary) {
        // 尺寸手柄：右下角，拖动改变节点直径（R09）
        const hx = cx + radius - 2;
        const hy = cy + radius - 2;
        ctx.fillStyle = C('#faf8f2');
        ctx.strokeStyle = C('#a8541f');
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.rect(hx - 4, hy - 4, 8, 8);
        ctx.fill();
        ctx.stroke();
      }

      ctx.restore();
    }
  }
