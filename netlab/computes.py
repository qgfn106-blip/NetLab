"""节点计算方式注册表（信号层）。

每一种 ``kind`` 都附带参数模式、说明与工厂函数。界面从 ``compute_catalog``
读取表单定义；服务端只执行这里的受控实现，绝不执行用户提交的代码。
"""

from __future__ import annotations

import copy
import math
from dataclasses import dataclass
from typing import Any, Callable

from .graph import ComputeContext, NodeData
from .limits import ComputeError
from .params import (
    ParamSpec,
    choice_param,
    float_param,
    json_param,
    matrix_param,
    validate_params,
)
from .safeexpr import evaluate as evaluate_expression
from .statespace import StateSpaceModel, state_space_specs
from .waveform import WAVEFORM_SPECS, waveform_value
from .ports import PortSpec

Handler = Callable[[ComputeContext], NodeData]
Factory = Callable[[dict[str, Any]], Handler | None]


@dataclass(frozen=True)
class ComputeSpec:
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
    #: 是否允许用户从「添加节点」菜单手动创建。模块相关 kind 只能由模块库
    #: 实例化 / 封装生成，手动创建会得到没有 block_id 的坏节点（P0-0）。
    addable: bool = True
    #: 输入端口（R20/Q8）：边用 target_port 绑定到这里；空=不声明端口。
    inputs: tuple[PortSpec, ...] = ()


COMPUTE_SPECS: dict[str, ComputeSpec] = {}


def register(spec: ComputeSpec) -> ComputeSpec:
    if spec.kind in COMPUTE_SPECS:
        raise RuntimeError(f"重复注册节点计算方式：{spec.kind}")
    COMPUTE_SPECS[spec.kind] = spec
    return spec


def _numeric(payload: dict[str, Any], field: str, *, source: str) -> float:
    if field not in payload:
        raise ComputeError(f"连接 {source!r} 没有字段 {field!r}")
    value = payload[field]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ComputeError(f"连接 {source!r} 的字段 {field!r} 不是数值")
    number = float(value)
    if not math.isfinite(number):
        raise ComputeError(f"连接 {source!r} 的字段 {field!r} 不是有限数值")
    return number


def _sum_inputs(ctx: ComputeContext, field: str, weights: dict[str, float]) -> float:
    total = 0.0
    for source, payload in ctx.inputs.items():
        total += weights.get(source, 1.0) * _numeric(payload, field, source=source)
    return total


def _port_value(ctx: ComputeContext, port: str, field: str) -> float | None:
    """R20/Q8：优先读端口载荷；没有端口绑定时返回 None（调用方回退旧聚合）。"""
    payload = getattr(ctx, "ports", {}).get(port)
    if not payload:
        return None
    if port in payload and isinstance(payload[port], (int, float)) and not isinstance(payload[port], bool):
        return float(payload[port])
    if "value" in payload and isinstance(payload["value"], (int, float)) and not isinstance(payload["value"], bool):
        return float(payload["value"])
    for item in payload.values():
        if isinstance(item, (int, float)) and not isinstance(item, bool) and math.isfinite(float(item)):
            return float(item)
    return None


# ---- 基础 -----------------------------------------------------------------
def _manual_factory(params: dict[str, Any]) -> Handler | None:
    del params
    return None


register(
    ComputeSpec(
        kind="manual",
        label="手动数据源",
        group="基础",
        description="不自动计算，直接使用节点数据；适合作为外部输入或常量。",
        params=(),
        factory=_manual_factory,
        outputs=(),
    )
)


def _sum_factory(params: dict[str, Any]) -> Handler:
    field = params["field"]
    output = params["output"]
    raw_weights = params["weights"]
    weights: dict[str, float] = {}
    for key, value in raw_weights.items():
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ComputeError(f"权重 {key!r} 必须是数值")
        weights[key] = float(value)

    def handler(ctx: ComputeContext) -> NodeData:
        return {output: _sum_inputs(ctx, field, weights)}

    return handler


register(
    ComputeSpec(
        kind="sum",
        label="输入求和",
        group="基础",
        description="把每条入边指定字段相加，写入输出字段；可为单条连接设置权重。",
        params=(
            ParamSpec("field", "输入字段", "text", "voltage"),
            ParamSpec("output", "输出字段", "text", "voltage"),
            json_param("weights", "连接权重", {}, help='例如 {"R1": 0.5}'),
        ),
        factory=_sum_factory,
        outputs=("output",),
    )
)


