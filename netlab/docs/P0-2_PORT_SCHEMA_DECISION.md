# P0-2 端口 Schema 决策：PortDesc 内嵌（方案 A）

> 任务来源：m00267。性质：**决策记录 + 只读依赖审计 + 迁移提案**。本轮**不修改** PortDesc、BlockDef、Project DTO、序列化或生产求解器。
> 日期：2026-11-12。

## 1. 决策

**采用方案 A：PortDesc 内嵌。** PortDesc 作为自包含、可序列化的不可变值对象，随 Block Definition 一起保存，不以全局 Registry 为恢复前提。

硬性要求（来自 m00267）：

1. 端口具有稳定的 `port_id`。
2. 端口定义与运行时状态分离。
3. 明确 `direction`、`data_type`、`domain`、`unit` 等必要字段。
4. 支持插件自定义功能块。
5. 支持工程文件保存和加载。
6. 建立 `schema_version` 和必要的迁移机制。
7. 不将可执行函数直接放入端口 Schema。
8. 不依赖全局 Registry 才能恢复工程中的端口定义。允许轻量级标准数据类型注册表做类型校验/兼容性检查，但不得取代 PortDesc 本身。

## 2. 当前实现事实（依赖审计，只读）

| 关注点 | 现状 | 位置 | 与目标的关系 |
|--------|------|------|--------------|
| 块端口模型 | `PortDef` dataclass：`name, direction, fields:list[str], dtype("signal"/"vector"/"bit"/"any"/"electrical"), description, default:float, net(circuit 内部网节点, R24/D51)` | `netlab/core/model/blocks.py:79-125` | 已是**自包含纯数据**，与方案 A 同源 |
| 序列化 | `PortDef.to_payload()/from_payload()` 全部字段进 payload；`BlockDef.to_payload()` 把 `ports` 逐项 `port.to_payload()` 内联 | `blocks.py:90-101`、`blocks.py:129+` | **已内嵌自包含**，随 BlockDef payload 走 |
| 块定义 | `BlockDef` 内联 `ports: list[PortDef]`，含 `version:int=1`；限制 `MAX_BLOCK_PORTS=32` 等 | `blocks.py:129+` | 端口无独立 `schema_version`（仅块级 version） |
| 工程文件 | `PROJECT_FORMAT="netlab-project"`、`PROJECT_VERSION=7`、checksum、原子保存、迁移 | `netlab/core/model/project.py`、`tests/test_project_migration.py` | **工程级 schema_version + 迁移已存在**；PortDesc 随 BlockDef 一起存取 |
| 插件/扩展 | `plugin_api/v1/__init__.py` 仅导出 `ParamSpec` 等稳定面，**未导出 PortDef/端口 Schema**；`engine_registry.py / plugins.py / extensions.py / server_*` 为注册与加载面 | `netlab/plugin_api/v1/__init__.py`、`netlab/core/model/engine_registry.py` 等 | **插件尚不能声明 PortDesc（GAP）** |
| 器件端口/引脚（另一套） | `ports.py` 的 `PortSpec`(name,role,required,order) 与 `PinSpec`(name,role,required,order,dx,dy) + `PINS: dict[str,list[PinSpec]]` | `netlab/core/model/ports.py` | 这是**器件引脚契约，不是块端口** |

## 3. 逐条差距分析（对照 8 项要求）

| # | 要求 | 现状 | 判定 | 差距/动作（提案，不实施） |
|---|------|------|------|--------------------------|
| 1 | 稳定 `port_id` | 端口 identity = `name`（`BlockDef` 内按 name 唯一） | **缺失** | 新增 `port_id:str`（uuid，稳定、改名不变）；`from_payload` 缺省时用旧 name 派生并回填 |
| 2 | 定义与运行时状态分离 | `PortDef` 纯数据，无常量载荷；运行态在 solver | **已满足** | 保持；不得把运行态并入 PortDesc |
| 3 | `direction/data_type/domain/unit` | `direction` 有；类型字段名为 `dtype`；`domain`/`unit` **缺失** | **部分缺失** | 新增 `data_type`（建议作为 `dtype` 的规范化别名，向后兼容读旧 `dtype`）、`domain`、`unit`；明确枚举与默认 |
| 4 | 支持插件自定义功能块 | plugin_api 未暴露 PortDef | **缺失** | 在 `plugin_api/v1` 暴露不可变 PortDesc 构造（纯数据），插件功能块可携带端口定义 |
| 5 | 工程保存/加载 | 工程级 `PROJECT_VERSION=7`+迁移，PortDef 内嵌随 BlockDef 存取 | **已满足** | 采用新字段后按工程迁移补齐默认值 |
| 6 | `schema_version` + 迁移 | 块级 `version:int=1`；工程级迁移机制存在；**端口级 schema_version 缺失** | **部分缺失** | 端口加 `schema_version:int=1`（缺省 1）；复用工程迁移钩子做字段演化补齐 |
| 7 | 不把可执行函数放进 Schema | `PortDef` 全为数据字段，无 callable | **已满足** | 保持严格数据化 |
| 8 | 不依赖全局 Registry 恢复 | `from_payload` 已可从 payload 独立重建，无需注册表 | **已满足** | 保持；标准数据类型注册表仅做校验/兼容，不取代 PortDesc |

