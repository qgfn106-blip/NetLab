// TS 搬运轮等价检查：对比 HEAD 与工作树的顶层声明，确认无符号丢失、无重复定义、
// 每个运行时 app/*.ts 都有 git-tracked 的 .js 产物，并对比函数/类/变量初始化的体哈希。
// 用法：node tools/verify_app_parity.js [base]
// 若本轮确实需要改函数体，显式设置 PARITY_ALLOW_BODY_CHANGES=1 并在提交说明中列出。
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const base = process.argv[2] || 'HEAD';
const frontendDir = path.resolve(import.meta.dirname, '..');
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: frontendDir, encoding: 'utf8' }).trim();
const relFrontend = path.relative(repoRoot, frontendDir).replaceAll('\\', '/');

function normalize(text) {
  return String(text || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim();
}

function hasRuntime(sf) {
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isEnumDeclaration(stmt) || ts.isVariableStatement(stmt)) return true;
    if (ts.isImportDeclaration(stmt)) return true;
    if (ts.isExportAssignment(stmt) || ts.isExpressionStatement(stmt)) return true;
    if (ts.isExportDeclaration(stmt)) {
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause) && stmt.exportClause.elements.every((e) => e.isTypeOnly)) continue;
      return true;
    }
  }
  return false;
}

function collect(fileName, text) {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
  const out = [];
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) {
      if (stmt.name?.text) out.push({ name: stmt.name.text, kind: ts.isFunctionDeclaration(stmt) ? 'function' : 'class', hash: normalize(stmt.body?.getText(sf)) });
    } else if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) {
      if (stmt.name?.text) out.push({ name: stmt.name.text, kind: 'type', hash: '' });
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) out.push({ name: decl.name.text, kind: 'variable', hash: normalize(decl.initializer?.getText(sf)) });
      }
    }
  }
  return { names: out, runtime: hasRuntime(sf) };
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
const baseBodies = new Map();
for (const rel of baselineFiles) {
  const text = execFileSync('git', ['show', `${base}:${rel}`], { cwd: repoRoot, encoding: 'utf8' });
  const { names } = collect(rel, text);
  for (const item of names) {
    if (!baseNames.has(item.name)) baseNames.set(item.name, []);
    baseNames.get(item.name).push(rel);
    if (item.hash) baseBodies.set(item.name, item.hash);
  }
}

const currentNames = new Map();
const currentBodies = new Map();
const typeOnlyModules = new Set();
for (const full of currentFiles) {
  if (!existsSync(full)) continue;
  const rel = path.relative(repoRoot, full).replaceAll('\\', '/');
  const text = readFileSync(full, 'utf8');
  const { names, runtime } = collect(rel, text);
  if (!runtime) typeOnlyModules.add(rel);
  for (const item of names) {
    if (!currentNames.has(item.name)) currentNames.set(item.name, []);
    currentNames.get(item.name).push(rel);
    if (item.hash) currentBodies.set(item.name, item.hash);
  }
}

const missing = [...baseNames.keys()].filter((name) => !currentNames.has(name));
const duplicates = [...currentNames.entries()]
  .filter(([, files]) => new Set(files).size > 1)
  .map(([name, files]) => `${name}: ${[...new Set(files)].join(', ')}`);

const appTs = readdirSync(path.join(frontendDir, 'app')).filter((n) => n.endsWith('.ts') && !n.endsWith('.d.ts'));
const missingJs = [];
const untrackedJs = [];
for (const n of appTs) {
  const relTs = `${relFrontend}/app/${n}`;
  if (typeOnlyModules.has(relTs)) continue;
  const jsRel = `${relFrontend}/app/${n.replace(/\.ts$/, '.js')}`;
  const fullJs = path.join(repoRoot, jsRel);
  if (!existsSync(fullJs)) { missingJs.push(n); continue; }
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', jsRel], { cwd: repoRoot, stdio: 'ignore' });
  } catch {
    untrackedJs.push(jsRel);
  }
}

const changedBodies = [...currentBodies.entries()]
  .filter(([name, hash]) => baseBodies.has(name) && baseBodies.get(name) !== hash)
  .map(([name]) => name);

const allowBodyChanges = process.env.PARITY_ALLOW_BODY_CHANGES === '1';
if (missing.length || duplicates.length || missingJs.length || untrackedJs.length || (changedBodies.length && !allowBodyChanges)) {
  if (missing.length) console.error(`MISSING declarations: ${missing.join(', ')}`);
  if (duplicates.length) console.error(`DUPLICATE declarations:\n${duplicates.join('\n')}`);
  if (missingJs.length) console.error(`MISSING built JS: ${missingJs.join(', ')}`);
  if (untrackedJs.length) console.error(`UNTRACKED built JS: ${untrackedJs.join(', ')}`);
  if (changedBodies.length && !allowBodyChanges) console.error(`CHANGED bodies: ${changedBodies.join(', ')} (set PARITY_ALLOW_BODY_CHANGES=1 only with justification)`);
  process.exit(1);
}
if (changedBodies.length) console.error(`WARN changed bodies (allowed): ${changedBodies.join(', ')}`);

console.log(`OK: app.ts parity passed (base=${base}, ${currentFiles.length} TS files, ${currentNames.size} top-level declarations, ${appTs.length - typeOnlyModules.size} runtime app modules, ${typeOnlyModules.size} type-only)`);
