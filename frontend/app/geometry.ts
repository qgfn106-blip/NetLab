// S5-22 画布几何与引脚定位（从 app.ts 原样迁出）
import type { NodeItem, EdgeItem, PortSpec, Pt, BezierRec } from './types.js';
import { state } from './state.js';
import { clamp, hashString } from '../app.utils.js';
import { NODE_RADIUS } from './constants.js';
import { isPinNode, devicePins } from './device_pins.js';
import { nodeById, selectedEdge, nodeDisplayData } from './model.js';

type GeometryActions = {
  distance: (ax: number, ay: number, bx: number, by: number) => number;
  circuitPinPath: (edge: EdgeItem, source: NodeItem, target: NodeItem) => Array<{ x: number; y: number }> | null;
  wirePathPoints: (edge: EdgeItem, source: Pt, target: Pt) => Array<{ x: number; y: number }>;
};
const geometryActions = {} as GeometryActions;
export function setGeometryActions(actions: GeometryActions): void {
  Object.assign(geometryActions, actions);
}
function distance(ax: number, ay: number, bx: number, by: number) { return geometryActions.distance(ax, ay, bx, by); }
function circuitPinPath(edge: EdgeItem, source: NodeItem, target: NodeItem) { return geometryActions.circuitPinPath(edge, source, target); }
function wirePathPoints(edge: EdgeItem, source: Pt, target: Pt) { return geometryActions.wirePathPoints(edge, source, target); }

export function worldToScreen(point: { x: number; y: number }): { x: number; y: number } {
    return {
      x: state.view.x + point.x * state.view.k,
      y: state.view.y + point.y * state.view.k,
    };
  }

export function screenToWorld(x: number, y: number): { x: number; y: number } {
    return {
      x: (x - state.view.x) / state.view.k,
      y: (y - state.view.y) / state.view.k,
    };
  }

export function nodeDiameter(node: NodeItem) {
    if (
      state.scene?.mode === 'circuit'
      && state.ui?.symbol === 'gb'
      && node
      && (node.kind === 'node' || node.kind === 'ground')
      && (state.ui?.nodeStyle || 'circle') !== 'box'
    ) {
      return 24;
    }
    const raw = Number(node?.size?.w);
    if (Number.isFinite(raw) && raw > 0) return clamp(raw, 24, 200);
    return NODE_RADIUS * 2;
  }

export function nodeRect(node: NodeItem) {
    const k = state.view.k;
    if (isPinNode(node)) {
      return deviceRect(node);
    }
    const radius = (nodeDiameter(node) / 2) * k;
    const center = worldToScreen(node.position || { x: 0, y: 0 });
    return {
      x: center.x - radius,
      y: center.y - radius,
      w: radius * 2,
      h: radius * 2,
      r: radius,
      cx: center.x,
      cy: center.y,
      shape: 'circle',
    };
  }

  // ---- R20：器件节点（组件框 + 引脚） --------------------------------------
export function isModuleNode(node: NodeItem) {
    return state.scene?.mode === 'circuit' && node?.kind === 'module';
  }

export function devicePinGroups(node: NodeItem) {
    const pins = devicePins(node);
    const left: PortSpec[] = [];
    const right: PortSpec[] = [];
    const top: PortSpec[] = [];
    const bottom: PortSpec[] = [];
    if (pins.length === 2) {
      return { left: [pins[0]], right: [pins[1]], top: [], bottom: [] };
    }
    const half = Math.ceil(pins.length / 2);
    let passiveIndex = 0;
    pins.forEach((pin: PortSpec, index: number) => {
      if (pin.role === 'input') left.push(pin);
      else if (pin.role === 'output') right.push(pin);
      else if (pin.role === 'power') {
        // R21：正电源（V+/VCC/VDD）在上，负电源在下，贴近原理图画法。
        const name = String(pin.name || '');
        const positive = name.includes('+') || /VCC|VDD/i.test(name);
        (positive ? top : bottom).push(pin);
      } else if (pin.role === 'bidirectional') (index < half ? left : right).push(pin);
      else (passiveIndex++ % 2 === 0 ? left : right).push(pin);
    });
    return { left, right, top, bottom };
  }

