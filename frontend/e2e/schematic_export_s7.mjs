// S7 E2E：复杂桥式整流 fixture 经真实后端导出 SVG，并验证结构层与 XML 可解析。
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { beginFlow, startBackend } from './harness.mjs';

const PORT = Number(process.env.E2E_PORT || 8893);
const BASE = `http://127.0.0.1:${PORT}`;
const errors = [];
const SCENE = JSON.parse(
  readFileSync(new URL('../../netlab/tests/fixtures/schematic_export/bridge_rectifier.json', import.meta.url), 'utf8'),
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const backend = await startBackend({ port: PORT, name: 'schematic_export_s7' });
let browser;
let flow;
let failure = null;
try {
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await page.addInitScript(() => {
    window.__saveTexts = [];
    window.netlabDesktop = {
      saveText: (name, text, callback) => {
        window.__saveTexts.push({ name: String(name), text: String(text) });
        callback(`C:/exports/${name}`);
      },
    };
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  flow = await beginFlow(browser, page, 'schematic_export_s7', errors);
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#btnRun', { state: 'visible', timeout: 15000 });
  if (await page.locator('#guideClose').isVisible()) await page.locator('#guideClose').click();

  await page.locator('#menuItems .menu > button').filter({ hasText: '文件' }).click();
  const item = page.locator('.menu.open .menu-item').filter({ hasText: '导出原理图 SVG…' });
  await item.waitFor({ state: 'visible', timeout: 3000 });
  await item.click();
  const responsePromise = page.waitForResponse((response) => response.url().includes('/api/export/schematic'), { timeout: 15000 });
  await page.waitForSelector('#modal:not(.hidden) #modalCard .modal-actions .btn.primary', { timeout: 4000 });
  await page.locator('#modal:not(.hidden) #modalCard .modal-actions .btn.primary').click();
  const response = await responsePromise;
  assert(response.ok(), `schematic export failed: ${response.status()}`);
  await page.waitForFunction(() => (window.__saveTexts || []).length === 1, null, { timeout: 8000 });
  const saved = await page.evaluate(() => window.__saveTexts[0]);
  assert(saved.name.endsWith('.svg'), `unexpected filename: ${saved.name}`);
  assert(saved.text.includes('id="netlab-structure"'), 'missing structure layer');
  assert(saved.text.includes('data-name="D1"'), 'missing device symbol');
  const structure = await page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const error = doc.querySelector('parsererror');
    const symbols = doc.querySelectorAll('g.netlab-symbol').length;
    const wires = doc.querySelectorAll('g.netlab-wire').length;
    const junctions = doc.querySelectorAll('circle.netlab-junction').length;
    const crossings = doc.querySelectorAll('circle.netlab-crossing').length;
    return { error: error ? error.textContent : '', symbols, wires, junctions, crossings };
  }, saved.text);
  assert(!structure.error, `SVG XML parse error: ${structure.error}`);
  assert(structure.symbols === 6, `symbols=${structure.symbols}`);
  assert(structure.wires === 12, `wires=${structure.wires}`);
  assert(structure.junctions === 3, `junctions=${structure.junctions}`);
  assert(structure.crossings === 0, `crossings=${structure.crossings}`);
  assert((await page.locator('#toasts').innerText()).includes('已导出到 C:/exports/'), 'missing success toast');
  console.log('schematic export s7 e2e: OK (structure layer, 6 symbols, 12 wires, 3 junctions)');
} catch (error) {
  failure = error;
  throw error;
} finally {
  if (flow) await flow.finish({ status: failure ? 'failed' : 'ok', error: failure });
  if (browser) await browser.close();
  await backend.stop();
}