def _gain_factory(params: dict[str, Any]) -> Handler:
    field = params["field"]
    output = params["output"]
    gain = params["gain"]
    offset = params["offset"]

    def handler(ctx: ComputeContext) -> NodeData:
        total = _sum_inputs(ctx, field, {})
        return {output: offset + gain * total}

    return handler


register(
    ComputeSpec(
        kind="gain",
        label="比例放大",
        group="基础",
        description="把所有入边求和后乘增益再加偏置：y = offset + gain·Σu。",
        params=(
            ParamSpec("field", "输入字段", "text", "voltage"),
            ParamSpec("output", "输出字段", "text", "voltage"),
            float_param("gain", "增益", 1.0, step=0.1),
            float_param("offset", "偏置", 0.0, step=0.1),
        ),
        factory=_gain_factory,
        outputs=("output",),
    )
)


# ---- 动态 -----------------------------------------------------------------
def _lag_factory(params: dict[str, Any]) -> Handler:
    field = params["field"]
    output = params["output"]
    tau = params["tau"]
    initial = params["initial"]

    def handler(ctx: ComputeContext) -> NodeData:
        state = ctx.state
        target = _sum_inputs(ctx, field, {})
        value = float(state.get("y", initial))
        if tau <= 0.0:
            value = target
        else:
            alpha = min(1.0, max(0.0, ctx.dt / tau))
            value += (target - value) * alpha
        state["y"] = value
        return {output: value}

    return handler


register(
    ComputeSpec(
        kind="lag",
        label="一阶惯性",
        group="动态",
        description="一阶低通/惯性环节：τ·dy/dt = u - y，按后向/前向混合的一阶近似推进。",
        params=(
            ParamSpec("field", "输入字段", "text", "voltage"),
            ParamSpec("output", "输出字段", "text", "voltage"),
            float_param("tau", "时间常数 τ", 0.1, unit="s", positive=True, step=0.01),
            float_param("initial", "初值", 0.0, step=0.1),
        ),
        factory=_lag_factory,
        outputs=("output",),
        notes="状态保存在节点 state.y",
    )
)


def _integrate_factory(params: dict[str, Any]) -> Handler:
    field = params["field"]
    output = params["output"]
    gain = params["gain"]
    initial = params["initial"]
    lower = params["lower"]
    upper = params["upper"]
    if lower > upper:
        raise ComputeError("积分下限不能大于上限")

    def handler(ctx: ComputeContext) -> NodeData:
        state = ctx.state
        value = float(state.get("acc", initial))
        total = _sum_inputs(ctx, field, {})
        value += gain * total * ctx.dt
        if value < lower:
            value = lower
        elif value > upper:
            value = upper
        state["acc"] = value
        return {output: value}

    return handler


register(
    ComputeSpec(
        kind="integrate",
        label="积分器",
        group="动态",
        description="对输入求积分并限幅：y += gain·u·dt，适合作为状态变量。",
        params=(
            ParamSpec("field", "输入字段", "text", "voltage"),
            ParamSpec("output", "输出字段", "text", "voltage"),
            float_param("gain", "增益", 1.0, step=0.1),
            float_param("initial", "初值", 0.0, step=0.1),
            float_param("lower", "下限", -1.0e6),
            float_param("upper", "上限", 1.0e6),
        ),
        factory=_integrate_factory,
        outputs=("output",),
        notes="状态保存在节点 state.acc",
    )
)


def _signal_factory(params: dict[str, Any]) -> Handler:
    output = params["field"]

    def handler(ctx: ComputeContext) -> NodeData:
        state = ctx.state
        time_value = float(state.get("t", 0.0)) + ctx.dt
        state["t"] = time_value
        return {output: waveform_value(params, time_value)}

    return handler


register(
    ComputeSpec(
        kind="signal",
        label="信号发生器",
        group="动态",
        description="按仿真时间产生直流、正弦、方波、三角波、锯齿、脉冲、阶跃或斜坡。",
        params=(ParamSpec("field", "输出字段", "text", "value"), *WAVEFORM_SPECS),
        factory=_signal_factory,
        outputs=("field",),
        notes="频率单位 Hz，相位单位度；时间由 dt 累加",
    )
)


