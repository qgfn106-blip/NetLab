# NetLab V2 架构规划审查与完善

- **文档状态**：规划审查提案（Phase 1 只读审计 + Phase 2 规划修订提案）；**2026-11-11 用户已对七项待决作出正式裁决，本文件按裁决更新；未验证项仍为 Proposed，不是已冻结架构**
- **日期**：2026-11-11
- **审查方式**：只读检查实际 Git / 代码 / 文档 / P1 审计 / status；未改源码、未跑新测试、未提交、未 push
- **审查对象**：`CORE_ARCHITECTURE_V2.md`、`CORE_ARCHITECTURE_V2_ROADMAP.md`、`CORE_ARCHITECTURE_AUDIT.md`、`BACKLOG.md`、相关代码与现有 V2 文档

> 本文件为规划审查建议与依据；正式决策见 `docs/PROJECT_STATUS.md` 与 `docs/adr/`。本文不把任何未决定/未验证事项写成已冻结事实。

## 0. 事实基线（已核实）

| 项 | 核实结果 | 来源 |
|---|---|---|
| 仓库 HEAD | `eb27dedc15a3f2fa061310cb5f5b33cf521f039b` | `git rev-parse HEAD` |
| origin/main | 与 HEAD 相同，`ahead 0 / behind 0` | `git rev-list --left-right --count origin/main...main` |
| 工作树 | 仅 `?? netlab/docs/CORE_ARCHITECTURE_AUDIT.md` | `git status --short` |
| 审计报告 | `NetlabHome/netlab/docs/CORE_ARCHITECTURE_AUDIT.md`，448 行 / 41,804 字节 | 文件系统 |
| status.json | 生成 `2026-11-11T13:28:51+08:00`；代码 head `e56d443`；881 passed / 1 skipped / 0 failed；core line 81.31%；dirty=false；ahead_origin=0 | `netlab/docs/status.json` |
| 最新代码提交 | `e56d443 fix(e2e): 原理图导出改用路由拦截校验入口`；之后的 `eb27ded` 是 status-only 提交 | `git log` |
| 审计记录 CI | python-tests `42966071451`、container `42966071512`、frontend-ts-build `42966071459` 三绿 | `CORE_ARCHITECTURE_AUDIT.md:6-8` |

**口径修正（重要）**：
- 审查时（2026-11-11 用户裁决前）`CORE_ARCHITECTURE_V2.md:5` 仍写旧基线 `8e6ed22` / 872 / 81.11；`CORE_ARCHITECTURE_V2_ROADMAP.md:3` 仍写“P1 架构审计待启动”。这两处已按裁决小范围更新，旧值保留为历史说明。
- `BACKLOG.md:26` 也原写“P1 架构审计待启动”；已按裁决更新并保留历史原文。
- 本报告中的“V2 P3”指 ROADMAP 的 P3 Equation/Compiler；`BACKLOG.md:27` 的“Phase 3 架构债”是旧待授权桶，两者不是同一概念。

## 1. 核心结论（先看这 8 条）

1. **原阶段骨架方向正确**：先审计、再设计、再演进；P1-R1/R2 确实是最高杠杆的收敛点（`AUDIT:36-38`）。
2. **P1-A 当前设计冻结太薄**：只有 `CORE_MODEL_V2.md`、`TYPED_PORT_SYSTEM.md`、`ENGINE_SPI_V2.md`，缺少边界、对象关系、Engine 生命周期、接口契约、迁移原则、最小可运行示例——不足以约束后续 Agent。
3. **P2 一次包得太大**：NodeDesc/NodeRuntime、Edge 三型、Typed Port、兼容层同时做，风险集中；建议拆 P2-A/B/C/D，但按真实依赖，不机械切成四段。
4. **P3 不能等同 DAG + 编译器**：必须明确 Model Representation / Structural Analysis / Equation Assembly / Numerical Backend / Execution Plan 五层；DAG 只是 Execution Plan 的一种。
5. **P5 Control Flow 必须独立预留**：代数环/反馈连接/一般程序循环不是同一件事；不在 P3 方程层硬塞 Control Flow。
6. **P-B 与 P2 的冲突是真实的但可控**：当前外观存放在持久化 `NodeRecord/EdgeRecord.appearance`，不在运行时 `Node/Connection` 上；P2 拆记录时必须把外观迁到 Presentation 层，不能迁到 NodeRuntime。
7. **工程管理缺口是当前最大返工来源**：没有单一 `PROJECT_STATUS.md`、没有 ADR、没有分阶段退出标准；文档各自维护状态会继续漂移。
8. **长期定位建议**：有类型节点 + 数学方程/物理约束 + 动态运行时 + 可插拔 Engine 的科学计算与物理建模平台；不做“图灵完备优先”的通用图计算平台。

