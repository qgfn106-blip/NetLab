# 面向多物理场仿真的统一图模型与混合计算引擎 —— 数学规范

> **文档定位（Q1 = 双轨）**：本文件是**数学规范主文**，只做严谨定义、算法与可验收判据；可执行参考实现与证明细节放在零耦合的 `NetlabHome/mathspec/`（纯 `numpy`/`scipy` + `pytest`，**不 import netlab**）。本规范**不直接改动 netlab 代码**；`PERFORMANCE_AND_CONCURRENCY.md` 只保留一行指针指向本文件。
>
> **原则（Q3 = 分层）**：主文给定义/算法/关键定理陈述与证明要点；`mathspec/` 给可运行代码与数值验证。每个算子**先在 `mathspec/` 过测试，再考虑进 netlab**。
>
> **基线**：netlab `APP_BUILD 3.20.1`，2026-11-06。配套研究脉络见 `PERFORMANCE_AND_CONCURRENCY.md` §0–§33。
>
> **恢复记录**：§0–§16 于 2026-11-06 21:45 从本会话日志的原始 write/edit 调用逐段恢复（恢复前备份 `NetlabExtras/scratch/UNIFIED_SIM_MATH_SPEC.before_restore.md`），§17 保持原样。

---

## 0. 范围与本规范要回答的三个问题

一个仿真内核 = 三件事，本规范逐层形式化：

1. **数学表达**：物理系统如何写成**图**、再由**图**生成**方程**（统一图模型 UGM + 编译语义，§2–§3）。
2. **计算执行**：方程如何在**混合（连续 + 离散事件）**语义下被**调度与推进**（§4）。
3. **数值求解**：线性/非线性/时间积分/降阶如何**稳定、可验证**地算出来（§5–§6）。

**纵切案例（Q2 = a）**：以 **DC 电机驱动机械负载**（电气 + 机械 + 控制）作为贯穿全篇的试验台，端到端打通「图 → 方程 → 求解 → 离散事件 → 观测」，并给出可验收的解析解与性质测试（§8、§10）。

---

## 1. 符号与约定

| 符号 | 含义 |
|---|---|
| $\mathcal{G}=(\mathcal{V},\mathcal{E})$ | 有向超图（节点集 $\mathcal V$、边集 $\mathcal E$） |
| $x\in\mathbb R^{n}$ | 连续状态向量 |
| $u\in\mathbb R^{m}$ | 输入（源）向量 |
| $y\in\mathbb R^{p}$ | 观测量 |
| $z\in\mathbb R^{n_z}$ | 代数变量（约束变量） |
| $t\in\mathbb R$ | 连续时间；$\Delta t$ 步长 |
| $q\in Q$ | 离散模式（有限集） |
| $f:\mathbb R^{n}\times\mathbb R^{n_z}\times\mathbb R^{m}\to\mathbb R^{n}$ | 微分右端 |
| $g:\mathbb R^{n}\times\mathbb R^{n_z}\times\mathbb R^{m}\to\mathbb R^{n_z}$ | 代数约束 |
| $\mathcal N(\mu,\Sigma)$ | 正态分布（噪声建模用） |

**时间基（超密集时间，FMI 3.0 语义）**：时间用二元组 $(t_R,t_I)$，$t_R$ 为"事件轮次索引"，同一物理时刻可有多轮事件。连续段内 $t_R$ 固定、$t_I$ 推进；事件发生则 $t_R$ 递增。

**残差尺度**：绝对容差 $\varepsilon_{abs}$ 与相对容差 $\varepsilon_{rel}$ 分离；节点电压类用 $\varepsilon_{abs}\approx10^{-6}$，流量类按量级缩放。

---

## 2. 统一图模型（UGM）

### 2.1 类型系统

定义**类型域** $\mathbb T = \mathbb T_{\text{val}} \times \mathbb T_{\text{port}}$：

- 值类型 $\tau_v\in\mathbb T_{\text{val}}$：`real`、`complex`、`float32/float64`、`vector<float>`、`matrix<float>`、`bool`、`int`、`event`。
- **端口类型** $\tau_p$：每条端口声明一对 **(potential, flow)** 物理量纲，例如电气 $(\text{V},\text{A})$、机械平移 $(\text{v},F)$、机械旋转 $(\omega,\tau)$、热 $(\text{T},\dot Q)$。

端口类型满足**能量配对公理**：同一连接器上 potential 与 flow 的乘积具功率量纲 $[\text{W}]$，且 $\text{potential}\times\text{flow}$ 在连接处守恒（Tellegen 定理的图论形式）。

### 2.2 节点（NodeRecord 的形式化）

节点 $v\in\mathcal V$ 是七元组（对应 `scene.py:68-102`，并**新增 `ext` 字段**，见 §9.4）：

$$
v = \big(\ \mathrm{id},\ \kappa,\ \theta,\ \pi,\ \sigma,\ \mathrm{pos},\ \mathrm{ext}\ \big)
$$

- $\mathrm{id}$：全局唯一标识；
- $\kappa$：**kind**（行为类型，决定 $f_v$）；
- $\theta$：参数（immutable per revision，$\theta\in\Theta_\kappa$）；
- $\pi$：端口列表，$\pi_j=(\text{dir},\tau_p,\text{pin})$，$\text{dir}\in\{\text{in},\text{out},\text{across}\}$；
- $\sigma$：局部状态（仅当 $\kappa$ 带记忆时存在）；
- $\mathrm{pos}$：布局坐标（**不参与仿真语义**，仅可视化）；
- $\mathrm{ext}:\ \text{PluginId}\rightharpoonup \text{Value}$：**插件私有命名空间**（§9.4）。

**kind 语义** $\llbracket\kappa\rrbracket$ 分三类：
- **瞬时（组合）**：$y_v=\phi_\kappa(\text{inputs};\theta)$，无状态。例：`gain`、`sum`、`clip`、`expression`。
- **动态（记忆）**：$(\dot\sigma_v)=\psi_\kappa(\sigma_v,\text{inputs};\theta)$。例：`integrate`、`lag`、`transfer_function`、`state_space`。
- **守恒件（器件）**：向系统贡献 $g$ 的代数约束（stamp）。例：`resistor`、`diode`、`switch`。

### 2.3 边（EdgeRecord 的形式化）

边 $e\in\mathcal E$ 是**带方向与延迟**的连接：

$$
e = \big(\ \mathrm{id},\ s,\ tgt,\ \kappa_e,\ \theta_e,\ d_e,\ \mathrm{route},\ \mathrm{wp},\ \mathrm{anchors}\ \big)
$$

- $s,tgt$：源/目标节点（或端口）；
- $\kappa_e$：边类型（`signal`、`wire`、`flow`…）；
- $d_e\ge 0$：**单位延迟**（整数拍，$z^{-d_e}$），$d_e=0$ 为代数直连，$d_e\ge1$ **打断代数环**（对应 netlab `EdgeRecord.delay` 单位延迟语义）；
- $\mathrm{route},\mathrm{wp},\mathrm{anchors}$：几何路由，**不影响语义**。

### 2.4 连接器代数（acausal，flow/potential）

这是把 netlab 从"信号流（因果）"升级到"多物理场（非因果）"的关键。

**连接（connect）公理**：对同一 super-node（由并查集合并的端口簇，对应 netlab `scene.py:527-553` 的并查集）$\mathcal C$：

$$
\underbrace{\text{potential}_i=\text{potential}_j\quad\forall i,j\in\mathcal C}_{\text{等势（KVL 型）}},\qquad
\underbrace{\sum_{i\in\mathcal C}\text{flow}_i=0}_{\text{守恒（KCL 型）}}.
$$

不同物理域复用**同一公理**，只是量纲不同：

| 域 | potential | flow | 守恒律 |
|---|---|---|---|
| 电气 | 电压 $V$ | 电流 $I$ | KCL $\sum I=0$ |
| 机械平移 | 速度 $v$ | 力 $F$ | $\sum F=0$ |
| 机械旋转 | 角速度 $\omega$ | 力矩 $\tau$ | $\sum\tau=0$ |
| 热 | 温度 $T$ | 热流 $\dot Q$ | $\sum\dot Q=0$ |

> **可借鉴算法**：Modelica 的 `connect` 语义（§23.2）；netlab 现有并查集只做电气节点合并，需泛化为"按 $\tau_p$ 分域的势/流配对"。

### 2.5 模块与层级（flatten）

复合节点 $v_{\text{block}}$ 内部是子图 $\mathcal G_v$，其端口映射到子图边界。**展平** $\mathrm{flatten}:\mathcal G\to\mathcal G^\ast$ 递归把复合节点替换为子图、把端口连接展开为子图边界上的 `connect` 方程（对应 netlab `flatten_circuit`、`block_runtimes`）。展平后得到**扁平超图** $\mathcal G^\ast$，后续编译都在 $\mathcal G^\ast$ 上进行。

### 2.6 扩展命名空间（Q7 硬约束）

$\mathrm{ext}:\text{PluginId}\rightharpoonup\text{Value}$，**只增不改**；核心字段（§2.2）绝不被插件写。详见 §9。

---

## 3. 语义：从图到方程（编译期）

### 3.1 三个语义域

给定扁平图 $\mathcal G^\ast$，按 `MODES` 归入语义域，映射到统一 DAE 形式：

$$
\boxed{\ F(\dot x,x,z,u,t)=0\ },\qquad y=h(x,z,u,t).
$$

- **signal（信号流）**：$F$ 退化为显式 $\dot\sigma=\psi$、$y=\phi$，无 $z$（纯因果）。
- **circuit（守恒）**：$F$ 为 MNA 方程（modified nodal analysis）：
  $$\underbrace{C(x)\dot x+G(x)x+Bu}_{}=0,\quad x=(V_{\text{node}},I_{\text{branch}}).$$
  元件残差按 stamp 累加（见 §3.2）。
- **vector（场）**：$F$ 为空间离散后的半离散 ODE：$M\dot x+Kx=b(t)$（热传导、弹性），$M,K$ 由弱形式 + Gauss 积分装配。

