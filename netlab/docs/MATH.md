# netlab 数学原理文档

> 本文说明 netlab 各计算内核**实际在解什么方程**。所有公式均与仓库代码逐行核对，
> 每个公式后标注实现位置（`文件:行 函数名`）。若代码与本文冲突，以代码为准。
> 面向读者：想搞清楚"这一步到底在解哪个方程"的工程师。
>
> 最后更新：2026-11-06
>
> **行号时效说明（2026-11-07 校对）**：本文 `file:line` 锚点写于旧版 `nodal.py`；此后 `nodal.py` 经过重排（当前 HEAD 9b456e4），行号普遍漂移且**非线性**（如 `_build_index` 1492→1644、`_solve_matrix` 2034→2080、`operating_point` 2223→2269、`ac_sweep` 2289→2335）。符号级锚点已就地更正（§3、§5、§6–§10 的标题与文末索引）；**函数/类名始终可靠**，正文散落的分段行号若与代码不符，请以符号名重新定位为准（待批量重锚）。

本文只描述 `netlab/core/` 下的计算核心：

| 模块 | 文件 | 职责 |
| --- | --- | --- |
| 信号流 / 矢量网络 | `core/model/graph.py` | 拓扑求值、代数环检测、延迟边、事务步 |
| 电路 MNA + 瞬态 | `core/compute/nodal.py` | 改进节点法、元件盖章、积分、Newton、DC/AC |
| 状态空间 | `core/compute/statespace.py`、`linalg.py` | A/B/C/D、离散化、与信号流对接 |
| 有限元热传导 | `core/compute/fem.py` | Q4 双线性单元瞬态热 |
| 非线性器件 | `core/compute/transistors.py` | BJT / MOSFET |
| 数字与定时器 | `core/compute/logic.py`、`digital.py`、`timers.py` | 逻辑门、计数器/移位/DAC/ADC、555/LDO |
| 磁性 | `core/compute/magnetics.py` | 变压器、耦合电感 |
| 数值限制 | `core/common/limits.py`、`core/compute/params.py`、`simulation.py` | 规模上限、参数校验、预计算步数上限 |

---

## 0. 符号表

| 符号 | 含义 | 备注 |
| --- | --- | --- |
| $v_i$ | 节点 $i$ 的对地电压（未知量） | 地为参考 0 V |
| $i_k$ | 第 $k$ 条支路电流（未知量） | 独立电压源/VCVS/运放等 |
| $\mathbf{A},\ \mathbf{z}$ | MNA 系数矩阵、右端向量 | 解 $\mathbf{A}\mathbf{x}=\mathbf{z}$ |
| $g$ | 电导 | $g=1/R$ |
| $C,\ L$ | 电容、电感 | |
| $\Delta t$ | 时间步长 | 代码中 `dt` |
| $V_t$ | 热电压 $kT/q$ | $k=8.617333262\times10^{-5}\,\mathrm{eV/K}$ |
| $\beta$ | BJT 电流放大倍数 | |
| $\lambda$ | MOSFET 沟道长度调制系数 | |
| $\gamma$ | MOSFET 体效应系数 | |
| $\phi$ | MOSFET 表面势 | |
| $n$ | 发射系数（二极管/BJT） | |
| $I_s$ | 反向饱和电流 | |
| $\eta$ | 后向误差度量 | 见 §4 |
| $\omega$ | 角频率 $2\pi f$ | AC 扫描 |
| $N_i$ | 有限元形函数 | Q4 |
| $K,\ M$ | 全局刚度矩阵、质量矩阵 | FEM |
| $\rho c$ | 体积热容 | FEM `capacity` |
| $k$（FEM 上下文） | 导热系数 | 勿与 Boltzmann 混淆 |

误差/规模常量：`K_BOLTZMANN=8.617333262e-5`（nodal.py:41、transistors.py:11），
`MAX_NEWTON_ITERATIONS=60`、`NEWTON_ABS_TOL=1e-6`、`NEWTON_REL_TOL=1e-9`、
`MAX_ABS_VOLTAGE=1e9`（nodal.py:41-45）。

---

## 1. 信号流与矢量网络的求值

实现：`core/model/graph.py`。`Network.step()`（graph.py:497）推进一个时间步。

### 1.1 计算模型

一个网络由节点集合 $\mathcal{V}$ 与带方向的连接集合 $\mathcal{E}$ 构成。每条连接 $e\in\mathcal{E}$
带一个计算函数 $g_e$（`Connection.method`）与延迟标志 `delay`。`Connection.evaluate()`（graph.py:264）调用

$$
\mathbf{r}_e^{(k)} = g_e\big(\text{view}(u),\ \text{view}(v),\ \text{params}_e,\ \text{state}_e,\ \Delta t\big),
$$

其中 $u=$ `source`、$v=$ `target`，返回值为字典（`NodeData`），经 `json_safe` 校验。

每个节点 $v$ 有更新函数 $f_v$。一次非延迟传播可写成

$$
\mathbf{x}_v^{(k)} = f_v\Big(\{\mathbf{r}_e^{(k)}\}_{e:\,u\to v},\ \mathbf{x}_v^{(k-1)},\ \Delta t\Big).
$$

### 1.2 拓扑序传播

`Network.topological_order()`（graph.py:456）对**非延迟边**做 Kahn 算法：

1. 统计入度 `incoming_count`；
2. 入度为 0 的节点入 `ready` 栈；
3. 依次出栈、加入 `order`，并把其出边的目标入度减一。

若最终 $|\text{order}| \ne |\mathcal{V}|$，说明存在代数环，抛出 `ComputeError`（"网络中存在代数环"，
并最多列出 3 个环）。结果缓存于 `self._order`。

### 1.3 代数环检测

`Network.algebraic_cycles()`（graph.py:409）在**启用且非延迟**的边（`_enabled_edges(include_delayed=False)`，
graph.py:402）上做 Tarjan 强连通分量（SCC）。一个 SCC 若含 $>1$ 个节点，或单节点带自环，即为代数环：

$$
\text{cycle} \iff |\text{SCC}|>1 \ \ \text{或}\ \ \exists\,(u,u)\in\mathcal{E}.
$$

延迟边不参与，因为它输出的是上一时刻的值，天然打断代数环。

### 1.4 延迟边 = 单位延迟 $z^{-1}$

`step()`（graph.py:514-521）在步开始时**先**求值所有延迟边。此时所有节点仍持有上一时刻的值，
因此延迟边的输出恰为

$$
\mathbf{r}_e^{(k)} = g_e\big(\mathbf{x}^{(k-1)}\big) \quad\Longleftrightarrow\quad z^{-1}\,\mathbf{x}.
$$

因为求值顺序不影响结果（全部依赖旧值），延迟边可乱序求值。

### 1.5 逐步事务

