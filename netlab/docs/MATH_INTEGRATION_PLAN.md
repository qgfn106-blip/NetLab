# NetLab 数学成果接入规划与影子验证计划

> 版本：v1.8（M0 完成、M1a P1 评测完成、M1b P3 影子实现 + fast path + n≥160 小矩阵守卫 + 真实参数规模族验证、M1c P5 遥测 + 前端误差合同、M1d 集成回归完成、P5.2 真实插值/FIFO 误差界完成、M2 启用评审完成：on 仅 opt-in、默认仍 off、P1 不替换）
> 日期：2026-11-06
> 状态：**M0–M1d 已完成**——M0 mathspec 原型、M1a P1 排序评测、M1b P3 影子路径、M1c P5 遥测、M1d 集成回归均通过测试；P1 真实语料 1/2 未过 DoD，生产路径保持 COLAMD（评测器与合成证据保留）。P3 真实工程无法直接覆盖（nmos/opamp 不支持 AC），真实参数派生族 n≥301 实测 2.29–2.32×、n=201 1.84×。P5 只读诊断与设置页「诊断」误差合同已就绪。默认 `off`，不改变既有行为。
> 上游依据：[UNIFIED_SIM_MATH_SPEC.md](UNIFIED_SIM_MATH_SPEC.md)（数学规范）、[PERFORMANCE_AND_CONCURRENCY.md](PERFORMANCE_AND_CONCURRENCY.md)（研究记录）、`NetlabHome/mathspec/`（零耦合参考实现，当前 107 passed）。
> 主规划入口：[BACKLOG.md](BACKLOG.md) §1.1（本文件为独立副本，BACKLOG 只留一行指针与 DoD 摘要）。

---

## 0. 一页结论

**目标**：把 mathspec 中已经验证过的数学成果，按"**影子模式 → 达标 → 再启用**"的路径接入 netlab，优先解决两个真实问题：

1. **AC 扫频慢**：`nodal.ac_sweep` 每个频点都重新装配矩阵并做一次 `np.linalg.solve`，频点数最多 2001；用**双参数仿射族 + Woodbury** 把"每频点 O(n³)"降为"一次 O(n³) 分解 + 每频点 O(nr + r³)"。
2. **稀疏求解排序未评测**：`_solve_sparse` 固定 `splu` 默认 COLAMD；先用**排序评测器**在真实 + 合成矩阵上比较 COLAMD / MMD_ATA / MMD_AT_PLUS_A / NATURAL + 自研最小度/嵌套剖分，达标才替换。
3. **可信度口径**：为 Recorder 增加只读 `quality` 元数据与 `/api/diagnostics/telemetry`，把采样/量化/插值/FIFO 的误差预算写清楚（当前链路无量化/压缩，先立口径，为 P7 压缩预留合同）。

**第一波范围（Q2=B）**：只做 **P3 + P1 + P5**；P2（precompute 去锁）等列为后续工程线，不在本计划内。
**默认安全**：新增环境开关 `NETLAB_MATH_ACCEL=off|shadow|on`，默认 **off**；影子模式下新路径只算不生效，返回旧结果并记录误差/耗时。
**验收语料（Q7=A）**：`NetlabHome/MyProject` 现有 8 个 `.netlab` 工程的 circuit 场景导出真实 MNA 矩阵 + 合成 RC/RLC/随机稀疏矩阵族。

---

## 1. 目标与非目标

### 1.1 目标

- **更快**：在 `r/n ≤ 0.10` 的 AC 扫频场景，Woodbury 路径相对直接解平均加速 **≥ 2×**（记录实测，不承诺跨机器固定值）。
- **更可信**：AC 扫频影子对拍相对误差 **< 1e-10**；排序评测有可复现的 fill-in/时间/内存对照；遥测误差口径可被 UI/接口读取。
- **可回退**：任何新路径都能通过环境变量一键关闭，旧路径零改动保留。

### 1.2 非目标

- 不改 `precompute` 的锁语义，不改仿真线程模型（P2 及并发优化不在第一波）。
- 不改 `/api/live` 响应结构，不接前端（P5 只做后端只读诊断）。
- 不做分布式/多进程调度、不做 GPU 新内核、不做 MOR 在线切换。
- 不重写 `nodal` 的 Newton/收敛策略，只在 `ac_sweep` 的线性复数求解上做加速。

---

## 2. 现状与代码锚点

### 2.1 运行时事实（只读核实，2026-11-06）

