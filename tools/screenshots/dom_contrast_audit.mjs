// Real-rendered DOM text-contrast audit for the Netlab frontend.
// Dev-only tool (no runtime deps). Reuses the headless-Edge + CDP plumbing style
// of capture.mjs, but drives its OWN server+edge lifecycle:
//   - kills stale listeners on :8010 / :9333
//   - deletes the Edge user-data-dir (stale CSS cache => false failures)
//   - starts a fresh server (python -m netlab.run --no-browser --port 8010)
//   - starts a fresh headless Edge with a brand-new profile
//   - tears both down at exit (same lifecycle as the audit)
//
// For each theme it PATCHes /api/settings {theme} (server wins over localStorage,
// so applyAppearance() really re-tints incl. inline --paper/--accent vars), then
// boots the page, walks every visible text node and checks WCAG contrast.
//
// Usage:
//   node tools/screenshots/dom_contrast_audit.mjs                # both themes
//   node tools/screenshots/dom_contrast_audit.mjs --theme light
//   node tools/screenshots/dom_contrast_audit.mjs --theme dark
//   node tools/screenshots/dom_contrast_audit.mjs --keep         # keep server/edge
//
// Output JSON + PNGs under NetlabExtras/scratch/ui-audit/<theme>/ .
// Exit code 0 iff every audited theme has 0 failures.
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..'); // .../NetlabHome
const APP = process.env.NETLAB_APP || 'http://127.0.0.1:8010';
const CDP = process.env.NETLAB_CDP || 'http://127.0.0.1:9333';
const EDGE = process.env.NETLAB_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const VIEW = { width: 1440, height: 900 };
const OUTROOT = path.resolve(ROOT, '..', 'NetlabExtras', 'scratch', 'ui-audit');
const PROFILE = path.resolve(ROOT, '..', 'NetlabExtras', 'scratch', 'edge-audit-profile');
const SCAN_FILE = path.resolve(__dirname, 'dom_audit_scan.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- process control -------------------------------------------------------
function killPort(port) {
  let out = '';
  try {
    out = execSync(`netstat -ano -p tcp | findstr :${port}`, { encoding: 'utf8' });
  } catch (e) { return; }
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || !/LISTENING/i.test(t)) continue;
    const m = t.match(/(\d+)\s*$/);
    if (m) pids.add(m[1]);
  }
  for (const pid of pids) {
    try { execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore' }); console.log(`  killed pid ${pid} on :${port}`); }
    catch (e) { /* ignore */ }
  }
}

async function waitHttp(url, tries) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return true; } catch (e) { /* not up */ }
    await sleep(500);
  }
  return false;
}

