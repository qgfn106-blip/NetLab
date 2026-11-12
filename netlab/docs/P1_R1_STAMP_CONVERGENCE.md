# P1-R1 两端口 Laplacian Stamp 原语收敛与边界（阶段 5）

> **范围澄清（2026-11-12 复审）**：本阶段只统一 `stamps.stamp_laplacian` 两端口 Laplacian 盖章原语；**完整 `CircuitElement` 元件模型（Legacy 伴随 MNA vs Descriptor A+sE）未统一**。不得把本阶段表述为「元件 Stamp 单一化完成」。

> **状态：Proposed（设计冻结草案）** · 2026-11-12 · 阶段 5 / P1-R1
> 本文件回答 `CORE_ARCHITECTURE_V2_ROADMAP.md:40` 的「必答收敛方案」。
> 依 `CORE_ARCHITECTURE_V2_ROADMAP.md:54-66`，**设计评审通过前不实施
> formulation 级替换**。ADR 不是实施授权；本文件也不是。
> 依据 `PROJECT_OPTIMIZATION_EXECUTION_PLAN.md:63-67` §8 与 `:55-57` §9.3。

## 1. 必答结论

**目标口径**（ROADMAP:40）：以 `circuit/elements.py` 各元件 `stamp()` 为唯一
元件模型，`circuit/descriptor.py:445 _assemble_matrices()` 只承担矩阵布局与
后处理。

**本代码基线上的判定：该口径不能直接实施，且不应在本阶段实施。**

两条路径不是同一份盖章逻辑的两次拷贝，而是**两种不同的数学表述**：

| 维度 | `elements.py` Legacy MNA | `descriptor.py` 描述符 |
| --- | --- | --- |
| 方程形式 | `A x = rhs`（伴随模型） | `A x + sE x = B u` |
| 矩阵 | 单 `A`（复数允许）+ `rhs` | 双 `A` / `E`（`dtype=float`） |
| 未知量 | 仅非接地节点电压 | 节点电压 + 电感/电压源/VCVS 支路电流 |
| 电容 | `C/dt` 伴随电导 + 历史源电流；AC 下 `1j*omega*C` | `C` 写入 `E` 的拉普拉斯块 |
| 电感 | `dc` 用 `1e5` 短路电导、`ac` 用 `1/(1j*omega*L)`、瞬态用 `dt/L` | 增加独立支路电流行，`E[row,row] -= L` |
| 索引 | `StampContext.index`（`dict[str,int]`，纯节点） | `DescriptorIndex.node_index` + `branch_index` |

因此让 `_assemble_matrices()` 直接调用 `element.stamp(ctx)` 会同时改变未知量
集合、矩阵结构与频率相关性，必然产生数值回归；这属于被禁止的「无性能证据
的求解器重写」，并会触发 D-5 影子硬门。

**本阶段采纳的可达成收敛**：把两条路径中**逐字重复**的「两端口拉普拉斯
盖章原语」抽成唯一实现 `stamps.stamp_laplacian()`，四条调用点全部委托：

| 序号 | 位置 | 收敛后 |
| --- | --- | --- |
| 1 | `netlab/core/compute/circuit/stamps.py:75` `_stamp_conductance` | 委托 |
| 2 | `netlab/core/compute/circuit/descriptor.py:452` `_assemble_matrices` 内 `stamp_conductance` | 委托 |
| 3 | `netlab/core/compute/circuit/descriptor.py:470-480` 电容 `E` 块 | 委托 |
| 4 | `netlab/core/compute/circuit/descriptor.py:557` `_apply_operating_point` 内 `stamp_conductance` | 委托 |

四次 `+= / -=` 及其顺序、`float()` 转换位置、接地端跳过语义**逐字保持**，
故为零数值回归；`_stamp_conductance` 作为 P0 兼容入口保留。
由此「同一物理导纳/电容写入矩阵」这一动作全局只有一处定义。

## 2. 新增元件需改动的唯一位置（ROADMAP:40 第 2 问）

收敛后分两类，避免给出不真实的「单点」承诺：

* **两端口线性导纳/储能元件**（R、C、开关、二极管小信号电导等）：
  唯一改动位置是 `elements.py` 的 `stamp()`；`descriptor.py` 只需在
  `_assemble_matrices()` 的分派中新增一个 `elif kind == ...` 调用
  `stamp_laplacian(...)`，无需再写盖章循环。
* **需要支路电流未知量的元件**（独立电感/电压源/VCVS、运放）：仍需在
  `DescriptorIndex` 与 `_assemble_matrices()` 中显式声明支路行；这是数学
  表述差异，不是重复实现。

