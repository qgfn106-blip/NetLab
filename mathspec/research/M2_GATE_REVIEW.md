# M2 启用评审：`NETLAB_MATH_ACCEL=on`（R43）

> 评审日期：2026-11-06 21:20（Asia/Shanghai）
> 评审对象：P3 AC 扫频 Woodbury `on` 路径（P1 排序评测不纳入启用范围）
> 依据：`NetlabHome/netlab/docs/MATH_INTEGRATION_PLAN.md` §5.3、§6 M2
> 结论：**通过（有条件）**——批准 `on` 作为显式 opt-in；默认仍为 `off`；P1 生产路径保持 COLAMD。

## 1. 评审环境

| 项 | 值 |
|---|---|
| CPU | Intel(R) Core(TM) Ultra 9 185H |
| 内存 | 16 GB |
| Python | 3.13.9 |
| NumPy | 2.3.5 |
| SciPy | 1.16.3 |
| 基准方法 | `tools/eval_p3_ac_corpus.py`，每个规模 3 次取中位数（`repeats=3`） |

## 2. §5.3 统一门槛核对

| 门槛 | 实测/证据 | 结果 |
|---|---|---|
| P3 对拍误差 `max_rel_err < 1e-10` | 多轮 3 次中位：4.14e-14 – 1.72e-13 | **PASS** |
| P3 加速比：`r/n ≤ 0.10` 语料平均 `≥ 2×` | 最近一轮：n=201 1.21×、n=301 3.62×、n=399 23.45×，均值 **9.43×**；上一轮：1.84/2.29/2.32×，均值 **2.15×** | **PASS（按"语料平均"口径）**；单点 n=201 可能低于 2×，已在报告中如实标注 |
| P1 fill-in：至少 2 类真实矩阵 factor ≥15% 或 fill-in ≥20% | 真实语料 2 个 circuit，仅 1/2 达标；判定未过 DoD | **FAIL → 不替换**，生产 `_solve_sparse` 保持 COLAMD；P1 不进入 M2 |
| P1 数值 solve 相对误差 `<1e-10` | P1 只读评测、不改求解路径，不适用 | **N/A** |
| P5 接口：`/api/live` schema 零变化；诊断字段齐全 | `test_telemetry_quality.py` 固定断言 `/api/live` 顶层 keys = frames/cursor/oldest/keys/generation/sim；`/api/diagnostics/telemetry` 字段齐全 | **PASS** |
| 全量回归：mathspec 全绿、netlab 现有测试全绿 | mathspec **107 passed**；netlab **606 passed / 1 skipped**（92.00s）；前端 node --test **5 passed** | **PASS** |
| 性能测试记录机器、版本、三次中位数，不写死单次绝对耗时 | 见 §1 与 `P3_AC_CORPUS_REPORT.md`（3 次中位、环境齐全） | **PASS** |

## 3. 启用条件（硬约束）

`on` 仅在以下条件**全部满足**时生效，否则自动回退 `np.linalg.solve`：

1. 矩阵规模 `n ≥ AC_WOODBURY_MIN_SIZE = 160`；
2. 无功元件占比 `r/n ≤ 0.10`（0.10–0.25 仅 shadow；>0.25 一律 direct）；
3. `ACWoodburySolver` 的主元/条件数守卫通过（`cond_limit=1e10`，最小主元检查）；
4. 仅纯 LTI RLC + 受控源场景；AC 已拒绝二极管/晶体管/opamp 等非线性元件；
5. 默认 `NETLAB_MATH_ACCEL=off` 不变；`on` 只允许显式环境变量或显式测试/评审中开启。

## 4. 代码评审清单

| 检查项 | 结果 |
|---|---|
| `config.py` 未非法值时 warning 并回退 off | PASS |
| `nodal.ac_sweep` 默认 off 路径未改变行为（逐频点 `np.linalg.solve`） | PASS |
| Woodbury 异常捕获后记录 `p3.shadow_error` 并回退 direct | PASS |
| 诊断事件 `p3.init`/`p3.used`/`p3.shadow` 可用 `/api/diagnostics/math-accel` 读取 | PASS |
| `test_math_accel.py` 覆盖 off/shadow/on 结果一致、小矩阵跳过、大梯形对拍 | PASS（7 条） |
| 未修改 `/api/live` 响应结构 | PASS（测试固定 keys） |
| 未改变 `MAX_NODES/EDGES/FIELDS` 上限 | PASS |

## 5. 风险与遗留

- **基准抖动**：同一规模跨轮次 off 时间可差一个数量级（机器负载/散热/BLAS 线程调度），所以报告只承诺"3 次中位"与规模趋势，不承诺绝对耗时；M2 评审以门槛与守卫为准。
- **真实 AC 语料为 0**：`MyProject` 的 2 个 circuit 工程均含 AC 不支持元件（nmos/opamp），P3 只在"真实参数派生规模族"上验证，报告已标注"非真实拓扑"。
- **规模上限**：`MAX_NODES=400`，当前最大可测 n=399；更大规模尚未验证。
- **P1 未替换**：排序评测结论不进入生产，仅保留 `tools/eval_mna_ordering.py` 与报告作为后续扩语料依据。

## 6. 结论

**M2 评审通过（有条件）**：

1. P3 `on` 可进入"显式 opt-in"状态，默认仍 `off`；
2. P1 不替换生产排序（保持 COLAMD），不阻塞 M2；
3. P5/P5.2 的 `/api/live` 零变更与诊断字段已由测试锁定；
4. 若后续要把 `on` 设为默认，需要另开评审（真实 AC 语料 + 更大规模 + 长稳压测），本轮不批准默认开启。
