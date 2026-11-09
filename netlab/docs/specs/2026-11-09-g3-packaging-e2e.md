# G3 可复现交付与真实 UI e2e 规格

## 目标

把「本机能跑」升级为「外部可复现、真实浏览器可验证」：依赖锁定、可选依赖闭包、
容器、发布产物、平台矩阵，以及**用真实 UI 行为测试替换读源码的静态护栏**。

## 分层验收

| 层 | 做法 | 通过判据 |
|---|---|---|
| G3a 安装 | `.python-version` + `requirements.lock`（含 hash）；`pyproject` extras 各自可装 | 干净 venv `pip install --require-hashes -r requirements.lock && pytest -q` |
| G3b 容器 | `Dockerfile` + `docker-compose.yml`（Linux 浏览器模式） | `docker build` / `docker run ... pytest -q` exit 0 |
| G3c L1 UI | Playwright 驱动真实浏览器打 `frontend/index.html`：加载、菜单、交互、无 console error | `npm run e2e` exit 0；替代 16 个读源码静态护栏 |
| G3d L2 壳 | Windows runner `python -m netlab.desktop`：启动→首页→cookie→health 200→退出 0 | 退出码 0，日志无 token 泄漏 |
| G3e 发布 | tag 触发 `python -m build && twine check`；sdist/wheel/SHA256SUMS/SBOM | `twine check` exit 0 |

## L1 实现约定

- 用 `playwright-core` + CI 安装的 chromium；本地 Windows 可用 `E2E_CHANNEL=msedge`。
- 断言只落在可见行为与后端状态：元素可见、菜单数量、点击后无异常、`/api/health.ok`。
- 禁止读 `app.ts` 源字符串；纯逻辑用 `frontend/tests/*.test.mjs`（node --test）。
- 首轮 L1 必须能抓住真实运行时错误：2026-11-09 首次运行即发现 `setStatusHint is not defined`
  （S5-37 把未实现的声明直接传给 `setPlotkitFrameActions`），已修复为 `#statusHint` 文本更新。

## 本轮范围

- G3c 的 L1 基础设施 + `npm run e2e` + CI job + 首个真实回归修复。
- G3a/G3b/G3d/G3e 按后续轮次推进，未完成项登记在 PROGRESS。
