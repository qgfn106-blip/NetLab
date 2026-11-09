// G3-L1：真实浏览器加载前端，断言可见行为而非源码字符串。
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.E2E_PORT || 8877);
const BASE = `http://127.0.0.1:${PORT}`;
const errors = [];

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

const server = spawn(
  process.env.PYTHON || 'python',
  ['-m', 'uvicorn', 'netlab.server:app', '--port', String(PORT), '--log-level', 'warning'],
  { cwd: new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), env: { ...process.env, PYTHONPATH: '.' }, stdio: 'ignore' }
);

let browser;
try {
  await waitHealth();
  const launchOpts = process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {};
  try {
    browser = await chromium.launch(launchOpts);
  } catch (error) {
    if (process.env.E2E_CHANNEL) throw error;
    browser = await chromium.launch({ channel: 'msedge' });
  }
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#btnRun', { state: 'visible', timeout: 15000 });
  if (!(await page.locator('#stage').isVisible())) throw new Error('#stage not visible');

  await sleep(1000);
  const menuCount = await page.locator('#menuItems > *').count();
  if (menuCount < 1) throw new Error('menubar is empty; errors=' + JSON.stringify(errors));

  // 真实交互：点「适配」，不应抛错、画布仍在。
  await page.click('#btnFit', { force: true });
  await sleep(300);
  if (!(await page.locator('#stage').isVisible())) throw new Error('#stage disappeared after fit');

  const health = await (await fetch(`${BASE}/api/health`)).json();
  if (!health.ok) throw new Error('health not ok');
  if (errors.length) throw new Error('console/page errors:\n' + errors.join('\n'));
  console.log(`OK: L1 smoke passed (menu=${menuCount}, health=${JSON.stringify(health)})`);
} finally {
  if (browser) await browser.close();
  server.kill();
}