| 位置 | 事实 | 影响 |
|---|---|---|
| `NetlabHome/netlab/core/compute/simulation.py:314` | `precompute` 在 `with self.lock:`（`:318`）内跑完整 0→T | 长任务持锁，属于 P2 工程线，不在本波 |
| `NetlabHome/netlab/core/compute/nodal.py:2034` | `_solve_matrix` 稠密路径有 LU 缓存（`_lu_cache`/`_lu_matrix`/`_cached_dt`） | 稀疏排序评估之外，稠密路径已相对优化 |
| `NetlabHome/netlab/core/compute/nodal.py:2124` | `_solve_sparse` 默认 `_splu(scaled)`（`:2161`），未显式指定 `permc_spec`（SciPy 默认 COLAMD） | P1 的评测对象 |
| `NetlabHome/netlab/core/compute/nodal.py:2145-2154` | 以矩阵字节级 key 做稀疏分解缓存 | P1 必须复用同一缓存语义，避免破坏 |
| `NetlabHome/netlab/core/compute/nodal.py:2289` | `ac_sweep` 入口 | P3 只改这里的分支 |
| `NetlabHome/netlab/core/compute/nodal.py:2374-2402` | `for frequency in freqs:` 每频点重建复数 MNA：对激励源设单位激励、其余源置零后重新 `element.stamp` 装配（**不调用** `element.prepare`） | P3 的优化对象 |
| `NetlabHome/netlab/core/compute/nodal.py:2392` | `solution = np.linalg.solve(ctx.A, ctx.rhs)`（complex 稠密） | P3 的参考实现 |
| `NetlabHome/netlab/core/common/limits.py:15-17` | `MAX_NODES=400`、`MAX_EDGES=1200`、`MAX_FIELDS=64` | 语料上界与性能预期按此校准 |

> **注（2026-11-07 追记）**：上表行号为 P3 落地前基线；P3 已按 §11 落地，当前 `ac_sweep` 入口为 `nodal.py:2335`，Woodbury 影子路径在 `nodal.py:2420-2539`（`_solve_matrix` 现 `nodal.py:2080`、`_solve_sparse` 现 `nodal.py:2170`、`_splu` 现 `nodal.py:2207`、稀疏分解缓存现 `nodal.py:2191-2200`）。

### 2.2 mathspec 可复用资产

| 模块 | 可复用内容 | 本计划用途 |
|---|---|---|
| `mathspec/experiments/observability.py` | 有限时域 Gramian、log-det 次模探针选择 | 后续探针布局（本波不接） |
| `mathspec/experiments/telemetry.py` | `crossing_quantization_bound`、`continuous_crossing_interpolation_bound`、`combined_event_time_bound`、`max_quantization_error_for_tolerance`、`fifo_window_delay_bound` | P5 的误差预算公式来源 |
| `mathspec/experiments/dataflow.py` | 量化/差分/CRC 重传/POD 误差界 | P7 数据链路（本波只留接口） |
| `mathspec/experiments/ordering.py` | `elimination_fill`、`rcm_order`、`min_degree_order`、`nested_dissection_order`、`ordering_report` | P1 的原型基础 |
| `mathspec/experiments/incremental.py` | `woodbury_solve` 低秩更新 | P3 的数学原型基础 |
| `mathspec/contract.py` | 可插拔契约原型（CORE_SCHEMA/ExtNamespace/EngineRegistry/KindRegistry） | 仅作约束参考，本波不改核心 schema |

---

## 3. 第一波三件套

### 3.1 P3：AC 扫频广义 Woodbury（旗舰）

#### 3.1.1 数学形式

原始复数 MNA：

$$
A(\omega)x=b,\qquad A(\omega)=G+j\omega C+\frac{1}{j\omega}\Gamma
$$

其中 $G$ 为电导/受控源贡献，$C$ 为电容 stamp 矩阵，$\Gamma$ 为电感逆 stamp 矩阵。在参考频点 $\omega_0$ 分解一次：

$$
A_0=A(\omega_0)=G+j\omega_0 C+\frac{1}{j\omega_0}\Gamma
$$

任意频点写成**双参数仿射族**（Q4=A）：

$$
A(\omega)=A_0+U\Sigma(\omega)V^{\mathsf T}
$$

- $U$ 的每一列 = 一个电抗元件对 MNA 的 stamp 向量（接地元件 1 列；浮地电容/电感 2 列，按两端节点差）；
- $V$ 的对应列 = 同一 stamp 的转置方向（对称元件时 $V=U$）；
- $\Sigma(\omega)$ 为块对角：电容块 $j(\omega-\omega_0)C_i$，电感块 $\left(\frac{1}{j\omega}-\frac{1}{j\omega_0}\right)\Gamma_i$；
- $r=\mathrm{rank}(U)=\mathrm{rank}(V)$ 约为电抗 stamp 数（不是节点数）。

