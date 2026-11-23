# NetLab 断环 / 闭环传递函数数学审查

| 项 | 值 |
|---|---|
| 审查对象 | NetLab 3.20.2 / Project Schema 8，基线提交 `5c076eae55f739e2265327c0c73a7dac3440358a`（简写 5c076ea） |
| 工作树 | `.`（独立 worktree；被审 6 个源文件经 `git diff --quiet HEAD` 校验全部 CLEAN，磁盘内容==HEAD） |
| 审查方式 | 只读源码 + 以只读方式调用库函数做数值对拍；未修改任何源文件，唯一写入本报告 |
| 必读源码 | `netlab/core/compute/circuit/loop_analysis.py`、`descriptor_analysis.py`、`nyquist.py`、`netlab/core/compute/analysis.py`、`netlab/server_analysis/workbench.py`、`netlab/core/compute/circuit/analysis_envelopes.py` |
| 相关测试 | `netlab/tests/test_nyquist.py`、`test_analysis_envelopes.py`；附带核查 `test_loop_analysis.py`、`test_analysis_closed_loop.py` |
| 审查日期 | 2026-11-24 |

> 说明：`descriptor_analysis.py` 仅提供 `analyze_poles` / `build_output_matrices` 等描述系统工具，不参与断环定义本身；`analysis_envelopes.py` 为纯展示层（插值/标记），不含独立回路数学，二者在正文相应位置说明。

---

## 0. 结论速览（Findings）

| ID | 严重度 | 文件:行 | 一句话结论 |
|---|---|---|---|
| LM-01 | 高 | `analysis.py:2276-2284` | 界面显示的"闭环 T_synth"用 L/(1+sign·L) 合成，正确应为 G/(1+sign·L)；仅当正向增益 G≡返回比 L（单位反馈）时才偶然成立。现有测试电路上偏差 20 dB。 |
| LM-02 | 高 | `loop_analysis.py:430`、`analysis.py:2278-2279` | `feedback_sign` 被重复计入分母：L=loop_value 已自带反馈极性符号，再乘 sign 等于计两次；按文档传 sign=-1 表示正反馈会得到 1-L=1+|L| 的错误闭环。 |
| LM-03 | 高 | `loop_analysis.py:779-787, 822` | 电阻支路断环路径的闭环 `closed=direct`、`forward` 由 direct 反解、`parity_max_rel` 强制置 0——该路径未用 L 独立合成闭环，T=G/(1+L) 沦为同义反复，无法校验 L。 |
| LM-04 | 中 | `analysis.py:2299, 2304` 对比 `loop_analysis.py:436-440` | 界面 parity_max_rel 由 extraction.closed_loop=G/(1+L) 算出，却与 L/(1+L) 的显示曲线一起呈现，属"校验曲线≠绘制曲线"；同一张图上 T_synth 与 T_direct 差 20 dB，parity 却报 1.8e-16。 |
| LM-05 | 中 | `nyquist.py:153, 180` | 包围数临界点硬编码为 -1+0j，与 feedback_sign 无关；正反馈（特征方程 1-L=0）应绕 +1，当前判据对正反馈错误。仅相位裕度公式(99行)用到 sign。 |
| LM-06 | 中/低 | `nyquist.py:99` | 相位裕度 `180 + phase·feedback_sign` 在 sign=-1 时等于 180-dphase，对正反馈应以 0°/360° 为基准，公式语义存疑，需推导确认。 |
| LM-07 | 中 | `loop_analysis.py:747-751` | 支路断环在"运放行增益整体×1000"的扰动系统上测量 L，得到理想化运放近似回路增益，且不向用户告警。 |
| LM-08 | 低 | `loop_analysis.py:45-59` | 未显式建模/输出反馈因子 H(s)；LoopExtraction 只有 loop_gain 与 forward_gain，无 H，无法把 L 拆成 A·H 分别核查。 |
| LM-09 | 低 | `loop_analysis.py:434, 781` | 仅取 `C[0]@x + D[0,0]`（第 0 个输出行）；多输入/多输出探针不被支持，静默丢弃其余输出。 |

