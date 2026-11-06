"""R15 第四批：功率电子与电机行为模型。

Thyristor / IGBT / JFET 是开关型器件，暂用 Ron/Roff 分段线性模型：门槛
条件满足后进入导通态，Thyristor 还带维持电流关断；Relay 用线圈电流驱动
触点；DC motor 用反电动势 + 机械一阶方程，时间推进用后向欧拉。

这些模型刻意保持“可解释、可手算”，不引入 SPICE 级指数/电荷模型；后续
需要更高精度时可在同一 ElementSpec 下替换 cls。
"""

from __future__ import annotations

from typing import Any

from .nodal import CircuitElement, StampContext, _stamp_conductance, _stamp_current
from .params import ParamSpec, float_param


class Thyristor(CircuitElement):
    kind = "thyristor"
    label = "晶闸管"
    nonlinear = True
    output_fields = (
        "current",
        "voltage_difference",
        "power",
        "conducting",
        "gate_voltage",
    )

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.gate = self.pin("G", "gate_node")
        self.ron = max(1.0e-9, float(self.params.get("Ron", 0.05)))
        self.roff = max(1.0e-3, float(self.params.get("Roff", 1.0e9)))
        self.vgt = float(self.params.get("Vgt", 0.8))
        self.ih = float(self.params.get("Ih", 0.005))
        self.rgate = max(1.0e-3, float(self.params.get("Rgate", 1.0e3)))
        self.on = bool(self.state.get("on", False))

    def _conductance(self) -> float:
        return 1.0 / (self.ron if self.on else self.roff)

    def stamp(self, ctx: StampContext) -> None:
        _stamp_conductance(ctx, self.a, self.b, self._conductance())
        if self.gate:
            _stamp_conductance(ctx, self.gate, self.b, 1.0 / self.rgate)

    def commit(self, ctx: StampContext) -> None:
        va = ctx.voltage(self.a)
        vk = ctx.voltage(self.b)
        vg = ctx.voltage(self.gate) if self.gate else vk
        current = (va - vk) * self._conductance()
        if not self.on and vg - vk >= self.vgt:
            self.on = True
        elif self.on and abs(current) < self.ih:
            self.on = False
        self.state["on"] = self.on
        self.result = {
            "current": float(current),
            "voltage_difference": float(va - vk),
            "power": float((va - vk) * current),
            "conducting": self.on,
            "gate_voltage": float(vg - vk),
        }


class Igbt(CircuitElement):
    kind = "igbt"
    label = "IGBT"
    nonlinear = True
    output_fields = (
        "current",
        "voltage_difference",
        "power",
        "conducting",
        "gate_voltage",
    )

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.gate = self.pin("G", "gate_node")
        self.ron = max(1.0e-9, float(self.params.get("Ron", 0.1)))
        self.roff = max(1.0e-3, float(self.params.get("Roff", 1.0e8)))
        self.vth = float(self.params.get("Vth", 4.0))
        self.rgate = max(1.0e-3, float(self.params.get("Rgate", 1.0e6)))
        self.on = bool(self.state.get("on", False))

    def stamp(self, ctx: StampContext) -> None:
        _stamp_conductance(
            ctx, self.a, self.b, 1.0 / (self.ron if self.on else self.roff)
        )
        if self.gate:
            _stamp_conductance(ctx, self.gate, self.b, 1.0 / self.rgate)

    def commit(self, ctx: StampContext) -> None:
        vc = ctx.voltage(self.a)
        ve = ctx.voltage(self.b)
        vg = ctx.voltage(self.gate) if self.gate else ve
        self.on = (vg - ve) >= self.vth
        current = (vc - ve) / (self.ron if self.on else self.roff)
        self.state["on"] = self.on
        self.result = {
            "current": float(current),
            "voltage_difference": float(vc - ve),
            "power": float((vc - ve) * current),
            "conducting": self.on,
            "gate_voltage": float(vg - ve),
        }


class Jfet(CircuitElement):
    kind = "jfet"
    label = "JFET"
    nonlinear = True
    output_fields = (
        "current",
        "voltage_difference",
        "power",
        "conducting",
        "gate_voltage",
    )

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.gate = self.pin("G", "gate_node")
        self.ron = max(1.0e-9, float(self.params.get("Ron", 50.0)))
        self.roff = max(1.0e-3, float(self.params.get("Roff", 1.0e9)))
        self.vp = float(self.params.get("Vp", -2.0))
        self.rgate = max(1.0e-3, float(self.params.get("Rgate", 1.0e9)))
        self.on = bool(self.state.get("on", True))

    def stamp(self, ctx: StampContext) -> None:
        _stamp_conductance(
            ctx, self.a, self.b, 1.0 / (self.ron if self.on else self.roff)
        )
        if self.gate:
            _stamp_conductance(ctx, self.gate, self.b, 1.0 / self.rgate)

    def commit(self, ctx: StampContext) -> None:
        vd = ctx.voltage(self.a)
        vs = ctx.voltage(self.b)
        vg = ctx.voltage(self.gate) if self.gate else vs
        self.on = (vg - vs) > self.vp
        current = (vd - vs) / (self.ron if self.on else self.roff)
        self.state["on"] = self.on
        self.result = {
            "current": float(current),
            "voltage_difference": float(vd - vs),
            "power": float((vd - vs) * current),
            "conducting": self.on,
            "gate_voltage": float(vg - vs),
        }


