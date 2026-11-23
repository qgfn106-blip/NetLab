# NetLab 后端核心模块审计报告（backend_core）

- **基线提交**：`5c076ea` — `fix(analysis): 断环 Bode/Nyquist 改用解析开环传函`（NetLab 3.20.2 / Project Schema 8）
- **工作树**：`.`（独立 git worktree；审计期间工作副本被并行改动，本报告结论一律以**基线 HEAD `5c076ea`** 为准）
- **审计方式**：只读源码。未修改/删除任何源文件，未 commit / push / checkout；所有结论均附 `file:line` 原文证据。
- **审计范围**：`netlab/core/model/*`、`netlab/core/compute/*`（含 `circuit/`）、`netlab/server*`、`netlab/desktop/{webview_bridge,bridge}.py`
- **审计日期**：2026-11-24

---

## 0. 既有结论复核速览（P2-01 ~ P2-06）

| ID | 原假设 | 复核判定 | 关键证据 | 严重度 |
|---|---|---|---|---|
| P2-01 | MNA 元件 stamp 双轨 | **成立** | `elements.py` 13×`def stamp()`；`descriptor.py:551 _assemble_matrices` 按 kind 独立装配；仅 2 端 Laplacian 原语共享（`stamps.py:78`） | P2 |
| P2-02 | AC/Bode 重复装配 | **部分成立** | 纯线性路径 delegate（`descriptor.py:1035-1048` → `solver.ac_sweep`）；仅非线性/强制 native 路径重复（`descriptor.py:1049-1086`） | P2 |
| P2-03 | analysis.py 职责过大 | **成立** | 2854 行 / 45 个顶层函数 / `class AnalysisError`(78)；与 circuit 栈职责重叠 | P2 |
| P2-04 | accel.py GPU 拷贝/同步/回退/门槛 | **成立（含观察项）** | 单步 H2D/D2H + 显式 sync（155-175 / 178-223）；min_size 门槛 192；`solve_dense` 非有限值不回落直接 `ComputeError` | P2 |
| P2-05 | fem.py Q4 热传导实现与边界 | **成立** | `FemConfig(59-75)`、`_element_matrices(163-177)`、backward-Euler(247-266)；左右 Dirichlet、上下绝热 | P2 |
| P2-06 | path_guard 注释"追加"实现"覆盖"矛盾 + bridge 任意路径风险 | **部分成立** | 基线 `path_guard.py:9` 写"追加受信根目录"，而 `allowed_roots()`（24-29）对 env 采用**替换=覆盖**语义 → 文档/实现不符（成立）；desktop/bridge.py 经 `atomic_write`/`load_project_raw` 内部 `ensure_allowed_path`（`project.py:1075,1126`）已受保护，任意逃逸不成立；残余 `webview_bridge.save_text`(206) 直写无校验 | P2 |

> 说明：**P2-06 原假设成立**——基线 HEAD（`git show HEAD`）的 `path_guard.py:9` 字面写"追加受信根目录"，而 `allowed_roots()` 实现对 `NETLAB_ALLOWED_ROOTS` 采用替换语义（设置后仅列出的根生效＝覆盖），注释与实现不符。desktop/bridge.py 虽未直接校验，但读写经模型层 `atomic_write`/`load_project_raw` 内部 `ensure_allowed_path` 校验，故"任意路径读写风险"不成立。见 §2.6。

---

## 1. 覆盖范围与规模

| 文件 | 行数 | def（含嵌套/方法） | class |
|---|---|---|---|
| netlab/core/model/scene.py | 632 | 35 | 1 |
| netlab/core/model/graph.py | 1224 | 44 | 10 |
| netlab/core/model/project.py | 1208 | 46 | 0 |
| netlab/core/model/networks.py | 1245 | 62 | 1 |
| netlab/core/model/blocks.py | 1223 | 46 | 4 |
| netlab/core/model/plugins.py | 754 | 28 | 3 |
| netlab/core/model/path_guard.py | 67 | 2 | 0 |
| netlab/core/compute/analysis.py | 2854 | 45（顶层）/57（全部） | 1 |
| netlab/core/compute/accel.py | 229 | 14 | 0 |
| netlab/core/compute/fem.py | 695 | 39 | 6 |
| netlab/core/compute/linalg.py | 232 | 9 | 0 |
| netlab/core/compute/circuit/elements.py | 876 | 77 | 17 |
| netlab/core/compute/circuit/stamps.py | 120 | 4 | 3 |
| netlab/core/compute/circuit/solver.py | 1426 | 37 | 1 |
| netlab/core/compute/circuit/descriptor.py | 1092 | 39 | 3 |
| netlab/core/compute/circuit/descriptor_analysis.py | 980 | 33 | 3 |
| netlab/core/compute/circuit/loop_analysis.py | 826 | 19 | 1 |
| netlab/server.py | 552 | 18 | 4 |
| netlab/desktop/webview_bridge.py | 339 | — | — |
| netlab/desktop/bridge.py | 288 | — | — |