经验证"非缺陷"两点：VCCS 的 `forward_value=vector_input[position]`（输出节点电压）与 G 定义自洽（425 行），非缺陷；用解析 L(s) 评估频率响应（`analysis.py:1382-1412`）可缓解高频 -160 dB 数值地板与相位跳变，属合理设计。

---

## 1. L(s) / G(s) / H(s) / T(s) 的实际定义

### 1.1 受控源断环路径（`extract_controlled_source_loop`）

断点：把电路内一个受控源（VCVS 的 E 支路，或 VCCS 的 G 支路）作为反馈环断点。复制装配矩阵（不改模型）后把受控源替换为独立测试激励，令其输出端等于测试量：

- VCVS：撤销原受控源戳记、令支路方程变为 `v_a - v_b = v_t`，即输出端被钳位到测试电压（`loop_analysis.py:155-200` 的 `_broken_matrices`）。
- VCCS：把受控电流源置零（开路），在输出节点注入测试（`loop_analysis.py:188-210`）。

模块自述（原文，`loop_analysis.py:1-13`）：

```
1  """闭环回路增益提取（受控源断开法）。
3  本模块把电路中的一个受控源（VCVS / VCCS）视为反馈环路的断点：保留电路
4  其余部分不变，把该受控源的输出换成独立测试激励，求解控制电压对测试激励
5  的传递关系，得到回路增益 L(s)（return ratio）。
9  * 负反馈的返回比为正；feedback_sign=+1 表示负反馈，-1 表示正反馈。
10 * VCVS 的正向增益取 G = gain * (v_c - v_d)，其中输出端被钳位为零、
11   输入激励保持有效；闭环传递函数 T = G / (1 + feedback_sign * L)。
12 * VCCS 的正向增益取"把受控电流源置零（开路）后在输出节点测得的电压"。
13 * 直接闭环响应用于校验：偏离超过阈值时只发警告，不伪称精确。
```

每个频率上的核心计算（`loop_analysis.py:407-430` 原文）：

```
410  vector_test  = _solve(matrix, test.astype(np.complex128), omega)
411  control_test = _control_voltage(model, element, vector_test)
413  vector_input = _solve(matrix, input_rhs.astype(np.complex128), omega)
414  control_input= _control_voltage(model, element, vector_input)
416  if element.kind in ("vcvs", "opamp", "comparator"):
417      gain = _opamp_slope(...) if ... else float(element.gain)
418      loop_value    = -gain * control_test
419      forward_value = gain * control_input
420  else:  # vccs
421      gm = float(element.transconductance)
425      forward_value = complex(vector_input[position])
426      loop_value    = -gm * control_test
428  loop_values[index] = loop_value
429  forward[index]     = forward_value
430  closed[index]      = forward_value / (1.0 + sign * loop_value)
```

于是各量定义（受控源路径）：

- L(s) = loop_gain = -A·control_test：A=受控源增益（VCVS 用 gain，opamp 用工作点斜率 _opamp_slope，VCCS 用 gm），control_test = 输出被钳位到单位测试时受控源感测端 (v_c-v_d) 的响应。这是返回比 return ratio，已自带反馈极性符号（负反馈时为正），且与输入源无关（测试与输入分两次线性求解）。
- G(s) = forward_gain = A·control_input（VCVS）/ 输出节点电压（VCCS）：含义为输出被钳位到零（反馈通路失效）、输入激励有效时的前向增益。
- H(s)：代码不单独建模、不输出。反馈因子隐含在 L 中（L=-A·H，H=感测端电压/输出），LoopExtraction 无 H 字段（见 `loop_analysis.py:45-59`）。
- T(s)：提取器内部 `closed_loop = G/(1+sign·L)`（430 行，公式正确）；直接测量 `direct_response = C[0]@x + D[0,0]`（432-434 行，物理闭环真值）；但界面显示的 T_synth 却用 `L/(1+sign·L)`（`analysis.py:2276-2284`，见第 3 节，错误）。

