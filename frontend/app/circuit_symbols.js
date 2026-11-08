import { C } from "./colors.js";
import { ctx } from "./dom.js";
import { nodeCenterScreen, pathMidpoint, worldToScreen } from "./geometry.js";
import { state } from "./state.js";
function circuitMidAngle(points) {
  const segments = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const dx = points[index].x - points[index - 1].x;
    const dy = points[index].y - points[index - 1].y;
    const length = Math.hypot(dx, dy);
    if (length <= 0.5) continue;
    segments.push({ start: total, length, angle: Math.atan2(dy, dx) });
    total += length;
  }
  if (!segments.length) return 0;
  const at = total / 2;
  let chosen = segments[segments.length - 1].angle;
  for (const segment of segments) {
    if (at >= segment.start && at <= segment.start + segment.length) {
      chosen = segment.angle;
      break;
    }
  }
  const quarter = Math.PI / 2;
  return Math.round(chosen / quarter) * quarter;
}
function drawCircuitGlyph(edge, points, color) {
  if (state.view.k < 0.35) return;
  const mid = pathMidpoint(points);
  if (!mid) return;
  const layout = edge.layout || null;
  const center = layout && Number.isFinite(layout.x) && Number.isFinite(layout.y) ? worldToScreen({ x: layout.x, y: layout.y }) : mid;
  const angle = layout && Number.isFinite(Number(layout.rot)) ? Number(layout.rot) * Math.PI / 180 : circuitMidAngle(points);
  const scale = symbolScalePx();
  const theme = C(state.ui?.glyphColor || "#1f5f5b");
  const glyphColor = color === "#a8541f" ? C("#a8541f") : theme;
  const ctx2 = ctx;
  ctx2.save();
  ctx2.translate(center.x, center.y);
  ctx2.rotate(angle);
  ctx2.scale(scale, scale);
  ctx2.strokeStyle = glyphColor;
  ctx2.fillStyle = glyphColor;
  ctx2.lineWidth = 1.25;
  ctx2.lineCap = "round";
  ctx2.lineJoin = "round";
  const S = 9;
  const line = (x1, y1, x2, y2) => {
    ctx2.beginPath();
    ctx2.moveTo(x1, y1);
    ctx2.lineTo(x2, y2);
    ctx2.stroke();
  };
  const poly = (coords) => {
    ctx2.beginPath();
    ctx2.moveTo(coords[0], coords[1]);
    for (let i = 2; i < coords.length; i += 2) ctx2.lineTo(coords[i], coords[i + 1]);
    ctx2.stroke();
  };
  const kind = String(edge.kind || "");
  if (kind === "wire") return;
  if (kind === "resistor") {
    poly([-S, 0, -6, 0, -4.5, -4, -1.5, 4, 1.5, -4, 4.5, 4, 6, 0, S, 0]);
  } else if (kind === "capacitor") {
    line(-S, 0, -2.5, 0);
    line(2.5, 0, S, 0);
    line(-2.5, -6, -2.5, 6);
    line(2.5, -6, 2.5, 6);
  } else if (kind === "inductor") {
    ctx2.beginPath();
    ctx2.arc(-5, 0, 2.8, Math.PI, 0, false);
    ctx2.arc(0, 0, 2.8, Math.PI, 0, false);
    ctx2.arc(5, 0, 2.8, Math.PI, 0, false);
    ctx2.stroke();
    line(-S, 0, -7.8, 0);
    line(7.8, 0, S, 0);
  } else if (kind === "vsource" || kind === "isource") {
    ctx2.beginPath();
    ctx2.arc(0, 0, 6.5, 0, Math.PI * 2);
    ctx2.stroke();
    line(-S, 0, -6.5, 0);
    line(6.5, 0, S, 0);
    if (kind === "vsource") {
      line(-3, -2.5, 1, -2.5);
      line(-1, -4.5, -1, -0.5);
      line(-3, 2.5, 1, 2.5);
    } else {
      line(-1, -2.5, 1, -2.5);
      line(0, -4, 0, -1);
      line(0, -1, -1.2, 0.4);
      line(0, -1, 1.2, 0.4);
    }
  } else if (kind === "diode" || kind === "led" || kind === "zener") {
    line(-S, 0, -4, 0);
    ctx2.beginPath();
    ctx2.moveTo(-4, -5);
    ctx2.lineTo(-4, 5);
    ctx2.lineTo(4, 0);
    ctx2.closePath();
    ctx2.fill();
    line(4, -5.5, 4, 5.5);
    line(4, 0, S, 0);
    if (kind === "zener") {
      line(4, -5.5, 1.5, -5.5);
      line(4, 5.5, 6.5, 5.5);
    }
    if (kind === "led") {
      line(1, -7, 4, -10);
      line(1.5, -10, 4, -10);
      line(4, -7, 7, -10);
      line(4.5, -10, 7, -10);
    }
  } else if (kind === "switch") {
    line(-S, 0, -3, 0);
    line(-3, 0, 5, -5);
    line(5, 0, S, 0);
    ctx2.beginPath();
    ctx2.arc(-3, 0, 1.1, 0, Math.PI * 2);
    ctx2.fill();
  } else if (kind === "vcvs" || kind === "vccs") {
    ctx2.beginPath();
    ctx2.moveTo(0, -6);
    ctx2.lineTo(8, 0);
    ctx2.lineTo(0, 6);
    ctx2.lineTo(-8, 0);
    ctx2.closePath();
    ctx2.stroke();
    line(-S, 0, -8, 0);
    line(8, 0, S, 0);
    if (kind === "vcvs") {
      line(-3.5, -1.5, -0.5, -1.5);
      line(-2, -3, -2, 0);
      line(-3.5, 2, -0.5, 2);
    } else {
      line(-3, 1, 2, 1);
      line(0.6, -0.2, 2, 1);
      line(0.6, 2.2, 2, 1);
    }
  } else if (kind === "opamp" || kind === "comparator") {
    ctx2.beginPath();
    ctx2.moveTo(-6, -7);
    ctx2.lineTo(-6, 7);
    ctx2.lineTo(8, 0);
    ctx2.closePath();
    ctx2.stroke();
    line(-S, 0, -6, 0);
    line(8, 0, S, 0);
    ctx2.font = '7px "Cascadia Code", Consolas, monospace';
    ctx2.textAlign = "center";
    ctx2.textBaseline = "middle";
    ctx2.fillText("+", -3.5, -2.6);
    ctx2.fillText("\u2212", -3.5, 2.6);
    if (kind === "comparator") {
      line(-4, 5.2, 2, 5.2);
    }
  } else if (kind === "npn" || kind === "pnp") {
    ctx2.beginPath();
    ctx2.arc(0, 0, 6.5, 0, Math.PI * 2);
    ctx2.stroke();
    line(-S, 0, -5, 0);
    line(-5, -5, -5, 5);
    line(-5, -2.5, 4, -6);
    line(-5, 2.5, 4, 6);
    line(4, 6, 1, 4.6);
    line(4, 6, 3, 3);
  } else if (kind === "nmos" || kind === "pmos") {
    line(-S, 0, -5, 0);
    line(-5, -5, -5, 5);
    line(-2.5, -5, -2.5, 5);
    line(-2.5, -4, 5, -4);
    line(5, -4, 5, -6);
    line(-2.5, 4, 5, 4);
    line(5, 4, 5, 6);
  } else if (kind === "thyristor") {
    line(-S, 0, -4, 0);
    ctx2.beginPath();
    ctx2.moveTo(-4, -5);
    ctx2.lineTo(-4, 5);
    ctx2.lineTo(4, 0);
    ctx2.closePath();
    ctx2.fill();
    line(4, -5.5, 4, 5.5);
    line(4, 0, S, 0);
    line(-4, -1.5, -8, 4.5);
    line(-8, 4.5, -6.5, 4.5);
  } else if (kind === "igbt") {
    line(-S, 0, -6, 0);
    line(-4, -5, -4, 5);
    line(-2.5, -5, -2.5, 5);
    line(-2.5, -4, 6, -4);
    line(6, -4, 6, -7);
    line(-2.5, 4, 6, 4);
    line(6, 4, 6, 7);
    line(-2.5, 0, 2, 0);
    line(2, 0, 2, 3);
  } else if (kind === "jfet") {
    line(-S, 0, -5, 0);
    line(-4, -5, -4, 5);
    line(-2, -5, -2, 5);
    line(-2, -4, 6, -4);
    line(6, -4, 6, -7);
    line(-2, 4, 6, 4);
    line(6, 4, 6, 7);
    line(-4, 0, 2, 0);
    line(2, 0, 0.5, -1.5);
    line(2, 0, 0.5, 1.5);
  } else if (kind === "relay") {
    ctx2.strokeRect(-8, -5.5, 8, 11);
    line(-S, 0, -8, 0);
    line(0, -5.5, 0, -9);
    line(0, 5.5, 0, 9);
    line(0, 5.5, 7, 5.5);
    line(7, 5.5, 7, 1);
    ctx2.beginPath();
    ctx2.arc(7, 0, 1.2, 0, Math.PI * 2);
    ctx2.fill();
    line(7, -1.2, S, -1.2);
  } else if (kind === "motor") {
    ctx2.beginPath();
    ctx2.arc(0, 0, 7, 0, Math.PI * 2);
    ctx2.stroke();
    line(-S, 0, -7, 0);
    line(7, 0, S, 0);
    ctx2.font = '8px "Cascadia Code", Consolas, monospace';
    ctx2.textAlign = "center";
    ctx2.textBaseline = "middle";
    ctx2.fillText("M", 0, 0.5);
  } else if (kind === "dflipflop") {
    ctx2.strokeRect(-7, -7, 14, 14);
    line(-7, 4, -10, 6);
    line(-10, 6, -7, 6);
    line(-4, 7, -4, 9);
    line(-4, 7, -2, 7);
    line(7, -2, 10, -2);
    line(7, 2, 10, 2);
    ctx2.font = '5.5px "Cascadia Code", Consolas, monospace';
    ctx2.fillText("D", -3.5, -5);
    ctx2.fillText("Q", 4, -5);
    ctx2.fillText("CLK", -3.5, 5.4);
  } else if (kind === "transformer" || kind === "coupling_inductor") {
    const coil = (y) => {
      for (const cx of [-4.8, 0, 4.8]) {
        ctx2.beginPath();
        ctx2.arc(cx, y, 2.3, Math.PI, 0, false);
        ctx2.stroke();
      }
    };
    line(-S, 0, -7.1, 0);
    line(7.1, 0, S, 0);
    coil(0);
    if (kind === "transformer") {
      line(-8, -3.4, 8, -3.4);
      line(-8, -6.2, 8, -6.2);
    } else {
      ctx2.setLineDash([2, 2]);
      line(-8, -4.8, 8, -4.8);
      ctx2.setLineDash([]);
    }
    coil(-9.6);
  } else if (kind === "adc4") {
    ctx2.strokeRect(-7, -7, 14, 14);
    ctx2.font = '5px "Cascadia Code", Consolas, monospace';
    ctx2.textAlign = "center";
    ctx2.textBaseline = "middle";
    ctx2.fillText("ADC", 0, -3.6);
    line(-4, 3.6, -1.5, 3.6);
    line(-1.5, 3.6, -1.5, 1.4);
    line(-1.5, 1.4, 1, 1.4);
    line(1, 1.4, 1, -0.2);
    line(-S, 0, -7, 0);
    line(7, 0, S, 0);
  } else {
    ctx2.strokeRect(-7, -6, 14, 12);
    ctx2.font = '6px "Cascadia Code", Consolas, monospace';
    ctx2.textAlign = "center";
    ctx2.textBaseline = "middle";
    ctx2.fillText(kind.slice(0, 6), 0, 0);
  }
  ctx2.restore();
}
function elementValueText(edge) {
  const params = edge.params || {};
  const kind = String(edge.kind || "");
  const unit = (value, suffix) => value == null ? "" : `${Number(value).toPrecision(4)}${suffix}`;
  if (kind === "resistor") return unit(params.R, " \u03A9");
  if (kind === "capacitor") return unit(params.C, " F");
  if (kind === "inductor") return unit(params.L, " H");
  if (kind === "diode" || kind === "led") return `${kind === "led" ? "LED" : "D"}`;
  if (kind === "zener") return `Vz=${unit(params.Vz, " V")}`;
  if (kind === "vsource" || kind === "isource") {
    const wave = params.wave || "dc";
    if (wave === "dc") return `DC ${unit(params.offset, " V")}`;
    return `${wave} ${unit(params.amplitude, " V")} / ${unit(params.frequency, " Hz")}`;
  }
  if (kind === "vcvs" || kind === "vccs") return `gain=${unit(params.gain, "")}`;
  if (kind === "opamp" || kind === "comparator") return `A=${unit(params.gain, "")}`;
  if (kind === "switch") return params.closed ? "\u95ED\u5408" : "\u65AD\u5F00";
  if (kind === "dflipflop") return `Q\u2080=${unit(params.q0, " V")}`;
  return "";
}
function circuitWireGap(points, middle, gapLength) {
  const half = gapLength / 2;
  const segments = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length <= 0) continue;
    segments.push({ a, b, length, start: total });
    total += length;
  }
  if (!total) return;
  const midAt = (() => {
    let best = 0;
    let bestDist = Infinity;
    for (const segment of segments) {
      const dx = middle.x - segment.a.x;
      const dy = middle.y - segment.a.y;
      const t = Math.max(0, Math.min(1, (dx * (segment.b.x - segment.a.x) + dy * (segment.b.y - segment.a.y)) / (segment.length * segment.length)));
      const px = segment.a.x + (segment.b.x - segment.a.x) * t;
      const py = segment.a.y + (segment.b.y - segment.a.y) * t;
      const dist = Math.hypot(px - middle.x, py - middle.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = segment.start + segment.length * t;
      }
    }
    return best;
  })();
  const from = midAt - half;
  const to = midAt + half;
  ctx.save();
  ctx.strokeStyle = C("#f7f4ec");
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  for (const segment of segments) {
    const s = Math.max(from, segment.start);
    const e = Math.min(to, segment.start + segment.length);
    if (e <= s) continue;
    const t0 = (s - segment.start) / segment.length;
    const t1 = (e - segment.start) / segment.length;
    ctx.beginPath();
    ctx.moveTo(segment.a.x + (segment.b.x - segment.a.x) * t0, segment.a.y + (segment.b.y - segment.a.y) * t0);
    ctx.lineTo(segment.a.x + (segment.b.x - segment.a.x) * t1, segment.a.y + (segment.b.y - segment.a.y) * t1);
    ctx.stroke();
  }
  ctx.restore();
}
function drawJunctionDots() {
  if (state.scene?.mode !== "circuit" || state.ui?.symbol !== "gb") return;
  const degree = /* @__PURE__ */ new Map();
  for (const edge of state.scene.edges || []) {
    if (!edge.enabled) continue;
    for (const key of [edge.source, edge.target]) {
      degree.set(key, (degree.get(key) || 0) + 1);
    }
  }
  for (const node of state.scene.nodes || []) {
    const count = degree.get(node.id) || 0;
    if (count < 3 || node.kind === "ground") continue;
    const center = nodeCenterScreen(node);
    ctx.beginPath();
    ctx.arc(center.x, center.y, 3.4, 0, Math.PI * 2);
    ctx.fillStyle = C("#4d463c");
    ctx.fill();
    ctx.strokeStyle = C("#f7f4ec");
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
const ELEMENT_PIN_GEOMETRY = {
  opamp: [
    { name: "IN+", x: -6.5, y: -4.5, bind: "vp", role: "in" },
    { name: "IN-", x: -6.5, y: 4.5, bind: "vn", role: "in" },
    { name: "OUT", x: 8, y: 0, bind: "source", role: "out" }
  ],
  comparator: [
    { name: "IN+", x: -6.5, y: -4.5, bind: "vp", role: "in" },
    { name: "IN-", x: -6.5, y: 4.5, bind: "vn", role: "in" },
    { name: "OUT", x: 8, y: 0, bind: "source", role: "out" }
  ],
  dflipflop: [
    { name: "D", x: -7, y: -4, bind: "d_node", role: "in" },
    { name: "CLK", x: -7, y: 4, bind: "clk_node", role: "in" },
    { name: "Q", x: 7, y: 0, bind: "source", role: "out" }
  ],
  transformer: [
    { name: "S1", x: -7.1, y: -9.6, bind: "secondary_source", role: "out" },
    { name: "S2", x: 7.1, y: -9.6, bind: "secondary_target", role: "out" }
  ],
  coupling_inductor: [
    { name: "S1", x: -7.1, y: -9.6, bind: "secondary_source", role: "out" },
    { name: "S2", x: 7.1, y: -9.6, bind: "secondary_target", role: "out" }
  ],
  adc4: [
    { name: "VIN", x: -7, y: -4, bind: "vin_node", role: "in" },
    { name: "CLK", x: -7, y: 4, bind: "clk_node", role: "in" },
    { name: "Q0", x: 7, y: -6, bind: "source", role: "out" },
    { name: "Q1", x: 7, y: -2, bind: "q1_node", role: "out" },
    { name: "Q2", x: 7, y: 2, bind: "q2_node", role: "out" },
    { name: "Q3", x: 7, y: 6, bind: "q3_node", role: "out" },
    { name: "COM", x: 0, y: 7, bind: "target", role: "power" }
  ],
  thyristor: [
    { name: "A", x: 7, y: -4.5, bind: "source", role: "out" },
    { name: "K", x: 7, y: 4.5, bind: "target", role: "out" },
    { name: "G", x: -7, y: 4.5, bind: "gate_node", role: "in" }
  ],
  igbt: [
    { name: "C", x: 6, y: -7, bind: "source", role: "out" },
    { name: "E", x: 6, y: 7, bind: "target", role: "out" },
    { name: "G", x: -6, y: 0, bind: "gate_node", role: "in" }
  ],
  jfet: [
    { name: "D", x: 6, y: -7, bind: "source", role: "out" },
    { name: "S", x: 6, y: 7, bind: "target", role: "out" },
    { name: "G", x: -6, y: 0, bind: "gate_node", role: "in" }
  ],
  relay: [
    { name: "COIL1", x: -8, y: -9, bind: "source", role: "in" },
    { name: "COIL2", x: 0, y: 9, bind: "target", role: "in" },
    { name: "COM", x: 0, y: 9, bind: "com_node", role: "out" },
    { name: "NO", x: 7, y: -1.2, bind: "no_node", role: "out" }
  ],
  motor: [
    { name: "+", x: -18, y: 0, bind: "source", role: "in" },
    { name: "-", x: 18, y: 0, bind: "target", role: "out" }
  ]
};
function elementPins(edge) {
  return ELEMENT_PIN_GEOMETRY[edge.kind] || [
    { name: "pin1", x: -18, y: 0, bind: "source", role: "passive" },
    { name: "pin2", x: 18, y: 0, bind: "target", role: "passive" }
  ];
}
function elementLayoutCenter(edge, points) {
  if (edge.layout && Number.isFinite(edge.layout.x) && Number.isFinite(edge.layout.y)) {
    return worldToScreen(edge.layout);
  }
  return pathMidpoint(points) || { x: 0, y: 0 };
}
function elementRot(edge) {
  if (edge.layout && Number.isFinite(Number(edge.layout.rot))) return Number(edge.layout.rot) * Math.PI / 180;
  return 0;
}
function symbolScalePx() {
  const base = Math.max(2, Math.min(3, state.view.k * 2.4));
  return base * ((Number(state.ui?.symbolScale) || 1.2) / 1.2);
}
export {
  circuitMidAngle,
  circuitWireGap,
  drawCircuitGlyph,
  drawJunctionDots,
  elementLayoutCenter,
  elementPins,
  elementRot,
  symbolScalePx
};
