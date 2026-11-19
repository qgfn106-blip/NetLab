// 导出保存 e2e：桌面模式必须走原生保存对话框，提示真实路径，取消不假成功。
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { beginFlow, startBackend } from './harness.mjs';

const PORT = Number(process.env.E2E_PORT || 8883);
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
    await sleep(250);
  }
  throw new Error('server did not become healthy');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const backend = await startBackend({ port: PORT, name: 'export_save_ux' });

let browser;
let flow;
let failure = null;
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });

  // 桌面模式桩：不弹真对话框，但记录前端到底把什么内容、什么文件名交给了原生层。
  await page.addInitScript(() => {
    window.__saveCalls = [];
    window.__saveResult = null;
    window.netlabDesktop = {
      saveText: (name, text, callback) => {
        window.__saveCalls.push({ name: String(name), size: String(text).length, head: String(text).slice(0, 40) });
        const result = window.__saveResult === null ? `C:/exports/${name}` : window.__saveResult;
        callback(result);
      },
    };
  });

  await page.route('**/api/export/schematic*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
        filename: 'E2E.svg',
      }),
    });
  });

  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  flow = await beginFlow(browser, page, 'export_save_ux', errors);
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#btnRun', { state: 'visible', timeout: 15000 });
  if (await page.locator('#guideClose').isVisible()) await page.locator('#guideClose').click();

  const toasts = () => page.locator('#toasts').innerText();
  const waitToastsEmpty = async () => {
    await page.waitForFunction(
      () => (document.getElementById('toasts')?.children.length || 0) === 0,
      null,
      { timeout: 12000 },
    );
  };
  const openFileMenu = async () => {
    await page.locator('#menuItems .menu > button').filter({ hasText: '文件' }).click();
  };
  const submitExportDialog = async () => {
    await page.waitForSelector('#modal:not(.hidden) #modalCard .modal-actions .btn.primary', { timeout: 4000 });
    await page.locator('#modal:not(.hidden) #modalCard .modal-actions .btn.primary').click();
  };

  // 1) 原理图导出：应把 SVG 文本交给原生保存层，并提示真实路径。
  await openFileMenu();
  const svgItem = page.locator('.menu.open .menu-item').filter({ hasText: '导出原理图 SVG…' });
  await svgItem.waitFor({ state: 'visible', timeout: 3000 });
  await svgItem.click();
  const firstExport = page.waitForResponse((r) => r.url().includes('/api/export/schematic'), { timeout: 5000 });
  await submitExportDialog();
  await firstExport;
  await page.waitForFunction(
    () => (window.__saveCalls || []).length === 1,
    null,
    { timeout: 5000 },
  );
  await page.waitForFunction(
    () => (document.querySelector('#toasts')?.textContent || '').includes('已导出到 C:/exports/E2E.svg'),
    null,
    { timeout: 5000 },
  );
  const svgCall = await page.evaluate(() => window.__saveCalls[0]);
  assert(svgCall.name === 'E2E.svg', `原理图导出文件名异常: ${svgCall.name}`);
  assert(svgCall.head.includes('<svg'), `原理图导出内容不是 SVG: ${svgCall.head}`);
  assert(!(await toasts()).includes('已交给浏览器下载'), '桌面模式不应走浏览器下载分支');
  await page.keyboard.press('Escape');
  await waitToastsEmpty();

  // 2) 用户取消：什么都不写，也不许出现成功提示。
  await page.evaluate(() => { window.__saveResult = ''; });
  await openFileMenu();
  const svgAgain = page.locator('.menu.open .menu-item').filter({ hasText: '导出原理图 SVG…' });
  await svgAgain.waitFor({ state: 'visible', timeout: 3000 });
  await svgAgain.click();
  const secondExport = page.waitForResponse((r) => r.url().includes('/api/export/schematic'), { timeout: 5000 });
  await submitExportDialog();
  await secondExport;
  await page.waitForFunction(
    () => (window.__saveCalls || []).length === 2,
    null,
    { timeout: 5000 },
  );
  await sleep(600);
  const cancelToasts = await toasts();
  assert(!cancelToasts.includes('已导出'), `取消后仍提示成功: ${cancelToasts}`);
  await page.keyboard.press('Escape');

  // 3) 写盘失败：必须报错，而不是假成功。
  await page.evaluate(() => { window.__saveResult = '__error__磁盘已满'; });
  await openFileMenu();
  const svgFail = page.locator('.menu.open .menu-item').filter({ hasText: '导出原理图 SVG…' });
  await svgFail.waitFor({ state: 'visible', timeout: 3000 });
  await svgFail.click();
  const thirdExport = page.waitForResponse((r) => r.url().includes('/api/export/schematic'), { timeout: 5000 });
  await submitExportDialog();
  await thirdExport;
  await page.waitForFunction(
    () => (document.querySelector('#modalCard .export-error')?.textContent || '').includes('导出失败：磁盘已满'),
    null,
    { timeout: 5000 },
  );
  await page.keyboard.press('Escape');
  await waitToastsEmpty();

  // 4) 场景 JSON 导出同样走原生保存层。
  await page.evaluate(() => { window.__saveResult = null; });
  await openFileMenu();
  const jsonItem = page.locator('.menu.open .menu-item').filter({ hasText: '导出场景 JSON' });
  await jsonItem.waitFor({ state: 'visible', timeout: 3000 });
  await jsonItem.click();
  const jsonResponse = page.waitForResponse((r) => r.url().includes('/api/scene/export'), { timeout: 5000 });
  await submitExportDialog();
  await jsonResponse;
  await page.waitForFunction(
    () => (window.__saveCalls || []).some((call) => String(call.name).endsWith('.json')),
    null,
    { timeout: 8000 },
  );
  const jsonCall = await page.evaluate(
    () => (window.__saveCalls || []).find((call) => String(call.name).endsWith('.json')),
  );
  assert(jsonCall.head.startsWith('{'), `场景 JSON 导出内容异常: ${jsonCall.head}`);
  await page.waitForFunction(
    () => (document.querySelector('#toasts')?.textContent || '').includes('已导出到 C:/exports/'),
    null,
    { timeout: 5000 },
  );
  await page.keyboard.press('Escape');

  // 5) 统一导出窗口的四个维度互相独立，模式切换重算格式，取消不产生副作用。
  await openFileMenu();
  const dialogItem = page.locator('.menu.open .menu-item').filter({ hasText: '导出原理图 SVG…' });
  await dialogItem.waitFor({ state: 'visible', timeout: 3000 });
  await dialogItem.click();
  const dialog = page.locator('#modal:not(.hidden) #modalCard');
  await dialog.waitFor({ state: 'visible', timeout: 4000 });
  assert(await dialog.locator('select').count() === 5, '导出窗口应有 5 个独立选择器');
  assert(await dialog.locator('select[data-role="renderer"]').isDisabled(), '渲染器应固定为 SchemDraw');
  assert(await dialog.locator('select[data-role="format"]').inputValue() === 'svg', '原理图默认格式应为 SVG');
  await dialog.locator('select[data-role="mode"]').selectOption('scene-data');
  assert(await dialog.locator('select[data-role="format"]').inputValue() === 'json', '场景数据默认格式应为 JSON');
  await dialog.locator('select[data-role="mode"]').selectOption('schematic');
  await dialog.locator('select[data-role="style"]').selectOption('classic');
  assert((await dialog.locator('.export-preview').innerText()).includes('经典'), '预览未反映经典样式');
  const beforeCancel = await page.evaluate(() => (window.__saveCalls || []).length);
  await dialog.locator('.modal-actions .btn').filter({ hasText: '取消' }).click();
  assert(await page.locator('#modal').evaluate((el) => el.classList.contains('hidden')), '取消后窗口应关闭');
  assert(await page.evaluate(() => (window.__saveCalls || []).length) === beforeCancel, '取消不应触发保存');

  assert(errors.length === 0, `页面控制台报错: ${errors.join(' | ')}`);
  console.log('export save e2e: OK (schematic path, cancel silence, failure error, scene json, dialog constraints)');
} catch (error) {
  failure = error;
  throw error;
} finally {
  if (flow) await flow.finish({ status: failure || errors.length ? 'failed' : 'ok', error: failure });
  if (browser) await browser.close();
  await backend.stop();
}
