

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

随 $X$ 增大而不增（可由 $\log\det(X+W_j)-\log\det X=\int_0^1\operatorname{tr}[(X+tW_j)^{-1}W_j]dt$ 及逆序反转得到）。因此在精确算术下，固定预算的贪心具有经典 $(1-1/e)$ 型保证；浮点实现仅近似该理论步骤。`logdet_probe_selection` 是该贪心算法，不是全局最优求解器。

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