`netlab/server*` 结构：`server.py`（FastAPI 主应用，552 行）＋ 16 个子包（`server_analysis / server_blocks / server_control / server_extensions / server_fem / server_help / server_networks / server_plotkit / server_plugins / server_preferences / server_project / server_scene / server_shell / server_tools / server_workspace` 等）。`server.py` 仅执行注册表中的受控计算，不执行用户提交代码（docstring），请求体经 Pydantic + 场景层校验。

---

## 2. 逐条核实

### P2-01 MNA 元件 stamp 双轨 —— 成立

**结论**：按 kind 的元件装配逻辑存在两套独立实现；仅 2 端导纳原语（Laplacian）被共享。

证据：
- `netlab/core/compute/circuit/elements.py` 共有 13 处 `def stamp(self, ctx: StampContext)`：line 66（抽象基类）、107、173、277、345、376、413、446、470、511、571、721、849 —— 对应 12 个具体元件 kind，各自按 kind 独立装配。
- 元件内部统一调用 `stamps._stamp_conductance`（`elements.py:15` 导入；调用点 `108,179,181,279,283,285,289,447,573` 等），其底层是 `stamps.stamp_laplacian`（`stamps.py:78 def stamp_laplacian`；`stamps.py:108 def _stamp_conductance`）。
- `netlab/core/compute/circuit/descriptor.py:551` `def _assemble_matrices(...) -> tuple[np.ndarray, np.ndarray]` 在 551-663 行**再次独立**遍历 `for element in self.elements: kind = element.kind`，按 resistor/switch/capacitor/inductor/sensor/vsource/vcvs/vccs/isource 分支装配 A/E 矩阵（kind 列表组装于 `descriptor.py:195-231`）。
- 两条路径仅共享 2 端 Laplacian 原语：descriptor 侧对 2 端电阻复用 `stamp_laplacian`（`descriptor.py:558-561`）、电容 E 矩阵（`descriptor.py:569-572`）、及 `descriptor.py:682-684`。

**影响**：新增/修改某类元件时需同步维护 `elements.stamp()` 与 `descriptor._assemble_matrices()` 两处，易漂移、易出现两条仿真路径结果不一致。现有 `test_stamp_unification.py` 部分覆盖一致性。

### P2-02 AC / Bode 后端 —— 部分成立

**结论**：纯线性电路**不重复装配**（descriptor 委派到 canonical `ac_sweep`/`_ac_bode`）；仅**非线性 / 强制 native** 路径存在每频点重复装配。

证据：
- canonical 核 `CircuitSolver.ac_sweep`：`solver.py:1047` 起；先求 DC 工作点（`1115-1117`）；频率循环 `1174+`，`omega = 2πf`（`1174-1175`）。快路径：静态矩阵 + Woodbury 低秩更新（`1176-1197`）；否则逐元件 `element.stamp(ctx)` 重新 stamp（`1198-1213`）；残差回退全量求解（`1220-1233`）。走 elements 路径。
- `DescriptorModel.frequency_response`：`descriptor.py:1014-1086`。docstring（`1020-1029`）明确：纯线性路径**委托** canonical `ac_sweep`/`_ac_bode`，非线性（含 operating_point）才用本模型 native build/solve 线性化。
- 委派条件：`descriptor.py:1035-1048` —— `if getattr(self,'ac_backend','legacy') != 'descriptor' and all(element.kind in CircuitSolver.AC_KINDS ...)` → `CircuitSolver(...)._ac_bode(...)`。
- native 路径 `1049-1086`：对每个 omega 调 `self.build()`（即 `descriptor._assemble_matrices` 产 A/E）——**此处才重复装配**（仅非线性/强制路径）。
- 频率单位：Hz，`omega = 2πf`（`descriptor.py:1010,1046,1051`；`solver.py:1174-1175`），一致。
- 复数返回格式：`real / imag / magnitude / phase_deg / db` 六个等长列表（`descriptor.py:1027-1028,1061-1067,1079-1085`），两路径一致。
- 探针语义：`probes` 列表；对**选中的独立源**施加单位激励（1 V / 1 A），其余源置零求传递。
- 测试：`test_p1r2_ac_parity.py`、`test_p1r2_descriptor_delegate.py`、`test_p1r2_ac_switch_probe.py` 存在。

