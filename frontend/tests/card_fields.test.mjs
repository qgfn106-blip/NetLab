// R40 阶段 3：节点卡片字段纯函数单测（导入 build 产物）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARD_FIELDS,
  CARD_FIELD_LABELS,
  DEFAULT_CARD_FIELDS,
  normalizeCardFields,
  cardFieldOffsets,
  isDefaultCardFields,
} from '../app/card_fields.js';

test('字段白名单与标签完整', () => {
  assert.deepEqual([...CARD_FIELDS], ['kind', 'name', 'value', 'id']);
  assert.deepEqual([...DEFAULT_CARD_FIELDS], ['kind', 'name', 'value']);
  for (const id of CARD_FIELDS) assert.ok(CARD_FIELD_LABELS[id], `缺少标签: ${id}`);
});

test('非数组回退默认，保证旧工程视觉不变', () => {
  for (const value of [undefined, null, 'kind', 42, {}, false]) {
    assert.deepEqual(normalizeCardFields(value), ['kind', 'name', 'value']);
  }
  assert.deepEqual(normalizeCardFields([]), []);
});

test('白名单过滤 + 去重 + 保序', () => {
  assert.deepEqual(normalizeCardFields(['value', 'name', 'value', 'bad', 3, null]), ['value', 'name']);
  assert.deepEqual(normalizeCardFields(['id', 'kind', 'name', 'value']), ['id', 'kind', 'name', 'value']);
});

test('cardFieldOffsets 默认三项沿用旧版像素位置', () => {
  assert.deepEqual(cardFieldOffsets(3), [-0.56, -0.06, 0.38]);
  assert.deepEqual(cardFieldOffsets(1), [-0.06]);
  assert.deepEqual(cardFieldOffsets(0), []);
  for (const count of [2, 4, 5, 6]) {
    const offsets = cardFieldOffsets(count);
    assert.equal(offsets.length, count);
    assert.ok(Math.abs(offsets[0] - (-0.56)) < 1e-9);
    assert.ok(Math.abs(offsets[count - 1] - 0.38) < 1e-9);
    for (let i = 1; i < count; i += 1) assert.ok(offsets[i] > offsets[i - 1]);
  }
});

test('isDefaultCardFields 仅识别默认顺序', () => {
  assert.equal(isDefaultCardFields(['kind', 'name', 'value']), true);
  assert.equal(isDefaultCardFields(['value', 'name', 'kind']), false);
  assert.equal(isDefaultCardFields(['kind', 'name']), false);
  assert.equal(isDefaultCardFields([]), false);
});
