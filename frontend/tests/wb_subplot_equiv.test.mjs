import test from 'node:test';
import assert from 'node:assert/strict';

const _el = new Proxy({ style: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){return false} }, dataset: {}, children: [], appendChild(){}, removeChild(){}, addEventListener(){}, removeEventListener(){}, setAttribute(){}, getAttribute(){return null}, removeAttribute(){}, querySelector: () => _el, querySelectorAll: () => [], getBoundingClientRect: () => ({ width: 320, height: 200, left: 0, top: 0 }), focus(){}, click(){}, insertBefore(){}, contains(){return false} }, { get(t,p){ if (p in t) return t[p]; return () => {}; }, set(t,p,v){ t[p]=v; return true; } });
globalThis.window = new Proxy({ devicePixelRatio: 2, innerWidth: 1280, innerHeight: 800, addEventListener(){}, requestAnimationFrame: (f)=>setTimeout(f,0) }, { get(t,p){ return p in t ? t[p] : () => {}; } });
globalThis.document = { createElement: () => _el, querySelector: () => _el, querySelectorAll: () => [], getElementById: () => _el, body: _el, documentElement: _el, addEventListener(){}, removeEventListener(){}, readyState: 'complete' };
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
globalThis.cancelAnimationFrame = (h) => clearTimeout(h);

function makeCtx(log) {
  const base = {};
  return new Proxy(base, {
    get(_t, prop) {
      if (prop === 'canvas') return _t.__canvas;
      if (prop in _t) return _t[prop];
      return (...args) => log.push([String(prop), ...args.map(x => typeof x === 'number' ? Number(x.toFixed(6)) : x)]);
    },
    set(_t, prop, value) { log.push(['set:' + String(prop), typeof value === 'number' ? Number(value.toFixed(6)) : value]); return true; },
  });
}
function makeCanvas(log) {
  const ctx = makeCtx(log);
  return { width: 0, height: 0, style: {}, parentElement: { getBoundingClientRect: () => ({ width: 320 }) }, getContext: () => ctx };
}
const entry = { state_id: 's1', name: 'E', ok: true, t: [0, 1, 2, 3], series: { a: [0, 1, 0, 2], b: [2, 0, 1, 0] } };
const signals = ['a', 'b'];
const deps = { colorForKey: (k) => '#' + String(k).replace(/[^0-9a-fA-F]/g, '').slice(0, 6).padEnd(6, '0'), wbCompareLayout: { cols: 2, height: 220 } };
function run(fn) { const log = []; const canvas = makeCanvas(log); fn(canvas, entry, signals, 0, 3, 220, deps); return { log, dims: [canvas.width, canvas.height, canvas.style.width, canvas.style.height] }; }

test('drawWbSubplot refactor: canvas 2D instruction sequence identical (old vs new)', async () => {
  const { drawWbSubplotOld } = await import('./fixtures/wb_subplot_old.mjs');
  const { drawWbSubplot } = await import('../app/wb_subplot.js');
  const a = run(drawWbSubplotOld);
  const b = run(drawWbSubplot);
  assert.ok(a.log.length > 20, 'expected many canvas ops, got ' + a.log.length);
  assert.equal(a.log.length, b.log.length, 'call count differs');
  for (let i = 0; i < a.log.length; i++) assert.deepEqual(b.log[i], a.log[i], 'diff at #' + i + ' ' + JSON.stringify([a.log[i], b.log[i]]));
  assert.deepEqual(b.dims, a.dims);
});