**影响**：纯线性场景无重复计算；风险集中在 descriptor native 非线性路径与 `ac_sweep` 的装配一致性（两套矩阵来源），建议统一或加 parity 测试覆盖非线性 delegate。

### P2-03 analysis.py 承担的职责清单与体量 —— 成立

**结论**：`netlab/core/compute/analysis.py` 为 **god module**：2854 行（110422 字节），45 个顶层函数（全部 def 计 57），`class AnalysisError`（line 78）。它与 `circuit/` 下的分析栈职责大量重叠。

职责清单（部分，附行号）：
- 数值精度全局开关：`numeric_precision_mode`(54) / `set_numeric_precision_mode`(63) —— **模块级可变状态写在函数属性上**（getattr/setattr）。
- 指标与谱：`analyze_metrics`(150)、`phase_metrics`(213)、`spectrum`(265)、`recommend_period`(331)。
- 数学形式/状态空间：`math_forms`(403)、`_state_space_payload`(432)、`transfer_function`(469)、`tf_analysis`。
- 频响与稳定：`frequency_response`、`break_points`、`loop_candidates`、`loop_analysis`、`nyquist_analysis`、`step_open_analysis`、`nyquist_closed_analysis`。
- 导出/执行：`export_csv`、`run_with_timeout`。

重复实现证据（导入关系）：`analysis.py:26-41` 汇集 `circuit.descriptor`、`circuit.analysis_envelopes`、`circuit.fft_frequency`、`circuit.loop_analysis`、`circuit.nyquist`、`circuit.analysis_contract`、`circuit.descriptor_analysis`，与 `circuit/descriptor_analysis.py`(980)、`circuit/loop_analysis.py`(826)、`circuit/nyquist.py`(383)、`circuit/fft_frequency.py`(341) 构成**并行的两套分析栈**，职责重叠。

**影响**：单文件承担指标/谱/传函/环路/奈奎斯特/导出/超时执行 7+ 类职责，可测试性与可维护性差；precision 全局状态在多线程服务下存在串扰风险。

### P2-04 accel.py GPU(CuPy) 路径 —— 成立（含观察项）

证据（`netlab/core/compute/accel.py`，229 行）：
- 模块级可变全局：`_POLICY="auto"`、`_GPU`、`_GPU_ERROR`、`_GPU_CHECKED`、`_LAST_BACKEND`、`_LAST_MS`、`_CALLS`、`_GPU_CALLS`、`_LOCK=threading.RLock`（`30-38`，均受 `_LOCK` 保护）。
- 门槛：`DEFAULT_GPU_MIN_SIZE=192`（`29`）；`_gpu_min_size()` 将 env `NETLAB_ACCEL_GPU_MIN_SIZE` 夹到 `[16,8192]`（`48-53`）；策略 env `NETLAB_ACCEL=auto|cpu|gpu`（`41-45`）。
- 探测：`_probe_gpu` 惰性 `import cupy`，记录原因不抛异常（`56-80`）。
- 数据拷贝/同步：`to_cpu` = `gpu.asnumpy → np.float`（`142-146`）；`synchronize` 用 `_GPU.cuda.Stream.null.synchronize()`（`149-152`）。
- `matmul`（`155-175`）：GPU 条件 `max(shape) >= min_size`；`gpu.asarray(left) @ gpu.asarray(right)` → `asnumpy` → `synchronize`；异常回退 CPU（`_record_gpu_failure`）。
- `solve_dense`（`178-223`）：GPU 条件 `n >= min_size`；`asarray` 两侧 → `gpu.linalg.solve` → `asnumpy` → `synchronize`；**结果非有限值直接抛 `ComputeError`（不回落 CPU）**；其他异常 → `_record_gpu_failure` + CPU 回退。
- 同步模型：**每次调用单步同步**（H2D 两侧 + D2H 结果 + 显式 `synchronize`），无跨步异步流水，小矩阵门槛用 `_gpu_min_size` 控制。