---

## 2. P1：P-B 与 P1-A 的架构冲突审查

### 2.1 现状证据

| 事实 | 证据 |
|---|---|
| 元素级外观已落在持久化记录上 | `netlab/core/model/records.py:14-50`：`NodeRecord.appearance: dict`，`:26-27` 注释写明 P-B；`:45-46` 非空才序列化；`EdgeRecord` 同样有 `appearance`（`records.py:53-105`） |
| 编辑接口已接受 appearance | `netlab/core/model/scene_edit.py:103-107`：`update_node` 的 allowed 字段包含 `appearance`；`update_edge` 在 `:338` 同样处理 |
| P-B v1 范围与缺口 | `APPEARANCE_ENGINE_DESIGN.md:103-110`：v1 只支持节点/连线 `color/opacity/lineWidth/fontSize`；端口/选中 tick 等子元素、多选批量、自定义色对比度护栏、独立撤销均未做 |
| 运行时不持有外观 | 外观在 `NodeRecord/EdgeRecord`（工程数据层）；`graph.py:164-288` 的运行时 `Node`/`Connection` 字段不含 appearance（`graph.py:164` Node；`Connection` 在 `:291`） |
| 单记录编辑、未见批量事务 | `scene_edit.py:103` `update_node`、`:338` `update_edge` 都是单条记录更新；未发现统一 batch/undo API（本轮只读检索） |

### 2.2 六个问题的结论

1. **外观是否直接绑定运行时对象？**
   - 当前**不是**：外观在 `NodeRecord/EdgeRecord`，不是 `Node/Connection`。这是好事，P-B 不需要触碰运行时。
   - 但它和**持久化记录形状**绑定；P2 拆记录时必须显式迁移。

2. **外观未来属于 Scene / View / Presentation 哪一层？**
   - 建议：**Presentation 层**，持久化为 `NodeDesc.presentation` / `EdgeDesc.presentation`（或 `SceneDoc.presentation`），运行时不可见。
   - 禁止进入 `NodeRuntime` / `ConnectionRuntime`；禁止参与物理编译与数值计算。

3. **选中、高亮、悬停是否要与持久化外观分离？**
   - 必须分离：选中/悬停/高亮是**瞬时 UI 状态**，只保存在前端，不写项目文件；持久化外观是用户意图，写 SceneDoc。
   - 不能把 `selected` 混进 `appearance`；否则切换选择会污染项目数据。

4. **多选批量修改是否要统一事务？**
   - 建议：**是**。新增 `SceneEdit.apply_appearance_batch(ids, patch)`，一次校验、一次 `_touch()`、一次变更事件；前端不要循环 N 次逐条 HTTP。
   - 独立撤销建议用**命令式历史/SceneTxn**（可记录前后 diff），不要为 Appearance 单独造第二套 undo 栈。

5. **外观修改是否可能触发物理模型重新编译？**
   - 必须保证**不触发**。外观只影响渲染/布局；建议把 appearance 从 `compile_cache_key`、payload hash、仿真输入中排除；P2 迁移后同样如此。
   - 如果当前没有编译缓存，也要在 P1-A 接口中写死这条边界，防止未来 P2 实现时误把 presentation 混进 Model。

6. **P2 模型拆分后如何迁移？**
   - 迁移路径：`NodeRecord.appearance` → `NodeDesc.presentation`（一次性 schema 迁移，默认空）；`EdgeRecord.appearance` → `EdgeDesc.presentation`。
   - 旧项目兼容：缺失 presentation 时默认空，视觉零变化；迁移不改变外部 JSON 字段名（或提供 v6→v7 adapter，见 P1-S1）。
   - `NodeRuntime`/`ConnectionRuntime` 永远不持久化、不读取 appearance。

### 2.3 P1 结论与分类

- **必须改**
  - 在 P1-A 增加 `PRESENTATION_LAYER` 边界（可并入 `ARCHITECTURE_BOUNDARIES.md`）：明确 appearance 属 Presentation、不得进 Runtime、不得进编译键。
  - P-B 完整版的批量修改必须走 `SceneEdit` 事务；多选不能是 N 次逐条更新。
  - P-B 完整版必须给出“外观变更不触发编译/不改变数值”的测试或断言。
