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
  assert((await page.locator('.awb-nav-item[data-kind="poles"]').count()) === 0, '分析菜单不应再有独立极点/零点项');
  assert((await page.locator('.awb-nav-item[data-kind="metrics"]').count()) === 0, '分析菜单不应再有独立指标项');

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

  // 3b) 离开图表必须清除游标，状态栏不得残留上一张图的值。
  await page.mouse.move(5, 5);
  await page.waitForTimeout(200);
  const afterLeave = await page.locator('.awb-status').innerText();
  assert(!afterLeave.includes('光标'), '离开图表后状态栏仍残留光标: ' + afterLeave);

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
  const transferText = await page.locator('[data-awb="transfer"]').innerText();
  assert(transferText.includes('闭环 T(s)'), 'Bode 未显示闭环 T(s): ' + transferText);
  assert(!transferText.includes('开环 G(s)'), 'Bode 不应再冒充开环 G(s): ' + transferText);

  // 4c) 菜单收纳为 Bode图/时域分析/奈氏图，各含开环/闭环；点子菜单每次新增子图。
  const groupTitles = await page.locator('.awb-nav-group-title').allInnerTexts();
  assert(groupTitles.join('|').includes('Bode 图') && groupTitles.join('|').includes('时域分析') && groupTitles.join('|').includes('奈氏图'), '缺少三类分析分组: ' + groupTitles.join(','));
  assert((await page.locator('.awb-nav-item[data-kind="loop_closed"]').count()) === 0, '旧闭环 Bode 独立项应已收纳');
  assert((await page.locator('.awb-nav-item[data-kind="loop_step"]').count()) === 0, '旧闭环阶跃独立项应已收纳');
  const beforeTiles = await page.locator('.awb-canvas-tile').count();
  await page.locator('.awb-nav-item[data-kind="bode"]').click();
  await page.waitForFunction(() => !document.querySelector('.awb-toolbar')?.classList.contains('busy'), null, { timeout: 20000 });
  assert((await page.locator('.awb-canvas-tile').count()) > beforeTiles, '点击 Bode 闭环子菜单未新增子图');
  await page.locator('.awb-nav-item[data-kind="time"]').click();
  await page.waitForFunction(() => !document.querySelector('.awb-toolbar')?.classList.contains('busy'), null, { timeout: 20000 });
  assert((await page.locator('.awb-canvas-title').allInnerTexts()).some((text) => text.includes('时域')), '时域子画布未创建');
  await page.locator('.awb-nav-item[data-kind="bode"]').click();
  await page.waitForFunction(() => !document.querySelector('.awb-toolbar')?.classList.contains('busy'), null, { timeout: 20000 });

  // 5) 关键点索引可展开详情并固定。
  const marker = page.locator('.analysis-marker-item').first();
  assert(await marker.count() > 0, '缺少关键点索引');
  await marker.click();
  await page.waitForFunction(() => (document.querySelector('.analysis-detail-actions')?.textContent || '').includes('取消固定'), null, { timeout: 4000 });
  assert((await page.locator('.analysis-detail-table').count()) > 0, '关键点详情表未出现');

  // 6) Nyquist 可切换并渲染轮廓（受控源断环）。
  await page.locator('.awb-nav-item[data-kind="nyquist"]').click();
  await page.locator('[data-awb="feedback"]').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('[data-awb="feedback"]').selectOption('1');
  await page.locator('[data-awb="run"]').click();
  await page.waitForFunction(() => (document.querySelector('.awb-status')?.textContent || '').includes('稳定') || (document.querySelector('.awb-status')?.textContent || '').includes('对比'), null, { timeout: 15000 });
  assert((await page.locator('.awb-status').innerText()).length > 0, 'Nyquist 状态栏为空');

  // 7) 子画布注册表与布局：Bode / Nyquist 各自成画布，可切换分割布局。
  const tiles = page.locator('.awb-canvas-tile');
  assert((await tiles.count()) >= 2, '子画布注册表未记录 Bode/Nyquist');
  const titles = await page.locator('.awb-canvas-title').allInnerTexts();
  assert(titles.some((text) => text.includes('Bode')) && titles.some((text) => text.includes('Nyquist')), '子画布标题缺少分析类型: ' + titles.join(','));
  await page.locator('[data-awb="layout"]').selectOption('row');
  await page.waitForFunction(() => !!document.querySelector('[data-awb="chart"] .awb-split[data-axis="row"]'), null, { timeout: 4000 });
  assert(await page.locator('.awb-canvas-tile').count() >= 2, '布局切换后子画布丢失');

  // 7b) 关闭当前活动画布后，工具栏/命令上下文跟随新的活动画布，不残留旧选择。
  const activeTile = page.locator('.awb-canvas-tile.active');
  assert(await activeTile.count() === 1, '活动画布标记不唯一');
  await activeTile.locator('.awb-canvas-head button').last().click();
  await page.waitForTimeout(300);
  const toolbarTitle = await page.locator('.awb-toolbar-title b').innerText();
  assert(toolbarTitle.length > 0, '关闭活动画布后工具栏标题为空');
  assert((await page.locator('.awb-canvas-tile.active').count()) === 1, '关闭活动画布后未选中剩余画布');
  // 后续步骤依赖 Nyquist 为当前分析，关闭实验完成后切回，避免影响原有断言。
  await page.locator('.awb-nav-item[data-kind="nyquist"]').click();
  await page.waitForFunction(() => document.querySelector('.awb-nav-item[data-kind="nyquist"]')?.classList.contains('active'), null, { timeout: 4000 });

  // 7c) Bode 悬停不得把 Hz 游标写入 Nyquist（实部为空单位轴），跨轴不得互串。
  const bodeTile = page.locator('.awb-canvas-tile').filter({ has: page.locator('.awb-canvas-title', { hasText: /^Bode$/ }) }).first();
  const nyquistTile = page.locator('.awb-canvas-tile').filter({ has: page.locator('.awb-canvas-title', { hasText: /^Nyquist$/ }) }).first();
  const bodeCanvas = bodeTile.locator('canvas').first();
  const nyquistCanvas = nyquistTile.locator('canvas').first();
  await bodeCanvas.scrollIntoViewIfNeeded();
  const beforeNyquist = await nyquistCanvas.screenshot();
  const bodeBox = await bodeCanvas.boundingBox();
  assert(bodeBox, 'Bode 画布不可见');
  await page.mouse.move(bodeBox.x + bodeBox.width * 0.62, bodeBox.y + bodeBox.height * 0.5);
  await page.waitForTimeout(300);
  const afterNyquist = await nyquistCanvas.screenshot();
  assert(beforeNyquist.equals(afterNyquist), 'Bode 悬停把游标串到了 Nyquist 画布');
  await page.mouse.move(5, 5);
  await page.waitForTimeout(200);

  // 7d) 请求竞态：Bode 慢请求未返回时切到 Nyquist，旧响应不得写入新活动画布。
  const nyquistKeyBefore = await nyquistTile.getAttribute('data-result-key');
  const bodeKeyBefore = await bodeTile.getAttribute('data-result-key');
  let delayedRuns = 0;
  await page.route('**/api/analysis/workbench/run', async (route) => {
    delayedRuns += 1;
    await sleep(1200);
    const response = await route.fetch();
    await route.fulfill({ response });
  });
  const slowResponse = page.waitForResponse((res) => res.url().includes('/api/analysis/workbench/run') && res.request().method() === 'POST');
  await page.locator('.awb-nav-item[data-kind="bode"]').click();
  await page.locator('.awb-nav-item[data-kind="nyquist"]').click();
  await page.waitForFunction(() => document.querySelector('.awb-nav-item[data-kind="nyquist"]')?.classList.contains('active'), null, { timeout: 4000 });
  await slowResponse;
  await page.waitForTimeout(400);
  assert(delayedRuns === 1, '请求竞态用例未拦截到 Bode 慢请求: ' + delayedRuns);
  assert(await page.locator('.awb-nav-item[data-kind="nyquist"]').evaluate((el) => el.classList.contains('active')), '慢响应返回后活动分析漂移');
  const nyquistKeyAfter = await nyquistTile.getAttribute('data-result-key');
  // 设计：类型已切换时旧响应被丢弃，绝不写入新画布；这里只断言 Nyquist 结果未被污染。
  assert(nyquistKeyAfter === nyquistKeyBefore, 'Bode 慢响应串写到了 Nyquist 画布: ' + nyquistKeyBefore + ' -> ' + nyquistKeyAfter);
  await page.unroute('**/api/analysis/workbench/run');

  // 7e) 每个子图可设置标题、轴名称、网格与图例，并随工程保存。
  await page.locator('[data-awb="chart-settings"]').click();
  await page.waitForSelector('#modal:not(.hidden) .awb-settings-card', { timeout: 4000 });
  const settingsTitle = page.locator('.awb-settings-row', { hasText: '大标题' }).locator('input[type="text"]');
  const settingsXLabel = page.locator('.awb-settings-row', { hasText: 'X 轴名称' }).locator('input[type="text"]');
  await page.locator('.awb-settings-row', { hasText: '预设模板' }).locator('select').selectOption('matlab');
  await settingsTitle.fill('奈奎斯特图');
  await settingsXLabel.fill('实部');
  await page.locator('.awb-settings-row', { hasText: '网格线型' }).locator('select').selectOption('dashed');
  await page.locator('#modalCard').getByRole('button', { name: '应用', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#modal')?.classList.contains('hidden'), null, { timeout: 3000 });

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

  // 8b) 导出请求必须绑定当前画布实际结果 key（result_ids），不能只按状态+类型盲查。
  const exportReqPromise = page.waitForRequest((req) => req.url().includes('/api/analysis/workbench/export') && req.method() === 'POST');
  await page.locator('[data-awb="export"]').click();
  const exportReq = await exportReqPromise;
  const exportBody = exportReq.postDataJSON();
  assert(Array.isArray(exportBody.result_ids) && exportBody.result_ids.length >= 1, '导出未绑定画布实际结果 result_ids: ' + JSON.stringify(exportBody));
  assert(exportBody.appearance && exportBody.appearance.title === '奈奎斯特图', '导出未携带子图外观设置: ' + JSON.stringify(exportBody.appearance || null));
  await page.waitForSelector('.awb-export-preview', { timeout: 6000 });
  const exportDownloadPromise = page.waitForEvent('download');
  await page.locator('.awb-export-preview-actions button.primary').click();
  const exportDownload = await exportDownloadPromise;
  await exportDownload.path();
  await page.waitForTimeout(300);

  // 8c) 桌面壳导出必须走原生二进制保存桥，不能只触发浏览器下载假成功。
  await page.evaluate(() => {
    window.__savedExport = null;
    window.netlabDesktop = {
      saveBytes: (name, data, callback) => {
        window.__savedExport = { name, length: data.length };
        callback('C:/tmp/' + name);
      },
    };
  });
  await page.locator('[data-awb="export"]').click();
  await page.waitForSelector('.awb-export-preview', { timeout: 6000 });
  await page.locator('.awb-export-preview-actions button.primary').click();
  await page.waitForFunction(() => !!window.__savedExport, null, { timeout: 8000 });
  const savedExport = await page.evaluate(() => window.__savedExport);
  assert(savedExport.name.endsWith('.png'), '桌面导出文件名不是 PNG: ' + savedExport.name);
  assert(savedExport.length > 100, '桌面导出二进制内容为空');
  await page.evaluate(() => { delete window.netlabDesktop; });

  // 9) 保存工程后再载入：布局、画布注册表与当前分析恢复（AC-15/AC-20）。
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#menuItems .menu > button').filter({ hasText: '文件' }).click();
  await page.locator('.menu.open .menu-item').filter({ hasText: '保存工程' }).click();
  const download = await downloadPromise;
  const savedPath = await download.path();
  assert(savedPath, '工程文件未下载');
  const saved = JSON.parse(await readFile(savedPath, 'utf8'));
  const savedWorkbench = saved?.ui?.analysis_workbench;
  const savedRoot = savedWorkbench?.layout?.tabs?.[0]?.root;
  assert(savedRoot?.type === 'split' && savedRoot?.axis === 'row', '工程未保存工作台布局: ' + JSON.stringify(savedWorkbench?.layout || null));
  assert((savedWorkbench?.canvases || []).length >= 2, '工程未保存画布注册表');
  assert((savedWorkbench?.canvases || []).some((item) => item?.appearance?.title === '奈奎斯特图'), '工程未保存子图外观设置');
  assert(savedWorkbench?.active_analysis === 'nyquist', '工程未保存当前分析: ' + String(savedWorkbench?.active_analysis));
  await page.locator('input[type="file"][accept*=".netlab"]').setInputFiles(savedPath);
  await page.waitForTimeout(1500);
  await page.locator('#analWinClose').click();
  await page.waitForSelector('#analWin', { state: 'hidden', timeout: 4000 });
  await page.locator('#menuItems .menu > button').filter({ hasText: '工具' }).click();
  await page.locator('.menu.open .menu-item').filter({ hasText: '电路分析工作台' }).click();
  await page.waitForSelector('#analWorkbench.awb', { state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('#analWorkbench')?.dataset.awbReady === '1', null, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('.awb-canvas-tile').length >= 2, null, { timeout: 15000 });
  assert(await page.locator('.awb-nav-item[data-kind="nyquist"]').evaluate((el) => el.classList.contains('active')), '重新载入后未恢复 Nyquist');
  assert(await page.locator('[data-awb="layout"]').inputValue() === 'row', '重新载入后未恢复分割布局');
  assert(await page.locator('.awb-split[data-axis="row"]').count() > 0, '重新载入后未渲染左右分割树');
  // 9b) 每个已保存画布都应恢复结果，不能只有当前画布可用。
  const restoredTiles = await page.locator('.awb-canvas-tile').count();
  for (let index = 0; index < restoredTiles; index += 1) {
    await page.locator('.awb-canvas-tile').nth(index).locator('.awb-canvas-title').click();
    await page.waitForTimeout(200);
    const badge = await page.locator('.awb-toolbar-meta .awb-badge').innerText();
    assert(!badge.includes('尚未运行'), '重新载入后第 ' + (index + 1) + ' 个画布未恢复结果: ' + badge);
  }

  // 9c) 1024px 下侧栏自动折叠，画布区保持最小宽度且无横向溢出。
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.waitForTimeout(300);
  const narrowChrome = await page.locator('#analWorkbench').evaluate((el) => {
    const body = el.querySelector('.awb-body');
    const stage = el.querySelector('.awb-stage');
    return {
      nav: el.getAttribute('data-nav-collapsed'),
      detail: el.getAttribute('data-detail-collapsed'),
      stageWidth: stage?.clientWidth || 0,
      bodyWidth: body?.scrollWidth || 0,
      bodyClient: body?.clientWidth || 0,
    };
  });
  assert(narrowChrome.nav === 'true', '1024px 下导航未自动折叠');
  assert(narrowChrome.detail === 'true', '1024px 下详情未自动折叠');
  assert(narrowChrome.stageWidth >= 520, '1024px 下画布区宽度不足 520px: ' + narrowChrome.stageWidth);
  assert(narrowChrome.bodyWidth <= narrowChrome.bodyClient + 1, '1024px 下工作台出现横向溢出');
  await page.screenshot({ path: flow.dir + '/workbench-1024.png', fullPage: false });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);

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