**三域统一**：都写成**同一 DAE**，于是后面的 index reduction / BLT / Newton / 时间积分**只写一次**，对三域通用——这正是"统一引擎"的数学基础。

### 3.2 方程生成（stamp）规则

每个节点/器件向全局残差 $F$ 累加其贡献。**关键不变量**：stamp 必须**只依赖局部端口量与参数**（局部性），且对**解析导数**可微（为 Newton 提供 $J$）。

- **线性电阻**：$I=(V_a-V_b)/R$，stamp 到 KCL 行。
- **非线性器件（二极管）**：$I=I_s(\exp(V/(nV_T))-1)$，用**平滑化** $\exp$（netlab `nodal.py:615` 已是平滑指数电导），导数 $\partial I/\partial V$ 解析给出。
- **动态件**：`integrate` → $C\dot V=I$；`transfer_function` → 状态空间实现后按 $A,B,C,D$ stamp。

> **可借鉴**：ngspice `pnjlim` 结电压限幅（防溢出）、gmin/source stepping（§24 已有）；KLU 稀疏 LU（§24）。

### 3.3 DAE 结构分析：索引约简

**定义（微分指标）**：对 $F(\dot x,x,z,u,t)=0$，若需对约束 $g$ 微分 $k$ 次才能解出所有 $\dot x$，则指标为 $k$。电路因果环会导致 index≥2。

**Pantelides 算法**（结构化）：
1. 构造二部图（方程 ↔ 变量），匹配（maximum matching）；
2. 若存在"欠定"分量（某方程无匹配变量），对该方程求导、引入新变量，重复；
3. 输出需微分的方程集合 → 降指标 DAE。

**哑导数（dummy derivatives）**：Pantelides 给出"应微分哪些方程"，哑导数为新引入的 $\dot x$ 变量**选择**一致初值，使降指标系统**不漂移**（约束保持）。

> **定理（Pantelides 正确性，陈述）**：若原系统指标有限，则 Pantelides 在有限步终止并给出**指标 1 的等价系统**；哑导数选择保证解与原系统一致。证明要点：匹配的增广路径对应最小微分集，Matthias 等人 2012（arXiv:1206.6177）给出形式化。

### 3.4 BLT 变换与撕裂

1. **依赖图**：节点=方程，边=$e_i\to e_j$ 若 $e_j$ 依赖 $e_i$ 解出的变量。
2. **Tarjan SCC**：求强连通分量 → 收缩为 DAG → **块下三角（BLT）**排序。SCC 大小 $>1$ ⇔ 代数环 ⇔ 需联立求解。
3. **撕裂（tearing）**：对每个非线性 SCC 块，选**撕裂变量集** $\mathcal T$（最小反馈顶点集近似），把块分解为"小稠密解 + 不动点迭代"，降维。撕裂变量选择可用启发式（最小度/最大影响）。

> **复杂度**：SCC $O(|V|+|E|)$；撕裂变量选择是 NP-难的（最小反馈顶点集），用贪心近似 $O(|E|\log|V|)$。

### 3.5 因果化与求解计划

按 BLT 块序列**顺序求解**：块内若是线性则 LU 一次分解多右端回代（对应 netlab `_lu_cache`）；若是非线性则 Newton + 撕裂。**求解计划** $\Pi=(B_1,\dots,B_K)$ 是**拓扑序**，可缓存并在 `revision` 不变时复用（对应 netlab `solver_plan`(graph.py:533) 与增量计算 §20–§21）。

---

## 4. 混合系统语义（连续 + 离散事件）

### 4.1 混合自动机（Hybrid Automaton）

$$
\mathcal H=(Q,\ X,\ f,\ \mathrm{Init},\ \mathrm{Inv},\ E,\ G,\ R)
$$

- $Q$：离散模式；$X\subseteq\mathbb R^n$：连续状态；
- $f:Q\times X\to\mathbb R^n$：各模式流场 $\dot x=f(q,x)$；
- $\mathrm{Init}\subseteq Q\times X$：初值；$\mathrm{Inv}:Q\to 2^X$：不变式；
- $E\subseteq Q\times Q$：离散迁移；$G:E\to 2^X$：守卫（guard）；$R:E\times X\to X$：重置映射。

**运行语义**：在模式 $q$ 内按 $\dot x=f(q,x)$ 演化，直到命中守卫 $G$（零穿越），触发 $e\in E$ 并 $x^+=R(e,x^-)$，进入新模式。

### 4.2 零穿越事件检测与定位

**事件函数**：对每个守卫定义标量 $z(t)=\phi(x(t))$，事件在 $z(t)=0$ 处发生。

- **检测**：每步检查 $z(t_k)\,z(t_{k+1})<0$（符号变化）→ 区间内必有根（介值定理）。
- **定位**：在 $[t_k,t_{k+1}]$ 上用**Illinois（改进 regula falsi）**或**Brent** 求根到容差 $\varepsilon_t$，得到事件时刻 $t^\ast$ 与状态 $x(t^\ast)$。
- **处理**：在 $t^\ast$ 处暂停、应用重置 $R$、更新 $q$，再继续（超密集时间 $t_R$ 递增）。

> **定理（事件定位收敛）**：若 $z\in C^1$ 且 $z'$ 在根附近非零，则 Illinois 法线性收敛到 $t^\ast$；Brent 法超线性。工程上取 $\varepsilon_t=10^{-9}$，配合"每步最多处理 1 个事件 + 事件后重算导数"避免 chattering。netlab 现状：`simulation.py:227` 固定步推进、`analysis.py:_crossing` 仅离线找过零——**需补在线事件定位**。

### 4.3 状态重置与超密集时间

重置 $R$ 可**不连续跳变**状态（如开关切换、二极管导通/截止、碰撞）。用超密集时间 $(t_R,t_I)$ 表示"同一时刻多轮事件"，保证因果顺序。

### 4.4 MLD（混合逻辑动态）形式化

当离散决策可写成**逻辑约束**时，混合系统等价为 MLD：

$$
x_{k+1}=A x_k+B_1 u_k+B_2\delta_k+B_3 z_k,\quad
y_k=C x_k+D_1u_k+D_2\delta_k+D_3z_k,\quad
E_2\delta_k+E_3z_k\le E_1u_k+E_4x_k+E_5,
$$

其中 $\delta_k\in\{0,1\}$ 为逻辑变量、$z_k$ 为辅助连续变量。MLD 把"开关/模式"编码进**混合整数线性约束**，可用 MPC 求解（三水箱 benchmark，CMC 2023）。

---

## 5. 数值求解层

### 5.1 线性求解

- **稠密**：$Ax=b$，$A\in\mathbb C^{n\times n}$，用 LU（LAPACK `getrf/getrs`），复杂度 $O(n^3)$，**分解缓存**（矩阵不变时复用，对应 netlab `_lu_cache`）。
- **稀疏**：$Ax=b$，$A$ 稀疏，用 **KLU**（电路专用，BTF + AMD/COLAMD 排序 + Gilbert–Peierls）或 SuperLU `splu`；分解 $O(\text{nnz}\cdot\text{fill})$。
- **Krylov**：大规模用 GMRES/BiCGStab + 预条件（ILU/AMG）。
- **实测锚点**（`bench_solve.py`）：稠密复数 $n=800$ ≈ 18.7 ms；稀疏 `splu` $n=1000$ factor 110 ms、$n=4000$ factor 10.2 s——**支撑"小系统稠密、大系统稀疏 + 重排降 fill-in"的选型**。

### 5.2 非线性 Newton

求 $F(x)=0$。**阻尼 Newton**：

$$
J(x_k)\,\Delta x_k=-F(x_k),\qquad x_{k+1}=x_k+\alpha_k\Delta x_k,\ \alpha_k\in(0,1].
$$

- **收敛判据（双判据）**：$\|\Delta x_k\|_\infty\le\varepsilon_{rel}\|x_k\|_\infty+\varepsilon_{abs}$ **且** $\|F(x_k)\|_\infty\le\varepsilon_{F}$（对应 netlab `_newton_solve` 双判据）。
- **全局化**：线搜索（Armijo）或信赖域，保证从坏初值也下降。
- **策略**：gmin stepping、source stepping（netlab `_newton_with_strategies`）。
- **定理（局部二次收敛）**：若 $F\in C^2$、$J(x^\ast)$ 非奇异，则 $\alpha_k\equiv1$ 时 $\|x_{k+1}-x^\ast\|=O(\|x_k-x^\ast\|^2)$。

### 5.3 时间积分

- **后向欧拉**（L-稳定，1 阶）：$x_{k+1}=x_k+\Delta t\,f(x_{k+1})$，每步解非线性方程（用 §5.2）。
- **BDF-k**（变阶变步长，SUNDIALS CVODE 风格）：高阶、适合刚性；用 LTE 估计步长。
- **自适应**：局部截断误差 $\mathrm{LTE}\le\varepsilon$ 控制 $\Delta t$；事件处强制缩步。
- **稳定性**：刚性系统须用 L-稳定（后向欧拉/BDF），显式 RK 步长受限 $\Delta t\lesssim 2/\lambda_{\max}$。

### 5.4 并行与分布式（概要）

- **域分解**：Schwarz/FETI，把大 FE 模型分块并行。
- **时间并行**：Parareal（arXiv:1909.08895），粗/细 propagator 迭代。
- **任务并行**：见 `PERFORMANCE_AND_CONCURRENCY.md` §27（Dask 式调度、粒度铁律）。

---

## 6. 模型降阶（MOR）

目标：把 $n$ 维系统降为 $r\ll n$ 维，保稳定、有误差界。

### 6.1 数据驱动：POD / DMD / Koopman

- **POD**：采快照矩阵 $X=[x_1,\dots,x_N]$，SVD $X=U\Sigma V^\top$，取前 $r$ 列 $U_r$ 为基，投影得降阶模型。
- **DMD**：拟合 $x_{k+1}\approx A x_k$，$A=XY^{+}$，特征分解得模态/频率/增长。
- **Koopman**：把非线性系统提升到可观测量空间的线性算子。