`LoopExtraction` 字段（`loop_analysis.py:45-59`）：element, kind, input_source, output_probe, output_name, feedback_sign, frequencies_hz, loop_gain, forward_gain, closed_loop, direct_response, parity_max_rel, poles, warnings, open_loop_transfer。其中 open_loop_transfer 存的是 L(s) 的解析式（`_analytic_open_loop`），不是 H。

### 1.2 电阻支路断环路径（`extract_branch_loop`）

断点：在无源反馈电阻支路上断开（用于多级运放外环），向求和/输入侧节点注入 -1 A 测试电流，测支路电压差×g 作为返回比。自述（`loop_analysis.py:699-703`）：

```
699  """在无源反馈支路上断开并注入测试电流，按 return ratio 求真实开环 L(s)。
701  选中的电阻支路连接输出侧(a)与求和/输入侧(b)。断开后向 b 注入
702  -1 A 测试电流、测量支路电压差 (v_a - v_b) × g，即为返回比。
703  这不会断开运放自身的局部反馈，适合运放构成的多级反馈环外环测量。
```

核心（`loop_analysis.py:753-787, 822` 原文）：

```
753  # 移除该无源支路的导纳戳记，相当于把反馈支路断开。
754  A[ai, ai] -= g
755  A[bi, bi] -= g
756  A[ai, bi] += g
757  A[bi, ai] += g
759  inject = np.zeros(...); inject[bi] = -1.0
761  output_row = np.zeros(...); output_row[ai] += g; output_row[bi] -= g
777  loop_value = complex(output_row @ vector)
779  if direct is not None:
781      direct[index] = complex(C[0] @ original + D[0, 0])
783      closed[index] = direct[index]                              # 闭环直接取原电路测量值
784      forward[index] = direct[index] * (1.0 + sign * loop_value) # G 由 direct 反解
785  else:
786      closed[index] = loop_value / (1.0 + sign * loop_value)
787      forward[index] = loop_value
822  parity_max_rel=0.0 if direct is not None else ...
```

该路径的 L 定义正确（返回比），但 T 与 G 不是独立合成：闭环直接取 direct，G 由 direct 反解，parity 强制 0（见 LM-03）。

### 1.3 汇总表

| 量 | 受控源断环 | 电阻支路断环 | 说明 |
|---|---|---|---|
| 断点 | 受控源输出端（输出钳位） | 无源反馈电阻支路（注入 -1A） | 两者断点不同 |
| L | `-A·control_test`（418,426） | `g·(v_a-v_b)`（762-763,777） | 均返回比，负反馈为正 |
| G | `A·control_input` / 输出节点电压（419,425） | 由 direct 反解（784） | 后者非独立测量 |
| H | 未输出（隐含于 L） | 未输出 | 无字段 |
| T(提取) | `G/(1+sign·L)`（430） | `direct`（783） | 前者正确、后者旁路 |
| T(界面显示) | `L/(1+sign·L)`（analysis.py:2278） | 同左（走同一合成） | 错误，见 LM-01 |

---

## 2. 关键公式行原文（file:line）

- 受控源断环闭环：`closed[index] = forward_value / (1.0 + sign * loop_value)` —— `netlab/core/compute/circuit/loop_analysis.py:430`
- 工作台闭环合成：`candidate_synth = loop_response / (1.0 + float(feedback_sign) * loop_response)` —— `netlab/core/compute/analysis.py:2278-2280`；随后 `closed_synth = candidate_synth` 覆盖 `extraction.closed_loop` —— `analysis.py:2284`
- 提取器返回值定义：
  - `loop_gain` = `loop_values`（L；核心 418/426，组装见 `loop_analysis.py:488-503`）
  - `forward_gain` = `forward`（419/425）
  - `closed_loop` = `closed` = `forward/(1+sign·loop)`（430）
  - `direct_response` = `C[0]@original + D[0,0]`（432-434）
  - `open_loop_transfer` = `_analytic_open_loop(...)` 的解析式，即 L 的解析表达（442；定义约 200-345）
