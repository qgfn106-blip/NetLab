// 画布连线绘制（S5-32 从 app.ts 迁出）
import { C, tokens } from './colors.js';
import { ctx } from './dom.js';
import { state, ui } from './state.js';
import { clamp, hashString } from '../app.utils.js';
import { anchorScreenPoint, edgePathPoints, pathEndAngle, pathMidpoint, pathPointAt, worldToScreen } from './geometry.js';
import { circuitMidAngle, circuitWireGap, drawCircuitGlyph, elementPins } from './circuit_symbols.js';
import { circuitCrossingMap, drawCrossingHops, drawMultiPinWires, edgeValueText, elementIdentifier } from './canvas_base.js';
import { appearanceOf, nodeById } from './model.js';
import type { BoxRec } from './types.js';

export function labelCollisionFree(cx: number, cy: number, width: number, height: number, occupied: BoxRec[]) {
    const candidates = [
      [0, 0], [0, -14], [0, 14], [0, -28], [0, 28],
      [width / 2 + 12, 0], [-width / 2 - 12, 0],
    ];
    for (const [dx, dy] of candidates) {
      const rect = { x: cx + dx - width / 2, y: cy + dy - height / 2, w: width, h: height };
      const hit = occupied.some((item: BoxRec) =>
        rect.x < item.x + item.w && rect.x + rect.w > item.x && rect.y < item.y + item.h && rect.y + rect.h > item.y);
      if (!hit) return rect;
    }
    return { x: cx - width / 2, y: cy - height / 2, w: width, h: height };
  }