用 Woodbury 恒等式，每频点只解 $r\times r$ 小系统：

$$
x=A_0^{-1}b-A_0^{-1}U\left(I+\Sigma V^{\mathsf T}A_0^{-1}U\right)^{-1}\Sigma V^{\mathsf T}A_0^{-1}b
$$

**复杂度**：一次 $A_0$ 的 LU $O(n^3/3)$；每频点 $O(nr+r^3)$（两次 $n\times r$ 回代 + 小解）。对比每频点直接 `np.linalg.solve` 的 $O(n^3/3)$，理想加速比约 $n/(3r)$（忽略常数与 BLAS 差异）。

#### 3.1.2 门控与守卫（Q4=A）

| 条件 | 行为 |
|---|---|
| `矩阵规模 size < AC_WOODBURY_MIN_SIZE=160` | 不构造 Woodbury（`woodbury_ac.py:27`；门控 `nodal.py:2426`），小矩阵直接解更快 |
| `r/n ≤ 0.10` | 允许 Woodbury（`on` 时走新路径；`shadow` 时对拍） |
| `0.10 < r/n ≤ 0.25` | **仅影子**：计算并记录误差/耗时，返回直接解 |
| `r/n > 0.25` | 直接回退 `np.linalg.solve`（`solver.usable=False`，`reason` 记「r/n=… >max_ratio」，经 `record_math_diag("p3.init", …)` 上报，`nodal.py:2456`） |
| `A0` 条件数/主元守卫触发 | 回退直接解（`solver.usable=False`，`reason` 记「A0 条件数/主元过小/含非有限值」，同上上报） |
| 频点含 `ω ≤ 0` | `ac_sweep` 入口即 `ValidationError`（`nodal.py:2351-2352`），不存在 ω=0 分支 |
| 非电抗元件（开关/二极管/受控源变化） | 不进入仿射族，直接解 |

#### 3.1.3 实现落点

- 新增 `NetlabHome/netlab/core/compute/math_accel/woodbury_ac.py`（纯函数 + 数据类，不 import UI/全局状态）；
- `nodal.py:2335` `ac_sweep` 内加分支：`off`（现状）/`shadow`（双算对拍）/`on`（新路径 + 守卫）；
- 保持 `ctx.A`/`ctx.rhs` 的装配逻辑不变，只在"求解"处替换；
- 结果仍写回原 `solutions` 列表与返回结构，`/api/ac-sweep` 响应不变。

#### 3.1.4 DoD

- `shadow` 对拍：全部语料相对误差 `< 1e-10`（2-范数/逐点最大相对误差双口径）；
- `on` 在 `r/n ≤ 0.10` 语料上平均加速 `≥ 2×`，且 `p95` 单频误差 `< 1e-10`；
- 守卫场景（病态 A0、r/n>0.25；`ω ≤ 0` 在入口即 `ValidationError` 拒绝）全部按预期处理并记录原因；
- `NETLAB_MATH_ACCEL=off` 时零行为变化、零额外分配；
- pytest 新增测试 ≥ 8 条（含 1 条病态、1 条 r/n 边界、1 条 `ω ≤ 0` 拒绝）。

### 3.2 P1：稀疏排序评测器（低风险性能）

#### 3.2.1 候选与指标

- **候选**：`COLAMD`（现状）、`MMD_ATA`、`MMD_AT_PLUS_A`、`NATURAL`、自研 `min_degree`、`nested_dissection`（可先做预置换，再交给 `splu` 的 `permc_spec=NATURAL`）。
- **指标**：fill-in `nnz(L+U)`、factor 时间、solve 时间、峰值内存（`tracemalloc` + `resource` 可用时）、重排序耗时。
- **语料**：见 §5。

#### 3.2.2 实现落点

- 新增 `NetlabHome/netlab/core/compute/math_accel/ordering_eval.py`（只读评测，不改生产路径）；
- 输出 Markdown + CSV 对照表（可由脚本复现），结果先放 `NetlabHome/netlab/docs/` 的评测附录或 `mathspec/research/`；
- 只有达标项才进入 `_solve_sparse` 的候选实现，且在 `NETLAB_MATH_ACCEL=shadow` 下先对拍。

#### 3.2.3 DoD

