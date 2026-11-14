// 浮窗可用性 e2e：深色主题下小信号旁路对比度、右下角缩放柄、窗口视口约束。
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.E2E_PORT || 8881);
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
      const res = await fetch(BASE + '/api/health');
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  throw new Error('server did not become healthy');
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function parseRgb(text) {
  const m = String(text).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(',').map((x) => Number(x.trim()));
  return parts.slice(0, 3);
}

function luminance(rgb) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const server = spawn(
  'python',
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
  const prefs = await fetch(`${BASE}/api/settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ theme: 'dark' }),
  });
  if (!prefs.ok) throw new Error(`settings patch failed: ${prefs.status}`);

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
  await page.addInitScript(() => {
    window.localStorage.setItem('netlab.ui.prefs', JSON.stringify({ theme: 'dark' }));
  });

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#btnRun', { state: 'visible', timeout: 15000 });
  if (await page.locator('#guideClose').isVisible()) await page.locator('#guideClose').click();
  assert((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', '深色主题未生效');

  // 打开电路分析 → 小信号旁路
  await page.locator('.panel-tab[data-group="analysis"]').click();
  await page.locator('button[data-sub="analysis"]').click();
  await page.getByRole('button', { name: '推导', exact: true }).click();
  await page.waitForSelector('#analWin', { state: 'visible', timeout: 5000 });
  await page.locator('#analRunBypass').click();
  await page.waitForFunction(() => (document.querySelector('#analBypassTransfer')?.textContent || '').includes('G(s)'), null, { timeout: 15000 });
  await page.waitForTimeout(300);

  // 1) 指标卡：深色下背景必须为深色令牌，文字对比度 ≥ 4.5
  const cardColors = await page.locator('#analBypassSummary > div').first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, fg: cs.color };
  });
  const cardBg = parseRgb(cardColors.bg);
  const cardFg = parseRgb(cardColors.fg);
  assert(cardBg && cardFg, `指标卡颜色无法解析: ${JSON.stringify(cardColors)}`);
  assert(luminance(cardBg) < 0.25, `指标卡背景仍为浅色: ${cardColors.bg}`);
  assert(contrast(cardFg, cardBg) >= 4.5, `指标卡文字对比度不足: ${contrast(cardFg, cardBg).toFixed(2)}`);

  // 2) 画布容器与极点表同样走深色令牌
  const canvasBg = parseRgb(await page.locator('#analBypassBode').evaluate((el) => getComputedStyle(el).backgroundColor));
  assert(canvasBg && luminance(canvasBg) < 0.25, `Bode 画布背景仍为浅色: ${canvasBg}`);
  const thColors = await page.locator('#analBypassPoles th').first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, fg: cs.color };
  });
  const thBg = parseRgb(thColors.bg);
  const thFg = parseRgb(thColors.fg);
  assert(thBg && thFg, `极点表颜色无法解析: ${JSON.stringify(thColors)}`);
  assert(contrast(thFg, thBg) >= 4.5, `极点表表头对比度不足: ${contrast(thFg, thBg).toFixed(2)}`);

  // 3) 首次打开尺寸必须与响应式 CSS 一致（不能被入场动画的 scale 写死成略小尺寸）
  const win = page.locator('#analWin');
  const before = await win.boundingBox();
  const vp0 = page.viewportSize();
  const expectedW = Math.min(760, vp0.width * 0.92);
  const expectedH = Math.min(580, vp0.height * 0.8);
  assert(Math.abs(before.width - expectedW) <= 2 && Math.abs(before.height - expectedH) <= 2, `首次打开尺寸异常: ${before.width}x${before.height}，期望 ${expectedW}x${expectedH}`);

  // 4) 右下角缩放柄：拖拽应改变窗口尺寸
  const grip = page.locator('#analWin .floatwin-resize');
  const gb = await grip.boundingBox();
  assert(gb && gb.width >= 16 && gb.height >= 16, `缩放柄尺寸异常: ${JSON.stringify(gb)}`);
  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await page.mouse.down();
  await page.mouse.move(gb.x + gb.width / 2 + 140, gb.y + gb.height / 2 + 90, { steps: 8 });
  await page.mouse.up();
  const after = await win.boundingBox();
  assert(after.width > before.width + 80, `缩放柄未改变宽度: ${before.width} -> ${after.width}`);
  assert(after.height > before.height + 50, `缩放柄未改变高度: ${before.height} -> ${after.height}`);

  // 5) 视口约束：窗口被撑出视口后重新打开应回拉到可见区域
  await page.evaluate(() => {
    const el = document.querySelector('#analWin');
    el.style.width = '3000px';
    el.style.height = '3000px';
    el.style.left = '-500px';
    el.style.top = '-500px';
    el.hidden = true;
  });
  await page.getByRole('button', { name: '推导', exact: true }).click();
  await page.waitForSelector('#analWin', { state: 'visible', timeout: 5000 });
  const clamped = await win.boundingBox();
  const viewport = page.viewportSize();
  assert(clamped.width <= viewport.width && clamped.height <= viewport.height, `窗口未收缩到视口内: ${clamped.width}x${clamped.height}`);
  assert(clamped.x >= 0 && clamped.y >= 40 && clamped.x + clamped.width <= viewport.width + 1 && clamped.y + clamped.height <= viewport.height + 1, `窗口位置越界: ${JSON.stringify(clamped)}`);

  assert(errors.length === 0, `页面报错: ${errors.join(' | ')}`);
  console.log('float_window_ux e2e OK');
} finally {
  if (browser) await browser.close();
  server.kill();
}
