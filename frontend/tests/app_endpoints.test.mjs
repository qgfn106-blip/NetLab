import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractEndpoints, loadSnapshot, diffEndpoints } from '../tools/check_app_endpoints.mjs';

const source = fs.readFileSync(new URL('../app.ts', import.meta.url), 'utf8');

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