def _expression_factory(params: dict[str, Any]) -> Handler:
    expression = params["expr"].strip()
    raw_variables = params["variables"]
    output = params["output"]
    variables: dict[str, str] = {}
    for name, source in raw_variables.items():
        if not str(name).isidentifier():
            raise ComputeError(f"表达式变量名 {name!r} 不合法")
        source_text = str(source).strip()
        if not source_text:
            raise ComputeError(f"变量 {name!r} 的来源不能为空")
        variables[str(name)] = source_text

    def resolve(ctx: ComputeContext, source: str) -> float:
        if "." in source:
            origin, field = source.split(".", 1)
        else:
            origin, field = source, "voltage"
        if origin == "data":
            if field not in ctx.data:
                raise ComputeError(f"节点数据缺少字段 {field!r}")
            raw = ctx.data[field]
        else:
            payload = ctx.inputs.get(origin)
            if payload is None:
                return 0.0
            if field not in payload:
                raise ComputeError(
                    f"连接 {origin!r} 没有字段 {field!r}"
                )
            raw = payload[field]
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            raise ComputeError(f"表达式来源 {source!r} 不是数值")
        return float(raw)

    def handler(ctx: ComputeContext) -> NodeData:
        values = {name: resolve(ctx, source) for name, source in variables.items()}
        return {output: evaluate_expression(expression, values)}

    return handler


register(
    ComputeSpec(
        kind="expression",
        label="安全表达式",
        group="高级",
        description="用受限算术表达式组合输入；不执行任意代码，只允许数学函数。",
        params=(
            ParamSpec(
                "expr",
                "表达式",
                "text",
                "u * 2 + 1",
                placeholder="例如 u * 0.5 + sin(t)",
                help="可用变量由下方映射定义",
            ),
            json_param(
                "variables",
                "变量映射",
                {"u": "in.voltage"},
                help='变量 -> "连接名.字段" 或 "data.字段"',
            ),
            ParamSpec("output", "输出字段", "text", "value"),
        ),
        factory=_expression_factory,
        outputs=("output",),
    )
)


def _state_space_factory(params: dict[str, Any]) -> Handler:
    model = StateSpaceModel.from_params(params)

    def handler(ctx: ComputeContext) -> NodeData:
        u = model.resolve_inputs(ctx.inputs)
        y, _x = model.step(ctx.state, u, ctx.dt)
        result: NodeData = {}
        for name, value in zip(model.output_map, y):
            result[name] = float(value)
        return result

    return handler


register(
    ComputeSpec(
        kind="state_space",
        label="状态空间",
        group="高级",
        description="标准状态空间模型 x' = Ax + Bu、y = Cx + Du，按所选方法离散后推进。",
        params=tuple(state_space_specs()),
        factory=_state_space_factory,
        outputs=("output_map",),
        notes="输入映射按顺序列出 m 个来源；输出字段按顺序写入节点数据",
    )
)


def _clip_factory(params: dict[str, Any]) -> Handler:
    field = params["field"]
    output = params["output"]
    lower = params["minimum"]
    upper = params["maximum"]
    if lower > upper:
        raise ComputeError("下限不能大于上限")

    def handler(ctx: ComputeContext) -> NodeData:
        total = _sum_inputs(ctx, field, {})
        return {output: min(upper, max(lower, total))}

    return handler


register(
    ComputeSpec(
        kind="clip",
        label="限幅",
        group="基础",
        description="对输入求和后做上下限截断，可用于饱和环节。",
        params=(
            ParamSpec("field", "输入字段", "text", "voltage"),
            ParamSpec("output", "输出字段", "text", "voltage"),
            float_param("minimum", "下限", -10.0, step=0.5),
            float_param("maximum", "上限", 10.0, step=0.5),
        ),
        factory=_clip_factory,
        outputs=("output",),
    )
)


# ---- 非线性动态源与矢量 ----------------------------------------------------
def _loose_sum(ctx: ComputeContext, field: str) -> float:
    """把入边上的某个字段相加；缺失字段按 0 处理。"""
    total = 0.0
    for payload in ctx.inputs.values():
        raw = payload.get(field)
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            continue
        number = float(raw)
        if math.isfinite(number):
            total += number
    return total


def _rk4_3d(
    dt: float,
    state: tuple[float, float, float],
    time_value: float,
    derivative,
) -> tuple[float, float, float]:
    """四阶 Runge–Kutta；derivative(t, x, y, z) -> (dx, dy, dz)。"""
    x0, y0, z0 = state
    k1 = derivative(time_value, x0, y0, z0)
    h = 0.5 * dt
    k2 = derivative(
        time_value + h,
        x0 + h * k1[0],
        y0 + h * k1[1],
        z0 + h * k1[2],
    )
    k3 = derivative(
        time_value + h,
        x0 + h * k2[0],
        y0 + h * k2[1],
        z0 + h * k2[2],
    )
    k4 = derivative(
        time_value + dt,
        x0 + dt * k3[0],
        y0 + dt * k3[1],
        z0 + dt * k3[2],
    )
    return (
        x0 + dt * (k1[0] + 2.0 * k2[0] + 2.0 * k3[0] + k4[0]) / 6.0,
        y0 + dt * (k1[1] + 2.0 * k2[1] + 2.0 * k3[1] + k4[1]) / 6.0,
        z0 + dt * (k1[2] + 2.0 * k2[2] + 2.0 * k3[2] + k4[2]) / 6.0,
    )


