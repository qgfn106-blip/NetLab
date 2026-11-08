// 统一前端构建入口：自动收集 app/*.ts，避免每轮改 package.json。
import { build } from 'esbuild';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const appDir = path.join(root, 'app');
const appEntries = readdirSync(appDir)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts'))
  .sort()
  .map((name) => `app/${name}`);

const entries = ['app.ts', 'app.utils.ts', 'theme.tokens.ts', ...appEntries];

await build({
  entryPoints: entries,
  outdir: root,
  format: 'esm',
  target: 'es2020',
  logLevel: 'warning',
});

await build({
  entryPoints: ['desktop-shim.ts'],
  outfile: path.join(root, 'desktop-shim.js'),
  format: 'iife',
  target: 'es2020',
  logLevel: 'warning',
});