**观察项**：① `solve_dense` 对非有限解硬失败而不回退，噪声 GPU 下可能比 CPU 更易失败（可考虑可选回落或更清晰诊断）；② 单步同步为主，批量/多频场景无批处理与异步重叠，GPU 收益受限。

### P2-05 fem.py Q4 热传导实现与边界 —— 成立

证据（`netlab/core/compute/fem.py`，695 行）：
- `FemConfig`（`59-75`）：`nx=36, ny=24, dt=0.002, fps=30, steps_per_frame=8, conductivity=capacity=1.0, source_amplitude=5000, source_frequency=0.08, source_sigma=0.09, source_x=0.35, boundary_left=20.0, boundary_right=20.0, initial_temperature=20.0`。
- Q4 双线性形函数与参考导数：`_shape`（`78-104`，节点序 LL,LR,UR,UL）。
- `_element_matrices`（`163-177`）：2×2 Gauss（`_GAUSS_POINTS`），`hx=1/nx, hy=1/ny, det_j=hx*hy/4`；`K += conductivity*det_j*(outer(dndx,dndx)+outer(dndy,dndy))`（`dndx=dxi*(2/hx)`）；`M += capacity*det_j*outer(n,n)`。
- `_assemble`（`223-245`）：COO → CSR 全局 mass/stiffness。
- 边界：**左右 Dirichlet 固定**（`203-208`，值 `boundary_left/right`）；**上下绝热**（自然边界、无 BC）。
- `_build_factorization`（`247-266`）：backward-Euler 算子 `operator = M/dt + K`；消去 Dirichlet 行列后加单位行（`257`）；`splu` 分解；`bc_correction = operator @ known`（`263`）。
- `_source_vector`（`304-321`）：高斯源（`source_x/sigma/amplitude/frequency`），预乘 `_source_operator @ q`。
- `step`（`324-350`）：backward-Euler `rhs = M·T/dt + force - bc_correction`；设置 BC 行；`lu.solve`；有限性检查；`max|T| > 1e7` → `ComputeError` "有限元温度发散，请减小 dt 或提高导热系数"。
- 依赖 SciPy（`_HAS_SCIPY` 门控，`193`）。

**边界/建模说明**：顶、底为绝热（零通量）自然边界，即不模拟上下散热；如需热沉/对流需自行加 Robin/Neumann。仅支持矩形域 Q4 网格、固定左右 Dirichlet。

### P2-06 path_guard 注释/实现矛盾 + desktop 路径风险 —— 部分成立

**结论**：
1. **注释/实现矛盾成立**：基线 HEAD 的 `path_guard.py:9` 字面写"追加受信根目录"（append），而 `allowed_roots()`（24-29）对 `NETLAB_ALLOWED_ROOTS` 采用**替换=覆盖**语义（设置后仅列出的根生效）。部署方若按注释期望"追加"，实际会**丢失** home/cwd/temp 默认根（收紧而非追加），可能误拒正常路径。
2. **"bridge.py 任意路径读写风险"不成立**：desktop/bridge.py 虽未直接校验，但其读写最终经模型层 `atomic_write`/`load_project_raw` 内部的 `ensure_allowed_path`（`project.py:1075,1126`），任意逃逸被拦截。
3. **残余缺口（低危）**：`webview_bridge.save_text`（206）直写无校验（见下）。

