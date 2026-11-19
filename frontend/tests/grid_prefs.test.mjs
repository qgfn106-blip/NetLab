import test from 'node:test';
import assert from 'node:assert/strict';

const {
  ALLOWED_ANGLES,
  applyGridPayload,
  gridPrefsFromUi,
  gridPrefsPayload,
  normaliseAngleSet,
  snapToGrid,
} = await import('../app/grid_prefs.js');

test('normaliseAngleSet 只保留允许角度并始终含 0', () => {
  assert.deepEqual(ALLOWED_ANGLES, [0, 45, 60, 90]);
  assert.deepEqual(normaliseAngleSet([60, 60, 12, 45]), [0, 45, 60]);
  assert.deepEqual(normaliseAngleSet('bad'), [0, 45, 60, 90]);
  assert.deepEqual(normaliseAngleSet([]), [0]);
});

test('gridPrefsFromUi 读取嵌套 ui.grid 与旧扁平字段', () => {
  const nested = gridPrefsFromUi({
    grid: {
      spacing: 32,
      subdivisions: 8,
      show: false,
      snap: false,
      markers: false,
      angle_mode: 'free',
      angle_set: [90, 45],
      angle_tolerance_deg: 6,
      show_origin: false,
      show_ruler: true,
      adaptive_zoom: false,
    },
  });
  assert.equal(nested.spacing, 32);
  assert.equal(nested.subdivisions, 8);
  assert.equal(nested.show, false);
  assert.equal(nested.snap, false);
  assert.equal(nested.markers, false);
  assert.equal(nested.angleMode, 'free');
  assert.deepEqual(nested.angleSet, [0, 45, 90]);
  assert.equal(nested.angleToleranceDeg, 6);
  assert.equal(nested.showOrigin, false);
  assert.equal(nested.showRuler, true);
  assert.equal(nested.adaptiveZoom, false);
  const legacy = gridPrefsFromUi({ grid: 20, snap: true, showGrid: false });
  assert.equal(legacy.spacing, 20);
  assert.equal(legacy.show, false);
  assert.equal(legacy.snap, true);
});

test('gridPrefsPayload 与 applyGridPayload 往返保持字段', () => {
  const ui = { grid: 24, gridSubdivisions: 4, showGrid: true, snap: true, snapMarkers: false, angleMode: 'constrained', angleSet: [0, 60], angleToleranceDeg: 2.5, showOrigin: true, showRuler: false, adaptiveZoom: true };
  const payload = gridPrefsPayload(ui);
  assert.equal(payload.spacing, 24);
  assert.equal(payload.subdivisions, 4);
  assert.deepEqual(payload.angle_set, [0, 60]);
  const target = {};
  applyGridPayload(target, payload);
  assert.equal(target.grid, 24);
  assert.equal(target.gridSubdivisions, 4);
  assert.equal(target.angleMode, 'constrained');
  assert.deepEqual(target.angleSet, [0, 60]);
  assert.equal(target.angleToleranceDeg, 2.5);
});

test('snapToGrid 按间距与细分对齐', () => {
  const prefs = gridPrefsFromUi({ grid: { spacing: 20, subdivisions: 4 } });
  assert.equal(snapToGrid(13, prefs), 15);
  assert.equal(snapToGrid(-7, prefs), -5);
});
