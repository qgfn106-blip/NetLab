# ADR-008：阶段 4 设计冻结的三项待决问题

- 状态：`Proposed`（Open Decision，不是实施授权）
- 日期：2026-11-12
- 范围：`netlab/docs/CORE_MODEL_V2.md`、`ENGINE_LIFECYCLE.md`、`MIGRATION_AND_COMPATIBILITY.md`、`ARCHITECTURE_BOUNDARIES.md`

本 ADR 记录阶段 4 设计评审中三项必须由用户决定的问题。按纪律，以下均为 `PENDING_USER_AUTHORIZATION`，本文只列选项、技术后果与推荐，不代替用户裁定。

## 决策 A：项目保存是否允许显式 Runtime 快照

- 选项 A1：普通保存只存 Description，运行态快照单独导出（默认推荐）。
- 选项 A2：项目文件内嵌可选 `runtime_snapshot`，仅用户主动导出时存在。
- 选项 A3：项目文件默认包含运行态快照。
- 后果：A1 文件小、可复现性依赖重算；A2 兼顾断点与体积；A3 文件大、跨版本恢复风险高。
- 推荐：A2，且 `runtime_snapshot` 默认 `null`；恢复失败抛 `SnapshotRestoreError`，不回退物理模型。

## 决策 B：Plugin 权限边界（只读/可写哪些层）

- 选项 B1：Plugin 只读 PortType/EngineSpec + 写白名单 Parameter；不得直接访问 Runtime（推荐）。
- 选项 B2：Plugin 可注册 Engine，但不能替换内建 Engine。
- 选项 B3：Plugin 可写任意层（不推荐，等同进程内无边界）。
- 后果：B1 最安全但扩展能力有限；B2 扩展强但需 EngineSpec 审核；B3 风险不可控。
- 推荐：B1 + B2 的受控组合（注册自定义 Engine 经 `EngineSpec.factory`，不替换内建）；Plugin v1 明确不是 OS 沙箱。

## 决策 C：兼容窗口是否必须支持 v6 旧项目

- 选项 C1：只保证 v7 → v8 迁移，v6 需先升 v7（推荐）。
- 选项 C2：直接只读支持 v6，内部升至 v8。
- 选项 C3：不支持 v6，读入即报错。
- 后果：C1 兼容成本可控；C2 迁移逻辑复杂但用户平滑；C3 最简单但可能丢旧工程。
- 推荐：C1，并提供只读兼容适配层与明确迁移提示；是否必须 C2 由用户裁定。

## 结论

三项均保持 Open Decision；在用户明确裁定前，任何文档不得写成已定或已实现，也不得据此实施 V2 迁移。
