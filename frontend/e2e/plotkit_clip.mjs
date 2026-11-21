// PlotKit 子图裁剪回归：超出 view 的曲线不得画到网格框外。
import { chromium } from 'playwright-core';
import { beginFlow, startBackend } from './harness.mjs';

const PORT = Number(process.env.E2E_PORT || 8889);
const BASE = `http://127.0.0.1:${PORT}`;
const errors = [];
const assert = (ok, message) => { if (!ok) throw new Error(message); };

const backend = await startBackend({ port: PORT, name: 'plotkit_clip' });
let browser;
let flow;
let failure = null;
try {
  await fetch(`${BASE}/api/health`);
  const launchOpts = process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {};
  try {
    browser = await chromium.launch(launchOpts);
  } catch (error) {
    if (process.env.E2E_CHANNEL) throw error;
    browser = await chromium.launch({ channel: 'msedge' });
  }
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  flow = await beginFlow(browser, page, 'plotkit_clip', errors);
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

  const result = await page.evaluate(async () => {
    await import('/plotkit/static/render2d.js');
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;left:0;top:0;width:420px;height:320px;';
    document.body.appendChild(canvas);
    const values = { x: new Float32Array([0, 10, 20]), y: new Float32Array([0, 10, -10]) };
    const store = { get(name) { const v = values[name]; return v ? { values: v } : null; } };
    window.Plot2D.render(canvas, {
      figure: { subplots: 2, ncols: 1 },
      layers: [{
        kind: 'line', subplot: 0, data: { x: 'x', y: 'y' },
        view: { xlim: [0, 10], ylim: [0, 10] },
        style: { color: '#ff0000', width: 2 },
      }],
    }, store, { width: 420, height: 320, dpr: 1 });
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let inside = 0;
    let outside = 0;
    for (let y = 0; y < img.height; y += 1) {
      for (let x = 0; x < img.width; x += 1) {
        const i = (y * img.width + x) * 4;
        if (img.data[i] > 120 && img.data[i + 1] < 80 && img.data[i + 2] < 80) {
          if (x >= 62 && x <= 402 && y >= 24 && y <= 134) inside += 1;
          if (x > 405 && x < 420 && y > 15 && y < 60) outside += 1;
        }
      }
    }
    return { inside, outside, width: canvas.width, height: canvas.height };
  });

  assert(result.width === 420 && result.height === 320, `画布尺寸异常: ${JSON.stringify(result)}`);
  assert(result.inside > 100, `子图内未画出红色曲线: ${JSON.stringify(result)}`);
  assert(result.outside === 0, `曲线越出子图网格框: ${JSON.stringify(result)}`);
} catch (error) {
  failure = error;
} finally {
  if (flow) await flow.finish({ status: failure ? 'failed' : 'ok', error: failure });
  if (browser) await browser.close();
  await backend.stop();
}
if (failure) {
  console.error(failure.stack || String(failure));
  process.exit(1);
}
console.log('plotkit_clip: ok');
