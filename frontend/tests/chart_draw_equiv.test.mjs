import test from 'node:test';
import assert from 'node:assert/strict';

let LOG = [];
function makeCtx() {
  const target = {};
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (prop === 'measureText') return (text) => { const w = String(text).length * 6; LOG.push(['measureText', String(text), w]); return { width: w }; };
      return (...args) => { LOG.push([String(prop), ...args.map(x => typeof x === 'number' ? Number(x.toFixed(6)) : x)]); };
    },
    set(t, prop, value) { LOG.push(['set:' + String(prop), typeof value === 'number' ? Number(value.toFixed(6)) : value]); t[prop] = value; return true; },
  });
}
const CTX = makeCtx();
function makeEl() {
  return { dataset: {}, style: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){return false} }, hidden: false, width: 0, height: 0, children: [], appendChild(){}, removeChild(){}, addEventListener(){}, removeEventListener(){}, setAttribute(){}, getAttribute(){return null}, removeAttribute(){}, querySelector: () => makeEl(), querySelectorAll: () => [], getContext: () => CTX, getBoundingClientRect: () => ({ width: 300, height: 200, left: 0, top: 0 }) };
}
const ROOT = makeEl();
globalThis.window = new Proxy({ devicePixelRatio: 2, innerWidth: 1280, innerHeight: 800, addEventListener(){}, removeEventListener(){} }, { get(t,p){ return p in t ? t[p] : () => {}; } });
const PANEL = makeEl(); PANEL.dataset = { group: 'analysis' };
function q(sel) {
  if (sel && String(sel).includes('group-subnav')) return null;
  if (sel === '.panel-group.active') return PANEL;
  return ROOT;
}
globalThis.document = { createElement: () => makeEl(), querySelector: (s) => q(s), querySelectorAll: () => [], getElementById: () => ROOT, body: makeEl(), documentElement: makeEl(), addEventListener(){}, readyState: 'complete' };
globalThis.localStorage = { getItem: () => null, setItem(){}, removeItem(){} };

const { state: appState } = await import('../app/state.js');
const { chartCanvas } = await import('../app/dom.js');
const { drawChartOld } = await import('./fixtures/chart_draw_old.mjs');
const { drawChart } = await import('../app/chart_draw.js');

function fakeDeps(sc) {
  return {
    colorForKey: (k) => (k === 'k1' ? '#a8541f' : '#3c6e9e'),
    decodeProbeKey: (k) => ({ label: 'L-' + k }),
    nearestFrame: (t) => ({ t, v: { k1: 1.25, k2: 2.5 } }),
    state: sc,
  };
}
const scenarios = [
  { chart: { selected: ['k1'], window: 5, hover: null }, chartSize: { w: 300, h: 200, dpr: 2 }, frames: [{ t: 0, v: { k1: 0 } }, { t: 1, v: { k1: 1 } }, { t: 2, v: { k1: 2 } }], replay: { active: false, index: 0 } },
  { chart: { selected: ['k1', 'k2'], window: 2.5, hover: null }, chartSize: { w: 360, h: 240, dpr: 1.5 }, frames: [{ t: 0, v: { k1: 0, k2: 5 } }, { t: 1, v: { k1: 1, k2: 4 } }], replay: { active: true, index: 0 } },
  { chart: { selected: ['k1'], window: 5, hover: null }, chartSize: { w: 320, h: 200, dpr: 2 }, frames: [{ t: 0, v: { k1: 0 } }], replay: { active: false, index: 0 } },
  { chart: { selected: ['k1'], window: 5, hover: { x: 120, y: 100 } }, chartSize: { w: 300, h: 200, dpr: 2 }, frames: [{ t: 0, v: { k1: 0 } }, { t: 1, v: { k1: 1 } }, { t: 2, v: { k1: 2 } }], replay: { active: false, index: 0 } },
];
function run(fn, sc) {
  LOG = []; chartCanvas.width = 0; chartCanvas.height = 0; chartCanvas.style = {}; chartCanvas.dataset = {}; ROOT.width = 0; ROOT.height = 0; ROOT.style = {}; ROOT.dataset = {}; ROOT.hidden = false;
  fn(fakeDeps(sc));
  return { log: LOG.slice(), dims: [chartCanvas.width, chartCanvas.height, chartCanvas.style.width, chartCanvas.style.height, chartCanvas.dataset.renderSize] };
}
test('drawChart refactor: instruction sequence identical across scenarios', () => {
  for (let i = 0; i < scenarios.length; i++) {
    const a = run(drawChartOld, scenarios[i]);
    const b = run(drawChart, scenarios[i]);
    assert.ok(a.log.length > 50, 'scenario ' + i + ' produced too few ops (' + a.log.length + ') — drawChart likely early-returned');
    assert.equal(b.log.length, a.log.length, 'scenario ' + i + ' len ' + a.log.length + ' vs ' + b.log.length);
    for (let k = 0; k < a.log.length; k++) assert.deepEqual(b.log[k], a.log[k], 'scenario ' + i + ' diff #' + k + ' ' + JSON.stringify([a.log[k], b.log[k]]));
    assert.deepEqual(b.dims, a.dims, 'scenario ' + i + ' dims');
  }
});
