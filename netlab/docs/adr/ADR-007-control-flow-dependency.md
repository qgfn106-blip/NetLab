# ADR-007: Control Flow 与计算依赖分离

- **状态**：Proposed
- **决策者**：用户（2026-11-11 正式裁决）
- **关联**：`NETLAB_V2_PLANNING_REVIEW.md` §7；`PROJECT_STATUS.md`

## 背景

需要同时表达连续物理演进与离散控制逻辑；把控制流直接并入方程 DAG 会造成语义混乱、不可预测的执行顺序。

## 决策

1. 明确区分五类：**Dependency / Equation / Dynamic State / Control Flow / Event**；代数环、反馈连接、一般程序循环不是同一概念。
2. 初步采用“**确定性同步步进为基础，离散事件调度为补充**”：保留固定时间步；离散事件使用明确事件队列与时间排序；同时间戳事件有确定执行顺序与优先级/冲突规则。
3. 不因引入事件默认异步并发；物理时间推进与控制逻辑执行边界必须清晰。
4. Control Flow/State Machine 作为独立长期方向预留；未来可支持 Branch/StateMachine/EventTrigger/Timer/ConditionalTransition/Loop/Controller，但当前不实施完整通用运行时，不承诺图灵完备。

## 影响

- P5 只做架构预留与接口研究，不进入当前主线实现。
- 若未来与 P3 Equation 层合并，必须保持上述五类语义边界。
