// 画布基础绘制助手（S5-29 从 app.ts 迁出）
import { C, tokens } from './colors.js';
import { GROUP_COLORS } from './constants.js';
import { canvas, ctx } from './dom.js';
import { state, ui } from './state.js';
import { fmt } from '../app.utils.js';
import { anchorPoint, devicePinScreen, edgePathPoints, nodeCenterScreen, worldToScreen } from './geometry.js';
import { edgeDisplayData, getNodeSpec, nodeById, nodeDisplayData } from './model.js';
import { elementLayoutCenter, elementPins, elementRot, symbolScalePx } from './circuit_symbols.js';
import { isPinNode } from './device_pins.js';
import type { BoxRec, EdgeItem, NodeItem, PortSpec, Pt } from './types.js';

export const KIND_SHORT = {
    manual: 'MANUAL',
    sum: 'SUM',
    gain: 'GAIN',
    lag: 'LAG',
    integrate: 'INT',
    signal: 'SIGNAL',
    expression: 'EXPR',
    state_space: 'STATE',
    clip: 'CLIP',
    oscillator: 'OSC',
    nonlinear_plant: 'PLANT',
    sliding_mode: 'SMC',
    vector_transform: 'VECTOR',
    node: 'NODE',
    ground: 'GROUND',
  };

export const KIND_COLORS = {
    oscillator: '#a8541f',
    nonlinear_plant: '#1f5f5b',
    sliding_mode: '#7a4a7c',
    vector_transform: '#4a6f8a',
  };

export function nodeColor(node: NodeItem) {
    if (node.kind === 'ground') return C('#6f695f');
    if (state.mode === 'circuit') return C('#9a6a1c');
    if (KIND_COLORS[node.kind as keyof typeof KIND_COLORS]) return C(KIND_COLORS[node.kind as keyof typeof KIND_COLORS]);
    const spec = getNodeSpec(node.kind);
    return C(GROUP_COLORS[spec?.group as keyof typeof GROUP_COLORS] || '#a8541f');
  }

export function nodeKindLabel(node: NodeItem) {
    return KIND_SHORT[node.kind as keyof typeof KIND_SHORT] || String(node.kind || '').toUpperCase().slice(0, 9);
  }

export function nodeValueText(node: NodeItem) {
    const data = nodeDisplayData(node);
    const fields = Object.keys(data).filter((key: string) => typeof data[key] === 'number' && Number.isFinite(data[key]));
    if (!fields.length) return '—';
    const preferred = ['voltage', 'value', 'y0', 'output', 'acc', 'x1', 'x', 'y', 'vx', 'vy']
      .find((key: string) => fields.includes(key));
    const ordered = preferred ? [preferred, ...fields.filter((key: string) => key !== preferred)] : fields;
    return ordered.slice(0, 2).map((key: string) => `${key} ${fmt(data[key], 3)}`).join('  ·  ');
  }

export function edgeValueText(edge: EdgeItem) {
    const data = edgeDisplayData(edge);
    const field = ['current', 'voltage_difference', 'power', 'voltage']
      .find((key: string) => typeof data[key] === 'number');
    return field ? `${field} ${fmt(data[field], 3)}` : '';
  }

  const __gridPattern: { key: string; pattern: CanvasPattern | null } = { key: '', pattern: null };
export function gridPattern(step: number, dpr: number, color: string) {
    const key = `${step.toFixed(3)}|${dpr}|${color}`;
    if (__gridPattern.key === key) return __gridPattern.pattern;
    try {
      const tile = document.createElement('canvas');
      const size = Math.max(1, Math.round(step * dpr));
      tile.width = size;
      tile.height = size;
      const tctx = tile.getContext('2d');
      tctx!.scale(dpr, dpr);
      tctx!.fillStyle = color;
      tctx!.fillRect(0, 0, 1, 1);
      __gridPattern.key = key;
      __gridPattern.pattern = ctx.createPattern(tile, 'repeat');
    } catch (error) {
      __gridPattern.key = key;
      __gridPattern.pattern = null;
    }
    return __gridPattern.pattern;
  }