### 6.2 平衡截断（Balanced Truncation）

对稳定 LTI $(A,B,C)$，解 Lyapunov 方程：

$$
AP+PA^\top+BB^\top=0,\quad A^\top Q+QA+C^\top C=0,
$$

平衡变换后按 Hankel 奇异值 $\sigma_i$ 截断，**H∞ 误差界**：

$$
\boxed{\ \|G-G_r\|_{H_\infty}\le 2\sum_{i=r+1}^{n}\sigma_i\ }.
$$

### 6.3 Krylov 矩匹配

在频点处匹配传递函数矩（Arnoldi/Lanczos），适合大规模稀疏、无需解 Lyapunov。

### 6.4 双运行模式与误差估计（对应 netlab `analysis_mode`）

- `full`：完整模型高精度；
- `reduced`：降阶模型快速；
- **必须显示误差估计** $\hat\epsilon$（BT 用 $2\sum\sigma_i$；POD 用残差投影），超出阈值自动回退 `full`。

---

## 7. 观测与数据层

### 7.1 环形缓冲 + 增量

录制器为**环形缓冲**（容量 $C$），写指针递增、按 $(\text{time},\text{probe})$ 追加；HTTP 只读增量 $[\text{cursor},\text{cursor}+L]$。复杂度 $O(1)$ 均摊。

### 7.2 压缩

- **块压缩**：Blosc2/ZFP（有界有损）；
- **时序差分**：Gorilla（delta-of-delta + XOR 浮点）；
- **传输**：Arrow 二进制零拷贝。

### 7.3 溯源（四层）

- **L0** 内容哈希 + 依赖失效传播（改参数谁失效）；
- **L1** 事件日志 + 周期快照（Event Sourcing，schema upcaster + log pruning）；
- **L2** PROV 结果溯源；
- **L3** 内容寻址存储。

---

## 8. 可验收定义（Q4：解析解 + 性质测试）

**验收哲学**：算子"正确"= 通过下列**解析解对照**与**不变量检验**，不靠肉眼。

### 8.1 解析解基准

| # | 系统 | 解析解 | 用途 |
|---|---|---|---|
| A1 | RC 充电 | $V(t)=V_s(1-e^{-t/RC})$ | 一阶瞬态、后向欧拉收敛 |
| A2 | RLC 欠阻尼 | $V(t)=V_s e^{-\zeta\omega_n t}\cos(\omega_d t+\phi)$ | 二阶振荡、阻尼 |
| A3 | 1D 热传导 | $T(x,t)=\sum b_n\sin(\tfrac{n\pi x}{L})e^{-\alpha(n\pi/L)^2 t}$ | 抛物型、弱形式装配 |
| A4 | 弹簧-质量（无阻尼） | $x(t)=x_0\cos(\omega t)+\tfrac{v_0}{\omega}\sin(\omega t)$ | 辛/能量守恒 |
| A5 | DC 电机空载稳态 | $\omega_{ss}=\dfrac{V}{K_e}$（空载、无摩擦） | 机电耦合 |
| A6 | DC 电机带载稳态 | $\omega_{ss}=\dfrac{K_t V-R\,\tau_L}{K_t K_e+R b}$ | 机电 + 负载 |

### 8.2 性质测试（不变量）

| # | 性质 | 判据 |
|---|---|---|
| P1 | KCL/KVL 残差 | 每步 $\|A x-b\|_\infty\le10^{-9}$ |
| P2 | 能量守恒（无耗散） | $E(t)=E(0)\pm10^{-8}$（辛积分） |
| P3 | 无源性（RC/RLC） | $E(t)\ge0$ 且 $\dot E\le0$ |
| P4 | Newton 二次收敛 | 相邻误差比 $\|e_{k+1}\|/\|e_k\|^2\approx\text{const}$ |
| P5 | MOR H∞ 界 | $\|G-G_r\|_\infty\le2\sum_{i>r}\sigma_i$ |
| P6 | 零穿越定位 | 事件时刻误差 $\le\varepsilon_t$ |
| P7 | 收敛阶 | 后向欧拉全局误差 $\propto\Delta t$（log-log 斜率≈1） |

### 8.3 DoD（完成定义）

一个算子`ACCEPTED` 当且仅当：对应解析解相对误差 $<\text{tol}$（默认 1e-2，瞬态峰值区 1e-3）**且** 对应性质测试全部通过 **且** 在 `mathspec/tests/` 有可复现用例。**未过测试的算子不得进入 netlab。**

---

## 9. 可插拔扩展架构（Q7 = a：硬约束）

以下四条为**规范级硬约束**，违反即视为不合规实现。

### 9.1 核心不可变

`NodeRecord`、`EdgeRecord`、连接器语义（§2.4）**字段含义冻结**。任何扩展不得改其字段语义、不得改 `snapshot` 契约（`scene.py:83/131`）。

### 9.2 插件只"扩"不"改"

插件只能：新增 `kind`、新增算法/求解器、新增数据字段、新增**声明式** UI。**不得**替换核心语义、不得 monkey-patch 核心类。

### 9.3 自定义引擎只能注册为"新 mode"

引擎必须实现固定协议 `EngineProtocol = {build, step, reset, probes, stats}`（对应 `scene.py:156-171` `_Engine`），只能注册为与 `signal/circuit/vector` **并列**的新 mode，不得侵入现有三引擎。**代码层已强制**：`engine_registry.py:18-21` 拒绝覆盖已有 mode。

### 9.4 插件私有数据隔离（含前置改动）

私有状态**只能**写入 `ext[plugin_id]`，不得污染全局或核心字段。

> **⚠ 前置改动（规范要求，落地前必做）**：当前 `NodeRecord`（`scene.py:68-102`）**没有 `ext` 字段**，`ext[plugin_id]` 目前只是 `ARCHITECTURE.md:660-661` 的文档约定。要使其成为**可强制的硬约束**，必须：
> 1. 给 `NodeRecord` / `EdgeRecord` 增加 `ext: dict[str, Any] = field(default_factory=dict)`；
> 2. 序列化 `snapshot` 时**只**在 `include_ext=True` 时输出 `ext`（避免污染现有 API）；
> 3. 提供 `ext` 命名空间访问器，拒绝跨插件写。
>
> `mathspec/graph.py` 已按此形式化（`Node.ext` / `Edge.ext`），作为参考实现。

### 9.5 强制点清单（现状对码）

| 约束 | 代码证据 | 状态 |
|---|---|---|
| 引擎只能新 mode | `engine_registry.py:18-21` | ✅ 已强制 |
| 核心字段不变 | `scene.py:68-102` | ⚠ 约定，未冻结 API |
| 私有数据 `ext[plugin_id]` | `ARCHITECTURE.md:660-661` | ❌ 未落 dataclass（§9.4 前置改动） |
| kind 前缀 `user.` | `extensions.py:193-199` | ✅ 已强制 |

---

## 10. 纵切案例：DC 电机驱动机械负载（Q2）

### 10.1 物理构成（两域 + 控制）

- **电气域**：电枢回路 $L\dot i=V-R i-K_e\omega$（$L$ 电感、$R$ 电阻、$K_e$ 反电动势常数）。
- **机械域**：$J\dot\omega=K_t i-b\omega-\tau_L$（$J$ 惯量、$b$ 阻尼、$K_t$ 力矩常数、$\tau_L$ 负载）。
- **控制**：PI 转速环 → 电压指令 $V=\mathrm{sat}(K_p(\omega^\ast-\omega)+K_i\int(\omega^\ast-\omega))$，含 **限幅（clip）事件** 与 **PWM 饱和（离散事件）**。

**状态** $x=(i,\omega,\xi)$，$\xi$ 为积分器状态；**输入** $u=(\omega^\ast,\tau_L)$。

### 10.2 图 → 方程 → 求解 → 事件 → 观测（全链路）

1. **图**：两域各自节点；`connect` 以 flow/potential 连接（电枢电流 → 机械力矩经 $K_t$ 换能器节点）。换能器 = **两端口 acausal 器件** $(\text{电},\text{机})$，$P=Vi=\tau\omega$（理想换能器功率守恒）。
2. **方程**：展平 → 得 DAE（电气 2 阶 + 机械 1 阶 + 控制 1 阶 + 代数饱和约束）。
3. **求解**：BK 块序列；线性块 LU 缓存；饱和 clip 作非线性块 Newton。
4. **事件**：饱和边界 $V=\pm V_{\max}$ 为零穿越事件（§4.2），触发后方程切换（电压源 vs 饱和）。
5. **观测**：$y=(i,\omega,V)$ 入环形缓冲，前端增量渲染。

### 10.3 解析解 / 性质测试对应

- 空载稳态 A5：$\omega_{ss}=V/K_e$；带载稳态 A6 见 §8.1。
- P1 KCL/KVL 残差；P4 Newton 二次收敛；P6 电压饱和事件定位；P2 无耗散时能量守恒（$b=\tau_L=0$，$\tfrac12Li^2+\tfrac12J\omega^2$ 守恒）。

> **`mathspec/models/dc_motor.py` 提供该案例的可运行实现与解析解对照测试。**

---

## 11. 里程碑与验收（Q6 = a：带 DoD）

| 里程碑 | 目标 | 交付物 | 验收 DoD | 依赖 |
|---|---|---|---|---|
| **M0 数学地基** | UGM + DAE + 编译管线形式化 | 本规范 §2–§5；`mathspec/graph.py`、`linalg.py` | 图/连接器单元测试绿；A1–A4 解析解通过 | — |
| **M1 纵切闭环** | DC 电机端到端打通 | `mathspec/models/dc_motor.py` + 测试 | A5/A6 稳态误差<1%；P1/P4/P6 通过 | M0 |
| **M2 各引擎形式化** | signal/circuit/vector 统一为 DAE | §3 细化 + 三域 stamp 参考实现 | 三域同一 DAE 求解器复算一致 | M1 |
| **M3 事件/多域** | 混合自动机 + 事件定位 + MLD | `mathspec/hybrid.py` + 测试 | P6 事件误差≤1e-9；MLD 三水箱对照 | M2 |
| **M4 大规模/MOR** | KLU/迭代 + POD/BT/DMD | `mathspec/mor.py` + 测试 | P5 H∞ 界成立；`reduced` 误差估计可信 | M3 |
| **M5 工程化** | 进 netlab（加 `ext`、注册新 mode、接事件总线） | PR 到 netlab（遵守 §9） | 全量回归 + 性能不退化 | M4 |

