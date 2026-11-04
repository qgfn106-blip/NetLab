---
status: implemented
---
# PlotKit 桌面请求鉴权修复

## Problem
桌面模式启用 `X-Netlab-Token` 守卫后，PlotKit 面板仍用原生 `fetch()` 调用 `/api/plotkit/*`。403 响应被解析成普通 JSON，或异常被吞掉，界面误显示「PlotKit 未挂载」/「还没有探针数据」，即使后端已有探针且 PlotKit 已挂载。

## Solution
PlotKit 的前端 API 请求统一使用会自动加桌面 token 的 `api()` helper；每个调用边界处理失败并展示实际错误，不得把鉴权/网络错误解释为挂载失败或空数据。GET 刷新、重试、预计算、POST 接入都覆盖。仿真启动前预计算流程也属 PlotKit API，需一并改用 helper。服务端仅在自身确实报告 `mounted:false` 时展示未挂载。

## User Stories
- R-01：桌面窗口刷新数据通道时，鉴权通过并显示真实 `available`。
- R-02：重试/预计算/接入请求携带 token；403 或网络失败明确展示原因。
- R-03：真正未挂载时仍保留原有诊断信息，不被错误处理覆盖。

## Implementation Decisions
- 复用 `app.js` 的 `api(path, options)`；不新增鉴权机制，不改服务端 token guard。
- 对 data-bar 的刷新、重试、预计算、接入使用 try/catch/错误提示；刷新结果返回明确成功态，错误保持与 mounted 状态分离，防止重试在二次刷新失败时仍提示就绪。
- 修改前端静态资源时同步更新 `UI_BUILD`、`APP_BUILD` 与 index.html 两个 `?v=`。

## Testing Decisions
- Seam：`netlab/tests/test_plotkit_frontend_auth.py` 检查 PlotKit API 不再使用原生 fetch，且 token guard 下缺 token=403、带 token 可取得挂载状态及探针。
- `test_run_warn.py` 验证运行前预计算也遵循统一请求 helper 和 build 一致性；`test_retry_does_not_report_ready_when_channel_refresh_fails` 防止通道重刷失败仍显示就绪。
- 运行 PlotKit 接口测试及全量 netlab 测试。

## Out of Scope
- 不改 PlotKit 绘图逻辑、仿真 recorder 或探针发现语义。
- 不处理退出服务与缓存 API 等非本次 PlotKit 通道接入问题。

## Further Notes
- 原始反馈：用户表示「即使运行了，有数据了依然报错，这里依然显示没有探针数据与Plotkit未挂载，但是明明已经加载了」。
- 任务勾选：
  - [x] 复现裸 `fetch('/api/plotkit/...')` 会绕过 token 的静态契约。
  - [x] 全部 PlotKit API 调用改走 token-aware helper。
  - [x] 回归测试及完整验证通过（全量 pytest 413 passed；Windows 进程关闭阶段仍报告 `fatal exception: code 0xc0000139`，完整输出见本轮测试记录，未视为无异常通过）。

## 实现结果 + 实测
- `frontend/app.js` 中 PlotKit 的刷新、重试、预计算、通道接入及运行前预计算均通过统一 `api()`；桌面 token 自动由 helper 添加。
- 刷新/重试发生网络或鉴权错误时，不再显示真实空列表文案；空缓存下列表显示「探针列表加载失败」及错误信息，真实 `mounted:false` 仍显示后端诊断。
- build 同步到 3.16.6（`UI_BUILD`、`APP_BUILD`、`index.html` 两处资源 query）。
- `python -m pytest netlab/tests/test_plotkit_frontend_auth.py netlab/tests/test_plotkit_channels.py netlab/tests/test_run_warn.py -q`：14 passed, 1 warning。
- `python -m pytest netlab/tests -q`：413 passed, 3 warnings；pytest 结束后可重复观察到 Windows `fatal exception: code 0xc0000139`，堆栈涉及 `plotkit_bridge._sync_loop` 与 sympy/gmpy2 导入关闭期。测试命令退出码为 0，但进程仍输出该异常，需单独后续调查。
- 另已完成 `python -m compileall -q netlab`（退出 0，仅 vendored PlotKit 有 SyntaxWarning）、`python -m netlab.desktop --selftest`（退出 0，后端与 shim status 均 200）及本地备份/manifest，见进度记录。