- **建议改**
  - 在 P-B 内部做外观归属检查，作为 P-B 的设计输入；正式 ADR-005 留到 P1-A 阶段，不得提前启动 P1-A。
  - 增加对比度护栏作为 appearance 校验器；前端提供“恢复默认”与逐属性清除。
- **暂不改**
  - 不提前做 P2 的 NodeDesc/Runtime 拆分；P-B v1 可继续使用现有记录字段。
  - 不为外观单独实现一套通用主题/动画引擎。
- **需用户决策**
  - 外观是存项目文件（SceneDoc）还是独立 view 文件（便于以后协作/多视图）；默认建议存 SceneDoc。
  - 未来是否支持多用户各自视图（当前无协作需求，建议暂不支持）。

---

## 3. P2：P1-A 架构设计冻结完善

### 3.1 现有三份文档不够

原计划：`CORE_MODEL_V2.md`、`TYPED_PORT_SYSTEM.md`、`ENGINE_SPI_V2.md`。

建议增加 6 份（可合并为章，但内容必须存在）：

| 新增文档/章节 | 必须回答的问题 |
|---|---|
| `ARCHITECTURE_BOUNDARIES.md` | Model / Compiled Model / Runtime / Presentation / UI / Plugin 的层边界与依赖方向；哪些层可以互相 import |
| `CORE_OBJECT_RELATIONSHIP.md` | NodeDesc/NodeRuntime、EdgeDesc/ConnectionRuntime、Scene/Project/Block 的对象关系图与所有权 |
| `ENGINE_LIFECYCLE.md` | create → validate → compile → run → snapshot → restore → destroy；谁创建/销毁 Runtime |
| `CORE_INTERFACE_CONTRACTS.md` | Python Protocol/ABC 的精确方法签名、参数、返回、异常；不是概念描述 |
| `MIGRATION_AND_COMPATIBILITY.md` | 旧 `NodeRecord/EdgeRecord`、project v6/v7、字段改名、兼容窗口与回滚 |
| `MINIMAL_DATA_MODEL_EXAMPLE.md` | 一个最小领域（2 节点 + 1 边）的完整 JSON、内存对象、编译产物、运行结果样例 |

### 3.2 Description vs Runtime（必须明确）

1. **Description 是否允许运行期修改？**
   - 默认不允许直接修改；只能经 `SceneEdit` 事务修改，修改后生成新版本/脏标记。
2. **Runtime 是否允许反向修改 Description？**
   - 不允许；运行时只读 Description 快照。运行时状态只存在 Runtime。
3. **Runtime 是否拥有独立生命周期？**
   - 拥有：由 Engine 创建/销毁；可独立 reset/snapshot/restore，不改变 Description。
4. **项目保存是否包含运行时状态？**
   - 默认**不包含**；只保存 Description + 可选显式快照（用户主动导出/断点）。不能让每次保存夹带运行态。
5. **快照与恢复由谁负责？**
   - 由 Engine/RuntimeManager 负责；Node/Connection 不负责跨对象快照；提供 `snapshot()/restore()` 的 Engine 接口。

### 3.3 Engine（必须明确）

1. Engine 负责 Runtime 创建和销毁（通过 `EngineSpec` 工厂）。
2. 用 `EngineSpec.supported_node_kinds / supported_edge_kinds / supported_port_types` 声明能力；禁止散落 if-mode。
3. 生命周期：`validate(desc) -> CompiledModel`、`create_runtime(compiled)`、`snapshot/restore`、`dispose`。
4. Plugin **不得直接访问底层 Runtime**；只能通过 Engine 的公共接口/Port 读写，权限由 facade 控制。
5. Engine 与 Plugin 边界：Engine 负责执行语义与数值；Plugin 负责注册领域 kind/算法/数据格式/声明式 UI；Plugin 不能替换内建 Engine（符合现有 `rules 0mw3r51t5`）。

### 3.4 Typed Port（必须明确）

1. 类型表达：`PortType {domain, quantity, unit, dimension, direction, cardinality, shape}`；物理量用 unit/dimension 表，数据结构用 shape/dtype。
2. 检查时机：连接创建时做快速静态检查；编译时做完整类型/单位检查；运行时仅 debug 模式做断言。
3. 单位换算：单独 `UnitRegistry`，显式换算/兼容矩阵；禁止隐式跨维度转换。
4. 多输入/多输出：`Port` 支持 `cardinality: one|many` 与命名端口；连接语义明确 fan-in/fan-out。
5. 自定义领域类型：通过 Plugin 注册 `PortType`，核心只认接口，不硬编码领域类型。