**关键路径**：M0→M1 是全项目地基，**先纵切再做广**；M2–M4 可并行展开。

---

## 12. 附录

- **附录 A：`mathspec/` 参考实现说明** —— 见 `NetlabHome/mathspec/README.md`（模块划分、如何跑 `pytest`、与 netlab 的映射）。
- **附录 B：NetLab 现状对码表（file:line）** —— 见 `mathspec/README.md` 的"现状对码"节与后台测绘结论；关键缺口：acausal 连接器 / index reduction / tearing / 事件检测 / MOR 均为 `no`，DAG 调度 `partial`，溯源 `no`。
- **附录 C：研究出处** —— 见 `PERFORMANCE_AND_CONCURRENCY.md` §18–§30（每条带 DOI 与 URL）。

---

## 13. 与既有文档的关系

- `PERFORMANCE_AND_CONCURRENCY.md`：**研究台账**（§0–§33，探索性、含信息源），本文件是其**规范化收敛**。
- 本文件：**规范**（可验收、可实现的数学口径）。
- `mathspec/`：**参考实现**（零耦合、可跑测试）。
- `MATH.md`：**逐行代码锚点**（MNA/元件伴随/Newton/DC·AC 等实现级公式与 `file:line`），本文件是这些实现细节的**统一抽象**；两者互为表里。

> 一句话：**研究在 `PERFORMANCE_AND_CONCURRENCY.md`，口径在本文，证据在 `mathspec/`。**

---

## 14. 可行性验证与创造性拓展（数学形式层实验报告）

> 用户（m01082）任务：对本文所学数学知识做可行性验证与拓展，自由组合不同方向的方法，深刻理解数学原理与特征；**数学验证必须严谨准确、证明正确**；构建与 NetLab 相关的复杂系统数据处理/传输/分析以验证总数学形式可行性；**不直接修改 netlab 现有算法**，只做数学形式工作，完成后总结记录于本文档。本节所有实现位于 `NetlabHome/mathspec/experiments/`，**零 `import netlab`**，可独立复现。

### 14.1 试验台：五域耦合的 DC 电机驱动系统

状态 $x=(i,\omega_m,\omega_l,\theta)\in\mathbb{R}^4$（电枢电流、电机角速度、负载角速度、轴扭转角），输入 $u=(V,\tau_L)$（电枢电压、负载转矩）：

$$
\begin{aligned}
L\dot i &= V - R i - K_e\omega_m,\\
J_m\dot\omega_m &= K_t i - b_m\omega_m - \frac{\tau_s}{N},\\
J_l\dot\omega_l &= \tau_s - b_l\omega_l - \tau_L,\\
\dot\theta &= \frac{\omega_m}{N} - \omega_l,\\
\tau_s &= k_s\theta + c_s\!\left(\frac{\omega_m}{N}-\omega_l\right).
\end{aligned}
$$

线性化 $\dot x = A x + B V + E\tau_L$：

$$
A=\begin{bmatrix}
-\frac{R}{L} & -\frac{K_e}{L} & 0 & 0\\
\frac{K_t}{J_m} & -\frac{b_m+c_s/N^2}{J_m} & \frac{c_s}{N J_m} & -\frac{k_s}{N J_m}\\
0 & \frac{c_s}{N J_l} & -\frac{b_l+c_s}{J_l} & \frac{k_s}{J_l}\\
0 & \frac{1}{N} & -1 & 0
\end{bmatrix},\quad
B=\begin{bmatrix}1/L\\0\\0\\0\end{bmatrix},\quad
E=\begin{bmatrix}0\\0\\-1/J_l\\0\end{bmatrix}.
$$

**参数（`DriveTrainParams`）**：$R=0.5\,\Omega$，$L=0.01\,\mathrm{H}$，$K_e=K_t=0.05$，$J_m=0.002$，$b_m=5\times10^{-4}$，$N=10$，$J_l=0.05$，$b_l=0.01$，$k_s=5$，$c_s=0.02$。

**特征值**：$\lambda=\{-47.3702,\,-2.3602,\,-0.6098\pm 11.1735j\}$ → 扭转振荡频率 $f_0=1.7783\,\mathrm{Hz}$（$T_0\approx0.562\,\mathrm{s}$）。
**稳态（$V=12,\tau_L=0.5$）**：$x_{ss}=[3.464286,\ 205.357143,\ 20.535714,\ 0.141071]$。

### 14.2 验收判据与结果（V1–V11）

| 编号 | 数学断言 | 阈值 | 实测 | 结论 |
|---|---|---|---|---|
| V1 | $\|A x_{ss}+BV+E\tau_L\|_\infty$（稳态残差） | $\le10^{-10}$ | $\le10^{-12}$（浮点零） | ✅ |
| V2 | 能量守恒误差 $\big|\Delta E-\int P\,dt\big|/\max|E|$（梯形） | $\le10^{-5}$ | $8.648\times10^{-8}$ | ✅ |
| V3 | FFT 峰值频率 vs $f_0$ | $\le$ 半格 | $1.7478$ vs $1.7783$（$\Delta=0.0305$；$df=0.2497$） | ✅ |
| V4 | 均匀量化 $\max|x-Q(x)|\le\Delta/2$；MSE$\approx\Delta^2/12$ | 严格 | $\Delta=7.843\times10^{-3}$，$\max=3.922\times10^{-3}$；MSE 比 $1.0016$ | ✅ |
| V5 | 一阶差分无损；差分+zlib 压缩比 | $>1.5$ | 无损；$15.17\times$ | ✅ |
| V6 | CRC32 分块传输在 10% 损坏率下无损 | 100% | 16 块、5 次重传、内容一致 | ✅ |
| V7 | Eckart–Young：$\sigma_{r+1}=\min$ 误差 | — | $\sigma=[9549.44,39.81,2.2098,0.2101]$；$r=2$ 能量占比 $0.99999995$；$r=3$ 投影相对误差 $2.2\times10^{-5}$ | ✅ |
| V8 | POD-量化误差 $\le\|X-U_rU_r^TX\|_F+\sqrt{rN}\Delta/2$ | 严格 | $0.1730\le0.3068$（$0.564\times$） | ✅ |
| V9 | 平衡截断 $\|G-G_r\|_{H_\infty}\le2\sum_{i>r}\sigma_i$ | 严格 | 界 $11.058$、实测 $8.437$（$0.763\times$），降阶系统稳定 | ✅ |
| V10 | Anderson 加速 vs Picard（仿射） | 迭代数 $<1/2$ | $4$ vs $264$（$66\times$） | ✅ |
| V11 | 端到端 POD→量化→差分→zlib→CRC 传输→重构误差 $\le$ 理论界 | 严格 | $9.584\times10^{-4}\le1.4775\times10^{-3}$；压缩 $2412\to102$ B（$23.65\times$） | ✅ |

> 全部 **29 条 pytest 通过（29 passed in 3.26 s）**。

### 14.3 关键定理与证明

**定理 14.1（均匀量化误差界）** 设量化器 $Q(x)=x_{\min}+\Delta\,\mathrm{round}\!\big((x-x_{\min})/\Delta\big)$，$\Delta=(x_{\max}-x_{\min})/(L-1)$，$L=2^b$，并对码字做 $[0,L-1]$ 截断。则对任意 $x\in[x_{\min},x_{\max}]$，$|x-Q(x)|\le\Delta/2$。若 $x$ 在该区间均匀分布且 $L\gg1$，则量化误差 $e\sim U(-\Delta/2,\Delta/2)$，$\mathrm{MSE}=\Delta^2/12+O(\Delta^3/(x_{\max}-x_{\min}))$。

*证明.* 令 $r=(x-x_{\min})/\Delta\in[0,L-1]$。则 $Q(x)-x_{\min}=\Delta\,\mathrm{round}(r)$，故 $|x-Q(x)|=\Delta\,|r-\mathrm{round}(r)|\le\Delta/2$（最近整数误差不超过 $1/2$）。截断只在端点外生效，而在区间内 $r\in[0,L-1]$ 不触发截断，故界成立。MSE：对每个量化小区间，$x$ 均匀则 $e$ 在 $[-\Delta/2,\Delta/2]$ 上均匀（端点小区间因单侧稍异），其方差为 $\Delta^2/12$；按全区间密度加权并展开得上述 $O(\cdot)$ 项。$\square$

**定理 14.2（一阶差分可逆）** 定义 $D:\mathbb{Z}^N\to\mathbb{Z}^N$：$(Dc)_1=c_1$，$(Dc)_k=c_k-c_{k-1}$（$k\ge2$）。则 $c_k=\sum_{j=1}^{k}(Dc)_j$，即差分编码无损。

*证明.* 对 $k$ 归纳：$k=1$ 显然；若 $c_{k-1}=\sum_{j<k}(Dc)_j$，则 $c_k=c_{k-1}+(Dc)_k=\sum_{j\le k}(Dc)_j$。$\square$

**推论 14.2.1**：整数差分码可用有符号整型无损打包；对光滑信号，差分序列的动态范围与熵显著小于原序列，因而是后续熵编码（zlib/Blosc2）的有效预变换。