export function deviceWorldSize(node: NodeItem) {
    const groups = devicePinGroups(node);
    const maxSide = Math.max(
      groups.left.length, groups.right.length,
      groups.top.length, groups.bottom.length, 1,
    );
    const w = Number(node?.size?.w) || 120;
    const h = Math.max(Number(node?.size?.h) || 0, Math.max(56, maxSide * 24 + 16));
    return { w, h };
  }

export function deviceRect(node: NodeItem) {
    const { w: worldW, h: worldH } = deviceWorldSize(node);
    const k = state.view.k;
    const center = worldToScreen(node.position || { x: 0, y: 0 });
    const w = worldW * k;
    const h = worldH * k;
    return {
      x: center.x - w / 2,
      y: center.y - h / 2,
      w,
      h,
      r: Math.min(w, h) / 2,
      cx: center.x,
      cy: center.y,
      shape: 'rect',
    };
  }

export function devicePinLocal(node: NodeItem, pin: PortSpec) {
    const { w, h } = deviceWorldSize(node);
    const groups = devicePinGroups(node);
    const leftIndex = groups.left.findIndex((item) => item.name === pin.name);
    if (leftIndex >= 0) {
      return { x: -w / 2, y: -h / 2 + (leftIndex + 1) * h / (groups.left.length + 1), side: 'left' };
    }
    const rightIndex = groups.right.findIndex((item) => item.name === pin.name);
    if (rightIndex >= 0) {
      return { x: w / 2, y: -h / 2 + (rightIndex + 1) * h / (groups.right.length + 1), side: 'right' };
    }
    const bottomIndex = groups.bottom.findIndex((item) => item.name === pin.name);
    if (bottomIndex >= 0) {
      return { x: -w / 2 + (bottomIndex + 1) * w / (groups.bottom.length + 1), y: h / 2, side: 'bottom' };
    }
    const topIndex = groups.top.findIndex((item) => item.name === pin.name);
    if (topIndex >= 0) {
      return { x: -w / 2 + (topIndex + 1) * w / (groups.top.length + 1), y: -h / 2, side: 'top' };
    }
    return { x: 0, y: 0, side: 'center' };
  }

export function devicePinWired(node: NodeItem, pinName: string) {
    return (state.scene?.edges || []).some((edge) => {
      if (edge.kind !== 'wire' || !edge.enabled) return false;
      if (edge.source === node.id && edge.source_pin === pinName) return true;
      return edge.target === node.id && edge.target_pin === pinName;
    });
  }

export function deviceSupplyLabel(node: NodeItem, pin: PortSpec) {
    // R21：V± 未接线时显示参数默认值，接线后只显示引脚名，避免“值/来源”混淆。
    const element = String(node?.params?.element || '');
    if (!['opamp', 'comparator'].includes(element)) return pin.name;
    if (pin.name !== 'V+' && pin.name !== 'V-') return pin.name;
    if (devicePinWired(node, pin.name)) return pin.name;
    const value = pin.name === 'V+' ? node.params!.vcc : node.params!.vee;
    if (!Number.isFinite(Number(value))) return pin.name;
    const text = `${Number(value).toPrecision(3)}V`;
    return `${pin.name} ${text}`;
  }

export function deviceMissingPins(node: NodeItem) {
    return devicePins(node)
      .filter((pin: PortSpec) => pin.required && !devicePinWired(node, pin.name))
      .map((pin: PortSpec) => pin.name);
  }

export function deviceImplicitGroundPin(node: NodeItem) {
    // R21/D43：两端电源只接一端时，空脚自动对地并画出接地标记。
    const element = String(node?.params?.element || '');
    if (!['vsource', 'isource'].includes(element)) return null;
    const missing = deviceMissingPins(node);
    return missing.length === 1 ? missing[0] : null;
  }

