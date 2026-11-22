import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loopThumbnailSvg, loopListHtml, controlledBreakForGroup, loopSelectionPayload,
} from '../app/analysis_workbench_loops.js';

const group = {
  loop_id: 'loop-1',
  label: '候选 1',
  member_node_ids: ['n1', 'n2', 'n3'],
  member_node_names: ['out', 'n', 'gnd'],
  member_edge_ids: ['e1', 'e2', 'e3'],
  member_edge_names: ['E1', 'R1', 'R2'],
  candidate_breaks: [{ break_id: 'R2', name: 'R2', kind: 'circuit_branch', suggested: true }],
  suggested_break_id: 'R2',
  feedback_sign: -1,
};

test('缩略图画出成员节点与闭合边', () => {
  const svg = loopThumbnailSvg(group);
  assert.match(svg, /<svg/);
  assert.match(svg, /out/);
  assert.match(svg, /gnd/);
  assert.match(svg, /R2/);
  assert.equal((svg.match(/<line /g) || []).length, 3);
});

test('环路列表带可选中的 data-loop-id 与建议断点', () => {
  const html = loopListHtml([group], 'loop-1', []);
  assert.match(html, /data-loop-id="loop-1"/);
  assert.match(html, /awb-loop-card selected/);
  assert.match(html, /建议断点 R2/);
});

test('无信号流环时回退到候选断点按钮', () => {
  const html = loopListHtml([], '', [{ element: 'E1', kind: 'vcvs' }]);
  assert.match(html, /data-loop-break="E1"/);
});

test('受控源成员可映射到现有断环元件', () => {
  assert.equal(controlledBreakForGroup(group, [{ element: 'E1', kind: 'vcvs' }]), 'E1');
  assert.equal(controlledBreakForGroup(group, [{ element: 'X9', kind: 'vcvs' }]), '');
});

test('选中环路载荷携带成员 id 与反馈符号', () => {
  const payload = loopSelectionPayload(group);
  assert.deepEqual(payload.member_node_ids, ['n1', 'n2', 'n3']);
  assert.equal(payload.break_id, 'R2');
  assert.equal(payload.feedback_sign, -1);
});
