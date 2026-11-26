# LM-05 / LM-06 / LM-07 只读分析与实施方案

> 状态：方案分析稿（未修改任何代码）
> 审计来源：`docs/audit/findings/loop_math.md`（P0-03 保留项）
> 代码基线：PR #75 合并后 origin/main `3817422a0e3c3e1d689d92cecd63dde0b2aa04be`（2026-11-26）
> 范围约束：FEM 继续冻结；本方案不触碰 FEM。

## 0. 结论摘要

| 编号 | 严重度 | 问题 | 建议处置 | 预计风险 |
|---|---|---|---|---|
| LM-05 | 中 | `nyquist_metrics` 的包围数临界点硬编码 `-1+0j`，正反馈应绕 `+1` | 临界点按 `point = -feedback_sign + 0j` 选择，marker 同步 | 低，补正反馈测试即可 |
| LM-06 | 中/低 | 正反馈相位裕度沿用负反馈 180° 基准，增益裕度也只找 -180° 穿越 | 引入 `critical_phase = -180°(负反馈) / 0°(正反馈)`，PM/GM 穿越点按 sign 选择；DC/端点需纳入判定 | 中低，需解析对拍 |
| LM-07 | 中 | 支路断环把运放行非对角增益 ×1000 后在扰动系统测 L/G，direct 用原系统，且无告警 | 首选显式语义化：标记 `loop_gain_kind=asymptotic_opamp` + `loop_gain_idealized` 告警；可选同时给出 exact L/G 或改走受控源断环 | 中，需比较 exact/asymptotic 对稳定性分类影响 |

## 1. LM-05：Nyquist 临界点固定为 -1

### 1.1 现状证据
- `netlab/core/compute/circuit/nyquist.py:153`：`winding_number(values, point: complex = -1.0 + 0.0j)`。
- `netlab/core/compute/circuit/nyquist.py:180`：`encirclements = winding_number(contour)`，未传 `point`。
- `netlab/core/compute/circuit/nyquist.py:294-306`：marker 硬编码 `x=-1.0`、`label="临界点 -1"`。
- `nyquist_envelope` 已在 `nyquist.py:240-259` 接收 `feedback_sign` 并传入 `nyquist_metrics`，无需改调用层。

### 1.2 数学结论
- 负反馈特征方程：`1 + L(s) = 0` → 临界点 `L = -1`。
- 正反馈特征方程：`1 - L(s) = 0` → 临界点 `L = +1`。
- 约定 `feedback_sign=+1` 表示负反馈、`-1` 表示正反馈，因此统一表达式：`critical_point = -feedback_sign + 0j`。
- 包围数仍沿用现有 `Z = P - N` 的实现约定；正反馈只是把被包围点从 -1 移到 +1，不改变轮廓方向与 winding 定义。

### 1.3 建议改动
1. `nyquist_metrics`：`encirclements = winding_number(contour, point=complex(-float(feedback_sign), 0.0))`。
2. `nyquist_metrics` 返回值增加 `critical_point_real: float`（-1 或 +1），供 UI/测试使用。
3. `nyquist_envelope` marker：
   - `x = -float(feedback_sign)`
   - `label = "临界点 -1" if feedback_sign >= 0 else "临界点 +1"`
   - detail 写清“feedback_sign=+1 为负反馈临界点 -1；-1 为正反馈临界点 +1”。
4. 新增正反馈解析用例：一阶 `L(s)=K/(1+sτ)`，正反馈闭环极点 `s=(K-1)/τ`。K<1 稳定、K>1 不稳定；两种情况下 `winding_number(contour, point=+1)` 的符号/闭环右半平面极点数应正确。

### 1.4 测试
- `test_nyquist.py` 增加 `feedback_sign=-1` 的包围数、稳定性和 marker 断言。
- 复用 `test_loop_analysis.py:143 _positive_feedback_amplifier`，补一层 Nyquist 端到端断言（正反馈 L<0，临界点 +1）。

## 2. LM-06：正反馈相位裕度/增益裕度基准

