# ADR-001: Description / Runtime 分离

- **状态**：Proposed
- **决策者**：用户（2026-11-11 正式裁决）
- **关联**：`NETLAB_V2_PLANNING_REVIEW.md` §3、§9；`PROJECT_STATUS.md`

## 背景

当前 `Node`/`Connection` 同时承载描述数据与运行时状态；通用平台需要区分“模型描述”与“运行实例”，否则保存、复用、编译和插件边界都会变得模糊。

## 决策

1. **Description**（模型描述）与 **Runtime**（运行实例）严格分离：Description 只描述模型结构与参数，Runtime 保存运行时状态、积分器/求解器内部状态与动态数据。
2. Runtime 不得反向修改 Description 的语义；需要可变参数时通过明确的参数更新路径或新版本 Description。
3. 普通项目保存只保存 Description / SceneDoc / 参数 / 必要的 Presentation；Runtime 快照为独立可选能力，见 ADR-005/`PROJECT_STATUS.md` 的保存边界。
4. 引擎通过明确的生命周期接口创建、驱动和销毁 Runtime（与 ADR-004 一致）。

## 影响

- P2 可在不重写现有 `graph.py`/`scene.py` 内核的前提下逐步引入 Description/Runtime 边界。
- 需要定义兼容层，避免现有项目 JSON 与旧 API 立即失效。

## 未验证项

- 具体类与序列化边界尚未在代码中落地；需 P2-A 的最小数据模型示例先行验证。
- 与现有 `Node.data`、`Scene` 状态、`Recorder` 的关系需在实现阶段逐项对拍。
