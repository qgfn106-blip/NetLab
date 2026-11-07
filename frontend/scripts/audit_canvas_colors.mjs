// frontend/scripts/audit_canvas_colors.mjs
// P-A3 画布裸色审计脚本（Node，零第三方依赖）。
//
// 作用：扫描 frontend/app.ts，列出所有「颜色字面量」及其行号、所在函数上下文，
//       并标记该颜色是否已经「走 C()/tokens」。用于 P-A3「画布裸色收敛」改动前后的量化对比，
//       以及为残余裸色 allowlist 提供逐条依据。
//
// 颜色字面量识别（与设计文档 §1 同口径）：
//   - 十六进制：#rgb / #rgba / #rrggbb / #rrggbbaa
//   - rgb(...) / rgba(...)
//
// 「是否已走 C()/tokens」判定：
//   1) routed  —— 字面量位于某个 C('...') / C("...") / C(`...`) 调用的实参括号内；
//                 或位于 tokens().xxx 的读取（颜色值本身来自令牌表，不在 app.ts 出现字面量，天然计入）。
//   2) bare    —— 其余出现在代码里的裸字面量（如 fillStyle = '#f7ecdf'、条件表达式里的裸 hex）。
//   3) definition —— 字面量位于已知的「映射/调色板定义表」内（COLOR_ALIAS / LEGACY_RGB /
//                    CHART_PALETTE / ACCENT_SWATCHES）。这些是「旧色→令牌」的映射源或候选色板，
//                    不是直接的画布绘制取值，单列说明，不计入裸色债务（但会逐表审查其下游用法）。
//
// 用法：
//   node frontend/scripts/audit_canvas_colors.mjs                # 人读报告
//   node frontend/scripts/audit_canvas_colors.mjs --json         # 机器可读 JSON
//   node frontend/scripts/audit_canvas_colors.mjs --bare-only     # 只列裸色（回归用）
//
// 退出码：恒为 0（纯审计，不阻断构建）；是否收敛由报告数字判断。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appPath = path.resolve(here, '..', 'app.ts');

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const BARE_ONLY = args.includes('--bare-only');

const src = fs.readFileSync(appPath, 'utf8');
const lines = src.split(/\r?\n/);

// ---- 已知「映射/调色板定义表」的行号范围（随 app.ts 变动可能需微调；按名称定位更稳） ----
// 通过名字定位对象字面量起止行，避免硬编码行号漂移。
function findObjectRange(name) {
  const lineIdx = lines.findIndex((l) => new RegExp(`\\b(const|let|var)\\s+${name}\\b`).test(l));
  if (lineIdx < 0) return null;
  // 从该行开始做括号深度匹配（足够用于简单对象/数组字面量）。
  let depth = 0;
  let started = false;
  for (let i = lineIdx; i < lines.length; i++) {
    const l = lines[i];
    for (const ch of l) {
      if (ch === '{' || ch === '[') { depth++; started = true; }
      else if (ch === '}' || ch === ']') depth--;
    }
    if (started && depth <= 0) return { startLine: lineIdx + 1, endLine: i + 1, name };
  }
  return { startLine: lineIdx + 1, endLine: lineIdx + 1, name };
}

const DEF_TABLES = [
  'COLOR_ALIAS',     // 旧色→token 的别名映射
  'LEGACY_RGB',      // 旧 rgb 三元组→token
  'CHART_PALETTE',   // 分析折线分类色板
  'ACCENT_SWATCHES', // 强调色候选
  'PALETTE',         // 通用调色板（经 C() 使用）
  'GROUP_COLORS',    // 分组色（经 C() 使用）
  'KIND_COLORS',     // 器件种类色（经 C() 使用）
  'INST_COLORS',     // 仪器通道色（经 C() 使用）
].map(findObjectRange).filter(Boolean);