**定理 14.3（Eckart–Young–Mirsky）** 设 $X\in\mathbb{R}^{n\times N}$ 的 SVD 为 $X=U\Sigma V^{\mathsf T}$，$\sigma_1\ge\cdots\ge\sigma_{\min(n,N)}\ge0$。则
$$
\min_{\mathrm{rank}(Y)\le r}\|X-Y\|_2=\sigma_{r+1},\qquad
\min_{\mathrm{rank}(Y)\le r}\|X-Y\|_F=\sqrt{\sum_{i>r}\sigma_i^2}.
$$
*证明（谱范数）.* 任取 $\mathrm{rank}(Y)\le r$，则 $\dim\ker(Y)\ge N-r$。子空间 $V_{r+1:N}=\mathrm{span}(v_{r+1},\dots,v_N)$ 维数为 $N-r$，故 $\ker(Y)\cap V_{r+1:N}\neq\{0\}$，取单位向量 $z$。则 $Yz=0$，$\|X-Y\|_2\ge\|(X-Y)z\|_2=\|Xz\|_2=\sqrt{\sum_{i>r}\sigma_i^2(z^{\mathsf T}v_i)^2}\ge\sigma_{r+1}$。取 $Y=U_r\Sigma_rV_r^{\mathsf T}$ 达到 $\sigma_{r+1}$。Frobenius 情形由正交不变性 $\|X-Y\|_F^2=\|\Sigma-U^{\mathsf T}YV\|_F^2$ 及同样的秩论证逐项得到。$\square$

**定理 14.4（POD-量化联合误差界）** 设 $U_r\in\mathbb{R}^{n\times r}$ 列正交，$X\in\mathbb{R}^{n\times N}$，$C=U_r^{\mathsf T}X$，逐元素量化满足 $|Q(C_{ij})-C_{ij}|\le\delta$。则
$$
\|X-U_rQ(C)\|_F\le\|X-U_rC\|_F+\sqrt{rN}\,\delta .
$$
*证明.* 三角不等式：$\|X-U_rQ(C)\|_F\le\|X-U_rC\|_F+\|U_r(C-Q(C))\|_F$。因 $U_r$ 列正交，$\|U_rZ\|_F=\|Z\|_F$；又 $\|C-Q(C)\|_F\le\sqrt{rN}\,\delta$。$\square$

**定理 14.5（DFT 频率分辨率）** 对长度 $N$、采样率 $f_s$ 的均匀采样，矩形窗 DFT 的频点为 $f_k=kf_s/N$。单频信号 $f_0$ 的谱峰位于最近频点，故峰位误差 $\le f_s/(2N)$。Hann 窗主瓣更宽（约 $4f_s/N$），单音峰位误差 $\le f_s/N$。

*证明（矩形窗）.* 复指数 $e^{j2\pi f_0 n/f_s}$ 的 DFT 为 Dirichlet 核 $D(f-f_k)=\frac{\sin(\pi N(f-f_k)/f_s)}{\sin(\pi(f-f_k)/f_s)}$，其模在 $f_k$ 处取极大；对单音，全局最大落在距 $f_0$ 最近的 $f_k$ 上，距离 $\le f_s/(2N)$。Hann 窗为两个平移矩形窗之和，主瓣展宽，峰位误差上界放宽到 $f_s/N$（本文实测 $0.212\le0.498$）。$\square$

**定理 14.6（平衡截断 H∞ 误差界，Glover 1984）** 设 $G(s)=C(sI-A)^{-1}B$ 稳定、最小实现，Hankel 奇异值 $\sigma_1\ge\cdots\ge\sigma_n>0$。对 $r<n$，截断系统 $G_r$ 稳定且
$$
\|G-G_r\|_{H_\infty}\le2\sum_{i=r+1}^{n}\sigma_i .
$$
*说明.* 完整证明需 Hankel 算子与 AAK 理论（Glover, *All optimal Hankel-norm approximations of linear multivariable systems and their $L^\infty$-error bounds*, Int. J. Control 39(6):1115–1193, 1984），本文不复述；在 4 状态试验台上做数值验证（V9），界成立且保守度约 $1.31\times$。$\square$

**定理 14.7（机电系统能量恒等式）** 在上式系统中若 $K_t=K_e$（理想机电转换），则沿任意解
$$
\frac{dE}{dt}=V i-\Big[R i^2+b_m\omega_m^2+b_l\omega_l^2+c_s\Big(\frac{\omega_m}{N}-\omega_l\Big)^2+\tau_L\omega_l\Big],
$$
其中 $E=\tfrac12Li^2+\tfrac12J_m\omega_m^2+\tfrac12J_l\omega_l^2+\tfrac12k_s\theta^2$。

*证明.* 链式法则逐项求导并代入状态方程：
$$
\dot E= i(V-Ri-K_e\omega_m)+\omega_m(K_t i-b_m\omega_m-\tau_s/N)+\omega_l(\tau_s-b_l\omega_l-\tau_L)+k_s\theta(\omega_m/N-\omega_l).
$$
代入 $\tau_s=k_s\theta+c_s(\omega_m/N-\omega_l)$，机电耦合项 $(-K_e+K_t)i\omega_m$ 在 $K_t=K_e$ 时抵消；弹性项
$-(\omega_m/N)\tau_s+\omega_l\tau_s+k_s\theta(\omega_m/N-\omega_l)=-c_s(\omega_m/N-\omega_l)^2$。整理即得。$\square$

**推论 14.7.1（离散守恒）** 对光滑解用梯形公式积分上式，局部误差 $O(\Delta t^3)$、全局 $O(\Delta t^2)$；实测归一化误差 $8.648\times10^{-8}$（$\Delta t=10^{-4}$），与二阶收敛一致。

**定理 14.8（Anderson 与 GMRES 等价，Walker–Ni 2011）** 对仿射不动点 $G(x)=Ax+b$，Anderson 加速（深度 $m$）与对 $(I-A)x=b$ 的 GMRES($m$) 在 Krylov 子空间意义下等价；故对谱半径 $<1$ 的 $A$，其收敛显著快于 Picard 迭代。

*说明.* 证明见 Walker & Ni, *Anderson acceleration for fixed-point iterations*, SIAM J. Numer. Anal. 49(4):1715–1735 (2011)，本文不复述；数值验证 V10：$A=\mathrm{diag}(0.9,0.8)$ 时 Anderson($m=5$) 4 次达到 $10^{-10}$，Picard 需 264 次。$\square$

### 14.4 端到端组合管线（V11）——语义压缩 + 可靠传输

`mathspec/experiments/dataflow.py::pod_series_roundtrip` 把四个方向的数学工具串成一条完整的数据通路：

1. **POD 降维**（线性代数/最佳低秩）：对训练轨迹快照矩阵做 SVD，取 $U_r$（$r=3$），把每个时刻的 4 维状态投影为 3 个系数——利用轨迹的**低维流形结构**。
2. **均匀量化**（信息论）：系数按 10 bit 量化，$\Delta=7.843\times10^{-3}$，每系数误差 $\le\Delta/2$。
3. **一阶差分 + zlib**（时间序列压缩）：对系数码序列差分（定理 14.2），再熵编码。
4. **CRC32 分块传输**（通信）：10% 随机损坏率下自动重传，保证无损到达。
5. **重构 + 频谱校验**（分析）：$X=U_rC$ 重构后对负载转速做 FFT，峰位 $1.990\,\mathrm{Hz}$ vs 真值 $1.778\,\mathrm{Hz}$（误差 $0.212<$ 半格 $0.249$）。

**结果**：原始差分码 $2412$ B → 压缩 $102$ B（**$23.65\times$**）；归一化重构误差 $9.584\times10^{-4}\le1.4775\times10^{-3}$（Theorem 14.4 界）；传输 1 块、0 重传（本次未注入损坏，V6 单独验证 10% 损坏）。这证明「**语义（POD）压缩 + 量化 + 差分 + 可靠传输**」的组合在数学上自洽、误差可控，可直接映射到 NetLab 的探针数据流（把"空间快照 POD"换成"时间窗 POD/模态基"即可）。

### 14.5 创造性组合路径（数学层，按可行性排序）

| # | 组合（方向 × 方向） | 数学核心 | 预期收益 | 状态/验证 |
|---|---|---|---|---|
| C1 | POD × 量化 × 差分 × CRC | 定理 14.3/14.4 + 14.2 | 探针流 10–25× 压缩、误差有界 | ✅ 已实现（V11） |
| C2 | 事件检测 × 事件触发采样 × 差分 | 零穿越 + 总变差界 | 事件稀疏时通信量再降一个量级 | 路径（§4 事件检测 + 本文 V5） |
| C3 | Anderson × Newton（非线性电路） | 定理 14.8 + 阻尼 Newton | Newton 外迭代 2–5× 减少（初值差时） | 路径（`accel.py` 已有 Anderson 原型） |
| C4 | 平衡截断 MOR × 事件监督器 | 定理 14.6 + 混合自动机 | 缩略模型做快速预览、事件时切全模型，预览 10–100× | 路径（`mor.py` + §4） |
| C5 | POD-DEIM × 非线性元件 | 非线性项经验插值 | 非线性电路/热辐射的降阶可算 | 路径（需扩展 `mor.py`） |
| C6 | 图自同构 × AC 扫频 | 群作用轨道 + 稀疏重排 | 对称电路只算独立频点，$\|V\|/\|V/\Gamma\|$ 加速 | 路径（§15.4/§19.3） |
| C7 | 随机低秩 × 大规模 Jacobian | 随机 SVD/草图 | 大 $n$ 时 Jacobian 压缩，内存 $O(nr)$ | 路径（需误差界） |

### 14.6 复现与代码清单

- 命令：`cd NetlabHome && python -m pytest mathspec/tests -q` → **29 passed in 3.26 s**。
- `mathspec/experiments/drivetrain.py`：五域试验台、解析稳态、能量、频谱、RK4。
- `mathspec/experiments/dataflow.py`：采样/量化/差分/打包/CRC 传输/FFT/POD/端到端管线。
- `mathspec/experiments/accel.py`：Picard / Anderson。
- `mathspec/tests/test_experiments.py`：V1–V11 共 10 条测试（含端到端）。
- 依赖：仅 `numpy`、`scipy`、`pytest`、`zlib`（标准库）。

### 14.7 结论与局限

