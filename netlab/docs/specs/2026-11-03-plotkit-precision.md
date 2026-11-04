---
status: implemented
---
# PlotKit 预览精度不随仿真精度变化（修复）

## Problem
用户在「设置 → 仿真节奏」把时间步长 dt 从 1e-4 调到 1e-6（帧率 120、每帧 1 步、采样间隔 2 帧、实时节拍关闭），PlotKit 预览曲线依旧是约 20 个折点的粗糙折线，时间窗 0.5 s 内看不出任何精度提升。

三层原因叠加，没有一层与用户调的 dt 真正相关：

1. `netlab/server.py` 的 `plotkit_precompute` 写死 `step_dt = max(dt, seconds / 2000.0)`：无论请求什么 dt，预计算都按 `seconds/2000` 跑出恰好 2000 帧。实测请求 `dt=1e-4` 或 `1e-5`，响应都是 `dt: 0.00025, frames: 2000`。
2. `netlab/core/compute/simulation.py` 的 `Simulation.live()` 把 `limit` 钳到 600，桥接每次最多取 600 点。
3. 同文件 `RECORDER_CAPACITY = 1200`，`precompute()` 用 `sample = max(sample, ceil(count / RECORDER_CAPACITY))` 反推采样间隔，于是点数只跟容量有关、跟 dt 无关（dt=1e-4 得 1001 帧、1e-5 得 1191 帧）。

## Solution
- 预计算尊重请求的 dt（缺省用当前仿真配置的 `dt`），只有超过 20 万步上限时才降级步长；降级必须通过 `requested_dt` / `dt_used` / `degraded` 明确回给界面，不能静默替换。
- 录制容量 1200 → 6000，并让 `live()` 的钳制跟随这个常量，桥接同步一次取 `SYNC_PULL_LIMIT = 6000`。
- 前端两个预计算入口（运行前弹窗、数据条「接入」前）展示降级说明与实际步长。

## User Stories
- R-01：用户在设置里把 dt 调小，重新预计算后 PlotKit 预览的点数与时域分辨率明显提高。
- R-02：若请求的 dt 会超过 20 万步上限，界面明确说明「已降级步长 X（请求 Y）」，并提示缩小时间窗。
- R-03：不降级时（步数在上限内）曲线上限只受录制容量约束，不受「2000 帧」这种隐藏常数约束。

## Implementation Decisions
- 新增 `netlab/server.py::precompute_step_dt(seconds, requested_dt, *, max_steps=PRECOMPUTE_MAX_STEPS) -> (step_dt, degraded)`，把「选步长」抽成纯函数，避免为了测降级而真的跑 20 万步。
- `RECORDER_CAPACITY` 同时是「一次预计算最多保留多少采样点」的上限，注释写明；`plotkit_bridge.SYNC_PULL_LIMIT` 绑定同一数值，避免两处漂移。
- 未改 PlotKit 侧渲染或数据存储；点数增加后由既有管线自动绘制。

## Testing Decisions
- `netlab/tests/test_plotkit_channels.py`：
  - `test_precision_increases_points_in_plotkit_preview`：0.05 s 预计算，1e-5 的点数必须远多于 1e-4（改前红在 600/1001）。
  - `test_precompute_honors_requested_dt`：响应 `dt` 必须等于请求的 1e-5，且 `degraded is False`、`frames > 3000`。
  - `test_precompute_uses_scene_dt_when_caller_omits_it`：前端只发 `seconds` 时，步长取场景配置的 dt（用户实际操作路径）。
  - `test_precompute_step_dt_degrades_openly`：纯函数验证超上限时返回 `(seconds/200_000, True)`。
- `netlab/tests/test_plotkit_frontend_auth.py::test_precompute_degradation_is_surfaced_in_both_call_sites`：两个调用点都显示降级信息。
- `netlab/tests/test_recorder_sampling.py`：原两条断言写死旧容量（`max(gaps) <= 3`、`2000 步必须降采样`），改为按容量常量与待读帧数计算期望，换成 12 s/1e-3 触发降采样。

## Out of Scope
- 不改仿真求解器精度语义（dt 仍由用户设置决定）。
- 不引入自适应步长或可变步长积分。
- 不调整 PlotKit 的前端绘制/降采样策略。

## 实测（2026-11-03）
- 修复前：`POST /api/plotkit/precompute {seconds:0.5, dt:1e-4|1e-5}` → `dt 0.00025, frames 2000`；PlotKit meta `count` 约 1001/1191。
- 修复后：0.5 s@1e-4 → `frames 5000, dt 1e-4, sample_every 1`，store 5000 点、gap 1e-4；0.5 s@1e-5 → `frames 5556, sample_every 9`，store 5556 点、gap 9e-5。
- 接口级 0.05 s：1e-4 → 约 500 点；1e-5 → 5000 点。
- `dt=1e-6` 在 1 s 窗口仍触发 20 万步上限，返回 `degraded: true` 与 `dt_used`，界面提示缩小时间窗。
- netlab 全量 `447 passed, 3 warnings`（61.31 s），退出码 0；结束阶段仍输出 2 行 `Windows fatal exception: code 0xc0000139`（既有问题，见 §7.48）。
- `python -m compileall -q netlab` 退出 0；`python -m netlab.desktop --selftest` 退出 0（`status 200`、`shim_injected True`）。