OSCILLATOR_SYSTEMS: tuple[tuple[str, str], ...] = (
    ("duffing", "Duffing 双阱振子"),
    ("vanderpol", "Van der Pol 极限环"),
    ("pendulum", "单摆 / 相位振子"),
    ("lorenz", "Lorenz 混沌"),
)


def _oscillator_factory(params: dict[str, Any]) -> Handler:
    system = str(params["system"])
    damping = float(params["damping"])
    stiffness = float(params["stiffness"])
    nonlinearity = float(params["nonlinearity"])
    forcing = float(params["forcing_amplitude"])
    frequency = float(params["forcing_frequency"])
    coupling = float(params["coupling"])
    sigma = float(params["sigma"])
    rho = float(params["rho"])
    beta = float(params["beta"])
    initial = (
        float(params["initial_x"]),
        float(params["initial_y"]),
        float(params["initial_z"]),
    )
    two_pi = 2.0 * math.pi

    def handler(ctx: ComputeContext) -> NodeData:
        state = ctx.state
        current = (
            float(state.get("x", initial[0])),
            float(state.get("y", initial[1])),
            float(state.get("z", initial[2])),
        )
        # 入边 dx / dy 是邻居与自身的差，按扩散耦合注入加速度。
        diff_x = _loose_sum(ctx, "dx")
        diff_y = _loose_sum(ctx, "dy")

        def derivative(t: float, x: float, y: float, z: float) -> tuple[float, float, float]:
            drive = forcing * math.sin(two_pi * frequency * t)
            if system == "duffing":
                dx = y
                dy = -damping * y - stiffness * x - nonlinearity * x * x * x + drive
                dz = 0.0
            elif system == "vanderpol":
                dx = y
                dy = damping * (1.0 - x * x) * y - stiffness * x + drive
                dz = 0.0
            elif system == "pendulum":
                dx = y
                dy = -damping * y - stiffness * math.sin(x) + drive
                dz = 0.0
            elif system == "lorenz":
                dx = sigma * (y - x)
                dy = x * (rho - z) - y
                dz = x * y - beta * z
            else:  # pragma: no cover - 参数校验已拦截
                raise ComputeError(f"未知的非线性振子：{system!r}")
            dy += coupling * diff_x
            dx += 0.05 * coupling * diff_y
            return dx, dy, dz

        nxt = _rk4_3d(ctx.dt, current, ctx.time - ctx.dt, derivative)
        if not all(math.isfinite(value) for value in nxt) or max(abs(v) for v in nxt) > 1.0e6:
            raise ComputeError("非线性振子发散了，请减小 dt 或耦合增益")
        state["x"], state["y"], state["z"] = nxt
        vx, vy, vz = derivative(ctx.time, *nxt)
        return {
            "x": float(nxt[0]),
            "y": float(nxt[1]),
            "z": float(nxt[2]),
            "vx": float(vx),
            "vy": float(vy),
            "vz": float(vz),
        }

    return handler


register(
    ComputeSpec(
        kind="oscillator",
        label="非线性动态源",
        group="矢量",
        description=(
            "以 RK4 积分的非线性振子：Duffing、Van der Pol、单摆或 Lorenz。"
            "输出位置 x/y/z 与速度 vx/vy/vz；入边 dx/dy 可提供扩散耦合。"
        ),
        params=(
            choice_param("system", "动力学系统", "duffing", OSCILLATOR_SYSTEMS),
            float_param("damping", "阻尼", 0.15, step=0.05),
            float_param("stiffness", "刚度", 1.0, step=0.1),
            float_param("nonlinearity", "非线性强度", 0.4, step=0.1),
            float_param("forcing_amplitude", "驱动力幅值", 0.6, step=0.1),
            float_param("forcing_frequency", "驱动频率", 0.25, unit="Hz", step=0.05),
            float_param("coupling", "扩散耦合", 0.0, step=0.05),
            float_param("sigma", "Lorenz σ", 10.0),
            float_param("rho", "Lorenz ρ", 28.0),
            float_param("beta", "Lorenz β", 2.6667, step=0.1),
            float_param("initial_x", "初值 x", 1.0, step=0.1),
            float_param("initial_y", "初值 y", 0.0, step=0.1),
            float_param("initial_z", "初值 z", 0.0, step=0.1),
        ),
        factory=_oscillator_factory,
        outputs=("x", "y", "z", "vx", "vy", "vz"),
        notes="状态保存在节点 state.x / y / z",
    )
)


