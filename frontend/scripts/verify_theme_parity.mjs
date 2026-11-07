// frontend/scripts/verify_theme_parity.mjs
// P-A1 验收：证明 theme.generated.css 与「迁移前」style.css 的令牌值逐项完全相等。
// 迁移前的来源 = git HEAD:frontend/style.css（本仓库尚未提交，故 HEAD 即改动前基线）。
// 用法：node frontend/scripts/verify_theme_parity.mjs   （在 NetlabHome 下执行）

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const generatedPath = path.resolve(here, '..', 'theme.generated.css');

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function parseBlocks(css, selectorRe) {
  const out = {};
  for (const m of css.matchAll(selectorRe)) {
    for (const decl of m[1].split(';')) {
      const s = decl.trim();
      if (!s) continue;
      const i = s.indexOf(':');
      if (i < 0) continue;
      const name = s.slice(0, i).trim();
      if (!name.startsWith('--')) continue; // 只比较自定义属性令牌
      out[name] = s.slice(i + 1).trim();
    }
  }
  return out;
}

function diff(oldObj, newObj, scope) {
  const keys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
  const problems = [];
  for (const k of [...keys].sort()) {
    if (!(k in oldObj)) problems.push(`${scope} 新增变量 ${k}=${newObj[k]}`);
    else if (!(k in newObj)) problems.push(`${scope} 缺失变量 ${k}（旧值 ${oldObj[k]}）`);
    else if (oldObj[k] !== newObj[k]) problems.push(`${scope} 值不等 ${k}: 旧="${oldObj[k]}" 新="${newObj[k]}"`);
  }
  return problems;
}

const oldCss = stripComments(
  execFileSync('git', ['show', 'HEAD:frontend/style.css'], { cwd: repoRoot, encoding: 'utf8' }),
);
const newCss = stripComments(fs.readFileSync(generatedPath, 'utf8'));

const oldRoot = parseBlocks(oldCss, /:root\s*\{([^}]*)\}/g);
const oldDark = parseBlocks(oldCss, /html\[data-theme="dark"\]\s*\{([^}]*)\}/g);
const newRoot = parseBlocks(newCss, /:root\s*\{([^}]*)\}/g);
const newDark = parseBlocks(newCss, /html\[data-theme="dark"\]\s*\{([^}]*)\}/g);

const problems = [
  ...diff(oldRoot, newRoot, ':root'),
  ...diff(oldDark, newDark, 'html[data-theme="dark"]'),
];

console.log(`旧 style.css  :root 令牌 ${Object.keys(oldRoot).length} 项 / dark 令牌 ${Object.keys(oldDark).length} 项`);
console.log(`新 generated  :root 令牌 ${Object.keys(newRoot).length} 项 / dark 令牌 ${Object.keys(newDark).length} 项`);

if (problems.length) {
  console.error('❌ 不一致 ' + problems.length + ' 项：');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(`✅ 全等：:root ${Object.keys(oldRoot).length} 项 + dark ${Object.keys(oldDark).length} 项，值逐项相等（共 ${Object.keys(oldRoot).length + Object.keys(oldDark).length} 项）`);
