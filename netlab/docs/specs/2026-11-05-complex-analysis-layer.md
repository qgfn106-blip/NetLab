---
status: implemented
---
# 复数分析层（Complex Bridge）与统一频域响应

## Problem Statement

netlab 的频域分析目前分散在两条路径：

- 信号流网络通过 `analysis.transfer_function()` 做符号节点方程消元，再交给 `tf_analysis()` 做 Bode/阶跃；s 域延迟用 Padé 有理近似，阶数会膨胀，高频相位有误差。
- 电路网络通过 `nodal.ac_sweep()` 做复数 MNA，但结果只返回 `magnitude/phase_deg/db`，没有统一的复数值（`re/im`）；`transfer_function()` 又不支持 `circuit` 模式。

因此用户无法用同一套接口得到：

- 信号流和电路的 `H(jω)` 复数结果；
- 精确延迟 `e^{-jωT}` 的频响，而不是 Padé 近似；
- 一致的相位展开、群延迟和稳定裕度输入；
- 可供后续 Nyquist、阻抗、FFT/频谱复用的标准复数出口。

同时，如果把节点、状态、recorder、工程文件全部改成 `complex`，会破坏现有 JSON/checksum/CSV/PlotKit 兼容性，并让时域求解器承担不必要的复数开销。本规格要求的是**分析边界的复数层**，不是全量复数数据迁移。

## Solution

新增一层薄薄的 **Complex Bridge**：

1. 提供统一的实数↔复数转换函数，只在分析入口/出口使用。
2. 新增 `analysis.frequency_response()` 作为唯一公共频域响应入口，根据场景模式选择后端：
   - `signal`：复数信号流图求解，延迟边用精确 `e^{-jωT}`；
   - `circuit`：复用现有复数 MNA 的 AC 小信号求解。
3. 返回统一结构：`frequencies_hz`、`omega`、`real`、`imag`、`magnitude`、`phase_deg`（unwrapped）、`backend`、`assumptions`、`warnings`。
4. 保持时域、瞬态、recorder、工程文件、PlotKit 数据源全部为实数，不改变任何持久化格式。

## User Stories

1. 作为信号流用户，我想对任意输入/输出节点求 `H(jω)` 的实部和虚部，以便做 Nyquist、阻抗和自定义频域计算。
2. 作为信号流用户，我想让带单步延迟的频响使用精确 `e^{-jωT}`，以便高频相位不被 Padé 近似扭曲。
3. 作为电路用户，我想从任意独立源到任意节点/支路求 AC 小信号传函，以便不依赖瞬态仿真也能得到 Bode 数据。
4. 作为电路用户，我想继续复用现有 DC 工作点线性化和复数 MNA，以便非线性电路在正确工作点附近做小信号分析。
5. 作为分析用户，我想统一得到 unwrapped 相位、幅值和群延迟，以便 Bode 和 AC 面板不再出现相位差 360° 的不一致。
6. 作为分析用户，我想选择对数或线性频率网格，并限制频率点数量，以便控制扫描成本。
7. 作为分析用户，我想对非线性和非 LTI 网络得到明确的中文拒绝原因，而不是静默给出错误频响。
8. 作为脚本/API 用户，我想通过一个稳定的 `POST /api/analysis/frequency` 接口获取复数和幅相结果，以便导出 CSV/JSON。
9. 作为开发者，我想用 `as_complex()`/`as_complex_array()` 在分析边界转换，而不在每个时域函数里判断 `complex`。
10. 作为开发者，我想让时域 `SignalEngine.step()` 和电路瞬态继续返回实数，以便 recorder、PlotKit 和旧工程不受影响。
11. 作为维护者，我想让符号传函、`TransferFunction.frequency_response()` 和复数 MNA 共用同一套结果格式，以便减少重复实现。
12. 作为维护者，我想让矢量模式保持原样，以便本轮不引入二维运动/场分析的额外复杂度。

## Implementation Decisions

### 1. 复数转换层

新增独立模块，提供纯函数：

- `as_complex(value)`：`int/float/complex/numpy 标量` → Python `complex`；bool、字符串、None、容器抛出明确 `ValueError`。
- `as_complex_array(values)`：数值序列 → `numpy.ndarray(dtype=complex128)`，保持形状；拒绝 object dtype。
- `as_real(value)`：取精确实部；虚部超出浮点容差时抛出 `ValueError`，避免静默丢相位。
- `complex_parts(values)`：返回 `(real_array, imag_array)`，只用于 API/导出。
- `map_complex(obj)`：递归处理 dict/list/tuple 的数值叶子，返回同结构；用于批量输入适配。
- `phase_degrees(values, *, unwrap=True)`：统一相位出口。

不使用自定义 `ComplexValue` 类；内部计算直接用 Python `complex` / `numpy.complex128`，避免包装层开销。

### 2. 公共频域入口

新增 `analysis.frequency_response(sim, *, input, output, f_start=1.0, f_stop=1.0e6, points=241, scale="log", input_field="voltage", output_field="voltage")`：

- 根据 `sim.scene.mode` 自动分派，不新增用户可见的“复数模式”开关。
- `signal` 模式：
  - 只接受线性/LTI 节点；遇到非线性节点返回 `ok=False` 和中文原因。
  - 复用现有节点传函语义（gain/sum/lag/integrate/transfer_function/state_space/pass/scale）。
  - 每个频率装配 `(I - A(jω)) y = b` 并求解；延迟边乘 `exp(-1j*ω*dt)`，不使用 Padé。
  - 输出 `backend="complex_graph"`。
