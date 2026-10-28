"""节点电压法（MNA）瞬态电路求解器。

未知量 = 非接地节点电压 + 独立电压源/VCVS 的支路电流。
线性元件直接盖章；电容、电感使用梯形法或后向欧拉伴随模型；
二极管用 Newton–Raphson 迭代并带结电压限幅。

这一层天然支持反馈、双向元件与理想源，是“电路模式”的计算内核。
"""

from __future__ import annotations

import copy
import math
import time as _time
from dataclasses import dataclass, field, replace as _dataclass_replace
from typing import Any, Callable

import numpy as np

from . import accel
from .profiling import timed
from .limits import ComputeError, ConflictError, ValidationError
from .linalg import solve_linear
from .params import ParamSpec, choice_param, float_param, validate_params
from .waveform import WAVEFORM_SPECS, waveform_value

try:  # SciPy 已在 requirements 中；没有时仍可用 NumPy 求解。
    from scipy.linalg import lu_factor as _scipy_lu_factor
    from scipy.linalg import lu_solve as _scipy_lu_solve
except Exception:  # pragma: no cover - 依赖环境
    _scipy_lu_factor = None
    _scipy_lu_solve = None

try:  # 稀疏装配/分解（R26/D53）；缺失时 auto 自动回退稠密。
    from scipy import sparse as _sparse
    from scipy.sparse.linalg import splu as _splu
except Exception:  # pragma: no cover - 依赖环境
    _sparse = None
    _splu = None

K_BOLTZMANN = 8.617333262e-5
MAX_NEWTON_ITERATIONS = 60
NEWTON_ABS_TOL = 1.0e-6
NEWTON_REL_TOL = 1.0e-9
MAX_ABS_VOLTAGE = 1.0e9


@dataclass(frozen=True)
class SolverOptions:
    """P0：可调收敛参数（默认保持旧行为，gmin 仅作为失败后的救急）。"""

    reltol: float = NEWTON_REL_TOL
    vntol: float = NEWTON_ABS_TOL
    abstol: float = NEWTON_ABS_TOL
    max_iter: int = MAX_NEWTON_ITERATIONS
    #: gmin stepping 的起始泄漏电导（每个 trial ×0.1，最终回到 0）。
    #: 默认保持旧行为：从 1e-3 开始递减；由 SimConfig.gmin 覆盖。
    gmin: float = 1.0e-3
    gmin_steps: int = 10
    src_steps: int = 10
    #: 0 = 不强制残差检查；>0 = 相对后向误差阈值（尺度无关）
    residual_tol: float = 0.0
    #: 未显式设置 residual_tol 时的安全阈值（防止明显错误的解进入 commit）。
    residual_safety_tol: float = 1.0e-8
    #: 行列均衡：降低“病态但可解”和“真奇异”的混淆。
    scaling: bool = True
    #: 缩放后 LU 的零主元判定阈值（相对最大主元）。
    pivot_tol: float = 1.0e-14
    #: 稀疏矩阵策略：auto=超过阈值自动切换、on=强制稀疏、off=强制稠密（R26/D53）。
    sparse: str = "auto"
    #: auto 模式下矩阵尺寸超过该值改用稀疏（默认 200）。
    sparse_threshold: int = 200


@dataclass(slots=True)
class CircuitNode:
    id: str
    name: str
    ground: bool = False


@dataclass
class StampContext:
    A: Any
    rhs: np.ndarray
    index: dict[str, int]
    solution: np.ndarray
    dt: float
    time: float
    iteration: int
    #: tran=瞬态、dc=直流工作点、ac=小信号交流（R26/D54–D56）。
    mode: str = "tran"
    #: 交流分析的角频率（rad/s）；mode="ac" 时由求解器逐点设置。
    omega: float = 0.0

    def voltage(self, node_id: str) -> float:
        position = self.index.get(node_id)
        return 0.0 if position is None else float(self.solution[position])


def _stamp_conductance(ctx: StampContext, a: str, b: str, g: float) -> None:
    ai = ctx.index.get(a)
    bi = ctx.index.get(b)
    if ai is not None:
        ctx.A[ai, ai] += g
    if bi is not None:
        ctx.A[bi, bi] += g
    if ai is not None and bi is not None:
        ctx.A[ai, bi] -= g
        ctx.A[bi, ai] -= g


def _stamp_current(ctx: StampContext, a: str, b: str, value: float) -> None:
    """元件内部电流从 a 流向 b 时，对 KCL 右端的贡献。"""
    ai = ctx.index.get(a)
    bi = ctx.index.get(b)
    if ai is not None:
        ctx.rhs[ai] -= value
    if bi is not None:
        ctx.rhs[bi] += value


class CircuitElement:
    kind = "element"
    label = "元件"
    needs_branch = False
    nonlinear = False
    output_fields: tuple[str, ...] = ("current", "voltage_difference", "power")

    def __init__(
        self,
        name: str,
        a: str,
        b: str,
        params: dict[str, Any],
        state: dict[str, Any],
        *,
        integration: str = "trapezoidal",
        pins: dict[str, str] | None = None,
    ) -> None:
        self.name = name
        self.a = a
        self.b = b
        self.params = params
        self.state = state
        self.integration = integration
        #: R20：器件节点的「引脚名 → 网络节点 id」；旧边=元件时为空。
        self.pins: dict[str, str] = dict(pins or {})
        self.branch_index = -1
        self.internal_nodes: list[str] = []
        self.result: dict[str, float] = {}
        #: P1-01：Newton 迭代猜测与已提交历史分离；失败步不会污染 state。
        self.iteration_guess: dict[str, float] = {}
        self.dt = 0.0
        self.time = 0.0

    def reset(self) -> None:
        """清空历史（保留参数）。子类覆盖。"""
        self.iteration_guess.clear()

    def prepare(self, dt: float, time: float) -> None:
        self.dt = dt
        self.time = time

    def stamp(self, ctx: StampContext) -> None:  # pragma: no cover - 抽象
        raise NotImplementedError

    def update_guess(self, ctx: StampContext) -> None:
        del ctx

    def commit(self, ctx: StampContext) -> None:
        voltage = ctx.voltage(self.a) - ctx.voltage(self.b)
        current = self.current(ctx)
        self.result = {
            "current": float(current),
            "voltage_difference": float(voltage),
            "power": float(voltage * current),
        }

    def current(self, ctx: StampContext) -> float:
        del ctx
        return 0.0

    def pin(self, name: str, param_key: str | None = None) -> str:
        """取引脚绑定的网络 id；兼容垫片：没有引脚时回退到旧参数端口。"""
        if name in self.pins:
            return self.pins[name]
        if param_key is not None:
            return str(self.params.get(param_key) or "")
        raise ComputeError(f"元件 {self.name!r} 缺少引脚 {name!r}")


# ---- 线性元件 --------------------------------------------------------------
class Resistor(CircuitElement):
    kind = "resistor"
    label = "电阻"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.conductance = 1.0 / float(self.params["R"])

    def stamp(self, ctx: StampContext) -> None:
        _stamp_conductance(ctx, self.a, self.b, self.conductance)

    def commit(self, ctx: StampContext) -> None:
        voltage = ctx.voltage(self.a) - ctx.voltage(self.b)
        current = voltage * self.conductance
        self.result = {
            "current": float(current),
            "voltage_difference": float(voltage),
            "power": float(voltage * current),
        }


class Capacitor(CircuitElement):
    kind = "capacitor"
    label = "电容"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        capacitance = float(self.params["C"])
        self.capacitance = capacitance
        if "v" not in self.state:
            self.state["v"] = float(self.params.get("v0", 0.0))
        if "i" not in self.state:
            self.state["i"] = 0.0
        # 保证历史值是干净的数值
        self.state["v"] = float(self.state["v"])
        self.state["i"] = float(self.state["i"])
        self.conductance = 0.0
        self.source_current = 0.0
        #: Gear2（BDF2）本步是否拿到了合法的两步历史；否则本步回退后向欧拉。
        self._gear_ready = False

    def reset(self) -> None:
        self.state["v"] = float(self.params.get("v0", 0.0))
        self.state["i"] = 0.0
        self.state.pop("v_prev", None)
        self.state.pop("gear_dt", None)
        self._gear_ready = False

    def prepare(self, dt: float, time: float) -> None:
        super().prepare(dt, time)
        cache = self.capacitance
        previous_v = float(self.state["v"])
        previous_i = float(self.state["i"])
        self._gear_ready = False
        if self.integration == "backward_euler":
            self.conductance = cache / dt
            self.source_current = -self.conductance * previous_v
        elif self.integration == "gear2":
            older_v = self.state.get("v_prev")
            same_dt = float(self.state.get("gear_dt", 0.0)) == float(dt)
            if older_v is None or not same_dt:
                # 历史不足（首步/切换/dt 变化）：本步回退后向欧拉，避免 BDF2 失真。
                self.conductance = cache / dt
                self.source_current = -self.conductance * previous_v
            else:
                self._gear_ready = True
                self.conductance = 1.5 * cache / dt
                self.source_current = (
                    cache * (-2.0 * previous_v + 0.5 * float(older_v)) / dt
                )
        else:
            self.conductance = 2.0 * cache / dt
            self.source_current = (
                -self.conductance * previous_v - previous_i
            )

    def stamp(self, ctx: StampContext) -> None:
        if ctx.mode == "dc":
            # 直流工作点：电容开路，不参与 KCL。
            return
        if ctx.mode == "ac":
            # 小信号交流：导纳 jωC（电压源/电流源由求解器设成单位激励）。
            _stamp_conductance(ctx, self.a, self.b, 1j * ctx.omega * self.capacitance)
            return
        _stamp_conductance(ctx, self.a, self.b, self.conductance)
        _stamp_current(ctx, self.a, self.b, self.source_current)

    def commit(self, ctx: StampContext) -> None:
        voltage = ctx.voltage(self.a) - ctx.voltage(self.b)
        if ctx.mode == "dc":
            self.result = {
                "current": 0.0,
                "voltage_difference": float(voltage),
                "power": 0.0,
            }
            return
        previous_v = float(self.state["v"])
        previous_i = float(self.state["i"])
        if self.integration == "backward_euler":
            current = self.conductance * (voltage - previous_v)
        elif self.integration == "gear2":
            if self._gear_ready:
                current = self.conductance * voltage + self.source_current
            else:
                current = self.conductance * (voltage - previous_v)
        else:
            current = self.conductance * (voltage - previous_v) - previous_i
        if self.integration == "gear2":
            # 滚动两步历史；dt 变化由 prepare 用 gear_dt 判定后自动回退。
            self.state["v_prev"] = previous_v
            self.state["gear_dt"] = float(ctx.dt)
        self.state["v"] = voltage
        self.state["i"] = current
        self.result = {
            "current": float(current),
            "voltage_difference": float(voltage),
            "power": float(voltage * current),
        }

    def current(self, ctx: StampContext) -> float:
        del ctx
        return float(self.state["i"])