- 至少 **2 类真实矩阵**达到：`factor 时间降低 ≥15%` 或 `fill-in 降低 ≥20%`，且 solve 结果相对误差 `< 1e-10`；
- 未达标时明确写"保持 COLAMD，不替换"，不硬上；
- 评测脚本可一键复跑，语料清单与随机种子固定。

### 3.3 P5：遥测误差口径（可信度）

#### 3.3.1 现实边界（必须先说清）

当前 `netlab` 的 `/api/live` 走 JSON 浮点，**链路上没有量化/压缩**；P5 不是修一个已存在的有损链路，而是：

1. 为 Recorder 建立 `quality` 元数据（采样步长、量化位宽、插值误差界、FIFO 深度/延迟界）；
2. 提供只读 `GET /api/diagnostics/telemetry`；
3. 为后续 P7（压缩/量化）建立"误差合同"字段与验收口径。

#### 3.3.2 数学口径

- 采样线性插值误差（连续信号）：$e_{\text{interp}} \le \frac{M h^2}{8}$，$M=\max|f''|$（需估计或保守上界；不能声称精确）；
- 量化穿越时间误差：`dt*epsilon/(d-2*epsilon)`，条件 `dt>0`、`epsilon>=0`、`d=|y1-y0|>2*epsilon`、不饱和、原重构同一首次穿越区间；区间改变时**拒绝**并给出边界原因；
- FIFO 窗口延迟界：`(Q+W)(A_s+(A-1)r+p)`（来自 mathspec telemetry，条件见 `telemetry.py` 文档字符串）。

#### 3.3.3 实现落点

- `Recorder`（`simulation.py` 的 `Recorder` 类）增加 `quality` 字典：`sample_dt`、`quant_bits`（当前 `None`）、`interp_error_bound`、`fifo_depth`、`delay_bound`、`assumptions`；
- `server.py` 新增只读 `@app.get("/api/diagnostics/telemetry")`，返回当前 `quality` 与说明；
- **不改** `/api/live` 的字段与语义；
- 前端暂不接入。

#### 3.3.4 DoD

- 字段齐全且 JSON schema 固定；
- `/api/live` 响应结构零改动（快照对比测试）；
- 文档明确写出"当前无量化/压缩，`quant_bits=None`"；
- 对 `d≤2ε`、区间改变等场景有显式拒绝测试。

---

## 4. 影子模式设计（Q3=A）

### 4.1 开关

- 全局：`NETLAB_MATH_ACCEL=off|shadow|on`，默认 `off`；
- 分项覆盖：`NETLAB_MATH_ACCEL_P3`、`NETLAB_MATH_ACCEL_P1`、`NETLAB_MATH_ACCEL_P5`（可选，未设则继承全局）；
- 解析集中在 `math_accel/config.py`，非法值报 `ValueError` 并回退 `off`（记录 warning）。

### 4.2 影子执行语义

```text
off    : 旧路径（现状，零改动）
shadow : 旧路径为主 → 新路径并行计算 → 比较误差/耗时 → 记录 → 返回旧结果
on     : 新路径为主 → 守卫失败则回退旧路径 → 记录 fallback 原因 → 返回新结果
```

- 对拍指标：`max_abs_err`、`max_rel_err`、`rms_rel_err`、`old_ms`、`new_ms`、`speedup`、`fallback_reason`；
- 记录位置：进程内环形缓冲 `math_accel.diagnostics`（容量 512），通过 `GET /api/diagnostics/math-accel` 只读查看（可选，若本波不做该端点则写日志）；
- **shadow 不得改变返回结果**（逐位对比旧结果；除浮点非确定性外应完全一致）。

### 4.3 安全约束

- shadow 计算不得持锁超过旧路径；若新路径异常，捕获并记录，绝不影响旧路径返回；
- 不在 shadow 下修改 `ctx.A`/`ctx.rhs` 的共享状态（使用副本或只读视图）；
- `on` 的守卫必须在求解前完成（条件数估计/主元检查）。

---

## 5. 验收语料与门槛（Q7=A）

### 5.1 真实矩阵

从 `NetlabHome/MyProject` 的 8 个 `.netlab` 工程导出 circuit 场景 MNA 矩阵：

- `grid_inverter_avg.netlab`
- `grid_inverter_current.netlab`
- `grid_inverter_switch.netlab`
- `pll_template.netlab`
- `underdamped_control.netlab`
- `二次控制.netlab`
- `未命名工程.netlab`
- `未命名工程.netlab.bak`（仅作重复性校验，不重复计数）

导出脚本输出 `corpus/manifest.json`：文件、场景、n、nnz、电抗元件数、r/n、备注。

### 5.2 合成矩阵族

