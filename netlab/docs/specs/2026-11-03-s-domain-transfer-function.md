---
status: implemented
---
# s 域传递函数节点与分析（Simulink 式）

## Problem
信号流里表达线性环节只能拆成 gain / lag / integrate 等节点，或者用连接级 `tf` 方法（参数是离散差分系数）。用户要「直接用频域 s 方程写传递函数，并计算」，并参考 Simulink / xcos / python-control 的工作方式：一个块写 `(2s+1)/(s^2+3s+2)`，就能仿真、看 Bode、看阶跃、看零极点。

现状缺口：
- 没有 s 域有理式的统一解析与校验（因果性、分母非零、阶数上限）。
- 没有从 TF 自动构造状态空间并接入既有 `StateSpaceModel` 离散推进的节点。
- 分析面板只能对整张网络做符号传递函数推导，不能对单个 TF 直接做频响/阶跃/零极点。

## Solution
1. 新增 `netlab/core/compute/transfer.py`：
   - `TransferFunction(num, den)` 用降幂系数表示，内部升幂做多项式运算。
   - `parse_expression("(2*s+1)/(s^2+3*s+2)")` 支持 `s`、数字、`+ - * / ^`、括号、隐式乘法（`2s`、`2(s+1)`、`(s+1)(s+2)`）、整数指数（负指数交换分子分母）。
   - `from_coefficients` / `from_zpk` / `from_params` 三种输入形态。
   - TF → 可控标准型 `(A,B,C,D)`；静态增益单独处理。
   - `poles/zeros/stability/at/frequency_response/bode_data/step_response/analyze`。
2. 新增计算节点 `transfer_function`（「传递函数 G(s)」，组「高级」）：
   - `form=expr|coeff|zpk`；输入/输出字段、离散化方法、初值可配。
   - 运行时把入边按字段汇总成标量，推进离散状态空间，输出 `y`。
   - 静态增益直接乘，不建状态。
3. 分析旁路：
   - `analysis._node_tf` 识别 `transfer_function`，让整网符号推导能穿过该节点。
   - 新增 `analysis.tf_analysis(...)`：可直接传 `expr`、`num/den`、`zeros/poles/gain`，也可传场景节点名；返回表达式、零极点、DC 增益、稳定性、Bode、阶跃与指标。
   - 新增 `POST /api/analysis/tf`。
4. 前端分析面板新增「传递函数分析（s 域）」：节点下拉 + 表达式输入 + Bode / 阶跃 / 零极点三种视图，结果文本含 G(s)、阶数、零极点、DC 增益、稳定性与阶跃指标。
5. 版本戳 3.16.12（`UI_BUILD` / `APP_BUILD` / `index.html` 两处）。

## User Stories
- R-01：作为用户，我在信号流里放一个「传递函数 G(s)」节点，写 `(2*s+1)/(s^2+3*s+2)`，运行后输出与解析解一致。
- R-02：作为用户，我可以切到系数形态（`[2, 1] / [1, 3, 2]`）或零极点形态（zeros `[-0.5]`、poles `[-1,-2]`、gain `2`），三者等价。
- R-03：作为用户，我在分析面板选中该节点，点「分析」，能同时看到 Bode 图、阶跃响应和零极点图。
- R-04：作为用户，我可以不选节点、直接输入一个 s 表达式做旁路分析，不改场景。
- R-05：作为用户，非法表达式、非因果 TF、分母为零会得到明确中文原因，而不是 500。