`step()` 的执行顺序：

1. 校验 `dt`（有限、$>0$）；
2. `snapshot = capture_step_state()`（graph.py:541）—— 冻结 `time`、每节点 `(data,state,inputs,ports)`、每连接 `(state,output)`；
3. 求值延迟边（§1.4）；
4. 按拓扑序：清空节点输入/端口（graph.py:523-524）→ 求值该节点的非延迟入边（graph.py:531）→ `node.update(dt, time+dt)`（graph.py:535）；
5. `self.time += dt`（graph.py:536）；
6. 任何异常 → `restore_step_state(snapshot)`（graph.py:563）原地回滚并重新抛出（graph.py:537-539）。

即：**一步是全有或全无的**——中途失败时网络恢复到步前状态，不会留下半更新的节点。

---

## 2. 电路 MNA（改进节点法）

实现：`core/compute/nodal.py`。

### 2.1 未知量构成

`CircuitSolver._build_index()`（nodal.py:1492）定义未知向量

$$
\mathbf{x} = \big[\,v_1,\dots,v_N,\ \ i_{b_1},\dots,i_{b_M}\,\big]^{\mathsf T},
$$

- $v_1..v_N$：全部**非地**节点电压（地节点不进入未知量）；
- $i_{b_1}..i_{b_M}$：**需要支路电流**的元件（`needs_branch`：独立电压源、VCVS、运放、变压器、
  耦合电感、数字元件等）各贡献一个未知量，追加在节点电压之后（nodal.py:1530-1543）。

约束：**有且仅有一个地节点**（nodal.py:1495-1500）。未知量按节点 id 排序（nodal.py:1526），
`self.index` 给出 `节点名 → 行号`。矩阵尺寸 `matrix_size = len(unknown) + Σbranch_width`（nodal.py:1545）。

### 2.2 空矩阵

`_blank_matrix()`（nodal.py:1574-1578）：

- 稠密模式：`numpy.zeros((n,n))`；
- 稀疏模式：`scipy.sparse.lil_matrix`（LIL 便于逐元素 `+=` 盖章）。

稀疏与否由 `_decide_sparse()` 决定（nodal.py:1561-1572），`sparse="auto"` 时以
`sparse_threshold=200` 为界。

### 2.3 基本盖章原语

`_stamp_conductance(ctx, a, b, g)`（nodal.py:101-110）在节点 $a,b$ 之间加电导 $g$：

$$
A_{aa}\!+\!\!=g,\quad A_{bb}\!+\!\!=g,\quad A_{ab}\!-\!\!=g,\quad A_{ba}\!-\!\!=g .
$$

`_stamp_current(ctx, a, b, I)`（nodal.py:113-120）加一支从 $a$ 流向 $b$ 的电流源 $I$：

$$
z_a \!-\!\!= I,\qquad z_b \!+\!\!= I .
$$

"缺失/接地索引"跳过：任一端为地（`ctx.index.get(node) is None`）就跳过该行/列——这就是 GND 处理。

电阻：$g=1/R$，`_stamp_conductance`（nodal.py:194 `Resistor.stamp`）。

### 2.4 支路电流未知量（MNA 分块）

对含支路电流的元件，整体方程是分块形式

$$
\begin{bmatrix} \mathbf{G} & \mathbf{B}\\ \mathbf{B}^{\mathsf T} & \mathbf{0}\end{bmatrix}
\begin{bmatrix}\mathbf{v}\\ \mathbf{i}\end{bmatrix}
=\begin{bmatrix}\mathbf{j}\\ \mathbf{e}\end{bmatrix}.
$$

**独立电压源**（nodal.py:410 `VoltageSource.stamp`，nodal.py:423-433）：设占第 `row` 行，
方程 $v_a-v_b=\text{value}$，盖章

$$
A_{a,\text{row}}\!+\!\!=1,\ A_{\text{row},a}\!+\!\!=1,\quad A_{b,\text{row}}\!-\!\!=1,\ A_{\text{row},b}\!-\!\!=1,\quad z_{\text{row}}=\text{value}.
$$

**VCVS**（nodal.py:494 `VCVS.stamp`，nodal.py:505-521）：$v_a-v_b=\text{gain}\cdot(v_{c}-v_{d})$，
在电压源盖章基础上追加 $A_{\text{row},c}\!-\!\!=\text{gain},\ A_{\text{row},d}\!+\!\!=\text{gain}$，右端 $z_{\text{row}}=0$。

**VCCS**（nodal.py:536 `VCCS.stamp`，nodal.py:546-561）：受控电流 $i_{ab}=g_m(v_c-v_d)$：

$$
A_{a,c}\!+\!\!=g_m,\ A_{b,c}\!-\!\!=g_m,\ A_{a,d}\!-\!\!=g_m,\ A_{b,d}\!+\!\!=g_m .
$$

**运放**（nodal.py:657 `OpAmp.stamp`，nodal.py:748-763）：非线性支路，行方程
$\;v_a-v_b-\text{slope}\cdot(v_p-v_n)=\text{value}-\text{slope}\cdot u\;$，其中 $u=v_p-v_n$，
盖章 $A_{\text{row},p}\!-\!\!=\text{slope},\ A_{\text{row},n}\!+\!\!=\text{slope},\ z_{\text{row}}=\text{value}-\text{slope}\cdot u$。

其他：电流源（nodal.py:448 `CurrentSource`）用 `_stamp_current`；开关（nodal.py:468）
用 $g=1/R_{\text{on}}$（闭合）或 $1/R_{\text{off}}$（断开）。

---

## 3. 元件伴随模型与积分

实现：nodal.py 各元件的 `prepare()`（按 `dt` 生成伴随电导 $g$ 与等效电流源 `isrc`）与 `stamp()`。
支持的积分器：`trapezoidal`、`backward_euler`、`gear2`（BDF2），见 `CircuitSolver.__init__`（nodal.py:1469）。

统一伴随形式：元件被写成

$$
i_n = g\,v_n + \text{isrc}\quad\text{（电容）},\qquad
i_n = g\,v_n + \text{isrc}\quad\text{（电感，$v$ 为端电压）},
$$

其中下标 $n$ 表示第 $n$ 步，`isrc` 汇总历史项。

### 3.1 电容（`Capacitor.prepare`，nodal.py:266；`stamp`，nodal.py:292）

$i=C\,\dfrac{dv}{dt}$。

| 积分器 | 电导 $g$ | 等效电流源 `isrc` |
| --- | --- | --- |
| backward_euler | $C/\Delta t$ | $-g\,v_{n-1}$ |
| trapezoidal | $2C/\Delta t$ | $-g\,v_{n-1}-i_{n-1}$ |
| gear2 (BDF2) | $1.5C/\Delta t$ | $C\,(-2v_{n-1}+0.5v_{n-2})/\Delta t$ |

