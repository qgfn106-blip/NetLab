# V2 实施差距分析（阶段 4 整改交付物）

> 状态：`Proposed`。本文按《阶段4架构设计整改与重新验收任务书》§二/§四 补齐 P1-03–P1-13、P2-02 的差距分析；只描述设计差距与迁移方案，**不实施 V2、不改生产代码**。事实基线以当前 V1 源码为准（`cff3b1e` 系列提交之前的 `graph.py` / `scene.py` / `records.py` / `scene_io.py` / `ports.py`）。

## 1. P1-03 V1 → V2 逐字段迁移映射

> **部分存在订正（2026-11-12 11:58 审批文档组）**：整改前 `MIGRATION_AND_COMPATIBILITY.md:21-35` 已有 12 行映射表，但标题为 `## 2. 字段映射（V2 ← v7，只加不删）`（为 v7→V2，不是任务书要求的 V1→V2 全字段）；`:26` 把 `NodeRecord.data/state/inputs` 笼统压到 `NodeRuntime.state/value`，未逐字段拆分；v6 见 `:43/:47` 仍 `PENDING_USER_AUTHORIZATION`。故正确口径是「已有 v7→V2 表、缺 V1→V2 逐字段与 data/state/inputs 拆分」，不是「完全无映射表」；§7 为本轮新增的 V1→V2 全字段表。

| V1 字段/对象 | V2 目标对象 | 迁移规则 | 兼容风险 |
| --- | --- | --- | --- |
| `NodeRecord.id/name/kind/params/appearance`（`netlab/core/model/records.py`） | `NodeDesc.id/kind/params` + Presentation `node_styles[id]` | `appearance` 整体移入 Presentation 层，按 id 关联 | 旧工程读取时保留 `appearance`，写出时转 `presentation.node_styles` |
| `EdgeRecord.id/source/target/kind/params/appearance` | `EdgeDesc.id/kind/source/target/source_port/target_port/params` | `kind` 区分 `physical`/`dependency`/`layout`；`appearance` 移入 Presentation | 旧 `kind="wire"` 归入 `physical`，`kind="signal"` 归入 `dependency` |
| `Scene.mode` | `SceneDesc.mode` + `EngineSpec.mode` | 由 EngineSpec 声明能力，Scene 不再硬编码 | 插件 mode 需注册 EngineSpec，否则 422 |
| `Project` 多 Scene | `ProjectDesc.scenes` | 字段不变，`version` 7→8（仅加不删） | v6 需迁移到 v7 再读 v8（见 P1-13） |
| `ports.py PortSpec/PinSpec` | `PortDesc/PortType` | 见 P1-08 | 旧插件需适配注册接口 |

## 2. P1-04 三域 across/through 守恒示例

| 域 | 势变量（across） | 流量变量（through） | 守恒律 | 本构示例 |
| --- | --- | --- | --- | --- |
| 电 | `voltage` V | `current` A | KCL（节点电流代数和 0） | `i = (v1-v2)/R`、`i = C·dv/dt` |
| 机械 | `velocity` m/s | `force` N | 力平衡（节点力代数和 0） | `f = b·v`、`f = m·dv/dt` |
| 热 | `temperature` K | `heat_flow` W | 热流守恒 | `q = (T1-T2)/R_th`、`q = C_th·dT/dt` |

连接语义统一为 `physical_conserving`：势相等 + 流量代数和为零；跨域连接必须经 `multi_port` 或显式转换器，禁止隐式换算。

## 3. P1-05 三型边独立结构

| 边型 | 职责 | 是否进编译 | 是否可布局 | 字段 |
| --- | --- | --- | --- | --- |
| `PhysicalEdge` | 物理连接/本构引用 | 是 | 是 | `id/source/target/source_port/target_port/params` |
| `DependencyEdge` | 计算依赖/求值顺序 | 是 | 否 | `id/source/target/lag/kind` |
| `LayoutEdge` | 仅画布/机柜布局 | 否 | 是 | `id/source/target/points/style` |

三者共享 `EdgeBase(id, kind)`，但**不得**再用一个 `EdgeRecord` 同时承载物理拓扑与计算依赖（P1-B1）。

## 4. P1-07 Description / Runtime 隔离（只形成整改方案，不改代码）

