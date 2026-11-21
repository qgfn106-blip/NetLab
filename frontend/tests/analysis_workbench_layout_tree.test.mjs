import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendCanvas,
  collectCanvasIds,
  emptyLayout,
  layoutPresetOf,
  mergeCanvasIntoTabs,
  normalizeLayout,
  removeCanvasFromLayout,
  removeLeaf,
  rootForCanvasIds,
  splitCanvasInLayout,
} from '../app/analysis_workbench_layout_tree.js';

function layoutOf(ids, preset = 'row') {
  const root = rootForCanvasIds(ids, preset);
  return { tabs: root ? [{ id: 't1', title: '主视图', root }] : [], activeTab: root ? 't1' : '' };
}

test('rootForCanvasIds 生成平衡 split 且保留全部画布', () => {
  const root = rootForCanvasIds(['a', 'b', 'c', 'd'], 'row');
  assert.equal(root.type, 'split');
  assert.equal(root.axis, 'row');
  assert.equal(root.ratio, 0.5);
  assert.deepEqual(collectCanvasIds(root), ['a', 'b', 'c', 'd']);
  assert.equal(layoutPresetOf(root), 'row');
});

test('normalizeLayout 修正非法比例并过滤未知画布', () => {
  const normalized = normalizeLayout({
    tabs: [{
      id: 't',
      title: 'T',
      root: {
        type: 'split',
        axis: 'row',
        ratio: 5,
        first: { type: 'canvas', canvasId: 'a' },
        second: { type: 'canvas', canvasId: 'b' },
      },
    }],
  }, ['a', 'b'], false);
  assert.equal(normalized.tabs[0].root.type, 'split');
  assert.equal(normalized.tabs[0].root.ratio, 0.85);

  const filtered = normalizeLayout({
    tabs: [{ id: 't', title: 'T', root: { type: 'canvas', canvasId: 'ghost' } }],
  }, ['a'], false);
  assert.deepEqual(collectCanvasIds(filtered.tabs[0].root), ['a']);
});

test('空布局与未知画布不会产生空壳', () => {
  assert.deepEqual(normalizeLayout(emptyLayout(), [], false), emptyLayout());
  const normalized = normalizeLayout({
    tabs: [{ id: 't', title: 'T', root: { type: 'canvas', canvasId: 'ghost' } }],
  }, [], false);
  assert.deepEqual(normalized, emptyLayout());
});

test('removeLeaf 删除一侧后由兄弟节点填满', () => {
  const root = rootForCanvasIds(['a', 'b'], 'column');
  const next = removeLeaf(root, 'a');
  assert.ok(next);
  assert.deepEqual(collectCanvasIds(next), ['b']);
  assert.equal(next.type, 'canvas');
});

test('removeCanvasFromLayout 删除标签页内画布并修正 active', () => {
  const layout = {
    tabs: [{
      id: 't1',
      title: '主视图',
      root: {
        type: 'tabs',
        active: 'a',
        children: [
          { type: 'canvas', canvasId: 'a' },
          { type: 'canvas', canvasId: 'b' },
          { type: 'canvas', canvasId: 'c' },
        ],
      },
    }],
    activeTab: 't1',
  };
  const next = removeCanvasFromLayout(layout, 'b');
  assert.deepEqual(collectCanvasIds(next.tabs[0].root), ['a', 'c']);
  assert.equal(next.tabs[0].root.active, 'a');
});

test('mergeCanvasIntoTabs 将目标叶子升级为标签页组', () => {
  const layout = {
    tabs: [
      { id: 't1', title: '视图一', root: { type: 'canvas', canvasId: 'a' } },
      { id: 't2', title: '视图二', root: { type: 'canvas', canvasId: 'b' } },
    ],
    activeTab: 't2',
  };
  const next = mergeCanvasIntoTabs(layout, 'a', 'b');
  assert.equal(next.tabs.length, 1);
  assert.equal(next.tabs[0].root.type, 'tabs');
  assert.deepEqual(collectCanvasIds(next.tabs[0].root), ['a', 'b']);
  assert.equal(next.tabs[0].root.active, 'b');
});

test('splitCanvasInLayout 在标签页成员上分割也不丢失画布', () => {
  const layout = {
    tabs: [{
      id: 't1',
      title: '主视图',
      root: {
        type: 'tabs',
        active: 'a',
        children: [
          { type: 'canvas', canvasId: 'a' },
          { type: 'canvas', canvasId: 'b' },
        ],
      },
    }],
    activeTab: 't1',
  };
  const next = splitCanvasInLayout(layout, 'a', 'c', 'row', 'after');
  assert.equal(next.tabs[0].root.type, 'split');
  assert.deepEqual(collectCanvasIds(next.tabs[0].root).sort(), ['a', 'b', 'c']);
});

test('appendCanvas 与 rootForCanvasIds(tabs) 保持完整集合', () => {
  const layout = layoutOf(['a'], 'auto');
  const next = appendCanvas(layout, 'b');
  assert.deepEqual(collectCanvasIds(next.tabs[0].root), ['a', 'b']);

  const tabbed = rootForCanvasIds(['a', 'b', 'c'], 'tabs');
  assert.equal(tabbed.type, 'tabs');
  assert.deepEqual(collectCanvasIds(tabbed), ['a', 'b', 'c']);
  assert.equal(layoutPresetOf(tabbed), 'tabs');
});
