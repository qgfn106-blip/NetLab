// 相图渲染与播放控制（S5-26 从 app.ts 迁出）
import { clamp, fmt } from '../app.utils.js';
import { C } from './colors.js';
import { $, phaseCanvas, phaseCtx } from './dom.js';
import { activeTab, nodeByName, nodeDisplayData } from './model.js';
import { state, ui } from './state.js';
import { el } from './ui.js';
import type { NodeItem } from './types.js';

export function phaseStateKeys(node: NodeItem) {
    const prefix = `state:${node.name}:`;
    return (state.probeKeys || [])
      .filter((key: string) => key.startsWith(prefix))
      .sort((left, right) => {
        const a = Number(left.slice(prefix.length));
        const b = Number(right.slice(prefix.length));
        if (Number.isFinite(a) && Number.isFinite(b)) return a - b;
        return left.localeCompare(right);
      });
  }

export function vectorCandidates() {
    const nodes = state.scene?.nodes || [];
    return nodes.filter((node) => {
      const data = nodeDisplayData(node);
      const hasX = typeof data.x === 'number' && typeof data.y === 'number';
      const hasV = typeof data.vx === 'number' && typeof data.vy === 'number';
      const hasState = typeof data.x1 === 'number' && typeof data.x2 === 'number';
      return hasX || hasV || hasState || phaseStateKeys(node).length >= 2;
    });
  }

export function renderVectorNodeList() {
    if (!ui.vectorNode) return;
    const nodes = vectorCandidates();
    const previous = state.phaseNode;
    ui.vectorNode.replaceChildren();
    if (!nodes.length) {
      const option = el('option', null, '（无矢量节点）');
      option.value = '';
      ui.vectorNode.appendChild(option);
      state.phaseNode = '';
      drawPhase();
      return;
    }
    for (const node of nodes) {
      const option = el('option', null, `${node.name} · ${node.kind}`);
      option.value = node.name;
      ui.vectorNode.appendChild(option);
    }
    if (!nodes.some((node) => node.name === previous)) {
      state.phaseNode = nodes[0].name;
    }
    ui.vectorNode.value = state.phaseNode;
    drawPhase();
  }

export function resizePhase() {
    const wrap = $('.phase-wrap');
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    state.phaseSize = { w: width, h: height, dpr };
    phaseCanvas.width = Math.max(1, Math.round(width * dpr));
    phaseCanvas.height = Math.max(1, Math.round(height * dpr));
    schedulePhaseDraw();
  }

export function schedulePhaseDraw() {
    if (state.phaseTimer) return;
    state.phaseTimer = setTimeout(() => {
      state.phaseTimer = 0;
      if (activeTab() === 'vector') drawPhase();
    }, 80);
  }