### 3.5 P1-A 分类

- **必须改**：补足 6 份文档/章节；给出可执行 Python Protocol 签名；明确 Description/Runtime 五问、Engine 五问、Typed Port 五问。
- **建议改**：先写 `MINIMAL_DATA_MODEL_EXAMPLE.md` 再写实现；ADR-001..006 与设计文档同批提案。
- **暂不改**：不写任何生产代码；不改 `graph.py/scene.py` 冻结区；不迁移旧项目。
- **需用户决策**：项目保存是否允许显式 Runtime 快照；Plugin 的权限边界（只读/可写哪些层）；兼容窗口是否必须支持 v6 旧项目。

---

## 4. P2：Core Model V2 的实施粒度评估

### 4.1 原 P2 包太大

原 P2 同时包含：NodeDesc/NodeRuntime、EdgeDesc/ConnectionRuntime、DependencyEdge/PhysicalEdge/LayoutEdge、Typed Port、兼容层。四类变更互相耦合，一次完成风险高、回滚困难。

### 4.2 建议拆分（按真实依赖，不机械切）

| 子阶段 | 范围 | 依赖 | 建议试点 | 独立验收 |
|---|---|---|---|---|
| **P2-A NodeDesc/NodeRuntime** | 节点描述与运行时分离；NodeDesc 不含运行态 | P1-A 接口冻结 | `sum`（无状态计算）+ `integrator`（有状态动态） | 旧节点行为不变；serialize/roundtrip；state snapshot/restore；单步数值一致 |
| **P2-B Typed Port** | PortType、单位/量纲、连接检查 | P2-A（NodeDesc/Port 接口） | 标量（电压/温度）+ 向量（2×2 matrix） | 类型不匹配拒绝；单位换算正确；多输入/输出；旧连接兼容 |
| **P2-C Edge 三型** | DependencyEdge / PhysicalEdge / LayoutEdge 分离 | P2-A、P2-B | 电路 R/C 物理边 + 一条布局边 + 一条依赖边 | 拓扑遍历/编译/布局分别正确；旧图 roundtrip |
| **P2-D 兼容层** | 旧 NodeRecord/Connection 适配，v6/v7 | A/B/C | 旧项目样本 | 旧项目加载、外部 JSON 不变、回滚可用 |

**结论**：不建议把 P2 强行拆成 4 个完全独立阶段；建议 **P2-A → P2-B → P2-C → P2-D** 的依赖顺序，其中 B 可在 A 的 Port 接口冻结后并行设计，C 必须等 A/B 接口稳定，D 最后做。

### 4.3 分类

- **必须改**：把 P2 拆为 A/B/C/D，写入各自退出条件；先做 P2-A 试点，不允许一次全做。
- **建议改**：用 `sum + integrator` 做 Node 试点；用 R/C 与 2×2 vector 做 Port 试点；先在内部 API 兼容，再谈外部 JSON。
- **暂不改**：不在 P2 改外部 JSON 格式；不重写全部节点；不迁移全部旧项目。
- **需用户决策**：P2-D 兼容窗口要支持多少个旧版本；是否接受 P2 期间两套模型并存。

---

## 5. P3：Equation + Model Compiler 的边界

### 5.1 必须区分五层

| 层 | 职责 | 不做什么 |
|---|---|---|
| **Model Representation** | 变量、方程、约束、边界/初始条件、物理连接的因果语义 | 不绑定具体求解器、不生成 DAG |
| **Structural Analysis** | 变量-方程二部图、匹配、DOF、索引约简、代数环检测 | 不负责数值求解 |
| **Equation Assembly** | 残差/雅可比/质量矩阵装配；元件贡献接口 | 不决定求解顺序、不调用具体 solver |
| **Numerical Backend** | 线性/非线性求解器、积分器、稀疏后端 | 不感知模型语义/UI |
| **Execution Plan** | 求值顺序、分区、步进/事件策略、Recorder | 不把 DAG 当唯一表示 |

### 5.2 模型类型差异（必须在设计文档中列表）