**结论**：本文档 §2–§13 的数学口径在独立参考实现上通过 **11 类验收判据、29 条测试**；关键定理（量化误差、差分可逆、Eckart–Young、POD-量化联合界、DFT 分辨率、能量恒等式）均给出证明或严格引用；平衡截断 H∞ 界与 Anderson 加速做了数值验证。**总数学形式可行。**

**局限**：试验台为单机、线性、定步长 LTI（4 状态）；量化误差界假设系数落在量化范围内；BT 仅验证 4 状态；端到端管线未测真实 NetLab 探针流（需在 M1 纵切后接真实数据）。这些局限不影响"数学形式可行"的结论，但决定 M2–M4 的推广顺序。

## 15. 架构可扩展功能的数学形式化与验证（超越当前实现）

> 用户（m01335）任务：继续整理与扩展 **netlab 除当前功能外架构可实现的功能**的数学形式验证与拓展；继续测试**优化算法与数据结构**的数学验证与拓展；自行拓展阅读。本节所有实现位于 `NetlabHome/mathspec/experiments/{optim,datastruct,ordering,kalman}.py` 与对应测试，**零 `import netlab`**，只依赖 `numpy`/`scipy`/标准库。

### 15.1 方法：能力扩展 = (状态, 算子, 不变量)

把"架构可实现的新功能"统一写成三元组 $(\mathcal X,\ \mathcal T,\ \mathcal I)$：状态空间 $\mathcal X$、算子/变换 $\mathcal T$、必须保持的不变量 $\mathcal I$。一个功能只有**三件事同时成立**才算"数学上可实现"：

1. **语义可定义**：$\mathcal T$ 在 UGM（§2）上有明确输入/输出与类型；
2. **计算可执行**：存在有限步算法，复杂度可估计；
3. **数值可验证**：$\mathcal I$ 可用解析解或性质测试度量（§8 口径）。

下表把 netlab 现有功能之外、但架构**允许**扩展的能力分成 10 类（✅=本轮已给数学形式+原型；◐=有形式化路径）：

| # | 能力 | 数学对象 | 现状 | 扩展后的形态 |
|---|---|---|---|---|
| C1 | 非因果多域连接 | 连接器 $(\mathcal V_p,\mathcal V_f)$ + 商图 | 信号流/电路两接线 | acausal 电气/机械/热/流体统一拼装 ◐ |
| C2 | 状态估计 | Kalman/Luenberger 观测器 | 无 | 数字孪生在线估计 ✅ |
| C3 | 最优控制 | DARE/LQR、MPC-QP | 无 | 控制器整定/预览 ✅ |
| C4 | 参数辨识 | 最小二乘 + Fisher 信息 | 无 | 模型校准/拟合 ✅ |
| C5 | 不确定性量化 | Monte Carlo/PCE | 无 | 置信区间/鲁棒性 ◐ |
| C6 | 协同仿真 | FMI-ish 小增益耦合 | 无 | 多解算器耦合 ◐ |
| C7 | 事件溯源 | Provenance 半环 + 事件日志 | 无 | undo/replay/审计 ◐ |
| C8 | 稀疏排序 | 图消元/填充最小化 | 默认 COLAMD | AMD/ND/RCM 可选 ✅ |
| C9 | 连续优化 | Newton/BFGS/LM/CG | 仅阻尼 Newton | 参数拟合/反问题 ✅ |
| C10 | 数据结构 | 并查集/堆/环缓冲/LRU/CSR | 分散实现 | 统一验证过的原语 ✅ |

### 15.2 非因果多域连接器（C1）

**定义 15.1（连接器）** 一个连接器 $C=(\mathcal V_p,\mathcal V_f)$ 含势变量 $p\in\mathcal V_p$ 与流变量 $f\in\mathcal V_f$。对连接器集合 $S$ 上的 `connect`，语义为

$$
p_i=p_j\quad(\forall i,j\in S),\qquad \sum_{i\in S} f_i=0 .
$$

**命题 15.1** `connect` 生成的势相等关系是等价关系；把每个等价类收缩成一个节点后，流守恒恰为该商图上的 KCL。

*证明.* 相等关系自反、对称、传递，故为等价关系。设等价类 $[p]$，把类内所有端口的流相加：$\sum_{i\in[p]} f_i=0$，这正是"流入节点 $[p]$ 的电流代数和为零"的 KCL 形式；势在各端口上相同，故商图上节点电压良定义。$\square$

> 这就是 Modelica connector 的数学核心（§23）：**势相等 + 流求和**。它把"电气 KCL/KVL、机械力/速度、热流/温度"统一成同一套连接方程。NetLab 现在只有电路引擎内部做并查集合并（`scene.py:527-553`），尚未把它提升为跨域连接器层。

### 15.3 状态估计（C2）

线性高斯系统

$$
x_{k+1}=A x_k+B u_k+w_k,\quad w_k\sim\mathcal N(0,Q),\qquad
y_k=C x_k+v_k,\quad v_k\sim\mathcal N(0,R).
$$

**定理 15.1（Kalman 递推与 Joseph 形式）** 设先验 $x\sim\mathcal N(\hat x,P)$，则预测 $\hat x^-=A\hat x+Bu$、$P^-=APA^{\mathsf T}+Q$；更新

$$
S=CP^-C^{\mathsf T}+R,\quad K=P^-C^{\mathsf T}S^{-1},\quad
\hat x^+=\hat x^-+K(y-C\hat x^-),
$$
且 $P^+=(I-KC)P^-(I-KC)^{\mathsf T}+KRK^{\mathsf T}=P^--P^-C^{\mathsf T}S^{-1}CP^-$。Joseph 形式在有限精度下保持对称半正定。

*证明（要点）.* 由高斯条件期望公式，后验协方差为 $P^--P^-C^{\mathsf T}S^{-1}CP^-$。展开 Joseph 形式：
$$
(I-KC)P^-(I-KC)^{\mathsf T}+KRK^{\mathsf T}
=P^--KC P^--P^-C^{\mathsf T}K^{\mathsf T}+K(CP^-C^{\mathsf T}+R)K^{\mathsf T}
=P^--P^-C^{\mathsf T}S^{-1}CP^-
$$
（代入 $K=P^-C^{\mathsf T}S^{-1}$ 并抵消）。两项均为半正定之和，故 $P^+\succeq0$。$\square$

**验证（E10）**：双积分器 + 300 步含噪轨迹，归一化误差均值 $0.861<3$，协方差最大不对称 $3.47\times10^{-18}$，最小特征值 $3.75\times10^{-4}>0$。

### 15.4 最优控制（C3）

**定理 15.2（DARE 与 LQR）** 若 $(A,B)$ 可镇定、$(Q^{1/2},A)$ 可检测，离散代数 Riccati 方程

$$
P=Q+A^{\mathsf T}PA-A^{\mathsf T}PB(R+B^{\mathsf T}PB)^{-1}B^{\mathsf T}PA
$$

有唯一半正定镇定解 $P$；取 $K=(R+B^{\mathsf T}PB)^{-1}B^{\mathsf T}PA$，则闭环 $A-BK$ 的所有特征值在单位圆内，且 $K$ 最小化 $\sum_k(x_k^{\mathsf T}Qx_k+u_k^{\mathsf T}Ru_k)$。

*说明.* 标准结果（Anderson & Moore）；本文用值迭代 $P_{k+1}=F(P_k)$ 求解并验证残差与闭环谱半径。**验证（E11）**：双积分器 $Q=I,R=1$，19 次迭代收敛，DARE 残差 $1.1\times10^{-13}$，闭环特征值 $0.377\pm0.216j$，$|\lambda|=0.434<1$。

### 15.5 参数辨识与灵敏度（C4）

**定理 15.3（最小二乘与可辨识性）** 对模型 $y\approx f(\theta)$、残差 $r(\theta)=y-f(\theta)$，若 $J=\partial f/\partial\theta$ 列满秩，则 Gauss–Newton 正规方程 $J^{\mathsf T}J\,\Delta\theta=J^{\mathsf T}r$ 有唯一解；参数可辨识当且仅当 Fisher 信息 $F=J^{\mathsf T}\Sigma^{-1}J$ 满秩（$\mathrm{rank}\,F=p$）。

**伴随灵敏度**：对 $\dot x=f(x,u,\theta)$、目标 $J(\theta)=\int g(x,u,\theta)dt$，引入伴随 $\lambda$ 满足 $\dot\lambda=-f_x^{\mathsf T}\lambda-g_x^{\mathsf T}$，则 $\nabla_\theta J=\int(f_\theta^{\mathsf T}\lambda+g_\theta^{\mathsf T})dt$——一次前向 + 一次反向，代价与参数个数无关。

**验证（E4）**：指数模型 $y=2.5e^{-1.3t}$，LM 从 $[1.0,0.5]$ 出发 6 次迭代恢复到 $[2.5,1.3]$，代价 $2.66\times10^{-30}$。

### 15.6 不确定性量化与协同仿真（C5/C6）

- **Monte Carlo**：若 $g$ 方差有限，则 $\mathrm{Var}(\hat g_N)=\sigma^2/N$，误差 $O(N^{-1/2})$（CLT）；对光滑低维问题，多项式混沌（PCE）可指数收敛。
- **协同仿真小增益定理**：两个子系统 $G_1,G_2$ 以固定步长交换输出，若 $\|G_1\|_\infty\|G_2\|_\infty<1$，则耦合迭代是压缩映射，存在唯一不动点且几何收敛；步长需满足 $\Delta t<\frac{2}{\omega_c}\arctan(1/\kappa)$（$\kappa$ 为耦合增益）。
- **工程含义**：FMI Co-Simulation 的"通信步长 / 事件模式"不是实现细节，而是**稳定性条件**；NetLab 若做 signal/circuit 多解算器耦合，必须把该条件写进调度器。

### 15.7 事件溯源代数（C7）

