# NetLab Core Architecture V2 · 需求与实现差距

> **状态：规划文档（目标口径，不是当前实现口径）**
> 依据：用户提供的《NetLab Core Architecture V2》786 行任务书（12 阶段；本地副本由会话转交，未入库）。
> 当前事实基线（2026-11-12 复审纠偏）：latest main `4dc7bdd815477b63d51f683edc3af3c2765ba72b`；tested_head `1df4934f7dec861aa96bdf813d688516696753ee`；最后生产代码提交 `e41160f300393889c1b9539ebab73ed5280f2796`；945 passed / 1 skipped、core 81.380784%；CI 证据（`4dc7bdd` 的 5 个 check-run 全 success）见 `PROJECT_STATUS.md`。阶段 3 历史基线（`b667e517...` / 909 / 81.404692%）仅作历史引用。
> **使用规则：本文描述的是目标；任何“已具备”的说法必须以当前代码和测试为准。目标能力与当前实现的差距见 §3。**

## 1. 总目标与核心原则

把 NetLab 从“节点网络式仿真工作台”逐步演进为：

- 以**节点网络**作为统一交互形式；
- 以**数学方程**作为物理描述基础；
- 以**专业求解器**作为计算后端；
- 以**插件**作为领域扩展机制；
- 能动态描述大多数真实物理场景的通用科学计算与物理建模平台。

核心原则（来自任务书，作为设计约束）：

1. 统一建模语义，不强制统一所有计算方式。
2. 区分物理拓扑、计算依赖、方程约束和场景组织。
3. 支持多变量、多方程、非因果物理连接。
4. 建立 Model / Compiled Model / Runtime 的清晰边界。
5. 各领域可拥有独立数据结构和数值求解器。
6. 以数学正确性、物理正确性和数值稳定性为基础要求。
7. 在正确性验证后再优化性能。
8. 插件提供领域能力，避免核心本体膨胀。
9. 优先演进现有架构；没有充分依据不得大规模推倒重写。

## 2. 十二阶段目标能力

| 阶段 | 目标能力 | 主要交付物（任务书口径） |
|---|---|---|
| 1 | 现有架构审计与问题定位 | `CORE_ARCHITECTURE_AUDIT.md`、模块依赖图、核心数据结构关系图、问题分级、改造顺序、迁移风险 |
| 2 | 统一网络模型 Core Model V2 | `CORE_MODEL_V2.md`、四类关系图、核心对象 UML/关系图、Python 类型接口草案、迁移方案 |
| 3 | Typed Port 与物理量/单位系统 | `TYPED_PORT_SYSTEM.md`、端口数据结构、单位/量纲检查、连接语义 |
| 4 | Equation / Constraint 数学模型系统 | `EQUATION_SYSTEM.md`、Equation/Constraint 接口、Variable Registry、全局方程装配 |
| 5 | Model Compiler | `MODEL_COMPILER.md`、Compiled Model、编译流程、增量编译、诊断、求解器选择 |
| 6 | Runtime 与 Execution Plan | `RUNTIME_ARCHITECTURE.md`、Model/Compiled/Runtime 三层、Execution Plan、Recorder 分离 |
| 7 | Plugin Architecture V2 | `PLUGIN_ARCHITECTURE_V2.md`、Domain/Component/PortType/EquationProvider/Solver 注册协议 |
| 8 | Scientific Validation Framework | `SCIENTIFIC_VALIDATION.md`、解析解/收敛/守恒/参考软件/Property-based 验证 |
| 9 | 性能优化与计算后端 | `PERFORMANCE_ARCHITECTURE.md`、性能剖析、稀疏/非线性/GPU 评估、回归门 |
| 10 | 机械动力学试验引擎 | 机械组件（Mass/Spring/Damper/Gear/Motor 等）、机械端口、`M q̈ + C q̇ + K q = F(t)`、验证案例 |
| 11 | 多物理场与空间分布模型 | Mesh/DOF/Field/BC/Material、通用 FEM 流程、多物理场耦合、场可视化 |
| 12 | 实施约束 | 先设计后实施、不重写稳定模块、不做过早抽象、控制每次修改范围、保持兼容与可测试性 |

### 2.1 P1 架构审计必答收敛项

P1 审计除模块/数据结构/依赖梳理外，必须对以下两条结构性冗余给出**收敛方案**（不能只记录问题）：

- **P1-R1 元件 Stamp 双轨**：`NetlabHome/netlab/core/compute/circuit/elements.py` 各元件 `stamp()` 与 `NetlabHome/netlab/core/compute/circuit/descriptor.py:445 _assemble_matrices()` 各写一遍元件 Stamp；新增元件需两处修改，且存在模型不一致风险。必答：统一到哪个元件模型、Descriptor 的矩阵布局/非线性线性化如何复用、迁移与兼容、对拍与回归测试。
- **P1-R2 AC/Bode 双后端**：`NetlabHome/netlab/core/compute/circuit/solver.py:969 ac_sweep()` 与 `NetlabHome/netlab/core/compute/circuit/descriptor.py:844 frequency_response()` 两套频率响应实现。必答：canonical 后端、兼容包装/删除策略、非奇异/奇异/病态/多端口等价性对拍、性能与误差阈值。

