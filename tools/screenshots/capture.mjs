// Deterministic UI screenshot pipeline for Netlab docs.
// Dev-only tool: uses headless Edge + Chrome DevTools Protocol (CDP). No runtime deps.
//
// Usage:
//   node tools/screenshots/capture.mjs                 # capture every shot in SHOTS
//   node tools/screenshots/capture.mjs --only r09-gb   # capture one shot by name
//   node tools/screenshots/capture.mjs --list          # list shot names
//   node tools/screenshots/capture.mjs --serve         # start server+edge and keep them
//
// Requires: python (with netlab deps), msedge. If a server on :8010 and a CDP
// endpoint on :9333 are already reachable they are reused (not killed at exit).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..'); // .../NetlabHome
const APP = process.env.NETLAB_APP || 'http://127.0.0.1:8010';
const CDP = process.env.NETLAB_CDP || 'http://127.0.0.1:9333';
const EDGE = process.env.NETLAB_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const VIEW = { width: 1440, height: 900 };

// UI prefs written to localStorage so every fresh navigation starts deterministic:
// light theme (the real default), no guide dialog, no precompute advisory.
const PREFS = {
  theme: 'light', motion: 'low', perf: 'perf', accent: '', guide: 'never', infobar: true,
  runWarn: false, accentDark: '', fontScale: 12, density: 'standard', surfaceTone: 0,
  radius: 0, lineWidth: 1, chartPalette: 'theme',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- CDP client
class Cdp {
  constructor(ws) {
    this.ws = ws; this.seq = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (!msg.id) return;
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(msg.error.message));
      else entry.resolve(msg.result);
    });
  }
  static async connect() {
    // Prefer a FRESH blank tab so each capture run gets a clean renderer; reusing a
    // previously-navigated tab can wedge (rAF busy) and hang Page.navigate/eval.
    let page = null;
    try {
      const fresh = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
      if (fresh && fresh.webSocketDebuggerUrl) page = fresh;
    } catch { /* fall back to existing target */ }
    if (!page) {
      const list = await (await fetch(`${CDP}/json/list`)).json();
      page = list.find((t) => t.type === 'page' && t.url.startsWith(APP))
        || list.find((t) => t.type === 'page');
      if (!page) throw new Error(`netlab page not found on ${APP} (targets: ${list.map(t => t.type + ':' + t.url).join(', ')})`);
    }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    const cdp = new Cdp(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    return cdp;
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true, userGesture: true,
    });
    if (res.exceptionDetails) {
      const d = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
      throw new Error(`JS eval failed: ${d}`);
    }
    return res.result?.value;
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

// ------------------------------------------------------------- boot helpers
async function waitHttp(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return true; } catch { /* not up */ }
    await sleep(500);
  }
  return false;
}

async function waitApp(cdp, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const ok = await cdp.eval(
        "document.readyState==='complete' && !!document.querySelector('#btnRun') && !!window.__netlabDebug",
      );
      if (ok) { await sleep(900); return true; }
    } catch { /* nav in progress */ }
    await sleep(250);
  }
  throw new Error('app did not boot in time');
}

