---
status: implemented
---
# 全局传递函数延迟近似与时域动态性能指标

## Problem
信号流网络中的连接可以带单步延迟（`edge.delay`）。R37 的全局总传函在 `domain="z"` 时能精确处理 `z⁻¹`，但 `domain="s"` 直接报错「连续 s 域总传函不支持（需 z 域分析）」，导致带延迟环节的网络无法在传递函数分析面板看 Bode、阶跃和零极点。截图现场：

```
连接 'scale-10' 带单步延迟，连续 s 域总传函不支持（需 z 域分析）
```

同时，阶跃响应指标只有终值、超调、上升时间、调节时间、稳态误差，缺少**峰值时间**；前端阶跃图也没有峰值标注，用户无法做完整的时域动态性能分析。

## Solution
### 1. s 域延迟边的 Padé 近似
- `analysis.transfer_function(..., domain="s", delay_pade_order=3)` 增加 `delay_pade_order` 参数，默认 3 阶，范围 1–8；非法值返回 `ok=false` 与中文原因。
- 单步延迟的物理时间取仿真步长 `T = sim.config.dt`，传递函数按 `e^{-sT}` 的 `[p/p]` Padé 有理近似：
  - `e^{-x} ≈ Σ_{k=0..p} C_k(-x)^k / Σ_{k=0..p} C_k x^k`
  - `C_k = (2p-k)! p! / ((2p)! k! (p-k)!)`
  - `x = sT`
- `domain="z"` 保持精确 `z⁻¹`，不受影响。
- 返回值增加 `delay_pade_order`、`delay_seconds`，并在 `assumptions` 明确「s 域延迟边为 p 阶 Padé 近似」。
- `/api/analysis/transfer` 的 GET query 与 `/api/analysis/tf` 的 POST body 都支持 `delay_pade_order`；默认 3。

### 2. 峰值时间与前端展示
- `transfer._step_metrics()` 增加 `peak_time`、`peak_value`：
  - 正终值取响应最大值，负终值取最小值；
  - 只有出现明显超调（`overshoot_pct > 0.05%`）时才给 `peak_time`；单调/过阻尼响应返回 `None`，避免把阶跃末点误报为峰值；
  - 不稳定系统两键均为 `None`。
- 前端传递函数分析摘要增加「峰值 … @ … s」；阶跃图在峰值点画圆点并标注峰值/峰值时间。
- 「传递函数」输入/输出节点推导改为调用 `/api/analysis/tf`，同时得到 Bode、阶跃、零极点与完整指标，不再只显示 H(s) 文本。

## User Stories
- R-01：作为用户，我推导带单步延迟的 s 域网络总传函，不再看到「需 z 域分析」，能正常看到 Bode/阶跃/零极点。
- R-02：作为用户，我可以选择 Padé 阶数（默认 3），并在结果中看到近似阶数与延迟时间假设。
- R-03：作为用户，我能在阶跃响应摘要和图上看到峰值时间、峰值、超调、上升时间、调节时间、稳态误差。
- R-04：作为用户，我输入单调一阶系统时峰值时间显示「—」，不会出现误导性的阶跃终点时间。
- R-05：作为用户，我从输入/输出节点点「推导」时，分析结果直接联动 Bode/阶跃/零极点视图。

## Implementation Decisions
- 用 Padé 有理近似而不是把 s 域延迟转成状态空间：实现小、可配置阶数、与现有 sympy 节点方程消元兼容。
- 延迟时间固定取 `sim.config.dt`（单步延迟语义），不引入额外参数；若 `dt<=0` 明确报错。
- 峰值时间用采样峰值索引，不做插值；阶跃响应默认 dt 已足够，且与峰值/超调同源。
- `tf_analysis` 对网络表达式先 `str(expr).replace("**", "^")`，避免 sympy 幂运算符与项目表达式解析器冲突。

## Verification
- `python -m pytest netlab/tests/test_transfer.py netlab/tests/test_network_tf.py -q` → 35 passed。
- `python -m pytest netlab/tests -q` 全量。
- 接口：`POST /api/analysis/tf` 带 `input_node/output_node/delay_pade_order`；`GET /api/analysis/transfer?delay_pade_order=1`。
- 闭环：带反馈 + 延迟的网络推导，DC 增益与阶跃终值一致。
- 精度：一阶 Padé 对 `e^{-sT}` 的 DC=1；3 阶在低频幅值/相位误差小于 1 阶。
- 性能：带延迟网络（≤20 节点）推导 + 阶跃 < 1 s；不显著增加普通网络耗时。

## Out of Scope
- 非单步延迟（多步/秒级任意延迟）的精确 s 域模型；本轮只处理现有 `edge.delay` 的单步语义。
- 把 Padé 近似写回求解器；求解器仍按离散延迟推进，分析旁路只读。
- 代替 z 域精确分析；z 域路径保留。
