# NetLab Core V2 契约冻结（P3-01）

> 状态：**G0 已通过（2026-11-26 补签，CI 六项全绿）**。本文件冻结 Core V2 对外可观察行为与关键内部不变量。
> 基线：main `5c076eae`；工作分支 `feat/2026-11-25-p3-core-v2`（已于 2026-11-26 随 PR #75 合并，merge commit 3817422）。任何修改本文件所列契约的提交，必须附 ADR/决策记录与对应断言测试。

## 1. 范围与目标

P3-01 的交付物是一份可执行契约，而不是再一次重构：

1. 明确 Core V2 的稳定 API 面与错误语义，避免后续 P3-02..P3-07 分步重构时悄悄改变对外行为；
2. 每条不变量必须有自动化断言（`netlab/tests/test_core_v2_contract.py`）；
3. 给出 G0 评审门禁：未通过本契约评审，不得以“Core V2 已完成”对外声明。

本契约覆盖五组主题：Schema/版本、StampBuilder 单一装配、AC 扫频后端、`ComputeError` 数值错误、路径安全；并补充 FEM 边界契约与 API 兼容性规则。

## 2. 冻结的公共契约（不变量清单）

| ID | 不变量 | 断言位置 |
|---|---|---|
| CF-01 | 工程 Schema `PROJECT_VERSION == 8`；应用版本 `APP_VERSION == "2.1.0"`；包版本 `netlab.__version__ == "3.20.2"`。三者独立演进，但同一次发布必须互相自洽。 | `test_core_v2_contract.py::test_version_constants` |
| CF-02 | `PROJECT_VERSION` 是工程文件 JSON `version` 字段的权威来源；读取旧版本走迁移，写出必须写当前版本。禁止在文档或代码中继续声明 v7 为当前版本。 | `test_version_constants` + `check_version.py`（CI D-2） |
| CF-03 | 器件静态 MNA 贡献只有一个入口：`stamp_builder.stamp_element_static(element, sink, *, bridge_control, bridge_gain)`。`DescriptorModel._assemble_matrices()` 只负责建矩阵、算桥臂控制量并分派，不得重新内联各 kind 的矩阵写入。 | `test_descriptor_assembly_delegates_to_stamp_builder` |
| CF-04 | `StampSink` 是静态矩阵与 element 上下文之间的唯一桥，固定成员为：`mode`、`omega`、`node`、`branch`、`add_A`、`add_E`、`add_conductance`、`add_E_conductance`、`add_current`、`set_rhs`。新增 sink 能力必须同时实现 `StaticMatrixSink` 与 `ElementStampSink`。 | `test_stamp_sink_protocol_members` |
| CF-05 | 每个 kind 一个纯贡献函数 `stamp_<kind>(element, sink, ...)`；`stamp_element_static` 支持 `resistor/switch`、`capacitor`、`inductor`、`sensor`、`vsource/actuator`、`vcvs`、`vccs`、`isource`、`actuator_i`，非线性 kind（diode/zener/led/bjt/mosfet/opamp/comparator/dff 等）在静态装配中跳过，增量电导由工作点线性化叠加。 | `test_stamp_element_static_supported_kinds` |
| CF-06 | 电感存在**已记录的受控例外**：transient 的 `element.stamp` 使用二端伴随电导（无支路未知量）；descriptor 静态装配使用独立支路电流（`branch` row + `E[row,row] -= L`）。两者未知量布局不同，禁止在未验证数值等价前合并。 | `test_inductor_dual_path_exception_documented` |
| CF-07 | AC 扫频只有一套对外 API：`ac_sweep(model, frequencies, *, input_source=None, probes=None, strategy=None)`。返回必须包含 `frequencies`、`omega_rad_s`、`omega`、`input`、`strategy`、`probes`；每个 probe 包含 `real/imag/magnitude/phase_deg/db` 且长度等于频点数。 | `test_ac_sweep_result_contract` |
| CF-08 | 策略选择优先级固定：`model.ac_backend == "descriptor"` → `NativePerFrequencyStrategy`（`strategy="native"`）；否则所有元件 kind ∈ `CircuitSolver.AC_KINDS` → `FastLinearStrategy`（`strategy="fast"`）；否则 → native。 | `test_ac_strategy_selection_contract` |
| CF-09 | fast（canonical Woodbury）与 native（逐频点重建）必须逐点数值等价：`rtol=1e-8, atol=1e-12`。任何放宽阈值都必须单独评审，不得为通过测试而放宽。 | `test_ac_sweep_fast_native_parity` |
| CF-10 | `ComputeError` 只表达数值/求解失败：非方阵、rhs 维度不匹配、输入含 NaN/Inf 均抛 `ComputeError`；CPU 奇异矩阵抛 `ComputeError`（消息含“系数矩阵奇异”）；CPU 解出非有限值抛 `ComputeError`。 | `test_compute_error_contract` |
| CF-11 | GPU 非有限解不是 `ComputeError`：内部抛 `RuntimeError` 以落入 `except Exception → _record_gpu_failure → CPU` 回退。对外只暴露 CPU 的最终结果或 CPU 侧 `ComputeError`，禁止把 GPU 数值异常直接抛给调用方。 | `test_gpu_nonfinite_falls_back_to_cpu`（另见 `test_accel_fallback.py`） |
| CF-12 | 路径安全：`ensure_allowed_path(target, *, purpose)` 只接受解析后真实路径落在 `allowed_roots()` 内的目标；`..` 与符号链接不得逃逸；越界抛 `ValidationError`。`NETLAB_ALLOWED_ROOTS` 设置后用 `os.pathsep` 拆分并**覆盖**默认根，不追加。 | `test_path_guard_contract` |
| CF-13 | FEM 边界与时间积分是枚举化配置：`boundary_top/boundary_bottom ∈ {"insulated","dirichlet"}`（默认 insulated，Dirichlet 值默认 20℃）；`time_integrator ∈ {"backward_euler","crank_nicolson"}`（默认 backward_euler）。非法值在构造与 `apply_config` 均抛 `ValidationError`。 | `test_fem_config_contract` + `test_fem.py` |
| CF-14 | API 兼容性：Core V2 只允许增加可选关键字参数与新增导出；删除/重命名公共导出、改变必填参数、改变返回字段语义，均需 major 版本并提供迁移说明。 | 代码审查 + `test_analysis_api_surface.py` 快照 |

