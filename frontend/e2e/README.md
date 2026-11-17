# 前端 e2e（Playwright）

## 运行

```bash
cd NetlabHome/frontend
npm run e2e
```

依次执行 `smoke.mjs`、`analysis_ux.mjs`、`appearance_ux.mjs`、`card_fields_ux.mjs`、`float_window_ux.mjs`。每个脚本会：

1. 用 `harness.mjs` 启动独立的 `uvicorn netlab.server:app` 后端，轮询 `/api/health` 直到就绪；
2. 用状态等待（`networkidle`、DOM 条件、`waitForResponse`）替代固定 sleep；
3. 在 `reports/e2e/<flow>/` 写 `backend.log`、`console.log`、`result.json`、`screenshot.png`、`trace.zip`。

## 约定

- 不依赖开发者本机已有服务：端口由每个脚本固定并独立启动，退出时关闭。
- 失败时保留全部 artifact；`E2E_ARTIFACTS_DIR` 可覆盖输出根目录。
- 浏览器默认使用 Playwright 自带 Chromium；`E2E_CHANNEL=msedge` 可切换本机 Edge。
- Playwright trace 含截图与 DOM snapshot，不含源码（`sources:false`），避免 artifact 膨胀。
