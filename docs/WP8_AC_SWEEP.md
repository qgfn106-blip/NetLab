# WP-8：AC 扫频低秩 Woodbury（opt-in）

- 日期：2026-11-18
- 范围：`netlab/core/compute/circuit/solver.py` 的 `ac_sweep()` 与
  `netlab/core/compute/math_accel/woodbury_ac.py`
- 默认：`NETLAB_MATH_ACCEL` / `NETLAB_MATH_ACCEL_P3` 均为 **off**；原有稠密逐频点解
  仍是默认稳定路径。启用方式：`NETLAB_MATH_ACCEL=on` 或 `NETLAB_MATH_ACCEL_P3=on`。
- 回滚：取消环境变量（或设回 `off`）即可；不涉及数据迁移，可单独关闭。

## 1. 做了什么

1. **去掉构造期的 SVD 条件数**：`ACWoodburySolver.__init__` 原先调用
   `np.linalg.cond(a0)`（FULL SVD，O(n³)），在 n=400 约 0.4 s、n=800 约 2 s，
   把低秩收益吃掉。改为 LU 主元比 `max_pivot / min_pivot`，只作可用性门禁与诊断；
   真实精度由逐频点后向残差守卫负责。
2. **去掉冗余 refine**：fast 分支原来先 `solve(refine_steps=1)` 再做一次
   `relative_residual`，相当于每频点多一次 `_apply` + LU 回代。现改为
   `solve(refine_steps=0)`，随后用 `relative_residual` 校验；残差 `>1e-8` 或非有限
   时回退 `np.linalg.solve(solver.matrix(omega), ctx.rhs)`，并记录
   `p3.fallback`（含 n/r/ratio/omega/residual）。
3. **保留预计算**：`Z = A0^{-1} E`、`G = E^H Z` 在构造期一次完成；每频点只解
   r×r 小系统，不再重复 LU 分解。

代码位置：`solver.py:1126`（size ≥ `AC_WOODBURY_MIN_SIZE=160` 且 mode≠off 才构造）、
`:1162`（fast 门禁 `mode=="on"`、`usable`、`ratio<=0.10`）、`:1204`
（`solve(refine_steps=0)`）、`:1205-1219`（残差守卫与回退）。

## 2. 预声明

| 项 | 值 |
| --- | --- |
| 最小 Woodbury 规模 | 160 未知量（`AC_WOODBURY_MIN_SIZE`） |
| 收益门槛 | 任一规模区间 `speedup_p50 >= 1.20x` |
| 小规模退化 | 默认 off，不改变小规模路径；opt-in 在 n<160 不构造 Woodbury |
| 残差门槛 | 每频点后向相对残差 `<=1e-8`，否则回退 |
| 精度门槛 | opt-in 相对直接解 `max_abs_error <= 1e-9` |

## 3. 输入族与硬件

- 输入：RC 梯形网络（每 20 节一只对地电容），n=400/600/800 非地节点；
  200 个对数频点（10 Hz–100 kHz），单探针 `n1`。
- 另测产品默认的全节点探针：n=400、100 频点。
- 同一 solver、同一组频点内交替测 dense / Woodbury，warmup 1、repeat 7（全节点 5）。
- 硬件指纹：Windows 11 10.0.26300、Python 3.13.9、NumPy 2.3.5、SciPy 1.16.3、
  Intel64 Family 6 Model 170、22 线程；BLAS 固定 1 线程。
- 原始数据：`reports/bench_ac_woodbury.json`、`reports/bench_ac_woodbury_all_probes.json`、
  `reports/bench_ac_woodbury_lowfreq.json`；工具：`tools/bench_ac_woodbury.py`。

## 4. 结果

### 4.1 单探针、200 频点

| n | off p50 / p95 (ms) | on p50 / p95 (ms) | speedup p50 | max_abs_error | fallback | RSS Δ |
| --- | --- | --- | --- | --- | --- | --- |
| 400 | 4696.5 / 4969.0 | 591.6 / 621.6 | **7.94x** | 1.81e-15 | 0 | +0.69 MB |
| 600 | 12079.5 / 12885.9 | 1095.3 / 1471.6 | **11.03x** | 1.44e-15 | 0 | +0.10 MB |
| 800 | 25491.2 / 26672.0 | 2905.3 / 3006.8 | **8.77x** | 1.36e-15 | 0 | +0.57 MB |

### 4.2 全节点探针、100 频点（n=400）

| off p50 / p95 | on p50 / p95 | speedup p50 | max_abs_error | fallback | RSS Δ |
| --- | --- | --- | --- | --- | --- |
| 5344.5 / 5519.0 ms | 3546.5 / 3895.4 ms | **1.51x** | 1.84e-13 | 0 | +13.4 MB |

全节点路径的 RSS 增量主要来自 400 个探针的响应数组，不是 Woodbury 小矩阵；
单探针路径的 Woodbury 额外内存 <1 MB。

### 4.3 低频点边界

50 频点时仍有收益：n=400 3.94x、n=800 3.35x（max_abs_error ≤1.58e-15，
fallback=0）。因此本实现没有出现「频点少导致净退化」的区间；但默认仍保持 off，
避免把 opt-in 的复杂度带进默认路径。

## 5. 与验收标准对照

- **before/after**：同一 solver 交替配对，off 为直接解基线；见上表。
- **输入族**：n=400/600/800、50/100/200 频点、单探针/全节点探针。
- **硬件指纹**：JSON 的 `environment` 字段；BLAS 线程固定。
- **p50/p95/RSS**：见上表与原始 JSON。
- **误差/残差**：max_abs_error 1e-15–1e-13；正常路径 fallback=0；守卫路径有测试。
- **失败回退可观测**：`p3.fallback` 诊断；`test_fast_path_residual_guard_falls_back`
  强制错误低秩解，断言回退后与直接解一致。
- **至少一个规模区间收益**：单探针 7.9–11.0x，全节点 1.51x，均超过 1.2x 门槛。
- **小规模不退化**：默认 off；n<160 不构造 Woodbury。opt-in 的 n=400 也仍有收益。
- **默认稳定路径**：默认 off，原有逐频点稠密解不变。
- **可单独回滚**：环境变量关闭，不需要改代码或数据。

## 6. 未纳入

- FEM 的 CSR/LU 复用属于硬冻结范围，未读取、未修改、未测试；记为
  PENDING_USER_AUTHORIZATION。
- `descriptor.py` 的描述符频响路径不在本次改动内；它仍逐频点
  `np.linalg.solve`，作为独立后续项。