## Implementation Decisions
- **多项式表示**：构造参数用降幂（与 Simulink / MATLAB 的 `num/den` 一致），内部用升幂便于加减乘与求值；对外再转回升幂系数（与既有 `analysis.transfer_function` 的 `numerator_coeffs` 口径一致）。
- **因果性**：`deg(num) > deg(den)` 直接拒绝（非因果，不能物理实现）；biproper 允许，`D = bn/an`，严格真部分进 `C`。
- **状态空间**：用可控标准型而不是符号仿真，直接复用 `StateSpaceModel.discretized(dt)`（zoh/tustin/backward/forward）和 `step`，避免在求解器里加第二条数值路径。
- **静态增益**：`n=0` 时 `to_state_space()` 返回 `None`，节点直接 `gain * u`；避免 0 维状态空间在既有模型里触发边界问题。
- **阶跃指标**：稳态误差用 `1 - dc_gain`，不用有限时长末值；不稳定/临界系统不编造 rise/settling/overshoot，统一返回 `None`。
- **分析旁路**：`tf_analysis` 不写场景、不改求解器，只读节点参数或请求体；节点模式要求 `scene.mode == "signal"` 且 `kind == "transfer_function"`。
- **错误边界**：解析/构造错误是 `AnalysisError`（HTTP 422）；节点运行时参数错误由既有工厂包装成 `ComputeError`（422）。
- **前端**：所有请求走 `api()` / `jsonRequest`（桌面 token）；面板重渲染后从 `state.analysisTF` 重绘，不丢结果。

## Testing Decisions
- 新增 `netlab/tests/test_transfer.py`（27 条）：
  - 解析器：有理式、隐式乘法、幂、负指数、非法字符/除零/超阶数。
  - 三种构造形态等价；TF→SS 在复点 `0.3+0.7j` 与 `tf.at()` 对比（误差 <1e-15）。
  - 静态增益、biproper、非因果、稳定性分类。
  - Bode 一阶 `1/(s+1)` 在 `ω=1` 处 `-3.0103 dB / -45°`。
  - 阶跃一阶指标 `rise≈2.197`、`settling≈3.91`、稳态误差 0；不稳定系统指标为 `None`。
  - 节点仿真：`1/(s+1)` 1000 步 × 0.01 s 终值≈1；静态增益 `3×2=6`；`x0` 长度错在 `scene.step` 抛 `ComputeError`。
  - 符号推导能穿过 `transfer_function` 节点；`POST /api/analysis/tf` 200 与 422。
- 既有全量测试只增不减；基线中的 2 条 `simulation` 相关失败属并行 WIP，不在本任务改。

## Out of Scope
- 不做梅森增益公式、状态空间一等公民、L1 术语/图形（仍属 R17 L1/L3 / P6）。
- 不做离散域 `z` 表达式解析；离散化仍由 `method + dt` 在运行时完成。
- 不做多输入多输出 TF 节点；节点仍是单入单出标量。
- 不做零极点拖动编辑、Bode 光标读数、PID 自动整定。
- 不改连接级 `tf` 方法的既有语义。

## Further Notes
- 用户原话（2026-11-03）：「优化信号流的功能，可以直接用频域s方程写传递函数，并计算，参考matlab simulink里的功能」；参考 xcos、pathsim、pathview、petercorke/bdsim、python-control。
- 与既有能力的关系：连接级 `tf` 是「离散差分系数」，本节点是「连续 s 有理式 + 自动离散化」；两者并存，不互相替代。
- 复现命令：
  - `python -m pytest netlab/tests/test_transfer.py -q`
  - `python -m pytest netlab/tests -q`
  - `python -m compileall -q netlab`

## 实现结果 + 实测
- 新增 `netlab/core/compute/transfer.py`（解析、TF、Bode、阶跃、`analyze`）。
- `netlab/core/compute/computes.py` 注册 `transfer_function`，参数键：`form/expr/numerator/denominator/zeros/poles/gain/field/output/method/x0`。
- `netlab/core/compute/analysis.py`：`_node_tf` 支持该节点；新增 `tf_analysis`。
- `netlab/server.py`：`AnalysisTFRequest` + `POST /api/analysis/tf`。
- `frontend/app.js` / `index.html`：s 域分析区与三种视图；静态版本 3.16.12。
- 定向测试：`27 passed`（2.11 s）。
- 冒烟：`tf_analysis(expr="(2*s+1)/(s^2+3*s+2)")` → DC 0.5、极点 `-2/-1`、零点 `-0.5`、stable；`1/(s+1)` 阶跃 `rise≈2.197`、`settling≈3.91`。
- 全量测试与收尾结果见 PROGRESS §7.54。