对应代码：BE（nodal.py:248-250），gear2（nodal.py:251-263），trapezoidal（nodal.py:264-268）。

- `stamp` 在 `dc` 模式：电容开路，不盖章（nodal.py:271-273）；
- `ac` 模式：盖 $j\omega C$ 电导（nodal.py:274-277）；
- `tran` 模式：盖 $g$ + `isrc`（nodal.py:278-279）。

### 3.2 电感（`Inductor.prepare`，nodal.py:366；`stamp`，nodal.py:389）

$v=L\,\dfrac{di}{dt}$，`DC_CONDUCTANCE=1.0e5` 表示直流短路。

| 积分器 | 电导 $g$ | 等效电流源 `isrc` |
| --- | --- | --- |
| backward_euler | $\Delta t/L$ | $i_{n-1}$ |
| trapezoidal | $\Delta t/(2L)$ | $i_{n-1}+g\,v_{n-1}$ |
| gear2 (BDF2) | $\Delta t/(1.5L)$ | $(2i_{n-1}-0.5i_{n-2})/1.5$ |

对应代码：BE（nodal.py:349-351），gear2（nodal.py:352-364），trapezoidal（nodal.py:366-367）。
`stamp`：`dc` 用 $g=10^5$（短路，nodal.py:370-372）；`ac` 若 $\omega=0$ 用 $10^5$，否则 $1/(j\omega L)$
（nodal.py:373-378）；`tran` 盖 $g$+`isrc`（nodal.py:379-380）。

### 3.3 dt 变化与历史不足的回退

gear2（BDF2）需要**两步历史且 $\Delta t$ 与历史步相同**才启用；缺 `older_*` 或 `dt` 改变时
**回退到 backward_euler**（电容节点 nodal.py:251-263 的 `older_v` 判断；电感 nodal.py:352-364 同理）。
backward_euler 只需一步历史，永远可用，故作为兜底。trapezoidal 只需 $v_{n-1},i_{n-1}$。

---

## 4. Newton 迭代与线性求解

实现：nodal.py 求解器。

### 4.1 残差定义（后向误差，尺度无关）

`_residual_metric()`（nodal.py:1809-1823）对候选解 $\mathbf{x}$ 计算

$$
\boldsymbol{\rho}=\mathbf{A}\mathbf{x}-\mathbf{z},\qquad
\eta=\frac{\max_i|\rho_i|}
{\max_j\!\big(|\mathbf{A}|\,|\mathbf{x}|\big)_j + \Delta t\cdot\max|\mathbf{z}| + 10^{-30}} .
$$

分母把电流量纲（含 $\Delta t$）与电压量纲统一，使 $\eta$ 无量纲——这就是"尺度无关的后向误差"。
函数返回 $(\eta,\ \arg\max_i|\rho_i|)$，后者用于定位"问题节点"。

### 4.2 收敛判据

- **线性电路**（`self.nonlinear == False`）：Newton 只跑 1 轮（nodal.py:1825）。
  接受条件 $\eta \le \mathrm{residual\_safety\_tol}=10^{-8}$（或用户 `residual_tol`），
  否则抛 `ComputeError`（"线性电路解质量不足"，nodal.py:1874-1885）。
- **非线性电路**：迭代至多 `max_iter=60` 轮。令 $\Delta=|\mathbf{x}^{\text{new}}-\mathbf{x}^{\text{old}}|$，
  逐分量判据（`_tolerance()`，nodal.py:1754；判据在 nodal.py:1888-1889）：

$$
\Delta_i \le \mathrm{reltol}\,|x_i| + \tau_i,\qquad
\tau_i=\begin{cases}\mathrm{vntol}=10^{-6}, & x_i\ \text{为节点电压}\\ \mathrm{abstol}=10^{-6}, & x_i\ \text{为支路电流}\end{cases}
$$

其中 `reltol=1e-9`。非线性元件每轮末调用 `update_guess()`（nodal.py:1900-1911）。

### 4.3 gmin stepping

`_newton_with_strategies()`（nodal.py:1703）：先试普通 Newton。失败则给每个对角元加
`gmin`（nodal.py:1864-1866）：

$$
\mathbf{A}\ \leftarrow\ \mathbf{A} + \mathrm{gmin}\,\mathbf{I},\qquad \mathrm{gmin}=10^{-3}\ \text{起}.
$$

若仍不收敛，`gmin` 每轮乘以 $0.1$（最多 `gmin_steps=10` 次）逐步降到 0（nodal.py:1727-1731）。

### 4.4 source stepping

gmin 失败后，把独立源按比例缩放做同伦：

$$
\mathrm{source\_scale}=\frac{k}{\mathrm{src\_steps}},\qquad k=0,1,\dots,\mathrm{src\_steps}=10,
$$

即从全零激励连续解到全激励（nodal.py:1732-1751）。所有策略都失败才抛错，并在消息里附残差、
问题节点与尝试过的策略。

### 4.5 稀疏 LU 与行列均衡

`_solve_matrix()`（nodal.py:1918-1941）：

- 稀疏：`scipy.sparse.linalg.splu`（预分解，后续 `lu_solve`）；
- 稠密且满足 GPU 条件：走加速后端；
- 否则做**行列均衡**：$\mathbf{A}_{\text{scaled}}=\mathbf{D}_r^{-1}\mathbf{A}\mathbf{D}_c^{-1}$，
  解 $\mathbf{A}_{\text{scaled}}\mathbf{y}=\mathbf{D}_r^{-1}\mathbf{z}$，再 $\mathbf{x}=\mathbf{D}_c^{-1}\mathbf{y}$。

对线性时不变电路，矩阵不变时 LU 只分解一次并被复用（后续步只回代）。

---

## 5. 直流工作点与 AC 小信号

### 5.1 operating_point（nodal.py:2269）

`operating_point()` 求 $\mathbf{x}$ 使 $\mathbf{A}_{\text{dc}}\mathbf{x}=\mathbf{z}_{\text{dc}}$：

1. 事务性 checkpoint；
2. `time=0`，独立源取波形在 $t=0$ 的值（`waveform_value(params, 0)`）；
3. 初值取**零向量**（不是上一步解）；
4. `_newton_with_strategies(1e-9, guess, mode="dc")`（nodal.py:2282-2284）；
5. 失败抛 `ComputeError`；成功则以 `dc` 模式 commit 各元件、导出节点电压。

DC 下：电容**开路**（不盖章），电感**短路**（$g=10^5$），非线性器件按工作点线性化。

### 5.2 ac_sweep（nodal.py:2335）

在 DC 工作点处线性化，对每个频率 $\omega$ 组**复数** MNA（`mode="ac"`）：

$$
\text{电容}\to j\omega C,\qquad \text{电感}\to \frac{1}{j\omega L}\qquad(\omega=2\pi f>0).
$$