def _nonlinear_plant_factory(params: dict[str, Any]) -> Handler:
    a = float(params["a"])
    b = float(params["b"])
    c = float(params["c"])
    disturbance = float(params["disturbance"])
    frequency = float(params["frequency"])
    initial_x = float(params["initial_x"])
    initial_v = float(params["initial_v"])
    two_pi = 2.0 * math.pi

    def handler(ctx: ComputeContext) -> NodeData:
        state = ctx.state
        x = float(state.get("x", initial_x))
        v = float(state.get("v", initial_v))
        control = _loose_sum(ctx, "u")
        external = _loose_sum(ctx, "w")

        def derivative(t: float, px: float, pv: float, _z: float) -> tuple[float, float, float]:
            dx = pv
            dv = (
                -a * px
                - b * px * px * px
                - c * pv
                + control
                + external
                + disturbance * math.sin(two_pi * frequency * t)
            )
            return dx, dv, 0.0

        nxt = _rk4_3d(ctx.dt, (x, v, 0.0), ctx.time - ctx.dt, derivative)
        if not math.isfinite(nxt[0]) or not math.isfinite(nxt[1]) or abs(nxt[0]) > 1.0e6:
            raise ComputeError("非线性被控对象发散了，请检查控制增益或减小 dt")
        state["x"], state["v"] = nxt[0], nxt[1]
        return {
            "x1": float(nxt[0]),
            "x2": float(nxt[1]),
            "u": float(control),
            "w": float(external),
        }

    return handler


register(
    ComputeSpec(
        kind="nonlinear_plant",
        label="非线性被控对象",
        group="矢量",
        description=(
            "二阶 Duffing 型对象：x1' = x2，"
            "x2' = −a·x1 − b·x1³ − c·x2 + u + w + 扰动。"
            "u 来自入边字段 u，w 来自扰动源。"
        ),
        params=(
            float_param("a", "线性刚度 a", 1.0, step=0.1),
            float_param("b", "立方刚度 b", 0.5, step=0.1),
            float_param("c", "阻尼 c", 0.35, step=0.05),
            float_param("disturbance", "内置扰动幅值", 0.25, step=0.05),
            float_param("frequency", "扰动频率", 0.5, unit="Hz", step=0.05),
            float_param("initial_x", "初值 x1", 0.0, step=0.1),
            float_param("initial_v", "初值 x2", 0.0, step=0.1),
        ),
        factory=_nonlinear_plant_factory,
        outputs=("x1", "x2", "u", "w"),
        notes="输入字段 u（控制）与 w（外部扰动）；状态 state.x / v",
    )
)


def _sliding_mode_factory(params: dict[str, Any]) -> Handler:
    lam = float(params["lambda"])
    gain = float(params["gain"])
    eta = float(params["eta"])
    phi = max(1.0e-6, float(params["phi"]))
    limit = float(params["limit"])
    feedforward = float(params["feedforward"])
    if limit <= 0:
        raise ComputeError("控制限幅必须大于 0")

    def handler(ctx: ComputeContext) -> NodeData:
        reference = _loose_sum(ctx, "ref")
        reference_rate = _loose_sum(ctx, "dref")
        value = _loose_sum(ctx, "x")
        rate = _loose_sum(ctx, "dx")
        error = reference - value
        error_rate = reference_rate - rate
        surface = error_rate + lam * error
        raw = feedforward + gain * surface + eta * math.tanh(surface / phi)
        control = max(-limit, min(limit, raw))
        return {
            "u": float(control),
            "s": float(surface),
            "error": float(error),
            "de": float(error_rate),
        }

    return handler


register(
    ComputeSpec(
        kind="sliding_mode",
        label="滑模控制器",
        group="矢量",
        description=(
            "非线性滑模面 s = de + λ·e，控制 u = sat(ff + k·s + η·tanh(s/φ))。"
            "输入 ref/dref/x/dx，输出 u/s/error/de。"
        ),
        params=(
            float_param("lambda", "滑模面 λ", 2.5, step=0.1),
            float_param("gain", "比例增益 k", 4.0, step=0.2),
            float_param("eta", "切换增益 η", 1.2, step=0.1),
            float_param("phi", "边界层 φ", 0.08, step=0.01, positive=True),
            float_param("limit", "控制限幅", 12.0, step=0.5, positive=True),
            float_param("feedforward", "前馈", 0.0, step=0.1),
        ),
        factory=_sliding_mode_factory,
        outputs=("u", "s", "error", "de"),
        notes="tanh 边界层抑制抖振；输出经过硬限幅",
    )
)


