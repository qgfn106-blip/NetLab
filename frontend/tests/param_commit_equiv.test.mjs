import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal DOM stubs so importing param_commit (-> param_fields -> dom.js) works under node.
const _fakeEl = () => ({ style: {}, classList: { add() {}, remove() {} }, dataset: {}, children: [], appendChild() {}, append() {}, replaceChildren() {}, setAttribute() {}, addEventListener() {}, getContext() { return {}; }, querySelector() { return null; }, querySelectorAll() { return []; }, remove() {} });
globalThis.document = { querySelector: () => _fakeEl(), querySelectorAll: () => [], createElement: () => _fakeEl(), createTextNode: () => ({}), body: _fakeEl() };
globalThis.window = globalThis;
globalThis.HTMLElement = class {};

const mod = await import('../app/param_commit.js');

function makeInput(value, checked = false) {
  return { value, checked, classList: { _s: new Set(), add(c) { this._s.add(c); } } };
}
function makeWrapper(param, type, label, value) {
  const inp = makeInput(value);
  return {
    dataset: { param, type, label },
    _input: inp,
    querySelector(sel) {
      if (sel === '[data-role="param-unit"]') return null;
      if (sel.includes('input')) return inp;
      return null;
    },
  };
}
function makeContainer(wrappers) {
  return { _w: wrappers, querySelectorAll(sel) { return sel === '[data-param]' ? this._w : []; } };
}
function makeDeps(respond) {
  const calls = { json: [], toast: [], markDirty: 0, snap: [] };
  const deps = {
    state: { sim: null, scene: { nodes: [{ id: 'n1', params: { gain: 1 } }], edges: [{ id: 'e1', params: { r: 1 } }] } },
    toast: (m, k, d) => calls.toast.push([m, k, d]),
    jsonRequest: async (u, m, b) => { calls.json.push([u, m, b]); return respond ? respond(u, m, b) : null; },
    wbMarkDirty: () => { calls.markDirty += 1; },
    applySnapshot: (s) => calls.snap.push(s),
  };
  return { deps, calls };
}

test('node: payload merged, response node replaces list item, sim set, markDirty once', async () => {
  const { deps, calls } = makeDeps(() => ({ node: { id: 'n1', params: { gain: 2 } }, sim: { cursor: 7 } }));
  const c = makeContainer([makeWrapper('gain', 'float', '增益', '2')]);
  await mod.wbCommitNodeParam(deps, 'n1', { parentElement: c }, {});
  assert.deepEqual(calls.json, [['/api/nodes/n1', 'PATCH', { params: { gain: 2 } }]]);
  assert.equal(deps.state.scene.nodes[0].params.gain, 2);
  assert.deepEqual(deps.state.sim, { cursor: 7 });
  assert.equal(calls.markDirty, 1);
});

test('edge: payload merged, response edge replaces list item, sim set', async () => {
  const { deps, calls } = makeDeps(() => ({ edge: { id: 'e1', params: { r: 5 } }, sim: { cursor: 8 } }));
  const c = makeContainer([makeWrapper('r', 'float', '电阻', '5')]);
  await mod.wbCommitEdgeParam(deps, 'e1', { parentElement: c }, {});
  assert.deepEqual(calls.json, [['/api/edges/e1', 'PATCH', { params: { r: 5 } }]]);
  assert.equal(deps.state.scene.edges[0].params.r, 5);
  assert.deepEqual(deps.state.sim, { cursor: 8 });
  assert.equal(calls.markDirty, 1);
});

test('sim: single key body, sim set, markDirty once', async () => {
  const { deps, calls } = makeDeps(() => ({ config: {}, sim: { cursor: 9 } }));
  const c = makeContainer([makeWrapper('dt', 'float', '步长', '0.5')]);
  await mod.wbCommitSimParam(deps, 'dt', { parentElement: c });
  assert.deepEqual(calls.json, [['/api/config', 'PATCH', { dt: 0.5 }]]);
  assert.deepEqual(deps.state.sim, { cursor: 9 });
  assert.equal(calls.markDirty, 1);
});

test('integration: body integration value, applySnapshot then markDirty', async () => {
  const snap = { cursor: 3, frames: [1, 2, 3] };
  const { deps, calls } = makeDeps(() => snap);
  const c = makeContainer([makeWrapper('integration', 'text', '积分方法', 'rk4')]);
  await mod.wbCommitIntegration(deps, { parentElement: c });
  assert.deepEqual(calls.json, [['/api/scene', 'PATCH', { integration: 'rk4' }]]);
  assert.deepEqual(calls.snap, [snap]);
  assert.equal(calls.markDirty, 1);
});

test('collectParamValues throw -> toast error 5000, no request', async () => {
  const { deps, calls } = makeDeps(() => ({ node: { id: 'n1' }, sim: {} }));
  const c = makeContainer([makeWrapper('gain', 'float', '增益', '')]);
  await mod.wbCommitNodeParam(deps, 'n1', { parentElement: c }, {});
  assert.deepEqual(calls.toast, [['参数「增益」不能为空', 'error', 5000]]);
  assert.equal(calls.json.length, 0);
  assert.equal(calls.markDirty, 0);
});

test('jsonRequest reject -> toast error 6000, no markDirty', async () => {
  const { deps, calls } = makeDeps(() => { throw new Error('boom'); });
  const c = makeContainer([makeWrapper('gain', 'float', '增益', '2')]);
  await mod.wbCommitNodeParam(deps, 'n1', { parentElement: c }, {});
  assert.deepEqual(calls.toast, [['boom', 'error', 6000]]);
  assert.equal(calls.markDirty, 0);
});