独立源取单位激励，解复数线性系统得小信号响应。**AC 只支持线性元件与受控源（`AC_KINDS`：电阻/电容/电感/独立源/VCVS/VCCS/开关，`nodal.py:2256-2267`）；含二极管、晶体管、数字器件等非线性元件时，`ac_sweep` 直接抛 `ComputeError`（"AC 分析暂不支持元件…"，`nodal.py:2353-2359`），不做工作点线性化。** AC 频率必须为正的有限数（`nodal.py:2351-2352`；`freqs` 为空亦报错，`nodal.py:2349-2350`）。

---

## 6. 状态空间模型

实现：`core/compute/statespace.py`（模型）、`core/compute/linalg.py`（离散化）。

### 6.1 连续形式

$$
\dot{\mathbf{x}}=\mathbf{A}\mathbf{x}+\mathbf{B}\mathbf{u},\qquad
\mathbf{y}=\mathbf{C}\mathbf{x}+\mathbf{D}\mathbf{u}.
$$

`StateSpaceModel`（statespace.py:64）持有 $\mathbf{A}(n\times n),\mathbf{B}(n\times m),\mathbf{C}(p\times n),\mathbf{D}(p\times m)$，
`from_params`（statespace.py:79）校验维数、$m,p\le 6$、$|\text{矩阵元素}|\le 10^9$、方法合法。
`input_map` 把信号流节点的字段接到 $\mathbf{u}$，`output_map` 把 $\mathbf{y}$ 的分量写回节点字段。

### 6.2 离散化（`cont2discrete`，linalg.py:129）

支持 `zoh / forward / backward / tustin`：

- **zoh**（linalg.py:144-146 → `zoh_discretize`，linalg.py:110-122）：对增广矩阵做矩阵指数

$$
\exp\!\left(\begin{bmatrix}\mathbf{A}&\mathbf{B}\\ \mathbf{0}&\mathbf{0}\end{bmatrix}\Delta t\right)
=\begin{bmatrix}\mathbf{A}_d&\mathbf{B}_d\\ \mathbf{0}&\mathbf{I}\end{bmatrix}.
$$

- **forward**：$\mathbf{A}_d=\mathbf{I}+\Delta t\,\mathbf{A},\ \ \mathbf{B}_d=\Delta t\,\mathbf{B}$。
- **backward**：$\mathbf{A}_d=(\mathbf{I}-\Delta t\,\mathbf{A})^{-1},\ \ \mathbf{B}_d=\mathbf{A}_d\mathbf{B}\,\Delta t$。
- **tustin**（双线性，linalg.py:154-161）：令 $h=\Delta t/2$，

$$
\mathbf{A}_d=(\mathbf{I}-h\mathbf{A})^{-1}(\mathbf{I}+h\mathbf{A}),\quad
\mathbf{B}_d=(\mathbf{I}-h\mathbf{A})^{-1}\mathbf{B}\,\Delta t,\quad
\mathbf{C}_d=\mathbf{C}(\mathbf{I}-h\mathbf{A})^{-1},\quad
\mathbf{D}_d=\mathbf{D}+h\,\mathbf{C}(\mathbf{I}-h\mathbf{A})^{-1}\mathbf{B}.
$$

离散化结果按键 $(\Delta t,\text{method})$ 缓存（statespace.py:139-145）。

### 6.3 s 域传递函数（`core/compute/transfer.py`）

连续有理式按降幂系数表示：

$$
G(s)=\frac{N(s)}{D(s)}=\frac{b_n s^n+\cdots+b_1 s+b_0}{s^m+a_{m-1}s^{m-1}+\cdots+a_1 s+a_0}.
$$

分母首一化；`deg N > deg D` 视为非因果拒绝。真分式（$n<m$）转可控标准型：

$$
\mathbf{A}=\begin{bmatrix}0&1&0&\cdots&0\\ \vdots&&\ddots&&\vdots\\0&0&\cdots&0&1\\-a_0&-a_1&\cdots&-a_{m-2}&-a_{m-1}\end{bmatrix},\quad
\mathbf{B}=\begin{bmatrix}0\\\vdots\\0\\1\end{bmatrix},
$$

$$
\mathbf{C}=\begin{bmatrix}b_0-a_0 b_m&\cdots&b_{m-1}-a_{m-1}b_m\end{bmatrix},\quad D=b_m
$$

（biproper 时 $D=b_m$；$m=0$ 的静态增益直接 $y=G\,u$，不建状态）。随后复用 §6.2 的 `cont2discrete` 与 §6.4 的推进一步。

**频响**：$G(j\omega)$ 逐点求值，幅值 $20\log_{10}|G(j\omega)|$ dB，相位取 `unwrap(∠G)`；频率范围按零极点模长的 $1/100\ldots100$ 自动铺开（无零极点取 $0.1\ldots100$ rad/s），限 $10^{-6}\ldots10^{9}$。

**Bode 光标反查**（`frontend/app.ts` `tfBodeCursorFromEvent`）：鼠标横坐标 $x$ 先线性映射到对数频率轴
$$
\log_{10}\omega_{\text{target}}
=\log_{10}\omega_{\min}
+\frac{x-x_{\text{left}}}{W}\bigl(\log_{10}\omega_{\max}-\log_{10}\omega_{\min}\bigr),
$$
再取最近采样点
$$
i^\*=\arg\min_i\bigl|\log_{10}\omega_i-\log_{10}\omega_{\text{target}}\bigr|,
$$
即“吸附最近采样点”；拖动时把 $x$ 夹到绘图区内，方向键按 $i\pm1$（Shift 为 $\pm10$）移动。读数直接取该点的 $(\omega_i,|G(j\omega_i)|,\angle G(j\omega_i))$。

**阶跃指标**：终值 $y_\infty$；超调 $(y_{\max}-y_\infty)/y_\infty$；上升时间取 10%→90%；调节时间取进入并保持 $\pm2\%$ 带的时间；稳态误差用 $1-G(0)$（不用有限时长末值，避免把仿真截断误判成误差）。不稳定/临界系统只给稳定性结论，不给上升/调节/超调。

### 6.4 推进一步

$$
\mathbf{x}_{k+1}=\mathbf{A}_d\mathbf{x}_k+\mathbf{B}_d\mathbf{u}_k,\qquad
\mathbf{y}_k=\mathbf{C}_d\mathbf{x}_k+\mathbf{D}_d\mathbf{u}_k .
$$

`u_k` 由 `input_map` 从上游信号流节点读取，`y_k` 按 `output_map` 写回本节点输出字段；初始状态 `x0`（长度 $n$）。
附录另提供 `tustin_tf`（linalg.py:165）做 $H(s)\to H(z)$ 与 `power_iteration_norm`（linalg.py:215）。