- 代数方程：`F(x,u,t)=0`（电阻网络、约束）
- ODE：`dx/dt=f(x,u,t)`（状态动态）
- DAE：`F(x,dx/dt,u,t)=0`（电路动态、机械 index-3）
- 机械：`M(q)q'' + C(q,q') + K(q) = F`
- PDE：`ρc_p ∂T/∂t = ∇·(k∇T) + Q`（FEM；**不改现有 FEM**，但模型表达层不能阻断未来）

### 5.3 明确禁止事项

- 不把一切强行转 DAG；
- 不把物理连接等同方程依赖；
- 不在 Model 表达层绑定具体求解器；
- 不在 P3 未设计清楚前大规模改求解器。

### 5.4 最小原型建议

先做一个**电路模型（现有 MNA）+ 一个机械 2-DOF 质量-弹簧-阻尼模型**的最小垂直切片：
验证变量/方程/约束表达、装配、最小求解。不要等全部领域建模完成才验证。

### 5.5 分类

- **必须改**：新增 `EQUATION_SYSTEM.md` / `MODEL_COMPILER.md` 时先写五层边界；P3 验收必须覆盖至少两种模型类型。
- **建议改**：先做最小原型；为 `EquationProvider` 定义核心 Protocol；把求解器选择留给 Numerical Backend。
- **暂不改**：不改 FEM；不重写现有 MNA/Descriptor；不追求完整 Modelica 级语言。
- **需用户决策**：P3 是研究原型还是生产编译器；机械模型是否作为首个业务试点；是否接受只先支持电路 + 机械两类。

---

## 6. P4：Runtime + Plugin V2 审查

- Runtime 三层：Model（Description）/ Compiled Model / Runtime；三者不可混用；Runtime 不反向改 Description。
- Plugin V2 注册：Domain / Component / PortType / EquationProvider / Solver；项目级隔离，不写进程全局 registry（AUDIT:24 / H4）。
- Engine 生命周期接口是 P1-A 的产物；P4 只实现，不重新定义。
- Plugin 不得直接访问 Runtime 内部；通过 Engine 公共 API 和 Port；权限/能力由 `EngineSpec` 声明并由 facade 校验。
- 验收：插件可以端到端加载一个自定义 mode（B2 的回归）；卸载后无全局残留；两个项目互不影响；旧内建 mode 不受影响。

**分类**：必须改 = 项目级隔离与 Engine 能力消费；建议改 = 插件 capability 清单；暂不改 = 不做沙箱级安全隔离；需用户决策 = 插件是否允许注册自定义 solver 后端。

---

## 7. P5：Control Flow / State Machine 预留

### 7.1 四类语义必须分开

1. **静态计算依赖**：数据从 A 到 B。
2. **数学方程求解**：代数/ODE/DAE 的联立求解。
3. **动态系统状态更新**：状态变量按时间步更新。
4. **通用程序控制流**：条件分支、循环、事件、状态机。

代数环/反馈连接不是一般程序循环；不要把三者混成一个“loop”。

### 7.2 架构预留建议

- 建议独立 `ControlFlow / StateMachine` 方向，不塞进 Equation DAG。
- 预留接口：事件总线（时间/阈值/外部事件）、StateMachineRuntime、Scheduler、执行策略（同步/事件驱动）。
- 典型场景：电机启停/过流保护、PWM、开关状态、机械状态转换、复杂事件处理。
- 本阶段**只做架构预留**，不实现通用编程语言、不追求图灵完备。

### 7.3 分类

- **必须改**：P5 在 ROADMAP 中独立成项；P1-A 的边界文档预留 ControlFlow 接口；P3 不吸收 Control Flow。
- **建议改**：先定义事件/状态机最小契约；明确事件时间语义（同步步进 vs 异步事件）。
- **暂不改**：不实现完整状态机语言；不做通用脚本引擎。
- **需用户决策**：Control Flow 优先于机械/多物理场，还是后置；确定性执行 vs 事件驱动执行。

---

## 8. 长期架构定位

建议定位为：**基于有类型节点、数学方程、物理约束和动态运行时的通用科学计算与物理建模平台**。

| 类型 | 是否进核心 | 说明 |
|---|---|---|
| 通用图计算平台 | 部分 | 图执行、拓扑、调度是基础设施，但不是产品目标 |
| 科学计算平台 | 核心 | 变量/方程/约束/数值后端/验证 |
| 物理仿真平台 | 核心能力 + 插件 | 电路、机械、热；FEM 继续独立不动 |
| 可编程动态系统仿真平台 | 预留 | Control Flow/State Machine 独立演进 |