**仍待消除的重复**（登记为后续架构观察项，本阶段不处理）：
`elements.py` 与 `descriptor.py` 各自按 `kind` 分派一次。彻底合并需要
阶段 4 `CORE_MODEL_V2.md` 的 `ElementAdmittance` 声明层落地，而该层
为 Proposed 且含三项 `PENDING_USER_AUTHORIZATION` 决策（见第 6 节）。

## 3. 元件级与整机级对拍用例（ROADMAP:40 第 3 问）

`netlab/tests/test_stamp_unification.py`：

* 元件级：共享原语与收敛前内联体的逐元素对拍，覆盖 5 种索引/接地组合
  × 5 种权重（含复数 `1j*omega*C`）；`_stamp_conductance` 委托保真；
  `Resistor.stamp` 与共享原语对拍。
* 整机级：RC 低通 `frequency_response` 对拍解析解 `1/(1+j*omega*RC)`；
  `A` 矩阵电阻块、`E` 矩阵单端接地电容块、浮置电容 `E` 非对角 `-C` 三项
  结构断言。
* 单一来源：静态断言 `descriptor.py` 不再含内联拉普拉斯盖章体。

既有 `test_descriptor_rlc.py` / `test_ac_contract_m1.py` /
`test_descriptor_transfer_function.py` 作为回归网继续生效。

## 4. 迁移与兼容风险（ROADMAP:40 第 4 问）

| 编号 | 风险 | 处置 |
| --- | --- | --- |
| R1 | 共享原语误把 `float()` 移入函数，破坏 AC 复导纳 | 函数内不转换；`descriptor.py` 调用点保留 `float(...)`；复数路径有测试 |
| R2 | 接地端索引缺失导致越界 | 原语保留 `index.get()` + `None` 跳过；5 种组合有测试 |
| R3 | `nodal.py` 再导出未覆盖新函数 | `_stamp_conductance` 名称与签名不变，P0 调用方零改动 |
| R4 | D-5 影子硬门 | 改动位于 `netlab/core/compute/`，须生成指纹影子报告；数值路径未改，off/shadow/on 应逐元素一致 |
| R5 | formulation 级「唯一元件模型」被误认为已完成 | 本文件明确标注未完成与前置条件；不升格 ADR |
| R6 | 全量覆盖率回落 | 新增测试覆盖新分支；跑全量 pytest + core coverage 门 |

## 5. 稳定模块清单 / 新增领域改动清单（ROADMAP:43-47）

**稳定、本阶段不动**：`netlab/core/compute/circuit/solver.py`（canonical
AC/Bode，见 P1-R2 决策）、`nodal.py`、`analysis.py`、`graph.py`、`scene.py`
冻结区、`frontend/`、`PlotKit`、FEM、`MAX_NODES=400`、
`NETLAB_MATH_ACCEL` 默认 off。

**新增一个计算领域时的改动清单**（当前真实值，非目标态）：
`elements.py` 的元件类与 `stamp()` → `circuit_modules.py` 元件注册 →
`DescriptorIndex` 支路声明 → `_assemble_matrices()` 分派 →
`SUPPORTED_KINDS` → `SUPPORTED_NONLINEAR_KINDS` → 前端图形/参数面板 →
工程 JSON 序列化 → 测试。共 9 处；目标态由阶段 4 的 V2 设计收敛。

## 6. 需用户决策（不代替裁定）

沿用阶段 4 九份 Proposed 草案的三项 Open Question，状态仍为
`PENDING_USER_AUTHORIZATION`：

1. 项目保存是否允许携带显式 Runtime 快照。
2. Plugin 权限边界（可读/可写哪些层）。
3. 兼容窗口是否必须支持 v6 旧工程。

另有一项由本阶段发现、需审批会话/用户确认的架构问题：
**ROADMAP:40 的目标口径（descriptor 直接复用 `element.stamp()`）在本代码
基线上不可零回归实现**。若要求该口径，须先批准 formulation 级重写与
对应性能/影子证据，并返回设计评审；本阶段不自行扩权。

## 7. 验收与后续门

* 本阶段：零数值回归收敛 + 对拍用例 + 本方案文档，走 §9.3 九项验收。
  因本阶段触及数值内核，第 6 项「数值正确性」与第 7 项「性能基准」均按
  **适用**处理：数值侧以 D-5 影子报告（off/shadow/on 逐元素一致、独立
  参考解通过）与 `test_stamp_unification.py` 逐元素等价为证；性能侧以
  `tools/bench_stamp_unification.py` 的实测数据为证（不编造毫秒基准）。
  第 8 项须绑定最终精确 HEAD 的三条 CI。
* 后续门（**未经设计评审与明确批准不启动**）：`ElementAdmittance` 声明层、
  formulation 级替换、P1-R2 AC/Bode canonical 落地、阶段 6–13。