// ---- 已文档化的裸色 allowlist ----
// 这些字面量出现在 app.ts，但【不属于】画布绘制取值，或属于「本就主题安全」的特殊场景，
// 逐条给出保留原因（行号漂移时以 literal+function 双匹配兜底）。
const ALLOWLIST = [
  { literal: '#1f5f5b', reason: 'glyphColor 状态默认值（用户可配置的电路字形色，绘制时经 C() 取值）' },
  { literal: '#a8541f', reason: '字形色等值比较 `color === \'#a8541f\'`，非绘制取值' },
  { literal: 'rgba(197, 161, 107, .16)', reason: '框选填充，已显式按 dark/light 分支，主题安全' },
  { literal: 'rgba(168, 84, 31, .10)', reason: '框选填充（light 分支），主题安全' },
  { literal: 'rgba(197, 161, 107, .70)', reason: '框选描边（dark 分支），主题安全' },
  { literal: 'rgba(168, 84, 31, .65)', reason: '框选描边（light 分支），主题安全' },
  { literal: '#faf8f2', reason: 'instrumentSurface 内部对 fill 再走 C()，实际已令牌化' },
  { literal: '#000000', reason: 'iro 取色控件默认值，非画布绘制' },
  { literal: '#e0e3dc', reason: 'C() 深色抬亮基准色，函数内部算法常量' },
  { literal: '#080a08', reason: 'analToken CSS 变量 fallback（主题化由 --var 提供）' },
  { literal: '#7b7266', reason: 'analToken CSS 变量 fallback（主题化由 --var 提供）' },
  { literal: '#d9d3c7', reason: 'analToken CSS 变量 fallback（主题化由 --var 提供）' },
  { literal: '#2563a8', reason: '字形色候选（UI 取色下拉的“靛蓝”选项值，属用户可配置项，非画布直接绘制）' },
  { literal: 'rgba(0,0,0,.28)', reason: '缓存窗口模板 HTML 内联 box-shadow，非 canvas 绘制' },
  { literal: '#cfc6b5', reason: '模板 HTML 中 CSS 变量 fallback `var(--line,#cfc6b5)`，非 canvas 绘制' },
];
function inAllowlist(e) {
  return ALLOWLIST.find((a) => a.literal === e.literal) || null;
}

function inDefinitionTable(lineNo) {
  for (const t of DEF_TABLES) {
    if (lineNo >= t.startLine && lineNo <= t.endLine) return t.name;
  }
  return null;
}

// ---- 颜色字面量正则 ----
// 十六进制：要求前面不是 # 或字母数字（避免匹配到标识符中的片段），并允许 #rgb/#rgba/#rrggbb/#rrggbbaa。
const HEX_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_])/g;
// rgb/rgba 函数。
const RGB_RE = /\brgba?\s*\([^)]*\)/gi;

