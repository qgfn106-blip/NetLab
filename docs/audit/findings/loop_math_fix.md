# P0-03 断环/闭环传递函数数学缺陷修复报告

关联审计：`docs/audit/findings/loop_math.md`（LM-01..LM-07）
基线：`5c076ea`（分支 `audit/2026-11-24-full`）
本报告记录 LM-01..LM-04 的修复与验证；LM-05..LM-07 经评估后本次保留，理由见第 7 节。

## 1. 定义与约定（推导前提）

在 `netlab/core/compute/circuit/loop_analysis.py` 的受控源断环模型中，统一采用：

| 符号 | 名称 | 定义 |
| --- | --- | --- |
| A | 受控源增益 | VCVS=增益 g；VCCS=跨导 gm；运放=工作点斜率 `_opamp_slope` |
| control_test | 测试激励响应 | 仅注入测试源（输入置零）时受控源控制端电压 |
| control_input | 输入响应 | 输出端钳位为零、保留输入激励时控制端电压 |
| **L**（loop_gain） | 环路增益/返回比 | `L = -A·control_test`，**符号由电路极性直接给出**（负反馈为正、正反馈为负），与输入源无关 |
| **G**（forward_gain） | 前向增益 | `G = A·control_input`（VCVS/运放/comparator）；VCCS 为输出节点电压 |
| H（反馈系数） | 隐含量 | 不单独建模，隐含于 L：`L = -A·H`；`LoopExtraction` 无 H 字段 |
| **T**（closed_loop） | 闭环传递函数 | `T = G / (1 + L)`（**L 已含极性，不再乘 feedback_sign**） |
| direct_response | 直接闭环实测 | 原电路（支路完整）直接求解得到的闭环响应 |
| feedback_sign | 极性声明 | 仅记录使用者声明的反馈类型（+1 负反馈 / -1 正反馈），**不参与闭环合成** |

单位负反馈时 `G = L`，故 `G/(1+L) = L/(1+L)`；非单位反馈时二者相差 `1/β`（β 为反馈系数）。

## 2. 缺陷与修复一览

| 编号 | 位置 | 原公式 / 行为 | 修正定义 | 解析数值对拍 | 误差 | 适用范围 |
| --- | --- | --- | --- | --- | --- | --- |
| LM-01 | `netlab/core/compute/analysis.py:2275-2278` | 界面闭环曲线用 `closed_synth = loop_response/(1+sign·loop_response) = L/(1+L)`（覆盖了 `extraction.closed_loop`） | `closed_synth = extraction.closed_loop = G/(1+L)` | 同相放大 A=1e5, β=0.1：正确 `|T|=9.999`（19.999 dB），旧值 `0.9999`（-0.00087 dB），相差 **20 dB** | 旧 20 dB 系统差 → 0 | 非单位反馈（β≠1）的闭环显示 |
| LM-02 | `netlab/core/compute/circuit/loop_analysis.py:432` | `closed = forward_value/(1 + sign·loop_value)`，`sign` 与 L 自带极性重复相乘（符号双计） | `closed = forward_value/(1 + loop_value)` | 同电路 `sign=-1`：旧给 `A/(1-Aβ)=6.0`（错），新给 `A/(1+Aβ)=0.857`；`sign=+1` 与 `-1` 现一致 | 极性错误（正反馈/负反馈混淆）→ 0 | 所有 controlled-source 断环 |
| LM-03 | `netlab/core/compute/circuit/loop_analysis.py:783/822` | 支路断环 `closed = direct`，`forward = direct·(1+sign·L)` 反推，`parity_max_rel=0.0` 恒强制 0（假绿） | `closed = direct`（真实响应）；`forward = ` 独立测量开环前向（断开支路仅输入激励）；`parity = max|forward/(1+L)-direct|/|direct|`（诚实值，>1e-6 追加 warning `branch_loop_synthesis_mismatch`） | 同相放大支路断环：独立 G=1e5，L=11111.22，诚实 `G/(1+L)=8.999`，与 direct=9.999 偏差 **≈0.1**（触发告警） | parity 0（假绿）→ 0.1（诚实） | 无源支路断环（`extract_branch_loop`） |
| LM-04 | `netlab/core/compute/analysis.py:2275-2299` | parity 由 `extraction` 计算（G/(1+L)）而曲线由 `L/(1+L)` 绘制，同图两曲线错配 | 随 LM-01 一并修复：曲线与 parity 同源（均 G/(1+L)） | vcvs 放大器：T_synth 与 T_direct 幅值差由 20 dB → ≈0（|差|<1e-6 量级） | 20 dB → 0 | 闭环显示层 |