class Inductor(CircuitElement):
    kind = "inductor"
    label = "电感"
    #: 直流工作点里电感按短路处理（1e5 S ≈ 10 µΩ），电流由 v·g 反算。
    DC_CONDUCTANCE = 1.0e5

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.inductance = float(self.params["L"])
        if "i" not in self.state:
            self.state["i"] = float(self.params.get("initial", 0.0))
        if "v" not in self.state:
            self.state["v"] = 0.0
        self.state["i"] = float(self.state["i"])
        self.state["v"] = float(self.state["v"])
        self.conductance = 0.0
        self.source_current = 0.0
        self._gear_ready = False

    def reset(self) -> None:
        self.state["i"] = float(self.params.get("initial", 0.0))
        self.state["v"] = 0.0
        self.state.pop("i_prev", None)
        self.state.pop("gear_dt", None)
        self._gear_ready = False

    def prepare(self, dt: float, time: float) -> None:
        super().prepare(dt, time)
        previous_i = float(self.state["i"])
        previous_v = float(self.state["v"])
        self._gear_ready = False
        if self.integration == "backward_euler":
            self.conductance = dt / self.inductance
            self.source_current = previous_i
        elif self.integration == "gear2":
            older_i = self.state.get("i_prev")
            same_dt = float(self.state.get("gear_dt", 0.0)) == float(dt)
            if older_i is None or not same_dt:
                self.conductance = dt / self.inductance
                self.source_current = previous_i
            else:
                # BDF2：i_{n+1} = dt/(1.5L)·v + (2i_n − 0.5i_{n-1})/1.5
                self._gear_ready = True
                self.conductance = dt / (1.5 * self.inductance)
                self.source_current = (
                    2.0 * previous_i - 0.5 * float(older_i)
                ) / 1.5
        else:
            self.conductance = dt / (2.0 * self.inductance)
            self.source_current = previous_i + self.conductance * previous_v

    def stamp(self, ctx: StampContext) -> None:
        if ctx.mode == "dc":
            _stamp_conductance(ctx, self.a, self.b, self.DC_CONDUCTANCE)
            return
        if ctx.mode == "ac":
            if ctx.omega == 0.0:
                _stamp_conductance(ctx, self.a, self.b, self.DC_CONDUCTANCE)
            else:
                _stamp_conductance(ctx, self.a, self.b, 1.0 / (1j * ctx.omega * self.inductance))
            return
        _stamp_conductance(ctx, self.a, self.b, self.conductance)
        _stamp_current(ctx, self.a, self.b, self.source_current)

    def commit(self, ctx: StampContext) -> None:
        voltage = ctx.voltage(self.a) - ctx.voltage(self.b)
        if ctx.mode == "dc":
            current = self.DC_CONDUCTANCE * voltage
            self.result = {
                "current": float(current),
                "voltage_difference": float(voltage),
                "power": float(voltage * current),
            }
            return
        previous_i = float(self.state["i"])
        current = self.conductance * voltage + self.source_current
        if self.integration == "gear2":
            self.state["i_prev"] = previous_i
            self.state["gear_dt"] = float(ctx.dt)
        self.state["i"] = current
        self.state["v"] = voltage
        self.result = {
            "current": float(current),
            "voltage_difference": float(voltage),
            "power": float(voltage * current),
        }

    def current(self, ctx: StampContext) -> float:
        del ctx
        return float(self.state["i"])


class VoltageSource(CircuitElement):
    kind = "vsource"
    label = "电压源"
    needs_branch = True

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.value = 0.0

    def prepare(self, dt: float, time: float) -> None:
        super().prepare(dt, time)
        self.value = waveform_value(self.params, time)

    def stamp(self, ctx: StampContext) -> None:
        row = self.branch_index
        ai = ctx.index.get(self.a)
        bi = ctx.index.get(self.b)
        if ai is not None:
            ctx.A[ai, row] += 1.0
            ctx.A[row, ai] += 1.0
        if bi is not None:
            ctx.A[bi, row] -= 1.0
            ctx.A[row, bi] -= 1.0
        ctx.rhs[row] = self.value * getattr(self, "source_scale", 1.0)

    def current(self, ctx: StampContext) -> float:
        return float(ctx.solution[self.branch_index])

    def commit(self, ctx: StampContext) -> None:
        current = self.current(ctx)
        voltage = ctx.voltage(self.a) - ctx.voltage(self.b)
        self.result = {
            "current": float(current),
            "voltage_difference": float(voltage),
            "power": float(voltage * current),
        }


class CurrentSource(CircuitElement):
    kind = "isource"
    label = "电流源"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.value = 0.0

    def prepare(self, dt: float, time: float) -> None:
        super().prepare(dt, time)
        self.value = waveform_value(self.params, time)

    def stamp(self, ctx: StampContext) -> None:
        _stamp_current(ctx, self.a, self.b, self.value * getattr(self, "source_scale", 1.0))

    def current(self, ctx: StampContext) -> float:
        del ctx
        return self.value * getattr(self, "source_scale", 1.0)


class Switch(CircuitElement):
    kind = "switch"
    label = "开关"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        closed = bool(self.params["closed"])
        ron = float(self.params["ron"])
        roff = float(self.params["roff"])
        if ron <= 0 or roff <= 0:
            raise ComputeError("开关导通/断开电阻必须大于 0")
        self.conductance = 1.0 / (ron if closed else roff)

    def stamp(self, ctx: StampContext) -> None:
        _stamp_conductance(ctx, self.a, self.b, self.conductance)

    def commit(self, ctx: StampContext) -> None:
        voltage = ctx.voltage(self.a) - ctx.voltage(self.b)
        current = voltage * self.conductance
        self.result = {
            "current": float(current),
            "voltage_difference": float(voltage),
            "power": float(voltage * current),
        }


class VCVS(CircuitElement):
    kind = "vcvs"
    label = "压控电压源"
    needs_branch = True

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.gain = float(self.params["gain"])
        self.control_a = self.pin("IN+", "control_source")
        self.control_b = self.pin("IN-", "control_target")

    def stamp(self, ctx: StampContext) -> None:
        row = self.branch_index
        ai = ctx.index.get(self.a)
        bi = ctx.index.get(self.b)
        ci = ctx.index.get(self.control_a)
        di = ctx.index.get(self.control_b)
        if ai is not None:
            ctx.A[ai, row] += 1.0
            ctx.A[row, ai] += 1.0
        if bi is not None:
            ctx.A[bi, row] -= 1.0
            ctx.A[row, bi] -= 1.0
        if ci is not None:
            ctx.A[row, ci] -= self.gain
        if di is not None:
            ctx.A[row, di] += self.gain
        ctx.rhs[row] = 0.0

    def current(self, ctx: StampContext) -> float:
        return float(ctx.solution[self.branch_index])

    def commit(self, ctx: StampContext) -> None:
        current = self.current(ctx)
        voltage = ctx.voltage(self.a) - ctx.voltage(self.b)
        self.result = {
            "current": float(current),
            "voltage_difference": float(voltage),
            "power": float(voltage * current),
        }


class VCCS(CircuitElement):
    kind = "vccs"
    label = "压控电流源"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.transconductance = float(self.params["gm"])
        self.control_a = self.pin("IN+", "control_source")
        self.control_b = self.pin("IN-", "control_target")

    def stamp(self, ctx: StampContext) -> None:
        gm = self.transconductance
        ai = ctx.index.get(self.a)
        bi = ctx.index.get(self.b)
        ci = ctx.index.get(self.control_a)
        di = ctx.index.get(self.control_b)
        if ci is not None:
            if ai is not None:
                ctx.A[ai, ci] += gm
            if bi is not None:
                ctx.A[bi, ci] -= gm
        if di is not None:
            if ai is not None:
                ctx.A[ai, di] -= gm
            if bi is not None:
                ctx.A[bi, di] += gm

    def current(self, ctx: StampContext) -> float:
        voltage = ctx.voltage(self.control_a) - ctx.voltage(self.control_b)
        return voltage * self.transconductance


class Diode(CircuitElement):
    kind = "diode"
    label = "二极管"
    nonlinear = True

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.saturation = float(self.params["Is"])
        self.emission = float(self.params["n"])
        self.temperature = float(self.params["temperature"])
        self.series_resistance = float(self.params.get("rs", 0.0))
        self.thermal = K_BOLTZMANN * self.temperature * self.emission
        if self.series_resistance > 0:
            self.internal_nodes = [f"__{self.name}__junction"]
            self.junction = self.internal_nodes[0]
        else:
            self.junction = self.a
        if "vd" not in self.state:
            self.state["vd"] = 0.0
        self.state["vd"] = float(self.state["vd"])
        self.iteration_guess.setdefault("vd", self.state["vd"])

    def reset(self) -> None:
        super().reset()
        self.state["vd"] = 0.0
        self.iteration_guess["vd"] = 0.0

    def prepare(self, dt: float, time: float) -> None:
        super().prepare(dt, time)

    def _conductance(self, vd: float) -> tuple[float, float]:
        exponent = min(60.0, vd / self.thermal)
        exp_value = math.exp(exponent)
        current = self.saturation * (exp_value - 1.0)
        conductance = self.saturation / self.thermal * exp_value
        conductance = max(conductance, 1.0e-15)
        return current, conductance

    def stamp(self, ctx: StampContext) -> None:
        if self.series_resistance > 0:
            _stamp_conductance(ctx, self.a, self.junction, 1.0 / self.series_resistance)
        guess = float(self.iteration_guess.get("vd", self.state["vd"]))
        current, conductance = self._conductance(guess)
        offset = current - conductance * guess
        _stamp_conductance(ctx, self.junction, self.b, conductance)
        _stamp_current(ctx, self.junction, self.b, offset)

    def update_guess(self, ctx: StampContext) -> None:
        new_voltage = ctx.voltage(self.junction) - ctx.voltage(self.b)
        old_voltage = float(self.iteration_guess.get("vd", self.state["vd"]))
        self.iteration_guess["vd"] = self._limit(new_voltage, old_voltage)

    def _limit(self, vnew: float, vold: float) -> float:
        """PN 结电压限幅，避免 Newton 迭代在指数区过冲。"""
        thermal = self.thermal
        if not math.isfinite(vnew):
            return vold
        vcrit = thermal * math.log(thermal / (math.sqrt(2.0) * self.saturation))
        if vnew > vcrit and abs(vnew - vold) > 2.0 * thermal:
            if vold > 0:
                argument = 1.0 + (vnew - vold) / thermal
                if argument > 0:
                    vnew = vold + thermal * math.log(argument)
            else:
                argument = vnew / thermal
                if argument > 0:
                    vnew = thermal * math.log(argument)
        return vnew

    def commit(self, ctx: StampContext) -> None:
        vd = ctx.voltage(self.junction) - ctx.voltage(self.b)
        current, _ = self._conductance(min(vd, 60.0 * self.thermal))
        self.state["vd"] = vd
        self.iteration_guess["vd"] = vd
        self.result = {
            "current": float(current),
            "voltage_difference": float(vd),
            "power": float(vd * current),
            "junction_voltage": float(vd),
        }

    def current(self, ctx: StampContext) -> float:
        voltage = ctx.voltage(self.junction) - ctx.voltage(self.b)
        current, _ = self._conductance(min(voltage, 60.0 * self.thermal))
        return current



