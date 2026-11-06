# mathspec —— 统一图模型与混合计算引擎 · 零耦合参考实现

配套规范：[`../netlab/docs/UNIFIED_SIM_MATH_SPEC.md`](../netlab/docs/UNIFIED_SIM_MATH_SPEC.md)。

> **定位**：在"数学形式上"先行验证规范里的算子；每个算子**先在本包过 pytest，再考虑进 netlab**。
> **零耦合**：本包**不 import netlab**，只依赖 `numpy` / `scipy` / `pytest`。

## 快速开始

```bash
# 在 NetlabHome/ 目录下运行（这样 `import mathspec` 可用）
python -m pytest mathspec/tests -q
```

## 模块划分

| 模块 | 规范章节 | 内容 | 对应 netlab |
|---|---|---|---|
| `graph.py` | §2 | Node/Edge/Graph、连接器并查集、`ext` 插件命名空间 | `core/model/scene.py:68-152` |
| `contract.py` | §9 | 可插拔硬约束的强制点原型（schema 金标准/ExtNamespace 隔离/引擎·kind 注册拒绝） | `engine_registry.py:18-21`、`extensions.py:193-199` |
| `linalg.py` | §5.1 | 稠密 LU 缓存、稀疏 splu 缓存 | `nodal.py:1993/2079` |
| `newton.py` | §5.2 | 阻尼 Newton（双判据 + Armijo） | `nodal.py:1775/1897` |
| `integrate.py` | §5.3 | 后向欧拉 / RK4 / 速度 Verlet | `simulation.py:227` |
| `hybrid.py` | §4 | 混合自动机、零穿越检测/定位、状态重置 | 现状**缺失**（`analysis.py:_crossing` 仅离线） |
| `mor.py` | §6 | POD / 平衡截断(H∞ 界) / DMD | 现状**缺失** |
| `models/dc_motor.py` | §10 | DC 电机纵切案例 + 解析稳态 | 拟新增 |
| `experiments/drivetrain.py` | §14.1 | 五域 DC 电机试验台：A/B/E、稳态、能量、频谱、RK4 | 拟新增（M1 验证） |
| `experiments/dataflow.py` | §14.4 | 采样/量化/差分/CRC 传输/POD/端到端压缩管线 | 探针数据流验证 |
| `experiments/accel.py` | §14.5 | Picard / Anderson 加速 | 非线性求解加速原型 |
| `experiments/incremental.py` | §31.3 P1 | Woodbury 低秩更新（局部重分解） | `_solve_sparse` 增量重分解 |
| `experiments/pod_deim.py` | §31.3 P3 | POD-DEIM 非线性降阶 | 非线性元件降阶 |
| `experiments/eventbus.py` | §31.3 P2 | 事件堆 + 零穿越二分定位 | 事件总线原型 |
| `experiments/optim.py` | §15.8 | 梯度下降 / 阻尼 Newton / BFGS / LM / CG | `newton.py` 扩展、参数拟合 |
| `experiments/datastruct.py` | §15.8 | 并查集 / 二叉堆 / 环形缓冲 / LRU / CSR | `scene.py` 并查集、`Recorder` 环缓冲 |
| `experiments/ordering.py` | §15.8 / §32.4 | RCM / 最小度 / 嵌套剖分 + 符号填充 | `nodal._solve_sparse` 排序 |
| `experiments/kalman.py` | §15.3–15.4 | Kalman 滤波 + LQR/DARE | 数字孪生/控制器（拟新增） |
| `experiments/telemetry.py` | §33 | 量化→差分压缩→CRC 重传→事件时刻估计 | 探针遥测与阈值告警验证 |
| `experiments/observability.py` | §17 | 有限时域 Gramian、log-det D-optimal 贪心探针选择 | 探针布局与状态可观测性分析 |

## 验收测试（对应规范 §8）

| 测试 | 覆盖 | 判据 |
|---|---|---|
| `test_graph.py` | §2 / §9.4 | `ext` 插件隔离、连接器簇合并 |
| `test_contract.py` | §9 | schema 冻结、ExtNamespace 跨插件隔离、引擎/kind 注册拒绝 |
| `test_linalg.py` | §5.1 | LU/splu 残差 < 1e-9 |
| `test_newton.py` | §5.2 / P4 | 收敛、最终残差 < 1e-12、残差单调 |
| `test_integrate.py` | §5.3 / P2 / P7 | 后向欧拉 1 阶收敛、Verlet 能量守恒（保守可分离力、固定步长单实例） |
| `test_hybrid.py` | §4 / P6 | 零穿越定位误差 < 1e-6（连续横截单穿越实例；切线/多穿越不覆盖） |
| `test_mor.py` | §6 / P5 | 稳定最小连续 LTI 上 H∞ 误差 ≤ 2Σσ_{i>r}、POD 精确重构（单实例验证，非通用证明） |
| `test_dc_motor.py` | §10 / A5 / A6 | 空载/带载稳态解析对照（相对误差 < 1%） |
| `test_experiments.py` | §14 / V1–V11 | 12 passed：能量误差 8.6e-8、POD-量化界、BT H∞ 界、端到端 23.65× 压缩且误差 ≤ 界 |
| `test_creative.py` | §31.3 P1/P2/P3 | Woodbury 数值误差 1.37e-15（速度仅作观测）；DEIM 误差 0.227%、25× 少评估；事件定位 ~1e-14 |
| `test_optim.py` | §15.8 E1–E5 | Newton 一步、BFGS 35 次、LM 6 次、CG 22 次均达阈值 |
| `test_datastruct.py` | §15.8 E6–E8/E12 | 并查集分量一致、堆有序、环缓冲覆盖、LRU 淘汰、CSR matvec |
| `test_ordering.py` | §15.8 E9 / §32.4 | RCM/最小度/ND 填充均低于自然序；随机重标号后 RCM 降带宽 |
| `test_kalman.py` | §15.3–15.4 E10–E11 | 协方差对称 PSD、单种子归一化误差 <3σ（健全性检查，非统计覆盖）、LQR 闭环稳定、DARE 残差 <1e-8 |
| `test_telemetry.py` | §33 | 36 passed：固定区间量化界、连续插值界、预算逆解、延迟分离、有限 FIFO 假设、非法输入拒绝 |
| `test_observability.py` | §17 | 12 passed：Gramian PSD/秩、D-optimal 次模性、可用性加权代理、非法输入拒绝 |

