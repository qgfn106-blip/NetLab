"""电路元件模型：基类与前段元件（电阻、电容、电感、源、开关、受控源）。

从 ``nodal.py`` 原样搬出（M 轮，逻辑零改动）；对外仍由 ``nodal`` 再导出。
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from ...common.limits import ComputeError
from ..waveform import waveform_value
from .stamps import _stamp_conductance, _stamp_current
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