- 路径选择：`analysis.py:2189-2207` 按元件 kind 选 `extract_branch_loop`（resistor）或 `extract_controlled_source_loop`；`analysis.py:2211-2213` 用解析 L 覆盖数值 L；`analysis.py:2214-2216` 调 `stability_margins`。
- Nyquist：`phase_margin_deg = 180.0 + phase_at * float(feedback_sign)`（`nyquist.py:99`）；`winding_number(values, point=-1.0+0.0j)`（153）；`encirclements = winding_number(contour)`（180，未传 point）。

---

## 3. 等价性判定与推导

### 3.1 受控源返回比分解与 Black 公式（严格推导，证明提取器 closed_loop 正确）

设受控源输出被替换为测试 t：`v_a - v_b = t`，控制端电压记 `c = v_c - v_d`。系统线性，故
`c = T_ct·t + T_ci·i`（i 为独立输入；`T_ct=control_test`，`T_ci=control_input`）。
受控源"将要输出"的量 `y = A·c = A·T_ct·t + A·T_ci·i`。

- 返回比定义 `L = -(返回至断点的量)/(注入量) = -y/t|i=0 = -A·T_ct`。这正是代码 `loop_value=-gain*control_test`（418）。✔
- 前向增益（反馈失效、输出钳位 t=0 时）`G = y/i|t=0 = A·T_ci`。代码 `forward_value=gain*control_input`（419）。✔
- 闭环：物理闭环时注入量即输出，`t=y`，代入 `y=A·T_ci·i + A·T_ct·y` 得 `y/i = A·T_ci/(1 - A·T_ct) = G/(1+L)`。

因此闭环恒有 T = G/(1+L)，且分母就是 `1+L`，无需再加 sign（L 已含极性）。提取器 `closed=forward/(1+sign·loop)` 在 sign=+1 时与此一致（正确），sign=-1 时变成 `1-L`（错误，见 3.3）。

### 3.2 界面 T_synth = L/(1+L) 与提取 T = G/(1+L) 的等价条件

二者相等 ⇔ `G(s) ≡ L(s)`（逐频）。而

- 非反相运放：`L = A·β`，`G = A`（输出钳位时 control_input=v_in，无分压），故 `G/L = 1/β`。仅当 β=1（单位反馈/跟随器）才 G=L、两式一致；β≠1 时 T_synth 比真值小 1/β 倍。
- 一般多级放大器中 G 与 L 量纲/含义不同（前向电压增益 vs 无量纲返回比），几乎不可能相等。

结论：界面显示闭环（L/(1+L)）与正确闭环（G/(1+L)）不等价，仅在单位反馈且前向增益=返回比的特殊情形等价。这是 LM-01 的根因。

### 3.3 feedback_sign 双计符号（LM-02）

由 3.1，正确分母恒为 `1+L`。而 `L=loop_value=-A·T_ct` 的符号由电路物理反馈极性决定：负反馈→L>0（题述"负反馈返回比为正"），正反馈→L<0。把 sign 再乘上 L 等于把极性算了两次：

- 负反馈电路、传 sign=+1：`1+L` → 正确；
- 负反馈电路、误传 sign=-1：`1-L` → 错误；
- 正反馈电路、传 sign=+1（默认）：`1+L=1-|L|` → 正确（再生）；
- 正反馈电路、按文档传 sign=-1：`1-L=1+|L|` → 错误（无再生却报稳定增益）。

数值实证（第 7 节）：正反馈放大器 gain=1.5, β=0.5，L=-0.75, G=-1.5：sign=+1 时 closed=-6.0=direct=-6.0 ✔；sign=-1 时 closed=-0.857、direct=-6.0、parity=0.857 ✘。