export function deviceInactive(node: NodeItem) {
    // 运行中“未参与求解”器件：缺必接引脚，但电源的单端自动接地不算。
    const implicit = deviceImplicitGroundPin(node);
    return deviceMissingPins(node).some((pin: string) => pin !== implicit);
  }

export function devicePinScreen(node: NodeItem, pinName: string) {
    const pin = devicePins(node).find((item: PortSpec) => item.name === pinName);
    if (!pin) return nodeCenterScreen(node);
    const rect = deviceRect(node);
    const local = devicePinLocal(node, pin);
    return { x: rect.cx + local.x * state.view.k, y: rect.cy + local.y * state.view.k };
  }

export function snapWorld(x: number, y: number, alt = false) {
    const grid = Number(state.ui?.grid) || 20;
    if (!state.ui?.snap || alt) return { x, y };
    return { x: Math.round(x / grid) * grid, y: Math.round(y / grid) * grid };
  }

export function portOut(node: NodeItem) {
    const rect = nodeRect(node);
    return { x: rect.cx + rect.r, y: rect.cy };
  }

export function portIn(node: NodeItem) {
    const rect = nodeRect(node);
    return { x: rect.cx - rect.r, y: rect.cy };
  }

export function curveFor(edge: EdgeItem) {
    const source = nodeById(edge.source);
    const target = nodeById(edge.target);
    if (!source || !target) return null;
    const s = nodeRect(source);
    const t = nodeRect(target);
    if (edge.source === edge.target) {
      return {
        p0: { x: s.cx + s.r, y: s.cy - s.r * 0.22 },
        p1: { x: s.cx + s.r + 92, y: s.cy - s.r - 88 },
        p2: { x: s.cx - s.r - 92, y: s.cy - s.r - 88 },
        p3: { x: s.cx - s.r, y: s.cy - s.r * 0.22 },
      };
    }
    const dx = t.cx - s.cx;
    const dy = t.cy - s.cy;
    const length = Math.max(1.0, Math.hypot(dx, dy));
    const ux = dx / length;
    const uy = dy / length;
    const margin = clamp(5 * state.view.k, 3, 8);
    const start = { x: s.cx + ux * (s.r + margin), y: s.cy + uy * (s.r + margin) };
    const end = { x: t.cx - ux * (t.r + margin), y: t.cy - uy * (t.r + margin) };
    const normal = { x: -uy, y: ux };
    const direction = hashString(edge.id) % 2 === 0 ? 1 : -1;
    const bend = direction * Math.min(46, 10 + length * 0.07);
    return {
      p0: start,
      p1: {
        x: start.x + dx * 0.33 + normal.x * bend,
        y: start.y + dy * 0.33 + normal.y * bend,
      },
      p2: {
        x: start.x + dx * 0.67 + normal.x * bend,
        y: start.y + dy * 0.67 + normal.y * bend,
      },
      p3: end,
    };
  }

export function nodeCenterScreen(node: NodeItem) {
    const rect = nodeRect(node);
    return { x: rect.cx, y: rect.cy };
  }

export function anchorPoint(node: NodeItem, side: string, toward: Pt) {
    const rect = nodeRect(node);
    if (side === 'left') return { x: rect.cx - rect.r, y: rect.cy };
    if (side === 'right') return { x: rect.cx + rect.r, y: rect.cy };
    if (side === 'top') return { x: rect.cx, y: rect.cy - rect.r };
    if (side === 'bottom') return { x: rect.cx, y: rect.cy + rect.r };
    const dx = toward.x - rect.cx;
    const dy = toward.y - rect.cy;
    const length = Math.max(1, Math.hypot(dx, dy));
    return { x: rect.cx + (dx / length) * rect.r, y: rect.cy + (dy / length) * rect.r };
  }