def _vector_transform_factory(params: dict[str, Any]) -> Handler:
    matrix = params["matrix"]
    if not isinstance(matrix, list) or len(matrix) != 2:
        raise ComputeError("矢量变换矩阵必须是 2×2")
    m00, m01 = float(matrix[0][0]), float(matrix[0][1])
    m10, m11 = float(matrix[1][0]), float(matrix[1][1])
    input_x = params["input_x"]
    input_y = params["input_y"]
    output_x = params["output_x"]
    output_y = params["output_y"]
    offset_x = float(params["offset_x"])
    offset_y = float(params["offset_y"])

    def handler(ctx: ComputeContext) -> NodeData:
        ported_x = _port_value(ctx, "x", input_x)
        ported_y = _port_value(ctx, "y", input_y)
        x = ported_x if ported_x is not None else _loose_sum(ctx, input_x)
        y = ported_y if ported_y is not None else _loose_sum(ctx, input_y)
        nx = m00 * x + m01 * y + offset_x
        ny = m10 * x + m11 * y + offset_y
        return {
            output_x: float(nx),
            output_y: float(ny),
            "magnitude": float(math.hypot(nx, ny)),
            "angle": float(math.atan2(ny, nx)),
        }

    return handler


register(
    ComputeSpec(
        kind="vector_transform",
        label="二维矢量变换",
        group="矢量",
        description="把入边的二维矢量按 2×2 矩阵旋转 / 缩放 / 剪切，并输出模长与角度。",
        params=(
            matrix_param(
                "matrix",
                "变换矩阵",
                [[1.0, 0.0], [0.0, 1.0]],
                help="2×2；旋转示例：[[cos,-sin],[sin,cos]]",
            ),
            ParamSpec("input_x", "输入 x 字段", "text", "x"),
            ParamSpec("input_y", "输入 y 字段", "text", "y"),
            ParamSpec("output_x", "输出 x 字段", "text", "x"),
            ParamSpec("output_y", "输出 y 字段", "text", "y"),
            float_param("offset_x", "平移 x", 0.0, step=0.1),
            float_param("offset_y", "平移 y", 0.0, step=0.1),
        ),
        factory=_vector_transform_factory,
        outputs=("x", "y", "magnitude", "angle"),
        inputs=(PortSpec("x", "input"), PortSpec("y", "input")),
        notes="矢量分量沿入边字段传递，不依赖节点坐标",
    )
)


# ---- 功能块与端口接口 ------------------------------------------------------
def _module_port_factory(params: dict[str, Any]) -> Handler | None:
    role = str(params.get("role", "interface"))
    if role == "interface" and str(params.get("direction", "")) == "input":
        # 内部输入接口：数据由 BlockRuntime 每拍注入，不做额外计算。
        return None
    if role == "interface" and str(params.get("direction", "")) == "output":
        pass
    # 端口节点 / 内部输出接口：把入边上的所有数值字段按字段名求和。
    def handler(ctx: ComputeContext) -> NodeData:
        totals: dict[str, float] = {}
        for payload in ctx.inputs.values():
            for key, value in payload.items():
                if isinstance(value, bool) or not isinstance(value, (int, float)):
                    continue
                number = float(value)
                if not math.isfinite(number):
                    continue
                totals[key] = totals.get(key, 0.0) + number
        return {key: float(value) for key, value in totals.items()}

    return handler


_MODULE_COMMON_PARAMS = (
    ParamSpec("port_name", "端口名称", "text", "port"),
    ParamSpec("role", "角色", "choice", "port", choices=(("port", "父场景端口"), ("interface", "内部接口"))),
    json_param("fields", "字段", ["voltage"], help='例如 ["voltage"] 或 ["x","y"]'),
    ParamSpec("dtype", "数据类型", "choice", "signal", choices=(("signal", "标量"), ("vector", "二维矢量"), ("bit", "逻辑位"), ("any", "任意"))),
    float_param("default", "默认值", 0.0, step=0.1),
    ParamSpec("block_id", "所属功能块", "text", ""),
)


