# 2026-11-08 审计修复会话记录

## 目标

按 `NETLAB_PLOTKIT_AUDIT_AND_REMEDIATION.md` 的 §5 契约（S0–S4、R1–R11）逐轮修复 NetLab，先完成 P0 正确性止血，再推进 P1/P2；每轮保持工程文件与文档同步。

## 基线

- 仓库：NetlabHome（工作树）
- 起始 HEAD：`9cc5641d4e2318fd0e2933a7c6f993231bd1b8cc`
- 审计文档：36 个 NetLab N 项、11 个 PlotKit P 项、6 个 P0（N-01/N-02/N-03/N-04/N-15/N-19）
- 初始测试：652 collected；后续随新增回归/基准测试增长

## 已完成

- A-1/A-2：`auto_delay` 默认关闭，显式 opt-in；静默拓扑改写改为带路径的 `ConflictError`；`solve_algebraic` 持久化并新增显式 API/UI 开关（D121）。
- A-3：共享 `SimClock`，`Network`/`CircuitSolver`/`FemModel`/`Simulation.time` 使用同一时钟；recorder `sample_dt` 记录真实采样间隔；`SimConfig` 拆分数值参数与呈现参数（D122）。
- A-4：新增数值基准测试（RC/RL 解析解、后向欧拉收敛阶、AC/DC 一致性）与 MOSFET/RLC 扩展（D123）。
- A-5：稳定通道键（D127）与 `records.py` 拆分（D131）。
- A-6：新增 Python CI 工作流；收紧控制项目超调区间与预计算检查。
- D-4：新增 `tools/e2e_control_experiment.py` 端到端二阶控制实验（D133）。
- D-5 前置：`math_accel` 的 off/shadow/on 模式已存在；求解器影子门仍待接入。
- 测试与文档：全量 `675 passed / 1 skipped / 4 warnings`（2026-11-08），PROGRESS §7.90–§7.102；DOCS_INDEX 已同步 D1–D134。

## 仍未完成

- A-3 N-36：已去掉 `Simulation._advance_locked` 的每步全量 `Scene.capture_checkpoint()`，但真正的增量 undo log/COW 与成本随规模近线性的证明仍待补。
- A-5 N-10：`server.py`、`nodal.py`、`frontend/app.ts` 仍是巨石文件，需要继续按域拆分。
- C-1/C-3：路由按域拆分与两条绘图路径的帧语义一致性。
- D-3/D-4 其余场景/D-5：文档分层收尾、更多端到端场景、求解器影子门。

## 下一步

1. 继续 A-5/N-10 的低风险模块拆分并保持兼容。
2. 接入 D-5 求解器 off/shadow/on 门。
3. 完成 D-3 文档分层索引与隐私扫描。
