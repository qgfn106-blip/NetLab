import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basenames, diffUncovered, wholeFileHash } from '../tools/parity_uncovered.js';

test('basenames handles posix and windows paths', () => {
  assert.deepEqual(basenames(['/a/b/app.ts', 'C:\\x\\desktop-shim.ts']), ['app.ts', 'desktop-shim.ts']);
});

test('exact match passes', () => {
  const r = diffUncovered(['app.ts', 'desktop-shim.ts'], ['app.ts', 'desktop-shim.ts']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.extra, []);
  assert.deepEqual(r.absent, []);
});

test('removing an allowlist entry (aka new uncovered) FAILS as extra', () => {
  const r = diffUncovered(['app.ts', 'desktop-shim.ts', 'iife_widget.ts'], ['app.ts', 'desktop-shim.ts']);
  assert.equal(r.ok, false);
  assert.deepEqual(r.extra, ['iife_widget.ts']);
});

test('allowlisting a non-uncovered file FAILS as absent (stale entry)', () => {
  const r = diffUncovered(['app.ts', 'desktop-shim.ts'], ['app.ts', 'desktop-shim.ts', 'ghost.ts']);
  assert.equal(r.ok, false);
  assert.deepEqual(r.absent, ['ghost.ts']);
});

test('wholeFileHash stable and sensitive', () => {
  assert.equal(wholeFileHash('abc'), wholeFileHash('abc'));
  assert.notEqual(wholeFileHash('abc'), wholeFileHash('abd'));
});
