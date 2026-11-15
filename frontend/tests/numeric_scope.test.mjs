import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPolynomial, resolveProjectNumeric } from '../app/numeric_scope.js';

test('formatPolynomial 按显示位数输出（3 vs 8 不同）', () => {
  const c = [1.23456789, 1];
  const a = formatPolynomial(c, 3);
  const b = formatPolynomial(c, 8);
  assert.notEqual(a, b);
  assert.ok(a.startsWith('1.23s'), a);
  assert.ok(b.includes('1.2345679'), b);
});

test('formatPolynomial 复数/非有限系数回退空串', () => {
  assert.equal(formatPolynomial([[1, 2], 1], 6), '');
  assert.equal(formatPolynomial('x', 6), '');
});

test('resolveProjectNumeric 旧工程回退 exact/6、按工程取值、越界夹取', () => {
  assert.deepEqual(resolveProjectNumeric({}), { numericPrecision: 'exact', numericDigits: 6 });
  assert.deepEqual(resolveProjectNumeric(undefined), { numericPrecision: 'exact', numericDigits: 6 });
  assert.deepEqual(resolveProjectNumeric({ numericPrecision: 'standard', numericDigits: 8 }), { numericPrecision: 'standard', numericDigits: 8 });
  assert.deepEqual(resolveProjectNumeric({ numericDigits: 99 }), { numericPrecision: 'exact', numericDigits: 17 });
});

test('两个工程各自一套、互不影响', () => {
  const a = resolveProjectNumeric({ numericPrecision: 'standard', numericDigits: 4 });
  const b = resolveProjectNumeric({ numericPrecision: 'exact', numericDigits: 9 });
  assert.notDeepEqual(a, b);
});
