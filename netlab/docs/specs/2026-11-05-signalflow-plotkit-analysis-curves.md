---
status: implemented
---
# 信号流分析曲线接入 PlotKit

## Problem
信号流分析面板能算 TF 阶跃、相图和探针波形，但只有原生 canvas 与 recorder CSV；PlotKit 数据接入只登记 recorder 探针通道，无法把一次分析曲线作为独立图层送进 PlotKit。直接把分析曲线塞进现有 store 又会被 `_ingest()` 按 recorder `t` 追加，破坏曲线。

## Solution
- `plotkit_bridge.ANALYSIS_PREFIX = "analysis:"`；`add_analysis_curve(name,x,y,...)` 将 x/y 作为独立 `life="replace"` 数据集写入当前 figure，并 `add_plot("line")`。
- `channels()` 过滤 `analysis:` 数据集；`_ensure_channels`/`_ingest` 跳过这些数据集，保证 recorder 时间轴不会改写分析曲线。
- `POST /api/plotkit/analysis` 接收 `{name,x,y,x_label,y_label}`；未挂载时返回 `mounted=false`。
- 前端 TF 面板「发送到 PlotKit」发送阶跃曲线；相图工具栏「发送到 PlotKit」发送当前相轨迹；TF 面板「导出 A/B/C/D」下载 `state_space` JSON。

## Verification
- `test_plotkit_bridge_sync.py::test_analysis_curve_keeps_its_own_x_axis`：3 点分析曲线不被 recorder 的 5 点 `t` 追加。
- `test_network_tf.py`/`test_analysis_api.py` 断言 `state_space` 字段。
- 目标测试 12 passed。