- **RC 梯形**：n=50/100/200/400/800；
- **RLC 梯形**：n=50/100/200/400/800；
- **随机稀疏电路**：每节点度 2–6，随机 R/C/L，固定 5 个随机种子；
- **P3 分层**：按 `r/n ∈ {0.02, 0.05, 0.10, 0.25}` 各生成 3 个矩阵。

### 5.3 统一门槛

| 项目 | 门槛 |
|---|---|
| P3 对拍误差 | `max_rel_err < 1e-10`（双精度） |
| P3 加速比 | `r/n ≤ 0.10` 语料平均 `≥ 2×` |
| P1 fill-in | 至少 2 类真实矩阵降低 `≥20%` 或 factor `≥15%` |
| P1 数值 | solve 相对误差 `< 1e-10` |
| P5 接口 | `/api/live` schema 零变化；诊断字段齐全 |
| 全量回归 | `python -m pytest mathspec/tests -q` 全绿；`netlab` 现有测试全绿 |
| 性能测试 | 记录机器、Python/NumPy/SciPy 版本与三次取中位数，不写死单次绝对耗时 |

---

## 6. 里程碑与 DoD（Q11=A，Q12=A）

| 里程碑 | 内容 | 交付物 | DoD | 依赖 | 预计 |
|---|---|---|---|---|---|
| **M0** | mathspec 数学原型 | `mathspec/experiments/ac_sweep_woodbury.py`、`ordering_eval.py` + 测试 | P3 合成矩阵相对误差 `<1e-10`、r/n 门控可复现；P1 对照表生成；全部只依赖 numpy/scipy | 现有 mathspec | 3–5 天 |
| **M1a** | P1 排序评测 | `ordering_eval` 接入真实+合成语料，输出对照表 | 至少 2 类真实矩阵达标或明确"不替换" | M0 | 1–2 天 |
| **M1b** | P3 影子实现 | `netlab/core/compute/math_accel/woodbury_ac.py` + `nodal.ac_sweep` 分支 | shadow 对拍 `<1e-10`、`on` 平均 `≥2×`、守卫全过 | M1a（语料/脚本） | 3–5 天 |
| **M1c** | P5 遥测口径 | `Recorder.quality` + `/api/diagnostics/telemetry` | 字段齐全、`/api/live` 零改动、拒绝测试通过 | 可与 M1b 并行 | 1 天 |
| **M1d** | 影子集成回归 | `NETLAB_MATH_ACCEL` 开关、诊断记录、全量测试 | 默认 off 零影响；shadow 全绿；PR 可评审 | M1b/M1c | 1–2 天 |
| **M2（可选）** | `on` 启用评审 | 指标汇总、评审记录、PR 合并 | 达到 §5.3 门槛 + 人工评审；**2026-11-06 完成：见 `mathspec/research/M2_GATE_REVIEW.md`，结论=有条件通过（on 仅显式 opt-in、默认仍 off、P1 不替换）** | M1d | 1 天（已完成） |

**实施状态（2026-11-06 20:51）**：M0 完成（`mathspec` 新增 `ac_sweep_woodbury.py`、`ordering_eval.py`，9 条测试全过，全套 107 passed）；M1a 完成（真实语料 1/2 达标、未过 DoD → 生产保持 COLAMD；合成 n=400 `MMD_AT_PLUS_A` factor 0.793×/fill 0.625× 为观察信号）；M1b 完成（`netlab/core/compute/math_accel/` 四模块 + `nodal.ac_sweep` 分支，7 条专项测试全过；`AC_WOODBURY_MIN_SIZE=160` 小矩阵回退，n=201 1.59×、n=301 4.85×）；M1c 完成（`Recorder.quality` + `/api/diagnostics/telemetry`/`math-accel`，4 条测试；前端设置页「诊断」误差合同已接入）；P3 真实语料扩展完成（真实工程 0 个可直接覆盖，真实参数规模族 n=201/301/399 实测 1.84×/2.29×/2.32×，归一化误差 ≤1.7e-13）；M1d 完成（默认 `off` 零影响对拍、shadow/on 定向回归通过）；P5.2 完成（`telemetry_quality.py` 真实插值/FIFO 误差界，`test_telemetry_quality.py` 7 条；netlab 全量 **606 passed / 1 skipped**、mathspec 107 passed）。

---

## 7. 分支与合并（Q9=A）

