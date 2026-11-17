# WP-8：稀疏阈值复核（未上调）

- 日期：2026-11-18
- 范围：`netlab/core/compute/circuit/solver.py` 的 `_decide_sparse()` 与
  `SolverOptions.sparse_threshold` / `SimConfig.sparse_threshold`
- 结论：**保持默认 512**。配对基准无法证明上调到 600 有稳健全局收益。

## 1. 预声明与输入族

| 项 | 值 |
| --- | --- |
| 规模 | 400 / 600 / 800 / 1000 / 1100 / 1200 / 1300 / 1400 / 1500 / 1600 / 1800 / 2000 / 2500 未知量 |
| 拓扑 | ladder（RC 梯形）、grid（二维网格）、star（星形） |
| 模式 | 显式 `sparse=off`（dense）与 `sparse=on`（splu）配对 |
| 每点 | warmup 2 + repeat 9；同一 family/size 内交替，避免单轮热漂移 |
| 验收 | 至少一个规模区间达到预声明收益，且小规模不退化；全局阈值必须对所有拓扑成立 |

基准工具：`tools/bench_solver_sparse.py`；原始数据：
`reports/bench_solver_sparse.json`、`reports/bench_solver_sparse_sweep.json`、
`reports/bench_solver_sparse_confirm.json`。

## 2. 关键 p50（dense / sparse，ms）

| 未知量 | ladder | grid | star |
| --- | --- | --- | --- |
| 600 | 23.52 / 24.45 | 51.50 / 71.35 | 52.06 / 60.00 |
| 800 | 49.57 / 61.07 | 97.61 / 119.03 | 103.76 / 80.29 |
| 1000 | 74.10 / 43.86 | 145.2 / 94.2 | 103.9 / 52.5 |
| 1500 | 391.6 / 131.1 | — | — |
| 2500 | 1264.7 / 219.5 | 1350.1 / 296.8 | 1296.7 / 201.0 |

600 处三种拓扑方向不一致：ladder/star 偏稀疏，grid 明显偏稠密；
650/700/750 的中间扫描也没有稳定的统一交叉点。

## 3. 为什么不上调

- 主基准在 600 显示 dense 全胜；21 次重复确认却显示 ladder/star 的 sparse
  更快（600 ladder 52.32 / 48.64、grid 40.33 / 53.53、star 45.54 / 40.58）。
- 同一配置的绝对 p50 跨轮可相差约 2 倍，paired ratio 的中位数与双方独立 p50
  也不一致；这是 BLAS 预热/调频/缓存顺序造成的系统噪声，不是可复现的算法收益。
- 因此 600 没有可证明的全局安全收益：若按 ladder/star 上调，grid 会退化；
  若按 grid 保持 512，则产品默认路径不变。没有满足「小规模不退化」的全局阈值。

## 4. 回退与当前行为

- `SolverOptions.sparse_threshold` 与 `SimConfig.sparse_threshold` 保持 **512**；
  `solver.py:262` 的 fallback 同为 512。
- 显式 `sparse="on"` / `sparse="off"` 不受阈值影响，行为不变。
- 边界测试：`netlab/tests/test_solver_sparse.py::test_default_sparse_threshold_boundary`
  断言 512 未知量走 dense、513 走 sparse。
- 可单独回滚：本项没有改变默认路径，无需回滚；若未来重新评估，仍以
  `tools/bench_solver_sparse.py` 的配对数据为准，不采用单轮单样本结论。

## 5. 与 WP-8 验收的关系

本项是「未到盈亏平衡点默认走稳定路径」的负结果记录。它不提供规模收益，
因此 WP-8 的收益由 AC 扫频 Woodbury 提供（见 `WP8_AC_SWEEP.md`），
FEM 相关优化仍为 PENDING_USER_AUTHORIZATION。
