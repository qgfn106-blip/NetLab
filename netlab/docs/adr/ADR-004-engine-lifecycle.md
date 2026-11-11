# ADR-004: Engine 生命周期接口

- **状态**：Proposed
- **决策者**：用户（2026-11-11 正式裁决）
- **关联**：`NETLAB_V2_PLANNING_REVIEW.md` §3、§6；`PROJECT_STATUS.md`

## 背景

现有 Scene/NetworkContainer 按 mode 硬编码选择引擎；插件可注册 engine，但缺少统一的创建、验证、快照、恢复、销毁契约，且插件边界不清。

## 决策

1. 引擎通过公开稳定的 **Engine API** 注册与使用；至少定义：
   - 声明支持的模型/节点/端口类型与能力（capabilities）
   - `validate`、`compile`（如需要）、`create_runtime`、`step`、`snapshot`、`restore`、`dispose`
2. 插件 v1 继续兼容；插件可注册受支持的扩展类型与自定义 Solver/Engine，但不得直接修改核心私有状态或绕过生命周期。
3. Plugin v1 是**受信任的进程内 Python**，不是安全沙箱；不得把 API 权限控制描述为 OS 安全隔离。若未来支持不可信插件，必须单独立项设计进程隔离、权限声明、通信协议与资源限制。
4. 项目级逻辑隔离可与进程内插件共存，但必须明确“逻辑隔离/API 权限控制/OS 安全隔离”的区别。

## 影响

- P4 才实现完整 Runtime/Plugin V2；当前阶段只冻结接口原则与边界。
- Engine SPI 需要兼容现有 signal/circuit/vector 引擎，先通过适配层接入。