export function drawGrid(width: number, height: number) {
    if (state.ui?.showGrid === false || state.ui?.drawingMode) return;
    let step = (Number(state.ui?.grid) || 20) * state.view.k;
    while (step < 12) step *= 2;
    while (step > 84) step /= 2;
    const ox = ((state.view.x % step) + step) % step;
    const oy = ((state.view.y % step) + step) % step;

    // 网格点用 CanvasPattern 平铺：一次 fillRect 取代 (w/step)*(h/step) 次 1px 填充
    // （1400×900、步距 20 时原本每帧 3000+ 次 fillRect，是画布重绘的主要开销）。
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

    // CAD 式捕捉点：拖动时高亮最近的网格交点
    const dragging = state.drag && ['node', 'waypoint', 'resize', 'endpoint'].includes((state.drag.type as string));
    const pointer = state.pointer;
    if (
      dragging
      && state.ui?.snapMarkers !== false
      && state.ui?.snap
      && pointer
      && Number.isFinite(pointer.x)
      && Number.isFinite(pointer.y)
    ) {
      const grid = Number(state.ui?.grid) || 20;
      const snapped = {
        x: Math.round(pointer.x / grid) * grid,
        y: Math.round(pointer.y / grid) * grid,
      };
      const sp = (worldToScreen as Function)(snapped.x, snapped.y);
      const size = 7;
      ctx.strokeStyle = C('rgba(168, 84, 31, 0.85)');
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(sp.x - size, sp.y);
      ctx.lineTo(sp.x + size, sp.y);
      ctx.moveTo(sp.x, sp.y - size);
      ctx.lineTo(sp.x, sp.y + size);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, size + 3, 0, Math.PI * 2);
      ctx.strokeStyle = C('rgba(168, 84, 31, 0.35)');
      ctx.stroke();
    }
  }




export function pinScreenPoint(edge: EdgeItem, pin: { name: string; x: number; y: number; [k: string]: unknown }, points: Array<{ x: number; y: number }>, scale: number = 1) {
    const center = elementLayoutCenter(edge, points);
    const angle = elementRot(edge);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const unit = state.view.k * scale;
    const wx = center.x + (pin.x * cos - pin.y * sin) * unit;
    const wy = center.y + (pin.x * sin + pin.y * cos) * unit;
    return { x: wx, y: wy };
  }

export function edgeAnchorTowards(node: NodeItem, otherNode: NodeItem | null) {
    const other = nodeCenterScreen((otherNode as NodeItem));
    return anchorPoint(node, 'auto', other);
  }

export function circuitPinPath(edge: EdgeItem, source: NodeItem, target: NodeItem) {
    if (state.scene?.mode !== 'circuit' || state.ui?.symbol !== 'gb') return null;
    if (edge.kind === 'wire') return null;
    if (!edge.layout) return null;
    // 手动布线的边以 waypoints 为准，不再被引脚吸附改写。
    if (edge.route === 'manual' && Array.isArray(edge.waypoints) && edge.waypoints.length) return null;
    const pins = elementPins(edge);
    if (pins.length !== 2) return null; // 多引脚元件的输出端单独处理
    const binds = new Set(pins.map((pin: PortSpec) => pin.bind));
    if (!binds.has('source') || !binds.has('target')) return null; // 参数绑定的 2 引脚（变压器副边等）
    const start = edgeAnchorTowards(source, target);
    const end = edgeAnchorTowards(target, source);
    const pin1 = pinScreenPoint(edge, pins[0], [start, end]);
    const pin2 = pinScreenPoint(edge, pins[1], [start, end]);
    return [start, pin1, pin2, end];
  }

