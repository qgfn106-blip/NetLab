# Typed Port 系统设计冻结（阶段 4 / P1-A）

> 状态：`Proposed`（设计冻结草案，待评审）。本文是目标设计口径，不是当前实现；ADR 不是实施授权。
> 依据：`NETLAB_V2_PLANNING_REVIEW.md:125-130`（Typed Port 五问）、`CORE_ARCHITECTURE_V2_ROADMAP.md:58-62`、`CORE_ARCHITECTURE_AUDIT.md` §5（P1-B1 物理拓扑与计算依赖共边）。
> 边界：不写生产代码；不改现有 `netlab/core/model/blocks.py:80-128` 的 `PortDef`；不删字段；不改 FEM；不放宽 `MAX_NODES=400`。

## 1. 类型表达

`PortType` 字段（与 `CORE_MODEL_V2.md` §4 的 dataclass 草案一致）：

| 字段 | 类型 | 含义 | 示例 |
| --- | --- | --- | --- |
| `domain` | `str` | 领域标识 | `circuit`、`mechanical`、`signal` |
| `quantity` | `str` | 物理量/信号量名 | `voltage`、`current`、`force`、`velocity`、`signal` |
| `unit` | `str` | 单位符号（可换算） | `V`、`A`、`N`、`m/s` |
| `dimension` | 7 元组整数 | 量纲指数向量，顺序 `[L, M, T, I, Θ, N, J]` | 电压 `[2, 1, -3, -1, 0, 0, 0]` |
| `direction` | `str` | `input` / `output` / `bidirectional` | `bidirectional` |
| `cardinality` | `str` | `one` / `many` | `one` |
| `shape` | 整数元组 | 数据结构形状，标量为空元组 | `()`、`(3,)` |
| `dtype` | `str` | 数值/信号数据类型 | `float`、`complex`、`vector`、`bit` |
| `connection_semantics` | `str` | 连接语义（§3） | `physical_conserving` |
| `coordinate_frame` | `str` | 机械/多物理场坐标系 | `world`、`body` |
| `metadata` | 映射 | 扩展元信息，不进量纲检查 | `{}` |

物理量用 `unit` + `dimension` 表达；纯数据结构用 `shape` + `dtype` 表达。核心只认 `PortType` 接口，不硬编码领域类型名。

## 2. 最小 4 类物理量（Circuit + 最小机械域）

| 量 | domain | unit | dimension `[L,M,T,I,Θ,N,J]` | 典型方向 | 语义 |
| --- | --- | --- | --- | --- | --- |
| `voltage` | `circuit` | `V` | `[2, 1, -3, -1, 0, 0, 0]` | bidirectional | 节点势，Physical Conserving |
| `current` | `circuit` | `A` | `[0, 0, 0, 1, 0, 0, 0]` | bidirectional | 支路流量，Physical Conserving |
| `force` | `mechanical` | `N` | `[1, 1, -2, 0, 0, 0, 0]` | bidirectional | 力，Physical Conserving |
| `velocity` | `mechanical` | `m/s` | `[1, 0, -1, 0, 0, 0, 0]` | bidirectional | 速度，Physical Conserving |

设计目标（ROADMAP §2 验收）：先用 Circuit + 一个最小机械域验证 Typed Port，不要求全平台铺开。机械域最小例见 `MINIMAL_DATA_MODEL_EXAMPLE.md` §4。

量纲向量维数固定为 7 个基本量纲 `[L, M, T, I, Θ, N, J]`，便于 `UnitRegistry` 用整数向量做兼容判定，避免浮点比较。

## 3. 连接语义

| 语义 | 含义 | 典型域 | 编译产物 |
| --- | --- | --- | --- |
| `causal` | 上游输出驱动下游输入，有向、单因果方向 | `signal` | 有向执行图、SCC/Tarjan |
| `acausal` | 无预设因果方向，由求解器决定 | `circuit` / `mechanical` | 方程组装 |
| `physical_conserving` | 势变量相等 + 流量守恒（KCL / 力平衡） | `circuit` / `mechanical` | KCL/KVL 或力平衡方程 |
| `multi_port` | 命名端口束，一次连接多个 PortType | 插件域 | 展开为多条单端口连接 |

