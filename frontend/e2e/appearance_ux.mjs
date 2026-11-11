// R40 P-B 元素外观 e2e：多选批量、扩展颜色、线型、持久化。
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.E2E_PORT || 8880);
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
      params: { C: 1e-6 }, delay: false, auto_delay: false, enabled: true,
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#btnRun', { state: 'visible', timeout: 15000 });
  if (await page.locator('#guideClose').isVisible()) await page.locator('#guideClose').click();

  await page.locator('#graph').click({ position: { x: 600, y: 400 } });
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(150);
  await page.locator('#menuItems .menu > button').filter({ hasText: '视图' }).click();
  await page.locator('.menu.open .menu-item').filter({ hasText: '视图设计…' }).click();
  await page.waitForSelector('#modalCard h3', { state: 'visible', timeout: 5000 });

  const title = await page.locator('#modalCard h4').filter({ hasText: '元素外观' }).innerText();
  assert(title.includes('元素外观（已选 6 项）'), `多选标题异常: ${title}`);
  const colorCount = await page.locator('#modalCard .ui-field input[type="color"]').count();
  assert(colorCount >= 5, `扩展颜色控件不足: ${colorCount}`);
  const hasLineStyle = await page.locator('#modalCard .ui-field select').filter({ hasText: 'solid' }).count();
  assert(hasLineStyle === 1, '线型下拉缺失');

  const strokeField = page.locator('#modalCard .ui-field').filter({ hasText: '线条/描边' });
  const strokeInput = strokeField.locator('input[type="color"]');
  const patch = page.waitForResponse((response) =>
    response.url().includes('/api/scene/appearance')
      && response.request().method() === 'PATCH', { timeout: 10000 });
  await strokeInput.evaluate((el, value) => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, '#112233');
  await patch;

  const styleSelect = page.locator('#modalCard .ui-field').filter({ hasText: '线型' }).locator('select');
  const stylePatch = page.waitForResponse((response) =>
    response.url().includes('/api/scene/appearance')
      && response.request().method() === 'PATCH', { timeout: 10000 });
  await styleSelect.selectOption('dashed');
  await stylePatch;
  await page.waitForTimeout(3000);

  const scene = await page.evaluate(async () => (await fetch('/api/scene/export')).json());
  const sceneData = scene.scene || scene;
  const nodes = sceneData.nodes || [];
  const edges = sceneData.edges || [];
  assert(nodes.length === 3 && edges.length === 3, `场景数量异常: ${nodes.length}/${edges.length}`);
  for (const node of nodes) {
    assert(node.appearance?.strokeColor === '#112233', `节点外观未持久化: ${node.name} ${JSON.stringify(node.appearance)}`);
  }
  for (const edge of edges) {
    assert(edge.appearance?.strokeColor === '#112233', `连线外观未持久化: ${edge.name} ${JSON.stringify(edge.appearance)}`);
    assert(edge.appearance?.lineStyle === 'dashed', `连线线型未持久化: ${edge.name}`);
  }
  assert(errors.length === 0, `页面错误: ${errors.join(' | ')}`);
  console.log('appearance ux e2e: OK (batch, colors, lineStyle)');
} finally {
  if (browser) await browser.close();
  server.kill();
}
