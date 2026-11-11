// 六项前端 UX e2e：mode 入口、旁路指标/传函、坐标轴、导出入口、统一预计算。
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';

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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.addInitScript(() => {
    window.__netlabCanvasTexts = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      window.__netlabCanvasTexts.push(String(text));
      return original.call(this, text, ...args);
    };
  });

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#btnRun', { state: 'visible', timeout: 15000 });
  if (await page.locator('#guideClose').isVisible()) await page.locator('#guideClose').click();

  // 1) 电路模式旧「推导」入口应转到小信号旁路，而不是发 mode=signal 请求。
  await page.locator('.panel-tab[data-group="analysis"]').click();
  await page.locator('button[data-sub="analysis"]').click();
  await page.getByRole('button', { name: '推导', exact: true }).click();
  await page.waitForSelector('#analWin', { state: 'visible', timeout: 5000 });
  assert(await page.locator('[data-anal="bypass"]').evaluate((el) => el.classList.contains('active')), 'mode 入口未切到 bypass tab');

  // 2) 运行旁路后应有 G(s)、关键指标和极点表。
  await page.locator('#analRunBypass').click();
  await page.waitForFunction(() => (document.querySelector('#analBypassTransfer')?.textContent || '').includes('G(s)'), null, { timeout: 15000 });
  const transfer = await page.locator('#analBypassTransfer').innerText();
  const summary = await page.locator('#analBypassSummary').innerText();
  const poles = await page.locator('#analBypassPoles').innerText();
  assert(transfer.includes('s + 1000') || transfer.includes('1000'), `传递函数异常: ${transfer}`);
  assert(summary.includes('DC 增益') && summary.includes('上升时间'), `指标摘要异常: ${summary}`);
  assert(poles.includes('-1000'), `极点表异常: ${poles}`);

  // 3) 画布刻度应来自自适应 nice ticks，而不是固定等分。
  await page.waitForTimeout(300);
  const canvasTexts = await page.evaluate(() => window.__netlabCanvasTexts || []);
  const canvasNum = (text) => {
    const match = String(text).replace('−', '-').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : NaN;
  };
  assert(canvasTexts.some((text) => /dB/.test(text) && canvasNum(text) < 0), `未看到负 dB 刻度: ${canvasTexts.slice(-20)}`);
  assert(canvasTexts.some((text) => /^-?\d+\.\d+/.test(String(text).replace('−', '-'))), `未看到小数刻度: ${canvasTexts.slice(-20)}`);

  // 4) 文件菜单应直接提供原理图 SVG 导出。
  await page.locator('#menuItems .menu > button').filter({ hasText: '文件' }).click();
  const exportItem = page.locator('.menu.open .menu-item').filter({ hasText: '导出原理图 SVG…' });
  await exportItem.waitFor({ state: 'visible', timeout: 3000 });
  const [exportResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/export/schematic') && response.status() === 200, { timeout: 10000 }),
    exportItem.click(),
  ]);
  const exportPayload = await exportResponse.json();
  assert(exportPayload.ok === true && String(exportPayload.svg || '').includes('<svg'), '原理图导出响应不是 SVG');
  assert(String(exportPayload.filename || '').toLowerCase().endsWith('.svg'), '导出文件名不是 SVG');
  await page.keyboard.press('Escape');

  // 5) 画布右键也应提供同一导出入口。
  const graphBox = await page.locator('#graph').boundingBox();
  await page.locator('#graph').click({
    button: 'right',
    position: { x: Math.max(20, (graphBox?.width || 800) - 40), y: Math.max(20, (graphBox?.height || 600) - 40) },
  });
  await page.locator('#linkMenu .popup-item').filter({ hasText: '导出原理图 SVG…' }).waitFor({ state: 'visible', timeout: 3000 });
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
} finally {
  if (browser) await browser.close();
  server.kill();
}
