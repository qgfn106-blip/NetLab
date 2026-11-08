import { state } from "./state.js";
import { clamp, hashString } from "../app.utils.js";
import { NODE_RADIUS } from "./constants.js";
import { isPinNode, devicePins } from "./device_pins.js";
import { nodeById, selectedEdge, nodeDisplayData } from "./model.js";
const geometryActions = {};
function setGeometryActions(actions) {
  Object.assign(geometryActions, actions);
}
function distance(ax, ay, bx, by) {
  return geometryActions.distance(ax, ay, bx, by);
}
function circuitPinPath(edge, source, target) {
  return geometryActions.circuitPinPath(edge, source, target);
}
function wirePathPoints(edge, source, target) {
  return geometryActions.wirePathPoints(edge, source, target);
}
function worldToScreen(point) {
  return {
    x: state.view.x + point.x * state.view.k,
    y: state.view.y + point.y * state.view.k
  };
}
function screenToWorld(x, y) {
  return {
    x: (x - state.view.x) / state.view.k,
    y: (y - state.view.y) / state.view.k
  };
}
function nodeDiameter(node) {
  if (state.scene?.mode === "circuit" && state.ui?.symbol === "gb" && node && (node.kind === "node" || node.kind === "ground") && (state.ui?.nodeStyle || "circle") !== "box") {
    return 24;
  }
  const raw = Number(node?.size?.w);
  if (Number.isFinite(raw) && raw > 0) return clamp(raw, 24, 200);
  return NODE_RADIUS * 2;
}
function nodeRect(node) {
  const k = state.view.k;
  if (isPinNode(node)) {
    return deviceRect(node);
  }
  const radius = nodeDiameter(node) / 2 * k;
  const center = worldToScreen(node.position || { x: 0, y: 0 });
  return {
    x: center.x - radius,
    y: center.y - radius,
    w: radius * 2,
    h: radius * 2,
    r: radius,
    cx: center.x,
    cy: center.y,
    shape: "circle"
  };
}
function isModuleNode(node) {
  return state.scene?.mode === "circuit" && node?.kind === "module";
}
function devicePinGroups(node) {
  const pins = devicePins(node);
  const left = [];
  const right = [];
  const top = [];
  const bottom = [];
  if (pins.length === 2) {
    return { left: [pins[0]], right: [pins[1]], top: [], bottom: [] };
  }
  const half = Math.ceil(pins.length / 2);
  let passiveIndex = 0;
  pins.forEach((pin, index) => {
    if (pin.role === "input") left.push(pin);
    else if (pin.role === "output") right.push(pin);
    else if (pin.role === "power") {
      const name = String(pin.name || "");
      const positive = name.includes("+") || /VCC|VDD/i.test(name);
      (positive ? top : bottom).push(pin);
    } else if (pin.role === "bidirectional") (index < half ? left : right).push(pin);
    else (passiveIndex++ % 2 === 0 ? left : right).push(pin);
  });
  return { left, right, top, bottom };
}
function deviceWorldSize(node) {
  const groups = devicePinGroups(node);
  const maxSide = Math.max(
    groups.left.length,
    groups.right.length,
    groups.top.length,
    groups.bottom.length,
    1
  );
  const w = Number(node?.size?.w) || 120;
  const h = Math.max(Number(node?.size?.h) || 0, Math.max(56, maxSide * 24 + 16));
  return { w, h };
}
function deviceRect(node) {
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
    shape: "rect"
  };
}
function devicePinLocal(node, pin) {
  const { w, h } = deviceWorldSize(node);
  const groups = devicePinGroups(node);
  const leftIndex = groups.left.findIndex((item) => item.name === pin.name);
  if (leftIndex >= 0) {
    return { x: -w / 2, y: -h / 2 + (leftIndex + 1) * h / (groups.left.length + 1), side: "left" };
  }
  const rightIndex = groups.right.findIndex((item) => item.name === pin.name);
  if (rightIndex >= 0) {
    return { x: w / 2, y: -h / 2 + (rightIndex + 1) * h / (groups.right.length + 1), side: "right" };
  }
  const bottomIndex = groups.bottom.findIndex((item) => item.name === pin.name);
  if (bottomIndex >= 0) {
    return { x: -w / 2 + (bottomIndex + 1) * w / (groups.bottom.length + 1), y: h / 2, side: "bottom" };
  }
  const topIndex = groups.top.findIndex((item) => item.name === pin.name);
  if (topIndex >= 0) {
    return { x: -w / 2 + (topIndex + 1) * w / (groups.top.length + 1), y: -h / 2, side: "top" };
  }
  return { x: 0, y: 0, side: "center" };
}
function devicePinWired(node, pinName) {
  return (state.scene?.edges || []).some((edge) => {
    if (edge.kind !== "wire" || !edge.enabled) return false;
    if (edge.source === node.id && edge.source_pin === pinName) return true;
    return edge.target === node.id && edge.target_pin === pinName;
  });
}
function deviceSupplyLabel(node, pin) {
  const element = String(node?.params?.element || "");
  if (!["opamp", "comparator"].includes(element)) return pin.name;
  if (pin.name !== "V+" && pin.name !== "V-") return pin.name;
  if (devicePinWired(node, pin.name)) return pin.name;
  const value = pin.name === "V+" ? node.params.vcc : node.params.vee;
  if (!Number.isFinite(Number(value))) return pin.name;
  const text = `${Number(value).toPrecision(3)}V`;
  return `${pin.name} ${text}`;
}
function deviceMissingPins(node) {
  return devicePins(node).filter((pin) => pin.required && !devicePinWired(node, pin.name)).map((pin) => pin.name);
}
function deviceImplicitGroundPin(node) {
  const element = String(node?.params?.element || "");
  if (!["vsource", "isource"].includes(element)) return null;
  const missing = deviceMissingPins(node);
  return missing.length === 1 ? missing[0] : null;
}
function deviceInactive(node) {
  const implicit = deviceImplicitGroundPin(node);
  return deviceMissingPins(node).some((pin) => pin !== implicit);
}
function devicePinScreen(node, pinName) {
  const pin = devicePins(node).find((item) => item.name === pinName);
  if (!pin) return nodeCenterScreen(node);
  const rect = deviceRect(node);
  const local = devicePinLocal(node, pin);
  return { x: rect.cx + local.x * state.view.k, y: rect.cy + local.y * state.view.k };
}
function snapWorld(x, y, alt = false) {
  const grid = Number(state.ui?.grid) || 20;
  if (!state.ui?.snap || alt) return { x, y };
  return { x: Math.round(x / grid) * grid, y: Math.round(y / grid) * grid };
}
function portOut(node) {
  const rect = nodeRect(node);
  return { x: rect.cx + rect.r, y: rect.cy };
}
function portIn(node) {
  const rect = nodeRect(node);
  return { x: rect.cx - rect.r, y: rect.cy };
}
function curveFor(edge) {
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
      p3: { x: s.cx - s.r, y: s.cy - s.r * 0.22 }
    };
  }
  const dx = t.cx - s.cx;
  const dy = t.cy - s.cy;
  const length = Math.max(1, Math.hypot(dx, dy));
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
      y: start.y + dy * 0.33 + normal.y * bend
    },
    p2: {
      x: start.x + dx * 0.67 + normal.x * bend,
      y: start.y + dy * 0.67 + normal.y * bend
    },
    p3: end
  };
}
function nodeCenterScreen(node) {
  const rect = nodeRect(node);
  return { x: rect.cx, y: rect.cy };
}
function anchorPoint(node, side, toward) {
  const rect = nodeRect(node);
  if (side === "left") return { x: rect.cx - rect.r, y: rect.cy };
  if (side === "right") return { x: rect.cx + rect.r, y: rect.cy };
  if (side === "top") return { x: rect.cx, y: rect.cy - rect.r };
  if (side === "bottom") return { x: rect.cx, y: rect.cy + rect.r };
  const dx = toward.x - rect.cx;
  const dy = toward.y - rect.cy;
  const length = Math.max(1, Math.hypot(dx, dy));
  return { x: rect.cx + dx / length * rect.r, y: rect.cy + dy / length * rect.r };
}
function edgeEndpointHit(point) {
  const edge = selectedEdge();
  if (!edge) return null;
  const points = edgePathPoints(edge);
  if (!points || points.length < 2) return null;
  const ends = [
    { end: "source", p: points[0] },
    { end: "target", p: points[points.length - 1] }
  ];
  for (const item of ends) {
    if (distance(point.x, point.y, item.p.x, item.p.y) <= 11) {
      return { id: edge.id, end: item.end };
    }
  }
  return null;
}
function waypointHitAt(point, includeUnselected = false) {
  const candidates = [];
  const selected = selectedEdge();
  if (selected && selected.route === "manual") candidates.push(selected);
  if (includeUnselected) {
    for (const edge of state.scene?.edges || []) {
      if (edge.route !== "manual" || edge === selected) continue;
      candidates.push(edge);
    }
  }
  for (const edge of candidates) {
    const waypoints = edge.waypoints || [];
    for (let index = 0; index < waypoints.length; index += 1) {
      const wx = Number(waypoints[index].x) || 0;
      const wy = Number(waypoints[index].y) || 0;
      const screen = {
        x: state.view.x + wx * state.view.k,
        y: state.view.y + wy * state.view.k
      };
      if (Math.abs(point.x - screen.x) <= 11 && Math.abs(point.y - screen.y) <= 11) {
        return { edge, index, screen };
      }
    }
  }
  return null;
}
function anchorSideFor(node, screenPoint) {
  const rect = nodeRect(node);
  const radius = Math.max(rect.r, 1);
  const dx = (screenPoint.x - rect.cx) / radius;
  const dy = (screenPoint.y - rect.cy) / radius;
  if (Math.max(Math.abs(dx), Math.abs(dy)) > 1.9) return "auto";
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}
function anchorScreenPoint(node, side) {
  const rect = nodeRect(node);
  const r = rect.r;
  if (side === "left") return { x: rect.cx - r, y: rect.cy };
  if (side === "right") return { x: rect.cx + r, y: rect.cy };
  if (side === "top") return { x: rect.cx, y: rect.cy - r };
  if (side === "bottom") return { x: rect.cx, y: rect.cy + r };
  return { x: rect.cx, y: rect.cy };
}
function edgePathPoints(edge) {
  const source = nodeById(edge.source);
  const target = nodeById(edge.target);
  if (!source || !target) return null;
  const pinned = circuitPinPath(edge, source, target);
  if (pinned) return pinned;
  if (edge.kind === "wire" && state.scene?.mode === "circuit") {
    return wirePathPoints(edge, source, target);
  }
  const sc = nodeCenterScreen(source);
  const tc = nodeCenterScreen(target);
  if (edge.source === edge.target) {
    const r = nodeRect(source).r;
    const curve2 = {
      p0: { x: sc.x + r, y: sc.y - r * 0.22 },
      p1: { x: sc.x + r + 92 * state.view.k, y: sc.y - r - 88 * state.view.k },
      p2: { x: sc.x - r - 92 * state.view.k, y: sc.y - r - 88 * state.view.k },
      p3: { x: sc.x - r, y: sc.y - r * 0.22 }
    };
    const points2 = [];
    for (let index = 0; index <= 20; index += 1) points2.push(bezierPoint(curve2, index / 20));
    return points2;
  }
  const start = anchorPoint(source, edge.anchors?.source || "auto", tc);
  const end = anchorPoint(target, edge.anchors?.target || "auto", sc);
  let route = edge.route || "auto";
  if (route === "auto" && state.scene?.mode === "circuit" && state.ui?.circuitOrthogonal !== false) route = "orthogonal";
  if (route === "straight") return [start, end];
  if (route === "orthogonal") {
    if (Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)) {
      const midX = (start.x + end.x) / 2;
      return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
    }
    const midY = (start.y + end.y) / 2;
    return [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
  }
  if (route === "manual" && Array.isArray(edge.waypoints) && edge.waypoints.length) {
    const points2 = [start];
    for (const item of edge.waypoints) points2.push(worldToScreen(item));
    points2.push(end);
    return points2;
  }
  const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
  const c1 = horizontal ? { x: start.x + (end.x - start.x) * 0.4, y: start.y } : { x: start.x, y: start.y + (end.y - start.y) * 0.4 };
  const c2 = horizontal ? { x: end.x - (end.x - start.x) * 0.4, y: end.y } : { x: end.x, y: end.y - (end.y - start.y) * 0.4 };
  const curve = { p0: start, p1: c1, p2: c2, p3: end };
  const points = [];
  for (let index = 0; index <= 24; index += 1) points.push(bezierPoint(curve, index / 24));
  return points;
}
function pathSegments(points) {
  const segments = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1e-3) continue;
    segments.push({ a, b, length, start: total });
    total += length;
  }
  return { segments, total };
}
function pathPointAt(points, t) {
  const { segments, total } = pathSegments(points);
  if (!segments.length) return points[0];
  let target = clamp(t, 0, 1) * total;
  for (const segment of segments) {
    if (target <= segment.length) {
      const r = segment.length ? target / segment.length : 0;
      return {
        x: segment.a.x + (segment.b.x - segment.a.x) * r,
        y: segment.a.y + (segment.b.y - segment.a.y) * r
      };
    }
    target -= segment.length;
  }
  return segments[segments.length - 1].b;
}
function pathMidpoint(points) {
  return pathPointAt(points, 0.5);
}
function pathEndAngle(points) {
  const last = points[points.length - 1];
  const prev = points[points.length - 2] || last;
  return Math.atan2(last.y - prev.y, last.x - prev.x);
}
function distanceToPath(x, y, points) {
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
function vectorForNode(node) {
  const data = nodeDisplayData(node);
  let vx = data.vx;
  let vy = data.vy;
  let source = "velocity";
  if (typeof vx !== "number" || !Number.isFinite(vx) || typeof vy !== "number" || !Number.isFinite(vy)) {
    vx = data.x;
    vy = data.y;
    source = "position";
  }
  if (typeof vx !== "number" || !Number.isFinite(vx) || typeof vy !== "number" || !Number.isFinite(vy)) {
    vx = data.x1;
    vy = data.x2;
    source = "state";
  }
  if (typeof vx !== "number" || !Number.isFinite(vx) || typeof vy !== "number" || !Number.isFinite(vy)) {
    return null;
  }
  const magnitude = Math.hypot(vx, vy);
  if (!Number.isFinite(magnitude) || magnitude < 1e-9) return null;
  return { vx, vy, magnitude, source };
}
function bezierPoint(curve, t) {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * curve.p0.x + b * curve.p1.x + c * curve.p2.x + d * curve.p3.x,
    y: a * curve.p0.y + b * curve.p1.y + c * curve.p2.y + d * curve.p3.y
  };
}
export {
  anchorPoint,
  anchorScreenPoint,
  anchorSideFor,
  bezierPoint,
  curveFor,
  deviceImplicitGroundPin,
  deviceInactive,
  deviceMissingPins,
  devicePinGroups,
  devicePinLocal,
  devicePinScreen,
  devicePinWired,
  deviceRect,
  deviceSupplyLabel,
  deviceWorldSize,
  distanceToPath,
  edgeEndpointHit,
  edgePathPoints,
  isModuleNode,
  nodeCenterScreen,
  nodeDiameter,
  nodeRect,
  pathEndAngle,
  pathMidpoint,
  pathPointAt,
  pathSegments,
  portIn,
  portOut,
  screenToWorld,
  setGeometryActions,
  snapWorld,
  vectorForNode,
  waypointHitAt,
  worldToScreen
};