- 从 **main** 新开 `feat/math-accel-shadow`（不基于 `feat/ts-migration`，不带入前端 TS 迁移改动）；
- 提交粒度：
  1. `math_accel/config.py` + 开关测试；
  2. P1 评测器 + 语料脚本；
  3. P3 Woodbury 模块 + 单元测试；
  4. `nodal.ac_sweep` 分支接入 + 影子对拍测试；
  5. P5 Recorder quality + 诊断端点 + 测试；
  6. 文档与评测报告。
- 合并条件：CI 全绿、shadow 报告达标、`NETLAB_MATH_ACCEL=off` 回归无差异；
- **回滚**：环境变量置 `off` 即恢复旧路径；代码层 revert 对应 commit，无数据迁移。

---

## 8. 风险与回滚

| 风险 | 触发条件 | 缓解 | 回滚 |
|---|---|---|---|
| A0 病态/主元过小 | 高 Q、近谐振、参数极端 | 条件数估计 + 主元守卫 + 直接解回退 | 自动回退 |
| 双参数仿射族不精确 | 元件随频率变化（非 LTI RLC）、开关/二极管 | 仅对纯 LTI RLC 启用；其他直接解 | `r/n>0.25` 或非电抗元件回退 |
| 排序反而变慢 | 小矩阵/特殊结构 | 评测器先验；只在达标矩阵族启用 | 保持 COLAMD |
| 影子拖慢主路径 | 双算开销 | 仅 `shadow` 模式开启；生产默认 `off` | 置 `off` |
| 数值对拍误报 | BLAS 非确定性 | 用相对误差容差而非逐位；记录机器/版本 | 调整门槛需评审 |
| 文档/代码不一致 | 多处维护 | BACKLOG 只留指针；单一事实源在本文档 | — |

---

## 9. 新工具孵化与晋级清单（Q10=A）

> **适用范围**：mathspec 试验阶段**不设晋级门槛**——先自由尝试、组合、追求创造性；**一批试验完成后**按下列四关统一验收，通过者才进入 netlab 接入清单。

### 9.1 四关

1. **条件与边界**：适用条件、失效条件、降级/拒绝路径写清楚（如 P3 的 `r/n`、P5 的 `d>2ε`、POD 的正交/不饱和）。
2. **性质测试**：至少 1 条解析解、1 条守恒/误差界、1 条非法输入拒绝；测试必须可复跑。
3. **影子评测器**：新旧路径对拍 + 误差/耗时双指标，默认不启用。
4. **回退开关 + 指标门槛**：环境变量/配置可一键回到旧路径；写清"达到什么数才允许 `on`"。

### 9.2 当前候选

| 候选 | 条件边界 | 性质测试 | 影子评测 | 回退/门槛 | 状态 |
|---|---|---|---|---|---|
| P3 Woodbury | `r/n≤0.10`、A0 非病态、纯 LTI RLC、ω>0 | 与直接解对拍 `<1e-10`、病态回退 | `shadow` 模式 | `NETLAB_MATH_ACCEL=off`；平均 `≥2×` | **已实现影子（M0+M1b）**；真实参数规模族 n≥301 达 2.29–2.32×、n=201 1.84× |
| P1 排序 | 真实+合成语料、缓存 key 不变 | fill-in/solve 误差 | 评测器对照 | 不达标保持 COLAMD | 评测器已实现（M0）；真实语料 1/2，未过 DoD |
| P5 遥测口径 | `d>2ε`、线性插值、无量化（当前） | 界与拒绝测试 | 只读端点对拍 schema | 不改 `/api/live` | **已实现（M1c）+ 前端设置页「诊断」误差合同（P5.2）+ 真实插值/FIFO 界（P5.2）** |
| observability 探针选择 | 有限时域 LTI、正定先验 | 次模/穷举/非法输入 | 后续评测 | 本波不接 | 储备 |
| telemetry/dataflow 压缩链 | 量化区间不饱和、CRC 非攻击防护 | 端到端误差/压缩比 | 后续 P7 | 本波不接 | 储备 |

---

## 10. 接口改动点清单

| 文件 | 改动 | 风险 |
|---|---|---|
| `netlab/core/compute/math_accel/config.py` | 新增：环境变量解析、开关默认 off | 低 |
| `netlab/core/compute/math_accel/woodbury_ac.py` | 新增：双参数仿射族 + Woodbury 求解 + 守卫 | 中 |
| `netlab/core/compute/math_accel/ordering_eval.py` | 新增：排序评测（只读） | 低 |
| `netlab/core/compute/nodal.py:2237` | `ac_sweep` 增加 off/shadow/on 分支 | 中 |
| `netlab/core/compute/simulation.py` `Recorder` | 增加 `quality` 元数据 | 低 |
| `netlab/server.py` | 新增只读 `/api/diagnostics/telemetry`（可选 `/api/diagnostics/math-accel`） | 低 |
| `netlab/tests/` | 新增 P3/P1/P5 测试 | 低 |

