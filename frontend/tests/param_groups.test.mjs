import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fallbackParams } from '../app/param_groups.js';

test('fallbackParams 用 ParamSpec 类型名，数字必须生成 float 而不是 number', () => {
  const params = fallbackParams({ R: 50000, enable: true, label: 'x' });
  const byKey = Object.fromEntries(params.map((item) => [item.key, item.type]));
  assert.equal(byKey.R, 'float');
  assert.equal(byKey.enable, 'bool');
  assert.equal(byKey.label, 'text');
});

test('fallbackParams 空参数返回空数组', () => {
  assert.deepEqual(fallbackParams(), []);
  assert.deepEqual(fallbackParams({}), []);
});