## 3. 契约边界与已知例外

### 3.1 电感双路径（CF-06）

- `elements.py` 的 Inductor.stamp 面向瞬态求解器，未知量为节点电压 + 伴随电导；
- `stamp_builder.stamp_inductor_static` 面向 descriptor 的 `E ẋ + A x = B u`，引入独立支路电流未知量；
- 两条路径的矩阵维度、支路索引和数值含义不同，当前保留双实现。`test_stamp_parity.py` 只对可统一的 8 类元件做逐项相等断言，电感不做 elementwise 对拍。

### 3.2 非线性器件的静态跳过（CF-05）

静态装配对 diode/zener/led/bjt/mosfet/opamp/comparator/dff 等返回 `None`，这是**有意行为**：它们的增量电导由 `DescriptorModel._apply_operating_point()` 在工作点处叠加。契约要求“跳过”而不是抛错，以保证既有电路仍可建立工作点模型。

### 3.3 错误类型分层

- 用户输入/配置错误（非法枚举、缺字段、越界路径）→ `ValidationError`；
- 数值求解失败（奇异、非有限、维度不匹配）→ `ComputeError`；
- 两侧都是 `NetlabError` 子类，HTTP 状态码由子类定义（`ComputeError.status=422`）。

## 4. G0 评审门禁

以下全部满足才算 G0 通过，才可在后续阶段宣称 Core V2 契约已冻结：

1. 本文件由项目负责人评审并签字（评审记录进入 `docs/canonical/decisions.yaml` 或等价 ADR）；
2. `python -m pytest netlab/tests/test_core_v2_contract.py -q` 全绿；
3. `test_analysis_api_surface.py` 快照 0 差异；
4. CI 必需检查（build/docker/desktop-l2/e2e/e2e-l1/test）全绿；
5. 无未决的对外 API 破坏；若有，必须列出迁移路径与版本号。

当前状态：1 已评审并签字（D155/D156）；2 已通过（全量 1811 passed/14 skipped/0 failed，覆盖率 87%）；3 已通过（API 快照 0 差异）；4 已通过（commit 9563cad 六项必需 CI 全部 success：build/docker/desktop-l2/e2e/e2e-l1/test）；5 无未决对外 API 破坏。

## 5. 变更控制

- 修改 CF-01..CF-14 任一条：提交必须包含“契约 ID + 旧行为 + 新行为 + 理由 + 测试”五段式说明；
- 修改 `StampSink`、`ac_sweep` 返回结构、`ComputeError` 语义：需 P3 负责人评审；
- 仅新增可选参数/新增导出：视为兼容变更，仍须补测试并在本文件登记；
- 禁止用降低断言阈值、跳过测试、删除快照来“满足”契约。

## 6. 与 P3-02..P3-08 的关系

| 阶段 | 与本契约的关系 |
|---|---|
| P3-02 analysis 分层 | 只移动实现位置，不改 `analysis.py` 对外导出与返回结构（CF-14）。 |
| P3-03 单一 StampBuilder | 已由 CF-03..CF-06 约束；新增 kind 必须同时接入两条 sink 与对拍。 |
| P3-04 ac_sweep strategy | 已由 CF-07..CF-09 约束；策略名/优先级不得变。 |
| P3-05 工作台四层 | 前端内部结构，不改变本契约；但不得绕过 API 契约直接拼装计算。 |
| P3-06 app.ts 拆分 | endpoint 清单与请求/响应语义保持不变（快照断言）。 |
| P3-07 GPU/FEM 边界 | 已由 CF-10..CF-13 约束。 |
| P3-08 总验收 | 以本文件 + 各阶段证据为验收基线。 |

## 7. 落地证据（commit 9563cad 已随 PR #75 合并 3817422，CI 六项全绿）

- `netlab/tests/test_core_v2_contract.py`：新增契约断言（版本、StampSink、静态分派、电感例外、AC 结果/策略/对拍、ComputeError、路径安全、FEM 枚举）。
- 定向实跑：`PYTHONPATH=. python -m pytest netlab/tests/test_core_v2_contract.py netlab/tests/test_fem.py -q`。
- 既有支撑：`test_stamp_parity.py`（8 类元件逐项相等）、`test_ac_backend.py`（三路 Bode 对拍）、`test_accel_fallback.py`（GPU 回退）、`test_workspace.py`（路径白名单）。
- 远程 CI（commit 9563cad）：build/docker/desktop-l2/e2e/e2e-l1/test 六项全部 success（run 45663814821/45663814598/45663814625/45663814662）。
