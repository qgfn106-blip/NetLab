// C-3 / N-14：老 canvas 与 PlotKit 共用同一帧→绘图语义。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PLOT_SEMANTICS, frameSeriesToPoints, plotLineStyle, buildPlotLineLayers } from '../app/plot_semantics.js';

test('frameSeriesToPoints 截断到共同长度并保持坐标顺序', () => {
  const pts = frameSeriesToPoints([0, 0.1, 0.2], [1, 2]);
  assert.deepEqual(pts.x, [0, 0.1]);
  assert.deepEqual(pts.y, [1, 2]);
  const capped = frameSeriesToPoints([0, 1, 2], [9, 8, 7], 2);
  assert.deepEqual(capped.x, [0, 1]);
  assert.deepEqual(capped.y, [9, 8]);
});

test('PlotKit 图层与老 canvas 共用时间字段与线宽', () => {
  const layers = buildPlotLineLayers(['a'], { a: [1, 2, 3] }, () => '#123456');
  assert.equal(layers.length, 1);
  assert.deepEqual(layers[0].data, { x: PLOT_SEMANTICS.timeField, y: 'a' });
  assert.equal(layers[0].style.width, PLOT_SEMANTICS.lineWidth);
  assert.equal(layers[0].style.color, '#123456');
  assert.equal(plotLineStyle().width, PLOT_SEMANTICS.lineWidth);
});

test('语义常量来自 canonical 值', () => {
  assert.equal(PLOT_SEMANTICS.timeField, 't');
  assert.equal(PLOT_SEMANTICS.lineWidth, 1.6);
  assert.equal(PLOT_SEMANTICS.maxPoints, 20000);
  assert.equal(PLOT_SEMANTICS.downsample, 'minmax');
});
