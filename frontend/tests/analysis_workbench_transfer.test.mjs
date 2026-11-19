import test from 'node:test';
import assert from 'node:assert/strict';
import { transferSummaryHtml } from '../app/analysis_workbench_results.js';

const open = { supported: true, expression: '(9.999) / (1)', order: 1, relative_order: 1 };
const closed = { supported: true, expression: '(9.999) / (10.999)', order: 1, relative_order: 1 };

test('虚拟环路同时显示开环 G(s) 与闭环 T(s)', () => {
  const html = transferSummaryHtml({
    transfer_role: 'open_loop',
    transfer_function: open,
    closed_loop_transfer_function: closed,
  });
  assert.match(html, /data-awb="transfer"/);
  assert.match(html, /开环 G\(s\)/);
  assert.match(html, /闭环 T\(s\)/);
  assert.match(html, /\(9\.999\) \/ \(10\.999\)/);
  assert.match(html, /阶数 1 · 相对阶 1/);
});

test('实体断环只把实际闭环 T(s) 作为主传函', () => {
  const html = transferSummaryHtml({ transfer_role: 'closed_loop', transfer_function: open });
  assert.match(html, /闭环 T\(s\)/);
  assert.doesNotMatch(html, /开环 G\(s\)/);
});

test('缺失或不可支持的传函不渲染空壳', () => {
  assert.equal(transferSummaryHtml(undefined), '');
  assert.equal(transferSummaryHtml({ transfer_function: { supported: false } }), '');
});
