import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CHART_APPEARANCE,
  chartAppearanceIsDefault,
  normalizeChartAppearance,
} from '../app/analysis_chart_appearance.js';

test('缺省外观与默认值一致', () => {
  assert.deepEqual(normalizeChartAppearance(undefined), DEFAULT_CHART_APPEARANCE);
  assert.equal(chartAppearanceIsDefault(DEFAULT_CHART_APPEARANCE), true);
});

test('外观字段做类型与范围收敛，未知曲线标签被保留', () => {
  const appearance = normalizeChartAppearance({
    title: ' 阶跃响应 ',
    xscale: 'log',
    yscale: 'bad',
    panel_layout: 'row',
    grid: false,
    grid_width: 99,
    grid_opacity: 0,
    grid_style: 'dashed',
    legend: true,
    curve_labels: { curve_a: '幅值', empty: '', bad: 3 },
  });
  assert.equal(appearance.title, ' 阶跃响应 ');
  assert.equal(appearance.xscale, 'log');
  assert.equal(appearance.yscale, 'auto');
  assert.equal(appearance.panel_layout, 'row');
  assert.equal(appearance.grid, false);
  assert.equal(appearance.grid_width, 4);
  assert.equal(appearance.grid_opacity, 0.05);
  assert.equal(appearance.grid_style, 'dashed');
  assert.equal(appearance.legend, true);
  assert.deepEqual(appearance.curve_labels, { curve_a: '幅值' });
  assert.equal(chartAppearanceIsDefault(appearance), false);
});

test('非默认外观可稳定往返', () => {
  const input = { title: 'T', xlabel: '频率', ylabel: '增益', ylabel2: '相位', xscale: 'auto', yscale: 'log', panel_layout: 'column', grid: true, grid_x: false, grid_y: true, grid_color: '#123456', grid_width: 1.5, grid_style: 'dotted', grid_opacity: 0.4, legend: true, curve_labels: { c: 'L' } };
  assert.deepEqual(normalizeChartAppearance(normalizeChartAppearance(input)), normalizeChartAppearance(input));
});
