// TS 搬运轮等价检查：对比 HEAD 与工作树的顶层声明，确认无符号丢失、无重复定义、
// 且每个 app/*.ts 都有对应 app/*.js 构建产物。用法：node tools/verify_app_parity.js [base]
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const base = process.argv[2] || 'HEAD';
const frontendDir = path.resolve(import.meta.dirname, '..');
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: frontendDir, encoding: 'utf8' }).trim();
const relFrontend = path.relative(repoRoot, frontendDir).replaceAll('\\', '/');

function collect(fileName, text) {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
  const names = [];
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) {
      if (stmt.name?.text) names.push(stmt.name.text);
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) names.push(decl.name.text);
      }
    }
  }
  return names;
}

const baselineFiles = execFileSync('git', ['ls-tree', '-r', '--name-only', base, '--', `${relFrontend}`], { cwd: repoRoot, encoding: 'utf8' })
  .split(/\r?\n/)
  .filter((p) => p.endsWith('.ts') && !p.endsWith('.d.ts'))
  .filter((p) => p.startsWith(`${relFrontend}/`));

const currentFiles = [];
(function walk(dir) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (name.name === 'node_modules' || name.name === '.git' || name.name === 'dist') continue;
    const full = path.join(dir, name.name);
    if (name.isDirectory()) walk(full);
    else if (name.name.endsWith('.ts') && !name.name.endsWith('.d.ts')) currentFiles.push(full);
  }
})(frontendDir);
currentFiles.push(path.join(frontendDir, 'desktop-shim.ts'));

const baseNames = new Map();
for (const rel of baselineFiles) {
  const text = execFileSync('git', ['show', `${base}:${rel}`], { cwd: repoRoot, encoding: 'utf8' });
  for (const name of collect(rel, text)) {
    if (!baseNames.has(name)) baseNames.set(name, []);
    baseNames.get(name).push(rel);
  }
}

const currentNames = new Map();
for (const full of currentFiles) {
  if (!existsSync(full)) continue;
  const rel = path.relative(repoRoot, full).replaceAll('\\', '/');
  const text = readFileSync(full, 'utf8');
  for (const name of collect(rel, text)) {
    if (!currentNames.has(name)) currentNames.set(name, []);
    currentNames.get(name).push(rel);
  }
}

const missing = [...baseNames.keys()].filter((name) => !currentNames.has(name));
const duplicates = [...currentNames.entries()]
  .filter(([, files]) => new Set(files).size > 1)
  .map(([name, files]) => `${name}: ${[...new Set(files)].join(', ')}`);

const appTs = readdirSync(path.join(frontendDir, 'app')).filter((n) => n.endsWith('.ts') && !n.endsWith('.d.ts'));
const missingJs = appTs.filter((n) => !existsSync(path.join(frontendDir, 'app', n.replace(/\.ts$/, '.js'))));

if (missing.length || duplicates.length || missingJs.length) {
  if (missing.length) console.error(`MISSING declarations: ${missing.join(', ')}`);
  if (duplicates.length) console.error(`DUPLICATE declarations:\n${duplicates.join('\n')}`);
  if (missingJs.length) console.error(`MISSING built JS: ${missingJs.join(', ')}`);
  process.exit(1);
}

console.log(`OK: app.ts parity passed (base=${base}, ${currentFiles.length} TS files, ${currentNames.size} top-level declarations, ${appTs.length} app modules)`);