// 判断某行是否属于 DOM 内联样式（而非 canvas 绘制）。
// 这些场景由 CSS 主题（--var）或 DOM 主题逻辑负责，画布裸色审计单列为 dom allowlist。
const DOM_RE = /(\.style\b|cssText|style\s*=|style:|\bbackground\s*:|\.color\s*=|\.background\b|innerHTML|outerHTML|insertAdjacentHTML|setAttribute\s*\(\s*['"]style)/;

// 找到某一行里所有 `C(` 调用的 [openParenIndex, closeParenIndex] 区间（括号匹配，跨行也能匹配）。
function findCSpans(text, lineStartOffset) {
  const spans = [];
  const re = /\bC\s*\(/g;
  let m;
  while ((m = re.exec(text))) {
    const open = text.indexOf('(', m.index);
    let depth = 0;
    let end = -1;
    for (let i = open; i < text.length; i++) {
      const ch = text[i];
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end >= 0) spans.push([open, end]);
  }
  return spans;
}

// 为整份源码计算每个字符 offset 是否落在 C(...) 内（跨行支持：把全文拼起来算）。
// 用全文 offset 更稳：逐行 offset = 前面行长度和 + 行内索引。
const lineOffsets = [];
{
  let off = 0;
  for (const l of lines) { lineOffsets.push(off); off += l.length + 1; }
}
const fullText = lines.join('\n');
const cSpans = findCSpans(fullText);
function offsetInC(off) {
  // 仅做粗略：落在任一 C(...) 实参区间内。为避免 O(n*m)，按需二分；此处跨度小可线性。
  for (const [s, e] of cSpans) {
    if (off > s && off < e) return true;
  }
  return false;
}

// ---- 函数上下文：从某行向上找最近的函数/方法声明行 ----
const FUNC_RE = /(?:function\s+([A-Za-z0-9_$]+)\s*\(|([A-Za-z0-9_$]+)\s*[:=]\s*(?:async\s*)?(?:function)?\s*\([^)]*\)\s*(?:=>|\{)|(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*\([^)]*\)\s*=>|(?:async\s+)?([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{)/;
function funcContext(lineNo) {
  for (let i = lineNo - 1; i >= Math.max(0, lineNo - 400); i--) {
    const l = lines[i];
    const m = l.match(FUNC_RE);
    if (m) {
      const name = m[1] || m[3] || m[4] || m[2] || '(anonymous)';
      return { name, line: i + 1 };
    }
  }
  return { name: '(top-level)', line: 0 };
}

// ---- 扫描每一行，收集字面量 ----
const entries = [];
for (let li = 0; li < lines.length; li++) {
  const line = lines[li];
  const lineNo = li + 1;
  const lineOffset = lineOffsets[li];

  const hits = [];
  let m;
  HEX_RE.lastIndex = 0;
  while ((m = HEX_RE.exec(line))) hits.push({ text: m[0], index: m.index, kind: 'hex' });
  RGB_RE.lastIndex = 0;
  while ((m = RGB_RE.exec(line))) {
    if (m[0].includes('${')) continue; // 跳过模板字符串里的动态 rgb(${...})
    hits.push({ text: m[0], index: m.index, kind: 'rgb' });
  }
  if (!hits.length) continue;

  const defTable = inDefinitionTable(lineNo);
  const isDom = DOM_RE.test(line);
  const ctx = funcContext(lineNo);
  for (const h of hits) {
    const absOff = lineOffset + h.index;
    const routed = offsetInC(absOff);
    const entry = {
      line: lineNo,
      column: h.index + 1,
      literal: h.text,
      kind: h.kind,
      status: null,
      domain: isDom ? 'dom' : 'canvas',
      definitionTable: defTable || null,
      function: ctx.name,
      functionLine: ctx.line,
      code: line.trim(),
    };
    if (defTable) entry.status = 'definition';
    else if (routed) entry.status = 'routed';
    else if (isDom) entry.status = 'dom';
    else {
      const allow = inAllowlist(entry);
      if (allow) { entry.status = 'allowlist'; entry.allowReason = allow.reason; }
      else entry.status = 'bare';
    }
    entries.push(entry);
  }
}

// ---- 统计 ----
const total = entries.length;
const byStatus = { routed: 0, bare: 0, dom: 0, definition: 0, allowlist: 0 };
for (const e of entries) byStatus[e.status]++;
const bareEntries = entries.filter((e) => e.status === 'bare'); // 画布裸色债务（目标 0）
const domEntries = entries.filter((e) => e.status === 'dom');   // DOM 内联样式，allowlist
const allowEntries = entries.filter((e) => e.status === 'allowlist'); // 已文档化保留项

// 按函数聚合裸色
const bareByFunc = {};
for (const e of bareEntries) {
  const key = `${e.function}@${e.functionLine}`;
  bareByFunc[key] = (bareByFunc[key] || 0) + 1;
}
const domByFunc = {};
for (const e of domEntries) {
  const key = `${e.function}@${e.functionLine}`;
  domByFunc[key] = (domByFunc[key] || 0) + 1;
}

// ---- 输出 ----
if (JSON_OUT) {
  const out = {
    appPath,
    total,
    byStatus,
    definitionTables: DEF_TABLES,
    bareByFunction: bareByFunc,
    domByFunction: domByFunc,
    allowlist: allowEntries.map((e) => ({ line: e.line, literal: e.literal, function: e.function, reason: e.allowReason })),
    entries,
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(0);
}

console.log('=== P-A3 画布裸色审计 ===');
console.log(`文件：${appPath}`);
console.log(`总行数：${lines.length}`);
console.log('');
console.log(`颜色字面量总数：${total}`);
console.log(`  已走 C()/tokens (routed)   ：${byStatus.routed}`);
console.log(`  裸色         (bare/canvas)  ：${byStatus.bare}   ← 画布裸色债务（目标 0）`);
console.log(`  DOM 内联样式  (dom/allowlist)：${byStatus.dom}`);
console.log(`  已文档化保留  (allowlist)    ：${byStatus.allowlist}`);
console.log(`  映射/调色板定义表(definition) ：${byStatus.definition}`);
console.log('');
console.log('定义表范围：');
for (const t of DEF_TABLES) console.log(`  ${t.name}  L${t.startLine}-L${t.endLine}`);
console.log('');

if (bareEntries.length) {
  console.log(`--- 裸色明细（${bareEntries.length} 条，按函数分组）---`);
  const grouped = {};
  for (const e of bareEntries) {
    const k = `${e.function}() @L${e.functionLine}`;
    (grouped[k] = grouped[k] || []).push(e);
  }
  for (const [k, arr] of Object.entries(grouped)) {
    console.log(`\n[${k}]  ${arr.length} 条`);
    for (const e of arr) {
      console.log(`  L${e.line}:${e.column}  ${e.literal}   | ${e.code}`);
    }
  }
} else {
  console.log('✅ 无裸色（画布绘制路径已全部走 C()/tokens）。');
}

if (allowEntries.length && !BARE_ONLY) {
  console.log(`\n--- 已文档化保留项 allowlist（${allowEntries.length} 条）---`);
  for (const e of allowEntries) {
    console.log(`  L${e.line}  ${e.literal}  | ${e.function}()  | ${e.allowReason}`);
  }
}

if (!BARE_ONLY) {
  console.log('\n--- 全部字面量清单 ---');
  for (const e of entries) {
    console.log(`L${e.line}:${e.column}\t[${e.status}]\t${e.literal}\t${e.function}()\t${e.code}`);
  }
}