// ---- CDP client ------------------------------------------------------------
class Cdp {
  constructor(ws) {
    this.ws = ws; this.seq = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (!msg.id) return;
      const e = this.pending.get(msg.id);
      if (!e) return;
      this.pending.delete(msg.id);
      if (msg.error) e.reject(new Error(msg.error.message));
      else e.resolve(msg.result);
    });
  }
  static async connect() {
    let page = null;
    try {
      const fresh = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
      if (fresh && fresh.webSocketDebuggerUrl) page = fresh;
    } catch (e) { /* fall back */ }
    if (!page) {
      const list = await (await fetch(`${CDP}/json/list`)).json();
      page = list.find((t) => t.type === 'page' && t.url.startsWith(APP)) || list.find((t) => t.type === 'page');
      if (!page) throw new Error('no netlab page target');
    }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
    const cdp = new Cdp(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: VIEW.width, height: VIEW.height, deviceScaleFactor: 1, mobile: false });
    return cdp;
  }
  send(method, params) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) throw new Error('eval error: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

// ---- page helpers ----------------------------------------------------------
async function waitApp(cdp) {
  for (let i = 0; i < 100; i++) {
    try {
      const ok = await cdp.eval("document.readyState==='complete' && !!document.querySelector('#btnRun') && !!window.__netlabDebug");
      if (ok) { await sleep(900); return; }
    } catch (e) { /* not ready */ }
    await sleep(150);
  }
  throw new Error('app did not become ready');
}
async function dismissGuide(cdp) {
  const vis = await cdp.eval("(()=>{const g=document.querySelector('#guide');if(!g)return 'none';const s=getComputedStyle(g);return (g.hidden||s.display==='none')?'none':'vis';})()");
  if (vis === 'vis') {
    await cdp.eval("(()=>{const b=document.querySelector('#guideNever');if(b)b.click();return 1;})()");
    await sleep(200);
    await cdp.eval("(()=>{const b=document.querySelector('#guideEnter');if(b)b.click();return 1;})()");
    await sleep(200);
  }
  return vis;
}

// ---- settings (theme is forced through the server so applyAppearance re-tints)
async function getSettings() {
  const r = await fetch(`${APP}/api/settings`);
  return (await r.json()).settings;
}
async function patchSettings(obj) {
  const r = await fetch(`${APP}/api/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
  return (await r.json()).settings;
}

// ---- scenario actions ------------------------------------------------------
async function closeOverlays(cdp) {
  await cdp.eval("(()=>{const w=document.getElementById('settingsWin');if(w)w.hidden=true;document.querySelectorAll('.menu.open').forEach(m=>m.classList.remove('open'));return 1;})()");
  await sleep(150);
}
async function openMenuByLabel(cdp, label) {
  const r = await cdp.eval(`(()=>{const ms=[...document.querySelectorAll('#menuItems > .menu')];for(const m of ms){const b=m.querySelector('button');if(b&&(b.textContent||'').trim().startsWith(${JSON.stringify(label)})){b.click();return 'ok';}}return 'miss';})()`);
  await sleep(400);
  return r;
}
async function openMenuByIndex(cdp, i) {
  const r = await cdp.eval(`(()=>{const ms=[...document.querySelectorAll('#menuItems > .menu')];const m=ms[${i}];if(!m)return 'miss';m.querySelector('button').click();return (m.querySelector('button').textContent||'').trim();})()`);
  await sleep(400);
  return r;
}
async function clickMenuItem(cdp, label) {
  const r = await cdp.eval(`(()=>{const b=[...document.querySelectorAll('.menu-item')].find(x=>((x.querySelector('strong')?.textContent)||x.textContent||'').trim().startsWith(${JSON.stringify(label)}));if(!b)return 'miss';b.click();return 'ok';})()`);
  await sleep(500);
  return r;
}
async function clickSettingsPane(cdp, pane) {
  await cdp.eval(`(()=>{const b=document.querySelector('#settingsWin .setwin-nav button[data-pane=${JSON.stringify(pane)}]');if(b)b.click();return 1;})()`);
  await sleep(300);
}
async function clickPanelTab(cdp, group) {
  await cdp.eval(`(()=>{const b=document.querySelector('.panel-tab[data-group=${JSON.stringify(group)}]');if(b)b.click();return 1;})()`);
  await sleep(300);
}
async function selectNodeByName(cdp, name) {
  const info = await cdp.eval(`(()=>{const nodes=(window.__netlabDebug.state.scene.nodes||[]);const n=nodes.find(x=>x.name===${JSON.stringify(name)})||nodes[0];if(!n)return JSON.stringify({err:'no node'});const c=document.querySelector('#graph');const cr=c.getBoundingClientRect();const s=window.__netlabDebug.worldToScreen(n.position);return JSON.stringify({x:cr.x+s.x,y:cr.y+s.y,id:n.id,name:n.name});})()`);
  const p = JSON.parse(info);
  if (p.err) throw new Error(p.err);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: Math.round(p.x), y: Math.round(p.y), button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
  }
  await sleep(550);
  return p.id;
}

// ---- scan one scenario -----------------------------------------------------
let SCAN_SRC = '';
async function scan(cdp, theme, name, log) {
  const dir = path.join(OUTROOT, theme);
  fs.mkdirSync(dir, { recursive: true });
  const has = await cdp.eval("typeof window.__auditScan==='function'");
  if (!has) await cdp.eval(SCAN_SRC);
  const png = path.join(dir, name + '.png');
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(png, Buffer.from(shot.data, 'base64'));
  const res = await cdp.eval('window.__auditScan()');
  log.push({ scenario: name, screenshot: png, checked: res.checked, failures: res.failures.length });
  return res;
}

// ---- full scenario suite for one theme -------------------------------------
async function runTheme(cdp, theme) {
  const log = [];
  const allFailures = [];
  await patchSettings({ theme });
  await cdp.send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-color-scheme', value: theme }] });
  await cdp.send('Page.navigate', { url: `${APP}/` });
  await waitApp(cdp);
  await dismissGuide(cdp);
  const dsTheme = await cdp.eval("document.documentElement.dataset.theme");
  const paper = await cdp.eval("getComputedStyle(document.documentElement).getPropertyValue('--paper').trim()");
  if (dsTheme !== theme) throw new Error(`theme mismatch: expected ${theme}, page reports ${dsTheme}`);
  const table = [];
  const acc = async (name) => {
    const res = await scan(cdp, theme, name, log);
    for (const f of res.failures) allFailures.push(Object.assign({ scenario: name }, f));
    table.push(res);
  };

  // 1. main default (inspector empty state visible by default, 0 nodes)
  await closeOverlays(cdp);
  await clickPanelTab(cdp, 'inspect');
  await acc('main-default');

  // 2. top menubar dropdown opened (first menu) + specific menus
  await openMenuByIndex(cdp, 0); await acc('menu-first'); await closeOverlays(cdp);
  for (const [label, tag] of [['仿真', 'menu-sim'], ['分析', 'menu-analysis'], ['工具', 'menu-tools'], ['设置', 'menu-settings'], ['帮助', 'menu-help']]) {
    const ok = await openMenuByLabel(cdp, label);
    if (ok === 'ok') await acc(tag);
    await closeOverlays(cdp);
  }

  // 3. settings dialog panes
  await openMenuByLabel(cdp, '设置');
  await clickMenuItem(cdp, '工程设置');
  await acc('settings-project');
  for (const pane of ['view', 'interact', 'diag']) {
    await clickSettingsPane(cdp, pane);
    await acc('settings-' + pane);
  }
  await closeOverlays(cdp);

  // 4. inspector empty (explicit)
  await clickPanelTab(cdp, 'inspect');
  await acc('inspector-empty');

  // 5. selected-node state: load a template, reload, click a node
  try {
    await fetch(`${APP}/api/templates/rlc_series`, { method: 'POST' });
    await sleep(250);
    await cdp.send('Page.navigate', { url: `${APP}/` });
    await waitApp(cdp);
    await dismissGuide(cdp);
    await closeOverlays(cdp);
    const id = await selectNodeByName(cdp, 'R1');
    const sel = await cdp.eval("(()=>{try{return (window.__netlabDebug.state.ui && (window.__netlabDebug.state.ui.selection||window.__netlabDebug.state.ui.selected))||null;}catch(e){return null;}})()");
    log.push({ scenario: 'select-node-meta', nodeId: id });
    await acc('inspector-selected');
    // analysis panel with a loaded scene
    await clickPanelTab(cdp, 'analysis');
    await acc('analysis-panel');
  } catch (e) {
    log.push({ scenario: 'selected-node', error: String(e) });
  }

  return { theme, paper, pageTheme: dsTheme, scenarios: log, failures: allFailures };
}

// ---- main ------------------------------------------------------------------
async function main() {
  const argv = process.argv.slice(2);
  const getArg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const themeArg = getArg('--theme');
  const keep = argv.includes('--keep');
  const themes = themeArg ? [themeArg] : ['light', 'dark'];

  fs.mkdirSync(OUTROOT, { recursive: true });
  SCAN_SRC = fs.readFileSync(SCAN_FILE, 'utf8');

  const orig = await (async () => { try { return await getSettings(); } catch (e) { return null; } })();
  const origTheme = orig && orig.theme ? orig.theme : 'light';

  let procs = [];
  let cdp = null;
  let exitCode = 0;
  try {
    console.log('== killing stale listeners on :8010 / :9333 ==');
    killPort(8010); killPort(9333);
    await sleep(500);
    console.log('== resetting Edge profile ==');
    fs.rmSync(PROFILE, { recursive: true, force: true });

    console.log('== starting fresh server ==');
    const py = spawn('python', ['-m', 'netlab.run', '--no-browser', '--port', '8010', '--log-level', 'warning'], { cwd: ROOT, stdio: 'ignore', env: Object.assign({}, process.env, { PYTHONUTF8: '1' }) });
    procs.push(py);
    if (!(await waitHttp(`${APP}/api/health`, 160))) throw new Error('server did not come up on :8010');
    console.log('   server up');

    console.log('== launching fresh headless Edge ==');
    const ed = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9333', '--remote-allow-origins=*', '--window-size=1440,900', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${PROFILE}`, `${APP}/`], { stdio: 'ignore' });
    procs.push(ed);
    if (!(await waitHttp(`${CDP}/json/list`, 160))) throw new Error('CDP did not come up on :9333');
    console.log('   edge up');

    cdp = await Cdp.connect();
    await cdp.eval(SCAN_SRC);

    for (const theme of themes) {
      console.log(`\n===== AUDIT: ${theme} =====`);
      const rep = await runTheme(cdp, theme);
      const dir = path.join(OUTROOT, theme);
      fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(rep, null, 2));
      console.log(`   theme=${rep.pageTheme} paper=${rep.paper} scenarios=${rep.scenarios.length} failures=${rep.failures.length}`);
      for (const sc of rep.scenarios) {
        const n = sc.failures != null ? sc.failures : '-';
        console.log(`     - ${sc.scenario}: checked=${sc.checked != null ? sc.checked : '-'} failures=${n}`);
      }
      if (rep.failures.length) {
        console.log('   --- failures (worst first) ---');
        for (const f of rep.failures.slice(0, 60)) {
          console.log(`   [${f.scenario}] ${f.ratio} < ${f.thr} (${f.basis}) fg=${f.fg} bg=${f.bg} src=${f.bgSource} | ${f.sel} | "${f.text}"`);
        }
        exitCode = 1;
      }
    }
  } catch (e) {
    console.error('AUDIT ERROR:', e && e.stack || e);
    exitCode = 2;
  } finally {
    try { if (origTheme) await patchSettings({ theme: origTheme }); } catch (e) { /* ignore */ }
    if (!keep) {
      console.log('\n== shutting down server/edge ==');
      for (const p of procs.reverse()) { try { p.kill(); } catch (e) { /* ignore */ } }
      killPort(8010); killPort(9333);
    }
  }
  console.log(`\nAUDIT DONE exit=${exitCode}  reports in ${OUTROOT}`);
  process.exit(exitCode);
}

main();
