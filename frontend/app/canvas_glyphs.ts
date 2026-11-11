// 电路符号与 GB 符号绘制（S5-30 从 app.ts 迁出）
import { C, tokens } from './colors.js';
import { ctx } from './dom.js';
import { state, ui } from './state.js';
import { clamp } from '../app.utils.js';
import { deviceImplicitGroundPin, deviceInactive, devicePinLocal, deviceSupplyLabel } from './geometry.js';
import { deviceElementSpec, devicePins } from './device_pins.js';
import { nodeKindLabel } from './canvas_base.js';
import type { AppearanceRec, BoxRec, NodeItem, PortSpec } from './types.js';

export function drawGbCircuitNode(ctx: CanvasRenderingContext2D, node: NodeItem, cx: number, cy: number, radius: number, accent: string, isSelected: boolean, isHovered: boolean, k: number, appearance: AppearanceRec = {}) {
    const style = state.ui?.nodeStyle || 'circle';
    const color = appearance.strokeColor || (isSelected ? C('#a8541f') : isHovered ? tokens().edgeHover : tokens().labelText);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = appearance.fillColor || C('#faf8f2');
    ctx.lineWidth = isSelected ? 1.8 : 1.2;
    if (node.kind === 'ground') {
      const top = cy - radius * 0.5;
      ctx.beginPath();
      ctx.moveTo(cx, top);
      ctx.lineTo(cx, cy + 2);
      ctx.stroke();
      const bars = [[15, 6], [10, 10], [5, 14]];
      for (const [width, offset] of bars) {
        ctx.beginPath();
        ctx.moveTo(cx - width / 2, cy + offset);
        ctx.lineTo(cx + width / 2, cy + offset);
        ctx.stroke();
      }
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(radius, 12) + 4, 0, Math.PI * 2);
        ctx.strokeStyle = C('rgba(168, 84, 31, 0.45)');
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    if (style === 'dot') {
      ctx.beginPath();
      ctx.arc(cx, cy, 4.2, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? C('#a8541f') : accent;
      ctx.fill();
    } else if (style === 'box') {
      ctx.beginPath();
      ctx.rect(cx - 10, cy - 7, 20, 14);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(cx, cy, 10.5, 0, Math.PI * 2);
      ctx.strokeStyle = C('rgba(168, 84, 31, 0.6)');
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

export function drawGbFunctionGlyph(ctx: CanvasRenderingContext2D, node: NodeItem, cx: number, cy: number, radius: number, accent: string, isSelected: boolean, isHovered: boolean, k: number, appearance: AppearanceRec = {}) {
    const color = appearance.strokeColor || (isSelected ? C('#a8541f') : isHovered ? tokens().edgeHover : accent);
    const R = radius * 0.92;
    const fontPx = Math.max(10, Math.round(R * 0.8));
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = appearance.textColor || color;
    ctx.lineWidth = isSelected ? 1.8 : clamp(1.15 * k, 0.9, 1.8);
    ctx.lineJoin = 'round';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${fontPx}px "Cascadia Code", Consolas, monospace`;
    const kind = node.kind;
    if (kind === 'sum') {
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
      ctx.fillText('Σ', cx, cy + 1);
    } else if (kind === 'gain') {
      ctx.beginPath();
      ctx.moveTo(cx - R * 0.72, cy - R * 0.75);
      ctx.lineTo(cx - R * 0.72, cy + R * 0.75);
      ctx.lineTo(cx + R * 0.9, cy);
      ctx.closePath();
      ctx.stroke();
      ctx.font = `600 ${Math.round(fontPx * 0.72)}px "Cascadia Code", Consolas, monospace`;
      ctx.fillText('K', cx - R * 0.18, cy + 1);
    } else if (kind === 'integrate') {
      ctx.strokeRect(cx - R * 0.62, cy - R * 0.58, R * 1.24, R * 1.16);
      ctx.fillText('∫', cx, cy + 1);
    } else if (kind === 'lag') {
      ctx.strokeRect(cx - R * 0.66, cy - R * 0.58, R * 1.32, R * 1.16);
      ctx.font = `600 ${Math.round(fontPx * 0.62)}px "Cascadia Code", Consolas, monospace`;
      ctx.fillText('1/(1+τs)', cx, cy + 1);
    } else if (kind === 'expression') {
      ctx.strokeRect(cx - R * 0.62, cy - R * 0.55, R * 1.24, R * 1.1);
      ctx.fillText('f(x)', cx, cy + 1);
    } else if (kind === 'oscillator') {
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.82, 0, Math.PI * 2); ctx.stroke();
      ctx.fillText('~', cx, cy + 1);
    } else if (kind === 'signal') {
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.82, 0, Math.PI * 2); ctx.stroke();
      ctx.fillText('s', cx, cy + 1);
    } else if (kind === 'manual') {
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.82, 0, Math.PI * 2); ctx.stroke();
      ctx.fillText('M', cx, cy + 1);
    } else if (kind === 'module_input' || kind === 'module_output') {
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.7, 0, Math.PI * 2); ctx.stroke();
      ctx.fillText(kind === 'module_input' ? 'I' : 'O', cx, cy + 1);
    } else if (kind === 'block') {
      const hw = R * 0.72;
      const hh = R * 0.5;
      ctx.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2);
      ctx.font = `600 ${Math.round(fontPx * 0.7)}px "Cascadia Code", Consolas, monospace`;
      ctx.fillText('B', cx, cy + 1);
    } else {
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.72, 0, Math.PI * 2); ctx.stroke();
      ctx.font = `600 ${Math.round(fontPx * 0.55)}px "Cascadia Code", Consolas, monospace`;
      ctx.fillText(String(nodeKindLabel(node) || kind).slice(0, 2), cx, cy + 1);
    }
    ctx.restore();
  }

export function drawGbDeviceNode(ctx: CanvasRenderingContext2D, node: NodeItem, rect: BoxRec, accent: string, isSelected: boolean, isHovered: boolean, k: number, appearance: AppearanceRec = {}) {
    const color = appearance.strokeColor || (isSelected ? C('#a8541f') : isHovered ? tokens().edgeHover : accent);
    const inactive = Boolean(state.sim?.running) && deviceInactive(node);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 1.8 : 1.2;
    ctx.fillStyle = appearance.fillColor || C('#faf8f2');
    if (inactive) {
      // R21/D43：运行中未参与求解的器件红色辉光（停止后恢复）。
      ctx.save();
      ctx.shadowColor = tokens().dangerShadow;
      ctx.shadowBlur = 16 * k;
      ctx.strokeStyle = C('#dc2626');
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? 1.8 : 1.2;
    }
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.fill();
    ctx.stroke();
    const spec = deviceElementSpec(node);
    const cx = rect.cx as number;
    const cy = rect.cy as number;
    ctx.fillStyle = appearance.textColor || color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${clamp(9 * k, 7, 12)}px "Cascadia Code", Consolas, monospace`;
    ctx.fillText((spec?.label || node.params?.block_name || node.params?.element || '器件') as string, cx, cy);
    const showNames = k > 0.55 && state.ui.showPins !== false;
    for (const pin of devicePins(node)) {
      const local = devicePinLocal(node, pin);
      const px = cx + local.x * k;
      const py = cy + local.y * k;
      const inwardX = local.side === 'left' ? 1 : local.side === 'right' ? -1 : 0;
      const inwardY = local.side === 'bottom' ? -1 : local.side === 'top' ? 1 : 0;
      if (inwardX || inwardY) {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + inwardX * 8 * k, py + inwardY * 8 * k);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(px, py, 2.8 * k, 0, Math.PI * 2);
      ctx.fillStyle = pin.required ? color : tokens().pinFill;
      ctx.fill();
      if (showNames) {
        const label = deviceSupplyLabel(node, pin);
        ctx.fillStyle = C('#6f695f');
        ctx.font = `${clamp(6.5 * k, 4.5, 9)}px "Cascadia Code", Consolas, monospace`;
        if (local.side === 'left') {
          ctx.textAlign = 'right';
          ctx.fillText(label, px - 7 * k, py);
        } else if (local.side === 'right') {
          ctx.textAlign = 'left';
          ctx.fillText(label, px + 7 * k, py);
        } else if (local.side === 'top') {
          ctx.textAlign = 'center';
          ctx.fillText(label, px, py - 10 * k);
        } else {
          ctx.textAlign = 'center';
          ctx.fillText(label, px, py + 10 * k);
        }
      }
    }
    const implicitPin = deviceImplicitGroundPin(node);
    if (implicitPin) {
      // R21/D43：单端电源的空脚画接地标记（可见，不是隐藏接地）。
      const local = devicePinLocal(node, (devicePins(node).find((pin: PortSpec) => pin.name === implicitPin) as PortSpec));
      const gx = cx + local.x * k;
      const gy = cy + local.y * k;
      const dir = local.side === 'top' ? -1 : 1;
      ctx.strokeStyle = C('#6f695f');
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx, gy + dir * 6 * k);
      ctx.stroke();
      for (let row = 0; row < 3; row += 1) {
        const half = (5 - row * 1.4) * k;
        const y = gy + dir * (6 + row * 4) * k;
        ctx.beginPath();
        ctx.moveTo(gx - half, y);
        ctx.lineTo(gx + half, y);
        ctx.stroke();
      }
      if (showNames) {
        ctx.fillStyle = C('#6f695f');
        ctx.font = `${clamp(6 * k, 4.2, 8.5)}px "Cascadia Code", Consolas, monospace`;
        ctx.textAlign = 'center';
        ctx.fillText('自动接地', gx, gy + dir * 22 * k);
      }
    }
    ctx.restore();
  }
