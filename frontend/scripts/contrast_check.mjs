// frontend/scripts/contrast_check.mjs
// 零第三方依赖的 WCAG 对比度校验（P-A2 双色板验收）。
// 从 frontend/theme.tokens.ts 读取 LIGHT / DARK（与 gen_theme_css.mjs 相同的括号匹配 + eval），
// 用 WCAG 2.1 相对亮度公式计算关键配对并打印表：
//   正文 ink/paper ≥ 7     次文字 muted/paper ≥ 4.5    弱文字 dim/paper ≥ 4.5
//   边框 field-border/paper ≥ 3   线 line-strong/paper ≥ 3
// 深色弱化文字（muted/dim）另设上限 ≤ 7，防止再次“调过头”失去主次。
// 任一项 FAIL → 退出码 1。
//
// 用法：node frontend/scripts/contrast_check.mjs   （在 NetlabHome 下或 scripts 目录均可）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcPath = path.resolve(here, '..', 'theme.tokens.ts');
const src = fs.readFileSync(srcPath, 'utf8');

// 从 `export const NAME ... = { ... }` 中取出对象字面量并求值（纯字符串键值，安全）。
function readObject(name) {
  const marker = `export const ${name}`;
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`theme.tokens.ts 中未找到 ${marker}`);
  const braceStart = src.indexOf('{', at);
  if (braceStart < 0) throw new Error(`${name} 缺少对象字面量`);
  let depth = 0;
  let inStr = null;
  let esc = false;
  let end = -1;
  for (let i = braceStart; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) throw new Error(`${name} 对象字面量未闭合`);
  const literal = src.slice(braceStart, end + 1);
  // eslint-disable-next-line no-new-func
  return new Function('return (' + literal + ');')();
}

// hex -> [r,g,b]（0-255）。仅接受 #rrggbb / #rgb。
function parseHex(hex) {
  let h = String(hex).trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`不是有效的 hex 颜色：${hex}`);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// WCAG 2.1 相对亮度。
function relLuminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

// 对比度 = (L_light + 0.05) / (L_dark + 0.05)。
function contrastRatio(hexFg, hexBg) {
  const l1 = relLuminance(parseHex(hexFg));
  const l2 = relLuminance(parseHex(hexBg));
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

const LIGHT = readObject('LIGHT');
const DARK = readObject('DARK');

// 关键配对定义：min 下限；max 为可选上限（深色弱化文字防过亮）。
const CHECKS = [
  // 浅色
  { theme: 'light', fg: 'ink', bg: 'paper', min: 7, max: null, label: '正文 ink/paper' },
  { theme: 'light', fg: 'muted', bg: 'paper', min: 4.5, max: null, label: '次文字 muted/paper' },
  { theme: 'light', fg: 'dim', bg: 'paper', min: 4.5, max: null, label: '弱文字 dim/paper' },
  { theme: 'light', fg: 'field-border', bg: 'paper', min: 3, max: null, label: '边框 field-border/paper' },
  { theme: 'light', fg: 'line-strong', bg: 'paper', min: 3, max: null, label: '线 line-strong/paper' },
  // 深色
  { theme: 'dark', fg: 'ink', bg: 'paper', min: 7, max: null, label: '正文 ink/paper' },
  { theme: 'dark', fg: 'muted', bg: 'paper', min: 4.5, max: 7, label: '次文字 muted/paper' },
  { theme: 'dark', fg: 'dim', bg: 'paper', min: 4.5, max: 7, label: '弱文字 dim/paper' },
  { theme: 'dark', fg: 'field-border', bg: 'paper', min: 3, max: null, label: '边框 field-border/paper' },
  { theme: 'dark', fg: 'line-strong', bg: 'paper', min: 3, max: null, label: '线 line-strong/paper' },
];

const MAPS = { light: LIGHT, dark: DARK };

function fmt(n) {
  return n.toFixed(2).padStart(6, ' ');
}

let failed = 0;
const rows = [];

for (const c of CHECKS) {
  const map = MAPS[c.theme];
  const fg = map[c.fg];
  const bg = map[c.bg];
  if (fg == null) throw new Error(`${c.theme} 缺少令牌 ${c.fg}`);
  if (bg == null) throw new Error(`${c.theme} 缺少令牌 ${c.bg}`);
  const ratio = contrastRatio(fg, bg);
  const minOk = ratio >= c.min;
  const maxOk = c.max == null ? true : ratio <= c.max;
  const ok = minOk && maxOk;
  if (!ok) failed++;

  let bound = `>= ${c.min}`;
  if (c.max != null) bound = `${c.min} ≤ x ≤ ${c.max}`;
  rows.push({
    theme: c.theme === 'light' ? 'Light' : 'Dark',
    label: c.label,
    fg,
    bg,
    ratio,
    bound,
    ok,
  });
}

// 打印表格
const head = '主题   配对                       前景        背景        比值     期望           结果';
console.log(head);
console.log('-'.repeat(head.length + 8));
for (const r of rows) {
  console.log(
    `${r.theme.padEnd(5)} ${r.label.padEnd(24)} ${r.fg.padEnd(11)} ${r.bg.padEnd(11)} ${fmt(r.ratio)}   ${r.bound.padEnd(14)} ${r.ok ? 'PASS' : 'FAIL'}`
  );
}

console.log('-'.repeat(head.length + 8));
const total = rows.length;
if (failed === 0) {
  console.log(`全部 PASS（${total}/${total}）`);
  process.exit(0);
} else {
  console.error(`FAILED：${failed}/${total} 项未通过`);
  process.exit(1);
}