---

## 7. Q4 二维有限元瞬态热传导

实现：`core/compute/fem.py`。

### 7.1 控制方程与弱形式

$$
\rho c\,\frac{\partial T}{\partial t}=\nabla\cdot(k\nabla T)+q(x,y,t)
\quad\text{在单位正方形 }\Omega=[0,1]^2 .
$$

乘以试探函数 $\phi$、分部积分（$\partial\Omega$ 上法向热流为零，上下绝缘）得弱形式

$$
\int_\Omega \rho c\,\frac{\partial T}{\partial t}\,\phi\,d\Omega
+\int_\Omega k\,\nabla T\cdot\nabla\phi\,d\Omega
=\int_\Omega q\,\phi\,d\Omega .
$$

### 7.2 单元矩阵（`_shape`，fem.py:77；`_element_matrices`，fem.py:162）

Q4 双线性形函数（参考单元 $\xi,\eta\in[-1,1]$，节点顺序：左下、右下、右上、左上）

$$
N_1=\tfrac14(1-\xi)(1-\eta),\ N_2=\tfrac14(1+\xi)(1-\eta),\ N_3=\tfrac14(1+\xi)(1+\eta),\ N_4=\tfrac14(1-\xi)(1+\eta).
$$

映射到物理单元（尺寸 $h_x,h_y$），雅可比行列式 $\det J=h_xh_y/4$，
$\dfrac{\partial N_i}{\partial x}=\dfrac{2}{h_x}\dfrac{\partial N_i}{\partial \xi}$，
$\dfrac{\partial N_i}{\partial y}=\dfrac{2}{h_y}\dfrac{\partial N_i}{\partial \eta}$。

2×2 Gauss 积分（`_GAUSS_POINTS`，fem.py:50-55，取 $\pm1/\sqrt3$）：

$$
\mathbf{K}_e=k\sum_{g=1}^{4}\det J\,\big(\nabla N^{\mathsf T}\nabla N\big)_g,\qquad
\mathbf{M}_e=\rho c\sum_{g=1}^{4}\det J\,\big(N^{\mathsf T}N\big)_g .
$$

对应代码 fem.py:170-171（`stiffness += conductivity*det_j*(outer(dndx,dndx)+outer(dndy,dndy))`、
`mass += capacity*det_j*outer(n,n)`）。`capacity` 即 $\rho c$。

### 7.3 装配（`_assemble`，fem.py:212）

按单元 16 个局部项累加到全局稀疏矩阵 $\mathbf{K},\mathbf{M}$（`coo_matrix`→`csr`）。

### 7.4 时间推进（后向欧拉，`step`，fem.py:313）

$$
\left(\frac{\mathbf{M}}{\Delta t}+\mathbf{K}\right)\mathbf{T}^{n+1}
=\frac{\mathbf{M}}{\Delta t}\mathbf{T}^{n}+\mathbf{F}^{n}
-\mathbf{K}_{:,\text{bc}}\,\mathbf{T}_{\text{bc}} .
$$

- 刚度/质量算子 $\dfrac{\mathbf{M}}{\Delta t}+\mathbf{K}$ 在 `_build_factorization()`（fem.py:234-252）中组
  装并按 $\Delta t$ 缓存；
- **Dirichlet 左/右边界**（$T=$ `boundary_left/right`）：消去边界行列、边界行置单位对角，
  右端扣除已知边界列贡献 $\mathbf{K}_{:,\text{bc}}\mathbf{T}_{\text{bc}}$，并把边界行的右端直接设为边界值
  （fem.py:237-252、step 中 fem.py:321-323）；
- 每步 `splu` 已预分解，仅回代（fem.py:245、325）。

热源 $\mathbf{F}^n$：高斯分布、中心随时间摆动，`_source_vector`（fem.py:293-306）
$$
q(x,y,t)=\mathrm{amplitude}\,\big(0.55+0.45\sin(2\pi f t)\big)\exp\!\Big(-\frac{(x-x_c)^2+(y-y_c)^2}{2\sigma^2}\Big),
$$
其中 $x_c,y_c$ 随时间摆动；用预计算的 `_source_operator`（fem.py:256-306）把 16 个 Gauss 点上的 $q$ 映射到节点。

`dt` 改变时重建分解（fem.py:315-317）。帧容量 `MAX_FEM_FRAMES=900`（fem.py:48）。

---

## 8. 非线性器件模型

实现：`core/compute/transistors.py`（BJT/MOS）；二极管在 nodal.py:568。

### 8.1 二极管（`Diode`，nodal.py:634）

$$
I=I_s\!\left(e^{\,v/(nV_t)}-1\right),\qquad
g=\frac{dI}{dv}=\frac{I_s}{nV_t}e^{\,v/(nV_t)},\quad g\ge 10^{-15}.
$$

指数项钳位：`exponent = min(60, v/(nV_t))`（`_conductance`，nodal.py:598-604）。限幅（`_limit`，nodal.py:620-635）：
先算临界电压 $v_{\text{crit}}=nV_t\ln\!\big(nV_t/(\sqrt2 I_s)\big)$，当 $v_{\text{new}}>v_{\text{crit}}$ 且
$|v_{\text{new}}-v_{\text{old}}|>2nV_t$ 时用对数压缩把电压拉回，抑制指数发散。齐纳、LED 由 `Zener`（nodal.py:829）、
`Diode` 公式变体给出（注册表 `ElementSpec`，nodal.py:906）。

### 8.2 BJT（`BipolarJunction`，transistors.py:24；`stamp`，transistors.py:62）

**行为级分段线性**（不是指数 Ebers-Moll，见 `_junction`，transistors.py:55-60）。设 $v_{be}$ 为
B-E 结电压（NPN 取正、PNP 乘 `polarity`）：

$$
I_b(v_{be})=\begin{cases}
v_{be}\cdot\text{leak}, & v_{be}\le v_{\text{be,on}}\\
\dfrac{v_{be}-v_{\text{be,on}}}{R_{\text{in}}}+v_{be}\cdot\text{leak}, & v_{be}>v_{\text{be,on}}
\end{cases}
\qquad g_{be}=\frac{dI_b}{dv_{be}} .
$$

其中 `leak=1e-9`，默认 $v_{\text{be,on}}=0.7$、$R_{\text{in}}=1000$。集电极电流

$$
I_c=\beta\,I_b,\qquad g_m=\beta\,g_{be}.
$$

盖章：B-E 结用 `_stamp_conductance(base,emitter,gbe)` + `_stamp_current`；集电极按 $g_m$ 盖
$A_{c,b}\mathrel{+}=g_m$、$A_{e,b}\mathrel{-}=g_m$、$A_{c,e}\mathrel{-}=g_m$、$A_{e,e}\mathrel{+}=g_m$（transistors.py:62-88）。
`polarity`：NPN $=+1$，PNP $=-1$（`PNP`，transistors.py:116 继承并翻转）。