即 feedback_sign 并非与电路无关的独立物理参数；唯一正确取值是使其不改变物理符号（等价于固定 +1）。现有单测 `test_loop_analysis.py:143-152`（test_positive_feedback_sign_changes_closed_loop）把该电路（物理上仍是负反馈）在 sign=-1 下的 `gain/(1-gain·β)` 当作"预期"，且未与 direct_response 对拍，从而把双计符号固化进测试。

### 3.4 G 与 L 混用（LM-01 / LM-04 共性根因）

提取器已算出 forward_gain（G）和 closed_loop（G/(1+sign·L)），但 `analysis.py:2276-2284` 在 display=="closed_loop" 时用 loop_response（即 L，且可能还是解析 L）当作分子重算 `L/(1+sign·L)`，丢弃了 G。这既引入 1/β 量级误差，也把"分析 L 的解析曲线"误当"前向增益"使用。

### 3.5 数值反证（基于现有测试电路，非本审查构造）

采用 `test_analysis_closed_loop.py:14-36` 的同一电路（gain=1e5, R1=1k, R2=9k，β=R1/(R1+R2)=0.1）：

| 量 | 解析/实测 | 数值 |
|---|---|---|
| L=Aβ | 1e5×0.1 | 10000 |
| G=A（输出钳位） | 1e5 | 100000 |
| 真闭环 T（direct） | A/(1+Aβ)=1e5/10001 | 9.9990 → 19.999 dB |
| 提取 closed_loop | G/(1+L)=1e5/10001 | 9.9990 → 19.999 dB ✔ |
| 界面 T_synth | L/(1+L)=1e4/10001 | 0.9999 → -0.00087 dB ✘ |
| 报告 parity_max_rel | — | 1.78e-16（自称完美） |

即同一张闭环 Bode 图上 T_synth 与 T_direct 相差 20 dB（1/β=10 倍），而 parity_max_rel 仍报 ~1e-16。`test_analysis_closed_loop.py:39-57` 只断言两曲线标签存在、parity 与 metrics 相等，从未逐点比较 T_synth 与 T_direct，故测试通过而缺陷不被发现（LM-04）。

---

## 4. 逐条缺陷与证据

### LM-01（高）界面闭环用 L 代替 G
- 证据：`analysis.py:2276-2284`（candidate_synth = loop_response/(1+sign*loop_response)，覆盖 extraction.closed_loop）；`loop_analysis.py:419,430` 证明 G 与 G/(1+L) 均已具备。
- 反证：第 3.5 节，β=0.1 时 T_synth 与 T_direct 差 20 dB。
- 影响：非单位反馈闭环幅频/相频整体错误（|T| 缩放 1/β）；相位因复增益缩放而在某些频段翻转。
- 修复建议（只读审查，仅建议）：display=="closed_loop" 直接用 extraction.closed_loop（=G/(1+sign·L)），不要用 loop_response 重算。

### LM-02（高）feedback_sign 双计
- 证据：`loop_analysis.py:430`、`analysis.py:2278-2279`；文档 `loop_analysis.py:9,11` 建议 sign 表示反馈类型；`test_loop_analysis.py:143-152` 固化。
- 反证：第 3.3 节 正反馈 sign=-1 → closed=-0.857 vs direct=-6.0（parity 0.857）；负反馈 sign=-1 → 6.0 vs 0.857（parity 6.0）。
- 建议：分母统一取 1+loop_value（sign 恒并入 L）；或先在提取阶段把 L 归一化为正幅值并显式记录真实极性，二者只能取其一。

### LM-03（高）电阻支路闭环自证循环
- 证据：`loop_analysis.py:783`（closed=direct）、784（forward=direct·(1+sign·L)）、822（parity=0.0 if direct）。
- 结论：该路径下 T=G/(1+L) 由构造恒成立，parity_max_rel=0 是强制的，不能作为 L 正确性的独立验证；无 direct 时（786）又退回 L/(1+L)=G/(1+L)（隐含 G=L）。
- 建议：另算一份"仅用 L、G 合成"的 T 并与 direct 对拍，parity 用其差而非 0。

