// 统一分析工作台 e2e：PlotKit 画布、交互读数、关键点固定、Nyquist 与多状态对比。
import { setTimeout as sleep } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { beginFlow, startBackend } from './harness.mjs';

const PORT = Number(process.env.E2E_PORT || 8889);
const BASE = 'http://127.0.0.1:' + PORT;
const errors = [];

const SCENE = {
  mode: 'circuit',
  integration: 'trapezoidal',
  solve_algebraic: false,
  nodes: [
    { id: 'a00000000001', name: 'gnd', kind: 'ground', params: {}, data: {}, position: { x: 220, y: 0 }, size: {} },
    { id: 'a00000000002', name: 'vin', kind: 'node', params: {}, data: {}, position: { x: 165, y: 99 }, size: {} },
    { id: 'a00000000003', name: 'out', kind: 'node', params: {}, data: {}, position: { x: 29, y: 149 }, size: {} },
    { id: 'a00000000004', name: 'n', kind: 'node', params: {}, data: {}, position: { x: 90, y: 149 }, size: {} },
  ],
  edges: [
    { id: 'b00000000001', name: 'V1', source: 'a00000000002', target: 'a00000000001', kind: 'vsource', source_pin: '', target_pin: '', source_port: '', target_port: '', params: { wave: 'dc', offset: 0, amplitude: 1, frequency: 10, phase: 0, duty: 0.5, delay: 0 }, delay: false, auto_delay: false, enabled: true, route: 'auto', waypoints: [], anchors: {}, layout: {} },
    { id: 'b00000000002', name: 'E1', source: 'a00000000003', target: 'a00000000001', kind: 'vcvs', source_pin: '', target_pin: '', source_port: '', target_port: '', params: { gain: 100000, control_source: 'a00000000002', control_target: 'a00000000004' }, delay: false, auto_delay: false, enabled: true, route: 'auto', waypoints: [], anchors: {}, layout: {} },
    { id: 'b00000000003', name: 'R1', source: 'a00000000004', target: 'a00000000001', kind: 'resistor', source_pin: '', target_pin: '', source_port: '', target_port: '', params: { R: 1000 }, delay: false, auto_delay: false, enabled: true, route: 'auto', waypoints: [], anchors: {}, layout: {} },
    { id: 'b00000000004', name: 'R2', source: 'a00000000003', target: 'a00000000004', kind: 'resistor', source_pin: '', target_pin: '', source_port: '', target_port: '', params: { R: 9000 }, delay: false, auto_delay: false, enabled: true, route: 'auto', waypoints: [], anchors: {}, layout: {} },
  ],
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const backend = await startBackend({ port: PORT, name: 'workbench_analysis' });
let browser;
let flow;
let failure = null;
try {
  const imported = await fetch(BASE + '/api/scene', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(SCENE),
  });
  if (!imported.ok) throw new Error('scene import failed: ' + imported.status + ' ' + await imported.text());

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
  flow = await beginFlow(browser, page, 'workbench_analysis', errors);
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#btnRun', { state: 'visible', timeout: 15000 });
  if (await page.locator('#guideClose').isVisible()) await page.locator('#guideClose').click();

  // 1) 分析入口打开统一工作台，而不是旧的 AC/旁路页签。
  await page.locator('.panel-tab[data-group="analysis"]').click();
  await page.locator('button[data-sub="analysis"]').click();
  await page.getByRole('button', { name: '推导', exact: true }).click();
  await page.waitForSelector('#analWin', { state: 'visible', timeout: 5000 });
  await page.waitForSelector('#analWorkbench.awb', { state: 'visible', timeout: 8000 });
  assert(await page.locator('.anal-tab[data-anal="workbench"]').evaluate((el) => el.classList.contains('active')), '未切到分析工作台页签');

  // 2) Bode 由 PlotKit 画布渲染，旧分析 Canvas 不再存在。
  await page.waitForSelector('.analysis-chart-canvas', { state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => (document.querySelector('.analysis-chart-readout')?.textContent || '').includes('滚轮缩放'), null, { timeout: 15000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.analysis-chart-canvas');
    return canvas instanceof HTMLCanvasElement && canvas.width > 100 && canvas.height > 100;
  }, null, { timeout: 15000 });
  assert(await page.locator('#analAcCanvas, #analBypassBode, #analBypassStep').count() === 0, '旧分析 Canvas 仍在 DOM 中');

  // 3) 悬停给出频率/幅值/相位与局部斜率读数。
  await page.waitForFunction(() => {
    const rect = document.querySelector('.analysis-chart-canvas')?.getBoundingClientRect();
    return !!rect && rect.width > 320 && rect.height > 200;
  }, null, { timeout: 8000 });
  await sleep(250);
  const canvas = page.locator('.analysis-chart-canvas');
  const box = await canvas.boundingBox();
  assert(box && box.width > 320 && box.height > 200, '分析画布尺寸异常');
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.35, { steps: 3 });
  await page.waitForTimeout(250);
  await page.waitForFunction(() => {
    const text = document.querySelector('.analysis-chart-readout')?.textContent || '';
    return /Hz|dB|°/.test(text);
  }, null, { timeout: 5000 });
  const readout = await page.locator('.analysis-chart-readout').innerText();
  assert(/dB|°|Hz/.test(readout), '悬停读数缺少频率/幅值/相位: ' + readout);

  // 4) 滚轮缩放与复位按钮可用（不抛错）。
  await page.mouse.wheel(0, -320);
  await sleep(300);
  const reset = page.locator('.analysis-tool-btn', { hasText: '复位' });
  assert(await reset.count() > 0, '缺少复位按钮');
  await reset.first().click();

  // 4b) 频响通路可切到 FFT 轨迹近似；状态栏明确标注近似且不参与判稳。
  await page.locator('[data-awb="frequency-path"]').selectOption('fft_trajectory');
  await page.locator('[data-awb="run"]').click();
  await page.waitForFunction(() => (document.querySelector('.awb-status')?.textContent || '').includes('FFT 近似'), null, { timeout: 30000 });
  const fftStatus = await page.locator('.awb-status').innerText();
  assert(fftStatus.includes('不参与判稳'), 'FFT 近似未标注不参与判稳: ' + fftStatus);
  await page.locator('[data-awb="frequency-path"]').selectOption('descriptor_linearized');
  await page.locator('[data-awb="run"]').click();
  await page.waitForFunction(() => (document.querySelector('.awb-status')?.textContent || '').includes('描述器线性化'), null, { timeout: 20000 });

  // 4c) 未选择实体断环元件时，闭环 Bode/阶跃走虚拟单位负反馈并显示提示。
  await page.locator('.awb-nav-item[data-kind="loop_closed"]').click();
  await page.waitForFunction(() => !document.querySelector('.awb-toolbar')?.classList.contains('busy'), null, { timeout: 20000 });
  await page.locator('[data-awb="element"]').selectOption('__virtual__');
  await page.locator('[data-awb="run"]').click();
  await page.waitForFunction(() => (document.querySelector('.awb-status')?.textContent || '').includes('虚拟单位负反馈'), null, { timeout: 20000 });
  assert((await page.locator('.awb-canvas-title').allInnerTexts()).some((text) => text.includes('闭环 Bode')), '闭环 Bode 子画布未创建');
  await page.locator('.awb-nav-item[data-kind="loop_step"]').click();
  await page.waitForFunction(() => !document.querySelector('.awb-toolbar')?.classList.contains('busy'), null, { timeout: 20000 });
  await page.locator('[data-awb="element"]').selectOption('__virtual__');
  await page.locator('[data-awb="run"]').click();
  await page.waitForFunction(() => (document.querySelector('.awb-status')?.textContent || '').includes('虚拟单位负反馈'), null, { timeout: 20000 });
  assert((await page.locator('.awb-canvas-title').allInnerTexts()).some((text) => text.includes('闭环阶跃')), '闭环阶跃子画布未创建');
  await page.locator('.awb-nav-item[data-kind="bode"]').click();

  // 5) 关键点索引可展开详情并固定。
  const marker = page.locator('.analysis-marker-item').first();
  assert(await marker.count() > 0, '缺少关键点索引');
  await marker.click();
  await page.waitForFunction(() => (document.querySelector('.analysis-detail-actions')?.textContent || '').includes('取消固定'), null, { timeout: 4000 });
  assert((await page.locator('.analysis-detail-table').count()) > 0, '关键点详情表未出现');

  // 6) Nyquist 可切换并渲染轮廓（受控源断环）。
  await page.locator('.awb-nav-item[data-kind="nyquist"]').click();
  await page.waitForFunction(() => (document.querySelector('.awb-status')?.textContent || '').includes('稳定') || (document.querySelector('.awb-status')?.textContent || '').includes('对比'), null, { timeout: 15000 });
  assert((await page.locator('.awb-status').innerText()).length > 0, 'Nyquist 状态栏为空');

  // 7) 子画布注册表与布局：Bode / Nyquist 各自成画布，可切换分割布局。
  const tiles = page.locator('.awb-canvas-tile');
  assert((await tiles.count()) >= 2, '子画布注册表未记录 Bode/Nyquist');
  const titles = await page.locator('.awb-canvas-title').allInnerTexts();
  assert(titles.some((text) => text.includes('Bode')) && titles.some((text) => text.includes('Nyquist')), '子画布标题缺少分析类型: ' + titles.join(','));
  await page.locator('[data-awb="layout"]').selectOption('split');
  await page.waitForFunction(() => document.querySelector('[data-awb="chart"] .awb-canvas-grid')?.dataset.layout === 'split', null, { timeout: 4000 });
  assert(await page.locator('.awb-canvas-tile').count() >= 2, '布局切换后子画布丢失');

  // 8) 快照两个状态并进入多状态对比。
  await page.locator('[data-awb="snapshot"]').click();
  await sleep(800);
  await page.locator('[data-awb="snapshot"]').click();
  await sleep(800);
  const compare = page.locator('[data-awb="compare"]');
  if (!(await compare.isChecked())) await compare.check();
  const checks = page.locator('[data-compare-state]');
  assert((await checks.count()) >= 2, '状态数量不足以对比');
  await checks.nth(0).check();
  await checks.nth(1).check();
  await page.locator('[data-awb="compare-run"]').click();
  await page.waitForFunction(() => (document.querySelector('.awb-detail')?.textContent || '').includes('多状态对比'), null, { timeout: 20000 });
  assert((await page.locator('.awb-detail').innerText()).includes('多状态对比'), '对比详情未出现');

  // 9) 保存工程后再载入：布局、画布注册表与当前分析恢复（AC-15/AC-20）。
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#menuItems .menu > button').filter({ hasText: '文件' }).click();
  await page.locator('.menu.open .menu-item').filter({ hasText: '保存工程' }).click();
  const download = await downloadPromise;
  const savedPath = await download.path();
  assert(savedPath, '工程文件未下载');
  const saved = JSON.parse(await readFile(savedPath, 'utf8'));
  const savedWorkbench = saved?.ui?.analysis_workbench;
  assert(savedWorkbench?.layout?.mode === 'split', '工程未保存工作台布局: ' + JSON.stringify(savedWorkbench?.layout || null));
  assert((savedWorkbench?.canvases || []).length >= 2, '工程未保存画布注册表');
  assert(savedWorkbench?.active_analysis === 'nyquist', '工程未保存当前分析: ' + String(savedWorkbench?.active_analysis));
  await page.locator('input[type="file"][accept*=".netlab"]').setInputFiles(savedPath);
  await page.waitForTimeout(1500);
  await page.locator('#analWinClose').click();
  await page.waitForSelector('#analWin', { state: 'hidden', timeout: 4000 });
  await page.locator('#menuItems .menu > button').filter({ hasText: '工具' }).click();
  await page.locator('.menu.open .menu-item').filter({ hasText: '电路分析工作台' }).click();
  await page.waitForSelector('#analWorkbench.awb', { state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('.awb-canvas-tile').length >= 2, null, { timeout: 15000 });
  assert(await page.locator('.awb-nav-item[data-kind="nyquist"]').evaluate((el) => el.classList.contains('active')), '重新载入后未恢复 Nyquist');
  assert(await page.locator('[data-awb="layout"]').inputValue() === 'split', '重新载入后未恢复分割布局');

  // 10) 无未捕获前端错误。
  assert(errors.length === 0, '前端错误: ' + errors.join(' | '));
  await page.screenshot({ path: flow.dir + '/workbench.png', fullPage: false });
  await flow.finish({ ok: true });
} catch (error) {
  failure = error;
  if (flow) await flow.finish({ ok: false, error: String(error) });
  throw error;
} finally {
  await browser?.close();
  await backend.stop();
}