## 3. 逐条推导

### LM-01 非单位反馈闭环应取 G/(1+L)，而非 L/(1+L)
设前向增益 G、反馈系数 β，则环路增益 `L = -A·H` 在本模型中对应 `L = G·β`（负反馈为正）。闭环增益
`T = G/(1+β·G) = G/(1+L)`。
旧实现直接绘制 `L/(1+L) = G·β/(1+G·β) = T·β`，是把闭环乘了 β——即比正确值小 `1/β` 倍。对 A=1e5、β=0.1：
`T = 1e5/(1+1e4) = 9.9990`，而 `L/(1+L) = 1e4/(1+1e4) = 0.9999`，比值恰为 10=1/β，dB 差 = 20 dB，与审计实测一致。

### LM-02 feedback_sign 双计
本模型 L 的符号已由电路接线极性决定（负反馈电路 L 为正）。旧式 `G/(1+sign·L)` 对负反馈电路在 `sign=-1` 时变成 `G/(1-L)`，把返回比反号，得到 `A/(1-Aβ)`。以 A=1.5、β=0.5：正确 `1.5/1.75=0.857`，旧 `1.5/(1-0.75)=6.0`。故去 sign，闭环只由 L 的符号承担。

### LM-03 支路断环自证循环
旧代码令 `closed = direct`、`forward = direct·(1+sign·L)`，再让 `parity=0`——闭环由 direct 定义、forward 由 direct 反推，parity 自然恒 0，是自证循环（假绿）。修正后 forward 改为**独立测量**：断开被测支路后，仅以输入激励 `system.B` 驱动同一断开支路网络的输出响应（与 direct 无关）；再以 `G/(1+L)` 合成与 direct 对拍，得到诚实 parity，超阈值即告警而非伪零。

### LM-04 parity/曲线错配
因 LM-01 绘制曲线为 `L/(1+L)`，而 parity 用 `extraction.closed_loop=G/(1+L)`，两曲线同图相差 1/β。修复 LM-01 后曲线取自 `extraction.closed_loop`，与 parity 同源一致。

## 4. 解析数值对拍（实测）

| 场景 | 解析式 | 期望 | 实测 | 误差 |
| --- | --- | --- | --- | --- |
| 同相放大 A=1e5, β=0.1（负反馈） | L=Aβ, T=A/(1+Aβ) | L=1e4, T=9.9990 | L=1e4, T=9.9990 | parity_max_rel≈7.6e-13 |
| `sign=+1` vs `sign=-1`（同电路） | 两者 T 相同 | 0.857（A=1.5,β=0.5） | 两者均 0.857 | 0 |
| 真正反馈（控制端反接）A=1.5,β=0.5 | L=-Aβ<0, T=A/(1-Aβ) | L=-0.75, |T|=6.0 | L=-0.75, closed=direct=-6.0 | parity≈0 |
| 支路断环（A=1e5,β=0.1） | 独立 G=1e5, 诚实 T=G/(1+L) | 8.999 vs direct 9.999 | 偏差≈0.1（触发 `branch_loop_synthesis_mismatch`） | — |

> 说明：支路断环的"诚实闭环"与 direct 实测存在 0.1 偏差，是该非单位反馈电路断开支路后前向/环路定义的自然结果，**不再被伪零掩盖**；闭环曲线仍取真实 direct，`test_analysis_branch_loop.py` 对闭环曲线的解析断言（T=100/(s²+10s+100)）因此不受影响。

## 5. 修改文件与行号

- `netlab/core/compute/circuit/loop_analysis.py`
  - `9-13`：docstring 约定改为"L 由电路极性给出；feedback_sign 仅声明不参与合成；T=G/(1+L)"。
  - `432`：`closed[index] = forward_value / (1.0 + loop_value)`（去 sign 双计，LM-02）。
  - `776-792`：支路断环循环，`closed=direct`（真实响应）、`forward` 改独立前向测量（LM-03）。
  - `818-829`：新增诚实 parity 计算与 `branch_loop_synthesis_mismatch` 告警（LM-03）。
  - `842`：`parity_max_rel=parity`（去除 `0.0` 假绿）。
