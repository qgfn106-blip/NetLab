# NetLab P2 计算内核收敛报告（P2-02 / P2-01）

- 工作树：`ProjectPoint-worktrees/audit-20261124-p2circ`
- 分支：`feat/2026-11-24-p2-circuit`；基线 `c255769`
- 依据：`docs/audit/NETLAB_ARCHITECTURE_CONVERGENCE.md` 第 3、4 节
- 顺序：先 P2-02，后 P2-01
- 原则：只改本工作树；先读源码再改；不放宽阈值、不跳测、不改断言造假绿。

## P2-02 AC 扫频后端策略（权重 4）

### 原问题
`DescriptorModel.frequency_response`（descriptor.py:1014）把两条实现内联在同一方法体：
纯线性电路里委托 `CircuitSolver._ac_bode` 的快速核，同时又保留整套逐频点
`build()+solve()` 的原生实现；选择逻辑与两套实现耦合，难以独立演进/测试。

### 修改方式
- 新增 `netlab/core/compute/circuit/ac_backend.py`：
  - `AcSweepStrategy`（ABC，`name` + `sweep(model, frequencies, *, input_source, probes)`）；
  - `FastLinearStrategy`（name="fast"）：局部 import solver，调
    `CircuitSolver(model.nodes, model.elements)._ac_bode(...)`，补 `omega_rad_s/omega`，
    再 `model._attach_diagnostics(core, input_source)`；
  - `NativePerFrequencyStrategy`（name="native"）：逐频点 `build()/solve()`，产出
    real/imag/magnitude/phase_deg/db，`model._attach_diagnostics(output, input_source, system)`；
  - `select_strategy(model)`：`ac_backend == "descriptor"` → native；全部 kind ∈
    `CircuitSolver.AC_KINDS` → fast；否则 native（覆盖非线性线性化路径）；
  - 模块级 `ac_sweep(model, frequencies, *, input_source, probes, strategy)`：校验频率 →
    选策略 → 执行 → 补 `frequencies/omega_rad_s/omega` → 标注 `result["strategy"]`（"fast"/"native"）。
- `descriptor.frequency_response` 收敛为薄封装：`return ac_sweep(self, frequencies, ...)`。
- 数值与 API 不变；新增的 `strategy` 键为附加信息（现有测试用 `set(...) >= {...}`，不受影响）。

### 验证命令与结果
```
PYTHONPATH=. python -m pytest netlab/tests/test_ac_backend.py -q
# 6 passed
```
- 同一线性串联 RLC：fast / native / 强制 native(ac_backend="descriptor") / 默认 四路
  Bode 的 real/imag/magnitude/db 逐点 `assert_allclose(rtol=1e-8, atol=1e-12)` 全部通过；
- `omega_rad_s == 2πf`（rtol=atol=0）；`strategy` 标注正确（默认线性=fast，强制=native）；
- 非线性（kind="diode" 桩）自动选择 native。

### 完成度与遗留
- P2-02：完成。API/数值保持一致，descriptor 只选策略，不再内联两套实现。
- 遗留风险：`strategy` 为新增键；若有外部调用方对返回 dict 做严格全等断言需知会（仓内无此断言）。

## P2-01 单一 StampBuilder 契约（权重 5，高风险）

### 原问题
`elements.py` 12 个具体 kind 各自实现 `stamp(ctx)`；`descriptor.py:_assemble_matrices`
（原 descriptor.py:551）又按 kind 用 9 路 if/elif 独立装配静态 A/E。同一 MNA 贡献在两处
重复维护，易漂移；只有 `stamps.stamp_laplacian`（P1-R1）被共享。

### 修改方式
- 新增 `netlab/core/compute/circuit/stamp_builder.py`：
  - 两个 sink：`StaticMatrixSink`（descriptor 静态 A/E，`mode="static"`，无 rhs）与
    `ElementStampSink`（包装 `StampContext`，分支行取 `element.branch_index`）；
  - 单一 per-kind 贡献函数：`stamp_resistor / stamp_switch / stamp_sensor /
    stamp_capacitor / stamp_inductor_static / stamp_vsource / stamp_vcvs / stamp_vccs / stamp_isource`；
  - 总分派 `stamp_element_static(element, sink, *, bridge_control, bridge_gain)`，
    覆盖 descriptor 的全部 kind（含桥 actuator/actuator_i），未知 kind 保持旧"跳过"语义。