class Relay(CircuitElement):
    kind = "relay"
    label = "继电器"
    nonlinear = True
    output_fields = (
        "current",
        "voltage_difference",
        "power",
        "conducting",
        "coil_current",
    )

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.com = self.pin("COM", "com_node")
        self.no = self.pin("NO", "no_node")
        self.rcoil = max(1.0e-3, float(self.params.get("Rcoil", 100.0)))
        self.ion = float(self.params.get("Ion", 0.01))
        self.ron = max(1.0e-9, float(self.params.get("Ron", 0.05)))
        self.roff = max(1.0e-3, float(self.params.get("Roff", 1.0e9)))
        self.on = bool(self.state.get("on", False))

    def stamp(self, ctx: StampContext) -> None:
        _stamp_conductance(ctx, self.a, self.b, 1.0 / self.rcoil)
        if self.com and self.no:
            _stamp_conductance(
                ctx, self.com, self.no, 1.0 / (self.ron if self.on else self.roff)
            )

    def commit(self, ctx: StampContext) -> None:
        va = ctx.voltage(self.a)
        vb = ctx.voltage(self.b)
        coil_current = (va - vb) / self.rcoil
        self.on = abs(coil_current) >= self.ion
        self.state["on"] = self.on
        self.result = {
            "current": float(coil_current),
            "voltage_difference": float(va - vb),
            "power": float((va - vb) * coil_current),
            "conducting": self.on,
            "coil_current": float(coil_current),
        }


class DcMotor(CircuitElement):
    kind = "motor"
    label = "直流电机"
    nonlinear = True
    output_fields = (
        "current",
        "voltage_difference",
        "power",
        "back_emf",
        "speed",
        "torque",
    )

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.resistance = max(1.0e-6, float(self.params.get("R", 1.0)))
        self.ke = float(self.params.get("Ke", 0.05))
        self.kt = float(self.params.get("Kt", 0.05))
        self.inertia = max(1.0e-9, float(self.params.get("J", 0.002)))
        self.damping = max(0.0, float(self.params.get("b", 0.0005)))
        self.load = float(self.params.get("Tload", 0.0))
        self.speed = float(self.state.get("speed", 0.0))

    def stamp(self, ctx: StampContext) -> None:
        conductance = 1.0 / self.resistance
        emf = self.ke * self.speed
        _stamp_conductance(ctx, self.a, self.b, conductance)
        _stamp_current(ctx, self.a, self.b, -conductance * emf)

    def commit(self, ctx: StampContext) -> None:
        va = ctx.voltage(self.a)
        vb = ctx.voltage(self.b)
        emf = self.ke * self.speed
        current = (va - vb - emf) / self.resistance
        torque = self.kt * current
        dt = float(self.dt) if self.dt else 0.0
        if dt > 0.0:
            accel = (torque - self.damping * self.speed - self.load) / self.inertia
            self.speed += accel * dt
        self.state["speed"] = self.speed
        self.result = {
            "current": float(current),
            "voltage_difference": float(va - vb),
            "power": float((va - vb) * current),
            "back_emf": float(emf),
            "speed": float(self.speed),
            "torque": float(torque),
        }


THYRISTOR_PINS = (
    {"name": "A", "role": "output", "bind": "source", "dx": 18, "dy": -10},
    {"name": "K", "role": "output", "bind": "target", "dx": 18, "dy": 10},
    {"name": "G", "role": "input", "bind": "gate_node", "dx": -18, "dy": 0},
)
IGBT_PINS = (
    {"name": "C", "role": "output", "bind": "source", "dx": 18, "dy": -10},
    {"name": "E", "role": "output", "bind": "target", "dx": 18, "dy": 10},
    {"name": "G", "role": "input", "bind": "gate_node", "dx": -18, "dy": 0},
)
JFET_PINS = (
    {"name": "D", "role": "output", "bind": "source", "dx": 18, "dy": -10},
    {"name": "S", "role": "output", "bind": "target", "dx": 18, "dy": 10},
    {"name": "G", "role": "input", "bind": "gate_node", "dx": -18, "dy": 0},
)
RELAY_PINS = (
    {"name": "COIL1", "role": "input", "bind": "source", "dx": -18, "dy": -10},
    {"name": "COIL2", "role": "input", "bind": "target", "dx": -18, "dy": 10},
    {"name": "COM", "role": "output", "bind": "com_node", "dx": 18, "dy": -10},
    {"name": "NO", "role": "output", "bind": "no_node", "dx": 18, "dy": 10},
)
MOTOR_PINS = (
    {"name": "+", "role": "input", "bind": "source", "dx": -18, "dy": 0},
    {"name": "-", "role": "output", "bind": "target", "dx": 18, "dy": 0},
)