证据：
- **基线**（`git show HEAD:netlab/core/model/path_guard.py`）`1-10` 行 docstring 原文："部署方可用 `NETLAB_ALLOWED_ROOTS`（`os.pathsep` 分隔）追加受信根目录。" —— 字面是"追加"。
- 实现 `allowed_roots()`（`24-29`）：`if raw.strip(): candidates = [env items] else: candidates = [Path.home(), Path.cwd(), tempfile.gettempdir()]` —— 环境变量一旦设置即**替换**默认根（覆盖语义），与注释"追加"不符 → **矛盾成立**。
- `ensure_allowed_path`（`55-67`）：解析真实路径 → `commonpath` 必须在允许根内，否则抛 `ValidationError`。
- 路径校验覆盖面（grep 全仓 `ensure_allowed_path`，均为基线内容）：
  - `core/model/project.py:1075`（`atomic_write` 内部）、`1113`、`1126`（`load_project_raw` 内部）；
  - `core/model/networks.py:206`；`core/model/workspace.py:224,245`；
  - `desktop/webview_bridge.py:148,178,224`。
- `desktop/bridge.py` **未直接** import `ensure_allowed_path`，但其 `saveProjectTo`（`102-119`）→ `atomic_write`（`project.py:1067`，内部 `1075` 校验）、`openProjectPath`（`139-150`）→ `load_project_raw`（`project.py:1120`，内部 `1126` 校验）→ **任意路径逃逸被模型层拦截，故"bridge.py 任意路径读写风险"不成立**（防御纵深实际存在，只是不在 bridge 层）。
- **残余缺口（低危）**：`desktop/webview_bridge.py` 的 `save_text`（`185-210`）在 `206` 行直接 `target.write_text(...)`，**未调用 `ensure_allowed_path`、也未走 `atomic_write`**（绕过根校验 + 大小上限 + `.bak` 备份）。`target` 来自原生保存对话框，风险有限，但属防御纵深缺口。
- **工作副本漂移备注**：审计期间该工作树的 `path_guard.py` 工作副本被第三方改为"覆盖"字样（`git diff` 可见，与 HEAD 不同）；本报告以基线 HEAD 为准。

---

## 3. 横向工程问题

### 3.1 循环依赖
- `descriptor.py:1030`：`from .solver import CircuitSolver  # 局部导入避免循环` —— `descriptor ↔ solver` 潜在循环，用**函数内局部导入**规避。
- `core/model/engine_registry.py:19` 注释：为规避 `engine_registry ↔ scene_types` 环（A2 架构契约禁止）而保留副本。
- `analysis.py` 单向 import `circuit.*`（`26-41`），反向未发现 `circuit → analysis` 依赖（无该环）；`analysis` 为 circuit 栈之上的门面层。

### 3.2 模块级可变状态
| 模块 | 状态 | 位置 | 线程安全 |
|---|---|---|---|
| compute/accel.py | `_POLICY/_GPU/_GPU_ERROR/_GPU_CHECKED/_LAST_*/_CALLS/_GPU_CALLS` | 30-38 | 有 `RLock` 保护 |
| compute/analysis.py | 数值精度模式（挂在函数属性上） | `numeric_precision_mode`(54)/`set_...`(63) | **无锁**，多线程共享可变 |
| server.py | `CURRENT_WORKSPACE`(35)/`LAST_PROJECT`(38)/`LAST_PROJECT_LIBRARY`(39)/`SERVICE`(78)/`FEM`(79) 单例；`_DESKTOP_BOOTSTRAP_LOCK`(138) | 35-79,138 | 单例全局 |
| model/engine_registry.py | `ENGINE_SPECS/ENGINE_OWNERS` 注册表 + snapshot 基线挂函数属性 | 156-157 | 无锁 |
| model/extensions.py | `_REGISTRY` 字典 + 事务快照 | ~64 | 事务式 |
| model/builtins.py | `_CACHE` 记忆化元组 | 527-542 | 无锁（只写一次） |

### 3.3 双轨 / 重复实现
- MNA 装配双轨（P2-01，§2.1）。
- AC native vs canonical（P2-02，§2.2）。
- analysis.py 与 circuit 分析栈并行（P2-03，§2.3）。
- desktop 两套 QObject bridge：`desktop/webview_bridge.py`（339 行，有 ensure_allowed_path）与 `desktop/bridge.py`（288 行，`class Bridge(QObject)` 69 起，`saveProject`(78)/`saveProjectTo`(102)/`openProject`(122)/`openProjectPath`(139)），逻辑重复。

