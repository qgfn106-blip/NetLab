import test from 'node:test';
import assert from 'node:assert/strict';
import { probeNamesForAc } from '../app/ac_probe.js';

test('AC 默认探针只取信号节点', () => {
  const names = probeNamesForAc([
    { kind: 'node', name: 'out' },
    { kind: 'node', name: 'mid' },
    { kind: 'ground', name: 'gnd' },
    { kind: 'resistor', name: 'r1' },
  ]);
  assert.deepEqual(names, ['out', 'mid']);
});

test('ground 与空名不会进入 AC probes', () => {
  const names = probeNamesForAc([
    { kind: 'ground', name: 'gnd' },
    { kind: 'node', name: '' },
    { kind: 'node' },
  ]);
  assert.deepEqual(names, []);
});

test('空场景返回空数组', () => {
  assert.deepEqual(probeNamesForAc([]), []);
});