### 2.1 现状证据
- `nyquist.py:99`：`phase_margin_deg = 180.0 + phase_at * feedback_sign`。
- `nyquist.py:106-109`：phase crossing 目标固定为 `-180° + 360°k`。
- 影响：`feedback_sign=-1` 时 PM 变成 `180° - phase`，与正反馈“距 0° 的裕度”不符；GM 只找 -180° 穿越，正反馈应在 0°/360° 找穿越。

### 2.2 建议公式
令：
- `sign = float(feedback_sign)`
- `critical_phase = -180.0 if sign >= 0 else 0.0`

则：
- 相位裕度：`phase_margin_deg = wrap180((phase_at - critical_phase) * sign)`
  - 负反馈：`(phase + 180) * 1` = 原公式；
  - 正反馈：`(phase - 0) * -1 = -phase`。
- 相位穿越点：`target = critical_phase + 360° * k`，k 由展开相位的最小/最大值覆盖。
- 增益裕度：仍为 `-db_at`，但取正反馈的 0° 穿越，而非 -180° 穿越。
- `stable_from_margins` 仍要求 PM 与 GM 均为正（二者 AND），避免只看 PM 误判。

### 2.3 边界情况（必须在实现中处理）
- 一阶 `L=2/(1+sτ)` 正反馈：`L(0)=2`、相位 0°，说明 0° 穿越发生在 DC，且 |L|>1，GM ≈ -6 dB（不稳定）。若只按 `|L|=1` 的 `phase=-60°` 计算，会得到 PM=+60° 的误导结论；必须把 DC/端点 0° 穿越纳入或显式告警。
- 一阶 `L=0.5/(1+sτ)` 正反馈：无 |L|=1 穿越，PM 应为 None；DC |L|=0.5，GM≈+6 dB，系统稳定。
- 建议增加输出字段：`feedback_sign`、`critical_phase_deg`，并在正反馈且无 0° 穿越/端点不可判定时输出 `phase_margin_deg=None` + warning `nyquist_positive_feedback_margin_undefined`，以 Nyquist 包围数为最终判据。

### 2.4 测试
- 负反馈：现有 `test_nyquist.py` 全部用例必须保持数值不变（回归）。
- 正反馈：新增 `L=2/(1+sτ)`（不稳定）与 `L=0.5/(1+sτ)`（稳定）的解析对拍，断言 PM/GM 与 `stable_from_margins`。
- 正反馈相位穿越端口：`L=K/(1+sτ)`、K 接近 1，检查 0° 穿越与 DC 端点处理。

## 3. LM-07：支路 L 在运放扰动系统上测量

### 3.1 现状证据
- `netlab/core/compute/circuit/loop_analysis.py:740-753`：对每个运放行，把所有非 `ai_amp/bi_amp` 列的非零矩阵元素乘 `1000.0`。
- `loop_analysis.py:755-765`：再移除无源反馈支路导纳，形成断环激励/输出行。
- `loop_analysis.py:776-792`：逐频点用扰动矩阵 `A+1jωE` 求 `loop_value` 与 `forward`；`direct` 却用原系统 `system.solve(omega)`。
- `loop_analysis.py:794-796`：解析开环传递函数也基于扰动后的 `A`。
- `loop_analysis.py:798`：`warnings=[]` 在扰动之后才创建，当前没有任何“理想化”告警。
- `LoopExtraction`（`loop_analysis.py:43-61`）无 `loop_gain_kind` 字段，UI 无法区分 exact 与 asymptotic。

### 3.2 影响
- 运放有限增益被 ×1000 近似为“理想运放”，支路 L/G 为渐近近似；closed-loop direct 是真实原系统响应，因此两者口径不一致。
- 用户看到 L 曲线/裕度时不知道它来自扰动系统，可能把近似结果当作 exact。
- parity 若用同一扰动系统构造 `G/(1+L)` 对拍 direct，可能放大偏差或掩盖问题。

