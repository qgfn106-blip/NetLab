// 六项前端 UX e2e：mode 入口、旁路指标/传函、坐标轴、导出入口、统一预计算。
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { beginFlow, startBackend } from './harness.mjs';

const PORT = Number(process.env.E2E_PORT || 8879);
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

const backend = await startBackend({ port: PORT, name: 'analysis_ux' });

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
  let exportCalls = 0;
  await page.route('**/api/export/schematic*', async (route) => {
    exportCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', filename: 'E2E.svg' }),
    });
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  flow = await beginFlow(browser, page, 'analysis_ux', errors);

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#btnRun', { state: 'visible', timeout: 15000 });
  if (await page.locator('#guideClose').isVisible()) await page.locator('#guideClose').click();

  // 1) 电路模式「推导」入口进入统一分析工作台（PlotKit 渲染，无旧 Canvas 图表）。
  await page.locator('.panel-tab[data-group="analysis"]').click();
  await page.locator('button[data-sub="analysis"]').click();
  await page.getByRole('button', { name: '推导', exact: true }).click();
  await page.waitForSelector('#analWin', { state: 'visible', timeout: 5000 });
  assert(await page.locator('[data-anal="workbench"]').evaluate((el) => el.classList.contains('active')), 'mode 入口未切到 workbench tab');
  await page.waitForSelector('#analWorkbench.awb', { state: 'visible', timeout: 15000 });

  // 2) 工作台必须由 PlotKit 画布承载，旧分析 Canvas 已退役且不回退。
  await page.waitForSelector('.analysis-chart-canvas', { state: 'visible', timeout: 20000 });
  assert(await page.locator('.analysis-chart-canvas').count() > 0, 'PlotKit 分析画布缺失');
  for (const retired of ['#analAcCanvas', '#analBypassBode', '#analBypassStep', '#analRunBypass']) {
    assert(await page.locator(retired).count() === 0, `旧分析画布仍在: ${retired}`);
  }

  // 3) 读数与关键点证据应由后端 envelope 提供。
  await page.waitForFunction(() => (document.querySelector('.analysis-chart-readout')?.textContent || '').includes('滚轮缩放'), null, { timeout: 15000 });
  const chartBox = await page.locator('.analysis-chart-canvas').boundingBox();
  assert(chartBox, '分析画布没有布局尺寸');
  await page.mouse.move(chartBox.x + chartBox.width * 0.45, chartBox.y + chartBox.height * 0.35, { steps: 3 });
  await page.waitForFunction(() => /f\s*=\s*\d/.test(document.querySelector('.analysis-chart-readout')?.textContent || ''), null, { timeout: 8000 });
  const readout = await page.locator('.analysis-chart-readout').innerText();
  assert(/f\s*=\s*\d/.test(readout), `读数缺少频率: ${readout}`);
  await page.locator('#analWinClose').click();
  await page.waitForSelector('#analWin', { state: 'hidden', timeout: 5000 });

  // 4) 文件菜单应直接提供原理图 SVG 导出。
  await page.locator('#menuItems .menu > button').filter({ hasText: '文件' }).click();
  const exportItem = page.locator('.menu.open .menu-item').filter({ hasText: '导出原理图 SVG…' });
  await exportItem.waitFor({ state: 'visible', timeout: 3000 });
  await exportItem.click();
  await page.waitForSelector('#modal:not(.hidden)', { timeout: 3000 });
  const firstExport = page.waitForResponse((response) => response.url().includes('/api/export/schematic'), { timeout: 8000 });
  await page.locator('#modal .modal-actions button').filter({ hasText: '导出' }).click();
  await firstExport;
  assert(exportCalls === 1, `文件菜单导出未调用 API: ${exportCalls}`);
  await page.waitForSelector('#modal', { state: 'hidden', timeout: 5000 });
  await page.keyboard.press('Escape');

  // 5) 画布右键也应提供同一导出入口。
  const graphBox = await page.locator('#graph').boundingBox();
  await page.locator('#graph').click({
    button: 'right',
    position: { x: Math.max(20, (graphBox?.width || 800) - 40), y: Math.max(20, (graphBox?.height || 600) - 40) },
  });
  const contextExport = page.locator('#linkMenu .popup-item').filter({ hasText: '导出…' });
  await contextExport.waitFor({ state: 'visible', timeout: 3000 });
  await contextExport.click();
  await page.waitForSelector('#modal:not(.hidden)', { timeout: 3000 });
  const secondExport = page.waitForResponse((response) => response.url().includes('/api/export/schematic'), { timeout: 8000 });
  await page.locator('#modal .modal-actions button').filter({ hasText: '导出' }).click();
  await secondExport;
  assert(exportCalls === 2, `画布右键导出未调用 API: ${exportCalls}`);
  await page.waitForSelector('#modal', { state: 'hidden', timeout: 5000 });
  await page.keyboard.press('Escape');

  // 6) 顶部「运行 → 预计算…」打开统一弹窗。
  await page.locator('#menuItems .menu > button').filter({ hasText: '运行' }).click();
  await page.locator('.menu.open .menu-item').filter({ hasText: '预计算…' }).click();
  const dialog = page.locator('#precomputeDialog');
  await dialog.waitFor({ state: 'visible', timeout: 3000 });
  assert(await dialog.locator('#precomputeTarget option[value="solve"]').count() === 1, '预计算弹窗缺 solve 目标');
  assert(await dialog.locator('#precomputeTarget option[value="plotkit"]').count() === 1, '预计算弹窗缺 plotkit 目标');
  await dialog.locator('#precomputeCancel').click();

  assert(errors.length === 0, `页面错误: ${errors.join('; ')}`);
  console.log('analysis ux e2e: OK (mode, metrics, ticks, export, context export, precompute)');
} catch (error) {
  failure = error;
  throw error;
} finally {
  if (flow) await flow.finish({ status: failure || errors.length ? 'failed' : 'ok', error: failure });
  if (browser) await browser.close();
  await backend.stop();
}