### 8.3 MOSFET（`Mosfet`，transistors.py:122；`_operating_point`，transistors.py:159；`stamp`，transistors.py:209）

平方律 + 沟道长度调制 + 体效应。体效应阈值

$$
V_{th}(V_{bs})=V_{th0}+\gamma\big(\sqrt{\phi-V_{bs}}-\sqrt{\phi}\big),\quad V_{bs}\le 0,
$$

否则 $V_{th}=V_{th0}$（`_threshold`，transistors.py:146-157）。令过驱动 $V_{ov}=V_{gs}-V_{th}$、$V_{ds}$ 为漏源电压，
`clm` $=1+\lambda V_{ds}$：

$$
I_d=\begin{cases}
0, & V_{ov}\le0\ \text{或}\ V_{ds}\le0\\
k\big(V_{ov}V_{ds}-\tfrac12 V_{ds}^2\big)\,\text{clm}, & 0<V_{ds}<V_{ov}\ (\text{线性区})\\
\tfrac12 k\,V_{ov}^2\,\text{clm}, & V_{ds}\ge V_{ov}\ (\text{饱和区})
\end{cases}
$$

小信号（`_operating_point`，transistors.py:159-191）：

$$
g_m=\begin{cases}k V_{ds}\,\text{clm}, & \text{线性区}\\ k V_{ov}\,\text{clm}, & \text{饱和区}\end{cases}\qquad
g_{ds}=\begin{cases}k(V_{ov}-V_{ds})\text{clm}+k(V_{ov}V_{ds}-\tfrac12V_{ds}^2)\lambda, & \text{线性区}\\ \tfrac12 k V_{ov}^2\lambda, & \text{饱和区}\end{cases}
$$
$$
g_{mbs}=-g_m\,\frac{dV_{th}}{dV_{bs}} .
$$

盖章（transistors.py:208-241）：$A_{d,g}\mathrel{+}=g_m$、$A_{d,d}\mathrel{+}=g_{ds}$、$A_{d,s}\mathrel{-}=g_m+g_{ds}+g_{mbs}$、
$A_{d,b}\mathrel{+}=g_{mbs}$，其余三行对称；再 `_stamp_current` 补等效电流。
注意：即使源极接地（不在索引），$g_{ds}$ 也必须加到漏极对角线上（transistors.py:221-223），否则线性/饱和交界处 Newton 两点振荡。
`PMOS`（transistors.py:262）以 `polarity=-1` 继承。

### 8.4 运放（`OpAmp`，nodal.py:722）

$$
v(\text{OUT})-v(\text{ref})=\text{lo}+\text{span}\cdot\frac{1+\tanh(A\,u/\text{span})}{2},\qquad u=v_{p}-v_{n}.
$$

其中 $\text{ref}=V_-$（接线时）或地；$\text{lo},\text{span}$ 取供电轨（nodal.py:657-665 docstring）。支路盖章见 §2.4。

---

## 9. 数字逻辑与定时器

### 9.1 逻辑门（`LogicGate`，logic.py:26）

输入电平用 sigmoid 软化：$a=\sigma\!\big(\text{slope}(V_A-V_{th})\big)$，$\sigma$ 在 $\pm40$ 处截断（`_level`，logic.py:44；
`_sigmoid`，logic.py:18），默认 `slope=10`、`vth=2.5`、`ron=50`。逻辑函数（`_drive`，logic.py:47-58）：

$$
\text{AND}: a\cdot b,\quad \text{OR}: a+b-ab,\quad \text{NOT}: 1-a,\quad \text{XOR}: a+b-2ab .
$$

输出用**两条并联电导**驱动（`stamp`，logic.py:61-65）：

$$
g_{\text{up}}=\frac{\text{drive}}{R_{\text{on}}}\ (\,\text{输出}\leftrightarrow V_{DD}\,),\qquad
g_{\text{down}}=\frac{1-\text{drive}}{R_{\text{on}}}\ (\,\text{输出}\leftrightarrow \text{GND}\,).
$$

因此输出不是理想电压源，而是一个受控分压：`drive` 大则上拉、`drive` 小则下拉。

### 9.2 计数器（`Counter4`，digital.py:11）

`branch_width=4`，每路输出是一个独立电压源行（`stamp`，digital.py:35-49）：
$Q_i=\mathrm{vhigh}$ 若第 $i$ 位为 1，否则 `vlow`。CLK **上升沿**（旧值 <`vth` 且新值 ≥`vth`）时
`counter_value ← (counter_value+1) & 0xF`，RST 高有效清零（`update_guess`，digital.py:51）。

### 9.3 DAC / ADC / 移位寄存器（digital.py:78 / 190 / 127）

- **DAC4**（digital.py:76）：由输入位读码，`value = vref * code / 15.0`，以电压源输出（digital.py:91-106）。
- **ADC4**（digital.py:188）：逐次逼近（SAR）；状态 `sar_code/sar_trial/adc_code`，转换结束锁存，
  $Q_3..Q_0$ 以电压源输出（MSB=$Q_3$）（digital.py:217-230）。
- **ShiftRegister4**（digital.py:125）：上升沿 $D\to Q_0\to Q_1\to Q_2\to Q_3$（digital.py:126）。

### 9.4 555 定时器（`Astable555`，timers.py:11）

行为级方波，不建模 RC 充放电：

$$
\text{value}(t)=\begin{cases}\text{vhigh}, & \big(t\cdot f \bmod 1\big)<\text{duty}\\ \text{vlow}, & \text{否则}\end{cases}
$$

`prepare`（timers.py:31-34）按 $t$ 计算相位，`stamp`（timers.py:36-46）以电压源行输出。

### 9.5 LDO（`LDO`，timers.py:62）

$$
V_{\text{out}}=\min\!\big(V_{\text{target}},\ \max(0,\ V_{\text{in}}-\text{dropout})\big),
$$

以电压源行输出（`stamp`，timers.py:84-97）。

---

## 10. 磁性与耦合电感

实现：`core/compute/magnetics.py`。

### 10.1 变压器（`Transformer`，magnetics.py:39；`prepare` 68；`stamp` 81）

理想变压器约束（匝比 `ratio` $=n$）再加励磁电感 $L_m$ 的伴随支路：

$$
v_{\text{sec}}=n\,v_{\text{pri}},\qquad i_{\text{pri}}=-n\,i_{\text{sec}}+i_m,\qquad v_{\text{pri}}=L_m\frac{di_m}{dt}.
$$