register(
    ComputeSpec(
        kind="module_input",
        label="模块输入端口",
        group="模块",
        description="父场景的输入接口节点；接收外部连接的数据并注入内部输入接口。",
        params=_MODULE_COMMON_PARAMS,
        factory=_module_port_factory,
        outputs=("fields",),
        notes="role=interface 时由 BlockRuntime 注入数据；role=port 时对入边求和",
        addable=False,
    )
)


register(
    ComputeSpec(
        kind="module_output",
        label="模块输出端口",
        group="模块",
        description="模块输出接口节点；把内部输出接口的数据传递到父场景。",
        params=_MODULE_COMMON_PARAMS,
        factory=_module_port_factory,
        outputs=("fields",),
        notes="内部接口与父场景输出端口使用同一套求和逻辑",
        addable=False,
    )
)


def _block_factory(params: dict[str, Any]) -> Handler | None:
    del params
    return None


register(
    ComputeSpec(
        kind="block",
        label="功能块实例",
        group="模块",
        description="执行一个保存好的功能性网络；由引擎在运行时装配内部节点与端口。",
        params=(
            ParamSpec("block_id", "功能块 id", "text", ""),
            ParamSpec("block_name", "功能块名称", "text", ""),
            json_param("input_nodes", "输入端口节点", {}, help="端口名 → 父场景节点 id"),
            json_param("output_nodes", "输出端口节点", {}, help="端口名 → 父场景节点 id"),
        ),
        factory=_block_factory,
        outputs=(),
        notes="内部网络实例独立 state；节点/连接数受模块上限保护",
        addable=False,
    )
)


# ---- 跨模式接口块（R06 / D11） --------------------------------------------
def _if_signal_to_vector_factory(params: dict[str, Any]) -> Handler:
    input_field = str(params["input_field"])
    angle = float(params["angle"]) * math.pi / 180.0
    output_x = str(params["output_x"])
    output_y = str(params["output_y"])

    def handler(ctx: ComputeContext) -> NodeData:
        ported = _port_value(ctx, "u", input_field)
        magnitude = ported if ported is not None else _sum_inputs(ctx, input_field, {})
        return {
            output_x: float(magnitude * math.cos(angle)),
            output_y: float(magnitude * math.sin(angle)),
            "magnitude": float(abs(magnitude)),
        }

    return handler


register(
    ComputeSpec(
        kind="if_signal_to_vector",
        label="信号→矢量接口",
        group="接口",
        description="把标量信号按给定角度映射成二维矢量；显式声明跨模式换算，不做隐式转换。",
        params=(
            ParamSpec("input_field", "输入字段", "text", "voltage"),
            float_param("angle", "矢量角度", 0.0, unit="°", minimum=-360.0, maximum=360.0, step=15.0),
            ParamSpec("output_x", "输出 x 字段", "text", "x"),
            ParamSpec("output_y", "输出 y 字段", "text", "y"),
        ),
        factory=_if_signal_to_vector_factory,
        outputs=("x", "y", "magnitude"),
        inputs=(PortSpec("u", "input"),),
        notes="signal↔vector 互通按 D11 走显式接口；不涉及 circuit",
        formula="x = u·cos(θ),  y = u·sin(θ),  magnitude = |u|",
    )
)


def _if_vector_to_signal_factory(params: dict[str, Any]) -> Handler:
    component = str(params["component"])
    input_x = str(params["input_x"])
    input_y = str(params["input_y"])
    output_field = str(params["output_field"])
    scale = float(params["scale"])

    def handler(ctx: ComputeContext) -> NodeData:
        ported_x = _port_value(ctx, "x", input_x)
        ported_y = _port_value(ctx, "y", input_y)
        x = ported_x if ported_x is not None else _sum_inputs(ctx, input_x, {})
        y = ported_y if ported_y is not None else _sum_inputs(ctx, input_y, {})
        if component == "x":
            value = x
        elif component == "y":
            value = y
        else:
            value = math.hypot(x, y)
        return {output_field: float(value * scale)}

    return handler


register(
    ComputeSpec(
        kind="if_vector_to_signal",
        label="矢量→信号接口",
        group="接口",
        description="从二维矢量取分量或模长，映射成标量信号；换算显式可查。",
        params=(
            choice_param("component", "取法", "magnitude", (("x", "x 分量"), ("y", "y 分量"), ("magnitude", "模长"))),
            ParamSpec("input_x", "输入 x 字段", "text", "x"),
            ParamSpec("input_y", "输入 y 字段", "text", "y"),
            ParamSpec("output_field", "输出字段", "text", "voltage"),
            float_param("scale", "比例系数", 1.0, step=0.1),
        ),
        factory=_if_vector_to_signal_factory,
        outputs=("voltage",),
        inputs=(PortSpec("x", "input"), PortSpec("y", "input")),
        notes="与 if_signal_to_vector 成对使用；跨 circuit 需 P4 的电路侧接口块",
        formula="u = scale · (x 或 y 或 hypot(x,y))",
    )
)