**定义 15.2（溯源半环）** 设 $(K,\oplus,\otimes,0,1)$ 为交换半环，事件 $e$ 带标注 $k_e\in K$；查询 $q$ 的溯源值按结构归纳：$\mathrm{prov}(q)=\bigoplus_{\text{路径}} \bigotimes_{\text{边}} k_e$。取 $K=(\mathbb R_{\ge0},+,\times,0,1)$ 得"代价/概率"溯源；取 $K=(\mathcal P(\text{来源}),\cup,\cup,\emptyset,\emptyset)$ 得"来源集合"溯源。

**命题 15.2（重放确定性）** 若事件处理器是纯函数且事件按 `seq` 全序应用，则 `snapshot + replay(log)` 与"从头执行"得到相同状态；事件日志只需单调 `seq`、幂等键与周期快照三个不变量。

*证明.* 纯函数对相同输入产生相同输出；全序 `seq` 固定应用顺序；快照是某一前缀的状态，重放其余后缀唯一。$\square$

### 15.8 优化算法与数据结构验证（E1–E12）

实现：`mathspec/experiments/optim.py`（GD/阻尼 Newton/BFGS/LM/CG）、`datastruct.py`（并查集/二叉堆/环形缓冲/LRU/CSR）、`ordering.py`（自然/RCM/最小度/嵌套剖分 + 符号填充）、`kalman.py`（Kalman/LQR）。测试：`mathspec/tests/test_optim.py`、`test_datastruct.py`、`test_ordering.py`、`test_kalman.py`。

| 编号 | 断言 | 实测 | 结论 |
|---|---|---|---|
| E1 | 二次函数 + 精确 Hessian，Newton 一步到最优 | $\le2$ 次，误差 $<10^{-10}$ | ✅ |
| E2 | Rosenbrock：BFGS 收敛 | 35 次，$\|\nabla f\|_\infty=2.84\times10^{-11}$，$f=7.66\times10^{-25}$ | ✅ |
| E3 | 同一问题：梯度下降仅线性收敛 | 20000 次，$\|\nabla f\|_\infty=1.11\times10^{-4}$，$f=1.94\times10^{-8}$ | ✅（对照） |
| E4 | LM 恢复指数参数 | 6 次，$[2.500000,1.300000]$，代价 $2.66\times10^{-30}$ | ✅ |
| E5 | CG 解 SPD（$n=80$） | 22 次，残差 $9.78\times10^{-10}$ | ✅ |
| E6 | 并查集 200k 次混合操作 | $0.444$ s（$\approx2.2\,\mu s$/op），连通分量 99992 与朴素一致 | ✅ |
| E7 | 二叉堆 100k push+pop | $0.074$ s，弹出序列严格有序 | ✅ |
| E8 | 环形缓冲 500k 次 push（容量 4096） | $0.097$ s，最终长度 4096，覆盖顺序正确 | ✅ |
| E9 | 12×12 网格排序（带宽/填充） | 自然 12/1331；RCM 12/946；最小度 123/618；嵌套剖分 113/992 | ✅ |
| E10 | Kalman 协方差 | 归一化误差均值 0.861<3；不对称 $3.47\times10^{-18}$；最小特征值 $3.75\times10^{-4}$ | ✅ |
| E11 | LQR/DARE | 19 次，残差 $1.1\times10^{-13}$，闭环 $|\lambda|=0.434<1$ | ✅ |
| E12 | CSR 三元组合并 + matvec | 重复项求和正确，$y=Ax$ 与稠密一致 | ✅ |

> 关键观察：**E3 vs E2** 是同一 Rosenbrock 问题上"一阶 vs 拟牛顿"的 3 个数量级差距（20000 次仍 $10^{-4}$ vs 35 次到 $10^{-11}$），说明"优化算法选择"不是常数优化而是**收敛阶的选择**。**E9** 说明"排序"能把符号填充降低 28%–54%，且最小度在填充上优于嵌套剖分（本网格规模），但嵌套剖分带宽更稳——这正是稀疏直接解法要按问题选排序的原因。

### 15.9 自行拓展阅读（数学基础与 2024–2026 前沿）

**经典基础**
1. Kalman, R.E. *A New Approach to Linear Filtering and Prediction Problems.* J. Basic Eng. 82(1):35–45 (1960). DOI `10.1115/1.3662552`
2. Anderson, B.D.O. & Moore, J.B. *Optimal Control: Linear Quadratic Methods.* Dover (2007).
3. Nocedal, J. & Wright, S.J. *Numerical Optimization.* 2nd ed., Springer (2006).
4. Boyd, S. & Vandenberghe, L. *Convex Optimization.* Cambridge (2004).
5. Tarjan, R.E. *Efficiency of a Good but Not Linear Set Union Algorithm.* JACM 22(2):215–225 (1975). DOI `10.1145/321879.321884`
6. Sleator, D.D. & Tarjan, R.E. *Amortized Efficiency of List Update and Paging Rules.* CACM 28(2):202–208 (1985). DOI `10.1145/2786.2793`
7. Cuthill, E. & McKee, J. *Reducing the Bandwidth of Sparse Symmetric Matrices.* ACM 1969. DOI `10.1145/800195.805928`
8. George, A. *Nested Dissection of a Regular Finite Element Mesh.* SIAM J. Numer. Anal. 10(2):345–363 (1973). DOI `10.1137/0710032`
9. Amestoy, P.R., Davis, T.A. & Duff, I.S. *An Approximate Minimum Degree Ordering Algorithm.* SIAM J. Matrix Anal. Appl. 17(4):886–905 (1996). DOI `10.1137/S0895479894278952`
10. Davis, T.A. *Direct Methods for Sparse Linear Systems.* SIAM (2006).

**2024–2026 延伸（与 §31 呼应）**
11. *SubtreeLU: A Fast LU Factorization for Sparse Matrices*（2025）——子树分解复用。
12. *Localized diakoptic refactorization*（IET 2025）——局部重分解，对应 Woodbury/增量。
13. *iG-kway: GPU-Accelerated k-way Hypergraph Partitioning*（DAC 2025）——超图分区。
14. *DEVS × FMI 3.0 co-simulation*（SIMULATION 2025, DOI `10.1177/00375497251393255`）——事件协同仿真。
15. *Anderson acceleration without restart*（arXiv:2403.16734）——无重启 Anderson 的收敛理论。
16. *NeuroSPICE*（arXiv:2512.23624）——学习型 SPICE 代理。

### 15.10 优先级与结论

| 优先级 | 能力 | 理由 |
|---|---|---|
| **A** | C9 优化（BFGS/LM）、C4 参数辨识、C2 状态估计 | 直接支撑"模型校准 / 数字孪生 / 参数扫频"，mathspec 已验证，接入成本最低 |
| **A/B** | C3 LQR/MPC、C8 稀疏排序 | LQR 可先从线性化模型做；排序先做可选 RCM/AMD 开关 |
| **B** | C10 数据结构统一化、C5 UQ | 现有分散实现可收敛到验证过的原语；UQ 做蒙特卡洛即可 |
| **C** | C1 acausal 连接器、C6 协同仿真、C7 事件溯源 | 需要先补 index reduction/tearing（§23）与事件总线（§25），是"大功能" |

**结论**：NetLab 架构可扩展的 10 类能力中，**C2/C3/C4/C8/C9/C10 已在 mathspec 给出数学形式、算法与可复现实测**（E1–E12，49 条测试全绿）；C1/C5/C6/C7 给出了严格的形式化定义与实施条件。所有验证均**未改 netlab 源码**，符合"先在数学形式上测试验证"的总原则。

## 16. 数学回顾与遥测事件管线验证

> 本节复核 §14 的机电模型、量化/POD/差分/CRC 结果和 §15 的数据结构/不变量，并新增一个与 NetLab 探针流直接对应、但完全零耦合的组合实验。实现位于 `NetlabHome/mathspec/experiments/telemetry.py`，测试位于 `mathspec/tests/test_telemetry.py`；不导入 `netlab`。

### 16.1 组合对象与数据流

给定采样时间 $t_0<\cdots<t_{N-1}$ 和系统输出 $y_k=y(t_k)$，管线定义为

$$
 y_k \xrightarrow{Q} c_k \xrightarrow{\Delta} d_k=c_k-c_{k-1}
 \xrightarrow{\mathrm{pack}_{i32}} b
 \xrightarrow{\mathrm{zlib}} p
 \xrightarrow{\mathrm{CRC32+retry}} p'
 \xrightarrow{\mathrm{decode}} \hat y_k.
$$

其中 $Q$ 是均匀量化器，$c_k$ 是整数码；差分和有符号 `int32` 打包是可逆的，只要差分未超出 `int32` 范围。CRC 重传改变的是发送尝试次数，不改变成功交付的字节串；因此在链路成功终止且 CRC 假阳性不计的模型中，$\hat c_k=c_k$，所有数值误差来自量化和采样插值，而不是压缩或重传。

### 16.2 定理 16.1：固定样本区间内的量化穿越误差界

设真实和重构端点均在同一穿越区间 $[t_i,t_{i+1}]$，令

$$
g_0=y_i-h,\quad g_1=y_{i+1}-h,\quad d=|g_1-g_0|,
$$

其中阈值为 $h$。假设 $d>2\epsilon$，且端点扰动满足 $|\hat g_j-g_j|\le\epsilon$（$j=0,1$），并且扰动后仍保持相反符号。线性插值参数为

$$
\alpha=-\frac{g_0}{g_1-g_0},\qquad
\hat\alpha=-\frac{\hat g_0}{\hat g_1-\hat g_0}.
$$

则

$$
|\hat\alpha-\alpha|\le\frac{\epsilon}{d-2\epsilon},\qquad
|\hat t-t|\le (t_{i+1}-t_i)\frac{\epsilon}{d-2\epsilon}.
$$

*证明.* 设 $D=g_1-g_0$、$\hat D=\hat g_1-\hat g_0$。由三角不等式，$|\hat D|\ge d-2\epsilon>0$。直接相减并约去交叉项：

