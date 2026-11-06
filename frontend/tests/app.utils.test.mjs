import test from 'node:test';
import assert from 'node:assert/strict';
import { fmt, intText, clamp, hashString, baseName } from '../app.utils.js';

test('fmt 常规与科学计数与非法值', () => {
  assert.equal(fmt(3.14159), '3.1416');
  assert.equal(fmt(0.00001), '1.000e-5');
  assert.equal(fmt(123456), '1.235e+5');
  assert.equal(fmt(-0), '0');
  assert.equal(fmt(NaN), '—');
  assert.equal(fmt('12.5'), '12.5');
});

test('intText 取整与非法值', () => {
  assert.equal(intText(3.6), '4');
  assert.equal(intText('7.2'), '7');
  assert.equal(intText('abc'), '0');
});

test('clamp 边界', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(99, 0, 10), 10);
});

test('hashString 稳定且无符号', () => {
  assert.equal(hashString(''), 2166136261);
  assert.equal(hashString('abc'), hashString('abc'));
  assert.ok(hashString('abc') >= 0 && hashString('abc') <= 0xffffffff);
});

test('baseName 跨平台路径', () => {
  assert.equal(baseName('/a/b/c.txt'), 'c.txt');
  assert.equal(baseName('C:\\x\\y.json'), 'y.json');
  assert.equal(baseName('plain'), 'plain');
  assert.equal(baseName('dir/'), 'dir');
});
