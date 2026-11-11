// R40 阶段 3：节点卡片自由字段编辑 e2e（勾选 / 排序 / 保存 / 重载 / 白名单）。
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';

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

  // 引导遮罩带淡出动画，必须等它真正隐藏，否则会拦截菜单点击。
  const dismissGuide = async () => {
    const close = page.locator('#guideClose');
    if (await close.isVisible().catch(() => false)) await close.click().catch(() => {});
    await page.waitForFunction(() => {
      const g = document.querySelector('#guide');
      if (!g) return true;
      const style = getComputedStyle(g);
      return style.display === 'none' || style.visibility === 'hidden'
        || Number(style.opacity) === 0 || g.classList.contains('hidden');
    }, null, { timeout: 6000 }).catch(() => {});
    await page.evaluate(() => {
      const g = document.querySelector('#guide');
      if (g) g.style.setProperty('display', 'none', 'important');
    });
  };

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#btnRun', { state: 'visible', timeout: 15000 });
  await dismissGuide();

  const openDesigner = async () => {
    await page.locator('#menuItems .menu > button').filter({ hasText: '视图' }).click();
    await page.locator('.menu.open .menu-item').filter({ hasText: '视图设计…' }).click();
    await page.waitForSelector('#modalCard h3', { state: 'visible', timeout: 5000 });
  };
  await openDesigner();

  const fieldBoxes = page.locator('#modalCard .ui-field input[data-card-field]');
  assert(await fieldBoxes.count() === 4, `字段勾选控件数量异常: ${await fieldBoxes.count()}`);
  const checked = () => page.evaluate(() => Array.from(
    document.querySelectorAll('#modalCard input[data-card-field]'),
  ).filter((el) => el.checked).map((el) => el.dataset.cardField));
  const order = () => page.evaluate(() => Array.from(
    document.querySelectorAll('#modalCard .ui-field'),
  ).map((row) => row.querySelector('input[data-card-field]')?.dataset.cardField).filter(Boolean));
  assert(JSON.stringify(await checked()) === JSON.stringify(['kind', 'name', 'value']),
    `默认字段异常: ${JSON.stringify(await checked())}`);
  assert(await page.locator('#modalCard h4').filter({ hasText: '节点卡片字段' }).count() === 1,
    '节点卡片字段小节缺失');
  assert(await page.locator('#modalCard button[data-card-move]').count() === 8,
    '上移/下移排序按钮数量异常');

  // 勾选第 4 个字段 id，并把它上移到首位。
  await page.locator('#modalCard input[data-card-field="id"]').click();
  assert((await checked()).includes('id'), `勾选 id 失败: ${JSON.stringify(await checked())}`);
  const upForId = () => page.locator('#modalCard .ui-field')
    .filter({ has: page.locator('input[data-card-field="id"]') })
    .locator('button[data-card-move="up"]');
  for (let i = 0; i < 3; i += 1) await upForId().click();
  const ordered = await order();
  assert(ordered[0] === 'id', `上移排序失败: ${JSON.stringify(ordered)}`);

  // 保存：POST /api/ui 载荷带排序后的 card_fields。
  const posted = page.waitForResponse((response) =>
    response.url().includes('/api/ui') && response.request().method() === 'POST', { timeout: 10000 });
  await page.locator('#modalCard button').filter({ hasText: '应用并保存' }).click();
  const savedResponse = await posted;
  assert(savedResponse.status() === 200, `保存失败: ${savedResponse.status()}`);
  const postedBody = JSON.parse(savedResponse.request().postData() || '{}');
  assert(Array.isArray(postedBody.node?.card_fields) && postedBody.node.card_fields[0] === 'id',
    `POST 未携带排序后的 card_fields: ${JSON.stringify(postedBody.node)}`);
  const saved = await savedResponse.json();
  assert(JSON.stringify(saved.current.node.card_fields) === JSON.stringify(ordered),
    `保存返回字段顺序异常: ${JSON.stringify(saved.current.node.card_fields)}`);

  // 服务端往返 + 重载后重新打开设计器仍保持用户顺序。
  const apiCurrent = await (await fetch(`${BASE}/api/ui`)).json();
  assert(apiCurrent.current.node.card_fields[0] === 'id', 'GET /api/ui 顺序未持久化');
  assert(Array.isArray(apiCurrent.card_fields) && apiCurrent.card_fields.length === 4,
    'GET /api/ui 字段目录缺失');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#btnRun', { state: 'visible', timeout: 15000 });
  await dismissGuide();
  await openDesigner();
  assert(JSON.stringify(await checked()) === JSON.stringify(ordered),
    `重载后勾选状态丢失: ${JSON.stringify(await checked())}`);
  assert((await order())[0] === 'id', '重载后字段顺序丢失');

  // 白名单：后端拒绝任意字段，且不污染已保存的配置。
  const badPayload = JSON.parse(JSON.stringify(apiCurrent.current));
  badPayload.node.card_fields = ['kind', '<script>'];
  const bad = await fetch(`${BASE}/api/ui`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(badPayload),
  });
  assert(bad.status >= 400, `非法字段未被拒绝: ${bad.status}`);
  const stillValid = await (await fetch(`${BASE}/api/ui`)).json();
  assert(stillValid.current.node.card_fields[0] === 'id', '非法字段污染了已保存配置');

  assert(errors.length === 0, `页面错误: ${errors.join(' | ')}`);
  console.log('card fields ux e2e: OK (whitelist, toggle, reorder, save, reload)');
} finally {
  if (browser) await browser.close();
  server.kill();
}
