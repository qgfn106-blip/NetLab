import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { paddedRange, logSafeRange, overridesFromView } from '../app/analysis_chart_model.js';
import { nearestMarker, nearestCurve, boxSelectionRange } from '../app/analysis_chart_interaction.js';
import { AnalysisChart } from '../app/analysis_chart.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function fakeAxis(slot = 0) {
  return {
    slot,
    sx: { to: (x) => 100 + x * 10, from: (px) => (px - 100) / 10 },
    sy: { to: (y) => 200 - y * 10, from: (py) => (200 - py) / 10 },
  };
}

function envelope() {
  return {
    kind: 'bode',
    axes: [{ id: 'f', scale: 'log10' }, { id: 'phase_deg', scale: 'linear' }],
    curves: [
      { id: 'c', label: 'c', axes: ['f', 'phase_deg'], x: [1, 2, 3], y: [0, 1, 2] },
    ],
    markers: [
      { category: 'stability', axis_y: 'phase_deg', x: 2, y: 1, label: 'm', kind: 'pole' },
    ],
    warnings: [],
  };
}

test('模型层区间函数稳定', () => {
  assert.deepEqual(logSafeRange(-1, 0), [1, 10]);
  const [lo, hi] = paddedRange(1, 2, 0.1);
  assert.ok(lo < 1 && hi > 2);
  const out = overridesFromView({ xlim: [1, 2], ylims: { 0: [3, 4] } });
  assert.deepEqual(out[0], { xlim: [1, 2], ylim: [3, 4] });
  assert.deepEqual(overridesFromView(null), {});
});

test('交互层命中标记与最近曲线', () => {
  const env = envelope();
  const axis = fakeAxis(1);
  const hit = nearestMarker(env, axis, new Set(['stability']), 120, 190);
  assert.equal(hit?.label, 'm');
  assert.equal(nearestMarker(env, axis, new Set(), 120, 190), null);
  const curve = nearestCurve(env, axis, 131);
  assert.equal(curve?.curve.id, 'c');
  assert.equal(curve?.index, 2);
});

test('交互层框选区间与最小拖拽阈值', () => {
  const axis = fakeAxis();
  assert.equal(boxSelectionRange(axis, 100, 100, 102, 102), null);
  const range = boxSelectionRange(axis, 100, 200, 140, 160);
  assert.ok(range && range.xlim[0] <= range.xlim[1] && range.ylim[0] <= range.ylim[1]);
});

test('facade 公共方法保持', () => {
  for (const name of ['setEnvelope', 'getEnvelope', 'setAppearance', 'setDetailHost', 'refreshDetail', 'setCursorFrequency', 'resetView', 'destroy']) {
    assert.equal(typeof AnalysisChart.prototype[name], 'function', name);
  }
});

test('四层结构守卫通过', () => {
  const res = spawnSync(process.execPath, [path.join(here, '..', 'tools', 'check_analysis_layers.mjs')], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stdout + res.stderr);
});
