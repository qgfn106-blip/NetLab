import { C, tokens } from "./colors.js";
import { GROUP_COLORS } from "./constants.js";
import { ctx } from "./dom.js";
import { state } from "./state.js";
import { fmt } from "../app.utils.js";
import { anchorPoint, devicePinScreen, edgePathPoints, nodeCenterScreen, worldToScreen } from "./geometry.js";
import { edgeDisplayData, getNodeSpec, nodeById, nodeDisplayData } from "./model.js";
import { elementLayoutCenter, elementPins, elementRot, symbolScalePx } from "./circuit_symbols.js";
import { isPinNode } from "./device_pins.js";
const KIND_SHORT = {
  manual: "MANUAL",
  sum: "SUM",
  gain: "GAIN",
  lag: "LAG",
  integrate: "INT",
  signal: "SIGNAL",
  expression: "EXPR",
  state_space: "STATE",
  clip: "CLIP",
  oscillator: "OSC",
  nonlinear_plant: "PLANT",
  sliding_mode: "SMC",
  vector_transform: "VECTOR",
  node: "NODE",
  ground: "GROUND"
};
const KIND_COLORS = {
  oscillator: "#a8541f",
  nonlinear_plant: "#1f5f5b",
  sliding_mode: "#7a4a7c",
  vector_transform: "#4a6f8a"
};
function nodeColor(node) {
  if (node.kind === "ground") return C("#6f695f");
  if (state.mode === "circuit") return C("#9a6a1c");
  if (KIND_COLORS[node.kind]) return C(KIND_COLORS[node.kind]);
  const spec = getNodeSpec(node.kind);
  return C(GROUP_COLORS[spec?.group] || "#a8541f");
}
function nodeKindLabel(node) {
  return KIND_SHORT[node.kind] || String(node.kind || "").toUpperCase().slice(0, 9);
}
function nodeValueText(node) {
  const data = nodeDisplayData(node);
  const fields = Object.keys(data).filter((key) => typeof data[key] === "number" && Number.isFinite(data[key]));
  if (!fields.length) return "\u2014";
  const preferred = ["voltage", "value", "y0", "output", "acc", "x1", "x", "y", "vx", "vy"].find((key) => fields.includes(key));
  const ordered = preferred ? [preferred, ...fields.filter((key) => key !== preferred)] : fields;
  return ordered.slice(0, 2).map((key) => `${key} ${fmt(data[key], 3)}`).join("  \xB7  ");
}
function edgeValueText(edge) {
  const data = edgeDisplayData(edge);
  const field = ["current", "voltage_difference", "power", "voltage"].find((key) => typeof data[key] === "number");
  return field ? `${field} ${fmt(data[field], 3)}` : "";
}
const __gridPattern = { key: "", pattern: null };
function gridPattern(step, dpr, color) {
  const key = `${step.toFixed(3)}|${dpr}|${color}`;
  if (__gridPattern.key === key) return __gridPattern.pattern;
  try {
    const tile = document.createElement("canvas");
    const size = Math.max(1, Math.round(step * dpr));
    tile.width = size;
    tile.height = size;
    const tctx = tile.getContext("2d");
    tctx.scale(dpr, dpr);
    tctx.fillStyle = color;
    tctx.fillRect(0, 0, 1, 1);
    __gridPattern.key = key;
    __gridPattern.pattern = ctx.createPattern(tile, "repeat");
  } catch (error) {
    __gridPattern.key = key;
    __gridPattern.pattern = null;
  }
  return __gridPattern.pattern;
}
function drawGrid(width, height) {
  if (state.ui?.showGrid === false || state.ui?.drawingMode) return;
  let step = (Number(state.ui?.grid) || 20) * state.view.k;
  while (step < 12) step *= 2;
  while (step > 84) step /= 2;
  const ox = (state.view.x % step + step) % step;
  const oy = (state.view.y % step + step) % step;
  const pattern = gridPattern(step, state.canvasSize?.dpr || 1, tokens().gridDot);
  if (pattern) {
    ctx.save();
    ctx.translate(Math.round(ox), Math.round(oy));
    ctx.fillStyle = pattern;
    ctx.fillRect(-1, -1, width + 2, height + 2);
    ctx.restore();
  } else {
    ctx.fillStyle = tokens().gridDot;
    for (let x = ox; x < width; x += step) {
      for (let y = oy; y < height; y += step) {
        ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
      }
    }
  }
  if (state.view.x > 0 && state.view.x < width) {
    ctx.strokeStyle = tokens().gridAxis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(state.view.x) + 0.5, 0);
    ctx.lineTo(Math.round(state.view.x) + 0.5, height);
    ctx.stroke();
  }
  if (state.view.y > 0 && state.view.y < height) {
    ctx.strokeStyle = tokens().gridAxis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(state.view.y) + 0.5);
    ctx.lineTo(width, Math.round(state.view.y) + 0.5);
    ctx.stroke();
  }
  const dragging = state.drag && ["node", "waypoint", "resize", "endpoint"].includes(state.drag.type);
  const pointer = state.pointer;
  if (dragging && state.ui?.snapMarkers !== false && state.ui?.snap && pointer && Number.isFinite(pointer.x) && Number.isFinite(pointer.y)) {
    const grid = Number(state.ui?.grid) || 20;
    const snapped = {
      x: Math.round(pointer.x / grid) * grid,
      y: Math.round(pointer.y / grid) * grid
    };
    const sp = worldToScreen(snapped.x, snapped.y);
    const size = 7;
    ctx.strokeStyle = C("rgba(168, 84, 31, 0.85)");
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(sp.x - size, sp.y);
    ctx.lineTo(sp.x + size, sp.y);
    ctx.moveTo(sp.x, sp.y - size);
    ctx.lineTo(sp.x, sp.y + size);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, size + 3, 0, Math.PI * 2);
    ctx.strokeStyle = C("rgba(168, 84, 31, 0.35)");
    ctx.stroke();
  }
}
function pinScreenPoint(edge, pin, points, scale = 1) {
  const center = elementLayoutCenter(edge, points);
  const angle = elementRot(edge);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const unit = state.view.k * scale;
  const wx = center.x + (pin.x * cos - pin.y * sin) * unit;
  const wy = center.y + (pin.x * sin + pin.y * cos) * unit;
  return { x: wx, y: wy };
}
function edgeAnchorTowards(node, otherNode) {
  const other = nodeCenterScreen(otherNode);
  return anchorPoint(node, "auto", other);
}
function circuitPinPath(edge, source, target) {
  if (state.scene?.mode !== "circuit" || state.ui?.symbol !== "gb") return null;
  if (edge.kind === "wire") return null;
  if (!edge.layout) return null;
  if (edge.route === "manual" && Array.isArray(edge.waypoints) && edge.waypoints.length) return null;
  const pins = elementPins(edge);
  if (pins.length !== 2) return null;
  const binds = new Set(pins.map((pin) => pin.bind));
  if (!binds.has("source") || !binds.has("target")) return null;
  const start = edgeAnchorTowards(source, target);
  const end = edgeAnchorTowards(target, source);
  const pin1 = pinScreenPoint(edge, pins[0], [start, end]);
  const pin2 = pinScreenPoint(edge, pins[1], [start, end]);
  return [start, pin1, pin2, end];
}
function wirePathPoints(edge, source, target) {
  const start = isPinNode(source) ? devicePinScreen(source, edge.source_pin) : anchorPoint(source, "auto", nodeCenterScreen(target));
  const end = isPinNode(target) ? devicePinScreen(target, edge.target_pin) : anchorPoint(target, "auto", nodeCenterScreen(source));
  let route = edge.route || "auto";
  if (route === "auto" && state.ui?.circuitOrthogonal !== false) route = "orthogonal";
  if (route === "manual" && Array.isArray(edge.waypoints) && edge.waypoints.length) {
    return [start, ...edge.waypoints.map((item) => worldToScreen(item)), end];
  }
  if (route === "straight") return [start, end];
  if (Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)) {
    const midX = (start.x + end.x) / 2;
    return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
  }
  const midY = (start.y + end.y) / 2;
  return [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
}
function drawMultiPinWires(edge, color) {
  if (state.scene?.mode !== "circuit" || state.ui?.symbol !== "gb" || !edge.layout) return;
  const pins = elementPins(edge);
  const multi = pins.length > 2;
  const source = nodeById(edge.source);
  const target = nodeById(edge.target);
  if (!source || !target) return;
  const points = [nodeCenterScreen(source), nodeCenterScreen(target)];
  const center = elementLayoutCenter(edge, points);
  for (const pin of pins) {
    if (!pin.bind) continue;
    if (!multi && (pin.bind === "source" || pin.bind === "target")) continue;
    const nodeId = pin.bind === "source" ? edge.source : pin.bind === "target" ? edge.target : edge.params?.[pin.bind];
    const node = nodeId ? nodeById(nodeId) : null;
    if (!node) continue;
    const from = pinScreenPoint(edge, pin, points, symbolScalePx());
    const to = anchorPoint(node, "auto", center);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(to.x, to.y, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = C("#f7f4ec");
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
function elementIdentifier(edge) {
  const name = String(edge.name || "");
  const kind = String(edge.kind || "");
  if (name) return name;
  const prefix = {
    resistor: "R",
    capacitor: "C",
    inductor: "L",
    diode: "D",
    led: "LED",
    zener: "ZD",
    vsource: "V",
    isource: "I",
    switch: "S",
    opamp: "U",
    comparator: "U",
    dflipflop: "U",
    vcvs: "E",
    vccs: "G",
    npn: "Q",
    pnp: "Q",
    nmos: "Q",
    pmos: "Q",
    transformer: "T",
    coupling_inductor: "L",
    adc4: "U"
  }[kind] || kind.slice(0, 2).toUpperCase();
  return `${prefix}?`;
}
function segmentIntersection(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denom;
  if (t <= 0.02 || t >= 0.98 || u <= 0.02 || u >= 0.98) return null;
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}
function circuitCrossingMap(edges) {
  const map = /* @__PURE__ */ new Map();
  if (state.scene?.mode !== "circuit" || state.ui?.symbol !== "gb" || edges.length > 160) return map;
  const paths = edges.map((edge) => ({ id: edge.id, points: edgePathPoints(edge) || [] }));
  for (let i = 0; i < paths.length; i += 1) {
    for (let j = i + 1; j < paths.length; j += 1) {
      const first = paths[i];
      const second = paths[j];
      if (!first.points.length || !second.points.length) continue;
      const points = [];
      for (let a = 1; a < first.points.length; a += 1) {
        for (let b = 1; b < second.points.length; b += 1) {
          const hit = segmentIntersection(first.points[a - 1], first.points[a], second.points[b - 1], second.points[b]);
          if (hit) points.push(hit);
        }
      }
      if (points.length) map.set(second.id, [...map.get(second.id) || [], ...points]);
    }
  }
  return map;
}
function drawCrossingHops(points, color) {
  for (const point of points) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3.6, 0, Math.PI * 2);
    ctx.fillStyle = C("#f7f4ec");
    ctx.fill();
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4.2, Math.PI * 1.05, Math.PI * 1.95);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.restore();
  }
}
export {
  KIND_COLORS,
  KIND_SHORT,
  circuitCrossingMap,
  circuitPinPath,
  drawCrossingHops,
  drawGrid,
  drawMultiPinWires,
  edgeAnchorTowards,
  edgeValueText,
  elementIdentifier,
  gridPattern,
  nodeColor,
  nodeKindLabel,
  nodeValueText,
  pinScreenPoint,
  segmentIntersection,
  wirePathPoints
};