$L_m$ 用与电感相同的伴随（见 §3.2）：BE 时 $g=L_m/\Delta t,\ \text{rhs}=-g\,i_{m,n-1}$；
trapezoidal 时 $g=2L_m/\Delta t,\ \text{rhs}=-g\,i_{m,n-1}-v_{\text{pri},n-1}$。`branch_width=3`（有 $L_m$）或 2（无）。
盖章（magnetics.py:81 起）：主边行 $A_{\text{pri},c}\mathrel{+}=1,A_{\text{pri},d}\mathrel{-}=1,A_{\text{pri},a}\mathrel{-}=n,A_{\text{pri},b}\mathrel{+}=n$；
副边行 $A_{\text{sec},\text{pri}}\mathrel{+}=1,A_{\text{sec},\text{sec}}\mathrel{+}=n$；励磁行
$A_{\text{sec},\text{mag}}\mathrel{-}=1,\ A_{\text{mag},a}\mathrel{+}=1,A_{\text{mag},b}\mathrel{-}=1,A_{\text{mag},\text{mag}}\mathrel{-}=g$，
右端 `mag_rhs`。文档提醒：副边必须有直流路径，否则 MNA 奇异。

### 10.2 耦合电感（`CoupledInductor`，magnetics.py:138；`prepare` 169；`stamp` 196）

互感 $M=k\sqrt{L_1L_2}$，$k$ 被钳制在 $[0.001,0.999]$（magnetics.py:152，避免 $L_1L_2-M^2=0$ 使逆电感阵奇异）。电感阵与逆：

$$
\mathbf{L}=\begin{bmatrix}L_1&M\\ M&L_2\end{bmatrix},\quad
\det=L_1L_2-M^2,\quad
\mathbf{L}^{-1}=\frac{1}{\det}\begin{bmatrix}L_2&-M\\ -M&L_1\end{bmatrix}.
$$

伴随矩阵（`prepare`，magnetics.py:169-188）：BE 时 $\mathbf{G}=\Delta t\,\mathbf{L}^{-1}$，`rhs` $=\mathbf{i}_{n-1}$；
trapezoidal 时 $\mathbf{G}=\tfrac{\Delta t}{2}\mathbf{L}^{-1}$，`rhs` $=\mathbf{i}_{n-1}+\mathbf{G}\,\mathbf{v}_{n-1}$。
即

$$
\mathbf{i}_n=\mathbf{G}\,\mathbf{v}_n+\text{rhs}.
$$

盖章（magnetics.py:190 起）对两个支路各行写
$A_{r,r}\mathrel{+}=1,\ A_{r,a}\mathrel{-}=g_{r1},\ A_{r,b}\mathrel{+}=g_{r1},\ A_{r,c}\mathrel{-}=g_{r2},\ A_{r,d}\mathrel{+}=g_{r2}$，右端 `rhs`。

---

## 12. 并网逆变器控制链（R31）

### 12.1 幅值不变 Park 变换

三相量 $x_a,x_b,x_c$ 与 dq 量 $x_d,x_q$（$\theta$ 为电网相位）：

$$
x_d=\frac{2}{3}\left(x_a\cos\theta+x_b\cos(\theta-\frac{2\pi}{3})+x_c\cos(\theta+\frac{2\pi}{3})\right)
$$

$$
x_q=\frac{2}{3}\left(x_a\sin\theta+x_b\sin(\theta-\frac{2\pi}{3})+x_c\sin(\theta+\frac{2\pi}{3})\right)
$$

反变换为 $x_a=x_d\cos\theta-x_q\sin\theta$，其余两相相位依次加减 $2\pi/3$。实现见 `core/compute/computes.py` 的 `_abc_dq_factory`。

### 12.2 SRF-PLL

用 dq 的 q 轴误差驱动 PI：

$$
e=\frac{-q}{\max(|d|,10^{-6})},\quad
f=f_0+k_p e+k_i\int e\,dt
$$

频率限幅 $[f_{\min},f_{\max}]$，相位 $\theta_{k+1}=\mathrm{wrap}(\theta_k+2\pi f\,dt)$；每拍**先推进相位、再计算 Park**，保证输出 $\theta$ 与同一拍输入对齐。锁定条件为 $|e|<\mathrm{lock\_threshold}$。

### 12.3 dq 下 LCL 平均模型

状态 $x=[i_{1d},i_{1q},v_{cd},v_{cq},i_{2d},i_{2q}]^T$，输入 $u=[v_{id},v_{iq},v_{gd},v_{gq}]^T$。忽略电阻压降的微分方程为：

$$
\begin{aligned}
L_1\dot i_{1d}&=v_{id}-R_1i_{1d}-v_{cd}+\omega L_1i_{1q},&
L_1\dot i_{1q}&=v_{iq}-R_1i_{1q}-v_{cq}-\omega L_1i_{1d},\\
C_f\dot v_{cd}&=i_{1d}-i_{2d}+\omega C_fv_{cq},&
C_f\dot v_{cq}&=i_{1q}-i_{2q}-\omega C_fv_{cd},\\
L_2\dot i_{2d}&=v_{cd}-R_2i_{2d}-v_{gd}+\omega L_2i_{2q},&
L_2\dot i_{2q}&=v_{cq}-R_2i_{2q}-v_{gq}-\omega L_2i_{2d}.
\end{aligned}
$$

工程里用 `state_space` 节点把上述方程离散为 $x_{k+1}=A_dx_k+B_du_k$；`grid_inverter_avg.netlab` 的参数为 $L_1=2$ mH、$R_1=1\,\Omega$、$C_f=50\,\mu$F、$L_2=1$ mH、$R_2=3\,\Omega$、$\omega=2\pi50$。

### 12.4 dq 电流环 PI + 前馈解耦

误差 $e_d=i_d^{\ast}-i_d$、$e_q=i_q^{\ast}-i_q$，PI 输出 $u_d=k_pe_d+k_i\int e_d$、$u_q=k_pe_q+k_i\int e_q$；电压指令为

$$
v_d^{\ast}=u_d+v_{cd}-\omega L i_q,\qquad
v_q^{\ast}=u_q+v_{cq}+\omega L i_d.
$$

`pi` 节点在输出限幅时回退积分（抗饱和），`test_current_loop.py` 验证 10%→90% 上升时间 <5 ms、终值误差 <1e-3。

### 12.5 跨域桥的离散顺序

`CircuitEngine.step(dt)` 的顺序是：`_apply_bridge_actuators()`（读取上一拍 `state["drive"]`，计算 `v_out=gain*signal+offset`）→ MNA 求解 → `_sample_bridge_sensors()`（把节点电压写入 sensor 的 `signal`/`voltage`）。因此传感器到执行器显式延迟一拍，避免代数环。

## 13. 复数频响（R39）

### 13.1 信号流复数节点方程