原则：不为了图灵完备牺牲数学表达、数值稳定性、物理约束正确性；核心保持小而稳，领域能力放 Engine/Plugin。

---

## 9. 工程管理机制提案

### 9.1 `docs/PROJECT_STATUS.md`（提案，未创建）

用途：**唯一当前事实源**；`ROADMAP` 管未来、`BACKLOG` 管待办、`ARCHITECTURE` 管设计、`ADR` 管已决事项；不重复维护同一动态状态。

建议字段：

```yaml
generated_at: 2026-11-11T...
head: eb27ded...
branch: main
origin_sync: {ahead: 0, behind: 0}
worktree_dirty: false
current_mainline: "P-B 元素级视图外观（R40）"
completed: ["P1 架构审计", "阶段 B P1/P2"]
in_progress: []
next_allowed_task: "P-B 元素级视图外观完整版（含内部外观归属检查）"
blockers: []
authorization:
  push: "allowed-by-standing-rule?"
  phase3: "PENDING_USER_AUTHORIZATION"
  phase4_ci: "PENDING_USER_AUTHORIZATION"
  scale_500_plus: "REJECTED"
last_ci: {head_sha: "e56d443...", runs: ["42966071451","42966071512","42966071459"], conclusion: "success"}
doc_conflicts: ["CORE_ARCHITECTURE_V2.md:5 旧基线", "ROADMAP:3 P1 待启动"]
```

规则：由生成脚本/用户更新；其他文档只引用不复制；`PROJECT_STATUS` 中的 `generated_at/head` 必须由 `tools/gen_status.py` 或人工显式刷新。

### 9.2 `docs/adr/` ADR 方案（提案，未创建）

建立 `docs/adr/`，ADR 模板字段：背景/问题/候选方案/最终决定/选择原因/放弃其他方案原因/对现有代码影响/兼容性影响/风险/重新评估触发条件。

建议首批（**只有用户批准后才标 Accepted**）：

- ADR-001 Description/Runtime 分离
- ADR-002 Edge 三型语义分离
- ADR-003 Typed Port 类型检查策略
- ADR-004 Engine 生命周期接口
- ADR-005 Project DTO 与 Scene 分层
- ADR-006 Equation 与 Numerical Backend 分离
- ADR-007 Control Flow 与计算依赖分离

每份状态只允许：`Proposed`（提案）/ `Accepted`（用户批准）/ `Superseded`（被替代）；未批准不得写成 `Accepted`。

### 9.3 阶段验收标准（提案）

| 阶段 | 功能验收 | 测试/证据 | 兼容/回滚 | 退出条件 |
|---|---|---|---|---|
| **P-B** | 元素级外观：子元素属性、选中 tick、多选批量、对比度护栏、独立撤销 | tsc/build/nodecheck；单测 + GUI e2e；视觉基线（结构断言） | 旧项目默认视觉不变；appearance 缺省兼容 | 功能全过 + 无编译/数值影响 + 可回滚 |
| **P1-A** | 6 份设计文档齐全；Protocol 签名可 type-check；最小样例可走通 | 文档审查 + mypy/pyright（如可用）+ schema 示例 | 不改生产代码 | 设计评审通过，ADR-001..006 Proposed/Accepted |
| **P1-R1** | 元件 Stamp 单源；`descriptor.py` 不再重写线性元件 | RC/RLC/二极管/运放/BJT/MOSFET A/E 对拍；差异≤容差 | 旧 AC/DC 输出不变或只改善 | 重复分支删除 + 全量 pytest + 回滚开关 |
| **P1-R2** | AC/Bode canonical 统一 | 线性/非线性/奇异 E/多端口 parity matrix；shadow 对比 | 旧结果不变；可切回旧后端 | shadow 无差异阈值 + 默认切换 + 回滚 |
| **P1-S1** | Project/DTO 分层，schema registry | v6/v7 迁移；golden fixtures；roundtrip | 外部 JSON 不变；旧项目可开 | 迁移测试 + 校验一致 |
| **P1-S2** | Engine SPI v2，插件 mode 端到端 | 自定义 mode 加载/卸载；旧 mode 回归 | 旧插件不破坏 | 引擎能力消费 + 无硬编码 mode |
| **P1-S3** | 前端拆分/API 边界统一 | typecheck + UI tests + e2e | 旧 UI 操作不变 | 无重复请求体/无行为回归 |
| **P2-A/B/C/D** | 各自见 §4.2 | 各子阶段独立测试 | 旧项目兼容 | 每个子阶段独立验收后才进下一步 |
| **P3** | 五层边界 + 最小原型（电路 + 机械） | 方程/装配/求解测试；至少两类模型 | 不改现有 solver/FEM | 原型可复现 + 边界评审 |
| **P4** | Runtime 三层 + Plugin 隔离 | 插件生命周期/权限/项目隔离测试 | 旧 engine 兼容 | 插件端到端 + 无全局污染 |
| **P5** | ControlFlow 预留（非实现） | 接口/事件语义文档 | 不改变现有执行 | 文档与最小事件原型评审 |