export function wirePathPoints(edge: EdgeItem, source: Pt, target: Pt) {
    const start = isPinNode((source as NodeItem))
      ? devicePinScreen((source as NodeItem), (edge.source_pin as string))
      : anchorPoint((source as NodeItem), 'auto', nodeCenterScreen((target as NodeItem)));
    const end = isPinNode((target as NodeItem))
      ? devicePinScreen((target as NodeItem), (edge.target_pin as string))
      : anchorPoint((target as NodeItem), 'auto', nodeCenterScreen((source as NodeItem)));
    let route = edge.route || 'auto';
    if (route === 'auto' && state.ui?.circuitOrthogonal !== false) route = 'orthogonal';
    if (route === 'manual' && Array.isArray(edge.waypoints) && edge.waypoints.length) {
      return [start, ...edge.waypoints.map((item: Pt) => worldToScreen(item)), end];
    }
    if (route === 'straight') return [start, end];
    if (Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)) {
      const midX = (start.x + end.x) / 2;
      return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
    }
    const midY = (start.y + end.y) / 2;
    return [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
  }

export function drawMultiPinWires(edge: EdgeItem, color: string) {
    if (state.scene?.mode !== 'circuit' || state.ui?.symbol !== 'gb' || !edge.layout) return;
    const pins = elementPins(edge);
    // 多引脚元件（运放/ADC/变压器…）主路径不画，所有引脚都由这里接线；
    // 两端元件只补参数绑定的引脚（主路径已在 drawEdges 画出）。
    const multi = pins.length > 2;
    const source = nodeById(edge.source);
    const target = nodeById(edge.target);
    if (!source || !target) return;
    const points = [nodeCenterScreen(source), nodeCenterScreen(target)];
    const center = elementLayoutCenter(edge, points);
    for (const pin of pins) {
      if (!pin.bind) continue;
      if (!multi && (pin.bind === 'source' || pin.bind === 'target')) continue;
      const nodeId = pin.bind === 'source'
        ? edge.source
        : pin.bind === 'target'
          ? edge.target
          : edge.params?.[pin.bind];
      const node = nodeId ? nodeById((nodeId as string)) : null;
      if (!node) continue;
      const from = pinScreenPoint(edge, pin, points, symbolScalePx());
      const to = anchorPoint(node, 'auto', center);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.0;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(to.x, to.y, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = C('#f7f4ec');
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

export function elementIdentifier(edge: EdgeItem) {
    // GB 标识：位号 + 极性/类型简称；名称本身已是 R1/C1 时直接用。
    const name = String(edge.name || '');
    const kind = String(edge.kind || '');
    if (name) return name;
    const prefix = {
      resistor: 'R', capacitor: 'C', inductor: 'L', diode: 'D', led: 'LED',
      zener: 'ZD', vsource: 'V', isource: 'I', switch: 'S', opamp: 'U',
      comparator: 'U', dflipflop: 'U', vcvs: 'E', vccs: 'G',
      npn: 'Q', pnp: 'Q', nmos: 'Q', pmos: 'Q',
      transformer: 'T', coupling_inductor: 'L', adc4: 'U',
    }[kind] || kind.slice(0, 2).toUpperCase();
    return `${prefix}?`;
  }


export function segmentIntersection(a: Pt, b: Pt, c: Pt, d: Pt) {
    const r = { x: b.x - a.x, y: b.y - a.y };
    const s = { x: d.x - c.x, y: d.y - c.y };
    const denom = r.x * s.y - r.y * s.x;
    if (Math.abs(denom) < 1e-9) return null;
    const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom;
    const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denom;
    if (t <= 0.02 || t >= 0.98 || u <= 0.02 || u >= 0.98) return null;
    return { x: a.x + r.x * t, y: a.y + r.y * t };
  }

export function circuitCrossingMap(edges: EdgeItem[]) {
    const map = new Map();
    if (state.scene?.mode !== 'circuit' || state.ui?.symbol !== 'gb' || edges.length > 160) return map;
    const paths = edges.map((edge: EdgeItem) => ({ id: edge.id, points: edgePathPoints(edge) || [] }));
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
        if (points.length) map.set(second.id, [...(map.get(second.id) || []), ...points]);
      }
    }
    return map;
  }

export function drawCrossingHops(points: Array<{ x: number; y: number }>, color: string) {
    for (const point of points) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = C('#f7f4ec');
      ctx.fill();
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4.2, Math.PI * 1.05, Math.PI * 1.95);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.restore();
    }
  }