### LM-04（中）parity 证据错配
- 证据：`analysis.py:2299` 上报 extraction.parity_max_rel（基于 G/(1+L)），`analysis.py:2304-2313` 绘制 T_synth（=L/(1+L)）与 T_direct。两者基准不一致。
- 反证：第 3.5 节 parity=1.78e-16，而两曲线差 20 dB。
- 建议：parity 应基于实际绘制曲线计算。

### LM-05（中）Nyquist 临界点固定 -1
- 证据：`nyquist.py:153`（默认 point=-1+0j）、180（调用不传 point）；`nyquist.py:99` 仅相位裕度用 sign。正反馈特征方程 1-L=0，临界点应为 +1。
- 测试覆盖：`test_nyquist.py` 全部用例（28/34/42/49/64/77/90 行）均未设置 feedback_sign，只验证负反馈/默认情形，无正反馈覆盖。
- 建议：nyquist_metrics 依 feedback_sign 选临界点（-1 或 +1），并补正反馈用例。

### LM-06（中/低）相位裕度基准
- 证据：`nyquist.py:99`。负反馈 PM=180+∠L 正确；sign=-1 时 PM=180-∠L，对正反馈（不稳发生在 ∠L=0°/360°）并非正确"距 0° 的裕度"，疑为把 -180° 基准机械套用。需以正反馈小电路解析对拍确认。

### LM-07（中）支路 L 在扰动系统上测量
- 证据：`loop_analysis.py:747-751` 将每个运放行中对角外非零元素 ×1000，再在此扰动 A 上测 L（776 行 A+1jωE）；而 direct 用原始 system.solve（780 行）。二者系统不一致，L 为理想化近似，且无告警。

### LM-08（低）无 H(s) 输出
- 证据：`loop_analysis.py:45-59` LoopExtraction 无 H 字段；正文无任何计算/返回反馈因子。导致无法分别核查 A 与 H，也无法提示 β。建议增补 feedback_factor 字段（=control_test，或 L/A）。

### LM-09（低）MIMO/多输出未支持
- 证据：`loop_analysis.py:434`（C[0]@original + D[0,0]）、781 同型；只取第 0 输出行。多输入/多输出探针静默丢弃其余通道。

---

## 5. 应覆盖的拓扑矩阵

| # | 拓扑 | 关注点 | 相关缺陷 |
|---|---|---|---|
| T1 | 单位负反馈（跟随器 β=1） | G=L，两公式应一致 | LM-01 的"偶然正确"边界 |
| T2 | 非单位负反馈（非反相放大器 β<1） | G≠L，偏差 1/β | LM-01 |
| T3 | 反相放大器 | G 与 L 符号/量级 | LM-01/02 |
| T4 | 正反馈（Schmitt/闩锁） | L<0、临界点 +1、PM 基准 | LM-02/05/06 |
| T5 | 多级运放外环（电阻支路断环） | 支路闭环是否独立合成 | LM-03/07 |
| T6 | VCVS 断环 | 返回比与前向增益定义 | 基线正确性 |
| T7 | VCCS（跨导）断环 | forward=输出节点电压 | 已验证自洽 |
| T8 | 纯无源反馈支路（无运放） | branch_candidates 为空时应拒绝 | 边界 |
| T9 | 任意输出探针（非 out 节点/支路电流） | _resolve_node/build_output_matrices | LM-09 |
| T10 | 多输入多输出 | 仅取 C[0]/D[0,0] | LM-09 |
| T11 | 直接闭环 vs 断环合成对拍 | parity 是否基于所绘曲线 | LM-04 |
| T12 | 高/低频条件数 | 解析 L 与数值 L 的地板/相位 | analysis.py:1382-1412 缓解 |
| T13 | 近奇异（1+sign·L→0 或矩阵病态） | closed 发散、parity 分母 | 需加防护 |

---

## 6. 数值对拍测试矩阵（Case → 预期解析式 → 比较量 → 容差）