---

## 11. 实施记录（2026-11-06，M0 + M1a + M1b + M1c + P5.2）

- **分支**：`feat/math-accel-shadow`（从 `main` 新开；未带入 `feat/ts-migration` 改动）。
- **mathspec（M0）**：`experiments/ac_sweep_woodbury.py`（`ReactiveStamp`、`rank_ratio`、`conductance_matrix`、`WoodburyFamily`、`ac_sweep_woodbury`）与 `experiments/ordering_eval.py`（COLAMD/MMD_ATA/MMD_AT_PLUS_A/NATURAL + RCM/MIN_DEGREE/NESTED_DISSECTION，fill/时间/峰值内存）；测试 9 条，全套 `107 passed in 5.66s`。
- **netlab（M1b）**：`netlab/core/compute/math_accel/` 新增 `config.py`（`NETLAB_MATH_ACCEL[_<component>]=off|shadow|on`，默认 off）、`diagnostics.py`（环形诊断）、`woodbury_ac.py`（`ACWoodburySolver`，`r/n` 门控 + 条件数/主元守卫 + 残差修正）、`__init__.py`；`nodal.ac_sweep` 增加 off/shadow/on 分支（off 路径行为不变，shadow 只对拍不生效，on 在 `r/n≤0.10` 时走 Woodbury）。
- **验证**：`netlab/tests/test_math_accel.py` 5 条（开关默认/非法值、合成 Woodbury 对拍、r/n 门控、ac_sweep 三模式一致）→ `5 passed`；相关回归 `test_solver_analysis.py + test_complex_support.py` 22 passed；netlab 全量 `594 passed, 1 skipped in 103.50s`。
- **性能实测（2026-11-06，RC 梯形）**：2001 频点 / 101 节点：off 1131.5 ms、shadow 1305.1 ms、on 755.7 ms（**1.50×**）；501 频点 / 201 节点：off 966.8 ms、on 463.0 ms（**2.09×**）。`on` 路径已加 fast path：复用 `base_matrix/base_rhs`，不再逐频点重 stamp；收益随规模增长，达到 M1b `≥2×` 目标（较大电路）。
- **已知边界**：P3 仅适用于纯 LTI RLC（AC 已拒绝二极管/晶体管等）；`on` 仅在 `r/n≤0.10` 且条件数/主元守卫通过时启用，其余自动回退 direct；`shadow` 有约 15% 额外开销（仅对拍用，不建议长期开启）。
- **M1a（P1 排序评测，2026-11-06）**：`netlab/core/compute/math_accel/ordering_eval.py`（只读：`matrix_from_scene`/`matrix_from_project`/`evaluate_matrix`/`evaluate_corpus`）与 `tools/eval_mna_ordering.py` 落地；`netlab/tests/test_ordering_eval.py` 3 条通过。真实语料仅 2 个 circuit 工程（23 阶、7 阶），每次计时抖动明显；按 DoD 判定 **1/2 达标 → 未通过，生产 `_solve_sparse` 保持 COLAMD 不替换**。合成电路状矩阵 n=400 上 `MMD_AT_PLUS_A` factor 0.793×、fill 0.625×，作为后续扩大语料的观察信号。报告：`mathspec/research/P1_ORDERING_REPORT.md` + `P1_ORDERING_RESULTS.csv`。
- **M1c（P5 遥测口径，2026-11-06）**：`Recorder.quality` 固定 schema（`sample_dt`/`quant_bits=None`/`interp_error_bound=None`/`fifo_depth`/`delay_bound=None`/`assumptions`）、`Recorder.quality_snapshot()`、`Simulation.telemetry_quality()`；`server.py` 新增只读 `GET /api/diagnostics/telemetry` 与 `GET /api/diagnostics/math-accel`，`/api/live` 响应结构零变化。`netlab/tests/test_telemetry_quality.py` 4 条通过（含 live 顶层 keys 恒定断言）。
- **P3 真实语料扩展（2026-11-06 19:35）**：审计 `NetlabHome/MyProject` 7 个 `.netlab` 工程，仅 2 个 circuit（`grid_inverter_switch.netlab` n=16，含 6 个 nmos；`未命名工程.netlab` n=4，含 opamp），两者 AC 均不支持 → **P3 直接真实工程样本为 0**。改用真实参数（Rg=10Ω、C=50µF、L1=2mH）构造 201/301/399 阶、r/n≈0.10 的 RC 传输线，501 频点：off 617.0/1328.5/2445.7 ms，on 335.3/580.0/1054.7 ms（**1.84× / 2.29× / 2.32×**），归一化误差 6.3e-14/1.7e-13/1.4e-13。新增 `tools/eval_p3_ac_corpus.py` 与 `test_large_ladder_uses_woodbury_and_matches_dense`（n=399），`test_math_accel.py` 增至 7 条；报告 `mathspec/research/P3_AC_CORPUS_REPORT.md` + `.csv`，明确标注"规模族非真实拓扑"。
- **P5 前端误差合同（2026-11-06 19:40）**：`frontend/index.html` 设置窗新增第 4 个「诊断」pane（采样间隔 / 量化位数 / 插值误差界 / FIFO 深度 / 延迟上界 / 合同状态 / 假设 / 刷新按钮）；`frontend/app.ts` 新增 `TelemetryQuality` 类型与 `refreshTelemetryQuality()`，只读 `GET /api/diagnostics/telemetry`，不触碰 `/api/live` 响应结构。`npm.cmd run typecheck` 通过、esbuild 构建通过、`node --test tests/*.test.mjs` 5 passed。
- **M2 启用评审（2026-11-06 21:20）**：`mathspec/research/M2_GATE_REVIEW.md`。环境 Intel Core Ultra 9 185H / 16GB / Python 3.13.9 / NumPy 2.3.5 / SciPy 1.16.3。§5.3 核对：P3 误差 4.14e-14–1.72e-13 PASS；P3 加速比按语料平均 PASS（最近一轮 1.21/3.62/23.45×，上一轮 1.84/2.29/2.32×；n=201 单点可能低于 2×，已标注）；P1 仅 1/2 达标 → 不替换（保持 COLAMD，不纳入 M2）；P5 `/api/live` schema 零变化 PASS；全量 606 passed / 1 skipped、mathspec 107、前端 5 passed PASS。**结论：有条件通过——`on` 仅显式 opt-in，默认仍 `off`；守卫 n≥160、r/n≤0.10、条件数/主元检查、异常回退 direct；若要把 `on` 设为默认需另开评审（真实 AC 语料+更大规模+长稳压测）。**