## 3. 当前实现与 V2 目标的差距（文档目标 vs 当前实现）

| V2 能力 | 当前实现证据 | 差距判断 |
|---|---|---|
| Core Model：物理拓扑 / 计算依赖 / 方程约束 / 场景四类图分离 | `NetlabHome/netlab/core/model/graph.py` 只有单一 `Node`（`:164`）、`Connection`（`:291`）、`Network`（`:362`）；`Node` 同时承担 `compute`/`handler`/`kind`/`params`/`state` 等职责；`NetlabHome/netlab/core/model/scene.py:83` 用 `mode=signal/circuit/vector` 选择引擎 | **核心差距**：物理拓扑与计算依赖未分离，四类图不存在 |
| Typed Port：domain / quantity_type / unit / direction / shape / connection_semantics | 只有 `Node.ports`、`source_port`/`target_port`、元件 pin 名称；`NetlabHome/netlab/plugin_api/v1/__init__.py` 的 `ElementSpec.pins` 也是普通字典 | **缺失**：无物理量、单位、量纲分析、因果/非因果连接语义 |
| Equation / Constraint 系统 | Signal 是节点函数式因果传播；Circuit 是 MNA 专用 stamp；`NetlabHome/netlab/core/compute/circuit/descriptor_analysis.py` 只是电路域描述符分析 | **缺失**：无通用 Equation/Variable/Constraint 注册与 DAE 装配 |
| Model Compiler | 无独立编译层；`Scene.ensure_engine()` 在模型变化时重建引擎；`SolverPlan` 只是图阶段执行计划 | **缺失**：无 Compiled Model、增量编译、缓存失效规则、编译诊断 |
| Runtime 三层隔离 | `NetlabHome/netlab/core/compute/simulation.py` 已有 `Simulation`、线程、Recorder、事务回滚；但 Model/Compiled Model/Runtime 未分离，模型对象与运行时状态共享可变 dict | **部分基础**：运行时有能力，三层边界未建立 |
| Plugin V2 | `NetlabHome/netlab/plugin_api/v1/__init__.py:187-211` 仅 `register_compute/method/element/analysis/data_format/panel/visual/engine/template`；`NetlabHome/netlab/core/model/engine_registry.py` 禁止替换 signal/circuit/vector | **部分具备但边界偏窄**：无 Domain/PortType/EquationProvider/Solver 注册 |
| Scientific Validation | `netlab/tests/evals` 有解析/收敛/不变量/病态用例；`netlab/tests/benchmarks` 有数值基准 | **部分**：无 `hypothesis` Property-based、无 ngspice 参考对拍、无机械/热学守恒 |
| 性能与计算后端 | 有既有 bench / 数值基准；无装配/分解/回代拆分、无 GPU 可行性、无性能回归门 | **部分/未系统化** |
| 机械动力学 | 没有 Mass/Spring/Damper/Gear/Motor 等组件和机械端口 | **缺失** |
| 多物理场 / 空间分布 | `NetlabHome/netlab/core/compute/fem.py` 是固定单位正方形 Q4 热传导演示 | **缺失**：无通用 Mesh/DOF/Field/BC/Material 抽象 |

**任务书要求的 V2 交付文档当前均未建立**：`CORE_ARCHITECTURE_AUDIT.md`、`CORE_MODEL_V2.md`、`TYPED_PORT_SYSTEM.md`、`EQUATION_SYSTEM.md`、`MODEL_COMPILER.md`、`RUNTIME_ARCHITECTURE.md`、`PLUGIN_ARCHITECTURE_V2.md`、`SCIENTIFIC_VALIDATION.md`、`PERFORMANCE_ARCHITECTURE.md`、`MECHANICAL_ENGINE.md`、`MULTIPHYSICS.md`。

## 4. 范围与不做事项

- 不重写稳定的 `graph.py`、`circuit/solver.py`、`analysis.py`、工程管理、Recorder、PlotKit 接入；优先适配器与版本化接口。
- 不把行业专用 engine 的内部结构强行提升为 Core API；Signal/Circuit/Mechanical/FEM 可保留各自内部模型。
- 不提前建立没有真实使用场景的抽象；只在两个以上真实领域共同需要时提升为 Core API。
-  Mechanical/Multiphysics 属于验证性扩展，不先于 Core Model、Typed Port、Equation/Compiler 的实现。
- 本文与任务书冲突时，以用户确认的最新任务书/评审结论为准；本文与代码冲突时，以当前代码和测试为准，并立即修正本文。

## 5. 相关文档

- 执行路线图：[CORE_ARCHITECTURE_V2_ROADMAP.md](CORE_ARCHITECTURE_V2_ROADMAP.md)
- 现有架构：[ARCHITECTURE.md](ARCHITECTURE.md)、[CODE_GUIDE.md](CODE_GUIDE.md)
- 需求与决策：[REQUIREMENTS_AND_RULES.md](REQUIREMENTS_AND_RULES.md)
- 进度：[PROGRESS.md](PROGRESS.md)、[BACKLOG.md](BACKLOG.md)