# NetLab 里程碑（精简版）

> 本文件只记录可对外复述的阶段结果；`PROGRESS.md` 保留为逐轮会话日志（含失败、返工和中间证据）。
> 最后更新：2026-11-09（B-3 命名空间/状态新鲜度；历史基线 HEAD `9cc5641`，当前状态见 `status.json`）

| 日期 | 里程碑 | 可复现证据 |
|---|---|---|
| 2026-11-07 | 全量文档重构与静态基线 3.20.1 | `PROGRESS.md` §7.75；`pytest` 627 passed / 1 skipped（历史值，不冒充当前值） |
| 2026-11-08 | 数学规格 §33/§17 补齐数据结构与检查点模型 | `PERFORMANCE_AND_CONCURRENCY.md` §33.5、§34；`UNIFIED_SIM_MATH_SPEC.md` §17.6 |
| 2026-11-08 | P0 默认稀疏阈值 200→512（只改默认，不改 `on/off`） | `REQUIREMENTS_AND_RULES.md` D120；`test_solver_sparse.py`；390-node RC 基准 |
| 2026-11-08 | 审计 A-1/A-2：自动延迟显式化、代数求解开关持久化 | D121；`test_no_silent_topology_rewrite.py`；`PUT /api/scene/algebraic` |
| 2026-11-08 | 审计 A-3：共享 `SimClock` 与真实采样间隔 | D122；`test_sim_clock.py`；四套 `time` 一致性测试 |
| 2026-11-08 | 审计 A-4/A-6：数值基准与 pytest CI | D123；`netlab/tests/benchmarks/test_numerical_benchmarks.py`；`.github/workflows/python-tests.yml` |
| 2026-11-08 | 审计 A 阶段全量验证 | `python -m pytest netlab/tests -q` → 665 passed / 1 skipped / 4 warnings（114.99s / 94.80s / 86.64s 三次） |
| 2026-11-08 | D125 PlotKit 插件封装 | `python -m pytest netlab/tests -q` → 670 passed / 1 skipped / 4 warnings / 90.37s；PlotKit 相关 7 文件 23 passed |
| 2026-11-08 | A-5/N-08 稳定通道键 | D127；`test_probe_channels_use_stable_ids_across_rename`；全量 671 passed / 1 skipped / 85.99s |
| 2026-11-08 | A-3/N-36 步骤事务第一步 | D130；`test_solver_transactions.py` 8 passed；全量 673 passed / 1 skipped / 97.32s |
| 2026-11-08 | A-5/N-10 records 拆分第一片 | D131；`netlab/core/model/records.py`；全量 673 passed / 1 skipped / 101.15s |
| 2026-11-08 | D-3/N-30 文档隐私首轮清理 | D132；`test_docs_do_not_contain_private_paths`；全量 675 passed / 1 skipped / 98.01s |
| 2026-11-08 | D-4/N-28 二阶控制端到端实验 | D133；`tools/e2e_control_experiment.py`；误差表三项通过 |

## 未完成（按审计 §4 门控）

- A-3 的 N-36：冗余全量 `Scene.capture_checkpoint()` 深拷贝已移除（D130/§7.98）；`Network.capture_step_state()` 仍为 O(n) 浅快照，真正增量 undo log/COW 与单步开销不随规模线性增长尚未实现。
- A-5 的 N-08：稳定通道键已实现（D127）；巨石文件拆分仍待办。
- B/C/D 其余项见 `PROGRESS.md` §7.92 与审计文档 §4；D-4 的单场景端到端脚本已交付（D133），D-3 文档分层、D-4 其他场景、D-5 shadow 门仍待办；PlotKit P 项不属于 NetLab 修复范围（C-4 接口收敛除外）。
