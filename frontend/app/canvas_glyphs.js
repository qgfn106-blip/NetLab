import { C, tokens } from "./colors.js";
import { state } from "./state.js";
import { clamp } from "../app.utils.js";
import { deviceImplicitGroundPin, deviceInactive, devicePinLocal, deviceSupplyLabel } from "./geometry.js";
import { deviceElementSpec, devicePins } from "./device_pins.js";
import { nodeKindLabel } from "./canvas_base.js";
function drawGbCircuitNode(ctx2, node, cx, cy, radius, accent, isSelected, isHovered, k, appearance = {}) {
  const style = state.ui?.nodeStyle || "circle";
  const color = appearance.strokeColor || (isSelected ? C("#a8541f") : isHovered ? tokens().edgeHover : tokens().labelText);
  ctx2.save();
  ctx2.strokeStyle = color;
  ctx2.fillStyle = appearance.fillColor || C("#faf8f2");
  ctx2.lineWidth = isSelected ? 1.8 : 1.2;
  if (node.kind === "ground") {
    const top = cy - radius * 0.5;
    ctx2.beginPath();
    ctx2.moveTo(cx, top);
    ctx2.lineTo(cx, cy + 2);
    ctx2.stroke();
    const bars = [[15, 6], [10, 10], [5, 14]];
    for (const [width, offset] of bars) {
      ctx2.beginPath();
      ctx2.moveTo(cx - width / 2, cy + offset);
      ctx2.lineTo(cx + width / 2, cy + offset);
      ctx2.stroke();
    }
    if (isSelected) {
      ctx2.beginPath();
      ctx2.arc(cx, cy, Math.max(radius, 12) + 4, 0, Math.PI * 2);
      ctx2.strokeStyle = C("rgba(168, 84, 31, 0.45)");
      ctx2.stroke();
    }
    ctx2.restore();
    return;
  }
  if (style === "dot") {
    ctx2.beginPath();
    ctx2.arc(cx, cy, 4.2, 0, Math.PI * 2);
    ctx2.fillStyle = isSelected ? C("#a8541f") : accent;
    ctx2.fill();
  } else if (style === "box") {
    ctx2.beginPath();
    ctx2.rect(cx - 10, cy - 7, 20, 14);
    ctx2.fill();
    ctx2.stroke();
  } else {
    ctx2.beginPath();
    ctx2.arc(cx, cy, 5.5, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.stroke();
  }
  if (isSelected) {
    ctx2.beginPath();
    ctx2.arc(cx, cy, 10.5, 0, Math.PI * 2);
    ctx2.strokeStyle = C("rgba(168, 84, 31, 0.6)");
    ctx2.lineWidth = 1;
    ctx2.stroke();
  }
  ctx2.restore();
}
function drawGbFunctionGlyph(ctx2, node, cx, cy, radius, accent, isSelected, isHovered, k, appearance = {}) {
  const color = appearance.strokeColor || (isSelected ? C("#a8541f") : isHovered ? tokens().edgeHover : accent);
  const R = radius * 0.92;
  const fontPx = Math.max(10, Math.round(R * 0.8));
  ctx2.save();
  ctx2.strokeStyle = color;
  ctx2.fillStyle = appearance.textColor || color;
  ctx2.lineWidth = isSelected ? 1.8 : clamp(1.15 * k, 0.9, 1.8);
  ctx2.lineJoin = "round";
  ctx2.textAlign = "center";
  ctx2.textBaseline = "middle";
  ctx2.font = `600 ${fontPx}px "Cascadia Code", Consolas, monospace`;
  const kind = node.kind;
  if (kind === "sum") {
    ctx2.beginPath();
    ctx2.arc(cx, cy, R, 0, Math.PI * 2);
    ctx2.stroke();
    ctx2.fillText("\u03A3", cx, cy + 1);
  } else if (kind === "gain") {
    ctx2.beginPath();
    ctx2.moveTo(cx - R * 0.72, cy - R * 0.75);
    ctx2.lineTo(cx - R * 0.72, cy + R * 0.75);
    ctx2.lineTo(cx + R * 0.9, cy);
    ctx2.closePath();
    ctx2.stroke();
    ctx2.font = `600 ${Math.round(fontPx * 0.72)}px "Cascadia Code", Consolas, monospace`;
    ctx2.fillText("K", cx - R * 0.18, cy + 1);
  } else if (kind === "integrate") {
    ctx2.strokeRect(cx - R * 0.62, cy - R * 0.58, R * 1.24, R * 1.16);
    ctx2.fillText("\u222B", cx, cy + 1);
  } else if (kind === "lag") {
    ctx2.strokeRect(cx - R * 0.66, cy - R * 0.58, R * 1.32, R * 1.16);
    ctx2.font = `600 ${Math.round(fontPx * 0.62)}px "Cascadia Code", Consolas, monospace`;
    ctx2.fillText("1/(1+\u03C4s)", cx, cy + 1);
  } else if (kind === "expression") {
    ctx2.strokeRect(cx - R * 0.62, cy - R * 0.55, R * 1.24, R * 1.1);
    ctx2.fillText("f(x)", cx, cy + 1);
  } else if (kind === "oscillator") {
    ctx2.beginPath();
    ctx2.arc(cx, cy, R * 0.82, 0, Math.PI * 2);
    ctx2.stroke();
    ctx2.fillText("~", cx, cy + 1);
  } else if (kind === "signal") {
    ctx2.beginPath();
    ctx2.arc(cx, cy, R * 0.82, 0, Math.PI * 2);
    ctx2.stroke();
    ctx2.fillText("s", cx, cy + 1);
  } else if (kind === "manual") {
    ctx2.beginPath();
    ctx2.arc(cx, cy, R * 0.82, 0, Math.PI * 2);
    ctx2.stroke();
    ctx2.fillText("M", cx, cy + 1);
  } else if (kind === "module_input" || kind === "module_output") {
    ctx2.beginPath();
    ctx2.arc(cx, cy, R * 0.7, 0, Math.PI * 2);
    ctx2.stroke();
    ctx2.fillText(kind === "module_input" ? "I" : "O", cx, cy + 1);
  } else if (kind === "block") {
    const hw = R * 0.72;
    const hh = R * 0.5;
    ctx2.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2);
    ctx2.font = `600 ${Math.round(fontPx * 0.7)}px "Cascadia Code", Consolas, monospace`;
    ctx2.fillText("B", cx, cy + 1);
  } else {
    ctx2.beginPath();
    ctx2.arc(cx, cy, R * 0.72, 0, Math.PI * 2);
    ctx2.stroke();
    ctx2.font = `600 ${Math.round(fontPx * 0.55)}px "Cascadia Code", Consolas, monospace`;
    ctx2.fillText(String(nodeKindLabel(node) || kind).slice(0, 2), cx, cy + 1);
  }
  ctx2.restore();
}
function drawGbDeviceNode(ctx2, node, rect, accent, isSelected, isHovered, k, appearance = {}) {
  const color = appearance.strokeColor || (isSelected ? C("#a8541f") : isHovered ? tokens().edgeHover : accent);
  const inactive = Boolean(state.sim?.running) && deviceInactive(node);
  ctx2.save();
  ctx2.strokeStyle = color;
  ctx2.lineWidth = isSelected ? 1.8 : 1.2;
  ctx2.fillStyle = appearance.fillColor || C("#faf8f2");
  if (inactive) {
    ctx2.save();
    ctx2.shadowColor = tokens().dangerShadow;
    ctx2.shadowBlur = 16 * k;
    ctx2.strokeStyle = C("#dc2626");
    ctx2.lineWidth = 2;
    ctx2.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx2.restore();
    ctx2.strokeStyle = color;
    ctx2.lineWidth = isSelected ? 1.8 : 1.2;
  }
  ctx2.beginPath();
  ctx2.rect(rect.x, rect.y, rect.w, rect.h);
  ctx2.fill();
  ctx2.stroke();
  const spec = deviceElementSpec(node);
  const cx = rect.cx;
  const cy = rect.cy;
  ctx2.fillStyle = appearance.textColor || color;
  ctx2.textAlign = "center";
  ctx2.textBaseline = "middle";
  ctx2.font = `600 ${clamp(9 * k, 7, 12)}px "Cascadia Code", Consolas, monospace`;
  ctx2.fillText(spec?.label || node.params?.block_name || node.params?.element || "\u5668\u4EF6", cx, cy);
  const showNames = k > 0.55 && state.ui.showPins !== false;
  for (const pin of devicePins(node)) {
    const local = devicePinLocal(node, pin);
    const px = cx + local.x * k;
    const py = cy + local.y * k;
    const inwardX = local.side === "left" ? 1 : local.side === "right" ? -1 : 0;
    const inwardY = local.side === "bottom" ? -1 : local.side === "top" ? 1 : 0;
    if (inwardX || inwardY) {
      ctx2.beginPath();
      ctx2.moveTo(px, py);
      ctx2.lineTo(px + inwardX * 8 * k, py + inwardY * 8 * k);
      ctx2.stroke();
    }
    ctx2.beginPath();
    ctx2.arc(px, py, 2.8 * k, 0, Math.PI * 2);
    ctx2.fillStyle = pin.required ? color : tokens().pinFill;
    ctx2.fill();
    if (showNames) {
      const label = deviceSupplyLabel(node, pin);
      ctx2.fillStyle = C("#6f695f");
      ctx2.font = `${clamp(6.5 * k, 4.5, 9)}px "Cascadia Code", Consolas, monospace`;
      if (local.side === "left") {
        ctx2.textAlign = "right";
        ctx2.fillText(label, px - 7 * k, py);
      } else if (local.side === "right") {
        ctx2.textAlign = "left";
        ctx2.fillText(label, px + 7 * k, py);
      } else if (local.side === "top") {
        ctx2.textAlign = "center";
        ctx2.fillText(label, px, py - 10 * k);
      } else {
        ctx2.textAlign = "center";
        ctx2.fillText(label, px, py + 10 * k);
      }
    }
  }
  const implicitPin = deviceImplicitGroundPin(node);
  if (implicitPin) {
    const local = devicePinLocal(node, devicePins(node).find((pin) => pin.name === implicitPin));
    const gx = cx + local.x * k;
    const gy = cy + local.y * k;
    const dir = local.side === "top" ? -1 : 1;
    ctx2.strokeStyle = C("#6f695f");
    ctx2.lineWidth = 1.2;
    ctx2.beginPath();
    ctx2.moveTo(gx, gy);
    ctx2.lineTo(gx, gy + dir * 6 * k);
    ctx2.stroke();
    for (let row = 0; row < 3; row += 1) {
      const half = (5 - row * 1.4) * k;
      const y = gy + dir * (6 + row * 4) * k;
      ctx2.beginPath();
      ctx2.moveTo(gx - half, y);
      ctx2.lineTo(gx + half, y);
      ctx2.stroke();
    }
    if (showNames) {
      ctx2.fillStyle = C("#6f695f");
      ctx2.font = `${clamp(6 * k, 4.2, 8.5)}px "Cascadia Code", Consolas, monospace`;
      ctx2.textAlign = "center";
      ctx2.fillText("\u81EA\u52A8\u63A5\u5730", gx, gy + dir * 22 * k);
    }
  }
  ctx2.restore();
}
export {
  drawGbCircuitNode,
  drawGbDeviceNode,
  drawGbFunctionGlyph
};