export function drawEdges(now: number) {
    const edges = (state.scene?.edges || []).slice().sort((a, b) => {
      if (a.id === state.selection.id) return 1;
      if (b.id === state.selection.id) return -1;
      return 0;
    });
    const crossingMap = circuitCrossingMap(edges);
    const occupiedLabels = [];
    for (const edge of edges) {
      const points = edgePathPoints(edge);
      if (!points || points.length < 2) continue;
      const selected =
        (state.selection.type === 'edge' && state.selection.id === edge.id) ||
        state.multi?.edges?.has(edge.id);
      const hovered = state.hover?.type === 'edge' && state.hover.id === edge.id;
      let color: string = tokens().edgeDefault;
      if (!edge.enabled) color = tokens().edgeDisabled;
      else if (edge.delay) color = tokens().edgeDelay;
      if (selected) color = C('#a8541f');
      else if (hovered) color = tokens().edgeHover;
      const ap = appearanceOf(edge);
      const strokeColor = ap.strokeColor || ap.color;
      if (strokeColor) color = strokeColor;

      ctx.save();
      if (ap.opacity !== undefined) ctx.globalAlpha = clamp(ap.opacity, 0.05, 1);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = color;
      ctx.lineWidth = ap.lineWidth !== undefined ? ap.lineWidth : selected ? 2.1 : hovered ? 1.7 : state.ui?.drawingMode ? (edge.kind === 'wire' ? 1.75 : 1.3) : 1.15;
      if (!edge.enabled) ctx.setLineDash([3, 5]);
      else if (edge.delay) ctx.setLineDash([7, 5]);
      if (ap.lineStyle === 'dashed') ctx.setLineDash([7, 5]);
      else if (ap.lineStyle === 'dotted') ctx.setLineDash([2, 4]);
      else if (ap.lineStyle === 'solid') ctx.setLineDash([]);
      const circuitGb = state.scene?.mode === 'circuit' && state.ui?.symbol === 'gb';
      const multiPin = circuitGb && elementPins(edge).length > 2;
      if (!multiPin) {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length; index += 1) {
          ctx.lineTo(points[index].x, points[index].y);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);

      if (circuitGb) {
        const hops = crossingMap.get(edge.id);
        if (hops && hops.length) drawCrossingHops(hops, color);
        drawMultiPinWires(edge, color);
        const middle = pathMidpoint(points);
        const layout = edge.layout || null;
        const center = layout && Number.isFinite(layout.x) && Number.isFinite(layout.y)
          ? worldToScreen({ x: layout.x, y: layout.y })
          : middle;
        if (center && !multiPin && edge.kind !== 'wire') circuitWireGap(points, center, 40 * Math.max(1.2, state.view.k));
        drawCircuitGlyph(edge, points, color);
      } else {
        const angle = pathEndAngle(points);
        const tip = points[points.length - 1];
        const size = selected ? 8 : 6;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(tip.x - size * Math.cos(angle - 0.42), tip.y - size * Math.sin(angle - 0.42));
        ctx.lineTo(tip.x - size * Math.cos(angle + 0.42), tip.y - size * Math.sin(angle + 0.42));
        ctx.closePath();
        ctx.fill();
      }

      if (state.view.k > 0.38 && edge.kind !== 'wire') {
        const middle = pathMidpoint(points);
        const label = edge.delay ? `${edge.name}  z⁻¹` : elementIdentifier(edge);
        const labelRot = edge.layout && Number.isFinite(Number(edge.layout.rot))
          ? (Number(edge.layout.rot) * Math.PI) / 180
          : circuitMidAngle(points);
        const vertical = Math.abs(Math.sin(circuitGb ? labelRot : 0)) > 0.5;
        let labelX = middle.x;
        let labelY = middle.y - (circuitGb ? (vertical ? 0 : 24) : 16);
        ctx.textAlign = 'center';
        if (circuitGb && vertical) {
          labelX = middle.x + 20;
          labelY = middle.y - 2;
          ctx.textAlign = 'left';
        }
        ctx.font = `${ap.fontSize !== undefined ? ap.fontSize : 9}px "Cascadia Code", Consolas, monospace`;
        ctx.textBaseline = 'middle';
        const textWidth = ctx.measureText(label).width;
        const boxW = textWidth + 8;
        const labelRect = labelCollisionFree(
          ctx.textAlign === 'left' ? labelX + boxW / 2 : labelX,
          labelY,
          boxW,
          12,
          occupiedLabels,
        );
        occupiedLabels.push(labelRect);
        if (ctx.textAlign === 'left') {
          labelX = labelRect.x + 4;
        } else {
          labelX = labelRect.x + boxW / 2;
        }
        labelY = labelRect.y + 6;
        const boxLeft = labelRect.x;
        ctx.fillStyle = tokens().labelBg;
        ctx.fillRect(boxLeft, labelY - 6, boxW, 12);
        ctx.fillStyle = ap.textColor || (selected ? C('#a8541f') : tokens().labelText);
        ctx.fillText(label, labelX, labelY);
        if (selected && !circuitGb) {
          const value = edgeValueText(edge);
          if (value) {
            ctx.fillStyle = C('#1f5f5b');
            ctx.font = '9px "Cascadia Code", Consolas, monospace';
            ctx.fillText(value, middle.x, middle.y + 5);
          }
        }
      }

      if (state.ui?.drawingMode && state.ui?.drawingLabels && state.view.k > 0.42) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '8px "Cascadia Code", Consolas, monospace';
        const mid = pathMidpoint(points);
        if (edge.kind === 'wire' && mid) {
          const text = edge.name || 'W';
          const w = ctx.measureText(text).width + 6;
          ctx.fillStyle = tokens().labelBg2;
          ctx.fillRect(mid.x - w / 2, mid.y - 12, w, 11);
          ctx.fillStyle = C('#5b554b');
          ctx.fillText(text, mid.x, mid.y - 6.5);
        } else {
          ctx.fillStyle = C('#5b554b');
          ctx.fillText('1', points[0].x + 6, points[0].y - 6);
          ctx.fillText('2', points[points.length - 1].x - 6, points[points.length - 1].y - 6);
        }
      }

      if (selected) {
        const handles = [
          { p: points[0], end: 'source' },
          { p: points[points.length - 1], end: 'target' },
        ];
        for (const handle of handles) {
          const active = state.drag?.type === 'endpoint' && state.drag.id === edge.id && state.drag.end === handle.end;
          ctx.beginPath();
          ctx.arc(handle.p.x, handle.p.y, active ? 6 : 4.5, 0, Math.PI * 2);
          ctx.fillStyle = active ? C('#a8541f') : C('#faf8f2');
          ctx.fill();
          ctx.strokeStyle = C('#a8541f');
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        if (state.drag?.type === 'endpoint' && state.drag.id === edge.id) {
          const node = nodeById(state.drag.end === 'source' ? edge.source : edge.target);
          if (node && state.drag.anchor !== 'auto') {
            const snapPoint = anchorScreenPoint(node, (state.drag.anchor as string));
            ctx.beginPath();
            ctx.arc(snapPoint.x, snapPoint.y, 7, 0, Math.PI * 2);
            ctx.fillStyle = C('rgba(168, 84, 31, 0.18)');
            ctx.fill();
            ctx.strokeStyle = C('#a8541f');
            ctx.lineWidth = 1.4;
            ctx.stroke();
          }
        }
      }

      if (edge.route === 'manual' && (selected || state.drag?.type === 'waypoint' || state.hoverWaypoint?.edgeId === edge.id)) {
        for (const item of edge.waypoints || []) {
          const point = (worldToScreen as Function)(item.x, item.y);
          const index = (edge.waypoints || []).indexOf(item);
          const active = (state.drag?.type === 'waypoint' && state.drag.id === edge.id && state.drag.index === index)
            || (state.hoverWaypoint?.edgeId === edge.id && state.hoverWaypoint.index === index);
          ctx.beginPath();
          ctx.arc(point.x, point.y, active ? 6.5 : 5, 0, Math.PI * 2);
          ctx.fillStyle = active ? C('#a8541f') : C('#faf8f2');
          ctx.fill();
          ctx.strokeStyle = C('#a8541f');
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }

      const totalEdges = state.scene?.edges?.length || 0;
      if (state.sim?.running && edge.enabled && (totalEdges <= 220 || selected)) {
        const phase = (now / 1600 + (hashString(edge.id) % 997) / 997) % 1;
        for (let index = 0; index < 2; index += 1) {
          const t = (phase + index / 2) % 1;
          const point = pathPointAt(points, t);
          ctx.beginPath();
          ctx.arc(point.x, point.y, selected ? 2.0 : 1.35, 0, Math.PI * 2);
          ctx.fillStyle = edge.delay ? C('rgba(176,118,42,.8)') : C('rgba(168,84,31,.7)');
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }
