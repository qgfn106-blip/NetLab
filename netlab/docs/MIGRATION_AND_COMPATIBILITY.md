# 迁移与兼容设计冻结（阶段 4 / P1-A）

> 状态：`Proposed`（设计冻结草案，待评审）。本文是目标设计口径与迁移策略，不是当前实现；ADR 不是实施授权。
> 依据：`NETLAB_V2_PLANNING_REVIEW.md:100-108`（补 6 份文档第 5 份：旧记录、project v6/v7、字段改名、兼容窗口与回滚）、`CORE_ARCHITECTURE_AUDIT.md:394-400`（迁移风险表 R1–R6）、`CORE_ARCHITECTURE_V2_ROADMAP.md:60`（旧工程可通过适配层读取）。
> 边界：不迁移旧工程、不改外部 JSON、不删字段、不写生产代码、不改 FEM。

## 1. 现状格式基线（只记事实）

| 项 | 当前事实 | 位置 |
| --- | --- | --- |
| 工程格式标识 | `PROJECT_FORMAT = "netlab-project"` | `netlab/core/model/project.py` |
| 工程版本 | `PROJECT_VERSION = 7` | `netlab/core/model/project.py` |
| 应用版本 | `APP_VERSION = "2.1.0"` | `netlab/core/model/project.py` |
| 工程大小上限 | `MAX_PROJECT_BYTES = 8_000_000` | `netlab/core/model/project.py` |
| 迁移函数 | `migrate_scene_to_devices`、`migrate_scene_rails`、`migrate_project` | `netlab/core/model/project.py` |
| 节点记录 | `NodeRecord(id,name,kind,params,data,state,inputs,position,size,appearance)` | `netlab/core/model/records.py:14` |
| 边记录 | `EdgeRecord(id,name,source,target,kind,params,state,delay,auto_delay,enabled,route,waypoints,anchors,layout,source_pin,target_pin,source_port,target_port,appearance)` | `netlab/core/model/records.py:81` |
| 端口定义 | `PortDef(name,direction,fields,dtype,default,net)` | `netlab/core/model/blocks.py:80-128` |
| 块定义 | `BlockDef(id,name,mode,description,nodes,edges,ports,version,model,builtin,created,modified,metadata)` | `netlab/core/model/blocks.py:129-166` |

## 2. 字段映射（V2 ← v7，只加不删）

| v7 字段 | V2 目标 | 策略 |
| --- | --- | --- |
| `NodeRecord.params` / `EdgeRecord.params` | `NodeDesc.params` / `EdgeDesc.params` | 直接映射，保留键名 |
| `NodeRecord.data` / `state` / `inputs` | `NodeRuntime.state` / `value` | 运行态搬入 Runtime；记录层保留字段但运行时不再写入 |
| `NodeRecord.position` / `size` | Presentation 布局 | 保留在记录层，不进编译缓存键 |
| `NodeRecord.appearance` / `EdgeRecord.appearance` | Presentation 外观 | 保留在 SceneDoc 记录层（`records.py:27`/`:79`），不进 NodeRuntime / 物理参数 / 编译缓存键 |
| `EdgeRecord.delay` / `auto_delay` / `enabled` | `DependencyEdge` 参数 + `ConnectionRuntime.delay_state` | 描述与运行态拆分 |
| `EdgeRecord.route/waypoints/anchors/layout` | `LayoutEdge` 属性 | 不进方程、不进编译缓存键 |
| `EdgeRecord.source_port/target_port` | `EdgeDesc.source_port/target_port` | 直接映射 |
| `PortDef.net` | `PortDesc` 的绑定目标 | 直接映射（R24/D51 语义保留） |
| `BlockDef.mode` | `EngineSpec.mode` + 白名单 | 注册表生成模板，替代硬编码 mode |
| `Scene.mode` | `SceneDesc.mode` + `EngineSpec` | 同上 |
| 工程 `version` | `ProjectDesc.version` | v7 可读；v8 仅在需要新字段时递增 |

**总原则：字段只加不删**。旧工程 JSON 不做就地改写；适配层在加载时把 v7 记录投影为 V2 Desc + Runtime 初值，保存时按原版本回写或显式升级。

## 3. 兼容窗口与开放问题

| 版本 | 当前状态 | 设计目标 |
| --- | --- | --- |
| v6 及更早 | 由 `migrate_project` 处理 | **是否必须继续支持 v6 是待用户裁定的开放问题**（§6） |
| v7 | 当前版本 | 必须可读、可 round-trip、旧 API 不破坏 |
| v8（未来） | 未定义 | 仅在引入新字段/新 Desc 分层时递增；携带显式迁移器与 golden fixtures |

**开放问题 3（PENDING_USER_AUTHORIZATION）**：兼容窗口是否必须支持 v6 旧工程（`NETLAB_V2_PLANNING_REVIEW.md:136`）。未裁定前按「v7 必保，v6 沿用现有 migrate_project 不扩展」的最小方案设计，不删除现有迁移器、不承诺 v6 新特性。

**开放问题 1（PENDING_USER_AUTHORIZATION）**：项目保存是否允许显式 Runtime 快照。默认不含；未裁定前 `RuntimeSnapshot` 不进工程 schema。见 `ENGINE_LIFECYCLE.md` §5。

## 4. 适配层（旧工程可读）

```
load_project(bytes)
  -> decode / 版本识别
  -> v7 适配层：NodeRecord/EdgeRecord -> SceneDesc + Runtime 初值
  -> PortDef -> PortType 默认投影（无 unit 时用 domain 默认量纲）
  -> EngineSpec 注册表解析 mode
  -> validate -> compile -> create_runtime
save_project(desc)
  -> 默认只写 Desc（+ 可选显式快照，待裁定）
  -> 按原版本回写，字段只加不删
```

验收要求（ROADMAP §2）：旧工程可通过适配层读取，旧 API 不破坏；golden round-trip fixtures 覆盖 v7 场景；`LayoutEdge` / 外观字段不进编译缓存键。

## 5. 回滚与风险（对照审计 R1–R6）

| 风险 | 说明 | 缓解 | 可回退单元 |
| --- | --- | --- | --- |
| R1 破坏元件数值 | `CircuitElement.stamp` 与 descriptor A/E 的 dt/mode/omega 上下文不同 | 先 shadow 对拍，保留 legacy 分支一个版本 | 单元件迁移提交 |
| R2 改变 AC 结果 | Descriptor 理想电感 vs Legacy `DC_CONDUCTANCE=1e5`；复数端口 | 固化阈值/测试矩阵，`DescriptorModel.frequency_response` 作 wrapper | 默认开关保持关闭 |
| R3 Node/Record 拆分破坏工程格式 | `NodeRecord` 是 UI/JSON 契约 | 字段只加不删、v7→v8 迁移器、round-trip golden | 适配层独立提交 |
| R4 Plugin 项目加载 | 插件 mode 当前被 `Scene.load_payload` 拒绝 | 先 Engine SPI 与静态校验，manifest 白名单 | SPI 独立提交 |
| R5 前端改动影响交互 | `app.ts` 规模大、手工 API body | 抽 `analysis_client.ts` + 结果 DTO、UI 状态机独立测试 | 前端拆分独立提交 |
| R6 性能回归 | 每步深拷贝、快照成本 | 先加 204/400 基准、快照接口逐步替换、不在 P1 改默认 | 基准与开关独立提交 |

顺序（`CORE_ARCHITECTURE_AUDIT.md:385`）：P1-A 设计冻结 → P1-R1/R2 数值统一 → P1-S1 DTO 分层 → P1-S2 Engine SPI v2 → P1-S3 前端拆分。**P1-R1/R2 先于大规模 Node/Connection 拆分**，否则拆模型会放大两套数值路径差异。

## 6. 待用户裁定的开放问题（Open Question / PENDING_USER_AUTHORIZATION）

1. **兼容窗口是否必须支持 v6 旧工程**：见 §3；影响迁移器范围与 golden fixtures 数量。
2. **项目保存是否允许显式 Runtime 快照**：见 `ENGINE_LIFECYCLE.md` §5。
3. **Plugin 权限边界（只读/可写哪些层）**：见 `ARCHITECTURE_BOUNDARIES.md` §6。

三项均标为 `PENDING_USER_AUTHORIZATION`，本阶段不代替用户裁定；`ADR-001/002/003/004/006/007` 保持 `Proposed`。