$$
\hat\alpha-\alpha
=\frac{g_0\hat D-\hat g_0D}{D\hat D}
=\frac{g_0(\hat g_1-g_1)-g_1(\hat g_0-g_0)}{D\hat D}.
$$

在同一侧穿越条件下，端点到阈值的距离满足 $|g_0|+|g_1|=d$。因此分子绝对值不超过 $\epsilon(|g_0|+|g_1|)=\epsilon d$，而分母至少为 $d(d-2\epsilon)$，得到更强的界 $\epsilon/(d-2\epsilon)$。因为 $t=t_i+\alpha\Delta t$，乘以 $\Delta t=t_{i+1}-t_i$ 即得时间界。$\square$

这里的“同一穿越区间”是硬前置条件，不是实现细节：若量化使重构端点不再跨过阈值，或把首次穿越移到另一个区间，定理不适用，管线必须拒绝给出该界。

### 16.3 适用条件、反例和误差分解

- **量化条件**：均匀量化步长为 $\Delta$ 且无饱和时，$\epsilon\le\Delta/2$；若输入超出 `[min,max]` 而被夹紧，不能直接使用该误差界。
- **编码条件**：$d_k$ 必须能表示为有符号 `int32`；否则应扩大码型或分块重置基准，不能静默溢出。
- **事件条件**：必须有唯一、横截的首次穿越。$d\le2\epsilon$ 时分母接近零，事件时间对噪声病态；穿越区间变化时应返回“不适用”，而不是返回一个看似精确的时间。
- **采样条件**：定理只界定“真实样本线性插值”与“重构样本线性插值”的差，不界定真实连续轨迹 $y(t)$ 与线性插值之间的离散化误差。总误差可写成
  $|t_{\mathrm{reported}}-t_{\mathrm{event}}|\le e_{\mathrm{sampling}}+e_{\mathrm{quantization}}$，但前一项需要额外的曲率或 Lipschitz 假设。
- **可靠传输条件**：CRC 只能检测模型中的随机损坏，不能在 CRC 假阳性、永久丢包或攻击者构造碰撞时提供数学上的绝对真实性；实际协议仍需序号、超时和完整性策略。

### 16.4 端到端验收结果

`DriveTrainParams` 的电机—弹性轴—负载输出取负载角速度，采样 `dt=1e-3`；量化范围 `[-1,25]`、12 bit；分块大小 64、损坏率 0.2。验收结果：

| 判据 | 结果 |
|---|---|
| 码流解码严格无损 | `lossless_codes=True` |
| 损坏块确实重传 | `retransmits > 0` |
| 事件时间误差不超过解析界 | `time_error <= time_bound` |
| 压缩有效 | `compression_ratio > 1` |
| 解析线性根参考 | `exact_linear_event_check() < 1e-12` |
| 端点扰动网格 | 7×7 个扰动组合均未越界 |
| 全部 mathspec 测试 | **53 passed** |

### 16.5 对 NetLab 的可实现能力与边界

该实验验证的不是“已经修改了 NetLab”，而是一个可移植的数学契约：探针采样器输出有序时间序列；传输层承诺成功交付原始整数码；分析层只有在穿越区间保持且 $d>2\epsilon$ 时才发布事件时刻及误差界。其后可映射为三层接口：

1. **数据层**：将 `Recorder` 环形缓冲导出为有序窗口，并记录量化范围、位数、采样周期和饱和计数；
2. **传输层**：保留分块校验、序号、重传和失败超时，不能把 zlib 压缩当作可靠性保证；
3. **分析层**：发布 `event_time`、`interval_index`、`bound`、`valid`，当区间变化或饱和时返回 `valid=false`。

这三层仍属于未来实现方案；本节仅证明其数学形式自洽并在零耦合环境通过性质测试。

### 16.6 复现入口

```text
cd NetlabHome
python -m pytest mathspec/tests/test_telemetry.py -q
python -m pytest mathspec/tests -q
```

本轮完整结果为 **53 passed in 3.88 s**。Woodbury 原型的数值相对误差仍为硬验收；其单次速度比较改为观测指标，因为 BLAS 预热、线程调度和缓存会使一次计时反转，不能把机器噪声当成数学性质。

---

## 17. 有限时域可观测性与 log-det 探针选择验证

### 17.1 形式和实现

本轮新增 `mathspec/experiments/observability.py` 与 `mathspec/tests/test_observability.py`，仍然不导入 `netlab`。模型是离散、定常、线性系统

$$
x_{k+1}=Ax_k,\qquad y_k=Cx_k+v_k,
$$

其中 $A\in\mathbb R^{n\times n}$，候选探针行向量组成 $C$，观测噪声是已知协方差 $R\succ0$ 的独立高斯噪声。窗口长度为 $L\ge1$，堆叠观测矩阵为

$$
\mathcal O_L(C)=\begin{bmatrix}C\\CA\\\vdots\\CA^{L-1}\end{bmatrix},
$$

加权有限时域信息矩阵/可观测 Gramian 为

$$
W_L(C)=\sum_{k=0}^{L-1}(CA^k)^TR^{-1}(CA^k).
$$

当 $R=I$ 时，程序验证 $W_L=\mathcal O_L^T\mathcal O_L$；一般正定 $R$ 对应加权最小二乘。`sensor_information_matrices` 把每个标量候选探针的 Gramian 作为一个半正定增量，并按其独立噪声方差缩放。

### 17.1a 链路可用性加权的确定性代理

若第 $i$ 个探针的完整观测窗口以边缘概率 $p_i\in[0,1]$ 成功到达，且其信息增量为 $W_i\succeq0$，本包提供确定性代理

$$
\widetilde W_i=p_iW_i.
$$

`availability_weighted_information_matrices` 只做上述 PSD 缩放；它不计算
$\mathbb E[\log\det(P_0+\sum_i Z_iW_i)]$，其中 $Z_i$ 是随机到达指示变量。因而随后对 $p_iW_i$ 做的 log-det 贪心，保证对象是这个确定性代理而非随机目标的期望。该解释只需要每个窗口的边缘可用概率；若要描述相关故障、部分窗口到达或时变概率，必须另建随机模型。


### 17.2 命题与证明要点

**命题 17.1（Gramian 正半定与有限窗口可观测性）**：对任意实矩阵 $A,C$ 和 $R\succ0$，$W_L(C)\succeq0$。若 $R=I$，则

$$
x^TW_Lx=\sum_{k=0}^{L-1}\|CA^kx\|_2^2,
$$

故 $W_L\succ0$ 当且仅当没有非零状态在整个窗口内被所有观测行消去，即 $\mathcal O_L$ 满列秩。对于一般 $R\succ0$，可先用 $R^{-1/2}$ 白化观测，此时同样的满列秩等价成立；若 $R$ 仅半正定则不作该等价断言。实现通过 Gramian 对称性、特征值非负和秩缺失的对角模式测试这一性质。

**命题 17.2（D-optimal 目标）**：以正定先验精度 $P_0\succ0$ 正则化，定义

$$
F(S)=\log\det\left(P_0+\sum_{i\in S}W_i\right)-\log\det(P_0).
$$

若每个候选增量 $W_i\succeq0$，则信息矩阵始终正定，$F(\varnothing)=0$ 且单调不减。对 $S\subseteq T$、$j\notin T$，边际增益满足

$$
F(S\cup\{j\})-F(S)\ge F(T\cup\{j\})-F(T),
$$

即次模性。证明要点是：$P_0+\sum_{i\in S}W_i\preceq P_0+\sum_{i\in T}W_i$；函数 $X\mapsto\log\det X$ 在正定锥上对 Loewner 序单调，而

$$
\Delta_j(X)=\log\det(X+W_j)-\log\det X
$$

随 $X$ 增大而不增（可由 $\log\det(X+W_j)-\log\det X=\int_0^1\mathrm{tr}[(X+tW_j)^{-1}W_j]dt$ 及逆序反转得到）。因此在精确算术下，固定预算的贪心具有经典 $(1-1/e)$ 型保证；浮点实现仅近似该理论步骤。`logdet_probe_selection` 是该贪心算法，不是全局最优求解器。

### 17.3 验收结果和边界

新增测试覆盖：未加权 Gramian 与堆叠矩阵乘积一致；正定相关测量协方差的加权结果一致；5 个候选探针的全部子集穷举检查单调性与次模边际；贪心边际收益递减且目标值一致；单探针不可观测模态保持秩缺失；availability 权重的 $p=0$、比例缩放、PSD 保持及非法概率拒绝；非法窗口、非正定噪声等输入拒绝。穷举仅验证该 5 探针有限实例，不代替命题证明。`python -m pytest mathspec/tests/test_observability.py -q` → **12 passed**（2026-11-06 实测）。

这是**正则化的信息设计目标**，不应误写成无条件的可观测性证明：若 $P_0\succ0$ 而真实 Gramian 奇异，$F$ 仍可定义，但系统仍可能不可观测；裸 Gramian 的完全可观测性必须单独检查秩/最小特征值。非线性、时变、相关噪声、过程噪声、传感器饱和、故障和不规则采样都不在本原型定理范围内。

### 17.4 对 NetLab 的架构映射

数学上可对应“候选 probe 行 → 有限窗口状态观测 → 观测质量评分 → 选择结果 + 诊断”。未来接入前应保留：窗口 revision、采样时间轴、噪声方差/协方差、Gramian 的秩与条件数、是否使用正则化、选择预算和候选列表。对现有 Recorder/API 的任何修改都不由本节授权；本节仅把候选分析契约在零耦合环境中验证。

### 17.5 来源和复现

来源与适用条件见 `mathspec/research/OBSERVABILITY_SOURCES.md`。其中 Yamada 等（Sensors 2023, DOI `10.3390/s23135961`）给出离散 LTI、有限窗口 Gramian、噪声与 log-det 选择的具体设定；Nemhauser、Wolsey 与 Fisher（Mathematical Programming 1978, DOI `10.1007/BF01588971`）给出单调次模基数贪心的经典近似分析。

复现：

```text
cd NetlabHome
python -m pytest mathspec/tests/test_observability.py -q
```
