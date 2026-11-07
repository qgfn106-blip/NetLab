// Interactive UI probe for Netlab docs screenshots (dev-only, no runtime deps).
// Reuses the same headless-Edge + CDP plumbing as capture.mjs but lets you
// survey the live current UI one step at a time while authoring new shots.
//
// Prereq: a server on :8010 and a CDP endpoint on :9333 must already be up
//   (start them by running `node tools/screenshots/capture.mjs --serve` once,
//    or `node tools/screenshots/probe.mjs --boot`).
//
// Usage:
//   node tools/screenshots/probe.mjs --template rlc_series --out tmp.png
//   node tools/screenshots/probe.mjs --template trip_unit --panel analysis/chart \
//        --eval "(()=>{document.querySelector('#btnRun').click();return 'run';})()" --wait 3000 --out tmp.png
//   node tools/screenshots/probe.mjs --evalfile C:\tmp\step.js --out tmp.png --wait 800
//   node tools/screenshots/probe.mjs --list                  # list /api/templates
//
// Prints whatever the --eval expression returns (JSON) to stdout.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const APP = process.env.NETLAB_APP || 'http://127.0.0.1:8010';
const CDP = process.env.NETLAB_CDP || 'http://127.0.0.1:9333';
const VIEW = { width: 1440, height: 900 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    let list = await (await fetch(`${CDP}/json/list`)).json();
    let page = null;
    // Prefer a FRESH tab so a wedged old renderer can never block the probe.
    try {
      page = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
    } catch { /* fall back to existing */ }
    if (!page || !page.webSocketDebuggerUrl) {
      page = list.find((t) => t.type === 'page' && t.url.startsWith(APP))
        || list.find((t) => t.type === 'page' && t.url === 'about:blank')
        || list.find((t) => t.type === 'page');
    }
    if (!page || !page.webSocketDebuggerUrl) throw new Error(`no usable page target (targets: ${list.map(t => t.type + ':' + t.url).join(', ')})`);
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
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (res.exceptionDetails) {
      const d = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
      throw new Error(`JS eval failed: ${d}`);
    }
    return res.result?.value;
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

async function clickAt(cdp, x, y) {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
  }
  await sleep(500);
}
async function selectNode(cdp, id) {
  const info = await cdp.eval(`(()=>{const c=document.querySelector('#graph');const cr=c.getBoundingClientRect();const n=(window.__netlabDebug.state.scene.nodes||[]).find(n=>n.id===${JSON.stringify(id)})||(window.__netlabDebug.state.scene.nodes||[])[0];const s=window.__netlabDebug.worldToScreen(n.position);return JSON.stringify({x:cr.x+s.x,y:cr.y+s.y,id:n.id});})()`);
  const p = JSON.parse(info); await clickAt(cdp, p.x, p.y); return p.id;
}
async function selectEdge(cdp, id) {
  const info = await cdp.eval(`(()=>{const c=document.querySelector('#graph');const cr=c.getBoundingClientRect();const e=(window.__netlabDebug.state.scene.edges||[]).find(e=>e.id===${JSON.stringify(id)})||(window.__netlabDebug.state.scene.edges||[])[0];const pts=window.__netlabDebug.edgePathPoints(e)||[];if(!pts.length)return JSON.stringify({err:'no pts'});const a=pts[Math.floor(pts.length/2)]||pts[0];const mx=a.x,my=a.y;return JSON.stringify({x:cr.x+mx,y:cr.y+my,id:e.id});})()`);
  const p = JSON.parse(info); if (p.err) throw new Error('selectEdge '+id+': '+p.err); await clickAt(cdp, p.x, p.y); return p.id;
}
async function menuClick(cdp, label) {
  const r = await cdp.eval(`(()=>{const b=[...document.querySelectorAll('.menu-item')].find(x=>((x.querySelector('strong')&&x.querySelector('strong').textContent)||x.textContent||'').trim().startsWith(${JSON.stringify(label)}));if(!b)return 'miss';b.click();return 'ok';})()`);
  await sleep(500); return r;
}
async function runFor(cdp, ms) {
  await cdp.eval(`(()=>{document.querySelector('#btnRun')?.click();return true;})()`); await sleep(250);
  await cdp.eval(`(()=>{const w=document.getElementById('runWarnWin');if(w){const b=w.querySelector('#runWarnRun');if(b)b.click();}})()`);
  await sleep(ms);
  await cdp.eval(`(()=>{const b=document.querySelector('#btnRun');const t=b&&b.textContent||'';if(/暂停|Pause|运行中/i.test(t))b.click();})()`); await sleep(400);
}

function arg(name, def = null) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const has = (name) => process.argv.includes('--' + name);