所有阶段统一检查：功能、单测、集成、兼容、数值正确性、性能/复杂度、CI、回滚方案、未解决问题清单。

---

## 10. 严格执行顺序（最高约束）

**用户 2026-11-11 正式裁决顺序（阶段 0–13，覆盖此前一切建议）：**

`阶段0 项目事实与文档基线 → 阶段1 P1-A-lite → 阶段2 P-B 完整版 → 阶段3 R40 收尾 → 阶段4 P1-A 全量设计冻结 → 阶段5 P1-R1 Stamp 统一 → 阶段6 P1-R2 AC/Bode 统一 → 阶段7 P1-S1 Project/DTO → 阶段8 P1-S2 Engine SPI v2 → 阶段9 P1-S3 前端拆分 → 阶段10 P2 Core Model V2 → 阶段11 P3 Equation+Compiler → 阶段12 P4 Runtime+Plugin V2 → 阶段13 P5 Validation/机械/多物理场/Control Flow`

- 后续任何审查、规划或开发必须严格执行该顺序；**不得打乱顺序、跳步、并行越级启动未授权阶段**。
- 每个阶段必须通过本报告 §9.3 的九项退出条件，才能进入下一阶段；未获用户明确批准，不得启动下一阶段，只允许对后续阶段做只读了解。
- **阶段 1 P1-A-lite 只处理 P-B 必须依赖的外观架构边界（Appearance 属 Presentation 层），交付 ADR-005-lite；不得误认为 P1-A 全量完成。**
- **阶段 2 P-B 完整版**：端口等子元素独立外观、选中 tick 等子元素外观、多选批量修改、自定义颜色对比度护栏、独立撤销（复用命令历史/SceneEdit/SceneTxn）、外观保存加载、外观变化不触发物理重编译；完成后再做阶段 3 R40 收尾。
- 阶段 4 P1-A 全量设计冻结；P1-R1→P1-R2→P1-S1→P1-S2→P1-S3 逐项进行；P2 内部按 §4.2 的 P2-A→P2-B→P2-C→P2-D（按真实依赖调整，不机械拆）；P3 先电路后机械；P2 完成后才可进入 P3；P3→P4→P5 依次进行。
- R25 暂停；R43 M2 仅 opt-in；R19 暂停；Phase 3 架构债 / Phase 4 CI / 500+ 仍 `PENDING_USER_AUTHORIZATION`，不得借本规划启动。
- 任何阶段如需提前改下一阶段的接口/文档，只能作为当前阶段的“设计输入”，不得把下一阶段标记为“进行中”或产生其正式交付物。

---

## 11. 四类标注汇总

### 必须改（不改会直接导致返工/错误架构）

1. P1-A 补 6 份设计文档/章节，并给出可执行 Protocol（§3）。
2. 在 P1-A 边界中写死 **appearance 属 Presentation、不进 Runtime、不进编译键**（§2）。
3. P-B 批量修改走 SceneEdit 事务；多选不得 N 次逐条更新（§2）。
4. P2 拆 P2-A/B/C/D 并定义各子阶段退出条件（§4）。
5. P3 建立五层边界；禁止“一切转 DAG / 模型绑定求解器”（§5）。
6. P5 Control Flow 独立预留，不并入方程 DAG（§7）。
7. 已新增 `PROJECT_STATUS.md` 作为唯一当前状态源；已新增 `docs/adr/ADR-001..007`（ADR-005-lite Accepted，其余 Proposed）。
8. 已修正 `CORE_ARCHITECTURE_V2.md:5`、`CORE_ARCHITECTURE_V2_ROADMAP.md:3`、`BACKLOG.md:26` 的旧状态口径（2026-11-11 完成，历史保留）。
9. **所有阶段严格执行 §10 的正式顺序 `阶段0 → 阶段1 P1-A-lite → 阶段2 P-B → 阶段3 R40 → 阶段4 P1-A 全量 → 阶段5 P1-R1 → 阶段6 P1-R2 → 阶段7 P1-S1 → 阶段8 P1-S2 → 阶段9 P1-S3 → 阶段10 P2 → 阶段11 P3 → 阶段12 P4 → 阶段13 P5`；不得打乱、跳步、并行越级启动未授权阶段。**

