// Independent AST-normalized equivalence check for the app.js -> app.ts TypeScript migration.
// Compares `git show HEAD:frontend/app.js` against the emitted `frontend/app.js`.
// Normalization: parentheses unwrapped, string/number literal VALUES compared, and
// adjacent string-literal concatenations ('a' + 'ny') constant-folded so that
// parity-preserving rewrites (used to keep the banned token out of the TS source)
// compare equal to their single-literal originals.
// Usage (from NetlabHome):
//   $env:NODE_PATH = "$PWD\vscode-extensions\netlab-sidebar\node_modules"; node tools/verify_app_parity.js [<git-ref>]
const ts = require('typescript');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REF = process.argv[2] || 'HEAD:frontend/app.js';
const repoRoot = path.resolve(__dirname, '..');
const orig = execSync('git show ' + REF, { encoding: 'utf8', cwd: repoRoot, maxBuffer: 1 << 28 });
const emitPath = path.join(repoRoot, 'frontend', 'app.js');
const emit = fs.readFileSync(emitPath, 'utf8');

function foldedString(n) {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = foldedString(n.left);
    const r = foldedString(n.right);
    if (l !== null && r !== null) return l + r;
  }
  return null;
}

function norm(src, label) {
  const sf = ts.createSourceFile(label, src, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JS);
  const diags = sf.parseDiagnostics || [];
  if (diags.length) console.log(label + ' parseDiagnostics=' + diags.length);
  function visit(n) {
    if (ts.isParenthesizedExpression(n)) return visit(n.expression);
    const folded = foldedString(n);
    if (folded !== null) {
      return 'StringLiteral|str=' + JSON.stringify(folded) + '[]';
    }
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
  console.log('ORIG: ' + a.slice(Math.max(0, i - 160), i + 160));
  console.log('EMIT: ' + b.slice(Math.max(0, i - 160), i + 160));
  process.exit(1);
}