async function waitApp(cdp, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const ok = await cdp.eval("document.readyState==='complete' && !!document.querySelector('#btnRun') && !!window.__netlabDebug");
      if (ok) { await sleep(800); return true; }
    } catch { /* nav */ }
    await sleep(250);
  }
  throw new Error('app did not boot');
}

async function main() {
  if (has('list')) {
    const r = await fetch(`${APP}/api/templates`);
    const j = await r.json();
    const items = Array.isArray(j) ? j : (j.templates || j.items || []);
    console.log(items.map(t => (typeof t === 'string' ? t : JSON.stringify(t))).join('\n'));
    return;
  }
  const cdp = await Cdp.connect();
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: VIEW.width, height: VIEW.height, deviceScaleFactor: 1, mobile: false });

  const tpl = arg('template');
  if (tpl) {
    await fetch(`${APP}/api/templates/${encodeURIComponent(tpl)}`, { method: 'POST' });
  }
  const sceneFile = arg('scenefile');
  if (sceneFile) {
    const body = fs.readFileSync(sceneFile, 'utf8');
    const r = await fetch(`${APP}/api/scene`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    console.log('SCENE-LOAD', r.ok ? 'ok' : ('fail ' + r.status));
  }
  await cdp.send('Page.navigate', { url: `${APP}/` });
  await waitApp(cdp);
  await cdp.eval(`(()=>{const g=document.querySelector('#guide'); if(g&&!g.hidden){document.querySelector('#guideNever')?.click();document.querySelector('#guideEnter')?.click();} window.__netlabDebug.state.prefs.runWarn=false; return true;})()`);
  await sleep(300);
  // Dismiss the "发现自动保存的工程" recovery confirm modal if it popped up (no-op otherwise).
  for (let i = 0; i < 4; i++) {
    const r = await cdp.eval(`(()=>{for(const m of document.querySelectorAll('.modal,[class*=modal]')){if(m.classList.contains('hidden')||m.offsetParent===null)continue;const b=[...m.querySelectorAll('button')].find(x=>x.textContent.trim()==='取消');if(b){b.click();return 'dismissed';}}return 'none';})()`);
    if (r === 'dismissed') { await sleep(250); break; }
    await sleep(200);
  }

  const panel = arg('panel');
  if (panel) {
    const [group, sub] = panel.split('/');
    await cdp.eval(`(()=>{document.querySelector('.panel-tab[data-group=${JSON.stringify(group)}]')?.click();})()`);
    await sleep(150);
    if (sub) { await cdp.eval(`(()=>{document.querySelector('.group-subnav button[data-sub=${JSON.stringify(sub)}]')?.click();})()`); await sleep(150); }
  }

  const pre = arg('pre'); if (pre) { console.log('PRE', await cdp.eval(fs.readFileSync(pre, 'utf8'))); }
  const menuLabel = arg('menu'); if (menuLabel) { console.log('MENU', await menuClick(cdp, menuLabel)); }
  const statusIds = arg('status'); if (statusIds) { for (const sid of statusIds.split(',')) { await cdp.eval(`(()=>{document.getElementById(${JSON.stringify(sid)})?.click();})()`); await sleep(400); } }
  const selName = arg('selectname');
  if (selName) { const id = await cdp.eval(`(()=>{const n=(window.__netlabDebug.state.scene.nodes||[]).find(n=>n.name===${JSON.stringify(selName)});return n?n.id:null;})()`); console.log('SELECTNAME', selName, id ? (await selectNode(cdp, id)) : 'MISS'); }
  const selNode = arg('selectnode'); if (selNode) console.log('SELECTNODE', await selectNode(cdp, selNode));
  const selEdge = arg('selectedge'); if (selEdge) console.log('SELECTEDGE', await selectEdge(cdp, selEdge));
  const runMs = arg('run'); if (runMs) { await runFor(cdp, Number(runMs)); }

  let expr = arg('eval');
  const ef = arg('evalfile');
  if (ef) expr = fs.readFileSync(ef, 'utf8');
  if (expr) {
    const out = await cdp.eval(expr);
    console.log('EVAL =>', typeof out === 'string' ? out : JSON.stringify(out));
  }
  const wait = Number(arg('wait', '600'));
  await sleep(wait);

  const outFile = arg('out');
  if (outFile) {
    const clip = { x: 0, y: 0, width: Number(arg('w', VIEW.width)), height: Number(arg('h', VIEW.height)), scale: 1 };
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, clip });
    fs.writeFileSync(outFile, Buffer.from(shot.data, 'base64'));
    console.log('saved', outFile, fs.statSync(outFile).size, 'bytes');
  }
  cdp.close();
  process.exit(0);
}
main().catch((e) => { console.error('PROBE FAILED:', e.message); process.exit(1); });