- 现状风险（订正后表述）：**导出路径并非未深拷贝**——`netlab/core/model/records.py:29-50` 的 `NodeRecord.snapshot()` 在 `include_state=True` 时对 `params/data/state/inputs` 用 `copy.deepcopy`（`include_state=False` 是只读视图的显式性能取舍，`:32-34` 有注释）。真正的隔离缺口在运行时：`netlab/core/model/scene_engines.py:101-107` 直接把 `record.data`/`record.state`/`record.inputs` 按引用传给 `Node(...)`；`netlab/core/model/graph.py:190-192` 注释明写「data 与 state 保持引用语义：场景记录与运行时对象共享同一份字典」，`:200` 的 `MappingProxyType(self.data)` 只锁视图不锁内容。
- 整改方案（设计层）：`SceneDocument` 只保存 `NodeDesc/EdgeDesc/SceneDesc`（frozen，深拷贝边界）；`SceneRuntime` 由 Engine 从 `CompiledModel` 创建，持有独立状态；两者通过 `generation`/`revision` 校验，禁止互相写回。
- 本阶段不修改上述源码，只登记为 P1-07 设计输入；`test_stage4_document_contracts.py::test_runtime_state_isolation` 先证明契约层深拷贝语义。

## 5. P1-08 ports.py PortSpec/PinSpec 差距表

| V1 `PortSpec`/`PinSpec` | V2 `PortDesc`/`PortType` | 差距 |
| --- | --- | --- |
| `name/role/required/order`（实际 `netlab/core/model/ports.py:20-45` 的 `PortSpec/PinSpec`，另有 `dx/dy` 布局字段） | `port_id/port_type/direction/quantity/unit/dimension/cardinality/shape/connection_semantics/coordinate_frame` | V1 无 domain/unit/dimension/direction/cardinality/连接语义/坐标框架；V2 必须补 |
| `fields: dict` 无单位 | `PortType.unit/dimension` | 需要 `UnitRegistry` 显式换算 |
| 无 `cardinality` | `one/many` | 需支持 fan-in/fan-out 与 multi_port 展开 |

## 6. P1-09 EdgeRecord 职责混合拆分

`EdgeRecord` 当前同时承载：物理连接、计算依赖、画布布局、外观（`netlab/core/model/records.py:54-79` 单一 dataclass 同时含连接语义/state/几何/layout/引脚/appearance）。另：`netlab/core/model/scene_io.py:84-86` 的 `load_payload` 只认静态 `MODES`、拒绝插件 mode，而 `netlab/core/model/scene.py:82-88` 的 `Scene.__init__` 反而允许 `ENGINE_SPECS` 中的插件 mode——两处口径不一致，必须纳入差距表。拆分目标：
- `PhysicalEdge`：source/target/source_port/target_port/params；
- `DependencyEdge`：求值依赖与 lag；
- `LayoutEdge`：仅 UI 坐标/走线；
- Presentation：外观按 edge id 关联。
迁移期 `EdgeRecord` 可保留只读兼容，但新代码不得再向 `EdgeRecord` 写计算依赖。

## 7. P1-10 ENGINE_SPECS / ENGINE_OWNERS 全局字典 Project 隔离

- 现状：`netlab/core/model/engine_registry.py:14-15` 的 `ENGINE_SPECS`/`ENGINE_OWNERS` 是进程级全局字典，插件注册跨 Project 泄漏、无 project 隔离。
- 方案：改为 `ProjectEngineRegistry`，生命周期随 `ProjectDesc`；全局只保留内建只读基表；插件注册写项目级副本；卸载 Project 时释放。

## 8. P1-11 插件信任边界

Plugin v1 是**进程内受信任 Python 代码，不是 OS 沙箱**：`netlab/core/plugins.py:3/210-216` 用进程内 `importlib` 直接加载，`netlab/core/extensions.py:403` 用 `exec(..., namespace)`；AST 黑名单只是表达式层缓解，不是沙箱。权限边界：
- 只读：`PortTypeRegistry`、`EngineSpec` 元数据、`read_compiled_summary()`；
- 可写：白名单 `Parameter`（`writable=True`）、`SceneEdit` 事务；
- 禁止：直接访问 `Runtime` 内部、替换内建 Engine、写 `graph.py`/`scene.py` 冻结区。
该三项权限细节是 `PENDING_USER_AUTHORIZATION`（ADR-008 决策 B）。

## 9. P1-12 scene_io.load_payload 加载→编译→Runtime 全流程

目标流程：
1. `load_payload` 只解析/校验 `SceneDesc`（不实例化 Engine）；
2. `EngineSpec.validate(scene_desc) -> CompiledModel`；
3. `EngineSpec.factory()` 创建 Engine；
4. `Engine.create_runtime(compiled)`；
5. `RuntimeManager` 负责 snapshot/restore/destroy。
现状 `netlab/core/model/scene_io.py:84-86` 的 `load_payload` 直接拒绝插件 mode、无 domain 概念；而 `netlab/core/model/scene.py:82-88` 的 `Scene.__init__` 允许 `ENGINE_SPECS` 插件 mode，两处口径不一致；`Scene.ensure_engine()` 仍懒加载，需按上述顺序解耦。