# ---- 对外接口 -------------------------------------------------------------
def get_compute_spec(kind: str) -> ComputeSpec:
    spec = COMPUTE_SPECS.get(kind)
    if spec is None:
        raise ComputeError(f"未知的节点计算方式：{kind!r}")
    return spec


def prepare_compute(
    kind: str, raw_params: dict[str, Any] | None
) -> tuple[ComputeSpec, dict[str, Any], Handler | None]:
    """校验参数并构造处理器；返回 (模式, 规范化参数, 处理器)。"""
    spec = get_compute_spec(kind)
    params = validate_params(list(spec.params), raw_params)
    handler = spec.factory(params)
    return spec, params, handler


def compute_catalog() -> list[dict[str, Any]]:
    from .introspection import formula_for, spec_entry

    result = []
    for spec in COMPUTE_SPECS.values():
        entry = spec_entry(
            spec,
            mode="signal",
            formula=formula_for(spec, COMPUTE_FORMULAS),
        )
        entry["inputs"] = [port.to_dict() for port in spec.inputs]
        result.append(entry)
    return result


COMPUTE_FORMULAS: dict[str, str] = {
    "manual": "data = 用户输入；handler = None，不自动计算",
    "sum": "y = Σ_i w_i · u_i    （u_i 为第 i 条入边的 field）",
    "gain": "y = offset + gain · Σ_i u_i",
    "lag": "y[k] = y[k-1] + α·(Σu − y[k-1]),  α = clamp(dt/τ, 0, 1)",
    "integrate": "y[k] = clip(y[k-1] + gain·Σu·dt, lower, upper)",
    "signal": "y = waveform(t; 类型, offset, amplitude, frequency, duty, phase, delay)",
    "expression": "y = f(u_1,…,u_n, data, t)    （受限 AST，无 eval）",
    "state_space": "x[k+1] = Ad·x[k] + Bd·u[k]\ny = C·x + D·u",
    "clip": "y = clip(Σu, minimum, maximum)",
    "oscillator": "x' = y\ny' = −d·y − k·x − β·x³ + A·sin(2πft)   (Duffing)\nRK4 积分，输出 x/y/z 与 vx/vy/vz",
    "nonlinear_plant": "x1' = x2\nx2' = −a·x1 − b·x1³ − c·x2 + u + w + D·sin(2πft)\nRK4 积分",
    "sliding_mode": "e = ref − x,  de = dref − dx\ns = de + λ·e\nu = sat(ff + k·s + η·tanh(s/φ), ±limit)",
    "if_signal_to_vector": "x = u·cos(θ),  y = u·sin(θ),  magnitude = |u|",
    "if_vector_to_signal": "u = scale · (x | y | hypot(x, y))",
    "vector_transform": "[x_out; y_out] = M·[x_in; y_in] + [offset_x; offset_y]\nmagnitude = hypot(x_out, y_out), angle = atan2(y_out, x_out)",
    "module_input": "port = 输入端口；data 由父场景写入，输出原样传递给内部网络",
    "module_output": "port = 输出端口；把内部网络写回的 data 原样输出给父场景",
    "block": "执行 BlockDef 内部 sig/vector 网络；输入端口 → 内部 module_input → 内部网络 → module_output → 输出端口",
    "logic_gate": "y = gate(a, b)    （AND/OR/NOT/XOR/NAND/NOR/XNOR，0/1 逻辑）",
    "logic_input": "y = 1 if u ≥ threshold else 0    （模拟 → 数字，带可选迟滞）",
    "logic_output": "y = high_voltage if bit else low_voltage    （数字 → 模拟）",
    "d_ff": "Q[k+1] = D if CLK 上升沿 else Q[k]",
    "jk_ff": "CLK 上升沿：J=1,K=0 → 1；J=0,K=1 → 0；J=K=1 → 翻转；J=K=0 → 保持",
    "register": "CLK 上升沿：并行锁存 D0..Dn；输出 Q0..Qn",
    "counter": "CLK 上升沿：count = (count ± 1) mod 2^bits；输出 Q0..Qn 与 carry",
}


def default_compute_params(kind: str) -> dict[str, Any]:
    spec = get_compute_spec(kind)
    return copy.deepcopy(validate_params(list(spec.params), {}))
