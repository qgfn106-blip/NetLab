// P3-06：前端 /api 端点契约快照校验（自动扫描 app.ts + app/**/*.ts）。
// 目的：P1-02/P3-06 把 app.ts 拆分为 router/store/views/commands/handlers 时，
// 任何 endpoint 路径或 HTTP 方法的增删改都会被此测试拦截（请求/响应语义不在本文件范围）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const APP = path.join(ROOT, 'app.ts');
const APP_DIR = path.join(ROOT, 'app');
const SNAPSHOT = path.join(here, 'app_endpoint_snapshot.json');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

export function listSourceFiles() {
  const moduleFiles = walk(APP_DIR).filter((p) => p.endsWith('.ts') && !p.endsWith('.d.ts'));
  return [APP, ...moduleFiles].sort();
}

export function readAppSources(files = listSourceFiles()) {
  return files.map((p) => fs.readFileSync(p, 'utf8')).join('\n');
}

export function extractEndpointRegistry(source) {
  const registry = new Map();
  for (const line of source.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_$][\w$]*)\s*:.*?(['"`])([^'"`]*\/api\/[^'"`]*)\2/);
    if (!m) continue;
    const endpoint = normalisePath(m[3]);
    if (endpoint) registry.set(m[1], endpoint);
  }
  return registry;
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

function readCallArgs(src, start) {
  let depth = 1;
  let quote = null;
  let out = '';
  for (let i = start; i < src.length; i += 1) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === '\\') { out += src[i + 1] || ''; i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; continue; }
    if (c === '(') { depth += 1; out += c; continue; }
    if (c === ')') { depth -= 1; if (depth === 0) return out; out += c; continue; }
    out += c;
  }
  return out;
}

function splitArgs(text) {
  const args = [];
  let cur = '';
  let depth = 0;
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      cur += c;
      if (c === '\\') { cur += text[i + 1] || ''; i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; cur += c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth += 1; cur += c; continue; }
    if (c === ')' || c === ']' || c === '}') { depth -= 1; cur += c; continue; }
    if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) args.push(cur.trim());
  return args;
}

function normalisePath(raw) {
  const normalised = String(raw).replace(/\$\{[^}]*\}/g, ':param');
  const m = normalised.match(/\/api\/[A-Za-z0-9_\-/:.]*/);
  if (!m) return null;
  let p = m[0].replace(/[.:]+$/, '');
  if (p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

export function extractEndpointEntries(source) {
  const normalised = source.replace(/\$\{[^}]*\}/g, ':param');
  const registry = extractEndpointRegistry(source);
  const entries = new Map();
  const callRe = /\b(api|jsonRequest|fetch|analysisGet)\s*\(/g;
  let m;
  while ((m = callRe.exec(normalised))) {
    const argsText = readCallArgs(normalised, m.index + m[0].length);
    const args = splitArgs(argsText);
    let endpoint = normalisePath(args[0] || '');
    if (!endpoint) {
      const km = (args[0] || '').match(/ENDPOINTS\s*\.\s*([A-Za-z_$][\w$]*)|ENDPOINTS\s*\[\s*['"]([A-Za-z_$][\w$]*)['"]\s*\]/);
      if (km) endpoint = registry.get(km[1] || km[2]) || null;
    }
    if (!endpoint) continue;
    let method = 'GET';
    if (m[1] === 'jsonRequest') {
      const mm = (args[1] || '').match(/['"]([A-Za-z]+)['"]/);
      if (mm) method = mm[1].toUpperCase();
    } else if (m[1] === 'api' || m[1] === 'fetch') {
      const mm = argsText.match(/method\s*:\s*['"]([A-Za-z]+)['"]/);
      if (mm) method = mm[1].toUpperCase();
    }
    entries.set(method + ' ' + endpoint, { method, path: endpoint });
  }
  // 注册表里可能尚未被调用的路径也要进入快照，method 用 * 表示未观测。
  const seenPaths = new Set([...entries.values()].map((e) => e.path));
  for (const endpoint of extractEndpoints(source)) {
    if (!seenPaths.has(endpoint)) entries.set('* ' + endpoint, { method: '*', path: endpoint });
  }
  return [...entries.values()].sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));
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

export function diffEndpointEntries(actual, expected) {
  const key = (e) => e.method + ' ' + e.path;
  const a = new Set(actual.map(key)), e = new Set(expected.map(key));
  return {
    missing: [...e].filter((k) => !a.has(k)).sort(),
    added: [...a].filter((k) => !e.has(k)).sort(),
  };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const source = readAppSources();
  const paths = extractEndpoints(source);
  const entries = extractEndpointEntries(source);
  if (process.argv.includes('--write')) {
    fs.writeFileSync(SNAPSHOT, JSON.stringify({
      version: 2,
      source: 'frontend/app.ts + frontend/app/**/*.ts',
      note: 'P3-06/P1-02 前端 endpoint 契约快照（method+path）；按整个 frontend/app 自动扫描重建，拆分时必须保持不变',
      paths,
      entries,
    }, null, 2) + '\n');
    console.log('WROTE: ' + paths.length + ' paths, ' + entries.length + ' method+path entries');
  } else {
    const snap = loadSnapshot();
    const d = diffEndpoints(paths, snap.paths);
    const de = diffEndpointEntries(entries, snap.entries || []);
    if (d.missing.length || d.added.length || de.missing.length || de.added.length) {
      console.error('FAIL: frontend endpoint snapshot drift');
      if (d.missing.length) console.error('  missing paths: ' + d.missing.join(', '));
      if (d.added.length) console.error('  added paths: ' + d.added.join(', '));
      if (de.missing.length) console.error('  missing entries: ' + de.missing.join(', '));
      if (de.added.length) console.error('  added entries: ' + de.added.join(', '));
      process.exit(1);
    }
    console.log('OK: frontend endpoint contract passed (' + paths.length + ' paths, ' + entries.length + ' method+path entries)');
  }
}