---

## 12. 决策记录（本次 grilling）

| 问题 | 选择 | 含义 |
|---|---|---|
| Q1 | **A+B** | 运行更快 + 结果更可信；数学知识作为后续扩展基础 |
| Q2 | **B** | 第一波只做 P3 + P1 + P5；P2 等列后续 |
| Q3 | **A** | 影子模式 + `NETLAB_MATH_ACCEL=off|shadow|on`，默认 off |
| Q4 | **A** | 双参数仿射族 `A(ω)=A(ω0)+UΣ(ω)Vᵀ`；门控 0.10/0.25 |
| Q5 | **A** | 排序评测器：COLAMD/MMD_ATA/MMD_AT_PLUS_A/NATURAL + 自研；门槛 15%/20% |
| Q6 | **A** | 只读诊断层，不改 `/api/live` |
| Q7 | **A** | 真实 + 合成混合语料（MyProject 8 工程 + RC/RLC/随机稀疏） |
| Q8 | **主规划 + 独立副本** | BACKLOG §1.1 留指针；详细放本文件 |
| Q9 | **A** | 从 main 新开 `feat/math-accel-shadow` |
| Q10 | **A（事后验收）** | 四关清单；试验阶段自由，完成后统一检验 |
| Q11 | **A** | P1 → P3 → P5；M1a/M1b/M1c |
| Q12 | **A** | 保留 M0 mathspec 原型阶段 |

---

## 13. 参考文档

- [UNIFIED_SIM_MATH_SPEC.md](UNIFIED_SIM_MATH_SPEC.md)：数学规范（UMG/DAE/混合系统/数值/MOR/可观测性）
- [PERFORMANCE_AND_CONCURRENCY.md](PERFORMANCE_AND_CONCURRENCY.md)：研究记录（§31 创造性拓展、§32 优化/数据结构、§33 遥测）
- [BACKLOG.md](BACKLOG.md)：主线待办与优先级
- `NetlabHome/mathspec/README.md`：零耦合参考实现模块与测试索引

> 维护规则：本文件只记录"接入规划与影子验证"；研究结论进 PERFORMANCE，数学定义进 UNIFIED，避免三处重复。每次里程碑完成更新 §6 状态与证据（测试数/实测值/PR 链接）。
