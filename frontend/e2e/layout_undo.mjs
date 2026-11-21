// 布局操作撤销 + 导线整网络选择/拖动回归。
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { beginFlow, startBackend } from './harness.mjs';

const PORT = Number(process.env.E2E_PORT || 8897);
const BASE = 'http://127.0.0.1:' + PORT;
const errors = [];

const SCENE = {
  mode: 'circuit',
  integration: 'trapezoidal',
  solve_algebraic: false,
  nodes: [
    { id: 'a00000000001', name: 'n1', kind: 'node', params: {}, data: {}, position: { x: 160, y: 120 }, size: {} },
    { id: 'a00000000002', name: 'n2', kind: 'node', params: {}, data: {}, position: { x: 420, y: 120 }, size: {} },
    { id: 'a00000000003', name: 'n3', kind: 'node', params: {}, data: {}, position: { x: 290, y: 300 }, size: {} },
    { id: 'a00000000004', name: 'gnd', kind: 'ground', params: {}, data: {}, position: { x: 160, y: 320 }, size: {} },
  ],
  edges: [
    { id: 'b00000000001', name: 'w1', source: 'a00000000001', target: 'a00000000002', kind: 'wire', source_pin: '', target_pin: '', source_port: '', target_port: '', params: {}, delay: false, auto_delay: false, enabled: true, route: 'auto', waypoints: [], anchors: {}, layout: {} },
    { id: 'b00000000002', name: 'w2', source: 'a00000000002', target: 'a00000000003', kind: 'wire', source_pin: '', target_pin: '', source_port: '', target_port: '', params: {}, delay: false, auto_delay: false, enabled: true, route: 'auto', waypoints: [], anchors: {}, layout: {} },
    { id: 'b00000000003', name: 'w3', source: 'a00000000003', target: 'a00000000001', kind: 'wire', source_pin: '', target_pin: '', source_port: '', target_port: '', params: {}, delay: false, auto_delay: false, enabled: true, route: 'auto', waypoints: [], anchors: {}, layout: {} },
    { id: 'b00000000004', name: 'R1', source: 'a00000000001', target: 'a00000000004', kind: 'resistor', source_pin: '', target_pin: '', source_port: '', target_port: '', params: { R: 1000 }, delay: false, auto_delay: false, enabled: true, route: 'auto', waypoints: [], anchors: {}, layout: {} },
  ],
  sim: {},
};

async function waitHealth(timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(BASE + '/api/health');
      if (res.ok) return;
    } catch {}
    await sleep(300);
  }
  throw new Error('server did not become healthy');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const backend = await startBackend({ port: PORT, name: 'layout_undo' });
