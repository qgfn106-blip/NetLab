// S5 结束条件的机检：app.ts 总行数、单个顶层语句跨度、app/*.ts 模块行数。
// 用法：node tools/check_app_sections.mjs [--json]
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(import.meta.dirname, '..');
const APP = path.join(ROOT, 'app.ts');
const APP_DIR = path.join(ROOT, 'app');
const MAX_APP_LINES = 8000;
const MAX_STATEMENT_LINES = 800;
const MAX_MODULE_LINES = 800;

const source = fs.readFileSync(APP, 'utf8');
const sf = ts.createSourceFile('app.ts', source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
const totalLines = source.split('\n').length - (source.endsWith('\n') ? 1 : 0);

function iifeStatements(stmts) {
  const out = [];
  for (const st of stmts) {
    if (ts.isExpressionStatement(st) && ts.isCallExpression(st.expression)) {
      let callee = st.expression.expression;
      while (ts.isParenthesizedExpression(callee)) callee = callee.expression;
      if ((ts.isArrowFunction(callee) || ts.isFunctionExpression(callee)) && callee.body && ts.isBlock(callee.body)) {
        out.push(...callee.body.statements);
        continue;
      }
    }
    out.push(st);
  }
  return out;
}

const spans = [];
for (const st of iifeStatements(sf.statements)) {
  if (ts.isImportDeclaration(st)) continue;
  const start = sf.getLineAndCharacterOfPosition(st.getStart(sf)).line + 1;
  const end = sf.getLineAndCharacterOfPosition(st.getEnd()).line + 1;
  spans.push({ line: start, end, size: end - start + 1, kind: ts.SyntaxKind[st.kind] });
}
spans.sort((a, b) => b.size - a.size);

const modules = fs.readdirSync(APP_DIR)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => {
    const text = fs.readFileSync(path.join(APP_DIR, f), 'utf8');
    return { file: `app/${f}`, lines: text.split('\n').length - (text.endsWith('\n') ? 1 : 0) };
  })
  .sort((a, b) => b.lines - a.lines);

const tooBig = spans.filter((s) => s.size > MAX_STATEMENT_LINES);
const tooBigModules = modules.filter((m) => m.lines > MAX_MODULE_LINES);
const ok = totalLines <= MAX_APP_LINES && tooBig.length === 0 && tooBigModules.length === 0;

const report = {
  ok,
  appLines: totalLines,
  maxAppLines: MAX_APP_LINES,
  maxStatementLines: MAX_STATEMENT_LINES,
  maxModuleLines: MAX_MODULE_LINES,
  topStatements: spans.slice(0, 10),
  oversizedStatements: tooBig,
  oversizedModules: tooBigModules,
  largestModules: modules.slice(0, 10),
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`app.ts lines: ${totalLines} (limit ${MAX_APP_LINES})`);
  console.log('top-level statement spans (top 10):');
  for (const s of spans.slice(0, 10)) console.log(`  ${s.size.toString().padStart(4)}  L${s.line}-${s.end}  ${s.kind}`);
  if (tooBig.length) {
    console.log(`FAIL: ${tooBig.length} top-level statement(s) exceed ${MAX_STATEMENT_LINES} lines`);
    for (const s of tooBig) console.log(`  L${s.line}-${s.end} (${s.size}) ${s.kind}`);
  }
  if (tooBigModules.length) {
    console.log(`FAIL: ${tooBigModules.length} module(s) exceed ${MAX_MODULE_LINES} lines`);
    for (const m of tooBigModules) console.log(`  ${m.file} (${m.lines})`);
  }
  if (totalLines > MAX_APP_LINES) console.log(`FAIL: app.ts has ${totalLines} lines > ${MAX_APP_LINES}`);
  console.log(ok ? 'OK: S5 size limits passed' : 'NOT DONE: S5 size limits not met');
}
process.exit(ok ? 0 : 1);
