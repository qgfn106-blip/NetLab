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
    const list = await (await fetch(`${CDP}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.url.startsWith(APP));
    if (!page) throw new Error(`netlab page not found on ${APP} (targets: ${list.map(t => t.type + ':' + t.url).join(', ')})`);
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

async function ensurePrefs(cdp) {
  // Boot once so the page is live and deterministic before the shot loop.
  // Theme is left as the app's own default (the real current UI) — do not override.
  await cdp.send('Page.navigate', { url: `${APP}/` });
  await waitApp(cdp);
  await dismissGuide(cdp);
}

// Per-navigation tweaks that must not persist: silence the run-warn advisory.
async function preparePage(cdp) {
  await cdp.eval(`(()=>{ window.__netlabDebug.state.prefs.runWarn=false; return document.documentElement.dataset.theme; })()`);
  await sleep(120);
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
  // fresh navigation so boot state reflects the loaded template + clean prefs
  await cdp.send('Page.navigate', { url: `${APP}/${spec.query || ''}` });
  await waitApp(cdp);
  await dismissGuide(cdp);
  await preparePage(cdp);

  if (spec.panel) await openPanel(cdp, spec.panel.group, spec.panel.sub);

  if (spec.reset !== false) await resetSim(cdp);
  if (spec.fit) await fitView(cdp);

  // Ordered UI actions (menu clicks / shortcuts / node selection) used to stage
  // richer OPERATION screenshots that show a specific panel or dialog.
  for (const act of spec.actions || []) {
    if (act.op === 'menu') await menuClick(cdp, act.label);
    else if (act.op === 'key') await keyPress(cdp, act.key);
    else if (act.op === 'selectNode') await selectNode(cdp, act.id);
    else if (act.op === 'selectEdge') await selectEdge(cdp, act.id);
    else if (act.op === 'wait') await sleep(act.ms);
    else if (act.op === 'js') { await cdp.eval(act.js); await sleep(act.settle ?? 350); }
  }
  if (spec.selectNode) await selectNode(cdp, spec.selectNode);

  if (spec.beforeRunJs) { await cdp.eval(spec.beforeRunJs); await sleep(300); }

  if (spec.runMs) await runFor(cdp, spec.runMs);

  if (spec.js) { await cdp.eval(spec.js); await sleep(400); }

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
  // NOTE: p4-gb-grid / p4-gb-symbols are intentionally NOT reproduced. The old shots
  // demonstrate a signal-node symbol-style variant exposed in this build only through the
  // status-bar node-style cycler (#stNodeStyle), which is unstable under headless capture
  // (wedges the renderer). Kept as historical evidence rather than faked. See report.
  // r22-categories: node/device category menu (circuit mode 添加节点)
  { name: 'r22-categories', file: 'r22-categories.png', outDir: 'netlab/docs/assets', template: 'trip_unit',
    fit: true, actions: [{ op: 'js', js: `(()=>{const b=[...document.querySelectorAll('.panel-group[data-group=inspect] button')].find(x=>x.textContent.trim().endsWith('添加节点')); if(b){b.click();return 'ok';} return 'miss';})()`, settle: 500 }], settleMs: 700 },
  // NOTE: p703-context-menu NOT reproduced — dispatching a synthetic contextmenu
  // event wedges the headless renderer in this build. Kept as original old-UI evidence.
  // NOTE: cad-schematic NOT reproduced — #stDrawing toggles a blank A3 drafting sheet
  // (title block only), not a populated schematic in current build. Kept as original.
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
  const shots = only ? SHOTS.filter((s) => s.name === only) : SHOTS;
  if (!shots.length) throw new Error(`no shot named ${only}`);

  const { procs } = await ensureServerAndEdge();
  const cdp = await Cdp.connect();
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: VIEW.width, height: VIEW.height, deviceScaleFactor: 1, mobile: false,
  });
  await cdp.send('Emulation.setEmulatedMedia', {
    media: 'screen', features: [{ name: 'prefers-color-scheme', value: 'light' }],
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