均可用低阶可解析电路（VCVS 增益 A + 电阻分压 β，或单/双极点 RC）建立，全部可解析求闭式。建议以"直接闭环 direct_response"为物理真值，对每条合成路径分别校核。

| Case | 电路/参数 | 预期解析式 | 比较量 | 容差 |
|---|---|---|---|---|
| C1 | 单位负反馈 A=1e5, β=1 | L=A, G=A, T=A/(1+A)≈1 | T_synth vs T_direct；G vs L | rtol 1e-6 |
| C2 | 非反相 A=1e5, β=0.1 | L=Aβ=1e4, G=A=1e5, T=1e5/10001=9.999 | T_synth 应等于 T_direct；当前预期失败(差20dB) | rtol 1e-6（应暴露 LM-01） |
| C3 | 非反相 A=1e5, β=0.5 | T=1e5/50001 | 同上 | rtol 1e-6 |
| C4 | 反相 A, β | T=-Aβ/(1+Aβ)（或对应闭式） | T vs direct；G/L 符号 | rtol 1e-6 |
| C5 | 正反馈 A=1.5, β=0.5 | L=-0.75, T=G/(1+L)=-6 | sign=+1 时 T=direct；sign=-1 应报 parity 大 | rtol 1e-6 |
| C6 | 单极点运放 A=A0/(1+s/p1) | L=A0β/(1+s/p1)，0dB 穿越 f=A0β·p1，PM≈90° | stability_margins 的 fc、PM、GM vs 解析 | PM ±0.5°, fc rtol 1e-3 |
| C7 | 双极点 A=A0/((1+s/p1)(1+s/p2)) | 解析 PM/GM/穿越 | margins vs 解析 | rtol 1e-3 |
| C8 | 积分器/Miller（L=ωu/s） | |L|=1 在 f=ωu/2π，PM=90°，GM=∞ | margins vs 解析 | fc rtol 1e-3 |
| C9 | VCCS 跨导 amp | 前向电压=gm·Z·control，L=-gm·control_test | forward vs 解析 | rtol 1e-6 |
| C10 | 多级运放外环（支路断环） | 独立算 T_exact，与 closed(=direct) 对拍，并与"仅 L,G 合成"对拍 | parity 应为真实差而非 0（暴露 LM-03） | rtol 1e-6 |
| C11 | 正反馈 Nyquist | 临界点 +1，Z=P-N(+1) | encirclements vs 解析；stable 判据 | 整数精确 |
| C12 | 近奇异 L→-sign（如正反馈 L→1） | T→∞ | |T| 单调增且不误报有限 | 相对误差 <1e-3 或标记发散 |
| C13 | MIMO 双输出 | 各输出独立 T | 应分别正确（当前仅第0行） | rtol 1e-6 |

容差建议：静态网络 rtol 1e-9（与 `test_loop_analysis.py:115,121` 一致），频率响应 rtol 1e-6，裕度角度 ±0.5°、增益 ±0.1 dB。

---

## 7. 复现脚本与实测数值

以下为本审查用于数值对拍的只读脚本（不写入任何源文件，仅进程内构造 Scene 调用库函数）：

