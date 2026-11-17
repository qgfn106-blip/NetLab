import { fmt, clamp } from '../app.utils.js';
import { C, tokens } from './colors.js';
import { roundRectPath } from './canvas_geometry.js';
import { activeTab } from './model.js';
import { chartCanvas, chartCtx } from './dom.js';
import type { HoverRec, State } from './types.js';

export function drawChart(deps: {
  colorForKey: (key: string) => string;
  decodeProbeKey: (key: string) => { label: string };
  nearestFrame: (time: number) => { t: number; v: Record<string, number> } | null;
  state: Pick<State, 'chart' | 'chartSize' | 'frames' | 'replay'>;
}): void {
  if (activeTab() !== 'chart') return;
  const { w, h, dpr } = deps.state.chartSize;
  if (w < 20 || h < 20) return;
  chartCanvas.dataset.renderSize = `${w}x${h}@${dpr}`;
  chartCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  chartCtx.clearRect(0, 0, w, h);
  chartCtx.fillStyle = C('#faf8f2');
  chartCtx.fillRect(0, 0, w, h);

  const keys = Array.from(deps.state.chart.selected);
  const frames = deps.state.replay.active
    ? deps.state.frames.slice(0, deps.state.replay.index + 1)
    : deps.state.frames;
  if (!keys.length || !frames.length) {
    chartCtx.fillStyle = C('#969083');
    chartCtx.font = '12px "Segoe UI", "Microsoft YaHei", sans-serif';
    chartCtx.textAlign = 'center';
    chartCtx.textBaseline = 'middle';
    chartCtx.fillText(frames.length ? '在信号列表里勾选要绘制的信号' : '运行仿真后自动采集轨迹', w / 2, h / 2);
    return;
  }

  const left = 54;
  const right = 14;
  const top = 14;
  const bottom = 24;
  const plotW = Math.max(10, w - left - right);
  const plotH = Math.max(10, h - top - bottom);
  const window = Math.max(0.1, Number(deps.state.chart.window) || 5);
  const tMax = frames[frames.length - 1].t;
  const tMin = Math.max(0, tMax - window);
  const spanT = Math.max(1e-9, tMax - tMin);

  // frames 按时间升序：二分定位时间窗起点，避免每帧从 0 开始扫（5000 帧 × N 信号）。
  let startAt = 0;
  {
    let lo = 0;
    let hi = frames.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (frames[mid].t < tMin) lo = mid + 1;
      else hi = mid;
    }
    startAt = lo;
  }
  const visibleCount = frames.length - startAt;
  // 每像素超过 4 个采样点时等间隔抽稀：只影响绘制，不改 deps.state.frames 里的原始数据。
  const stride = visibleCount > plotW * 4 ? Math.ceil(visibleCount / (plotW * 4)) : 1;
  const lastFrame = frames[frames.length - 1];
  const series = [];
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const key of keys) {
    const color = deps.colorForKey(key);
    const points = [];
    for (let i = startAt; i < frames.length; i += stride) {
      const frame = frames[i];
      const value = frame.v[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      points.push({ t: frame.t, v: value });
      if (value < yMin) yMin = value;
      if (value > yMax) yMax = value;
    }
    // 抽稀后仍要保留最新一帧，曲线终点才能对上实时值。
    if (lastFrame && lastFrame.t >= tMin && lastFrame.v
        && typeof lastFrame.v[key] === 'number' && Number.isFinite(lastFrame.v[key])
        && (!points.length || points[points.length - 1].t !== lastFrame.t)) {
      const lastV = lastFrame.v[key];
      points.push({ t: lastFrame.t, v: lastV });
      if (lastV < yMin) yMin = lastV;
      if (lastV > yMax) yMax = lastV;
    }
    series.push({ key, color, points });
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    chartCtx.fillStyle = C('#969083');
    chartCtx.font = '12px "Segoe UI", "Microsoft YaHei", sans-serif';
    chartCtx.textAlign = 'center';
    chartCtx.fillText('所选信号在时间窗内没有数值', w / 2, h / 2);
    return;
  }
  let spanY = yMax - yMin;
  if (spanY < 1e-9) {
    const pad = Math.max(1, Math.abs(yMax) * 0.2);
    yMin -= pad;
    yMax += pad;
    spanY = yMax - yMin;
  } else {
    const pad = spanY * 0.12;
    yMin -= pad;
    yMax += pad;
    spanY = yMax - yMin;
  }

  const xOf = (t: number) => left + ((t - tMin) / spanT) * plotW;
  const yOf = (v: number) => top + (1 - (v - yMin) / spanY) * plotH;

  chartCtx.font = '10px "Cascadia Code", Consolas, monospace';
  chartCtx.lineWidth = 1;
  chartCtx.textBaseline = 'middle';
  for (let index = 0; index <= 4; index += 1) {
    const y = top + (plotH * index) / 4;
    chartCtx.strokeStyle = index === 4 ? tokens().axisLine : tokens().gridLine;
    chartCtx.beginPath();
    chartCtx.moveTo(left, Math.round(y) + 0.5);
    chartCtx.lineTo(left + plotW, Math.round(y) + 0.5);
    chartCtx.stroke();
    chartCtx.fillStyle = C('#8b8376');
    chartCtx.textAlign = 'right';
    chartCtx.fillText(fmt(yMax - (spanY * index) / 4, 3), left - 8, y);
  }
  for (let index = 0; index <= 4; index += 1) {
    const x = left + (plotW * index) / 4;
    chartCtx.strokeStyle = index === 0 ? tokens().axisLine : tokens().gridLine;
    chartCtx.beginPath();
    chartCtx.moveTo(Math.round(x) + 0.5, top);
    chartCtx.lineTo(Math.round(x) + 0.5, top + plotH);
    chartCtx.stroke();
    chartCtx.fillStyle = C('#8b8376');
    chartCtx.textAlign = index === 0 ? 'left' : index === 4 ? 'right' : 'center';
    const tick = tMin + (spanT * index) / 4;
    const decimals = spanT >= 10 ? 1 : spanT >= 1 ? 2 : spanT >= 0.1 ? 3 : spanT >= 0.01 ? 4 : 5;
    chartCtx.fillText(`${tick.toFixed(decimals)}s`, x, top + plotH + 12);
  }

  chartCtx.save();
  chartCtx.beginPath();
  chartCtx.rect(left, top, plotW, plotH);
  chartCtx.clip();
  chartCtx.lineJoin = 'round';
  chartCtx.lineCap = 'round';
  for (const item of series) {
    if (!item.points.length) continue;
    chartCtx.strokeStyle = item.color;
    chartCtx.lineWidth = 1.6;
    chartCtx.beginPath();
    item.points.forEach((point: { t: number; v: number }, index: number) => {
      const x = xOf(point.t);
      const y = yOf(point.v);
      if (index === 0) chartCtx.moveTo(x, y);
      else chartCtx.lineTo(x, y);
    });
    chartCtx.stroke();
    const last = item.points[item.points.length - 1];
    chartCtx.fillStyle = item.color;
    chartCtx.beginPath();
    chartCtx.arc(xOf(last.t), yOf(last.v), 2.4, 0, Math.PI * 2);
    chartCtx.fill();
  }

  const hover = deps.state.chart.hover as (HoverRec & { x: number; y: number }) | null;
  if (hover && hover.x >= left && hover.x <= left + plotW && hover.y >= top && hover.y <= top + plotH) {
    const t = tMin + ((hover.x - left) / plotW) * spanT;
    const frame = deps.nearestFrame(t);
    if (frame) {
      const hx = xOf(frame.t);
      chartCtx.strokeStyle = C('rgba(168, 84, 31, .45)');
      chartCtx.lineWidth = 1;
      chartCtx.setLineDash([3, 3]);
      chartCtx.beginPath();
      chartCtx.moveTo(hx, top);
      chartCtx.lineTo(hx, top + plotH);
      chartCtx.stroke();
      chartCtx.setLineDash([]);
      for (const item of series) {
        const value = frame.v[item.key];
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        chartCtx.beginPath();
        chartCtx.arc(hx, yOf(value), 2.8, 0, Math.PI * 2);
        chartCtx.fillStyle = item.color;
        chartCtx.fill();
      }
      const rows = series
        .filter((item) => typeof frame.v[item.key] === 'number' && Number.isFinite(frame.v[item.key]))
        .slice(0, 5)
        .map((item) => `${deps.decodeProbeKey(item.key).label}  ${fmt(frame.v[item.key], 4)}`);
      const lines = [`t = ${fmt(frame.t, 4)} s`, ...rows];
      chartCtx.font = '10px "Cascadia Code", Consolas, monospace';
      let boxW = 0;
      for (const line of lines) boxW = Math.max(boxW, chartCtx.measureText(line).width);
      boxW += 16;
      const boxH = lines.length * 15 + 10;
      const boxX = clamp(hx + 12, left + 4, left + plotW - boxW - 4);
      const boxY = clamp(top + 6, top + 4, top + plotH - boxH - 4);
      chartCtx.fillStyle = tokens().hudBg;
      chartCtx.strokeStyle = C('#bcb3a1');
      chartCtx.lineWidth = 1;
      roundRectPath(chartCtx, boxX, boxY, boxW, boxH, 6);
      chartCtx.fill();
      chartCtx.stroke();
      chartCtx.textAlign = 'left';
      chartCtx.textBaseline = 'top';
      lines.forEach((line, index: number) => {
        chartCtx.fillStyle = index === 0 ? C('#a8541f') : tokens().edgeHover;
        chartCtx.fillText(line, boxX + 8, boxY + 6 + index * 15);
      });
    }
  }
  chartCtx.restore();
}