- `descriptor._assemble_matrices` 重写为：构造 `StaticMatrixSink` → 遍历 elements →
  仅对跨域桥计算 `_bridge_control_nodes/_bridge_gain` → `stamp_element_static`。
  **删除全部 9 路 kind 特判**（199 行 → 23 行）。
- `elements.py` 的 `Resistor/Switch/SensorElement/Capacitor/VoltageSource/CurrentSource/VCVS/VCCS`
  的 `stamp` 改为委托同一贡献函数（`ElementStampSink`），行为逐项保持。
- 允许的分步/回退：保留旧路径思想，contribution 函数即唯一实现；电感见下。

### 电感为何无法 elementwise 统一（如实说明）
- descriptor 把电感作为**独立支路电流**未知量：A 中 `+1/-1` 关联项 + `E[row,row] -= L`
  （方程 `v_a - v_b - L di/dt = 0`）；
- `elements.Inductor.stamp` 用**伴随电导**（二端、无支路未知量，`conductance/source_current`）。
- 两者未知量布局不同，若不改瞬态求解器语义无法逐项相等。因此：descriptor 静态侧走
  `stamp_inductor_static`（唯一实现），element 侧 `Inductor.stamp` 保留伴随实现并在
  本报告说明，未做 elementwise 对拍。
- 受控源 VCVS/VCCS 已通过 sink 统一（非多端特例），未保留旧分支。

### 验证命令与结果
```
PYTHONPATH=. python -m pytest netlab/tests/test_stamp_parity.py -q
# 8 passed
```
- 全电路（R/L/C/sensor/vsource/vcvs/vccs/isource 混合）descriptor 新装配与"旧内联实现
  字面重写"逐项相等（`rtol=atol=0`）；
- 电阻/开关/传感器：`element.stamp` 的 A 与 descriptor 静态 A 逐项相等；
- vsource/vcvs/vccs：A 关联/受控项逐项相等（rhs 不由静态装配产生）；
- 电容：descriptor 的 E 贡献 == element 交流 stamp 的 A 除以 jω（精确）；
- 电感：descriptor 侧 `E[row,row]=-L` 与关联项精确，element 侧伴随形式差异已在报告说明。

### 回归（既有测试，实跑）
```
pytest test_descriptor_*.py test_circuit_*.py test_ac_contract_m1.py test_p1r2_*.py \
       test_stamp_unification.py test_element_contracts.py -q        # 174 passed
pytest test_solver_*.py test_p4_elements.py test_nodal_index_validation.py \
       test_frequency_response.py test_loop_analysis.py test_algebraic_solver.py -q  # 92 passed
pytest test_analysis*.py -q                                          # 138 passed, 7 skipped
pytest test_ac_backend.py test_stamp_parity.py -q                    # 14 passed
```

### 既有测试的必要调整（非造假绿）
`netlab/tests/test_stamp_unification.py::test_descriptor_has_no_inline_laplacian_body`
原先断言 `descriptor.py` 内 `stamp_laplacian(` 出现次数 `>= 3`——这是 P1-R1 阶段的
"装配内联在 descriptor"的代理指标。P2-01 后静态装配迁至 `stamp_builder`，descriptor 仅余
`_apply_operating_point` 一处合法使用。该断言改为：
- descriptor 仍有该原语使用（`>= 1`，即线性化路径）；
- `stamp_builder` 使用 `stamp_laplacian(` `>= 2`（静态 Laplacian 的真正归属）；
- 仍然禁止 `E[ai, bi] -= capacitance` / `A[ai, bi] -= g` 内联体。
这是随架构迁移的等价+增强约束，不是放宽或删除测试。

### 完成度与遗留
- P2-01：完成（电阻/开关/传感器/电容/电压源/电流源/VCVS/VCCS/电感静态/跨域桥 全部收敛到
  单一 contribution 函数；descriptor 无 kind 特判）。
- 遗留风险：
  1) 电感 element 侧与 descriptor 侧形式不同（未知量布局），未做 elementwise 对拍；
  2) 跨域桥 actuator/actuator_i 的控制端解析仍留在 descriptor（属拓扑解析而非 kind 装配），
     贡献函数复用；
  3) 新增 `strategy` 键的兼容性见 P2-02。