# ---- 行为元件（P4 / R15） ---------------------------------------------------
class OpAmp(CircuitElement):
    """运放（R21/D41）：器件节点为单端推挽输出，旧「边=元件」保留差分语义。

    器件节点（有引脚）：
        v(OUT) − v(ref) = lo + span·(1 + tanh(A·u/span))/2
    其中 ``ref`` = V−（V+/V− 都接线时）否则地；``lo/span`` 在接线时取引脚电压
    （``lo = v(V−)``、``span = v(V+) − v(V−)``），未接线时取参数 ``vcc/vee``。
    旧模型（无引脚）仍按 ``v(a) − v(b) = vmax·tanh(A·u/vmax)`` 计算（§8.1 兼容垫片）。
    """

    kind = "opamp"
    label = "运算放大器"
    needs_branch = True
    nonlinear = True
    output_fields = ("current", "voltage_difference", "power", "vout")

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.gain = float(self.params["gain"])
        self.vcc = float(self.params.get("vcc", 15.0))
        self.vee = float(self.params.get("vee", -15.0))
        self.vmax = float(self.params.get("vmax", 15.0))  # 旧边兼容
        self.vp = self.pin("IN+", "vp")
        self.vn = self.pin("IN-", "vn")
        self.vplus = self.pins.get("V+") or ""
        self.vminus = self.pins.get("V-") or ""
        self.legacy = not self.pins
        self.wired_rails = bool(self.vplus and self.vminus)
        # D5：可选动态特性，默认 0 表示理想瞬态（保持旧行为）。
        self.slew_rate = float(self.params.get("slew_rate", 0.0) or 0.0)
        self.gbw = float(self.params.get("gbw", 0.0) or 0.0)
        self.state.setdefault("vout", 0.0)

    def reset(self) -> None:
        super().reset()
        self.state["vout"] = 0.0

    def _rails(self, ctx: StampContext) -> tuple[float, float]:
        """返回 (相对参考端的最低电平, 轨到轨跨度)。"""
        if self.wired_rails:
            hi = ctx.voltage(self.vplus)
            lo = ctx.voltage(self.vminus)
            return 0.0, hi - lo
        return self.vee, self.vcc - self.vee

    def _evaluate(self, ctx: StampContext, u: float) -> tuple[float, float]:
        if self.legacy:
            span = abs(self.vmax) if self.vmax else 1.0e-6
            ratio = max(-20.0, min(20.0, self.gain * u / span))
            value = span * math.tanh(ratio)
            slope = self.gain * (1.0 - math.tanh(ratio) ** 2)
            return value, max(slope, 1.0e-9)
        base, span = self._rails(ctx)
        span = max(span, 1.0e-6)
        ratio = max(-20.0, min(20.0, self.gain * u / span))
        sat = math.tanh(ratio)
        value = base + span * (1.0 + sat) / 2.0
        slope = self.gain * (1.0 - sat * sat) / 2.0
        return value, max(slope, 1.0e-12)

    def _dynamic(
        self, ctx: StampContext, value: float, slope: float
    ) -> tuple[float, float]:
        """D5：一阶带宽（GBW）与压摆率（slew rate）限制。

        ``slew_rate``/``gbw`` 均为 0 时直接返回静态解，行为与旧模型一致。
        动态用 ``state["vout"]`` 记录上一拍已提交的输出：先用一阶极点
        ``alpha = 1 − exp(−dt/τ)``、``τ = 1/(2π·GBW)`` 逼近目标，再按
        ``slew_rate·dt`` 钳位；斜率同步缩放，保持 Newton 迭代的一致性。
        """
        if self.slew_rate <= 0.0 and self.gbw <= 0.0:
            return value, slope
        del ctx
        previous = float(self.state.get("vout", 0.0))
        dt = float(self.dt) if self.dt else 0.0
        if dt <= 0.0:
            return previous, slope
        if self.gbw > 0.0:
            tau = 1.0 / (2.0 * math.pi * self.gbw)
            alpha = -math.expm1(-dt / tau)
            value = previous + (value - previous) * alpha
            slope = max(slope * alpha, 1.0e-12)
        if self.slew_rate > 0.0:
            limit = self.slew_rate * dt
            value = max(previous - limit, min(previous + limit, value))
        return value, slope

    def _f(self, ctx: StampContext, u: float) -> tuple[float, float]:
        value, slope = self._evaluate(ctx, u)
        return self._dynamic(ctx, value, slope)

    def stamp(self, ctx: StampContext) -> None:
        row = self.branch_index
        for node, sign in ((self.a, 1.0), (self.b, -1.0)):
            index = ctx.index.get(node)
            if index is not None:
                ctx.A[index, row] += sign
                ctx.A[row, index] += sign
        u = ctx.voltage(self.vp) - ctx.voltage(self.vn)
        value, slope = self._f(ctx, u)
        ci = ctx.index.get(self.vp)
        di = ctx.index.get(self.vn)
        if ci is not None:
            ctx.A[row, ci] -= slope
        if di is not None:
            ctx.A[row, di] += slope
        ctx.rhs[row] = value - slope * u

    def current(self, ctx: StampContext) -> float:
        return float(ctx.solution[self.branch_index])

    def commit(self, ctx: StampContext) -> None:
        voltage = ctx.voltage(self.a) - ctx.voltage(self.b)
        current = self.current(ctx)
        self.state["vout"] = float(voltage)
        self.result = {
            "current": float(current),
            "voltage_difference": float(voltage),
            "power": float(voltage * current),
            "vout": float(voltage),
        }


class Comparator(OpAmp):
    """电压比较器：高增益 + 带回差方向记忆的迟滞（Schmitt，tanh 平滑）。

    迟滞按输入等效阈值实现：输出为高时翻转阈值下移到 ``−hys/2``，输出为低时
    上移到 ``+hys/2``，因此上升沿与下降沿在不同的输入电压处翻转。旧实现只是
    固定 ``+hys`` 偏移（两个方向共用同一阈值），没有方向记忆（P1-03）。
    """

    kind = "comparator"
    label = "电压比较器"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.hysteresis = float(self.params.get("hysteresis", 0.0))
        # 0 = 尚未判定方向；+1 = 当前输出为高；−1 = 当前输出为低。
        self.state.setdefault("hys_level", 0)

    def reset(self) -> None:
        super().reset()
        self.state["hys_level"] = 0

    def _f(self, ctx: StampContext, u: float) -> tuple[float, float]:
        level = int(self.state.get("hys_level", 0))
        # 高电平阈值在 −hys/2、低电平阈值在 +hys/2：输出为高时 offset 取正，
        # 于是要跌到 −hys/2 以下才翻低；输出为低时反之。
        offset = 0.5 * self.hysteresis * level if level else 0.0
        value, slope = self._evaluate(ctx, u + offset)
        return value, slope

    def commit(self, ctx: StampContext) -> None:
        voltage = ctx.voltage(self.a) - ctx.voltage(self.b)
        super().commit(ctx)
        if not self.hysteresis:
            self.state["hys_level"] = 0
            return
        if self.legacy:
            base = 0.0
            span = abs(self.vmax) if self.vmax else 1.0
        else:
            base, span = self._rails(ctx)
        span = max(span, 1.0e-6)
        middle = base + 0.5 * span
        dead_zone = 1.0e-3 * span
        if voltage > middle + dead_zone:
            self.state["hys_level"] = 1
        elif voltage < middle - dead_zone:
            self.state["hys_level"] = -1


class Zener(Diode):
    """稳压二极管：正向 PN 结 + 反向击穿指数。"""

    kind = "zener"
    label = "稳压二极管"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.breakdown = float(self.params["Vz"])
        self.dynamic_resistance = max(1.0e-3, float(self.params.get("ron", 0.5)))

    def _conductance(self, vd: float) -> tuple[float, float]:
        forward = min(60.0, vd / self.thermal)
        exp_forward = math.exp(forward)
        current = self.saturation * (exp_forward - 1.0)
        conductance = self.saturation / self.thermal * exp_forward
        # 反向：softplus 平滑击穿区（线性动态电阻），Newton 更稳。
        x = -(vd + self.breakdown) / 0.1
        if x > 40.0:
            x = 40.0
        ex = math.exp(x)
        softplus = 0.1 * (x if x >= 40.0 else math.log1p(ex))
        current -= softplus / self.dynamic_resistance
        conductance += (ex / (1.0 + ex)) / self.dynamic_resistance
        return current, max(conductance, 1.0e-15)


class DFlipFlop(CircuitElement):
    """D 触发器行为模型：clk 上升沿 Q←D；输出端 a-b 为电压源。"""

    kind = "dflipflop"
    label = "D 触发器"
    needs_branch = True
    output_fields = ("current", "voltage_difference", "q")

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.d_node = self.pin("D", "d_node")
        self.clk_node = self.pin("CLK", "clk_node")
        self.vth = float(self.params.get("vth", 2.5))
        self.vhigh = float(self.params.get("vhigh", 5.0))
        self.vlow = float(self.params.get("vlow", 0.0))
        self.state.setdefault("q", 1 if float(self.params.get("q0", 0.0)) >= self.vth else 0)
        self.state.setdefault("clk_prev", 0)

    def stamp(self, ctx: StampContext) -> None:
        row = self.branch_index
        level = self.vhigh if int(self.state["q"]) else self.vlow
        for node, sign in ((self.a, 1.0), (self.b, -1.0)):
            index = ctx.index.get(node)
            if index is not None:
                ctx.A[index, row] += sign
                ctx.A[row, index] += sign
        ctx.rhs[row] = level

    def current(self, ctx: StampContext) -> float:
        return float(ctx.solution[self.branch_index])

    def commit(self, ctx: StampContext) -> None:
        clock = ctx.voltage(self.clk_node) if self.clk_node else 0.0
        data = ctx.voltage(self.d_node) if self.d_node else 0.0
        clock_high = 1 if clock >= self.vth else 0
        if clock_high and not int(self.state.get("clk_prev", 0)):
            self.state["q"] = 1 if data >= self.vth else 0
        self.state["clk_prev"] = clock_high
        voltage = ctx.voltage(self.a) - ctx.voltage(self.b)
        current = self.current(ctx)
        self.result = {
            "current": float(current),
            "voltage_difference": float(voltage),
            "power": float(voltage * current),
            "q": float(self.state["q"]),
        }


# ---- 元件注册表 ------------------------------------------------------------
@dataclass(frozen=True)
class ElementSpec:
    kind: str
    label: str
    description: str
    params: tuple[ParamSpec, ...]
    cls: type[CircuitElement]
    notes: str = ""
    group: str = "电路"
    formula: str = ""
    source: str = ""
    editable: bool = False
    builtin: bool = True
    #: 图纸引脚表（R19）：[{name, role, bind, dx, dy}]；空=两端元件默认。
    pins: tuple[dict[str, Any], ...] = ()
    #: 常用型号预设（R22 追加）：{型号: {参数键: SI 值}}，前端选型号时填入。
    presets: dict[str, dict[str, float]] = field(default_factory=dict)


OPAMP_MODELS = {
    "LM741": dict(gain=2.0e5, vcc=15.0, vee=-15.0, vmax=14.0),
    "LM358": dict(gain=1.0e5, vcc=15.0, vee=-15.0, vmax=13.5),
    "TL072": dict(gain=1.0e5, vcc=15.0, vee=-15.0, vmax=13.5),
    "NE5532": dict(gain=1.0e5, vcc=15.0, vee=-15.0, vmax=13.0),
    "LM324": dict(gain=1.0e5, vcc=15.0, vee=0.0, vmax=13.5),
}
COMPARATOR_MODELS = {
    "LM393": dict(gain=1.0e6, vcc=15.0, vee=0.0, vmax=5.0, hysteresis=0.0),
    "LM311": dict(gain=2.0e5, vcc=15.0, vee=-15.0, vmax=15.0, hysteresis=0.0),
    "LM339": dict(gain=1.0e6, vcc=15.0, vee=0.0, vmax=13.5, hysteresis=0.0),
    "TLV3201": dict(gain=1.0e6, vcc=5.0, vee=0.0, vmax=5.0, hysteresis=0.0),
}
DFF_MODELS = {
    "74HC74": dict(vth=2.5, vhigh=5.0, vlow=0.0),
    "74LS74": dict(vth=1.4, vhigh=5.0, vlow=0.0),
    "CD4013": dict(vth=2.5, vhigh=5.0, vlow=0.0),
}