### 建议改（收益明确，但可在批准后按节奏）

1. ADR-005-lite 已在阶段 1 产出并 Accepted；完整 ADR-005 在阶段 4 P1-A 全量设计冻结时补齐，不得把 lite 误认为全量设计。
2. P2 试点选 `sum + integrator` 与 R/C + 2×2 vector。
3. 先写 `MINIMAL_DATA_MODEL_EXAMPLE.md` 再进代码。
4. 外观 undo 用命令历史/SceneTxn，不另造独立 undo 栈。
5. 阶段验收按 §9.3 的九项检查执行；CI 必须绑定精确 HEAD。
6. 为 P3 增加电路 + 机械两类最小模型原型。

### 暂不改（本轮明确不做）

1. 不写任何生产代码、不迁移旧项目、不改 `graph.py/scene.py` 冻结区。
2. 不改 FEM、不放宽 `MAX_NODES=400`、不启动 R19/R25。
3. 不启动 Phase 3 架构债、Phase 4 CI 证据。
4. 不改外部 JSON 格式、不删现有功能。
5. 不做 P3 的大规模 solver 重写、不做完整 Modelica/通用编译器。
6. 不实现完整 Control Flow/图灵完备运行时。

### 需用户决策（2026-11-11 已全部裁决，见 PROJECT_STATUS 与 ADR）

1. **顺序**：用户已定阶段 0–13，见 §10，不再作为待决项。
2. **外观持久化**：默认放 SceneDoc 的 Presentation 层，不单独建 view 文件；保留未来多视图扩展，暂不实现完整多用户视图（ADR-005-lite）。
3. **Runtime 快照**：默认不保存；快照为独立可选能力，独立版本标识与兼容检查，不要求本阶段实现完整检查点。
4. **Plugin/Solver**：允许插件经公开稳定 Engine API 注册自定义 Solver/Engine；Plugin v1 是受信任进程内 Python，不是安全沙箱，不承诺不可信第三方安全运行（ADR-004）。
5. **P3 定位**：先做研究型最小原型、按未来生产级平台设计；先电路试点，再机械动力学试点，不强行统一（ADR-006）。
6. **P5**：Control Flow 独立长期预留；确定性同步步进为基础、离散事件调度为补充，不当前实现完整运行时（ADR-007）。
7. **PROJECT_STATUS/ADR**：已批准并创建 `docs/PROJECT_STATUS.md` 与 `docs/adr/ADR-001..007`（ADR-005-lite Accepted，其余 Proposed）。

---

## 12. 附录：PROJECT_STATUS 与 ADR 的落地边界

- 2026-11-11 已按用户正式裁决创建 `docs/PROJECT_STATUS.md` 与 `docs/adr/ADR-001..007`（ADR-005-lite Accepted，其余 Proposed），并小范围更新 `CORE_ARCHITECTURE_V2.md`、`CORE_ARCHITECTURE_V2_ROADMAP.md`、`BACKLOG.md`（保留历史）。
- 配套的「项目优化」执行规划见 `NetlabHome/netlab/docs/PROJECT_OPTIMIZATION_EXECUTION_PLAN.md`；其阶段顺序与 §10 完全一致（阶段 0–13）。
- 以下文档落地已由 2026-11-11 本轮完成；后续仅在阶段 4 P1-A 全量设计冻结时补齐完整 ADR-005。

## 13. 本轮审计边界声明

- 只读检查：Git、代码、文档、`status.json`、`reports/test_status.json`、P1 审计报告；未修改源码、未改 `ROADMAP/BACKLOG`、未创建 ADR/PROJECT_STATUS、未提交、未 push。
- 未重新运行 pytest；881/1/81.31% 来自 `status.json` / `reports/test_status.json` 与 `CORE_ARCHITECTURE_AUDIT.md` 记录；CI run 号为审计报告记录，本轮未重新调用 GitHub API。
- 本文件所有“必须/建议/暂不/需决策”均为提案；未获用户批准前，不得把任何一条当作已冻结架构或已授权施工。