## 10. P1-13 v6/v7 工程兼容策略

- `PROJECT_VERSION=7` 当前；V2 草案 `version: 8` 仅加字段不删字段。
- v6 → v7：运行既有 `migrate_project`；v7 → v8：`appearance` → `presentation.node_styles`、`PortSpec` → `PortDesc`。
- 兼容窗口是否必须支持 v6 是 `PENDING_USER_AUTHORIZATION`（ADR-008 决策 C）；默认策略：只读兼容 + 显式迁移，不回写旧格式。

## 11. P1-R1 / P1-R2 状态

- P1-R1：已收敛 `stamp_laplacian` 共享原语（阶段 5，`stamps.py` + `descriptor.py` 三处委托 + 33 测试 + D-5 影子报告），见 `P1_R1_STAMP_CONVERGENCE.md`。
- P1-R2：`CircuitSolver.ac_sweep()`（`netlab/core/compute/circuit/solver.py:969`）与 `DescriptorModel.frequency_response()`（`descriptor.py:844`）是**两条独立实现**：前者独立执行 DC 工作点/频率检查/AC 组装/探针，后者自己 build system 并逐频率 `system.solve(omega)`；**`frequency_response` 不是 `ac_sweep` 的兼容包装**，2026-11-12 复审已纠正。阶段 6 再统一。**已有窄范围 parity**：`netlab/tests/test_descriptor_rlc.py:174 test_frequency_response_shape_and_legacy_parity`，:178-181 同时调两后端，:188-194 对 real/imag/magnitude/phase_deg/db 做 `assert_allclose(rtol=1e-8, atol=1e-10)`；仅单一 RC 低通/4 频点，缺全面跨拓扑等价证据，不能表述为「无任何等价测试」。

#### 11.1 后端约束表（AC/Bode 两后端，读源码，2026-11-12 收口补）

| 维度 | `CircuitSolver.ac_sweep()`（`solver.py:969`） | `DescriptorModel.frequency_response()`（`descriptor.py:844`） |
| --- | --- | --- |
| 组装路径 | MNA；`AC_KINDS` 白名单，拒绝非线性元件 | 自建 `A + jωE` 系统，逐频率 `system.solve(omega)` |
| 未知量 | 节点电压（支路电流按元件） | 节点电压 + 电感/电压源支路电流 |
| DC 语义 | Legacy 伴随（电感 `DC_CONDUCTANCE=1e5`） | 描述符（理想电感 `v_L=0`，见 `test_descriptor_dc.py`） |
| 现行调用 | 有用户契约，API 走它 | `analysis.py:1176 _circuit_frequency_response` 走它 |
| 定位（建议，未实施） | canonical AC/Bode 唯一后端 | 降级为兼容包装（保持 `omega_rad_s`/`omega` 与 probe 字段） |

> 「定位」一行是 `CORE_ARCHITECTURE_AUDIT.md:252-254` 的**建议**，非当前事实；阶段 6 授权前不改任一后端生产代码。

#### 11.2 跨拓扑 parity matrix（现状 vs 待补，2026-11-12 收口补）

只记录**现有文档/测试已列明**的覆盖与**尚未覆盖**的项目；未跑测者标「待补（阶段 6 授权后）」，**不编造通过结论**。

| 拓扑/场景 | parity 覆盖现状 | 状态 |
| --- | --- | --- |
| RC 低通（单拓扑 / 4 频点） | `test_descriptor_rlc.py:174`，real/imag/magnitude/phase_deg/db `rtol=1e-8, atol=1e-10` | 已覆盖（窄） |
| RL / RLC | 现有文档未列双后端对拍 | 待补 |
| 受控源（VCVS/VCCS） | 现有文档未列 | 待补 |
| 多输入源 / 源归一化 | 现有文档未列 | 待补 |
| 浮置节点 / 混合接地 | 现有文档未列 | 待补 |
| 奇异 / 病态 E 矩阵 | 现有文档未列 | 待补 |
| 多探针输出 | 现有文档未列 | 待补 |
| 状态不变性（频响不改 state） | 现有文档未列 | 待补 |
| 全量复数误差带（跨拓扑） | 仅单点 `rtol=1e-8` | 待补 |
| 两后端性能对比 | 存在 `tools/bench_ac_backends.py`（本轮未核对其口径） | 部分（脚本存在，待核） |

## 12. P2-02 V2 专项测试计划

