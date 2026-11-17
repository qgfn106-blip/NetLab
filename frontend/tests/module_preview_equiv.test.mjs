import test from 'node:test';
import assert from 'node:assert/strict';

const _el = new Proxy({ style: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){return false} }, dataset: {}, children: [], appendChild(){}, removeChild(){}, addEventListener(){}, removeEventListener(){}, hidden: false, setAttribute(){}, getAttribute(){return null}, removeAttribute(){}, querySelector: () => _el, querySelectorAll: () => [], getBoundingClientRect: () => ({ width: 320, height: 200, left: 0, top: 0 }) }, { get(t,p){ if(p in t) return t[p]; return () => {}; }, set(t,p,v){ t[p]=v; return true; } });
globalThis.window = new Proxy({ devicePixelRatio: 2, innerWidth: 1280, innerHeight: 800 }, { get(t,p){ return p in t ? t[p] : () => {}; } });
globalThis.document = { createElement: () => _el, querySelector: () => _el, querySelectorAll: () => [], getElementById: () => _el, body: _el, documentElement: _el, addEventListener(){}, readyState: 'complete' };

function makeCtx(log) {
  return new Proxy({}, {
    get(_t, prop) { if (prop in _t) return _t[prop]; return (...args) => log.push([String(prop), ...args.map(x => typeof x === 'number' ? Number(x.toFixed(6)) : x)]); },
    set(_t, prop, value) { log.push(['set:' + String(prop), typeof value === 'number' ? Number(value.toFixed(6)) : value]); return true; },
  });
}
function makeUi(log, w, h) {
  const ctx = makeCtx(log);
  const canvas = { width: 0, height: 0, style: {}, hidden: false, getContext: () => ctx };
  return { moduleCanvas: canvas, moduleStage: { getBoundingClientRect: () => ({ width: w, height: h }) }, moduleEmpty: { hidden: true }, moduleWin: { hidden: false } };
}
const scenarios = [
  { w: 320, h: 200, block: { nodes: [ { id: 'n1', kind: 'device', name: 'R1', params: { port_name: 'R1' }, position: { x: 0, y: 0 } }, { id: 'p1', kind: 'port', name: 'IN', params: {}, position: { x: 100, y: 0 } }, { id: 'g', kind: 'ground', name: 'GND', params: {}, position: { x: 50, y: 100 } } ], ports: [ { net: 'n1' } ] } },
  { w: 300, h: 220, block: { nodes: [ { id: 'a', kind: 'device', name: 'A', params: {}, position: { x: 0, y: 0 } }, { id: 'b', kind: 'port', name: 'B', params: {}, position: { x: 80, y: 40 } } ], ports: [] } },
  { w: 360, h: 180, block: { nodes: [], ports: [] } },
];
function run(fn, sc) {
  const log = []; const ui = makeUi(log, sc.w, sc.h); const state = { moduleBlock: sc.block };
  fn({ state, ui });
  return { log, dims: [ui.moduleCanvas.width, ui.moduleCanvas.height, ui.moduleCanvas.style.width, ui.moduleCanvas.style.height, ui.moduleCanvas.hidden, ui.moduleEmpty.hidden] };
}
test('drawModulePreview refactor: canvas 2D instruction sequence identical across scenarios', async () => {
  const { drawModulePreviewOld } = await import('./fixtures/module_preview_old.mjs');
  const { drawModulePreview } = await import('../app/module_preview.js');
  for (let i = 0; i < scenarios.length; i++) {
    const a = run(drawModulePreviewOld, scenarios[i]);
    const b = run(drawModulePreview, scenarios[i]);
    assert.equal(b.log.length, a.log.length, 'scenario ' + i + ' call count differs ' + a.log.length + ' vs ' + b.log.length);
    for (let k = 0; k < a.log.length; k++) assert.deepEqual(b.log[k], a.log[k], 'scenario ' + i + ' diff #' + k + ' ' + JSON.stringify([a.log[k], b.log[k]]));
    assert.deepEqual(b.dims, a.dims, 'scenario ' + i + ' dims differ');
  }
});
