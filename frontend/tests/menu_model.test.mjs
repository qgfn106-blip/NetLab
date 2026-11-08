import test from 'node:test';
import assert from 'node:assert/strict';

const { computeGroupOrder, groupNodeSpecs } = await import('../app/menu_model.js');

test('矢量模式把「矢量」提到最前，其余保持基础顺序', () => {
  assert.deepEqual(computeGroupOrder('vector'), ['矢量', '基础', '动态', '高级', '模块', '接口']);
  assert.deepEqual(computeGroupOrder('signal'), ['基础', '动态', '高级', '矢量', '模块', '接口']);
});

test('分组按 catalog 顺序输出，未列出的组补在后面', () => {
  const specs = [
    { kind: 'a', label: 'A', group: '高级' },
    { kind: 'b', label: 'B', group: '基础' },
    { kind: 'c', label: 'C', group: '自定义' },
  ];
  const groups = groupNodeSpecs(specs, 'signal');
  assert.deepEqual(groups.map((g) => g.group), ['基础', '高级', '自定义']);
  assert.deepEqual(groups[0].specs.map((s) => s.kind), ['b']);
});

test('addable=false 的模块实例/端口节点不进入菜单', () => {
  const specs = [
    { kind: 'block', label: 'Block', group: '模块', addable: false },
    { kind: 'port', label: 'Port', group: '接口', addable: false },
    { kind: 'gain', label: 'Gain', group: '基础' },
  ];
  const groups = groupNodeSpecs(specs, 'signal');
  assert.deepEqual(groups.map((g) => g.group), ['基础']);
  assert.deepEqual(groups[0].specs.map((s) => s.kind), ['gain']);
});
