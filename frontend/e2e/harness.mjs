// 前端 e2e 共用装置：后端日志、Playwright trace、截图、控制台记录、稳定等待。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function artifactsDir(name) {
  const root = process.env.E2E_ARTIFACTS_DIR
    ? path.resolve(process.env.E2E_ARTIFACTS_DIR)
    : path.join(ROOT, 'reports', 'e2e');
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function startBackend({ port, name }) {
  const dir = artifactsDir(name);
  // 工作树验证：优先使用同级的 PlotKit 工作树，避免拿到全局 editable 的旧版本。
  const plotkitSrc = process.env.E2E_PLOTKIT_SRC || path.join(ROOT, '..', 'analysis-wb-plotkit', 'src');
  const pythonPath = [existsSync(plotkitSrc) ? plotkitSrc : null, ROOT, '.'].filter(Boolean).join(path.delimiter);
  const logPath = path.join(dir, 'backend.log');
  const logFd = openSync(logPath, 'a');
  const server = spawn(
    process.env.PYTHON || 'python',
    ['-m', 'uvicorn', 'netlab.server:app', '--port', String(port), '--log-level', 'info'],
    {
      cwd: ROOT,
      env: { ...process.env, PYTHONPATH: pythonPath },
      stdio: ['ignore', logFd, logFd],
    },
  );
  const base = `http://127.0.0.1:${port}`;
  const started = Date.now();
  while (Date.now() - started < 30000) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return { server, base, dir, logPath, stop: async () => { server.kill(); } };
    } catch {
      /* retry */
    }
    await sleep(200);
  }
  server.kill();
  throw new Error('server did not become healthy');
}

export async function beginFlow(browser, page, name, errors) {
  const dir = artifactsDir(name);
  const startedAt = new Date().toISOString();
  const tracePath = path.join(dir, 'trace.zip');
  const consolePath = path.join(dir, 'console.log');
  const consoleLines = [];
  page.on('console', (msg) => {
    const line = `[${msg.type()}] ${msg.text()}`;
    consoleLines.push(line);
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (error) => {
    consoleLines.push(`[pageerror] ${String(error)}`);
    errors.push(String(error));
  });
  await browser.startTracing(page, { path: tracePath, screenshots: true, snapshots: true, sources: false });
  return {
    dir,
    async finish({ status = 'ok', error = null } = {}) {
      const screenshotPath = path.join(dir, 'screenshot.png');
      try {
        await page.screenshot({ path: screenshotPath, fullPage: true });
      } catch {
        /* page may already be closed on crash */
      }
      try {
        await browser.stopTracing();
      } catch {
        /* tracing may already be stopped */
      }
      writeFileSync(consolePath, consoleLines.join('\n') + '\n', 'utf8');
      writeFileSync(
        path.join(dir, 'result.json'),
        JSON.stringify(
          {
            name,
            status,
            errors,
            error: error ? String(error.stack || error) : null,
            startedAt,
            finishedAt: new Date().toISOString(),
            browserVersion: browser.version(),
            screenshots: screenshotPath,
          },
          null,
          2,
        ),
        'utf8',
      );
    },
  };
}

export async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
