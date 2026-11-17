import { clamp } from '../../app.utils.js';
import { C } from '../../app/colors.js';
import { PLOT_SEMANTICS } from '../../app/contracts.js';
import { frameSeriesToPoints } from '../../app/plot_semantics.js';
import { wbFmtAxis } from '../../app/ui_helpers.js';
export function drawWbSubplotOld(canvas, entry, signals, xMin, xMax, height, deps) {
  const parentWidth = canvas.parentElement?.getBoundingClientRect().width || 320;
  const cssW = Math.max(120, Math.round(parentWidth));
  const cssH = height == null ? deps.wbCompareLayout.height : height;
  const dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = C('#faf8f2');
  ctx.fillRect(0, 0, cssW, cssH);

  const left = 48;
  const right = 12;
  const top = 10;
  const bottom = 22;
  const plotW = Math.max(10, cssW - left - right);
  const plotH = Math.max(10, cssH - top - bottom);

  let yMin = Infinity;
  let yMax = -Infinity;
  for (const key of signals) {
    const arr = entry.series?.[key] || [];
    for (const value of arr) {
      if (Number.isFinite(value)) {
        yMin = Math.min(yMin, value);
        yMax = Math.max(yMax, value);
      }
    }
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    yMin = -1;
    yMax = 1;
  }
  if (yMax - yMin < 1e-12) {
    const mid = (yMax + yMin) / 2 || 0;
    yMin = mid - 0.5;
    yMax = mid + 0.5;
  }
  const spanY = Math.max(1e-12, yMax - yMin);
  const spanX = Math.max(1e-12, xMax - xMin);
  const toX = (t) => left + ((t - xMin) / spanX) * plotW;
  const toY = (v) => top + (1 - (v - yMin) / spanY) * plotH;

  ctx.strokeStyle = C('#e6e2d6');
  ctx.lineWidth = PLOT_SEMANTICS.gridWidth;
  ctx.fillStyle = C('#969083');
  ctx.font = '10px "Segoe UI","Microsoft YaHei",sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i += 1) {
    const value = yMin + spanY * (i / 4);
    const y = toY(value);
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left + plotW, y);
    ctx.stroke();
    ctx.fillText(wbFmtAxis(value), left - 6, y);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let i = 0; i <= 4; i += 1) {
    const t = xMin + spanX * (i / 4);
    const x = toX(t);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + plotH);
    ctx.stroke();
    ctx.fillText(wbFmtAxis(t), x, top + plotH + 4);
  }
  ctx.strokeStyle = C('#b8b3a4');
  ctx.strokeRect(left, top, plotW, plotH);

  for (const key of signals) {
    const points = frameSeriesToPoints(entry.t || [], entry.series?.[key] || []);
    const n = points.x.length;
    if (!n) continue;
    ctx.strokeStyle = deps.colorForKey(key);
    ctx.lineWidth = PLOT_SEMANTICS.lineWidth;
    ctx.beginPath();
    for (let i = 0; i < n; i += 1) {
      const x = toX(points.x[i]);
      const y = toY(points.y[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

