# 可观测性与探针选择来源记录

本记录只保留本轮采用的可核验来源；原型实现位于 `mathspec/experiments/observability.py`。

## 1. 线性系统与有限时域 Gramian

Yamada et al., *Efficient Sensor Node Selection for Observability Gramian Optimization*, Sensors 23(13), 5961 (2023), DOI [`10.3390/s23135961`](https://doi.org/10.3390/s23135961), full text: <https://pmc.ncbi.nlm.nih.gov/articles/PMC10347126/>。

该文第 2 节给出离散 LTI 模型 `x[k+1]=A x[k]`、`y[k]=C x[k]+v[k]`，并定义有限窗口的堆叠观测矩阵与

`W_O = sum_{k=0}^{L-1} (A^k)^T C^T C A^k`。

文中在独立同方差高斯测量噪声下把 Gramian 与最小二乘估计误差联系起来，并以 `log det(W_O)` 作为传感器子集的评价目标。`observability.py` 的 `finite_horizon_observability` 扩展为已知正定测量协方差 `R`：每个时间块使用 `C^T R^-1 C`；这不是把论文的 i.i.d. 假设悄悄泛化，而是显式改变了加权最小二乘模型。

## 2. D-optimal / log-det 选择

同一来源第 2–3 节把候选传感器子集的 Gramian 写成候选增量之和，并说明纯贪心、梯度贪心、凸松弛等是组合优化方法；它同时提醒大规模和真实数据上不同方法的速度与稳定性不同。因此本实现只把贪心结果作为候选设计，不宣称它等于全局最优。

## 3. 次模贪心的经典保证

Nemhauser, Wolsey & Fisher, *An analysis of approximations for maximizing submodular set functions—I*, Mathematical Programming 14:265–294 (1978), DOI [`10.1007/BF01588971`](https://doi.org/10.1007/BF01588971)。

本轮使用的数学对象是

`F(S) = log det(P0 + sum_{i in S} W_i) - log det(P0)`。

若 `P0` 正定且每个 `W_i` 半正定，则信息矩阵始终正定；矩阵 log-det 的凹性与 PSD 增量的 Loewner 单调性给出 F 的归一化、单调性和递减边际收益（次模性）。Nemhauser 等人的经典结果随后给出基数约束精确贪心的 `1-1/e` 型近似保证。数值浮点运算只能近似这些性质，所以测试同时使用解析结构和有限子集穷举。

## 4. 传感器窗口可用性（内部推导，非外部结论）

`availability_weighted_information_matrices` 假设每个传感器窗口独立地以概率 `p_i` 到达、丢失时贡献零信息，因此 `E[W_i] = p_i W_i`。这是**期望信息矩阵代理**，不是 `E[log det(P0 + sum W_i)]`；它不刻画突发丢包、时间相关故障或窗口部分缺失。若 `p_i` 由实验估计，应先固定估计方法与置信区间，再用于设计。

## 5. 不应外推的范围

这些来源不授权直接用于非线性/时变系统、相关噪声、非高斯观测、过程噪声或传感器故障。若先验为半正定或 Gramian 奇异，裸 `log det` 不存在；本原型使用正定 `P0` 作为正则化设计目标，此时“提高 log-det”不等价于“已经完全可观测”。