export function edgeEndpointHit(point: { x: number; y: number }) {
    const edge = selectedEdge();
    if (!edge) return null;
    const points = edgePathPoints(edge);
    if (!points || points.length < 2) return null;
    const ends = [
      { end: 'source', p: points[0] },
      { end: 'target', p: points[points.length - 1] },
    ];
    for (const item of ends) {
      if (distance(point.x, point.y, item.p.x, item.p.y) <= 11) {
        return { id: edge.id, end: item.end };
      }
    }
    return null;
  }

export function waypointHitAt(point: { x: number; y: number }, includeUnselected = false) {
    const candidates = [];
    const selected = selectedEdge();
    if (selected && selected.route === 'manual') candidates.push(selected);
    if (includeUnselected) {
      for (const edge of state.scene?.edges || []) {
        if (edge.route !== 'manual' || edge === selected) continue;
        candidates.push(edge);
      }
    }
    for (const edge of candidates) {
      const waypoints = edge.waypoints || [];
      for (let index = 0; index < waypoints.length; index += 1) {
        const wx = Number(waypoints!![index].x) || 0;
        const wy = Number(waypoints!![index].y) || 0;
        const screen = {
          x: state.view.x + wx * state.view.k,
          y: state.view.y + wy * state.view.k,
        };
        if (Math.abs(point.x - screen.x) <= 11 && Math.abs(point.y - screen.y) <= 11) {
          return { edge, index, screen };
        }
      }
    }
    return null;
  }

export function anchorSideFor(node: NodeItem, screenPoint: Pt) {
    const rect = nodeRect(node);
    const radius = Math.max(rect.r, 1);
    const dx = (screenPoint.x - rect.cx) / radius;
    const dy = (screenPoint.y - rect.cy) / radius;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 1.9) return 'auto';
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
    return dy >= 0 ? 'bottom' : 'top';
  }

export function anchorScreenPoint(node: NodeItem, side: string) {
    const rect = nodeRect(node);
    const r = rect.r;
    if (side === 'left') return { x: rect.cx - r, y: rect.cy };
    if (side === 'right') return { x: rect.cx + r, y: rect.cy };
    if (side === 'top') return { x: rect.cx, y: rect.cy - r };
    if (side === 'bottom') return { x: rect.cx, y: rect.cy + r };
    return { x: rect.cx, y: rect.cy };
  }

export function edgePathPoints(edge: EdgeItem) {
    const source = nodeById(edge.source);
    const target = nodeById(edge.target);
    if (!source || !target) return null;
    const pinned = circuitPinPath(edge, source, target);
    if (pinned) return pinned;
    if (edge.kind === 'wire' && state.scene?.mode === 'circuit') {
      return wirePathPoints(edge, source, target);
    }

    const sc = nodeCenterScreen(source);
    const tc = nodeCenterScreen(target);
    if (edge.source === edge.target) {
      const r = nodeRect(source).r;
      const curve = {
        p0: { x: sc.x + r, y: sc.y - r * 0.22 },
        p1: { x: sc.x + r + 92 * state.view.k, y: sc.y - r - 88 * state.view.k },
        p2: { x: sc.x - r - 92 * state.view.k, y: sc.y - r - 88 * state.view.k },
        p3: { x: sc.x - r, y: sc.y - r * 0.22 },
      };
      const points = [];
      for (let index = 0; index <= 20; index += 1) points.push(bezierPoint(curve, index / 20));
      return points;
    }
    const start = anchorPoint(source, edge.anchors?.source || 'auto', tc);
    const end = anchorPoint(target, edge.anchors?.target || 'auto', sc);
    let route = edge.route || 'auto';
    // 电路图默认按正交布线，贴近常规电路模拟软件的图纸风格。
    if (route === 'auto' && state.scene?.mode === 'circuit' && state.ui?.circuitOrthogonal !== false) route = 'orthogonal';
    if (route === 'straight') return [start, end];
    if (route === 'orthogonal') {
      if (Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)) {
        const midX = (start.x + end.x) / 2;
        return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
      }
      const midY = (start.y + end.y) / 2;
      return [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
    }
    if (route === 'manual' && Array.isArray(edge.waypoints) && edge.waypoints.length) {
      const points = [start];
      for (const item of edge.waypoints) points.push(worldToScreen((item as { x: number; y: number; })));
      points.push(end);
      return points;
    }
    // auto：沿锚点方向的平滑三次曲线
    const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
    const c1 = horizontal
      ? { x: start.x + (end.x - start.x) * 0.4, y: start.y }
      : { x: start.x, y: start.y + (end.y - start.y) * 0.4 };
    const c2 = horizontal
      ? { x: end.x - (end.x - start.x) * 0.4, y: end.y }
      : { x: end.x, y: end.y - (end.y - start.y) * 0.4 };
    const curve = { p0: start, p1: c1, p2: c2, p3: end };
    const points = [];
    for (let index = 0; index <= 24; index += 1) points.push(bezierPoint(curve, index / 24));
    return points;
  }

