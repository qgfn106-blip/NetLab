import test from 'node:test';
import assert from 'node:assert/strict';
import { extractEndpoints, loadSnapshot, diffEndpoints, readAppSources } from '../tools/check_app_endpoints.mjs';

const source = readAppSources();

test('app.ts endpoint set matches committed snapshot', () => {
  const actual = extractEndpoints(source);
  const snapshot = loadSnapshot();
  const d = diffEndpoints(actual, snapshot.paths);
  assert.deepEqual(d, { missing: [], added: [] });
});

test('every endpoint is rooted at /api/ and has no template residue', () => {
  for (const p of extractEndpoints(source)) {
    assert.ok(p.startsWith('/api/'), p + ' 应以 /api/ 开头');
    assert.ok(!p.includes('$'), p + ' 不应含模板残留');
    assert.ok(!p.includes('?'), p + ' 快照不应含查询串');
  }
});