`Port` 支持 `cardinality: one | many` 与命名端口；fan-in/fan-out 规则：

- `direction=output` 且 `cardinality=one`：最多一个下游（除非显式 fan-out 声明）。
- `direction=input` 且 `cardinality=many`：允许多上游汇聚（如 sum 节点）。
- `physical_conserving` 端口的 fan-in 不是复制，而是进同一守恒方程。

## 4. 单位换算与 UnitRegistry

- 单独 `UnitRegistry`，保存「单位 → 量纲向量 + 比例因子」表与显式兼容矩阵。
- 换算必须显式：`convert(value, from_unit, to_unit)` 仅在量纲向量相等时允许，返回换算后的值。
- **禁止隐式跨维度转换**：`V` 与 `A` 量纲不同，连接检查直接报错，不自动换算。
- 允许同量纲不同前缀（`mV` ↔ `V`），比例因子来自注册表。

## 5. 检查时机

| 时机 | 检查内容 | 失败行为 |
| --- | --- | --- |
| 连接创建（快速静态） | domain 相同、direction 兼容、cardinality/fan-in 合法、unit 量纲向量相等 | 立即拒绝编辑，给出端口级诊断 |
| 编译时（完整） | 全图 PortType 解析、单位完整检查、multi_port 展开、未连接必填端口、方程数一致性 | `CompilationError` + `Diagnostic` 列表定位到组件/端口 |
| 运行时（仅 debug 模式） | 断言断言性检查，热路径默认关闭 | 断言失败记遥测，不改变结果 |

## 6. 自定义领域类型

- Plugin 经公开 `PortTypeRegistry.register(port_type)` 注册；核心只认接口，不硬编码领域类型。
- 注册内容：`domain`、`quantity`、`unit`、`dimension`、`connection_semantics`、换算比例因子。
- 注册不改变内建 Engine，不替换内建求解器（与 `ENGINE_SPI_V2.md` §4 一致）。

## 7. Typed Port 五问（逐条）

1. **类型表达？** `PortType {domain, quantity, unit, dimension, direction, cardinality, shape, dtype, connection_semantics, coordinate_frame, metadata}`；物理量用 unit/dimension 表，数据结构用 shape/dtype。见 §1。
2. **检查时机？** 连接创建做快速静态检查；编译时做完整类型/单位检查；运行时仅 debug 模式做断言。见 §5。
3. **单位换算？** 单独 `UnitRegistry`、显式换算/兼容矩阵；禁止隐式跨维度转换。见 §4。
4. **多输入/多输出？** `Port` 支持 `cardinality: one|many` 与命名端口；连接语义明确 fan-in/fan-out，`physical_conserving` 的 fan-in 进守恒方程而非复制。见 §3。
5. **自定义领域类型？** 通过 Plugin 注册 `PortType`，核心只认接口，不硬编码领域类型。见 §6。

## 8. 与现状差异

现状 `netlab/core/model/blocks.py:80-128` 的 `PortDef(name, direction, fields, dtype, default, net)` 只有 `direction` 与 `dtype`，没有 domain/unit/dimension/cardinality/connection_semantics；`net` 是电路模块端口绑定内部网络节点 id（R24/D51）。V2 不删除这些字段，只在适配层补充 `PortType`；旧工程可读。字段对照见 `MIGRATION_AND_COMPATIBILITY.md` §2。

## 9. 验收对照

| 验收项 | 证据 |
| --- | --- |
| 4 类物理量 voltage/current/force/velocity | §2 表 |
| Circuit + 最小机械域验证 | §2 + `MINIMAL_DATA_MODEL_EXAMPLE.md` §4 |
| 单位/量纲检查 | §4 + §5 |
| Causal/Acausal/Physical Conserving/Multi-port | §3 |
| 旧工程适配层可读 | §8 + `MIGRATION_AND_COMPATIBILITY.md` |
| Plugin 注册自定义类型 | §6 |