// ------------------------------------------------------------ shot plumbing
async function postJson(pathname, body) {
  const r = await fetch(`${APP}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`POST ${pathname} -> ${r.status}`);
  return r.json().catch(() => ({}));
}

function clickSel(sel) { return `(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(e){e.click(); return 'ok'} return 'miss';})()`; }

async function openPanel(cdp, group, sub) {
  await cdp.eval(`(()=>{const p=document.querySelector('.panel-tab[data-group=${JSON.stringify(group)}]'); if(p)p.click();})()`);
  await sleep(180);
  if (sub) {
    await cdp.eval(`(()=>{const s=document.querySelector('.group-subnav button[data-sub=${JSON.stringify(sub)}]'); if(s)s.click();})()`);
    await sleep(180);
  }
}

async function dismissGuide(cdp) {
  const r = await cdp.eval(`(()=>{const g=document.querySelector('#guide'); if(g && !g.hidden){document.querySelector('#guideNever')?.click(); document.querySelector('#guideEnter')?.click(); return 'dismissed';} return 'no-guide';})()`);
  await sleep(400);
  return r;
}

async function fitView(cdp) {
  await cdp.eval(`(()=>{document.querySelector('#btnFit')?.click(); return true;})()`);
  await sleep(400);
}

// Dismiss the "发现自动保存的工程" recovery confirm so a freshly loaded scene is not
// replaced by an unrelated autosaved project mid-shot. Only acts on that modal.
async function dismissRecovery(cdp) {
  for (let i = 0; i < 10; i++) {
    const r = await cdp.eval(`(()=>{
      const hasRecovery=[...document.querySelectorAll('*')].some(e=>e.children.length<10 && /发现自动保存的工程/.test(e.textContent||''));
      if(!hasRecovery) return 'none';
      const cancel=[...document.querySelectorAll('button')].find(b=>/^(取消|关闭|以后再说|暂不载入)$/.test((b.textContent||'').trim()) && b.offsetParent!==null);
      if(cancel){cancel.click(); return 'dismissed';}
      return 'recovery-no-cancel';
    })()`);
    if (r === 'dismissed') { await sleep(350); return 'dismissed'; }
    if (r === 'none') return 'none';
    await sleep(300);
  }
  return 'timeout';
}

// Run the R20 "迁移场景为器件模型" flow: menu item -> confirm modal -> 迁移.
async function doMigrate(cdp) {
  const a = await menuClick(cdp, '迁移场景为器件模型');
  await sleep(300);
  const r = await cdp.eval(`(()=>{
    const modals=[...document.querySelectorAll('.modal, dialog')].filter(m=>!m.hidden);
    const m=modals.find(m=>/迁移|器件/.test(m.textContent||'')) || modals[modals.length-1];
    if(!m) return 'no-modal';
    const btns=[...m.querySelectorAll('button')];
    const go=btns.find(b=>/^(迁移|确定|确认|继续)$/.test((b.textContent||'').trim()));
    if(go){go.click(); return 'confirmed';}
    return 'no-confirm-btn';
  })()`);
  await sleep(1700);
  return a + '/' + r;
}

// Ensure a status-bar toggle is in the wanted on/off state by clicking #stXx only when needed.
async function ensureToggle(cdp, sel, key, want) {
  const cur = await cdp.eval(`(()=>{try{return !!window.__netlabDebug.state.ui[${JSON.stringify(key)}];}catch(e){return null;}})()`);
  if (cur !== want) await cdp.eval(clickSel(sel));
  await sleep(180);
}

async function ensurePrefs(cdp) {
  // Boot once so the page is live and deterministic before the shot loop.
  // Theme is left as the app's own default (the real current UI) — do not override.
  await cdp.send('Page.navigate', { url: `${APP}/` });
  await waitApp(cdp);
  await dismissGuide(cdp);
}

// Per-navigation tweaks that must not persist: silence the run-warn advisory.
async function preparePage(cdp) {
  await cdp.eval(`(()=>{ const s=window.__netlabDebug.state; s.prefs.runWarn=false; try{ s.prefs.theme='dark'; }catch(e){} document.documentElement.dataset.theme='dark'; s.needsDraw=true; return document.documentElement.dataset.theme; })()`);
  await sleep(150);
}

// Click a menubar dropdown item by its visible label prefix (menus are pre-built
// in #menuItems; their buttons fire the same actions as real clicks).
async function menuClick(cdp, label) {
  const r = await cdp.eval(`(()=>{const b=[...document.querySelectorAll('.menu-item')].find(x=>((x.querySelector('strong')?.textContent)||x.textContent||'').trim().startsWith(${JSON.stringify(label)})); if(!b)return 'miss'; b.click(); return 'ok';})()`);
  await sleep(450);
  return r;
}

// Press a plain key (the canvas listens on window keydown for shortcuts like 'a', 'f').
async function keyPress(cdp, key) {
  await cdp.eval(`(()=>{window.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true})); return true;})()`);
  await sleep(350);
}

// Select a scene node with a real CDP mouse click. nodeRect() is unreliable;
// the correct page coordinate is canvasRect.topLeft + worldToScreen(node.position).
async function selectNode(cdp, id) {
  const info = await cdp.eval(`(()=>{const c=document.querySelector('#graph');const cr=c.getBoundingClientRect();const n=(window.__netlabDebug.state.scene.nodes||[]).find(n=>n.id===${JSON.stringify(id)})||(window.__netlabDebug.state.scene.nodes||[])[0];const s=window.__netlabDebug.worldToScreen(n.position);return JSON.stringify({x:cr.x+s.x,y:cr.y+s.y,id:n.id});})()`);
  const p = JSON.parse(info);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: Math.round(p.x), y: Math.round(p.y), button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
  }
  await sleep(500);
  return p.id;
}

// Select a scene edge (element) by clicking the midpoint of one of its segments.
// edgePathPoints() takes the edge OBJECT and returns screen (offset) coordinates.
async function selectEdge(cdp, id) {
  const info = await cdp.eval(`(()=>{const c=document.querySelector('#graph');const cr=c.getBoundingClientRect();const e=(window.__netlabDebug.state.scene.edges||[]).find(e=>e.id===${JSON.stringify(id)})||(window.__netlabDebug.state.scene.edges||[])[0];const pts=window.__netlabDebug.edgePathPoints(e)||[];if(!pts.length)return JSON.stringify({err:'no pts'});const a=pts[Math.floor(pts.length/2)-0]||pts[0];const b=pts[Math.min(pts.length-1,Math.floor(pts.length/2))]||a;const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;return JSON.stringify({x:cr.x+mx,y:cr.y+my,id:e.id});})()`);
  const p = JSON.parse(info);
  if (p.err) throw new Error(`selectEdge ${id}: ${p.err}`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: Math.round(p.x), y: Math.round(p.y), button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
  }
  await sleep(500);
  return p.id;
}

async function selectNodeByName(cdp, name) {
  const id = await cdp.eval(`(()=>{const n=(window.__netlabDebug.state.scene.nodes||[]).find(n=>n.name===${JSON.stringify(name)});return n?n.id:'';})()`);
  if (!id) throw new Error(`selectNodeByName: no node named ${name}`);
  return selectNode(cdp, id);
}

async function resetSim(cdp) {
  await cdp.eval(`(()=>{document.querySelector('#btnReset')?.click(); return true;})()`);
  await sleep(250);
}

async function runFor(cdp, ms) {
  await cdp.eval(`(()=>{document.querySelector('#btnRun').click(); return true;})()`);
  await sleep(250);
  // If the "建议先预计算" advisory slipped through, click 直接运行 to proceed.
  await cdp.eval(`(()=>{const w=document.getElementById('runWarnWin'); if(w){const b=w.querySelector('#runWarnRun'); if(b)b.click();}})()`);
  await sleep(ms);
  // pause: only click if still running (button label contains 暂停/pause) else it would restart
  await cdp.eval(`(()=>{const b=document.querySelector('#btnRun'); const t=b.textContent||''; if(/暂停|Pause|运行中/i.test(t)) b.click();})()`);
  await sleep(400);
}

async function shoot(cdp, spec) {
  const outDir = path.resolve(ROOT, spec.outDir || 'docs/assets');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, spec.file);

  if (spec.template) {
    await postJson(`/api/templates/${encodeURIComponent(spec.template)}`);
  }
  if (spec.scenefile) {
    const body = fs.readFileSync(path.resolve(ROOT, spec.scenefile), 'utf8');
    const res = await fetch(`${APP}/api/scene`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    if (!res.ok) throw new Error(`scene load failed ${res.status}: ${await res.text()}`);
  }
  // fresh navigation so boot state reflects the loaded template + clean prefs
  await cdp.send('Page.navigate', { url: `${APP}/${spec.query || ''}` });
  await waitApp(cdp);
  await sleep(700);
  await dismissGuide(cdp);
  await dismissRecovery(cdp);
  await preparePage(cdp);

  // status-bar toggles: [{sel:'#stGrid', key:'grid', on:true}, ...]
  for (const t of spec.status || []) {
    await ensureToggle(cdp, t.sel, t.key, t.on !== false);
  }

  if (spec.panel) await openPanel(cdp, spec.panel.group, spec.panel.sub);

  if (spec.reset !== false) await resetSim(cdp);
  if (spec.fit) await fitView(cdp);

  // Ordered UI actions (menu clicks / shortcuts / node selection) used to stage
  // richer OPERATION screenshots that show a specific panel or dialog.
  for (const act of spec.actions || []) {
    if (act.op === 'menu') await menuClick(cdp, act.label);
    else if (act.op === 'key') await keyPress(cdp, act.key);
    else if (act.op === 'selectNode') await selectNode(cdp, act.id);
    else if (act.op === 'selectName') await selectNodeByName(cdp, act.name);
    else if (act.op === 'selectEdge') await selectEdge(cdp, act.id);
    else if (act.op === 'wait') await sleep(act.ms);
    else if (act.op === 'fit') await fitView(cdp);
    else if (act.op === 'status') { await cdp.eval(clickSel(act.sel)); await sleep(act.settle ?? 200); }
    else if (act.op === 'migrate') await doMigrate(cdp);
    else if (act.op === 'js') { await cdp.eval(act.js); await sleep(act.settle ?? 350); }
  }
  if (spec.selectNode) await selectNode(cdp, spec.selectNode);

  if (spec.beforeRunJs) { await cdp.eval(spec.beforeRunJs); await sleep(300); }

  if (spec.runMs) await runFor(cdp, spec.runMs);

  if (spec.js) { await cdp.eval(spec.js); await sleep(400); }

  // Final safety: if a late autosave-recovery confirm reappeared, take 取消 now.
  await dismissRecovery(cdp);

  await sleep(spec.settleMs ?? 700);

  // Hide transient toast bubbles so they don't ghost into the screenshot.
  if (!spec.keepToasts) await cdp.eval(`(()=>{const t=document.querySelector('#toasts'); if(t) t.style.visibility='hidden'; return true;})()`);

  const clip = { x: 0, y: 0, width: spec.w || VIEW.width, height: spec.h || VIEW.height, scale: 1 };
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, clip });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  const stat = fs.statSync(out);
  console.log(`  saved ${path.relative(ROOT, out)} (${stat.size} bytes)`);
  return out;
}

// ---------------------------------------------------------------- shot list
// outDir: 'docs/assets'  -> NetlabHome/docs/assets (README + OPERATION images)
//         'netlab/docs/assets' -> netlab/docs/assets (SOLVER_CODE_MAP + PROGRESS)
const SHOTS = [
  { name: 'signal-flow', file: 'signal-flow.png', outDir: 'docs/assets', template: 'signal_chain',
    panel: { group: 'analysis', sub: 'chart' }, runMs: 3000, fit: true },
  { name: 'vector-phase', file: 'vector-phase.png', outDir: 'docs/assets', template: 'vector_network',
    panel: { group: 'analysis', sub: 'vector' }, runMs: 4000, fit: true },
  { name: 'nonlinear-control', file: 'nonlinear-control.png', outDir: 'docs/assets', template: 'nonlinear_control',
    panel: { group: 'analysis', sub: 'chart' }, runMs: 4000, fit: true },

  // ---- OPERATION.md step-by-step walkthrough (multi-image, detailed) ----
  { name: 'op-guide', file: 'op-guide.png', outDir: 'docs/assets', template: 'signal_chain',
    fit: true, actions: [{ op: 'menu', label: '重新打开引导页' }], settleMs: 900 },
  { name: 'op-settings', file: 'op-settings.png', outDir: 'docs/assets', template: 'signal_chain',
    fit: true, actions: [{ op: 'menu', label: '工程设置' }], settleMs: 900 },
  { name: 'op-add-node', file: 'op-add-node.png', outDir: 'docs/assets', template: 'signal_chain',
    fit: true, actions: [{ op: 'js', js: `(()=>{const b=[...document.querySelectorAll('.panel-group[data-group=inspect] button')].find(x=>x.textContent.trim().endsWith('添加节点')); if(b){b.click();return 'ok';} return 'miss';})()`, settle: 500 }], settleMs: 700 },
  { name: 'op-inspector', file: 'op-inspector.png', outDir: 'docs/assets', template: 'signal_chain',
    fit: true, actions: [{ op: 'selectNode', id: 'a00000000003' }], settleMs: 800 },
  { name: 'op-circuit', file: 'op-circuit.png', outDir: 'docs/assets', template: 'trip_unit',
    fit: true, actions: [{ op: 'selectEdge', id: 'd80000000004' }], settleMs: 800 },

  // ---- netlab/docs/assets: template-mappable circuit examples (re-shot in current UI) ----
  { name: 'common-collector', file: 'common-collector.png', outDir: 'netlab/docs/assets', template: 'common_collector', fit: true },
  { name: 'opamp-inverting', file: 'opamp-inverting.png', outDir: 'netlab/docs/assets', template: 'opamp_inverting', fit: true },
  { name: 'opamp-internal', file: 'opamp-internal.png', outDir: 'netlab/docs/assets', template: 'opamp_internal', fit: true },
  { name: 'trip-unit', file: 'trip-unit.png', outDir: 'netlab/docs/assets', template: 'trip_unit', fit: true },
  // p0-solver-panel: old right-panel solver tab -> current Settings > 工程设置 (solver + sim) window
  { name: 'p0-solver-panel', file: 'p0-solver-panel.png', outDir: 'netlab/docs/assets', template: 'trip_unit',
    fit: true, actions: [{ op: 'menu', label: '工程设置' }], settleMs: 900 },
  // p1-blocks-panel: 模块库 -> current 模块与扩展 > 模块 group
  { name: 'p1-blocks-panel', file: 'p1-blocks-panel.png', outDir: 'netlab/docs/assets', template: 'signal_chain',
    fit: true, panel: { group: 'modules', sub: 'blocks' } },
  // p3-analysis: 旁路分析 group
  { name: 'p3-analysis', file: 'p3-analysis.png', outDir: 'netlab/docs/assets', template: 'signal_chain',
    fit: true, panel: { group: 'analysis', sub: 'analysis' } },
  // r22-categories: node/device category menu (circuit mode 添加节点)
  { name: 'r22-categories', file: 'r22-categories.png', outDir: 'netlab/docs/assets', template: 'trip_unit',
    fit: true, actions: [{ op: 'js', js: `(()=>{const b=[...document.querySelectorAll('.panel-group[data-group=inspect] button')].find(x=>x.textContent.trim().endsWith('添加节点')); if(b){b.click();return 'ok';} return 'miss';})()`, settle: 500 }], settleMs: 700 },

  // ---- R-series second pass (2026-11-07): re-shot from current templates ----
  // cad-grid-snap: 网格+吸附 开启、选中节点、运行（对应旧「拖动捕捉」）
  { name: 'cad-grid-snap', file: 'cad-grid-snap.png', outDir: 'netlab/docs/assets', template: 'rlc_series',
    status: [{ sel: '#stGrid', key: 'showGrid', on: true }, { sel: '#stSnap', key: 'snap', on: true }],
    fit: true, selectNode: 'c10000000002', runMs: 1200, settleMs: 700 },
  // cad-node-dot: 节点·点（实心点）样式 + 选中节点
  { name: 'cad-node-dot', file: 'cad-node-dot.png', outDir: 'netlab/docs/assets', template: 'rlc_series',
    fit: true, actions: [{ op: 'status', sel: '#stNodeStyle', settle: 300 }], selectNode: 'c10000000002', runMs: 900, settleMs: 600 },
  // p2-anchor-drag: 选中信号边 -> 起点/终点锚点 + 路由（曲线）锚点拖拽 UI
  { name: 'p2-anchor-drag', file: 'p2-anchor-drag.png', outDir: 'netlab/docs/assets', template: 'signal_chain',
    fit: true, actions: [{ op: 'selectEdge', id: 'b00000000003' }], settleMs: 800 },
  // p705-replay: 信号面板回放控件
  { name: 'p705-replay', file: 'p705-replay.png', outDir: 'netlab/docs/assets', template: 'common_collector',
    panel: { group: 'analysis', sub: 'chart' }, fit: true, runMs: 2500,
    js: `(()=>{document.querySelector('#btnReplay')?.click(); return 'ok';})()`, settleMs: 900 },
  // r09-gb: GB 矩形符号风格（信号 M/Σ/K）
  { name: 'r09-gb', file: 'r09-gb.png', outDir: 'netlab/docs/assets', template: 'signal_chain',
    fit: true, actions: [{ op: 'menu', label: '切换符号风格' }, { op: 'fit' }], runMs: 1200, keepToasts: true, settleMs: 700 },
  // r09-orthogonal: 选中信号边并把路由改为「正交折线」(下进上出) 成直角
  { name: 'r09-orthogonal', file: 'r09-orthogonal.png', outDir: 'netlab/docs/assets', template: 'signal_chain',
    fit: true, actions: [
      { op: 'selectEdge', id: 'b00000000003' },
      { op: 'js', js: `(()=>{const sels=[...document.querySelectorAll('select')];const setSel=(s,t)=>{if(!s)return;const o=[...s.options].find(o=>o.textContent===t);if(o){s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}));}};setSel(sels.find(s=>[...s.options].some(o=>o.textContent.includes('正交折线'))),'正交折线');const anch=sels.filter(s=>[...s.options].map(o=>o.textContent).join(',')==='自动,左,右,上,下');if(anch[0])setSel(anch[0],'下');if(anch[1])setSel(anch[1],'上');[...document.querySelectorAll('button')].find(b=>/应用修改/.test(b.textContent))?.click();return 'ok';})()`, settle: 500 },
    ], settleMs: 700 },
  // r15-coupling: 变压器耦合电路（自建场景，GB 符号）
  { name: 'r15-coupling', file: 'r15-coupling.png', outDir: 'netlab/docs/assets', scenefile: '../NetlabExtras/scratch/r15_coupling.json',
    actions: [{ op: 'menu', label: '切换符号风格' }, { op: 'fit' }], settleMs: 700 },
  // r15-transformer: 变压器绕组特写（自建紧凑场景，GB 符号）
  { name: 'r15-transformer', file: 'r15-transformer.png', outDir: 'netlab/docs/assets', scenefile: '../NetlabExtras/scratch/r15_transformer.json',
    actions: [{ op: 'menu', label: '切换符号风格' }, { op: 'fit' }], settleMs: 700 },
  // r19-layout: 自动布局重排
  { name: 'r19-layout', file: 'r19-layout.png', outDir: 'netlab/docs/assets', template: 'rlc_series',
    actions: [{ op: 'menu', label: '自动布局' }, { op: 'fit' }], runMs: 1000, settleMs: 700 },
  // r19-pins: 脱扣器 GB 原理图，引脚可见
  { name: 'r19-pins', file: 'r19-pins.png', outDir: 'netlab/docs/assets', template: 'trip_unit',
    fit: true, actions: [{ op: 'menu', label: '切换符号风格' }, { op: 'fit' }], runMs: 1000, settleMs: 700 },
  // r19-schematic-final: 脱扣器 GB 完整原理图
  { name: 'r19-schematic-final', file: 'r19-schematic-final.png', outDir: 'netlab/docs/assets', template: 'trip_unit',
    fit: true, actions: [{ op: 'menu', label: '切换符号风格' }, { op: 'fit' }], runMs: 1200, settleMs: 700 },
  // r20-device-nodes: 迁移为器件模型
  { name: 'r20-device-nodes', file: 'r20-device-nodes.png', outDir: 'netlab/docs/assets', template: 'rlc_series',
    actions: [{ op: 'migrate' }, { op: 'menu', label: '切换符号风格' }, { op: 'fit' }], runMs: 1200, keepToasts: true, settleMs: 700 },
  // r20-device-inspector: 迁移后选中 V1 器件检查器
  { name: 'r20-device-inspector', file: 'r20-device-inspector.png', outDir: 'netlab/docs/assets', template: 'rlc_series',
    actions: [{ op: 'migrate' }, { op: 'fit' }, { op: 'selectName', name: 'V1' }], settleMs: 800 },
  // replay_speed_20261028: 回放速度滑杆
  { name: 'replay_speed_20261028', file: 'replay_speed_20261028.png', outDir: 'netlab/docs/assets', template: 'signal_chain',
    panel: { group: 'analysis', sub: 'chart' }, fit: true, runMs: 3000,
    js: `(()=>{const s=document.querySelector('#replaySpeed');if(s){s.value='120';s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}));}return 'ok';})()`, settleMs: 800 },
  // shell-r08: 完整应用外壳
  { name: 'shell-r08', file: 'shell-r08.png', outDir: 'netlab/docs/assets', template: 'signal_chain', fit: true, runMs: 1500, settleMs: 700 },
  // source-dc-fields: V1 直流波形参数
  { name: 'source-dc-fields', file: 'source-dc-fields.png', outDir: 'netlab/docs/assets', template: 'common_collector',
    fit: true, actions: [{ op: 'selectName', name: 'V1' }], settleMs: 800 },
  // top_timeline_20261028: 顶部时间轴回放条
  { name: 'top_timeline_20261028', file: 'top_timeline_20261028.png', outDir: 'netlab/docs/assets', template: 'signal_chain',
    fit: true, runMs: 6000, settleMs: 700 },
  // waypoint-drag: 导线选中并加折点
  { name: 'waypoint-drag', file: 'waypoint-drag.png', outDir: 'netlab/docs/assets', template: 'common_collector',
    fit: true, actions: [{ op: 'selectEdge', id: 'c00000000001' }, { op: 'js', js: `(()=>{const addB=[...document.querySelectorAll('button')].find(b=>/添加折点/.test(b.textContent));if(addB)addB.click();const nums=[...document.querySelectorAll('input[type=number]')];const set=(el,v)=>{el.value=String(v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};if(nums[0])set(nums[0],-180);if(nums[1])set(nums[1],30);[...document.querySelectorAll('button')].find(b=>/应用修改/.test(b.textContent))?.click();return 'ok';})()`, settle: 500 }], settleMs: 700 },
  // cad-schematic: 正交布线 + GB 符号（rlc_series，运行）
  { name: 'cad-schematic', file: 'cad-schematic.png', outDir: 'netlab/docs/assets', template: 'rlc_series',
    status: [{ sel: '#stGrid', key: 'showGrid', on: true }, { sel: '#stSnap', key: 'snap', on: true }, { sel: '#stOrtho', key: 'circuitOrthogonal', on: true }],
    fit: true, actions: [{ op: 'menu', label: '切换符号风格' }, { op: 'fit' }], runMs: 1200, keepToasts: true, settleMs: 700 },
  // p4-gb-grid: GB 符号 + 网格（rlc_series，不运行）
  { name: 'p4-gb-grid', file: 'p4-gb-grid.png', outDir: 'netlab/docs/assets', template: 'rlc_series',
    status: [{ sel: '#stGrid', key: 'showGrid', on: true }, { sel: '#stOrtho', key: 'circuitOrthogonal', on: true }],
    fit: true, actions: [{ op: 'menu', label: '切换符号风格' }, { op: 'fit' }], keepToasts: true, settleMs: 700 },
  // p4-gb-symbols: GB 符号按 kind 绘制 + 选中电阻 R1 查看
  { name: 'p4-gb-symbols', file: 'p4-gb-symbols.png', outDir: 'netlab/docs/assets', template: 'rlc_series',
    fit: true, actions: [{ op: 'menu', label: '切换符号风格' }, { op: 'fit' }, { op: 'selectEdge', id: 'd10000000002' }], keepToasts: true, settleMs: 800 },
];

// ---------------------------------------------------------------- lifecycle
async function ensureServerAndEdge() {
  const procs = [];
  let reuse = true;
  if (!(await waitHttp(`${APP}/api/health`, 2))) {
    reuse = false;
    console.log('starting netlab server ...');
    const py = spawn('python', ['-m', 'netlab.run', '--no-browser', '--port', '8010', '--log-level', 'warning'],
      { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PYTHONUTF8: '1' } });
    procs.push(py);
    if (!(await waitHttp(`${APP}/api/health`, 80))) throw new Error('server did not come up');
  } else {
    console.log('reusing running server on :8010');
  }
  if (!(await waitHttp(`${CDP}/json/list`, 2))) {
    reuse = false;
    console.log('launching headless Edge ...');
    const ud = path.resolve(ROOT, 'NetlabExtras', 'scratch', 'edge-shot-profile');
    fs.mkdirSync(ud, { recursive: true });
    const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9333',
      '--remote-allow-origins=*', `--window-size=${VIEW.width},${VIEW.height}`, '--no-first-run',
      '--no-default-browser-check', `--user-data-dir=${ud}`, `${APP}/`], { stdio: 'ignore' });
    procs.push(edge);
    if (!(await waitHttp(`${CDP}/json/list`, 80))) throw new Error('CDP did not come up');
    await sleep(1200);
  } else {
    console.log('reusing running CDP on :9333');
  }
  return { procs, reuse };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) { for (const s of SHOTS) console.log(s.name, '->', s.outDir + '/' + s.file); return; }

  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
  const onlySet = only ? only.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const shots = onlySet ? SHOTS.filter((s) => onlySet.includes(s.name)) : SHOTS;
  if (!shots.length) throw new Error(`no shot named ${only}`);

  const { procs } = await ensureServerAndEdge();
  const cdp = await Cdp.connect();
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: VIEW.width, height: VIEW.height, deviceScaleFactor: 1, mobile: false,
  });
  await cdp.send('Emulation.setEmulatedMedia', {
    media: 'screen', features: [{ name: 'prefers-color-scheme', value: 'dark' }],
  });
  await ensurePrefs(cdp);

  const results = [];
  try {
    for (const spec of shots) {
      console.log(`\n[${spec.name}] ${spec.outDir}/${spec.file}`);
      try {
        const file = await shoot(cdp, spec);
        results.push({ name: spec.name, file, ok: true });
      } catch (err) {
        console.error(`  FAILED: ${err.message}`);
        results.push({ name: spec.name, ok: false, error: err.message });
      }
    }
  } finally {
    cdp.close();
    if (!args.includes('--serve')) {
      for (const p of procs) { try { p.kill(); } catch { /* ignore */ } }
    }
  }
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} shots captured.`);
  if (ok !== results.length) process.exitCode = 1;
}

await main();