export function pathSegments(points: Array<{ x: number; y: number }>) {
    const segments = [];
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1];
      const b = points[index];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < 0.001) continue;
      segments.push({ a, b, length, start: total });
      total += length;
    }
    return { segments, total };
  }

export function pathPointAt(points: Array<{ x: number; y: number }>, t: number) {
    const { segments, total } = pathSegments(points);
    if (!segments.length) return points[0];
    let target = clamp(t, 0, 1) * total;
    for (const segment of segments) {
      if (target <= segment.length) {
        const r = segment.length ? target / segment.length : 0;
        return {
          x: segment.a.x + (segment.b.x - segment.a.x) * r,
          y: segment.a.y + (segment.b.y - segment.a.y) * r,
        };
      }
      target -= segment.length;
    }
    return segments[segments.length - 1].b;
  }

export function pathMidpoint(points: Array<{ x: number; y: number }>) {
    return pathPointAt(points, 0.5);
  }

export function pathEndAngle(points: Array<{ x: number; y: number }>) {
    const last = points[points.length - 1];
    const prev = points[points.length - 2] || last;
    return Math.atan2(last.y - prev.y, last.x - prev.x);
  }

export function distanceToPath(x: number, y: number, points: Array<{ x: number; y: number }>) {
    let best = Infinity;
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1];
      const b = points[index];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSq = dx * dx + dy * dy;
      let r = 0;
      if (lengthSq > 1e-6) r = clamp(((x - a.x) * dx + (y - a.y) * dy) / lengthSq, 0, 1);
      const px = a.x + dx * r;
      const py = a.y + dy * r;
      best = Math.min(best, Math.hypot(x - px, y - py));
    }
    return best;
  }

export function vectorForNode(node: NodeItem) {
    const data = nodeDisplayData(node);
    let vx = data.vx;
    let vy = data.vy;
    let source = 'velocity';
    if (typeof vx !== 'number' || !Number.isFinite(vx) || typeof vy !== 'number' || !Number.isFinite(vy)) {
      vx = data.x;
      vy = data.y;
      source = 'position';
    }
    if (typeof vx !== 'number' || !Number.isFinite(vx) || typeof vy !== 'number' || !Number.isFinite(vy)) {
      vx = data.x1;
      vy = data.x2;
      source = 'state';
    }
    if (typeof vx !== 'number' || !Number.isFinite(vx) || typeof vy !== 'number' || !Number.isFinite(vy)) {
      return null;
    }
    const magnitude = Math.hypot(vx, vy);
    if (!Number.isFinite(magnitude) || magnitude < 1.0e-9) return null;
    return { vx, vy, magnitude, source };
  }

export function bezierPoint(curve: BezierRec, t: number) {
    const mt = 1 - t;
    const a = mt * mt * mt;
    const b = 3 * mt * mt * t;
    const c = 3 * mt * t * t;
    const d = t * t * t;
    return {
      x: a * curve.p0.x + b * curve.p1.x + c * curve.p2.x + d * curve.p3.x,
      y: a * curve.p0.y + b * curve.p1.y + c * curve.p2.y + d * curve.p3.y,
    };
  }
