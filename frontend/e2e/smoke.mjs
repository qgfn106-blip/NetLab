// G3-L1：真实浏览器加载前端，断言可见行为而非源码字符串。
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { beginFlow, startBackend } from './harness.mjs';

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

const backend = await startBackend({ port: PORT, name: 'smoke' });

let browser;
let flow;
let failure = null;
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
  flow = await beginFlow(browser, page, 'smoke', errors);

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#btnRun', { state: 'visible', timeout: 15000 });
  if (!(await page.locator('#stage').isVisible())) throw new Error('#stage not visible');

  await page.waitForFunction(() => document.querySelectorAll('#menuItems > *').length > 0, null, { timeout: 5000 });
  const menuCount = await page.locator('#menuItems > *').count();
  if (menuCount < 1) throw new Error('menubar is empty; errors=' + JSON.stringify(errors));

  // 真实交互：点「适配」，不应抛错、画布仍在。
  await page.click('#btnFit', { force: true });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (!(await page.locator('#stage').isVisible())) throw new Error('#stage disappeared after fit');

  const health = await (await fetch(`${BASE}/api/health`)).json();
  if (!health.ok) throw new Error('health not ok');
  if (errors.length) throw new Error('console/page errors:\n' + errors.join('\n'));
  console.log(`OK: L1 smoke passed (menu=${menuCount}, health=${JSON.stringify(health)})`);
} catch (error) {
  failure = error;
  throw error;
} finally {
  if (flow) await flow.finish({ status: failure || errors.length ? 'failed' : 'ok', error: failure });
  if (browser) await browser.close();
  await backend.stop();
}
