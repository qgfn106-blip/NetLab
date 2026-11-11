# ADR-006: Equation 与 Numerical Backend 分离

- **状态**：Proposed
- **决策者**：用户（2026-11-11 正式裁决）
- **关联**：`NETLAB_V2_PLANNING_REVIEW.md` §5；`PROJECT_STATUS.md`

## 背景

P3 需要从“节点/连接图”上升到方程/约束表达；若 Equation 层直接依赖具体求解器，后续无法支持电路、机械等不同数值后端。

## 决策

1. 保留五层边界：**Model Representation / Structural Analysis / Equation Assembly / Numerical Backend / Execution Plan**。
2. Equation 层只描述变量、方程、约束与结构语义，不直接依赖具体求解器；数值后端通过明确接口接入。
3. 不要求“一切转 DAG”；代数环、反馈连接与一般程序循环是不同概念，需分别表达。
4. P3 先做研究型最小原型，但架构按未来生产级科学计算平台要求设计；第一阶段电路试点，第二阶段机械动力学试点。
5. 若同一表达层无法合理描述电路与机械，应重审抽象，不得强行统一；不得因原型大规模重写现有电路求解器。

## 影响

- P2 Core Model V2 必须先提供 Typed Port/三型 Edge/兼容层基础。
- 需要为电路与机械各写最小模型示例，并建立数值正确性/性能基准。
