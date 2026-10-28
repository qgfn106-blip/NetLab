"""R15 第三批：逻辑门行为模型（与/或/非/异或）。

用“输出经导通电阻接到 VDD 或 GND”的平滑开关模型，避免数字门在 MNA 里引入
不连续电压源；输入为高阻，阈值/斜率可调。只做行为级，不做传输延迟/扇出。
"""

from __future__ import annotations

import math
from typing import Any

from .nodal import CircuitElement, StampContext, _stamp_conductance
from .params import ParamSpec, choice_param, float_param

LOGIC_LEVELS = ("and", "or", "not", "xor")


def _sigmoid(x: float) -> float:
    if x >= 40.0:
        return 1.0
    if x <= -40.0:
        return 0.0
    return 1.0 / (1.0 + math.exp(-x))


class LogicGate(CircuitElement):
    """a=输出，b=输出参考（通常地）；输入/电源由命名节点提供。"""

    kind = "and_gate"
    label = "与门"
    nonlinear = True
    logic = "and"
    output_fields = ("current", "voltage_difference", "power", "out")

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.in_a = self.pin("A", "in_a")
        self.in_b = self.pin("B", "in_b")
        self.vdd_node = self.pin("VDD", "vdd_node")
        self.vth = float(self.params.get("vth", 2.5))
        self.ron = max(1.0e-3, float(self.params.get("ron", 50.0)))
        self.slope = max(0.1, float(self.params.get("slope", 10.0)))

    def _level(self, ctx: StampContext, node: str) -> float:
        return _sigmoid(self.slope * (ctx.voltage(node) - self.vth))

    def _drive(self, ctx: StampContext) -> float:
        a = self._level(ctx, self.in_a)
        b = self._level(ctx, self.in_b) if self.in_b else 0.0
        logic = self.logic
        if logic == "and":
            return a * b
        if logic == "or":
            return a + b - a * b
        if logic == "not":
            return 1.0 - a
        if logic == "xor":
            return a + b - 2.0 * a * b
        return 0.0

    def stamp(self, ctx: StampContext) -> None:
        drive = max(0.0, min(1.0, self._drive(ctx)))
        conductance = 1.0 / self.ron
        _stamp_conductance(ctx, self.a, self.vdd_node, conductance * drive)
        _stamp_conductance(ctx, self.a, self.b, conductance * (1.0 - drive))

    def update_guess(self, ctx: StampContext) -> None:
        pass

    def _currents(self, ctx: StampContext) -> tuple[float, float, float]:
        """返回 (输出端总电流 i_a→门, 上管电流 i_a→VDD, 下管电流 i_a→b)。

        门电路在求解器里被 stamp 成两条并联电导：a↔VDD（drive）与 a↔b
        （1−drive）。因此电流探针按两条支路求和，不再恒为 0（P1-04）。
        """
        drive = max(0.0, min(1.0, self._drive(ctx)))
        conductance = 1.0 / self.ron
        v_out = ctx.voltage(self.a)
        i_up = conductance * drive * (v_out - ctx.voltage(self.vdd_node))
        i_down = conductance * (1.0 - drive) * (v_out - ctx.voltage(self.b))
        return i_up + i_down, i_up, i_down

    def current(self, ctx: StampContext) -> float:
        return self._currents(ctx)[0]

    def commit(self, ctx: StampContext) -> None:
        voltage = ctx.voltage(self.a) - ctx.voltage(self.b)
        current, i_up, i_down = self._currents(ctx)
        power = i_up * (ctx.voltage(self.a) - ctx.voltage(self.vdd_node)) + i_down * (
            ctx.voltage(self.a) - ctx.voltage(self.b)
        )
        self.result = {
            "current": float(current),
            "voltage_difference": float(voltage),
            # 吸收功率恒 ≥ 0：两条电导上消耗的功率之和。
            "power": float(max(0.0, power)),
            # 从 VDD 节点抽走的电流（供电脚电流方向与输出脚相反）。
            "supply_current": float(i_up),
            "out": float(voltage),
        }