### 3.4 单元测试覆盖
- `netlab/tests` 下 217 个顶层测试模块。
- 已覆盖相关项：`test_stamp_unification`、`test_accel`、`test_p1r2_ac_parity`、`test_p1r2_descriptor_delegate`、`test_p1r2_ac_switch_probe`、`test_frequency_response`、`test_descriptor_*`（dc/rlc/step/nonlinear/linearization）、`test_analysis*`、`test_loop_analysis`、`test_nyquist`、`test_fft_frequency`、`test_webview_save_text`、`test_webview_bridge_export`、`test_circuit_modules`、`test_element_contracts`、`test_run_security`。
- **覆盖空白（重要）**：
  - **`fem.py` 无专用单测**（695 行数值解算器 + SciPy 依赖，无 `test_fem*`；grep 仅在 `test_netlab.py`/`test_project_import_transaction.py` 出现 `fem` 字样，非 Q4 求解回归）。
  - **`path_guard.py` 无专用单测**；`ensure_allowed_path/allowed_roots` 仅被 `test_workspace.py` 间接引用。`test_cache_guard.py` 是 D88 缓存清理（`netlab.cache_guard`），与路径白名单无关。

---

## 4. 整改建议（P0/P1/P2/P3）

| 级别 | 编号 | 建议 | 依据 | 预期收益 |
|---|---|---|---|---|
| **P0** | — | 无致命/安全红线问题 | 路径逃逸已被 `ensure_allowed_path` 模型层拦截（§2.6） | — |
| **P1** | R-01 | 为 `fem.py` 补 Q4 热传导数值回归测试（解析解/能量守恒/边界条件） | §3.4（无 test_fem） | 防数值解算器静默回归 |
| **P1** | R-02 | 消除 MNA 装配双轨：让 `descriptor._assemble_matrices` 复用统一 per-kind assembler（或反向统一到 elements.stamp） | P2-01 §2.1 | 消除两套矩阵来源漂移 |
| **P2** | R-03 | 拆分 `analysis.py`（2854 行 god module），将指标/谱/传函/环路分别下沉，消除与 circuit 栈重复实现 | P2-03 §2.3 | 可维护性/去重 |
| **P2** | R-04 | descriptor native 非线性 AC 路径复用 build 缓存或统一到 canonical 核，并加非线性 parity 测试 | P2-02 §2.2 | 保证两路径一致 |
| **P2** | R-05 | `webview_bridge.save_text` 补 `ensure_allowed_path` 或改走 `atomic_write`（当前直写绕过根校验/大小上限/.bak） | P2-06 §2.6 残余缺口 | 防御纵深一致 |
| **P2** | R-06 | `accel.solve_dense` 非有限值可考虑可选回落或更清晰诊断；批量场景评估异步/批处理 | P2-04 §2.4 观察项 | 稳定性/性能 |
| **P3** | R-07 | `analysis` 数值精度改为显式配置对象，去除函数属性全局可变状态 | §3.2 | 线程安全 |
| **P3** | R-08 | 合并 desktop 两套 QObject bridge（`webview_bridge` / `bridge.py`） | §3.3 | 去重、行为一致 |
| **P3** | R-09 | 评估 `server.py` 模块级单例（`SERVICE/FEM/CURRENT_WORKSPACE/LAST_PROJECT`）在并发/多租户下的状态串扰 | §3.2 | 隔离性 |
| **P3** | R-10 | 为 `engine_registry/extensions/builtins` 模块级注册表/缓存补充线程与生命周期约束文档 | §3.2 | 可预期性 |

---

## 5. 方法与限制
- 全程只读：未修改/删除任何源文件；仅读取源码与测试清单，未运行业务逻辑/数值用例（本任务为纯只读审计）。
- 审计期间该工作树被并行改动（`git status` 显示多处 M，含 `path_guard.py` 工作副本的 docstring 被第三方改为"覆盖"）；本报告所有结论一律以**基线 HEAD `5c076ea`**（`git show HEAD:<file>`）为准，不采用工作副本。
- 行号基于基线 `5c076ea`；后续提交可能偏移。
- 判定依据为源码静态阅读 + 既有测试存在性，未实际执行业务逻辑/数值用例（本任务为只读审计）。