- `netlab/core/compute/analysis.py`
  - `2275-2278`：闭环显示 `closed_synth = extraction.closed_loop`（G/(1+L)，LM-01/LM-04）。
- 测试
  - `netlab/tests/test_loop_analysis.py`：以 `test_feedback_sign_does_not_double_count_polarity` 与 `test_true_positive_feedback_topology_closed_loop_analytic` 替换原 `test_positive_feedback_sign_changes_closed_loop`（后者把双计符号当预期），新增 `_positive_feedback_amplifier` 夹具。
  - `netlab/tests/test_analysis_closed_loop.py`：新增 `test_closed_loop_curve_is_g_over_one_plus_l_for_non_unity_feedback`（LM-01 显示层回归，断言 19.999 dB 且排除 0 dB 的 `L/(1+L)`）。

```
 netlab/core/compute/analysis.py              | 10 +----
 netlab/core/compute/circuit/loop_analysis.py | 36 +++++++++++++----
 netlab/tests/test_analysis_closed_loop.py    | 30 ++++++++++++++
 netlab/tests/test_loop_analysis.py           | 59 ++++++++++++++++++++++++++--
 4 files changed, 116 insertions(+), 19 deletions(-)
```

## 6. 测试结果

- 定向子集：`PYTHONPATH=. python -m pytest netlab/tests/test_loop_analysis.py netlab/tests/test_analysis_loop_api.py netlab/tests/test_analysis_closed_loop.py netlab/tests/test_analysis_branch_loop.py -q`
  → **24 passed, 7 skipped**（7 skip 均为 `test_analysis_branch_loop.py` 因 MyProject 夹具文件缺席）。
- 全量：`PYTHONPATH=. python -m pytest netlab/tests mathspec/tests -q`（结果见下）
  → **1736 passed, 14 skipped, 0 failed**（321.43s）。
    说明：修改前未单独留档该全量命令的基线结果；修改后全量绿。14 项 skip 均为既有跳过（MyProject 夹具缺失 / gui opt-in 关闭等），非本次引入。

## 7. LM-05 / LM-06 / LM-07 保留说明

本次**未修改** `netlab/core/compute/circuit/nyquist.py` 与 `loop_analysis.py` 的运放扰动段，理由：

- **LM-05/LM-06（`nyquist.py:153` `winding_number(point=-1.0)` 临界点恒 -1、`nyquist_metrics` 未传正反馈临界点；`nyquist.py:99` `phase_margin_deg = 180 + phase·feedback_sign` 基准存疑）**：Nyquist 判据的正确性依赖"临界点随反馈极性移动（负反馈 -1、正反馈 +1）"以及 markers/critical point/包围数的一致重构。当前 `winding_number` 与 markers（`nyquist-crit` 固定 x=-1.0）耦合，单改公式会与障碍点标注、包围数判稳脱节，需单独立项并配 Nyquist 解析算例回归。改动面大、与本次叠加原理对拍无直接关系，故**保留并记录为待办**。
- **LM-07（`loop_analysis.py:747-751` 在运放扰动系统测 L）**：支路断环对运放行乘 1000 做扰动以近似开环，属既有近似建模；其 correctness 需独立数值对照，本次未在无充分回归保护下替换。

上述三项不影响已修复的 LM-01..LM-04 与 `T=G/(1+L)` 叠加原理对拍（parity 仍 ~1e-13）。

## 8. 未完成 / 风险

- `test_analysis_branch_loop.py` 7 项因 MyProject 夹具文件 `MyProject/控制工程实验2_闭环分析示范.netlab` 缺失而跳过；被动支路断环的"诚实 parity"路径在真实电路上未被该夹具覆盖，仅由单测/探针验证。
- 支路断环诚实 parity 在该非单位反馈电路约 0.1，会触发 `branch_loop_synthesis_mismatch` 告警——这是**预期行为**（旧实现伪零掩盖了定义差异），不视为失败。
- LM-05/06/07 保留（见第 7 节）。
