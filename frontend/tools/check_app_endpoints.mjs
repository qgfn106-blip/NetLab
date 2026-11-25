// P3-06：app.ts 的 /api 端点契约快照校验。
// 目的：P1-02/P3-06 把 app.ts 拆分为 router/store/views/commands/handlers 时，
// 任何 endpoint 路径的增删改都会被此测试拦截（请求/响应语义不在本文件范围）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(here, '../app.ts');
const SNAPSHOT = path.resolve(here, 'app_endpoint_snapshot.json');
const EXTRA_SOURCES = [
  path.resolve(here, '../app/analysis_workbench_panel.ts'),
  path.resolve(here, '../app/analysis_workbench_chart.ts'),
  path.resolve(here, '../app/scene_panel.ts'),
  path.resolve(here, '../app/scene_actions.ts'),
  path.resolve(here, '../app/analysis_replay.ts'),
  path.resolve(here, '../app/signal_list.ts'),
];

export function readAppSources() {
  return [APP, ...EXTRA_SOURCES].map((p) => fs.readFileSync(p, 'utf8')).join('\n');
}

export function extractEndpoints(source) {
  // 先把模板表达式统一替换成占位符，避免其中空白/引号截断正则。
  const normalised = source.replace(/\$\{[^}]*\}/g, ':param');
  const re = /\/api\/[A-Za-z0-9_\-/:.]*/g;
  const found = new Set();
  let m;
  while ((m = re.exec(normalised))) {
    let p = m[0].replace(/[.:]+$/, '');
    if (p.endsWith('/')) p = p.slice(0, -1);
    found.add(p);
  }
  return [...found].sort();
}

export function loadSnapshot() {
  return JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
}

export function diffEndpoints(actual, expected) {
  const a = new Set(actual), e = new Set(expected);
  return {
    missing: [...e].filter((p) => !a.has(p)).sort(),
    added: [...a].filter((p) => !e.has(p)).sort(),
  };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const actual = extractEndpoints(readAppSources());
  if (process.argv.includes('--write')) {
    fs.writeFileSync(SNAPSHOT, JSON.stringify({ version: 1, source: 'frontend/app.ts', note: 'P3-06/P1-02 前端 endpoint 契约快照；app.ts 拆分时必须保持不变', paths: actual }, null, 2) + '\n');
    console.log('WROTE: ' + actual.length + ' endpoints');
  } else {
    const snap = loadSnapshot();
    const d = diffEndpoints(actual, snap.paths);
    if (d.missing.length || d.added.length) {
      console.error('FAIL: app.ts endpoint snapshot drift');
      if (d.missing.length) console.error('  missing: ' + d.missing.join(', '));
      if (d.added.length) console.error('  added: ' + d.added.join(', '));
      process.exit(1);
    }
    console.log('OK: app.ts endpoint contract passed (' + actual.length + ' paths)');
  }
}
