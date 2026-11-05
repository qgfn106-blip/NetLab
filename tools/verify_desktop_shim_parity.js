// Independent AST-normalized equivalence check for the desktop-shim.js -> desktop-shim.ts migration.
// Run from NetlabHome with TypeScript available, e.g.:
//   $env:NODE_PATH = "$PWD\vscode-extensions\netlab-sidebar\node_modules"; node tools/verify_desktop_shim_parity.js
// Usage: node tools/verify_desktop_shim_parity.js [<git-ref-of-original>]
const ts = require('typescript');
const { execSync } = require('child_process');
const fs = require('fs');

// Default ref = last commit before the desktop-shim migration (78687f6 still holds original desktop-shim.js).
const REF = process.argv[2] || '78687f6:frontend/desktop-shim.js';
const orig = execSync('git show ' + REF, { encoding: 'utf8' });
const emit = fs.readFileSync('frontend/desktop-shim.js', 'utf8');

function norm(src, label) {
  const sf = ts.createSourceFile(label, src, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JS);
  const diags = sf.parseDiagnostics || [];
  if (diags.length) console.log(label + ' parseDiagnostics=' + diags.length);
  function visit(n) {
    if (ts.isParenthesizedExpression(n)) return visit(n.expression);
    const parts = [ts.SyntaxKind[n.kind]];
    if (n.name && typeof n.name.text === 'string') parts.push('name=' + n.name.text);
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) parts.push('str=' + JSON.stringify(n.text));
    else if (ts.isNumericLiteral(n)) parts.push('num=' + JSON.stringify(n.text));
    const ch = [];
    ts.forEachChild(n, c => { ch.push(visit(c)); });
    return parts.join('|') + '[' + ch.join(',') + ']';
  }
  return visit(sf);
}

const a = norm(orig, 'orig.js');
const b = norm(emit, 'emit.js');
const equal = a === b;
console.log('REF=' + REF);
console.log('len orig=' + a.length + ' emit=' + b.length);
console.log('AST EQUAL = ' + equal);
if (!equal) {
  let i = 0; const m = Math.min(a.length, b.length);
  while (i < m && a[i] === b[i]) i++;
  console.log('firstDiffAt=' + i);
  console.log('ORIG: ' + a.slice(Math.max(0, i - 120), i + 160));
  console.log('EMIT: ' + b.slice(Math.max(0, i - 120), i + 160));
}
process.exit(equal ? 0 : 2);
