"""连接（边）计算方式注册表（信号层）。

每条连接拥有独立的参数与历史状态；工厂函数把校验后的参数编译成
``(source, target, params, state, dt) -> dict`` 形式的回调，步进时只做数值运算。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Callable

import numpy as np

from .limits import ComputeError
from .linalg import tustin_tf
from .params import ParamSpec, choice_param, float_param, matrix_param, validate_params

NodeData = dict[str, Any]
Method = Callable[..., NodeData]
Factory = Callable[[dict[str, Any]], Method]


@dataclass(frozen=True)
class MethodSpec:
    kind: str
    label: str
    group: str
    description: str
    params: tuple[ParamSpec, ...]
    factory: Factory
    outputs: tuple[str, ...] = ()
    notes: str = ""
    formula: str = ""
    source: str = ""
    editable: bool = False
    builtin: bool = True


METHOD_SPECS: dict[str, MethodSpec] = {}


def register(spec: MethodSpec) -> MethodSpec:
    if spec.kind in METHOD_SPECS:
        raise RuntimeError(f"重复注册连接方式：{spec.kind}")
    METHOD_SPECS[spec.kind] = spec
    return spec


def _read(node: Any, field: str) -> float:
    if field not in node.data:
        raise KeyError(f"节点 {node.name!r} 没有数据字段 {field!r}")
    raw = node.data[field]
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        raise TypeError(f"节点 {node.name!r} 的字段 {field!r} 不是数值")
    number = float(raw)
    if not math.isfinite(number):
        raise ValueError(f"节点 {node.name!r} 的字段 {field!r} 不是有限数值")
    return number


# ---- 通用信号处理 ----------------------------------------------------------
def _scale_factory(params: dict[str, Any]) -> Method:
    input_key = params["input_key"]
    output_key = params["output_key"]
    gain = params["gain"]
    offset = params["offset"]

    def method(source, target, _params, _state, _dt) -> NodeData:
        del target
        return {output_key: offset + gain * _read(source, input_key)}

    return method


register(
    MethodSpec(
        kind="scale",
        label="比例传递",
        group="信号",
        description="读取起点的一个字段，乘增益加偏置后传给终点。",
        params=(
            ParamSpec("input_key", "输入字段", "text", "voltage"),
            ParamSpec("output_key", "输出字段", "text", "voltage"),
            float_param("gain", "增益", 1.0, step=0.1),
            float_param("offset", "偏置", 0.0, step=0.1),
        ),
        factory=_scale_factory,
        outputs=("output_key",),
    )
)


def _delay_factory(params: dict[str, Any]) -> Method:
    input_key = params["input_key"]
    output_key = params["output_key"]
    initial = params["initial"]

    def method(source, target, _params, state, _dt) -> NodeData:
        del target
        # 延迟边由 Network 在步首求值，源节点尚未更新，
        # 读到的是上一拍的值，直接输出即可实现 z⁻¹。
        fallback = float(state.get("value", initial))
        raw = source.data.get(input_key, fallback)
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            current = fallback
        else:
            number = float(raw)
            current = number if math.isfinite(number) else fallback
        state["value"] = current
        return {output_key: current}

    return method


register(
    MethodSpec(
        kind="delay",
        label="单步延迟",
        group="信号",
        description="输出上一步的输入值（z⁻¹）。用来切断代数环或构造离散反馈。",
        params=(
            ParamSpec("input_key", "输入字段", "text", "voltage"),
            ParamSpec("output_key", "输出字段", "text", "voltage"),
            float_param("initial", "初值", 0.0, step=0.1),
        ),
        factory=_delay_factory,
        outputs=("output_key",),
        notes="延迟边不参与拓扑排序，因而可以安全地构成反馈回路",
    )
)


def _tf_factory(params: dict[str, Any]) -> Method:
    numerator = np.asarray(params["numerator"], dtype=float)
    denominator = np.asarray(params["denominator"], dtype=float)
    if numerator.size == 0 or denominator.size == 0:
        raise ComputeError("传递函数系数不能为空")
    if abs(denominator[0]) < 1e-300:
        raise ComputeError("传递函数分母首项不能为 0")
    domain = params["domain"]
    if domain == "discrete":
        # H(z) 的降幂系数 [b_m … b_0] / [a_n … a_0] 乘以 z^-n 后，
        # 在 z⁻¹ 下仍是同一顺序；归一化使 a[0] = 1 即可直接递推。
        b = numerator / denominator[0]
        a = denominator / denominator[0]
    else:
        b = a = None  # type: ignore[assignment]
    input_key = params["input_key"]
    output_key = params["output_key"]
    discretization = params["discretization"]
    cache: dict[str, Any] = {"dt": None, "b": b, "a": a}

    def coefficients(dt: float) -> tuple[np.ndarray, np.ndarray]:
        if domain == "discrete":
            return b, a  # type: ignore[return-value]
        if cache["dt"] != dt or cache["b"] is None:
            coeff_b, coeff_a = tustin_tf(numerator, denominator, dt)
            cache["dt"] = dt
            cache["b"] = coeff_b
            cache["a"] = coeff_a
        return cache["b"], cache["a"]

    def compute(source, target, _params, state, dt) -> NodeData:
        del target
        coefficients_b, coefficients_a = coefficients(dt)
        order = max(coefficients_b.size, coefficients_a.size) - 1
        b_padded = np.pad(coefficients_b, (0, order + 1 - coefficients_b.size))
        a_padded = np.pad(coefficients_a, (0, order + 1 - coefficients_a.size))

        stored = state.get("s")
        if not isinstance(stored, list) or len(stored) != order:
            stored = [0.0] * order
        u = _read(source, input_key)
        y = b_padded[0] * u + (stored[0] if order else 0.0)
        for index in range(order):
            nxt = stored[index + 1] if index + 1 < order else 0.0
            stored[index] = b_padded[index + 1] * u + nxt - a_padded[index + 1] * y
        state["s"] = stored
        if not math.isfinite(y) or abs(y) > 1.0e15:
            raise ComputeError("传递函数输出发散（出现非有限数值）")
        return {output_key: float(y)}

    return compute


register(
    MethodSpec(
        kind="tf",
        label="传递函数",
        group="信号",
        description="按传递函数 H(s) 或 H(z) 处理输入；连续域按双线性变换离散。",
        params=(
            ParamSpec(
                "domain",
                "域",
                "choice",
                "continuous",
                choices=(("continuous", "连续 s 域"), ("discrete", "离散 z 域")),
                help="系数均按降幂排列，例如 s+1 写作 [1, 1]",
            ),
            ParamSpec(
                "numerator",
                "分子系数",
                "list",
                [1.0],
                help="降幂排列，例如 [1, 2] 表示 s + 2",
            ),
            ParamSpec(
                "denominator",
                "分母系数",
                "list",
                [1.0, 1.0],
                help="首项不能为 0；连续域示例 [1, 1] 表示 s + 1",
            ),
            choice_param(
                "discretization",
                "离散化",
                "tustin",
                (("tustin", "双线性 Tustin"),),
                help="连续域目前使用双线性变换",
            ),
            ParamSpec("input_key", "输入字段", "text", "voltage"),
            ParamSpec("output_key", "输出字段", "text", "voltage"),
        ),
        factory=_tf_factory,
        outputs=("output_key",),
        notes="使用直接 II 型转置结构，状态保存在连接 state.s",
    )
)


def _integrator_factory(params: dict[str, Any]) -> Method:
    input_key = params["input_key"]
    output_key = params["output_key"]
    gain = params["gain"]
    initial = params["initial"]
    lower = params["lower"]
    upper = params["upper"]
    if lower > upper:
        raise ComputeError("积分下限不能大于上限")

    def method(source, target, _params, state, dt) -> NodeData:
        del target
        value = float(state.get("y", initial))
        value += gain * _read(source, input_key) * dt
        value = min(upper, max(lower, value))
        state["y"] = value
        return {output_key: value}

    return method


register(
    MethodSpec(
        kind="integrator",
        label="积分传递",
        group="动态",
        description="对起点字段积分后传给终点，可限幅；用于构造连续状态的离散近似。",
        params=(
            ParamSpec("input_key", "输入字段", "text", "voltage"),
            ParamSpec("output_key", "输出字段", "text", "voltage"),
            float_param("gain", "增益", 1.0, step=0.1),
            float_param("initial", "初值", 0.0, step=0.1),
            float_param("lower", "下限", -1.0e6),
            float_param("upper", "上限", 1.0e6),
        ),
        factory=_integrator_factory,
        outputs=("output_key",),
    )
)


def _clamp_factory(params: dict[str, Any]) -> Method:
    input_key = params["input_key"]
    output_key = params["output_key"]
    lower = params["minimum"]
    upper = params["maximum"]
    if lower > upper:
        raise ComputeError("限幅下限不能大于上限")

    def method(source, target, _params, _state, _dt) -> NodeData:
        del target
        value = _read(source, input_key)
        return {output_key: min(upper, max(lower, value))}

    return method


register(
    MethodSpec(
        kind="clamp",
        label="限幅传递",
        group="信号",
        description="把起点字段截断到上下限后传给终点。",
        params=(
            ParamSpec("input_key", "输入字段", "text", "voltage"),
            ParamSpec("output_key", "输出字段", "text", "voltage"),
            float_param("minimum", "下限", -10.0, step=0.5),
            float_param("maximum", "上限", 10.0, step=0.5),
        ),
        factory=_clamp_factory,
        outputs=("output_key",),
    )
)


# ---- 模块端口 --------------------------------------------------------------
def _pass_factory(params: dict[str, Any]) -> Method:
    max_fields = int(params["max_fields"])

    def method(source, target, _params, _state, _dt) -> NodeData:
        del target
        # 端口 / 功能块接线只搬运有限数值字段：布尔与文本视为配置而非信号。
        values: dict[str, Any] = {}
        for key, raw in source.data.items():
            if len(values) >= max_fields:
                break
            if isinstance(raw, bool) or not isinstance(raw, (int, float)):
                continue
            number = float(raw)
            if math.isfinite(number):
                values[key] = number
        return values

    return method


register(
    MethodSpec(
        kind="pass",
        label="直通传递",
        group="模块",
        description="把起点节点的有限数值字段原样传给终点；用于模块端口与功能块接线。",
        params=(
            ParamSpec(
                "max_fields",
                "最大字段数",
                "int",
                16,
                minimum=1,
                maximum=32,
                help="只复制前若干个有限数值字段，避免整份 data 被搬运",
            ),
        ),
        factory=_pass_factory,
        outputs=(),
        notes="布尔、文本与非有限数值会被忽略；不做任何运算",
    )
)


# ---- 电路元件（信号层近似，便于在没有求解器时快速搭原型） -----------------
def _resistor_factory(params: dict[str, Any]) -> Method:
    resistance = params["R"]
    input_key = params["input_key"]

    def method(source, target, _params, _state, _dt) -> NodeData:
        voltage = _read(source, input_key) - _read(target, input_key)
        current = voltage / resistance
        return {
            "current": current,
            "voltage_difference": voltage,
            "power": voltage * current,
        }

    return method


register(
    MethodSpec(
        kind="resistor",
        label="电阻（电流）",
        group="电路",
        description="按欧姆定律把两端电压差换算成电流（信号层近似，不做节点求解）。",
        params=(
            float_param("R", "电阻 R", 1000.0, unit="Ω", positive=True, step=10.0),
            ParamSpec("input_key", "电压字段", "text", "voltage"),
        ),
        factory=_resistor_factory,
        outputs=("current",),
        notes="完整电路请在“电路模式”使用节点电压法",
    )
)


def _capacitor_factory(params: dict[str, Any]) -> Method:
    capacitance = params["C"]
    input_key = params["input_key"]

    def method(source, target, _params, state, dt) -> NodeData:
        voltage = _read(source, input_key) - _read(target, input_key)
        previous = float(state.get("voltage", 0.0))
        current = capacitance * (voltage - previous) / dt
        state["voltage"] = voltage
        return {
            "current": current,
            "voltage_difference": voltage,
            "power": voltage * current,
        }

    return method


register(
    MethodSpec(
        kind="capacitor",
        label="电容（后向欧拉）",
        group="电路",
        description="i = C·(v - v_prev)/dt，历史电压保存在连接上。",
        params=(
            float_param(
                "C", "电容 C", 1.0e-6, unit="F", positive=True, step=1.0e-6
            ),
            ParamSpec("input_key", "电压字段", "text", "voltage"),
        ),
        factory=_capacitor_factory,
        outputs=("current",),
    )
)


def _inductor_factory(params: dict[str, Any]) -> Method:
    inductance = params["L"]
    input_key = params["input_key"]
    initial = params["initial"]

    def method(source, target, _params, state, dt) -> NodeData:
        voltage = _read(source, input_key) - _read(target, input_key)
        current = float(state.get("current", initial))
        current += voltage * dt / inductance
        state["current"] = current
        return {
            "current": current,
            "voltage_difference": voltage,
            "power": voltage * current,
        }

    return method


register(
    MethodSpec(
        kind="inductor",
        label="电感（后向欧拉）",
        group="电路",
        description="i += v·dt/L，历史电流保存在连接上。",
        params=(
            float_param(
                "L", "电感 L", 1.0e-3, unit="H", positive=True, step=1.0e-4
            ),
            float_param("initial", "初始电流", 0.0, unit="A", step=0.1),
            ParamSpec("input_key", "电压字段", "text", "voltage"),
        ),
        factory=_inductor_factory,
        outputs=("current",),
    )
)


def _diode_factory(params: dict[str, Any]) -> Method:
    saturation = params["Is"]
    emission = params["n"]
    temperature = params["temperature"]
    input_key = params["input_key"]
    thermal = 8.617333262e-5 * temperature

    def method(source, target, _params, _state, _dt) -> NodeData:
        voltage = _read(source, input_key) - _read(target, input_key)
        exponent = min(40.0, voltage / (emission * thermal))
        current = saturation * math.expm1(exponent)
        return {
            "current": current,
            "voltage_difference": voltage,
            "power": voltage * current,
        }

    return method


register(
    MethodSpec(
        kind="diode",
        label="二极管（肖克利）",
        group="电路",
        description="i = Is·(exp(v/(n·Vt)) - 1)；指数项在 40 处截断以防溢出。",
        params=(
            float_param(
                "Is", "饱和电流 Is", 1.0e-12, unit="A", positive=True, step=1.0e-13
            ),
            float_param("n", "理想因子 n", 1.0, positive=True, step=0.1),
            float_param(
                "temperature",
                "温度",
                300.0,
                unit="K",
                positive=True,
                minimum=200.0,
                maximum=500.0,
                step=1.0,
            ),
            ParamSpec("input_key", "电压字段", "text", "voltage"),
        ),
        factory=_diode_factory,
        outputs=("current",),
    )
)


# ---- 二维矢量连接 ----------------------------------------------------------
def _read_or(node: Any, field: str, default: float = 0.0) -> float:
    raw = node.data.get(field, default)
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return default
    number = float(raw)
    return number if math.isfinite(number) else default


def _vector_factory(params: dict[str, Any]) -> Method:
    matrix = params["matrix"]
    if not isinstance(matrix, list) or len(matrix) != 2:
        raise ComputeError("矢量连接矩阵必须是 2×2")
    m00, m01 = float(matrix[0][0]), float(matrix[0][1])
    m10, m11 = float(matrix[1][0]), float(matrix[1][1])
    input_x = params["input_x"]
    input_y = params["input_y"]
    output_x = params["output_x"]
    output_y = params["output_y"]
    offset_x = float(params["offset_x"])
    offset_y = float(params["offset_y"])

    def method(source, target, _params, _state, _dt) -> NodeData:
        del target
        x = _read_or(source, input_x)
        y = _read_or(source, input_y)
        nx = m00 * x + m01 * y + offset_x
        ny = m10 * x + m11 * y + offset_y
        return {
            output_x: float(nx),
            output_y: float(ny),
            "magnitude": float(math.hypot(nx, ny)),
        }

    return method


register(
    MethodSpec(
        kind="vector",
        label="矢量传递",
        group="矢量",
        description="读取起点的二维矢量，按 2×2 矩阵变换后传给终点。",
        params=(
            matrix_param(
                "matrix",
                "变换矩阵",
                [[1.0, 0.0], [0.0, 1.0]],
                help="旋转 / 缩放 / 剪切；2×2",
            ),
            ParamSpec("input_x", "输入 x 字段", "text", "x"),
            ParamSpec("input_y", "输入 y 字段", "text", "y"),
            ParamSpec("output_x", "输出 x 字段", "text", "x"),
            ParamSpec("output_y", "输出 y 字段", "text", "y"),
            float_param("offset_x", "平移 x", 0.0, step=0.1),
            float_param("offset_y", "平移 y", 0.0, step=0.1),
        ),
        factory=_vector_factory,
        outputs=("x", "y", "magnitude"),
        notes="适合把振子状态送入旋转 / 缩放环节",
    )
)


def _vector_diffusion_factory(params: dict[str, Any]) -> Method:
    gain = float(params["gain"])
    input_x = params["input_x"]
    input_y = params["input_y"]
    output_x = params["output_x"]
    output_y = params["output_y"]

    def method(source, target, _params, _state, _dt) -> NodeData:
        sx = _read_or(source, input_x)
        sy = _read_or(source, input_y)
        tx = _read_or(target, input_x)
        ty = _read_or(target, input_y)
        dx = gain * (sx - tx)
        dy = gain * (sy - ty)
        return {
            output_x: float(dx),
            output_y: float(dy),
            "distance": float(math.hypot(dx, dy)),
        }

    return method


register(
    MethodSpec(
        kind="vector_diffusion",
        label="矢量扩散耦合",
        group="矢量",
        description=(
            "输出 gain × (起点矢量 − 终点矢量)。接到非线性源的 dx/dy 入边后，"
            "可构造双向耦合振子网络；建议设为单步延迟。"
        ),
        params=(
            float_param("gain", "耦合增益", 0.2, step=0.02),
            ParamSpec("input_x", "x 字段", "text", "x"),
            ParamSpec("input_y", "y 字段", "text", "y"),
            ParamSpec("output_x", "输出差字段 x", "text", "dx"),
            ParamSpec("output_y", "输出差字段 y", "text", "dy"),
        ),
        factory=_vector_diffusion_factory,
        outputs=("dx", "dy", "distance"),
        notes="双向连接时应使用延迟边，避免代数环",
    )
)


# ---- 对外接口 -------------------------------------------------------------
def get_method_spec(kind: str) -> MethodSpec:
    spec = METHOD_SPECS.get(kind)
    if spec is None:
        raise ComputeError(f"未知的连接计算方式：{kind!r}")
    return spec


def prepare_method(
    kind: str, raw_params: dict[str, Any] | None
) -> tuple[MethodSpec, dict[str, Any], Method]:
    spec = get_method_spec(kind)
    params = validate_params(list(spec.params), raw_params)
    return spec, params, spec.factory(params)


def method_catalog() -> list[dict[str, Any]]:
    from .introspection import formula_for, spec_entry

    return [
        spec_entry(
            spec,
            mode="signal",
            formula=formula_for(spec, METHOD_FORMULAS),
        )
        for spec in METHOD_SPECS.values()
    ]


METHOD_FORMULAS: dict[str, str] = {
    "pass": "y[字段] = x[字段]    （只搬运有限数值字段，供功能块边界直通使用）",
    "scale": "y = offset + gain · x[input_key]",
    "delay": "y[k] = x[k-1]    （延迟边在步首求值，严格 z⁻¹）",
    "tf": "H(s)=B(s)/A(s) → Tustin → H(z)\ny[k] = b0·u[k] + s1[k-1]  （直接 II 型转置）",
    "integrator": "y[k] = clip(y[k-1] + gain·x·dt, lower, upper)",
    "clamp": "y = clip(x[input_key], minimum, maximum)",
    "resistor": "i = (v_source − v_target) / R\np = v·i    （信号层近似，不做节点求解）",
    "capacitor": "i = C·(v[k] − v[k-1]) / dt    （后向欧拉）",
    "inductor": "i[k] = i[k-1] + v·dt/L    （后向欧拉）",
    "diode": "i = Is·(exp(v/(n·Vt)) − 1),  Vt = k_B·T/q；指数在 40 处截断",
    "vector": "[x_out; y_out] = M·[x_in; y_in] + offset",
    "vector_diffusion": "dx = gain·(x_source − x_target)\ndy = gain·(y_source − y_target)",
}


def default_method_params(kind: str) -> dict[str, Any]:
    spec = get_method_spec(kind)
    return validate_params(list(spec.params), {})