| 测试层 | 内容 | 基线 |
| --- | --- | --- |
| 文档契约 | `tools/check_stage4_docs.py` + `test_stage4_document_contracts.py` | 本阶段新增 |
| 单元 | `PortType` 量纲/单位换算、`PortDesc` 兼容、`EngineSpec` 生命周期 | 新增 |
| 集成 | `load_payload → validate → compile → runtime` 全链路 | 新增 |
| 回归 | 旧工程 v6/v7 读取、AC/Bode 新旧后端对拍 | 沿用 909 passed/1 skipped/81.404692% 作为阶段3基线，**不得当阶段4新结果** |
| 性能 | `stamp_laplacian` + `_assemble_matrices` 基准 | 阶段5 `bench_stamp_unification.py` |

## 13. 结论

本文件补齐任务书 P1-03–P1-13、P2-02 的差距与方案。未实施任何 V2 迁移或生产代码修改；所有未定项集中在 ADR-008（三项 `PENDING_USER_AUTHORIZATION`）。


## 13. 来源订正与口径提醒（2026-11-12 11:31 审批补充）

- 订正 1：P1-R2 不是「无测试证明两后端等价」，而是已有窄范围 parity（`test_descriptor_rlc.py:174`、单一 RC 低通/4 频点），缺全面等价/跨拓扑证据。
- 订正 2：P1-07 不是「to_dict/导出未用 copy.deepcopy」，而是导出路径 `records.py:29-50 NodeRecord.snapshot()` 已 deepcopy；真正风险是 `scene_engines.py:101-107` 与 `graph.py:190-192/:200` 的运行时共享可变 dict。
- 口径提醒：「冻结区不改生产核心代码」是本轮整改的前向约束，不代表 `netlab/core/compute/circuit/` 历史零提交（此前已有 736f2f8/dc78a6c/c8de1ec 等阶段 5 提交）；报告不得写「冻结区零提交」。

## 14. 来源订正（2026-11-12 11:58 审批文档组）

- 订正 A（P1-03）：`MIGRATION_AND_COMPATIBILITY.md:21-35` 已有 v7→V2 12 行映射表（标题 `V2 ← v7`，`:26` 将 `NodeRecord.data/state/inputs` 压到 `NodeRuntime.state/value`，v6 见 `:43/:47` 仍 PENDING）；应写「部分存在/口径偏差」而非「完全缺失」。本轮 §1/§7 已补 V1→V2 逐字段拆分。
- 订正 B（P2-01）：`TYPED_PORT_SYSTEM.md:55-60` 已有 `UnitRegistry`（单位→4 元量纲向量 + 比例因子、显式 `convert`、`mV↔V`、禁隐式跨维度），`CORE_INTERFACE_CONTRACTS.md:103-115` 已有 `class UnitRegistry(Protocol)`；但原量纲固定 4 元（`TYPED_PORT_SYSTEM.md:16`、`:38`、`CORE_INTERFACE_CONTRACTS.md:113`），缺 `[L,M,T,I,Θ,N,J]` 七基与 `m/mm`、`J↔N·m` 换算测试（原全库 0 命中）。正确口径：「4 元量纲 + UnitRegistry + V/mV 已有，缺 SI 七基与 m/mm·J↔N·m」；本轮已把文档量纲扩到 7 元。
- 订正 C（P1-06）：`PROGRESS.md:2870` 的 `_stage4_validate.py` 确为仓库外脚本（仓库根下未入库的 `_stage4_validate.py`（68 行）），workspace root 非 git 仓、未被 tracked，只查 LF/隐私禁词/Proposed/ast.parse/json.loads/Mermaid，**不校验设计缺陷**；其 `ALL DESIGN DOC CHECKS PASSED` 不能等同于可复现契约测试。本轮另建并入库 `tools/check_stage4_docs.py` + `netlab/tests/test_stage4_document_contracts.py`（真实失败非 0、反例测试、语义项标 MANUAL），满足任务书要求；`_stage4_validate.py` 仅作辅助格式检查，不计入交付。
- 治理口径：九份文档均 `Proposed`、三项 Open Decision 均 `PENDING_USER_AUTHORIZATION`/Open Question，ADR-001/002/003/004/006/007 未升格；「设计冻结」应理解为「文档基线冻结、非决策冻结」，阶段 10 P2 实现前须用户授权解决。
- 工具避坑：`ops_grep` 花括号多文件 glob（`{A,B}.md`）会静默跳过全部文件，0 命中是假阴性；`ops_glob` 用 `NetlabHome/netlab/docs/*.md` 可能触发 10000 扫描上限；应改 `glob:["*.md"]` 或单文件 `path` 复核。