ELEMENT_SPECS: dict[str, ElementSpec] = {
    "resistor": ElementSpec(
        kind="resistor",
        label="电阻",
        description="线性电阻，g = 1/R。",
        params=(
            float_param(
                "R",
                "电阻 R",
                1000.0,
                unit="Ω",
                positive=True,
                step=100.0,
            ),
        ),
        cls=Resistor,
    ),
    "capacitor": ElementSpec(
        kind="capacitor",
        label="电容",
        description="储能元件，按梯形法/后向欧拉伴随模型参与求解。",
        params=(
            float_param(
                "C",
                "电容 C",
                1.0e-6,
                unit="F",
                positive=True,
                step=1.0e-6,
            ),
            float_param("v0", "初始电压", 0.0, unit="V", step=0.1),
        ),
        cls=Capacitor,
        notes="历史电压保存在连接 state.v",
    ),
    "inductor": ElementSpec(
        kind="inductor",
        label="电感",
        description="储能元件，按梯形法/后向欧拉伴随模型参与求解。",
        params=(
            float_param(
                "L",
                "电感 L",
                1.0e-3,
                unit="H",
                positive=True,
                step=1.0e-4,
            ),
            float_param("initial", "初始电流", 0.0, unit="A", step=0.1),
        ),
        cls=Inductor,
        notes="历史电流保存在连接 state.i",
    ),
    "vsource": ElementSpec(
        kind="vsource",
        label="电压源",
        description="理想电压源，支持直流、正弦、方波等波形。",
        params=tuple(WAVEFORM_SPECS),
        cls=VoltageSource,
        notes="支路电流由求解器同时解出",
    ),
    "isource": ElementSpec(
        kind="isource",
        label="电流源",
        description="理想电流源：电流从起点经元件流向终点。",
        params=tuple(WAVEFORM_SPECS),
        cls=CurrentSource,
    ),
    "diode": ElementSpec(
        kind="diode",
        label="二极管",
        description="肖克利方程 pn 结，Newton–Raphson 迭代求解；可带串联电阻。",
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
                step=1.0,
            ),
            float_param(
                "rs",
                "串联电阻",
                0.0,
                unit="Ω",
                step=0.01,
                help="大于 0 时自动插入内部节点",
            ),
        ),
        cls=Diode,
    ),
    "switch": ElementSpec(
        kind="switch",
        label="开关",
        description="用导通/断开电阻近似理想开关，可在运行中切换。",
        params=(
            ParamSpec("closed", "闭合", "bool", True),
            float_param(
                "ron", "导通电阻", 1.0e-3, unit="Ω", positive=True, step=0.001
            ),
            float_param(
                "roff", "断开电阻", 1.0e9, unit="Ω", positive=True, step=1.0e6
            ),
        ),
        cls=Switch,
    ),
    "vcvs": ElementSpec(
        kind="vcvs",
        label="压控电压源",
        description="输出电压 = gain × 控制端电压差（VCVS/E 元件）。",
        params=(
            float_param("gain", "增益", 2.0, step=0.1),
            ParamSpec("control_source", "控制正端", "node", ""),
            ParamSpec("control_target", "控制负端", "node", ""),
        ),
        cls=VCVS,
    ),
    "vccs": ElementSpec(
        kind="vccs",
        label="压控电流源",
        description="输出电流 = gm × 控制端电压差（VCCS/G 元件）。",
        params=(
            float_param("gm", "跨导 gm", 0.01, unit="S", step=0.001),
            ParamSpec("control_source", "控制正端", "node", ""),
            ParamSpec("control_target", "控制负端", "node", ""),
        ),
        cls=VCCS,
    ),
    "opamp": ElementSpec(
        kind="opamp",
        label="运算放大器",
        description="单端推挽输出运放；双电源可设参数或接 V+/V− 引脚。",
        params=(
            choice_param("model", "型号", "LM741",
                         (("custom", "自定义"),) + tuple((k, k) for k in OPAMP_MODELS),
                         help="LM741/LM358/TL072/NE5532/LM324：选型号填开环增益与电源轨"),
            ParamSpec("vp", "同相端（旧边兼容）", "node", ""),
            ParamSpec("vn", "反相端（旧边兼容）", "node", ""),
            float_param("gain", "开环增益", 2.0e5, step=1.0e4),
            float_param("vcc", "正电源 VCC", 15.0, unit="V", help="未接 V+ 引脚时使用"),
            float_param("vee", "负电源 VEE", -15.0, unit="V", help="未接 V− 引脚时使用"),
            float_param(
                "vmax",
                "饱和电压（旧边兼容）",
                15.0,
                unit="V",
                positive=True,
                help="仅旧「边=元件」路径使用；器件节点请用 VCC/VEE 或引脚",
            ),
            float_param(
                "slew_rate",
                "压摆率 SR",
                0.0,
                unit="V/s",
                help="0 = 理想瞬态（默认）；>0 时每步输出变化不超过 SR·dt",
            ),
            float_param(
                "gbw",
                "增益带宽积 GBW",
                0.0,
                unit="Hz",
                help="0 = 无带宽限制（默认）；>0 时按一阶极点 τ=1/(2π·GBW) 逼近",
            ),
        ),
        cls=OpAmp,
        formula="器件节点：v(OUT) − v(V−) = lo + span·(1 + tanh(A·u/span))/2；"
        "旧边：v(a) − v(b) = vmax·tanh(A·u/vmax)；u = v(IN+) − v(IN−)",
        notes="器件节点为单端输出；V+/V− 同时接线才按引脚电压，否则用 VCC/VEE 且参考地；"
        "slew_rate/gbw 为 0 时按理想瞬态（旧行为）；常用型号 " + "/".join(OPAMP_MODELS),
        presets=OPAMP_MODELS,
    ),
    "comparator": ElementSpec(
        kind="comparator",
        label="电压比较器",
        description="高增益单端比较器；双电源可设参数或接 V+/V− 引脚，可设迟滞。",
        params=(
            choice_param("model", "型号", "LM393",
                         (("custom", "自定义"),) + tuple((k, k) for k in COMPARATOR_MODELS),
                         help="LM393/LM311/LM339/TLV3201：选型号填增益、电源轨与迟滞"),
            ParamSpec("vp", "同相端（旧边兼容）", "node", ""),
            ParamSpec("vn", "反相端（旧边兼容）", "node", ""),
            float_param("gain", "开环增益", 1.0e6, step=1.0e5),
            float_param("vcc", "正电源 VCC", 15.0, unit="V", help="未接 V+ 引脚时使用"),
            float_param("vee", "负电源 VEE", -15.0, unit="V", help="未接 V− 引脚时使用"),
            float_param("hysteresis", "迟滞", 0.0, unit="V", step=0.01),
            float_param(
                "vmax",
                "饱和电压（旧边兼容）",
                5.0,
                unit="V",
                positive=True,
                help="仅旧「边=元件」路径使用；器件节点请用 VCC/VEE 或引脚",
            ),
        ),
        cls=Comparator,
        formula="v(OUT) = lo + span·(1 + tanh(A·(u + off)/span))/2，"
        "off = +hys/2（当前输出为高）/ −hys/2（当前输出为低）/ 0（未判定）",
        notes="器件节点为单端输出；迟滞带回差方向记忆（上升沿 u>+hys/2、下降沿 u<−hys/2 翻转）；"
        "常用型号 " + "/".join(COMPARATOR_MODELS),
        presets=COMPARATOR_MODELS,
    ),
    "zener": ElementSpec(
        kind="zener",
        label="稳压二极管",
        description="正向 PN 结 + 反向击穿指数；Vz 为击穿电压。",
        params=(
            float_param("Vz", "击穿电压", 5.1, unit="V", positive=True, step=0.1),
            float_param("ron", "击穿动态电阻", 0.5, unit="Ω", positive=True, step=0.1),
            float_param("Is", "饱和电流", 1.0e-12, unit="A", positive=True),
            float_param("n", "发射系数", 1.5),
            float_param("temperature", "温度", 300.0, unit="K"),
            float_param("rs", "串联电阻", 0.0, unit="Ω"),
        ),
        cls=Zener,
        formula="I = Is(e^{v/Vt}−1) − softplus(−(v+Vz)/0.1)/ron",
        notes="反向击穿用 0.1 V 尺度 softplus 平滑 + 动态电阻 ron（Newton 更稳）；不做温度漂移/噪声",
    ),
    "led": ElementSpec(
        kind="led",
        label="发光二极管",
        description="二极管行为模型（较高正向压降），不做发光物理。",
        params=(
            float_param("Is", "饱和电流", 1.0e-12, unit="A", positive=True),
            float_param("n", "发射系数", 1.0),
            float_param("temperature", "温度", 300.0, unit="K"),
            float_param("rs", "串联电阻", 0.0, unit="Ω"),
        ),
        cls=Diode,
        formula="I = Is(e^{v/(n·Vt)}−1)，指数项限幅 60·Vt；rs>0 时串联电阻进内部节点",
        notes="仅电学行为；发光/颜色不建模",
    ),
    "dflipflop": ElementSpec(
        kind="dflipflop",
        label="D 触发器",
        description="上升沿锁存 D 到 Q 的行为模型；Q 输出为电压源（a-b）。",
        params=(
            choice_param("model", "型号", "74HC74",
                         (("custom", "自定义"),) + tuple((k, k) for k in DFF_MODELS),
                         help="74HC74/74LS74/CD4013：选型号填逻辑阈值与高低电平"),
            ParamSpec("d_node", "D 节点", "node", ""),
            ParamSpec("clk_node", "CLK 节点", "node", ""),
            float_param("vth", "逻辑阈值", 2.5, unit="V"),
            float_param("vhigh", "高电平", 5.0, unit="V", positive=True),
            float_param("vlow", "低电平", 0.0, unit="V"),
            float_param("q0", "初值", 0.0, unit="V"),
        ),
        cls=DFlipFlop,
        formula="clk 上升沿：Q←D；否则保持",
        notes="行为级、单步延迟（commit 更新，下一步输出）；不做建立/保持时间；常用型号 " + "/".join(DFF_MODELS),
        presets=DFF_MODELS,
    ),
}


def element_spec(kind: str) -> ElementSpec:
    spec = ELEMENT_SPECS.get(kind)
    if spec is None:
        raise ComputeError(f"未知电路元件：{kind!r}")
    return spec


def create_element(
    kind: str,
    name: str,
    a: str,
    b: str,
    raw_params: dict[str, Any] | None,
    state: dict[str, Any],
    *,
    integration: str = "trapezoidal",
) -> CircuitElement:
    spec = element_spec(kind)
    params = dict(raw_params or {})
    # 兼容垫片（R21/D42）：旧「边=元件」只给 vmax；换算成 vcc/vee 后再校验，
    # 旧差分语义仍由 vmax 驱动（§8.1）。
    if kind in ("opamp", "comparator"):
        raw_vmax = params.get("vmax")
        if isinstance(raw_vmax, (int, float)) and not isinstance(raw_vmax, bool):
            magnitude = abs(float(raw_vmax))
            params.setdefault("vcc", magnitude)
            params.setdefault("vee", -magnitude)
    params = validate_params(list(spec.params), params)
    return spec.cls(name, a, b, params, state, integration=integration)


#: 多引脚元件的「引脚 → 旧参数端口」映射（R20 过渡）：参数端口逐步退役为引脚。
PIN_BINDINGS: dict[str, tuple[str, str, dict[str, str]]] = {
    "opamp": ("OUT", "V-", {"IN+": "vp", "IN-": "vn"}),
    "comparator": ("OUT", "V-", {"IN+": "vp", "IN-": "vn"}),
    "vcvs": ("OUT+", "OUT-", {"IN+": "control_source", "IN-": "control_target"}),
    "vccs": ("OUT+", "OUT-", {"IN+": "control_source", "IN-": "control_target"}),
    "transformer": ("P1", "P2", {"S1": "secondary_source", "S2": "secondary_target"}),
    "coupling_inductor": ("P1", "P2", {"S1": "secondary_source", "S2": "secondary_target"}),
    "dflipflop": ("Q+", "Q-", {"D": "d_node", "CLK": "clk_node"}),
    "ne555": ("OUT", "GND", {"VCC": "vcc_node"}),
    "ldo": ("OUT", "GND", {"IN": "vin_node"}),
    "and_gate": ("Y", "GND", {"A": "in_a", "B": "in_b", "VDD": "vdd_node"}),
    "or_gate": ("Y", "GND", {"A": "in_a", "B": "in_b", "VDD": "vdd_node"}),
    "not_gate": ("Y", "GND", {"A": "in_a", "VDD": "vdd_node"}),
    "xor_gate": ("Y", "GND", {"A": "in_a", "B": "in_b", "VDD": "vdd_node"}),
    "counter4": (
        "Q0", "COM",
        {"CLK": "clk_node", "RST": "rst_node", "Q0": "q0_node", "Q1": "q1_node",
         "Q2": "q2_node", "Q3": "q3_node"},
    ),
    "shift4": (
        "Q0", "COM",
        {"D": "d_node", "CLK": "clk_node", "RST": "rst_node",
         "Q0": "q0_node", "Q1": "q1_node", "Q2": "q2_node", "Q3": "q3_node"},
    ),
    "adc4": (
        "Q0", "COM",
        {"VIN": "vin_node", "CLK": "clk_node", "Q1": "q1_node",
         "Q2": "q2_node", "Q3": "q3_node"},
    ),
    "dac4": (
        "OUT", "COM",
        {"B0": "b0_node", "B1": "b1_node", "B2": "b2_node", "B3": "b3_node"},
    ),
    "npn": ("C", "E", {"B": "base_node"}),
    "pnp": ("C", "E", {"B": "base_node"}),
    "nmos": ("D", "S", {"G": "gate_node"}),
    "pmos": ("D", "S", {"G": "gate_node"}),
}