def _common_params(gate_label: str) -> tuple[ParamSpec, ...]:
    return (
        float_param("Ron", "导通电阻", 0.05, unit="Ω", positive=True, step=0.01),
        float_param("Roff", "关断电阻", 1.0e9, unit="Ω", positive=True, step=1.0e6),
        ParamSpec("gate_node", gate_label, "node", ""),
    )


POWER_ELECTRONIC_SPECS: dict[str, dict[str, Any]] = {
    "thyristor": dict(
        kind="thyristor",
        label="晶闸管",
        description="R15：门极触发后导通、电流低于维持电流后关断的晶闸管。",
        params=(
            float_param("Vgt", "门极触发电压", 0.8, unit="V", step=0.1),
            float_param("Ih", "维持电流", 0.005, unit="A", step=0.001),
            float_param("Rgate", "门极电阻", 1.0e3, unit="Ω", positive=True),
        )
        + _common_params("门极节点"),
        cls=Thyristor,
        group="功率电子与电机",
        source="netlab/powerelectronics.py",
        formula="on: g=1/Ron；off: g=1/Roff；vgk≥Vgt 触发，|i|<Ih 关断",
        notes="分段线性开关模型，不模拟 dV/dt 与关断拖尾",
        pins=THYRISTOR_PINS,
    ),
    "igbt": dict(
        kind="igbt",
        label="IGBT",
        description="R15：电压控制开关，Vge≥Vth 时 C-E 导通。",
        params=(
            float_param("Vth", "门极阈值", 4.0, unit="V", step=0.1),
            float_param("Rgate", "门极电阻", 1.0e6, unit="Ω", positive=True),
        )
        + _common_params("门极节点"),
        cls=Igbt,
        group="功率电子与电机",
        source="netlab/powerelectronics.py",
        formula="g = 1/Ron (Vge≥Vth) else 1/Roff",
        notes="忽略米勒平台与开关损耗",
        pins=IGBT_PINS,
    ),
    "jfet": dict(
        kind="jfet",
        label="JFET",
        description="R15：耗尽型 JFET，Vgs>Vp 时 D-S 导通。",
        params=(
            float_param("Vp", "夹断电压（负值）", -2.0, unit="V", step=0.1),
            float_param("Rgate", "门极电阻", 1.0e9, unit="Ω", positive=True),
        )
        + _common_params("门极节点"),
        cls=Jfet,
        group="功率电子与电机",
        source="netlab/powerelectronics.py",
        formula="g = 1/Ron (Vgs>Vp) else 1/Roff",
        notes="耗尽型默认常开；增强型请用 MOSFET",
        pins=JFET_PINS,
    ),
    "relay": dict(
        kind="relay",
        label="继电器",
        description="R15：线圈电流驱动常开触点的电磁继电器。",
        params=(
            float_param("Rcoil", "线圈电阻", 100.0, unit="Ω", positive=True),
            float_param("Ion", "吸合电流", 0.01, unit="A", step=0.001),
            float_param("Ron", "触点导通电阻", 0.05, unit="Ω", positive=True),
            float_param("Roff", "触点断开电阻", 1.0e9, unit="Ω", positive=True),
            ParamSpec("com_node", "公共端节点", "node", ""),
            ParamSpec("no_node", "常开端节点", "node", ""),
        ),
        cls=Relay,
        group="功率电子与电机",
        source="netlab/powerelectronics.py",
        formula="|Icoil|≥Ion 时 COM-NO 导通",
        notes="不含线圈电感与机械回跳",
        pins=RELAY_PINS,
    ),
    "motor": dict(
        kind="motor",
        label="直流电机",
        description="R15：含反电动势与机械一阶惯量的直流电机。",
        params=(
            float_param("R", "电枢电阻", 1.0, unit="Ω", positive=True),
            float_param("Ke", "反电动势常数", 0.05, unit="V·s/rad", step=0.01),
            float_param("Kt", "转矩常数", 0.05, unit="N·m/A", step=0.01),
            float_param("J", "转动惯量", 0.002, unit="kg·m²", positive=True),
            float_param("b", "粘性阻尼", 0.0005, unit="N·m·s/rad", step=0.0001),
            float_param("Tload", "负载转矩", 0.0, unit="N·m", step=0.01),
            float_param("omega0", "初始转速", 0.0, unit="rad/s", step=0.1),
        ),
        cls=DcMotor,
        group="功率电子与电机",
        source="netlab/powerelectronics.py",
        formula="v = R·i + Ke·ω；J·dω/dt = Kt·i − b·ω − Tload",
        notes="后向欧拉推进转速；AC 小信号按电枢电阻处理",
        pins=MOTOR_PINS,
    ),
}


__all__ = [
    "Thyristor",
    "Igbt",
    "Jfet",
    "Relay",
    "DcMotor",
    "POWER_ELECTRONIC_SPECS",
]