- `circuit` 模式：
  - 复用 `nodal.ac_sweep()` 的 DC 工作点线性化和复数 MNA；`input` 是独立源名，`output` 是节点/支路探针。
  - 扩展 `ac_sweep()` 的每个 probe 结果，增加 `real`/`imag` 两个数组；现有 `magnitude/phase_deg/db` 保持不变。
  - 输出 `backend="complex_mna"`。
- 公共结果字段：
  - `frequencies_hz`、`omega`；
  - `real`、`imag`；
  - `magnitude`、`phase_deg`（unwrapped）；
  - `backend`、`assumptions`、`warnings`、`ok`。
- 频率网格复用现有 `log/lin` 规则，`points` 上限与现有 AC 接口一致（2–2001）。

### 3. API 契约

新增 `POST /api/analysis/frequency`：

请求体：

- `input: str`
- `output: str`
- `f_start: float = 1.0`
- `f_stop: float = 1.0e6`
- `points: int = 241`
- `scale: "log" | "lin" = "log"`
- `input_field: str = "voltage"`
- `output_field: str = "voltage"`

响应：

```json
{
  "ok": true,
  "mode": "signal",
  "backend": "complex_graph",
  "frequencies_hz": [1.0],
  "omega": [6.283185307179586],
  "real": [1.0],
  "imag": [-0.1],
  "magnitude": [1.004987562112089],
  "phase_deg": [-5.710593137499643],
  "assumptions": ["延迟边按 e^{-jωT} 精确计算"],
  "warnings": []
}
```

失败时沿用现有 `AnalysisError` → 422 的映射；未安装 sympy 不影响复数 MNA 路径，只影响符号辅助路径。

### 4. 兼容性

- 不改变 `SignalEngine.step()`、`CircuitSolver` 瞬态、`Recorder`、工程 JSON/checksum、PlotKit 数据源的数据类型。
- 不改变现有 `/api/ac-sweep` 的字段；只新增 `real/imag`。
- `tf_analysis()` 的现有 Bode/阶跃行为不变；新的精确延迟频响通过 `frequency_response()` 获取。
- `spectrum()` 继续使用 `rfft` 处理实数信号；复数只用于相位谱等分析输出。

### 5. 前端范围

本轮只定义 API 和结果结构；现有 Bode/AC 图继续使用 `magnitude/phase_deg`。前端“复数响应”表格和 CSV 导出可在后续 UI 规格中接入，不在本规格强制新增控件。

## Testing Decisions

好的测试只验证外部可观察行为，不依赖私有函数或具体矩阵装配顺序。

- `complex_support`：标量/数组/嵌套容器的转换、幂等、bool/字符串拒绝、虚部非零时 `as_real` 拒绝。
- `analysis.frequency_response` 信号流：一阶 RC `1/(1+jωRC)` 的幅值/相位对照解析值；带延迟边时相位斜率对应 `-ωT`，且不出现 Padé 阶数膨胀。
- `analysis.frequency_response` 电路：RLC 分压/低通网络对照解析传递函数；复用 `nodal.ac_sweep` 的 DC 工作点。
- API：`POST /api/analysis/frequency` 的字段完整性、点数、`real/imag` 长度、错误码 422。
- 回归：`SignalEngine.step()` 返回 float；`Recorder`/CSV/项目 JSON 不出现 complex；现有 `test_network_tf.py`、`test_analysis_api.py`、`test_transfer.py` 不回归。
- 性能基准（非单元测试）：100 节点、241 频点的信号流复数图；100 节点 RLC 电路 AC；记录构建时间、求解时间、峰值内存。

优先复用的既有测试先例：

- `NetlabHome/netlab/tests/test_transfer.py`：传函数值/频响；
- `NetlabHome/netlab/tests/test_network_tf.py`：网络总传函；
- `NetlabHome/netlab/tests/test_analysis_api.py`：分析 API 契约。

## Out of Scope

- 全量把节点、状态、recorder、工程文件改成 `complex`。
- 修改 `.netlab` 格式、checksum 或 JSON 持久化。
- 非线性电路的复数 Newton/瞬态复数化。
- 二维矢量/场分析、`vector` 模式扩展。
- S 参数、Touchstone、任意频变元件模型。
- 前端新增完整复数分析页面、PlotKit 新图层。
- 用复数层替代现有符号传函的公式/零极点展示。

## Further Notes

**Seam 选择**：主 seam 是 `analysis.frequency_response()` 的公共函数边界，API 测试只打这一层；复数转换函数作为独立小 seam 单测。电路后端复用现有 `nodal.ac_sweep()`，信号流后端复用现有 `_node_tf`/`TransferFunction.at()` 语义，不新建第二套拓扑求解器。

**为什么不是全量复数**：`complex128` 与 `float64` 尾数精度相同，但内存翻倍；时域/瞬态/PlotKit 不需要复数。复数层只让 AC、频响、传函、FFT 等分析路径付复数成本。

**延迟语义**：`edge.delay` 表示单步延迟，物理时间取 `sim.config.dt`。频域精确因子为 `exp(-jω·dt)`；符号 s 域传函仍可用 Padé 近似用于阶跃/零极点展示，两者在 `assumptions` 中明确区分。

**验收基线**：实现后至少保持现有全量测试通过；新增信号流 RC、延迟相位、电路 AC、API 契约四组测试；给出小网络/大网络/延迟网络三组基准数据。