export function drawPhase() {
    if (activeTab() !== 'vector') return;
    const { w, h, dpr } = state.phaseSize;
    if (w < 20 || h < 20) return;
    phaseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    phaseCtx.clearRect(0, 0, w, h);
    phaseCtx.fillStyle = C('#faf8f2');
    phaseCtx.fillRect(0, 0, w, h);

    const node = nodeByName(state.phaseNode);
    if (!node) {
      phaseCtx.fillStyle = C('#969083');
      phaseCtx.font = '11px "Segoe UI", "Microsoft YaHei", sans-serif';
      phaseCtx.textAlign = 'center';
      phaseCtx.textBaseline = 'middle';
      phaseCtx.fillText('没有可绘制的二维矢量节点', w / 2, h / 2);
      ui.phaseReadout.textContent = '在矢量模式下添加「非线性动态源」后即可查看相图。';
      return;
    }

    const trail = clamp(Number(state.phaseTrail) || 360, 20, 1200);
    const total = state.frames.length;
    const cursor = state.phaseIndex == null
      ? Math.max(0, total - 1)
      : clamp(Math.round(Number(state.phaseIndex) || 0), 0, Math.max(0, total - 1));
    const frames = state.frames.slice(Math.max(0, cursor - trail + 1), cursor + 1);
    const keyX = `n:${node.name}:x`;
    const keyY = `n:${node.name}:y`;
    const keyVX = `n:${node.name}:vx`;
    const keyVY = `n:${node.name}:vy`;
    const keyX1 = `n:${node.name}:x1`;
    const keyX2 = `n:${node.name}:x2`;
    let fieldX = keyX;
    let fieldY = keyY;
    let labelX = 'x';
    let labelY = 'y';
    let points = frames
      .filter((frame) => typeof frame.v[keyX] === 'number' && typeof frame.v[keyY] === 'number')
      .map((frame) => ({ x: frame.v[keyX], y: frame.v[keyY], t: frame.t }));
    if (points.length < 2) {
      fieldX = keyVX;
      fieldY = keyVY;
      labelX = 'vx';
      labelY = 'vy';
      points = frames
        .filter((frame) => typeof frame.v[keyVX] === 'number' && typeof frame.v[keyVY] === 'number')
        .map((frame) => ({ x: frame.v[keyVX], y: frame.v[keyVY], t: frame.t }));
    }
    if (points.length < 2) {
      fieldX = keyX1;
      fieldY = keyX2;
      labelX = 'x1';
      labelY = 'x2';
      points = frames
        .filter((frame) => typeof frame.v[keyX1] === 'number' && typeof frame.v[keyX2] === 'number')
        .map((frame) => ({ x: frame.v[keyX1], y: frame.v[keyX2], t: frame.t }));
    }
    if (points.length < 2) {
      const stateKeys = phaseStateKeys(node);
      if (stateKeys.length >= 2) {
        fieldX = stateKeys[0];
        fieldY = stateKeys[1];
        labelX = fieldX.slice(`state:${node.name}:`.length);
        labelY = fieldY.slice(`state:${node.name}:`.length);
        points = frames
          .filter((frame) => typeof frame.v[fieldX] === 'number' && typeof frame.v[fieldY] === 'number')
          .map((frame) => ({ x: frame.v[fieldX], y: frame.v[fieldY], t: frame.t }));
      }
    }
    if (!points.length) {
      if (state.sim?.mode === 'signal' && !phaseStateKeys(node).length) {
        ui.phaseReadout.textContent = '该信号流节点暂无状态通道：先运行预计算，或选择传递函数 / 积分器节点。';
        return;
      }
      const data = nodeDisplayData(node);
      if (typeof data.x === 'number' && typeof data.y === 'number') {
        points = [{ x: data.x, y: data.y, t: state.sim?.time || 0 }];
        fieldX = 'x';
        fieldY = 'y';
      } else if (typeof data.vx === 'number' && typeof data.vy === 'number') {
        points = [{ x: data.vx, y: data.vy, t: state.sim?.time || 0 }];
        fieldX = 'vx';
        fieldY = 'vy';
        labelX = 'vx';
        labelY = 'vy';
      } else if (typeof data.x1 === 'number' && typeof data.x2 === 'number') {
        points = [{ x: data.x1, y: data.x2, t: state.sim?.time || 0 }];
        fieldX = 'x1';
        fieldY = 'x2';
        labelX = 'x1';
        labelY = 'x2';
      }
    }

    const margin = 34;
    const plotW = Math.max(10, w - margin * 2);
    const plotH = Math.max(10, h - margin * 2 - 14);
    const ox = margin;
    const oy = 20;
    const size = Math.min(plotW, plotH);
    const px = ox + (plotW - size) / 2;
    const py = oy + (plotH - size) / 2;

    let minX = 0;
    let maxX = 0;
    let minY = 0;
    let maxY = 0;
    for (const point of points) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
    let spanX = maxX - minX;
    let spanY = maxY - minY;
    const span = Math.max(spanX, spanY, 1.0e-3);
    const pad = span * 0.12;
    minX -= pad; maxX += pad; minY -= pad; maxY += pad;
    spanX = maxX - minX;
    spanY = maxY - minY;
    const scale = size / Math.max(spanX, spanY, 1.0e-3);
    const mapX = (value: number) => px + size / 2 + (value - (minX + maxX) / 2) * scale;
    const mapY = (value: number) => py + size / 2 - (value - (minY + maxY) / 2) * scale;

    // 网格
    phaseCtx.strokeStyle = C('#e3ddd0');
    phaseCtx.lineWidth = 1;
    phaseCtx.beginPath();
    for (let index = 0; index <= 6; index += 1) {
      const gx = px + (size * index) / 6;
      const gy = py + (size * index) / 6;
      phaseCtx.moveTo(gx, py);
      phaseCtx.lineTo(gx, py + size);
      phaseCtx.moveTo(px, gy);
      phaseCtx.lineTo(px + size, gy);
    }
    phaseCtx.stroke();

    // 坐标轴
    phaseCtx.strokeStyle = C('#bcb3a1');
    phaseCtx.lineWidth = 1;
    phaseCtx.beginPath();
    const axisY = clamp(mapY(0), py, py + size);
    const axisX = clamp(mapX(0), px, px + size);
    phaseCtx.moveTo(px, axisY);
    phaseCtx.lineTo(px + size, axisY);
    phaseCtx.moveTo(axisX, py);
    phaseCtx.lineTo(axisX, py + size);
    phaseCtx.stroke();

    // 轨迹
    if (points.length > 1) {
      phaseCtx.strokeStyle = C('rgba(168, 84, 31, 0.78)');
      phaseCtx.lineWidth = 1.4;
      phaseCtx.lineJoin = 'round';
      phaseCtx.beginPath();
      points.forEach((point: { x: number; y: number }, index: number) => {
        const sx = mapX(point.x);
        const sy = mapY(point.y);
        if (index === 0) phaseCtx.moveTo(sx, sy);
        else phaseCtx.lineTo(sx, sy);
      });
      phaseCtx.stroke();

      const previous = points[Math.max(0, points.length - 18)];
      const current = points[points.length - 1];
      const angle = Math.atan2(mapY(current.y) - mapY(previous.y), mapX(current.x) - mapX(previous.x));
      const tipX = mapX(current.x);
      const tipY = mapY(current.y);
      phaseCtx.fillStyle = C('#1f5f5b');
      phaseCtx.beginPath();
      phaseCtx.arc(tipX, tipY, 3.2, 0, Math.PI * 2);
      phaseCtx.fill();
      phaseCtx.beginPath();
      phaseCtx.moveTo(tipX, tipY);
      phaseCtx.lineTo(tipX - 11 * Math.cos(angle - 0.42), tipY - 11 * Math.sin(angle - 0.42));
      phaseCtx.lineTo(tipX - 11 * Math.cos(angle + 0.42), tipY - 11 * Math.sin(angle + 0.42));
      phaseCtx.closePath();
      phaseCtx.fill();
    }

    phaseCtx.fillStyle = C('#7b7266');
    phaseCtx.font = '9px "Cascadia Code", Consolas, monospace';
    phaseCtx.textAlign = 'left';
    phaseCtx.textBaseline = 'top';
    phaseCtx.fillText(`${labelX} / ${labelY} · ${node.name}`, px, 3);
    phaseCtx.textAlign = 'right';
    phaseCtx.fillText(`${points.length} pts`, px + size, 3);
    phaseCtx.textAlign = 'left';
    phaseCtx.textBaseline = 'bottom';
    phaseCtx.fillText(fmt(minX, 2), px, py + size + 12);
    phaseCtx.textAlign = 'right';
    phaseCtx.fillText(fmt(maxX, 2), px + size, py + size + 12);
    phaseCtx.textAlign = 'right';
    phaseCtx.textBaseline = 'bottom';
    phaseCtx.fillText(fmt(maxY, 2), px - 5, py + 9);
    phaseCtx.textBaseline = 'top';
    phaseCtx.fillText(fmt(minY, 2), px - 5, py + size - 9);

    const current = points[points.length - 1];
    if (current) {
      const magnitude = Math.hypot(current.x, current.y);
      let pathLength = 0;
      let area = 0;
      for (let index = 1; index < points.length; index += 1) {
        pathLength += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
        area += points[index - 1].x * points[index].y - points[index].x * points[index - 1].y;
      }
      const ys = points.map((point: { x: number; y: number }) => point.y);
      const finalY = current.y;
      const peakY = finalY >= 0 ? Math.max(...ys) : Math.min(...ys);
      const overshoot = Math.abs(finalY) > 1e-12
        ? Math.max(0, (peakY - finalY) / Math.abs(finalY) * 100)
        : 0;
      const band = Math.abs(finalY) * 0.02;
      let lastOutside = -1;
      for (let index = 0; index < points.length; index += 1) {
        if (Math.abs(points[index].y - finalY) > band) lastOutside = index;
      }
      const settling = lastOutside >= 0 && lastOutside + 1 < points.length
        ? Math.max(0, current.t - points[lastOutside].t)
        : 0;
      ui.phaseReadout.textContent =
        `${node.kind}  ${labelX}=${fmt(current.x, 5)}  ${labelY}=${fmt(current.y, 5)}  `
        + `|r|=${fmt(magnitude, 5)}  t=${fmt(current.t, 4)} s  `
        + `L=${fmt(pathLength, 4)}  A=${fmt(Math.abs(area) / 2, 4)}  `
        + `峰值=${fmt(peakY, 5)}  超调=${fmt(overshoot, 2)}%  `
        + `稳态=${fmt(finalY, 5)}  调节=${fmt(settling, 4)} s`;
    }
    syncPhaseControls();
  }