## 4. 两套"端口"模型澄清（重要，避免混用）

本仓库并存两个易混概念，方案 A 的"PortDesc 内嵌"**只作用于块端口 `BlockDef.PortDef`**：

- **块端口 `BlockDef.PortDef`**（本决策对象）：功能块的输入/输出接口，自包含、随 Block Definition 内嵌、方向 input/output/inout。
- **器件端口/引脚 `ports.PortSpec` / `PinSpec` / `PINS`**：元素（器件）的引脚几何与契约，属元件库侧，**不在本决策迁移范围**，保持不动。

> 因此"方案 A：PortDesc 内嵌"与现有 `BlockDef.PortDef` 的设计方向一致；本决策是把 `PortDef` 升级为满足 8 项要求的 **PortDesc**（补齐 `port_id / data_type / domain / unit / schema_version` 并暴露到插件 API），而非另起一套。

## 5. 需报告的现存冲突/歧义（不自行扩大修改范围）

1. **命名冲突**：现字段名 `dtype`，要求名 `data_type`。建议新增 `data_type` 为规范名，读取时兼容旧 `dtype`（不得静默丢弃旧数据）。
2. **缺字段**：`domain`、`unit`、`_port_id`、端口级 `schema_version` 均缺失，需按兼容方式新增（全部给默认值，旧工程可无损加载）。
3. **插件 API 缺口**：`plugin_api/v1` 未导出端口 Schema，无法满足"插件自定义功能块"；需在稳定 API 面新增不可变 PortDesc（纯数据）——属 API 扩展，需独立评审。
4. **`net` 字段耦合**：`PortDef.net` 是电路模块绑定内部网节点（R24/D51），与"端口抽象"存在轻度耦合；迁移时须保留语义，不并入通用 PortDesc 的必填面（可作可选扩展字段）。
5. **器件 vs 块端口**：见 §4，迁移只动 `BlockDef.PortDef`，勿误改 `ports.PinSpec`。

## 6. 建议的最小迁移路径（提案，本轮不实施）

- **兼容新增字段**（全部带默认，旧 payload 无损）：`port_id=""`、`data_type`（缺省回退 `dtype`）、`domain=""`、`unit=""`、`schema_version=1`。
- **`from_payload` 回填**：旧数据无 `port_id` 时由稳定 hash（如 `block_id + name`）派生并持久化；`data_type` 缺省取 `dtype`。
- **工程迁移**：采用后 bump `PROJECT_VERSION`（7→8），迁移钩子为旧 BlockDef 的端口补齐上述默认值（沿用 `tests/test_project_migration.py` 现有机制）。
- **插件 API**：先在 `plugin_api/v1` 增加只读 PortDesc 构造与校验，不加执行钩子。
- **一致性**：`BlockDef.from_payload` 去重/校验需把 `port_id` 纳入唯一性约束（name 仍唯一）。
- **实施前置**：本文件仅决策与提案；真正改 `blocks.py`/`project.py`/`plugin_api` 属生产代码变更，须在阶段 7（P1-S1 Project/DTO）或用户单独授权后进行，且改前先补"PortDef/BlockDef/Project DTO/序列化/插件"五处依赖的显式回归测试。

## 7. 边界声明

本决策**不意味着立即修改 PortDesc 或生产求解器**。本轮只读审计已完成依赖梳理；任何 schema/序列化/插件 API 的生产改动留待后续明确授权（预计随阶段 7 P1-S1 落地）。
