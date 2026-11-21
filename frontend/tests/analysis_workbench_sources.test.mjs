import test from 'node:test';
import assert from 'node:assert/strict';
import { electricalCircuitNodes, independentCircuitSources, loopFeedbackOutput } from '../app/analysis_workbench_meta.js';

test('工程 v8：device 节点里的 vsource/isource 被识别为独立源', () => {
  const nodes = [
    { name: 'gnd', kind: 'ground', params: {} },
    { name: 'n1', kind: 'node', params: {} },
    { name: 'vsource1', kind: 'device', params: { element: 'vsource' } },
    { name: 'isource1', kind: 'device', params: { element: 'isource' } },
    { name: 'resistor1', kind: 'device', params: { element: 'resistor' } },
  ];
  assert.deepEqual(independentCircuitSources(nodes, []), [
    { name: 'vsource1', kind: 'vsource' },
    { name: 'isource1', kind: 'isource' },
  ]);
});

test('legacy /api/scene：edges 里的 vsource 仍被识别，且不重复', () => {
  const nodes = [{ name: 'V1', kind: 'device', params: { element: 'vsource' } }];
  const edges = [
    { name: 'V1', kind: 'vsource' },
    { name: 'I1', kind: 'isource' },
    { name: 'R1', kind: 'resistor' },
  ];
  assert.deepEqual(independentCircuitSources(nodes, edges), [
    { name: 'V1', kind: 'vsource' },
    { name: 'I1', kind: 'isource' },
  ]);
});

test('断环闭环输出自动改到受控源反馈节点', () => {
  const candidates = [{ element: 'BRK', kind: 'vcvs', control_a: 'n4_copy', output_a: 'n5' }];
  assert.equal(loopFeedbackOutput(candidates, 'BRK', 'n9'), 'n4_copy');
  assert.equal(loopFeedbackOutput(candidates, 'BRK', 'n5'), 'n5');
  assert.equal(loopFeedbackOutput([], '__virtual__', 'n9'), 'n9');
});

test('输出只暴露电气节点，不把 device/ground 当输出节点', () => {
  const nodes = [
    { name: 'gnd', kind: 'ground' },
    { name: 'vin', kind: 'node' },
    { name: 'out', kind: 'node' },
    { name: 'opamp1', kind: 'device' },
  ];
  assert.deepEqual(electricalCircuitNodes(nodes).map((node) => node.name), ['vin', 'out']);
});