对 signal 场景在角频率 $\omega$ 处把每条连接写成复数权重 $W_{ij}(j\omega)$：`pass` 为 1，`scale` 为增益，`delay` 为精确 $e^{-j\omega dt}$，`sum` 用边权，节点 `gain/lag/integrate/transfer_function/state_space` 写成 $g(j\omega)$。节点方程

$$
\left(I-W(j\omega)\right)y=b
$$

其中输入节点 $b_i=1$，其余为 0；解出 $y$ 后取输出节点分量即复数频响。实现见 `core/compute/analysis.py:_signal_frequency_response`。

### 13.2 电路复数 MNA

`nodal.ac_sweep` 先求 DC 工作点，再在每个频点用复数 MNA：

$$
A(j\omega)x=b(j\omega),
$$

电容导纳 $j\omega C$、电感阻抗 $j\omega L$、独立源相量按输入源设置。对每个 probe 输出

$$
|H|=\sqrt{\Re(H)^2+\Im(H)^2},\qquad
\angle H=\mathrm{atan2}(\Im H,\Re H),\qquad
H_{dB}=20\log_{10}|H|.
$$

R39 的 `analysis.frequency_response()` 对 signal 走 13.1，对 circuit 转调 `ac_sweep` 的 13.2；两者结果字段一致（`real/imag/magnitude/phase_deg/db`），主 seam 在公共分析函数，不在求解器内部。

### 13.3 精度与边界

- 延迟使用精确 `exp(-jωdt)`，不是 Padé 近似；s 域符号传函的延迟仍用 Padé（R37），两者用途不同。
- 复数只在分析边界 `complex128`；时域节点、recorder、PlotKit、工程 JSON 保持实数。
- `as_real` 的虚部容差为 `1e-12*max(1,|real|)`；超差说明调用方把频域结果误当实数使用。
- 频率轴点数限制 2–2001；`f_start>0`、`f_stop>f_start`；非法输入返回 422。

## 14. 数值限制

### 14.1 规模/步数上限（`core/common/limits.py`）

| 常量 | 值 | 含义 |
| --- | --- | --- |
| `MAX_NODES` | 400 | 单网络最大节点数 |
| `MAX_EDGES` | 1200 | 单网络最大连接数 |
| `MAX_FIELDS` | 64 | 对象最大字段数 |
| `MAX_STRING` | 400 | 字符串最大长度 |
| `MAX_DEPTH` | 8 | 嵌套最大深度 |
| `MAX_ARRAY` | 256 | 数组最大长度 |
| `MAX_MATRIX` | 12 | 矩阵最大维 |
| `MAX_NUMBER` | $1.0\times10^{15}$ | 数值绝对值上限 |
| `MAX_NAME` | 32 | 名称最大长度 |
| `MAX_PRECOMPUTE_STEPS` | 200000 | 单次预计算最大步数 |

错误类型（limits.py）：`NetlabError(400)`、`ValidationError(422)`、`NotFoundError(404)`、
`ConflictError(409)`、`LimitError(413)`、`ComputeError(422)`。

### 14.2 预计算 20 万步硬拒绝

`Simulation.precompute()`（`core/compute/simulation.py:314`，步数校验在 `332-335`）在**任何** `scene.reset()` / `recorder.clear()`
之前完成校验；若

$$
\text{needed steps}>\mathrm{MAX\_PRECOMPUTE\_STEPS}=200000
$$

直接抛 `ValidationError`（"预计算步数超过 200000；请增大 dt、缩短 duration，或分段预计算"），
**不再 `min(200000, …)` 静默截断时间轴**。原因：静默截断会悄无声息地砍掉时间轴尾部、
误导用户；硬拒绝则保证"要么完整算，要么明确报错"，且拒绝时不破坏已有录制。

### 14.3 参数校验（`core/compute/params.py`）

`ParamSpec`（params.py:31）统一描述参数字段，`coerce()`（params.py:49）按类型限制：
`float` 走 `as_float(lo,hi,positive)`，`int` 走 `as_int(lo,hi)`；矩阵参数尺寸上限为 `MAX_MATRIX=12`
（`ParamSpec.max_size`，params.py:43）。所有数值最终落入 limits.py 的硬边界（`MAX_NUMBER` 等），
从而"前端界面、后端入库、求解器"共用同一套限制规则，避免前后端规则漂移。

---

## 附录：关键实现位置索引

| 功能 | 位置 |
| --- | --- |
| 连接求值 | `graph.py:330 Connection.evaluate` |
| 代数环 SCC | `graph.py:484 Network.algebraic_cycles` |
| 拓扑排序 (Kahn) | `graph.py:659 Network.topological_order` |
| 事务步 | `graph.py:699 Network.step`；快照 `graph.py:1058/1080` |
| 电导/电流盖章 | `nodal.py:125 _stamp_conductance`、`nodal.py:137 _stamp_current` |
| 电容伴随 | `nodal.py:266 Capacitor.prepare`、`nodal.py:292 stamp` |
| 电感伴随 | `nodal.py:366 Inductor.prepare`、`nodal.py:389 stamp` |
| 电压源/VCVS/VCCS | `nodal.py:432`、`nodal.py:560`、`nodal.py:602` |
| 运放 | `nodal.py:722 OpAmp`、`nodal.py:813 stamp` |
| 索引/未知量 | `nodal.py:1644 _build_index` |
| 空矩阵 | `nodal.py:1728 _blank_matrix` |
| Newton | `nodal.py:1860 _newton_with_strategies`、`nodal.py:1984 _newton_solve` |
| 后向误差 | `nodal.py:1968 _residual_metric`、`nodal.py:1911 _tolerance` |
| 稀疏/均衡求解 | `nodal.py:2080 _solve_matrix` |
| 工作点 | `nodal.py:2269 operating_point` |
| AC 扫描 | `nodal.py:2335 ac_sweep` |
| 状态空间离散化 | `linalg.py:129 cont2discrete`、`statespace.py:132 discretized` |
| FEM 形函数/单元阵 | `fem.py:77 _shape`、`fem.py:162 _element_matrices` |
| FEM 装配/推进 | `fem.py:212 _assemble`、`fem.py:236 _build_factorization`、`fem.py:313 step` |
| BJT | `transistors.py:24 BipolarJunction`、`transistors.py:55 _junction` |
| MOSFET | `transistors.py:122 Mosfet`、`transistors.py:159 _operating_point` |
| 逻辑门 | `logic.py:26 LogicGate`、`logic.py:61 stamp` |
| 计数器/DAC/ADC/移位 | `digital.py:11/78/190/127` |
| 555/LDO | `timers.py:11 Astable555`、`timers.py:62 LDO` |
| 变压器/耦合电感 | `magnetics.py:39/138` |
| 规模上限 | `limits.py`（常量见 §14.1） |
| 预计算硬拒绝 | `simulation.py:396-411` |
| 参数校验 | `params.py:31 ParamSpec`、`params.py:49 coerce` |
