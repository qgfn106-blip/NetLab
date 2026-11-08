"""电路元件模型：基类与前段元件（电阻、电容、电感、源、开关、受控源）。

从 ``nodal.py`` 原样搬出（M 轮，逻辑零改动）；对外仍由 ``nodal`` 再导出。
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from ...common.limits import ComputeError
from ..waveform import waveform_value
from .stamps import K_BOLTZMANN, StampContext, _stamp_conductance, _stamp_current
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
            self.source_current = -self.conductance * previous_v - previous_i

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
                self.source_current = (2.0 * previous_i - 0.5 * float(older_i)) / 1.5
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
                _stamp_conductance(
                    ctx, self.a, self.b, 1.0 / (1j * ctx.omega * self.inductance)
                )
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


class SensorElement(CircuitElement):
    """R31/P11-05：跨域采样桥，高阻读取两点电压，不改变电路工作点。"""

    kind = "sensor"
    label = "电压传感器"

    def stamp(self, ctx: StampContext) -> None:
        ai = ctx.index.get(self.a)
        bi = ctx.index.get(self.b)
        leak = 1.0e-12
        if ai is not None:
            ctx.A[ai, ai] += leak
        if bi is not None:
            ctx.A[bi, bi] += leak

    def commit(self, ctx: StampContext) -> None:
        voltage = ctx.voltage(self.a) - ctx.voltage(self.b)
        self.result = {"voltage": float(voltage), "value": float(voltage)}


class ActuatorSource(VoltageSource):
    """R31/P11-05：受控电压源；``state['drive']`` 由 CircuitEngine 每拍写入。"""

    kind = "actuator"
    label = "受控电压源"

    def prepare(self, dt: float, time: float) -> None:
        CircuitElement.prepare(self, dt, time)
        self.value = float(self.state.get("drive", 0.0))


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
        _stamp_current(
            ctx, self.a, self.b, self.value * getattr(self, "source_scale", 1.0)
        )

    def current(self, ctx: StampContext) -> float:
        del ctx
        return self.value * getattr(self, "source_scale", 1.0)


class ActuatorCurrent(CurrentSource):
    """R06/P4：受控电流源；``state['drive']`` 由 CircuitEngine 每拍写入。"""

    kind = "actuator_i"
    label = "受控电流源"

    def prepare(self, dt: float, time: float) -> None:
        CircuitElement.prepare(self, dt, time)
        self.value = float(self.state.get("drive", 0.0))

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
        self.state.setdefault(
            "q", 1 if float(self.params.get("q0", 0.0)) >= self.vth else 0
        )
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