```python
import sys; sys.path.insert(0, ".")
import numpy as np
from netlab.core.model.scene import Scene
from netlab.core.compute.circuit import DescriptorModel
from netlab.core.compute.circuit.loop_analysis import extract_controlled_source_loop

def amp(gain, r1, r2, invert=False):
    s = Scene("circuit")
    gnd = s.add_node(name="gnd", kind="ground"); vin = s.add_node(name="vin", kind="node")
    n = s.add_node(name="n", kind="node"); out = s.add_node(name="out", kind="node")
    s.add_edge(name="V1", source=vin.id, target=gnd.id, kind="vsource",
               params={"wave":"dc","offset":0.0,"amplitude":1.0})
    cs, ct = (n.id, vin.id) if invert else (vin.id, n.id)   # invert=True 使控制极性反向→正反馈
    s.add_edge(name="E1", source=out.id, target=gnd.id, kind="vcvs",
               params={"gain":gain,"control_source":cs,"control_target":ct})
    s.add_edge(name="R1", source=n.id, target=gnd.id, kind="resistor", params={"R":r1})
    s.add_edge(name="R2", source=out.id, target=n.id, kind="resistor", params={"R":r2})
    return s

def run(gain,r1,r2,invert=False,sign=1.0):
    m = DescriptorModel.from_scene(amp(gain,r1,r2,invert))
    e = extract_controlled_source_loop(m,"E1",np.array([10.0]),input_source="V1",output="out",feedback_sign=sign)
    L=complex(e.loop_gain[0]); G=complex(e.forward_gain[0])
    return dict(L=L.real, G=G.real, closed=e.closed_loop[0].real,
                direct=e.direct_response[0].real, parity=e.parity_max_rel,
                cand=(L/(1+sign*L)).real)
```

实测结果（E:/anaconda3/python.exe，scipy 1.16.3，2026-11-24）：

| 工况 | L | G | closed(提取) | direct | parity | L/(1+sign·L) |
|---|---|---|---|---|---|---|
| A=1e5,β=0.1,sign=+1 | 10000 | 100000 | 9.999 | 9.999 | 6.9e-13 | 0.9999 |
| A=1e5,β≈1,sign=+1 | 99999.9999 | 100000 | 0.99999 | 0.99999 | 2.2e-16 | 0.99999 |
| 正反馈 A=1.5,β=0.5,sign=+1 | -0.75 | -1.5 | -6.0 | -6.0 | 0.0 | -3.0 |
| 正反馈 A=1.5,β=0.5,sign=-1 | -0.75 | -1.5 | -0.857 | -6.0 | 0.857 | -0.4286 |
| 负反馈 A=1.5,β=0.5,sign=-1 | +0.75 | +1.5 | 6.0 | 0.857 | 6.0 | 3.0 |

此外，直接运行 `analysis.loop_analysis(..., display="closed_loop")` 于 `test_analysis_closed_loop.py` 电路得到：T_synth 幅值@10Hz=-0.00087 dB，T_direct 幅值@10Hz=19.999 dB，而 parity_max_rel=1.78e-16（见第 3.5 节）。

（注：E:/anaconda3/python.exe 含 scipy；捆绑 python 无 scipy，导入 descriptor_analysis 会因 `from scipy import linalg` 失败——这是环境问题，非被测代码缺陷，记录备查。）

---

## 8. 总结

1. 受控源断环的数学核心是正确的：T=G/(1+L) 经线性叠加严格可证，提取器 closed_loop、direct_response 与 parity 在同一电路上高度一致（parity ~1e-13）。L 为真实返回比，G 为输出钳位下的前向增益。
2. 面向用户的闭环 Bode 展示存在确证错误（LM-01，高）：界面用 L/(1+sign·L) 取代 G/(1+sign·L)，非单位反馈下偏差 1/β（现有测试电路 20 dB），且 T_synth/T_direct 同图相差 20 dB 而 parity 报 1e-16，属"校验证据与实际曲线错配"（LM-04）。
3. feedback_sign 用法有符号双重计入（LM-02，高）：正确分母恒为 1+L（L 自带极性）；按文档传 -1 表示正反馈会得到错误闭环。现有单测把该错误固化为预期且未与 direct 对拍。
4. 电阻支路断环路径不可独立验证（LM-03/07，高/中）：闭环取 direct、G 由 direct 反解、parity 强制 0，且在运放增益×1000 的扰动系统上测 L。
5. Nyquist 对正反馈失配（LM-05/06，中）：临界点固定 -1、相位裕度基准存疑，测试无正反馈覆盖。
6. 其余为结构性改进项：未建模 H（LM-08）、MIMO 仅取第 0 行（LM-09）。

本报告仅提出审查结论与修复建议，未修改任何源码。