#: v3→v4 迁移专用的旧引脚表（R21 前，OUT+/OUT− 差分输出）；v4→v5 会再改写。
LEGACY_PIN_BINDINGS: dict[str, tuple[str, str, dict[str, str]]] = {
    **PIN_BINDINGS,
    "opamp": ("OUT+", "OUT-", {"IN+": "vp", "IN-": "vn"}),
    "comparator": ("OUT+", "OUT-", {"IN+": "vp", "IN-": "vn"}),
}


def create_element_from_pins(
    kind: str,
    name: str,
    pins: dict[str, str],
    raw_params: dict[str, Any] | None,
    state: dict[str, Any],
    *,
    integration: str = "trapezoidal",
    ground: str | None = None,
) -> CircuitElement:
    """按引脚表装配元件（R20 器件节点）。

    ``pins`` 是「引脚名 → 网络节点 id」；两引脚元件按声明顺序映射到 a/b，
    多引脚元件用 ``PIN_BINDINGS`` 决定 a/b 的引脚名；元件实例持有完整 pin 表，
    通过 ``self.pin(...)`` 读取（旧参数端口只作兼容回退）。

    R21：``V+/V−`` 这类可选引脚缺失时，若它在绑定里承担参考端（如运放 V−），
    用 ``ground`` 作为参考节点；没有接地则明确报错。
    """
    from .ports import pins_for_device

    table = list(pins_for_device(kind))
    names = {pin.name for pin in table}
    extra = sorted(set(pins) - names)
    if extra:
        raise ComputeError(f"元件 {name!r} 收到未声明的引脚：{', '.join(extra)}")
    missing = [pin.name for pin in table if pin.required and pin.name not in pins]
    if missing:
        raise ComputeError(
            f"元件 {name!r} 的必接引脚没有导线：{', '.join(missing)}"
        )
    spec = element_spec(kind)
    params = dict(raw_params or {})
    params.pop("element", None)
    if len(table) == 2:
        a = pins[table[0].name]
        b = pins[table[1].name]
    else:
        binding = PIN_BINDINGS.get(kind)
        if binding is None:
            raise ComputeError(
                f"器件节点暂不支持元件 {kind!r}（引脚到求解器的映射未登记）"
            )
        a_pin, b_pin, _param_map = binding
        a = pins[a_pin]
        b = pins.get(b_pin)
        if b is None:
            if ground is None:
                raise ComputeError(
                    f"元件 {name!r} 缺少引脚 {b_pin!r}，且电路没有接地参考"
                )
            b = ground
    params_clean = validate_params(list(spec.params), params)
    return spec.cls(
        name, a, b, params_clean, state, pins=pins, integration=integration
    )


def element_catalog() -> list[dict[str, Any]]:
    from .introspection import formula_for, spec_entry
    from .ports import PINS, pin_table

    result: list[dict[str, Any]] = []
    for spec in ELEMENT_SPECS.values():
        entry = spec_entry(
            spec,
            mode="circuit",
            formula=formula_for(spec, ELEMENT_FORMULAS),
            source_target=spec.cls,
            outputs=("current", "voltage_difference", "power"),
        )
        entry["pins"] = pin_table(spec.kind) if spec.kind in PINS else []
        entry["presets"] = getattr(spec, "presets", {})
        result.append(entry)
    return result


ELEMENT_FORMULAS: dict[str, str] = {
    "resistor": "i = (v_a − v_b)/R\ng = 1/R 盖章到 MNA 节点导纳矩阵",
    "capacitor": "梯形法: g = 2C/dt,  i_hist = −g·v[k-1] − i[k-1]\n后向欧拉: g = C/dt,  i_hist = −g·v[k-1]",
    "inductor": "梯形法: g = dt/(2L),  i_hist = i[k-1] + g·v[k-1]\n后向欧拉: g = dt/L,  i_hist = i[k-1]",
    "vsource": "v_a − v_b = waveform(t)\n支路电流为额外未知量",
    "isource": "i_a→b = waveform(t)",
    "diode": "i = Is·(exp(min(60, v/(n·Vt))) − 1)\n"
    "rs>0：串联电阻进内部节点 __name__junction（电流源 offset 盖章）\n"
    "Newton: g = dI/dV,  I_eq = I − g·V",
    "switch": "g = 1/R_on (闭合) 或 1/R_off (断开)",
    "vcvs": "v_a − v_b = gain·(v_c+ − v_c−)",
    "vccs": "i_a→b = gm·(v_c+ − v_c−)",
    "fuse": "g = 1/R_on，|i| > rating 后锁存为 1/R_off",
    "ptc": "R(T) 随温度/电流上升；超过 holding_current 后进入高阻，冷却后恢复",
    "mov": "|v| > clamp_voltage 时电导急剧上升，钳位浪涌电压",
    "zener": "正向 PN 结；反向击穿区 v ≈ −Vz 时强烈导通",
    "schottky": "i = Is·(exp(v/(n·Vt)) − 1)，低 Vf / 低 n",
    "led": "PN 结 + 光子输出；正向 Vf 由材料参数决定，输出亮度 ∝ 电流",
    "tvs": "双向钳位：超过 ±Vbr 后快速导通",
    "varactor": "C(V) = C0 / (1 + V/V0)^m（反偏时）",
    "photodiode": "i = Is·(exp(v/(n·Vt)) − 1) − I_ph",
    "varistor": "V = k·I^α；α>1 时具有非线性限压",
    "thermistor": "R(T) = R0·exp(B·(1/T − 1/T0))",
    "potentiometer": "三端口：R_total 分为 R1 + R2，滑动端按 position 分压",
    "bridge_rectifier": "四只二极管组成的全桥整流",
    "opamp": "器件节点：v(OUT) − v(V−) = lo + span·(1 + tanh(A·u/span))/2\n"
    "旧边：v(a) − v(b) = vmax·tanh(A·u/vmax)\n"
    "gbw>0：一阶极点 τ = 1/(2π·GBW)；slew_rate>0：|Δvout| ≤ SR·dt",
    "comparator": "带回差方向记忆：输出高时翻转阈值 −hys/2、输出低时 +hys/2\n"
    "tanh 平滑（同一 Newton 迭代内只在端点上翻转）",
    "ldo": "可调线性稳压器：反馈分压 + 误差放大 + 输出限流",
    "cccs": "i_a→b = gain·i_control",
    "ccvs": "v_a − v_b = transresistance·i_control",
    "coupling_inductor": "v1 = L1·di1/dt + M·di2/dt；v2 = M·di1/dt + L2·di2/dt",
    "transformer": "理想变压器：v2 = n·v1，i2 = −i1/n（可选励磁电感）",
    "relay": "线圈电流驱动机械触点；触点按 R_on/R_off 建模",
    "dc_motor": "反电动势 v_bemf = Ke·ω；转矩 T = Kt·i；J·dω/dt = T − b·ω",
    "bjt_npn": "分段线性：vbe ≤ vbe_on 时 Ib = vbe·leak；否则 Ib = (vbe−vbe_on)/rin + vbe·leak\n"
    "Ic = β·Ib（Ic_max 限幅）；leak = 1e-9，Is/n/Vt 只用于记录与结电压限幅",
    "bjt_pnp": "分段线性的 PNP 版本（极性取反，Vbe 以发射结为正）",
    "nmos": "Id = 0（vgs ≤ vth_eff）；vds < vov 时线性区 Id = k·(vov·vds − vds²/2)\n"
    "否则饱和区 Id = ½·k·vov²；两者再乘 (1+λ·vds)\n"
    "vth_eff = vth + γ·(√(φ−vbs) − √φ)（body_node 接地或指定衬底）",
    "pmos": "平方律 PMOS 版本（vgs/vds/vbs 均取反，Id 方向相反）",
    "jfet": "Id = Idss·(1 − Vgs/Vp)²（饱和区）",
    "scr": "门极触发后锁存导通，直到电流低于维持电流",
    "triac": "双向晶闸管：门极触发后双向锁存",
    "igbt": "MOS 输入 + BJT 输出，行为级导通/关断模型",
}


def node_catalog() -> list[dict[str, Any]]:
    """电路模式的节点类型。

    和元素规格一样返回「公式 + 真实源码 + 源码路径」，前端规格页才能对
    电路节点给出与实现一致的说明，而不是空白。
    """
    from .introspection import safe_source, source_path

    entries: list[dict[str, Any]] = [
        {
            "kind": "node",
            "label": "电学节点",
            "group": "电路节点",
            "description": "一个等电位节点，数据中保存 voltage。",
            "outputs": ["voltage"],
            "notes": "节点本身没有独立算式：它的电压由整张 MNA 方程一起解出。",
            "formula": (
                "MNA：对每个非接地节点 Σ 注入电流 = 0 → G·V = I；\n"
                "解出后把 V_i 写回 data.voltage（非线性元件走 Newton 迭代）"
            ),
            "target": CircuitSolver.step,
        },
        {
            "kind": "ground",
            "label": "接地",
            "group": "电路节点",
            "description": "参考节点（0 V）。每个电路至少需要一个接地节点。",
            "outputs": [],
            "notes": "接地节点不进入未知量集合，作为矩阵的参考电位。",
            "formula": "V_ground ≡ 0（参考电位）；未知量只包含非接地节点",
            "target": CircuitSolver._build_index,
        },
    ]
    result: list[dict[str, Any]] = []
    for entry in entries:
        target = entry.pop("target")
        result.append(
            {
                **entry,
                "mode": "circuit",
                "editable": False,
                "builtin": True,
                "addable": True,
                "params": [],
                "source": safe_source(target),
                "source_path": source_path(target),
            }
        )
    return result


