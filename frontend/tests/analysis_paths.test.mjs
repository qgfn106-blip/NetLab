import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisQuery } from '../app/analysis_paths.js';

test('analysisQuery 无查询参数返回原 path', () => {
  assert.equal(analysisQuery('/api/analysis/math'), '/api/analysis/math');
  assert.equal(analysisQuery('/api/analysis/math', {}), '/api/analysis/math');
});

test('analysisQuery 拼接并编码查询参数', () => {
  assert.equal(analysisQuery('/api/analysis/metrics', { keys: 'a' }), '/api/analysis/metrics?keys=a');
  assert.equal(
    analysisQuery('/api/analysis/metrics', { keys: 'a b', x: '1&2' }),
    '/api/analysis/metrics?keys=a+b&x=1%262',
  );
});