export function phaseFrameCount() {
    return state.frames.length;
  }

export function syncPhaseControls() {
    const total = phaseFrameCount();
    const cursor = state.phaseIndex == null
      ? Math.max(0, total - 1)
      : clamp(Math.round(Number(state.phaseIndex) || 0), 0, Math.max(0, total - 1));
    if (ui.phaseFrame) {
      ui.phaseFrame.max = String(Math.max(0, total - 1));
      ui.phaseFrame.value = String(cursor);
      ui.phaseFrame.disabled = total === 0;
    }
    if (ui.phaseFrameLabel) {
      ui.phaseFrameLabel.textContent = total ? `${cursor + 1}/${total}` : '0/0';
    }
    if (ui.phasePlay) {
      ui.phasePlay.textContent = state.phasePlaying ? '暂停' : '播放';
    }
  }

export function setPhaseIndex(index: number) {
    const total = phaseFrameCount();
    if (!total) return;
    state.phaseIndex = clamp(Math.round(Number(index) || 0), 0, total - 1);
    drawPhase();
  }

export function stopPhasePlay() {
    state.phasePlaying = false;
    if (state.phasePlayTimer) {
      clearInterval(state.phasePlayTimer);
      state.phasePlayTimer = 0;
    }
    syncPhaseControls();
  }

export function togglePhasePlay() {
    if (state.phasePlaying) {
      stopPhasePlay();
      return;
    }
    if (phaseFrameCount() < 2) return;
    state.phasePlaying = true;
    if (state.phaseIndex == null) state.phaseIndex = phaseFrameCount() - 1;
    state.phasePlayTimer = setInterval(() => {
      const total = phaseFrameCount();
      if (!total) {
        stopPhasePlay();
        return;
      }
      let next = (state.phaseIndex == null ? total - 1 : state.phaseIndex) + 1;
      if (next >= total) {
        if (!state.phaseLoop) {
          stopPhasePlay();
          return;
        }
        next = 0;
      }
      state.phaseIndex = next;
      drawPhase();
    }, 90);
    syncPhaseControls();
  }