# ---- 求解器 ----------------------------------------------------------------
class CircuitSolver:
    def __init__(
        self,
        nodes: list[CircuitNode],
        elements: list[CircuitElement],
        *,
        integration: str = "trapezoidal",
        options: SolverOptions | None = None,
    ) -> None:
        if integration not in ("trapezoidal", "backward_euler", "gear2"):
            raise ValidationError("积分方法必须是 trapezoidal、backward_euler 或 gear2")
        self.nodes = nodes
        self.elements = elements
        self.integration = integration
        self.options = options or SolverOptions()
        for element in self.elements:
            element.integration = integration
        self.time = 0.0
        self.solution: np.ndarray | None = None
        self.node_voltages: dict[str, float] = {node.id: 0.0 for node in nodes}
        self.last_iterations = 0
        self.last_solve_ms = 0.0
        self.last_residual = 0.0
        self.last_strategies: tuple[str, ...] = ()
        self.last_scaled = False
        self.last_row_scale: np.ndarray | None = None
        self.last_col_scale: np.ndarray | None = None
        self._worst_residual_index: int | None = None
        self.matrix_size = 0
        self.nonlinear = any(element.nonlinear for element in elements)
        self._build_index()

    def _build_index(self) -> None:
        if not self.nodes:
            raise ConflictError("电路中没有节点")
        ground_nodes = [node for node in self.nodes if node.ground]
        if not ground_nodes:
            raise ComputeError("电路需要至少一个接地节点（把某个节点设为 ground）")
        if len(ground_nodes) > 1:
            raise ComputeError("电路只能有一个接地节点")
        self.ground = ground_nodes[0].id
        node_ids = {node.id for node in self.nodes}
        unknown: list[str] = [node.id for node in self.nodes if not node.ground]
        internal: list[str] = []
        for element in self.elements:
            for node_id in element.internal_nodes:
                if node_id in node_ids or node_id in internal:
                    raise ComputeError(f"内部节点 id 冲突：{node_id!r}")
                internal.append(node_id)
        unknown.extend(internal)
        # 固定按物理 id 排序：均衡/消元顺序与 dict 插入历史无关，报告也稳定。
        unknown = sorted(unknown)
        self.unknown_ids = unknown
        self.index = {node_id: position for position, node_id in enumerate(unknown)}

        branch_elements = [element for element in self.elements if element.needs_branch]
        branch_count = sum(int(getattr(element, "branch_width", 1)) for element in branch_elements)
        offset = 0
        for element in branch_elements:
            width = int(getattr(element, "branch_width", 1))
            element.branch_index = len(unknown) + offset
            element.branch_indices = tuple(
                len(unknown) + offset + index for index in range(width)
            )
            offset += width
            if element.a == self.ground and element.b == self.ground:
                raise ComputeError(
                    f"电压源 {element.name!r} 两端都接地，电路不合法"
                )
        self.branch_count = branch_count
        self.matrix_size = len(unknown) + branch_count
        if self.matrix_size == 0:
            raise ComputeError("电路没有可求解的未知量")
        self.solution = np.zeros(self.matrix_size)
        self.sparse = self._decide_sparse()
        self._matrix = self._blank_matrix()
        self._rhs = np.zeros(self.matrix_size)
        self._lu_cache = None
        self._lu_matrix: np.ndarray | None = None
        self._lu_col_scale: np.ndarray | None = None
        self._cached_dt: float | None = None
        self._sparse_lu = None
        self._sparse_key: tuple[Any, ...] | None = None
        self._sparse_col_scale: np.ndarray | None = None
        self.linear_reuse = 0

    def _decide_sparse(self) -> bool:
        """按 SolverOptions.sparse 决定装配/求解后端（R26/D53）。"""
        mode = str(getattr(self.options, "sparse", "auto")).lower()
        if mode not in ("auto", "on", "off"):
            raise ValidationError("sparse 必须是 auto、on 或 off")
        if mode == "off":
            return False
        if _sparse is None:  # 没有 SciPy 时只能稠密
            return False
        if mode == "on":
            return True
        return self.matrix_size > int(getattr(self.options, "sparse_threshold", 200))

    def _blank_matrix(self) -> Any:
        """新建全零系数矩阵（稀疏时为 LIL，便于逐元素盖章）。"""
        if self.sparse:
            return _sparse.lil_matrix((self.matrix_size, self.matrix_size))
        return np.zeros((self.matrix_size, self.matrix_size))

        # 端点合法性检查
        for element in self.elements:
            for node_id in (element.a, element.b):
                if node_id not in node_ids:
                    raise ComputeError(
                        f"元件 {element.name!r} 连接到了不存在的节点"
                    )
            for attribute in ("control_a", "control_b"):
                control = getattr(element, attribute, None)
                if control and control not in node_ids:
                    raise ComputeError(
                        f"元件 {element.name!r} 的控制节点不存在"
                    )

    # ---- 事务检查点（P0-01） ---------------------------------------------
    def _capture_element_state(self) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for element in self.elements:
            row: dict[str, Any] = {
                "state": copy.deepcopy(element.state),
                "guess": copy.deepcopy(element.iteration_guess),
                "result": copy.deepcopy(element.result),
                "time": float(getattr(element, "time", 0.0)),
            }
            if hasattr(element, "value"):
                row["value"] = getattr(element, "value")
            if hasattr(element, "source_scale"):
                row["source_scale"] = float(getattr(element, "source_scale"))
            rows.append(row)
        return rows

    def capture_checkpoint(self) -> dict[str, Any]:
        """冻结求解器时间轴、解、节点电压与元件历史状态（失败步可完整回滚）。"""
        return {
            "time": self.time,
            "solution": None if self.solution is None else self.solution.copy(),
            "node_voltages": dict(self.node_voltages),
            "last_iterations": self.last_iterations,
            "last_solve_ms": self.last_solve_ms,
            "elements": self._capture_element_state(),
        }

    def restore_checkpoint(self, checkpoint: dict[str, Any]) -> None:
        self.time = float(checkpoint["time"])
        solution = checkpoint.get("solution")
        self.solution = None if solution is None else np.array(solution, copy=True)
        self.node_voltages = dict(checkpoint.get("node_voltages", {}))
        self.last_iterations = int(checkpoint.get("last_iterations", 0))
        self.last_solve_ms = float(checkpoint.get("last_solve_ms", 0.0))
        for element, row in zip(self.elements, checkpoint.get("elements", [])):
            element.state = copy.deepcopy(row.get("state", {}))
            element.iteration_guess = copy.deepcopy(row.get("guess", {}))
            element.result = copy.deepcopy(row.get("result", {}))
            element.time = float(row.get("time", element.time))
            if "value" in row:
                element.value = row["value"]
            if "source_scale" in row:
                element.source_scale = row["source_scale"]
        # 失败步可能已用污染矩阵生成 LU；一律失效，避免后续线性步复用。
        self._lu_cache = None
        self._lu_matrix = None
        self._lu_col_scale = None
        self._cached_dt = None
        self._sparse_lu = None
        self._sparse_key = None

    def zero_time(self) -> None:
        """只归零时间轴，不修改状态（由 restore/reset 之外的推进层调用）。"""
        self.time = 0.0

    def _restore_element_states(self, snapshot: list[dict[str, Any]]) -> None:
        for element, row in zip(self.elements, snapshot):
            element.state = copy.deepcopy(row["state"])
            element.iteration_guess = copy.deepcopy(row["guess"])

    # ---- 推进 -------------------------------------------------------------
    @timed("circuit.solver.step")
    def step(self, dt: float) -> dict[str, Any]:
        if not math.isfinite(dt) or dt <= 0:
            raise ValidationError("dt 必须为正的有限数")
        started = _time.perf_counter()
        checkpoint = self.capture_checkpoint()
        try:
            return self._step_locked(dt, started)
        except Exception:
            self.restore_checkpoint(checkpoint)
            raise

    def _step_locked(self, dt: float, started: float) -> dict[str, Any]:
        self.time += dt
        for element in self.elements:
            element.prepare(dt, self.time)

        guess = self.solution if self.solution is not None else np.zeros(self.matrix_size)
        solution, iterations, converged, residual, attempted = self._newton_with_strategies(
            dt, guess, mode="tran"
        )
        if not converged:
            trouble = self._trouble_name(solution, dt=dt, residual=residual)
            tried = "、".join(attempted) if attempted else "未启用 gmin/source stepping"
            raise ComputeError(
                f"非线性电路在 {self.options.max_iter} 次 Newton 迭代内未收敛"
                f"（后向残差 {residual:.3g}，最大残差节点 {trouble!r}）；"
                f"已尝试：{tried}；请减小 dt、检查悬空/强反馈，或放宽 SolverOptions"
            )

        self.solution = solution
        self.last_residual = float(residual)
        self.last_strategies = tuple(attempted)
        ctx = StampContext(
            A=np.zeros((0, 0)),
            rhs=np.zeros(0),
            index=self.index,
            solution=solution,
            dt=dt,
            time=self.time,
            iteration=iterations,
        )
        for element in self.elements:
            element.commit(ctx)
            element.state.update(element.result)
        self.node_voltages = {node.id: 0.0 for node in self.nodes}
        for node_id, position in self.index.items():
            if node_id in self.node_voltages:
                self.node_voltages[node_id] = float(solution[position])
        self.node_voltages[self.ground] = 0.0
        self.last_iterations = iterations
        self.last_solve_ms = (_time.perf_counter() - started) * 1000.0
        return {
            "iterations": iterations,
            "matrix_size": self.matrix_size,
            "solve_ms": self.last_solve_ms,
            "residual": self.last_residual,
            "strategies": list(self.last_strategies),
            "scaling": self.last_scaled,
        }

    def _newton_with_strategies(
        self, dt: float, guess: np.ndarray, *, mode: str = "tran"
    ) -> tuple[np.ndarray, int, bool, float, list[str]]:
        """Newton + gmin/source stepping 的统一入口（瞬态与 DC 工作点共用）。"""
        options = self.options
        nonlinear = any(element.nonlinear for element in self.elements)
        solution, iterations, converged, residual = self._newton_solve(
            dt, 0.0, guess, mode=mode
        )
        attempted: list[str] = []
        if not converged and nonlinear and options.gmin_steps > 0:
            attempted.append("gmin stepping")
            # gmin stepping：起始值与步数来自 SolverOptions；失败试验完整回滚。
            gmin = max(1.0e-15, float(options.gmin))
            for _ in range(max(1, int(options.gmin_steps))):
                trial_snapshot = self._capture_element_state()
                trial, trial_iters, trial_ok, _ = self._newton_solve(
                    dt, gmin, solution, mode=mode
                )
                iterations += trial_iters
                if trial_ok:
                    solution = trial
                else:
                    self._restore_element_states(trial_snapshot)
                gmin *= 0.1
            solution, trial_iters, converged, residual = self._newton_solve(
                dt, 0.0, solution, mode=mode
            )
            iterations += trial_iters
        if not converged and nonlinear and options.src_steps > 0:
            # source stepping：独立源从 0 斜坡到 1，上一解作初值。
            attempted.append("source stepping")
            steps = max(1, int(options.src_steps))
            for step in range(1, steps + 1):
                scale = step / steps
                trial_snapshot = self._capture_element_state()
                trial, trial_iters, trial_ok, _ = self._newton_solve(
                    dt, 0.0, solution, source_scale=scale, mode=mode
                )
                iterations += trial_iters
                if trial_ok:
                    solution = trial
                else:
                    self._restore_element_states(trial_snapshot)
                    break
            solution, trial_iters, converged, residual = self._newton_solve(
                dt, 0.0, solution, source_scale=1.0, mode=mode
            )
            iterations += trial_iters
        return solution, iterations, converged, residual, attempted

    def _tolerance(self, new_solution: np.ndarray, old_solution: np.ndarray) -> np.ndarray:
        options = self.options
        node_count = len(self.unknown_ids)
        tol = np.empty(self.matrix_size)
        tol[:node_count] = options.vntol
        tol[node_count:] = options.abstol
        return tol + options.reltol * np.maximum(
            np.abs(new_solution), np.abs(old_solution)
        )

    def _index_name(self, index: int) -> str:
        if index < len(self.unknown_ids):
            node_id = self.unknown_ids[index]
            for node in self.nodes:
                if node.id == node_id:
                    return f"节点 {node.name!r}"
            return f"节点 {node_id!r}"
        branch = index - len(self.unknown_ids)
        offset = 0
        for element in self.elements:
            if not getattr(element, "needs_branch", False):
                continue
            width = int(getattr(element, "branch_width", 1))
            if branch < offset + width:
                return f"支路 {element.name!r}"
            offset += width
        return f"未知量 #{index}"

    def _trouble_name(
        self,
        solution: np.ndarray,
        *,
        dt: float | None = None,
        residual: float | None = None,
    ) -> str:
        if not self.matrix_size:
            return "?"
        quality = residual if residual is not None else 0.0
        worst = self._worst_residual_index
        if quality > 0.0 and worst is not None:
            label = self._index_name(worst)
            for prefix in ("节点 ", "支路 "):
                if label.startswith(prefix):
                    return label[len(prefix):].strip("'")
            return label
        index = int(np.argmax(np.abs(solution)))
        if index < len(self.unknown_ids):
            node_id = self.unknown_ids[index]
            for node in self.nodes:
                if node.id == node_id:
                    return node.name
            return node_id
        return self._index_name(index).replace("支路 ", "").strip("'")

    @staticmethod
    def _residual_metric(
        matrix: Any, solution: np.ndarray, rhs: np.ndarray, dt: float
    ) -> tuple[float, int | None]:
        """尺度无关的后向误差：‖Ax−b‖∞ / (‖|A||x|‖∞ + dt·‖b‖∞)。

        稀疏矩阵 ``matrix @ x`` 返回 ndarray，``abs(matrix) @ |x|`` 同样返回
        ndarray，因此稠密/稀疏共用同一判据（R26/D53）。
        """
        residual = np.asarray(np.abs(matrix @ solution - rhs)).ravel()
        if not residual.size:
            return 0.0, None
        denominator = float(np.max(np.asarray(abs(matrix) @ np.abs(solution)).ravel()))
        denominator += dt * float(np.max(np.abs(rhs))) + 1.0e-30
        worst = int(np.argmax(residual))
        return float(residual[worst]) / denominator, worst

    def _newton_solve(
        self,
        dt: float,
        gmin: float,
        initial: np.ndarray,
        source_scale: float = 1.0,
        *,
        mode: str = "tran",
    ) -> tuple[np.ndarray, int, bool, float]:
        options = self.options
        sources = [e for e in self.elements if e.kind in ("vsource", "isource")]
        nonlinear_elements = [element for element in self.elements if element.nonlinear]
        solution = initial.copy()
        iterations = 0
        converged = not nonlinear_elements
        residual = 0.0
        max_iter = max(1, int(options.max_iter))
        self._worst_residual_index = None
        try:
            for iteration in range(max_iter if nonlinear_elements else 1):
                iterations = iteration + 1
                matrix = self._blank_matrix()
                rhs = self._rhs
                rhs.fill(0.0)
                ctx = StampContext(
                    A=matrix,
                    rhs=rhs,
                    index=self.index,
                    solution=solution,
                    dt=dt,
                    time=self.time,
                    iteration=iteration,
                    mode=mode,
                )
                for element in sources:
                    element.source_scale = source_scale
                for element in self.elements:
                    element.stamp(ctx)
                self._check_floating(matrix)
                if gmin > 0:
                    for index in range(len(self.unknown_ids)):
                        matrix[index, index] += gmin
                new_solution = self._solve_matrix(matrix, rhs, dt)
                if not np.all(np.isfinite(new_solution)):
                    raise ComputeError("电路求解出现非有限数值")
                if np.max(np.abs(new_solution)) > MAX_ABS_VOLTAGE:
                    raise ComputeError("电路电压超过 1e9 V，仿真已发散")
                residual, worst = self._residual_metric(matrix, new_solution, rhs, dt)
                self._worst_residual_index = worst
                if not nonlinear_elements:
                    limit = (
                        float(options.residual_tol)
                        if options.residual_tol > 0
                        else float(options.residual_safety_tol)
                    )
                    if limit > 0 and residual > limit:
                        raise ComputeError(
                            f"线性电路解质量不足（后向残差 {residual:.3g} > {limit:.3g}）："
                            f"最大残差量 {self._trouble_name(new_solution, dt=dt, residual=residual)!r}；"
                            "请检查病态参数、悬空节点或极小的并联电阻"
                        )
                    solution = new_solution
                    break
                delta = np.abs(new_solution - solution)
                node_ok = bool(np.all(delta <= self._tolerance(new_solution, solution)))
                solution = new_solution
                if options.residual_tol > 0:
                    residual_ok = residual <= options.residual_tol
                elif options.residual_safety_tol > 0:
                    residual_ok = residual <= options.residual_safety_tol
                else:
                    residual_ok = True
                if iteration > 0 and node_ok and residual_ok:
                    converged = True
                    break
                guess_ctx = StampContext(
                    A=matrix,
                    rhs=rhs,
                    index=self.index,
                    solution=solution,
                    dt=dt,
                    time=self.time,
                    iteration=iteration,
                    mode=mode,
                )
                for element in nonlinear_elements:
                    element.update_guess(guess_ctx)
        finally:
            # 无论成功/异常，独立源缩放必须恢复；失败步不能污染下一拍。
            for element in sources:
                element.source_scale = 1.0
        return solution, iterations, converged, residual

    def _solve_matrix(self, matrix: Any, rhs: np.ndarray, dt: float) -> np.ndarray:
        """求解本拍 MNA 方程；矩阵未变时复用 LU 分解。

        线性电路（R/L/C/独立源/受控源/开关）的系数矩阵只依赖 dt 与元件参数，
        因此第一拍分解后，后续拍只需 ``lu_solve`` 回代。非线性电路每次
        Newton 迭代矩阵都会变化，缓存自然失效；这保证数值语义完全不变。
        稀疏后端的语义与稠密一致，只是分解改用 ``splu``（R26/D53）。
        """
        if self.sparse:
            return self._solve_sparse(matrix, rhs, dt)
        use_gpu = (
            accel.available()
            and self.matrix_size >= accel.status()["gpu_min_size"]
        )
        if use_gpu:  # pragma: no cover - 依赖本机 GPU
            return solve_linear(matrix, rhs, what="电路")
        row_scale, col_scale = self._equilibration(matrix) if self.options.scaling else (
            np.ones(matrix.shape[0]),
            np.ones(matrix.shape[1]),
        )
        self.last_scaled = bool(self.options.scaling)
        self.last_row_scale = row_scale
        self.last_col_scale = col_scale
        scaled = matrix / row_scale[:, None] / col_scale[None, :]
        scaled_rhs = rhs / row_scale
        if (
            _scipy_lu_factor is not None
            and self._lu_cache is not None
            and self._lu_matrix is not None
            and self._lu_col_scale is not None
            and self._cached_dt == dt
            and np.array_equal(matrix, self._lu_matrix)
        ):
            self.linear_reuse += 1
            return _scipy_lu_solve(self._lu_cache, scaled_rhs) / self._lu_col_scale
        if _scipy_lu_factor is not None:
            try:
                factor = _scipy_lu_factor(scaled, check_finite=False)
                diagonal = np.abs(np.diag(factor[0]))
                scale = max(
                    1.0e-300,
                    float(np.max(diagonal)) if diagonal.size else 1.0,
                )
                bad = np.where(diagonal <= float(self.options.pivot_tol) * scale)[0]
                if bad.size:
                    raise ComputeError(
                        f"电路矩阵奇异（零主元）：{self._index_name(int(bad[0]))}；"
                        "请检查悬空节点、缺少直流通路或重复接地的元件"
                    )
                z = _scipy_lu_solve(factor, scaled_rhs)
                solution = z / col_scale
                if not np.all(np.isfinite(solution)):
                    raise ComputeError("电路求解出现非有限数值")
                self._lu_cache = factor
                self._lu_matrix = matrix.copy()
                self._lu_col_scale = col_scale.copy()
                self._cached_dt = dt
                return solution
            except ComputeError:
                raise
            except Exception:
                # 奇异/数值失败交给统一的 solve_linear，输出可读错误。
                pass
        return solve_linear(matrix, rhs, what="电路")

    def _sparse_equilibration(
        self, csr: Any
    ) -> tuple[np.ndarray, np.ndarray]:
        """稀疏版本的行/列最大模均衡（不展开成稠密）。"""
        tiny = 1.0e-300
        abs_csr = abs(csr)
        row_scale = np.asarray(abs_csr.max(axis=1).todense()).ravel()
        row_scale = np.maximum(row_scale, tiny)
        row_norm = abs_csr.multiply(1.0 / row_scale[:, None]).tocsr()
        col_scale = np.asarray(row_norm.max(axis=0).todense()).ravel()
        return row_scale, np.maximum(col_scale, tiny)

    def _solve_sparse(self, matrix: Any, rhs: np.ndarray, dt: float) -> np.ndarray:
        """稀疏 LU：行列均衡 + splu，零主元映射为可读的奇异诊断（R26/D53）。"""
        if _splu is None:  # pragma: no cover - 环境缺少 SciPy
            raise ComputeError("稀疏求解需要 SciPy，请安装 scipy 或把 sparse 设为 off")
        csr = matrix.tocsr()
        csr.sum_duplicates()
        csr.sort_indices()
        if self.options.scaling:
            row_scale, col_scale = self._sparse_equilibration(csr)
        else:
            row_scale = np.ones(self.matrix_size)
            col_scale = np.ones(self.matrix_size)
        self.last_scaled = bool(self.options.scaling)
        self.last_row_scale = row_scale
        self.last_col_scale = col_scale
        scaled = (
            csr.multiply(1.0 / row_scale[:, None])
            .multiply(1.0 / col_scale[None, :])
            .tocsc()
        )
        scaled_rhs = rhs / row_scale
        key = (
            round(float(dt), 12),
            scaled.nnz,
            scaled.indptr.tobytes(),
            scaled.indices.tobytes(),
            scaled.data.tobytes(),
            row_scale.tobytes(),
            col_scale.tobytes(),
        )
        if self._sparse_lu is not None and self._sparse_key == key:
            self.linear_reuse += 1
            solution = self._sparse_lu.solve(scaled_rhs) / col_scale
            if not np.all(np.isfinite(solution)):
                raise ComputeError("电路求解出现非有限数值")
            return solution
        try:
            factor = _splu(scaled)
        except RuntimeError as exc:
            raise ComputeError(
                "电路矩阵奇异（稀疏 LU）；请检查悬空节点、缺少直流通路"
                "或重复接地的元件"
            ) from exc
        diagonal = np.abs(factor.U.diagonal())
        if diagonal.size:
            scale = max(1.0e-300, float(np.max(diagonal)))
            bad = np.where(diagonal <= float(self.options.pivot_tol) * scale)[0]
            if bad.size:
                raise ComputeError(
                    f"电路矩阵奇异（零主元）：{self._index_name(int(bad[0]))}；"
                    "请检查悬空节点、缺少直流通路或重复接地的元件"
                )
        solution = factor.solve(scaled_rhs) / col_scale
        if not np.all(np.isfinite(solution)):
            raise ComputeError("电路求解出现非有限数值")
        self._sparse_lu = factor
        self._sparse_key = key
        return solution

    @staticmethod
    def _equilibration(matrix: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """行/列最大模均衡，保留原始矩阵只用于缓存比较。"""
        tiny = 1.0e-300
        row_scale = np.maximum(np.max(np.abs(matrix), axis=1), tiny)
        row_normalized = np.abs(matrix) / row_scale[:, None]
        col_scale = np.maximum(np.max(row_normalized, axis=0), tiny)
        return row_scale, col_scale

    def _check_floating(self, matrix: Any) -> None:
        if _sparse is not None and _sparse.issparse(matrix):
            nonempty = np.asarray(matrix.getnnz(axis=1)).ravel()
        else:
            nonempty = np.any(matrix, axis=1)
        for row in range(len(self.unknown_ids)):
            if not nonempty[row]:
                names = [
                    node.name
                    for node in self.nodes
                    if node.id == self.unknown_ids[row]
                ]
                label = names[0] if names else self.unknown_ids[row]
                raise ComputeError(
                    f"节点 {label!r} 没有任何直流通路（悬空），请增加元件或接地"
                )

    # ---- 直流工作点与交流小信号（R26/D54–D56） -----------------------------
    #: 支持交流 stamp 的元件 kind；其余元件（二极管/晶体管/数字器件等）在 AC 中显式拒绝。
    AC_KINDS = frozenset(
        {"resistor", "capacitor", "inductor", "vsource", "isource", "vcvs", "vccs", "switch"}
    )

    def operating_point(self) -> dict[str, Any]:
        """DC 工作点（.op）：电容开路、电感短路近似、源取 t=0 的值。

        求解全程在一个事务检查点内进行：无论成功失败，都不改变瞬态时间轴、
        节点电压与元件历史状态（可随时在暂停/运行中调用）。
        """
        checkpoint = self.capture_checkpoint()
        try:
            self.time = 0.0
            for element in self.elements:
                if hasattr(element, "value"):
                    element.value = waveform_value(element.params, 0.0)
            guess = np.zeros(self.matrix_size)
            solution, iterations, converged, residual, attempted = (
                self._newton_with_strategies(1.0e-9, guess, mode="dc")
            )
            if not converged:
                trouble = self._trouble_name(solution, residual=residual)
                tried = "、".join(attempted) or "未启用 gmin/source stepping"
                raise ComputeError(
                    f"直流工作点在 {self.options.max_iter} 次 Newton 迭代内未收敛"
                    f"（后向残差 {residual:.3g}，最大残差节点 {trouble!r}）；"
                    f"已尝试：{tried}；请检查悬空节点或强反馈"
                )
            ctx = StampContext(
                A=self._blank_matrix(),
                rhs=np.zeros(self.matrix_size),
                index=self.index,
                solution=solution,
                dt=1.0e-9,
                time=0.0,
                iteration=iterations,
                mode="dc",
            )
            for element in self.elements:
                element.commit(ctx)
            node_voltages = {node.id: 0.0 for node in self.nodes}
            for node_id, position in self.index.items():
                if node_id in node_voltages:
                    node_voltages[node_id] = float(solution[position])
            node_voltages[self.ground] = 0.0
            elements = {
                element.name: {
                    key: float(value)
                    for key, value in element.result.items()
                    if isinstance(value, (int, float))
                }
                for element in self.elements
            }
            return {
                "time": 0.0,
                "node_voltages": node_voltages,
                "elements": elements,
                "iterations": iterations,
                "matrix_size": self.matrix_size,
                "residual": float(residual),
                "strategies": list(attempted),
                "sparse": bool(self.sparse),
            }
        finally:
            self.restore_checkpoint(checkpoint)
            self._lu_cache = None
            self._lu_matrix = None
            self._sparse_lu = None
            self._sparse_key = None

    def ac_sweep(
        self,
        frequencies: list[float],
        *,
        input_source: str | None = None,
        probes: list[str] | None = None,
    ) -> dict[str, Any]:
        """单点/扫频 AC 小信号（Bode 数据），基于 DC 工作点线性化。

        只支持线性/受控源类元件（``AC_KINDS``）：被选中的独立源取单位激励
        （1 V / 1 A），其余独立源置零；电容 jωC、电感 1/(jωL)。
        返回每个探针的 magnitude/phase_deg/db；调用不改变瞬态状态。
        """
        freqs = [float(f) for f in frequencies]
        if not freqs:
            raise ValidationError("AC 扫频至少需要一个频率点")
        if any(not math.isfinite(f) or f <= 0.0 for f in freqs):
            raise ValidationError("AC 频率必须为正的有限数")
        unsupported = [e for e in self.elements if e.kind not in self.AC_KINDS]
        if unsupported:
            names = "、".join(element.name for element in unsupported[:3])
            raise ComputeError(
                f"AC 分析暂不支持元件 {names!r}（{unsupported[0].kind}）："
                "小信号只对线性元件与受控源线性化；请改用瞬态分析或移除该元件"
            )
        sources = [
            element for element in self.elements
            if element.kind in ("vsource", "isource")
        ]
        if not sources:
            raise ComputeError("AC 分析需要至少一个独立源作为激励")
        if input_source is None:
            input_element = sources[0]
        else:
            matches = [e for e in sources if e.name == input_source]
            if not matches:
                raise ComputeError(f"AC 分析找不到激励源 {input_source!r}")
            input_element = matches[0]
        node_names = {node.id: node.name for node in self.nodes}
        if probes:
            wanted: list[str] = []
            for token in probes:
                key = str(token)
                if key in self.index or key in node_names.values():
                    wanted.append(key)
                elif any(element.name == key for element in self.elements):
                    wanted.append(key)
                else:
                    raise ComputeError(f"AC 探针不存在：{token!r}")
        else:
            wanted = [
                node_id for node_id in self.unknown_ids
                if node_id in node_names
            ] + [
                element.name for element in self.elements
                if element.kind in ("resistor", "capacitor", "inductor", "vsource", "isource")
            ]
        checkpoint = self.capture_checkpoint()
        try:
            self.time = 0.0
            for element in self.elements:
                if hasattr(element, "value"):
                    element.value = waveform_value(element.params, 0.0)
            guess = np.zeros(self.matrix_size)
            op, iterations, converged, residual, attempted = (
                self._newton_with_strategies(1.0e-9, guess, mode="dc")
            )
            if not converged:
                raise ComputeError(
                    "AC 分析前无法求得直流工作点（后向残差 "
                    f"{residual:.3g}）；请先让电路在 DC 下可解"
                )
            results: dict[str, dict[str, list[float]]] = {
                token: {"magnitude": [], "phase_deg": [], "db": []}
                for token in wanted
            }
            size = self.matrix_size
            for frequency in freqs:
                omega = 2.0 * math.pi * frequency
                ctx = StampContext(
                    A=np.zeros((size, size), dtype=complex),
                    rhs=np.zeros(size, dtype=complex),
                    index=self.index,
                    solution=op,
                    dt=0.0,
                    time=0.0,
                    iteration=0,
                    mode="ac",
                    omega=omega,
                )
                for element in self.elements:
                    if hasattr(element, "value"):
                        element.value = 1.0 if element is input_element else 0.0
                    element.stamp(ctx)
                self._check_floating(ctx.A)
                solution = np.linalg.solve(ctx.A, ctx.rhs)
                for token in wanted:
                    value = self._ac_probe(token, ctx, solution, node_names)
                    magnitude = float(abs(value))
                    phase = math.degrees(math.atan2(value.imag, value.real))
                    row = results[token]
                    row["magnitude"].append(magnitude)
                    row["phase_deg"].append(phase)
                    row["db"].append(20.0 * math.log10(max(magnitude, 1.0e-30)))
            return {
                "frequencies": freqs,
                "input": input_element.name,
                "probes": results,
                "operating_point": {
                    "iterations": iterations,
                    "node_voltages": {
                        node_names.get(node_id, node_id): float(op[position])
                        for node_id, position in self.index.items()
                        if node_id in node_names
                    },
                },
            }
        finally:
            self.restore_checkpoint(checkpoint)
            self._sparse_lu = None
            self._sparse_key = None

    def _ac_probe(
        self,
        token: str,
        ctx: StampContext,
        solution: np.ndarray,
        node_names: dict[str, str],
    ) -> complex:
        position = self.index.get(token)
        if position is None:
            # 允许用节点显示名（name）作探针。
            for node_id, name in node_names.items():
                if name == token and node_id in self.index:
                    position = self.index[node_id]
                    break
        if position is not None:
            return complex(solution[position])
        for element in self.elements:
            if element.name != token:
                continue
            va = (
                complex(solution[self.index[element.a]])
                if element.a in self.index
                else 0j
            )
            vb = (
                complex(solution[self.index[element.b]])
                if element.b in self.index
                else 0j
            )
            difference = va - vb
            if element.kind == "resistor":
                return difference / float(element.params["R"])
            if element.kind == "capacitor":
                return 1j * ctx.omega * float(element.params["C"]) * difference
            if element.kind == "inductor":
                return difference / (1j * ctx.omega * float(element.params["L"]))
            if element.kind == "vsource":
                return complex(solution[element.branch_index])
            if element.kind == "isource":
                return complex(element.value)
            raise ComputeError(f"AC 探针 {token!r} 的电流暂不支持")
        raise ComputeError(f"AC 探针不存在：{token!r}")

    def reset(self) -> None:
        self.time = 0.0
        self.solution = np.zeros(self.matrix_size)
        self._lu_cache = None
        self._lu_matrix = None
        self._lu_col_scale = None
        self._cached_dt = None
        self._sparse_lu = None
        self._sparse_key = None
        self.linear_reuse = 0
        self.node_voltages = {node.id: 0.0 for node in self.nodes}
        for element in self.elements:
            element.reset()
            element.result = {}
            for key in ("current", "voltage_difference", "power"):
                element.state.pop(key, None)
        self.last_iterations = 0
        self.last_solve_ms = 0.0
        self.last_residual = 0.0
        self.last_strategies = ()
        self.last_trouble = None
        self.last_scaled = False
        self.last_row_scale = None
        self.last_col_scale = None


def integration_methods() -> list[dict[str, str]]:
    return [
        {"value": "trapezoidal", "label": "梯形法（默认，精度高）"},
        {"value": "backward_euler", "label": "后向欧拉（更稳定）"},
        {"value": "gear2", "label": "Gear2 / BDF2（二阶，固定步长）"},
    ]


# ---- 第三批：三极管 / MOSFET（R15） ---------------------------------------
from .transistors import BJT_SPECS as _TRANSISTOR_SPECS

for _kind, _spec in _TRANSISTOR_SPECS.items():
    ELEMENT_SPECS[_kind] = ElementSpec(**_spec)

from .logic import LOGIC_GATE_SPECS as _LOGIC_SPECS

for _kind, _spec in _LOGIC_SPECS.items():
    ELEMENT_SPECS[_kind] = ElementSpec(**_spec)

from .timers import TIMER_SPECS as _TIMER_SPECS

for _kind, _spec in _TIMER_SPECS.items():
    ELEMENT_SPECS[_kind] = ElementSpec(**_spec)

from .digital import DIGITAL_SPECS as _DIGITAL_SPECS

for _kind, _spec in _DIGITAL_SPECS.items():
    ELEMENT_SPECS[_kind] = ElementSpec(**_spec)

from .magnetics import MAGNETIC_SPECS as _MAGNETIC_SPECS

for _kind, _spec in _MAGNETIC_SPECS.items():
    ELEMENT_SPECS[_kind] = ElementSpec(**_spec)


# ---- R22/D46：元件分类（catalog group 是唯一来源） --------------------------
#: 菜单里的固定分组顺序；新增元件必须登记，否则测试会报“未分类”。
ELEMENT_GROUP_ORDER: tuple[str, ...] = (
    "基础无源",
    "电源",
    "受控源",
    "二极管",
    "开关",
    "放大与比较",
    "晶体管",
    "数字与逻辑",
    "计时与电源管理",
    "磁性",
)

ELEMENT_GROUPS: dict[str, str] = {
    "resistor": "基础无源",
    "capacitor": "基础无源",
    "inductor": "基础无源",
    "vsource": "电源",
    "isource": "电源",
    "vcvs": "受控源",
    "vccs": "受控源",
    "diode": "二极管",
    "zener": "二极管",
    "led": "二极管",
    "switch": "开关",
    "opamp": "放大与比较",
    "comparator": "放大与比较",
    "npn": "晶体管",
    "pnp": "晶体管",
    "nmos": "晶体管",
    "pmos": "晶体管",
    "and_gate": "数字与逻辑",
    "or_gate": "数字与逻辑",
    "not_gate": "数字与逻辑",
    "xor_gate": "数字与逻辑",
    "dflipflop": "数字与逻辑",
    "counter4": "数字与逻辑",
    "shift4": "数字与逻辑",
    "adc4": "数字与逻辑",
    "dac4": "数字与逻辑",
    "ne555": "计时与电源管理",
    "ldo": "计时与电源管理",
    "transformer": "磁性",
    "coupling_inductor": "磁性",
}

for _kind, _group in ELEMENT_GROUPS.items():
    _spec = ELEMENT_SPECS.get(_kind)
    if _spec is not None:
        ELEMENT_SPECS[_kind] = _dataclass_replace(_spec, group=_group)
