# V2 实施差距分析（阶段 4 整改交付物）

> 状态：`Proposed`。本文按《阶段4架构设计整改与重新验收任务书》§二/§四 补齐 P1-03–P1-13、P2-02 的差距分析；只描述设计差距与迁移方案，**不实施 V2、不改生产代码**。事实基线以当前 V1 源码为准（`cff3b1e` 系列提交之前的 `graph.py` / `scene.py` / `records.py` / `scene_io.py` / `ports.py`）。

## 1. P1-03 V1 → V2 逐字段迁移映射

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

- 现状风险：`netlab/core/model/records.py` 的 `NodeRecord/EdgeRecord` 与 `netlab/core/model/graph.py` 的 `Node/Connection` 共享可变 `data/state` 字典；`netlab/core/model/scene_engines.py:101-107` 运行时仍引用同一 dict。
- 整改方案（设计层）：`SceneDocument` 只保存 `NodeDesc/EdgeDesc/SceneDesc`（frozen，深拷贝边界）；`SceneRuntime` 由 Engine 从 `CompiledModel` 创建，持有独立状态；两者通过 `generation`/`revision` 校验，禁止互相写回。
- 本阶段不修改上述源码，只登记为 P1-07 设计输入；`test_stage4_document_contracts.py::test_runtime_state_isolation` 先证明契约层深拷贝语义。

## 5. P1-08 ports.py PortSpec/PinSpec 差距表

| V1 `PortSpec`/`PinSpec` | V2 `PortDesc`/`PortType` | 差距 |
| --- | --- | --- |
| `name/direction/fields/dtype/default/net` | `port_id/port_type/direction/quantity/unit/dimension/cardinality/shape/connection_semantics/coordinate_frame` | V1 无物理量/单位/量纲/连接语义/坐标框架；V2 必须补 |
| `fields: dict` 无单位 | `PortType.unit/dimension` | 需要 `UnitRegistry` 显式换算 |
| 无 `cardinality` | `one/many` | 需支持 fan-in/fan-out 与 multi_port 展开 |

## 6. P1-09 EdgeRecord 职责混合拆分

`EdgeRecord` 当前同时承载：物理连接、计算依赖、画布布局、外观。拆分目标：
- `PhysicalEdge`：source/target/source_port/target_port/params；
- `DependencyEdge`：求值依赖与 lag；
- `LayoutEdge`：仅 UI 坐标/走线；
- Presentation：外观按 edge id 关联。
迁移期 `EdgeRecord` 可保留只读兼容，但新代码不得再向 `EdgeRecord` 写计算依赖。

## 7. P1-10 ENGINE_SPECS / ENGINE_OWNERS 全局字典 Project 隔离

- 现状：`netlab/core/model/engine_registry.py` 的 `ENGINE_SPECS`/`ENGINE_OWNERS` 是模块级全局字典，插件注册跨 Project 泄漏。
- 方案：改为 `ProjectEngineRegistry`，生命周期随 `ProjectDesc`；全局只保留内建只读基表；插件注册写项目级副本；卸载 Project 时释放。

## 8. P1-11 插件信任边界

Plugin v1 是**进程内受信任 Python 代码，不是 OS 沙箱**。权限边界：
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
现状 `scene_io.py:85` 直接拒绝插件 mode、`Scene.ensure_engine()` 懒加载，需按上述顺序解耦。

## 10. P1-13 v6/v7 工程兼容策略

- `PROJECT_VERSION=7` 当前；V2 草案 `version: 8` 仅加字段不删字段。
- v6 → v7：运行既有 `migrate_project`；v7 → v8：`appearance` → `presentation.node_styles`、`PortSpec` → `PortDesc`。
- 兼容窗口是否必须支持 v6 是 `PENDING_USER_AUTHORIZATION`（ADR-008 决策 C）；默认策略：只读兼容 + 显式迁移，不回写旧格式。

## 11. P1-R1 / P1-R2 状态

- P1-R1：已收敛 `stamp_laplacian` 共享原语（阶段 5，`stamps.py` + `descriptor.py` 三处委托 + 33 测试 + D-5 影子报告），见 `P1_R1_STAMP_CONVERGENCE.md`。
- P1-R2：canonical AC/Bode 仍定 `CircuitSolver.ac_sweep()`，`DescriptorModel.frequency_response()` 为兼容包装；阶段 6 再统一。设计文档保持 Proposed。

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