LOGIC_SPECS = {
    "and_gate": dict(
        kind="and_gate",
        label="与门",
        description="行为级与门：输出经 Ron 接 VDD/GND，输入阈值可调。",
        params=(
            ParamSpec("in_a", "输入 A", "node", ""),
            ParamSpec("in_b", "输入 B", "node", ""),
            ParamSpec("vdd_node", "VDD 节点", "node", ""),
            float_param("vth", "逻辑阈值", 2.5, unit="V"),
            float_param("ron", "导通电阻", 50.0, unit="Ω", positive=True),
            float_param("slope", "转换斜率", 10.0, positive=True),
        ),
        cls=LogicGate,
        source="netlab/logic.py",
        formula="out = VDD · drive(A, B)\n"
        "i_out = (drive/Ron)·(v_a − v_VDD) + ((1−drive)/Ron)·(v_a − v_b)",
        notes="行为级；无延迟/扇出/竞争建模；current/power 由两条电导支路求和",
    ),
}


def _make(kind: str, label: str, logic: str) -> dict[str, Any]:
    spec = dict(LOGIC_SPECS["and_gate"])
    spec.update({"kind": kind, "label": label, "description": f"行为级{label}。"})
    spec["source"] = "netlab/logic.py"
    spec["cls"] = type(f"Logic_{kind}", (LogicGate,), {"kind": kind, "label": label, "logic": logic})
    if logic == "not":
        spec["formula"] = "out = VDD · (1−A)"
    elif logic == "or":
        spec["formula"] = "out = VDD · (A+B−A·B)"
    elif logic == "xor":
        spec["formula"] = "out = VDD · (A+B−2A·B)"
    else:
        spec["formula"] = "out = VDD · (A·B)"
    return spec


LOGIC_MODELS = {
    "and_gate": {
        "74HC08": dict(vth=2.5, ron=50.0, slope=10.0),
        "74LS08": dict(vth=1.4, ron=120.0, slope=20.0),
        "CD4081": dict(vth=2.5, ron=200.0, slope=8.0),
    },
    "or_gate": {
        "74HC32": dict(vth=2.5, ron=50.0, slope=10.0),
        "74LS32": dict(vth=1.4, ron=120.0, slope=20.0),
        "CD4071": dict(vth=2.5, ron=200.0, slope=8.0),
    },
    "not_gate": {
        "74HC04": dict(vth=2.5, ron=50.0, slope=10.0),
        "74LS04": dict(vth=1.4, ron=120.0, slope=20.0),
        "CD4069": dict(vth=2.5, ron=200.0, slope=8.0),
    },
    "xor_gate": {
        "74HC86": dict(vth=2.5, ron=50.0, slope=10.0),
        "74LS86": dict(vth=1.4, ron=120.0, slope=20.0),
        "CD4030": dict(vth=2.5, ron=200.0, slope=8.0),
    },
}


def _with_model(spec: dict[str, Any]) -> dict[str, Any]:
    models = LOGIC_MODELS[spec["kind"]]
    model_param = choice_param(
        "model", "型号", next(iter(models)),
        (("custom", "自定义"),) + tuple((name, name) for name in models),
        help="74HC=2–6 V CMOS，74LS=5 V TTL，CD4000=3–18 V；选型号会填典型阈值/导通电阻",
    )
    params = spec["params"]
    if params and params[0].key == "model":
        params = (model_param,) + params[1:]
    else:
        params = (model_param,) + params
    spec["params"] = params
    spec["presets"] = models
    spec["notes"] = "行为级；常用型号 " + "/".join(models) + "；无传输延迟/扇出/竞争建模"
    return spec


LOGIC_GATE_SPECS = {
    "and_gate": _with_model(LOGIC_SPECS["and_gate"]),
    "or_gate": _with_model(_make("or_gate", "或门", "or")),
    "not_gate": _with_model(_make("not_gate", "非门", "not")),
    "xor_gate": _with_model(_make("xor_gate", "异或门", "xor")),
}

__all__ = ["LogicGate", "LOGIC_GATE_SPECS"]