### 3.3 方案选项
**方案 A（推荐，低风险、语义显式）**
- 保留现有 ×1000 理想化，但在 `LoopExtraction` 增加 `loop_gain_kind: str = "exact" | "asymptotic_opamp"`。
- 当应用扰动时设为 `"asymptotic_opamp"`，加入 warning：
  `{"code": "loop_gain_idealized", "message": "反馈支路断环在运放增益×1000 的扰动系统上测量，回路增益为理想化近似", "severity": "warning", "opamp_gain_scale": 1000.0}`。
- `analysis_loop` 的 source_payload/analysis_params 透传该字段，前端展示“理想化运放近似”徽标与提示。

**方案 B（更物理一致、改动较大）**
- 在扰动 A 之外同时构造未扰动 `A_exact`（仅移除反馈支路导纳），分别计算 exact L/G；默认展示 exact，asymptotic 作为可选项保留。
- 风险：有限增益下数值条件可能变差，需验证稳定性和 parity；可作为后续增强。

**方案 C（长期架构）**
- 运放参与时强制走 controlled-source 断环（受控源断环已有真实模型），支路断环只用于纯无源反馈网络；对不支持的拓扑明确报错。改动最大，收益是彻底消除两套系统口径不一致。

### 3.4 建议分阶段
1. 先实施方案 A：语义标记 + 告警 + UI 透传，立即消除“静默近似”。
2. 再评估方案 B：增加 exact L/G 并与 asymptotic 对拍，默认切换需用户确认。
3. 方案 C 立项另行评估，不在本轮改代码。

### 3.5 测试矩阵
- 有运放 + 无源反馈支路：`loop_gain_kind == "asymptotic_opamp"`，warning `loop_gain_idealized` 存在，scale=1000。
- 无运放纯无源反馈支路：`loop_gain_kind == "exact"`，无该 warning。
- exact vs asymptotic 对比：同一电路两种 L 的幅值/相位差在预期范围，稳定性分类一致或差异有明确解释。
- parity 口径：`parity_max_rel` 与实际绘制曲线一致；不得用 `closed=direct` 自证。
- UI/API 契约：`source_payload` 或 envelope 暴露 `loop_gain_kind` 与 `warnings`，前端类型与快照测试同步。

## 4. 变更文件预估（仅方案，不动代码）

| 文件 | 改动 |
|---|---|
| `netlab/core/compute/circuit/nyquist.py` | LM-05 临界点与 marker；LM-06 裕度公式、穿越点与字段 |
| `netlab/core/compute/analysis_loop.py` | 透传 `critical_point_real`/新 warning；LM-07 透传 `loop_gain_kind` |
| `netlab/core/compute/circuit/loop_analysis.py` | LM-07 warning、`loop_gain_kind` 字段、（可选）exact L/G |
| `netlab/tests/test_nyquist.py` | 正反馈临界点、PM/GM、marker、端到端 |
| `netlab/tests/test_loop_analysis.py` | 运放/无运放 warning、exact vs asymptotic |
| `netlab/tests/test_analysis_api_surface.py` 或契约测试 | 新增字段/ warning 的 API 契约 |
| 前端类型/面板 | 如需展示 `loop_gain_kind` 与 warning，另行评估 |

## 5. 验收标准
1. 负反馈全部既有 Nyquist/loop 测试数值不变（零回归）。
2. 新增正反馈解析用例通过：临界点 +1、PM/GM 与解析一致、failing case 稳定判据正确。
3. LM-07 有运放时 warning 必现且字段透传；无运放时不误报。
4. 全量 pytest / 前端 typecheck/build/test / 架构检查 / 端点快照全部通过。
5. 文档更新 `loop_math_fix.md` 或新增本方案实施记录；LM-05/06/07 状态从“保留待立项”改为完成或明确分阶段完成。

## 6. 待用户确认
1. LM-05/06 是否按上述公式直接修复并补测试？
2. LM-07 是否先做方案 A（标记 + 告警），还是同时做方案 B（exact L/G）？
3. 本轮是否在 docs 分支一并提交并推送/开 PR？

> 备注：以上为设计分析，未修改任何源码；FEM 继续冻结。
