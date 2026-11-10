// 电路小信号旁路分析端到端：真实浏览器 + 真实后端 + descriptor 线性化。
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.E2E_PORT || 8878);
const BASE = `http://127.0.0.1:${PORT}`;
const errors = [];

const SCENE = {
  mode: 'circuit',
  integration: 'trapezoidal',
  solve_algebraic: false,
  nodes: [
    { id: '4f7d178cd2b2', name: 'gnd', kind: 'ground', params: {}, data: {}, position: { x: 220, y: 0 }, size: {} },
    { id: '8065bebd6593', name: 'vin', kind: 'node', params: {}, data: {}, position: { x: 165, y: 99 }, size: {} },
    { id: '172249d8009d', name: 'out', kind: 'node', params: {}, data: {}, position: { x: 29, y: 149 }, size: {} },
  ],
  edges: [
    {
      id: 'd17a4fb90c0d', name: 'V1', source: '8065bebd6593', target: '4f7d178cd2b2', kind: 'vsource',
      source_pin: '', target_pin: '', source_port: '', target_port: '',
      params: { wave: 'dc', offset: 0, amplitude: 1, frequency: 10, phase: 0, duty: 0.5, delay: 0 },
      delay: false, auto_delay: false, enabled: true, route: 'auto', waypoints: [], anchors: {}, layout: {},
    },
    {
      id: '1094674cfb6b', name: 'R1', source: '8065bebd6593', target: '172249d8009d', kind: 'resistor',
      source_pin: '', target_pin: '', source_port: '', target_port: '',
      params: { R: 1000 }, delay: false, auto_delay: false, enabled: true,
      route: 'auto', waypoints: [], anchors: {}, layout: {},
    },
    {
      id: 'eacfcfa1d63f', name: 'C1', source: '172249d8009d', target: '4f7d178cd2b2', kind: 'capacitor',
      source_pin: '', target_pin: '', source_port: '', target_port: '',
      params: { C: 1e-6, v0: 0 }, delay: false, auto_delay: false, enabled: true,
      route: 'auto', waypoints: [], anchors: {}, layout: {},
    },
  ],
  blocks: [],
};

async function waitHealth(timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {}
    await sleep(300);
  }
  throw new Error('server did not become healthy');
}

async function canvasHasInk(page, selector) {
  return page.locator(selector).evaluate((canvas) => {
    const ctx = canvas.getContext('2d');
    if (!ctx || !canvas.width || !canvas.height) return false;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] > 0 && (data[index] < 245 || data[index + 1] < 245 || data[index + 2] < 245)) {
        return true;
      }
    }
    return false;
  });
}

const server = spawn(
  process.env.PYTHON || 'python',
  ['-m', 'uvicorn', 'netlab.server:app', '--port', String(PORT), '--log-level', 'warning'],
  {
    cwd: new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    env: { ...process.env, PYTHONPATH: '.' },
    stdio: 'ignore',
  },
);

let browser;
try {
  await waitHealth();
  const imported = await fetch(`${BASE}/api/scene`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(SCENE),
  });
  if (!imported.ok) throw new Error(`scene import failed: ${imported.status}`);

  const launchOpts = process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {};
  try {
    browser = await chromium.launch(launchOpts);
  } catch (error) {
    if (process.env.E2E_CHANNEL) throw error;
    browser = await chromium.launch({ channel: 'msedge' });
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#btnRun', { state: 'visible', timeout: 15000 });
  if (await page.locator('#guideClose').isVisible()) await page.locator('#guideClose').click();
  await page.getByText('工具', { exact: true }).click();
  await page.getByText('小信号分析（旁路）…', { exact: true }).click({ force: true });
  await page.waitForSelector('#analWin', { state: 'visible', timeout: 5000 });
  if (!(await page.locator('[data-anal="bypass"]').evaluate((el) => el.classList.contains('active')))) {
    throw new Error('bypass tab is not active');
  }

  await page.selectOption('#analBypassInput', 'V1');
  await page.selectOption('#analBypassOutput', 'out');
  await page.click('#analRunBypass');
  await page.waitForFunction(
    () => (document.querySelector('#analBypassMeta')?.textContent || '').includes('极点'),
    null,
    { timeout: 15000 },
  );

  const poles = await page.locator('#analBypassPoles').innerText();
  if (!poles.includes('-1000')) throw new Error(`pole table missing -1000: ${poles}`);
  if (!(await canvasHasInk(page, '#analBypassBode'))) throw new Error('Bode canvas is empty');
  if (!(await canvasHasInk(page, '#analBypassStep'))) throw new Error('step canvas is empty');

  await page.click('#analRunBypassBode');
  await sleep(300);
  if (!(await canvasHasInk(page, '#analBypassBode'))) throw new Error('Bode canvas is empty after Bode run');
  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);

  console.log('circuit bypass e2e: OK (poles, Bode, step)');
} finally {
  if (browser) await browser.close();
  server.kill();
}