## §14 实验报告摘要（2026-11-06）

- **试验台**：DC 电机（电气+机械+传动+负载）→ 4 状态 LTI；扭转频率 **1.7783 Hz**；稳态 `x_ss(12,0.5)=[3.4643, 205.357, 20.536, 0.1411]`。
- **关键验证**：能量守恒误差 `8.648e-8`；POD 前 3 奇异值 `[9549.44, 39.81, 2.2098, 0.2101]`；POD-量化总误差 `0.1730 ≤ 0.3068`；BT H∞ 实测 `8.437 ≤ 11.058`（稳定最小 LTI 单实例）；Anderson `4 vs 264` 次（66×）。
- **端到端**：POD(r=3)+10bit 量化+差分+zlib+CRC 传输，`2412 B → 102 B`（23.65×），归一化重构误差 `9.584e-4 ≤ 1.4775e-3`，重构后频谱峰 `1.990 Hz` vs 真值 `1.778 Hz`（误差 0.212 < 半格 0.249）。
- **复现**：`python -m pytest mathspec/tests -q` → 当前 **98 passed in 3.56 s**（2026-11-06 最近一次实测；耗时随机器负载变化；含 §14、§15、§31、§33 遥测验证与 §17 可观测性验证）。

## §15 架构扩展验证摘要（2026-11-06）

- **能力矩阵**：C1–C10（非因果连接器/状态估计/最优控制/参数辨识/UQ/协同仿真/事件溯源/稀疏排序/优化算法/数据结构）；C2/C3/C4/C8/C9/C10 已形式化+实测。
- **实现**：`experiments/optim.py`、`datastruct.py`、`ordering.py`、`kalman.py`；测试 `test_optim.py`、`test_datastruct.py`、`test_ordering.py`、`test_kalman.py`。
- **关键实测**：BFGS 35 次达到 $\|\nabla f\|_\infty\approx2.84\times10^{-11}$；GD 在 20000 次人为上限仍为 $1.11\times10^{-4}$（同实例、不同终止判据与预算，不构成收敛率结论）；LM 6 次恢复 `[2.5,1.3]`；CG 22 次残差 `9.78e-10`；并查集 200k 操作 `0.444s`；12×12 网格填充自然 1331 / RCM 946 / 最小度 618 / ND 992；Kalman 单种子归一化误差 `0.861<3`（健全性检查）；LQR 19 次、DARE 残差 `1.1e-13`。
- **总测试数**：`python -m pytest mathspec/tests -q` → **98 passed in 3.56 s**（2026-11-06 最近一次实测；耗时随机器负载变化）。

## 附录 B：NetLab 现状对码（file:line）

> 来自 2026-11-06 只读测绘；用于标识"规范要补什么"。

- **数据结构**：`scene.py:NodeRecord`(L68-102)、`EdgeRecord`(L105-152)——**当前无 `ext` 字段**（§9.4 前置改动：需新增 `ext: dict`）。
- **引擎**：`scene.py:_Engine`(L156-171)，`SignalEngine`(L174-509)、`CircuitEngine`(L511-859)；`MODES` 含 `vector` 但 `ensure_engine`(L899-901) else 回退 `SignalEngine`（**FEM 未接入场景**，`fem.py:418` 独立）。
- **求解内核**：`nodal.py:_newton_with_strategies`(L1775)/`_newton_solve`(L1897)/`_solve_matrix`(L1993)/`_solve_sparse`(L2079, splu 默认 COLAMD)；`graph.py:algebraic_cycles`(L482)/`solver_plan`(L533)；`fem.py:_assemble`(L210)/`_build_factorization`(L234)。
- **扩展约束**：`engine_registry.py:18-21` 强制拒绝覆盖 signal/circuit/vector（✅ 已强制）；`extensions.py:193-199` kind 必须 `user.` 前缀（✅）；`ARCHITECTURE.md:660-661` 规定 `ext[plugin_id]`（⚠ 未落 dataclass）。
- **能力缺口**（均为 `no`/`partial`）：acausal 连接器、index reduction、tearing、事件检测(零穿越)、MOR、并行 DAG 调度(partial)、溯源日志(no)。

## 与 netlab 的落地关系（规范 §11 里程碑）

- **M0–M1**：本包 `graph/linalg/integrate/newton/models` 已覆盖，测试绿即达 M1（DC 电机纵切闭环）。
- **M2–M4**：`hybrid.py`(事件)、`mor.py`(降阶) 已给骨架，需继续补 BDF/自适应、KLU 接入、MLD。
- **M5**：进 netlab 前必须先做 §9.4 的 `ext` 字段前置改动，并按 `engine_registry` 注册新 mode。

> 一句话：**先在 `mathspec/` 把数学跑通，再按 §9 硬约束进 netlab。**