let browser;
let flow;
try {
  await waitHealth();
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
  flow = await beginFlow(browser, page, 'layout_undo', errors);
  const imported = await fetch(BASE + '/api/scene', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(SCENE) });
  if (!imported.ok) throw new Error('scene import failed: ' + imported.status + ' ' + await imported.text());
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#btnRun', { state: 'visible', timeout: 15000 });
  if (await page.locator('#guide').isVisible()) {
    await page.locator('.guide-mode[data-mode="circuit"]').click();
    await page.locator('#guideEnter').click();
  }
  await page.waitForFunction(() => window.__netlabDebug?.state?.mode === 'circuit', null, { timeout: 5000 });
  await page.waitForFunction(() => window.__netlabDebug?.state?.scene?.nodes?.length === 4, null, { timeout: 5000 });

  const snapshot = () => page.evaluate(() => Object.fromEntries(
    (window.__netlabDebug.state.scene.nodes || []).map((node) => [node.id, { x: node.position.x, y: node.position.y }]),
  ));
  const original = await snapshot();
  const waypoint = () => page.evaluate(() => {
    const edge = window.__netlabDebug.state.scene.edges.find((item) => item.id === 'b00000000002');
    const point = edge?.waypoints?.[0];
    return point ? { x: point.x, y: point.y } : null;
  });

  // 1) 自动布局可撤销。
  await page.locator('#btnLayout').click();
  await page.waitForFunction((before) => Object.values(window.__netlabDebug.state.scene.nodes).some((node) => {
    const old = before[node.id];
    return old && (Math.abs(old.x - node.position.x) > 1 || Math.abs(old.y - node.position.y) > 1);
  }), original, { timeout: 8000 });
  const laidOut = await snapshot();
  assert(Object.keys(laidOut).some((id) => Math.abs(laidOut[id].x - original[id].x) > 1 || Math.abs(laidOut[id].y - original[id].y) > 1), '自动布局未改变节点位置');
  await page.keyboard.press('Control+z');
  await page.waitForFunction((before) => Object.values(window.__netlabDebug.state.scene.nodes).every((node) => {
    const old = before[node.id];
    return old && Math.abs(old.x - node.position.x) < 0.01 && Math.abs(old.y - node.position.y) < 0.01;
  }), original, { timeout: 8000 });
  await page.keyboard.press('Control+Shift+z');
  await page.waitForFunction((target) => Object.values(window.__netlabDebug.state.scene.nodes).every((node) => {
    const want = target[node.id];
    return want && Math.abs(want.x - node.position.x) < 0.01 && Math.abs(want.y - node.position.y) < 0.01;
  }), laidOut, { timeout: 8000 });
  await page.keyboard.press('Control+z');
  await page.waitForFunction((before) => Object.values(window.__netlabDebug.state.scene.nodes).every((node) => {
    const old = before[node.id];
    return old && Math.abs(old.x - node.position.x) < 0.01 && Math.abs(old.y - node.position.y) < 0.01;
  }), original, { timeout: 8000 });
  await page.getByRole('button', { name: '适配视图' }).click();
  await page.waitForTimeout(200);

  // 2) 给 w2 加一个拐点，再在 w1 上右键“选中整条网络”：整个连通网络的三个节点、三条导线都被选中。
  const wirePoint = await page.evaluate(() => {
    const debug = window.__netlabDebug;
    const edge = debug.state.scene.edges.find((item) => item.id === 'b00000000001');
    const points = debug.edgePathPoints(edge);
    const screen = points[Math.floor(points.length / 2)];
    const rect = document.querySelector('#graph').getBoundingClientRect();
    return { x: rect.left + screen.x, y: rect.top + screen.y };
  });
  const waypointPoint = await page.evaluate(() => {
    const debug = window.__netlabDebug;
    const edge = debug.state.scene.edges.find((item) => item.id === 'b00000000002');
    const points = debug.edgePathPoints(edge);
    const screen = points[Math.floor(points.length / 2)];
    const rect = document.querySelector('#graph').getBoundingClientRect();
    return { x: rect.left + screen.x, y: rect.top + screen.y };
  });
  await page.mouse.click(waypointPoint.x, waypointPoint.y, { button: 'right' });
  await page.getByRole('button', { name: '添加拐点（中点）' }).click();
  await page.waitForFunction(() => {
    const edge = window.__netlabDebug.state.scene.edges.find((item) => item.id === 'b00000000002');
    return edge?.waypoints?.length === 1;
  }, null, { timeout: 5000 });
  const initialWaypoint = await waypoint();
  assert(initialWaypoint, '添加拐点后应能读取 w2 的拐点坐标');
  await page.mouse.click(wirePoint.x, wirePoint.y, { button: 'right' });
  await page.getByRole('button', { name: '选中整条网络' }).click();
  const selected = await page.evaluate(() => ({
    nodes: window.__netlabDebug.state.multi.nodes.size,
    edges: window.__netlabDebug.state.multi.edges.size,
  }));
  assert(selected.nodes === 3, '选中整条网络后节点数应为 3，实际 ' + selected.nodes);
  assert(selected.edges === 3, '选中整条网络后导线数应为 3，实际 ' + selected.edges);

  // 3) 拖动其中一个节点，整个网络一起移动；撤销后全部回到原位。
  const dragPoint = await page.evaluate(() => {
    const debug = window.__netlabDebug;
    const node = debug.state.scene.nodes.find((item) => item.id === 'a00000000001');
    const screen = debug.worldToScreen(node.position);
    const rect = document.querySelector('#graph').getBoundingClientRect();
    return { x: rect.left + screen.x, y: rect.top + screen.y };
  });
  await page.mouse.move(dragPoint.x, dragPoint.y);
  await page.mouse.down();
  await page.mouse.move(dragPoint.x + 80, dragPoint.y + 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const moved = await snapshot();
  assert(['a00000000001', 'a00000000002', 'a00000000003'].every((id) => {
    const old = original[id];
    const item = moved[id];
    return old && item && (Math.abs(item.x - old.x) > 1 || Math.abs(item.y - old.y) > 1);
  }), '拖动一个节点后并非所有网络节点都移动: ' + JSON.stringify(moved));
  const movedWaypoint = await waypoint();
  assert(movedWaypoint, '拖动后 w2 的拐点应仍存在');
  const nodeDx = moved.a00000000001.x - original.a00000000001.x;
  const nodeDy = moved.a00000000001.y - original.a00000000001.y;
  assert(
    Math.abs((movedWaypoint.x - initialWaypoint.x) - nodeDx) < 2
      && Math.abs((movedWaypoint.y - initialWaypoint.y) - nodeDy) < 2,
    '整网拖动时拐点未随节点平移: ' + JSON.stringify({ initialWaypoint, movedWaypoint, nodeDx, nodeDy }),
  );
  await page.keyboard.press('Control+z');
  await page.waitForFunction((before) => Object.values(window.__netlabDebug.state.scene.nodes).every((node) => {
    const old = before[node.id];
    return old && Math.abs(old.x - node.position.x) < 0.01 && Math.abs(old.y - node.position.y) < 0.01;
  }), original, { timeout: 8000 });
  await page.waitForFunction((before) => {
    const edge = window.__netlabDebug.state.scene.edges.find((item) => item.id === 'b00000000002');
    const point = edge?.waypoints?.[0];
    return point && Math.abs(point.x - before.x) < 0.01 && Math.abs(point.y - before.y) < 0.01;
  }, initialWaypoint, { timeout: 8000 });

  assert(errors.length === 0, '前端错误: ' + errors.join(' | '));
  await flow.finish({ ok: true });
} catch (error) {
  if (flow) await flow.finish({ ok: false, error: String(error) });
  throw error;
} finally {
  await browser?.close();
  await backend.stop();
}