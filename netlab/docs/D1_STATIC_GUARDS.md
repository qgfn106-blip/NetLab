# D-1 静态源码护栏清单

D-1 的目标是把「读 frontend 源码字符串」的断言改为行为断言。优先项（`net.ts`/`api()`
契约、PlotKit frame URL、菜单分组）已经行为化；剩余项不是用户可见行为，或当前没有
浏览器/DOM 测试环境，按契约保留为**静态护栏**，在此逐条书面说明。

## 已行为化

| 原静态断言 | 行为测试 | 说明 |
|---|---|---|
| `api()` 自动带 token、超时、403 文案、URL token 清理 | `frontend/tests/net.test.mjs`（6 条） | 用 `node --test` + 注入 fetch 验证 |
| `plotkitFrameUrl()` 不带 token/hash | 同上 | 纯函数，直接断言返回值 |
| 菜单分组顺序与 `addable=false` 过滤 | `frontend/tests/menu_model.test.mjs`（3 条） | 纯函数 `groupNodeSpecs()` |
| PlotKit 鉴权 403/200/Set-Cookie | `netlab/tests/test_plotkit_frontend_auth.py` 的 TestClient 用例 | 真实 HTTP 行为 |

## 保留的静态护栏

| 文件 | 断言内容 | 为什么保留 | 替代路径 |
|---|---|---|---|
| `netlab/tests/test_frontend_api_contract.py` | 全前端只有两处 `fetch(`；缓存 UI 失败文案 | 「唯一请求 seam」是架构不变量，不是单次调用行为；app.ts 是 IIFE + DOM | 若引入 jsdom，可改为加载 app.js 后 stub fetch 观察调用次数 |
| `netlab/tests/test_plotkit_frontend_auth.py` 中 3 条 | runWarn 预计算 handler、retry 不误报就绪、degraded 文案 | 依赖 DOM 事件与 toast；同一文件的 TestClient 用例已覆盖鉴权行为 | 抽出 `retryPlotkit()` 的纯决策函数后可改行为测试 |
| `netlab/tests/test_run_warn.py` | `openRunWarn`/`runWarnWin`/`skipWarn` 钩子；build stamp 与 index 版本一致 | build stamp 是部署一致性不变量；对话框是 DOM | 抽出 `shouldWarnBeforeRun()` 纯函数 |
| `netlab/tests/test_ui_analysis_entry.py` | AC 默认探针跳过地节点 | 依赖节点列表选择逻辑 | 抽出 `acProbeNames(nodes)` 纯函数 |
| `netlab/tests/test_structure_layout.py` | 目录分层、无旧 `netlab/static`、依赖方向 | 结构性约束，本质不是运行时行为；已用 AST 检查 import 方向 | 无（保持架构护栏） |
| `netlab/tests/test_desktop_drag.py` | desktop shim 与 Python 宿主的事件接线 | 需要真实 WebView2 才能行为测试 | 桌面端到端测试（用户手动/未来 CI 桌面 runner） |

## 规则

1. 新增静态护栏必须在本文件登记，并写明「为什么不能用行为测试」。
2. 静态护栏只允许断言接线、结构、构建一致性；不得把用户可见行为固化成源码字符串。
3. 引入 jsdom/happy-dom 或纯函数抽取后，对应行必须删除并改为行为测试。
