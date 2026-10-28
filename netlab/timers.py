"""R15 第三批：555 定时器（行为级方波）与 LDO 线性稳压器。"""

from __future__ import annotations

from typing import Any

from .nodal import CircuitElement, StampContext
from .params import ParamSpec, choice_param, float_param


class Astable555(CircuitElement):
    """555 无稳态方波：按频率/占空比直接输出高/低电平（不建模 RC 充放电）。"""

    kind = "ne555"
    label = "555 定时器（无稳态）"
    needs_branch = True
    output_fields = ("current", "voltage_difference", "power", "out")

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.frequency = max(1.0e-6, float(self.params.get("freq", 1000.0)))
        self.duty = min(0.99, max(0.01, float(self.params.get("duty", 0.5))))
        self.vhigh = float(self.params.get("vhigh", 5.0))
        self.vlow = float(self.params.get("vlow", 0.0))
        self.value = self.vlow

    def reset(self) -> None:
        super().reset()
        self.value = self.vlow

    def prepare(self, dt: float, time: float) -> None:
        super().prepare(dt, time)
        phase = (float(time) * self.frequency) % 1.0
        self.value = self.vhigh if phase < self.duty else self.vlow

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
        ctx.rhs[row] = self.value

    def current(self, ctx: StampContext) -> float:
        return float(ctx.solution[self.branch_index])

    def commit(self, ctx: StampContext) -> None:
        current = self.current(ctx)
        voltage = ctx.voltage(self.a) - ctx.voltage(self.b)
        self.result = {
            "current": float(current),
            "voltage_difference": float(voltage),
            "power": float(voltage * current),
            "out": float(voltage),
        }


class LDO(CircuitElement):
    """LDO 行为：Vout = min(Vtarget, Vin − dropout)，不作为时跟随输入。"""

    kind = "ldo"
    label = "LDO 稳压器"
    needs_branch = True
    nonlinear = True
    output_fields = ("current", "voltage_difference", "power", "out")

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.vin_node = self.pin("IN", "vin_node")
        self.vtarget = float(self.params.get("vout", 5.0))
        self.dropout = max(0.0, float(self.params.get("dropout", 0.5)))
        self.value = 0.0
        self.iteration_guess.setdefault("value", 0.0)

    def reset(self) -> None:
        super().reset()
        self.value = 0.0
        self.iteration_guess["value"] = 0.0

    def stamp(self, ctx: StampContext) -> None:
        vin = ctx.voltage(self.vin_node) if self.vin_node else 0.0
        target = min(self.vtarget, max(0.0, vin - self.dropout))
        self.iteration_guess["value"] = target
        row = self.branch_index
        ai = ctx.index.get(self.a)
        bi = ctx.index.get(self.b)
        if ai is not None:
            ctx.A[ai, row] += 1.0
            ctx.A[row, ai] += 1.0
        if bi is not None:
            ctx.A[bi, row] -= 1.0
            ctx.A[row, bi] -= 1.0
        ctx.rhs[row] = target

    def update_guess(self, ctx: StampContext) -> None:
        pass

    def current(self, ctx: StampContext) -> float:
        return float(ctx.solution[self.branch_index])

    def commit(self, ctx: StampContext) -> None:
        self.value = float(self.iteration_guess.get("value", 0.0))
        current = self.current(ctx)
        voltage = ctx.voltage(self.a) - ctx.voltage(self.b)
        self.result = {
            "current": float(current),
            "voltage_difference": float(voltage),
            "power": float(voltage * current),
            "out": float(voltage),
        }


TIMER_MODELS = {
    "ne555": {
        "NE555": dict(freq=1000.0, duty=0.5, vhigh=5.0, vlow=0.0),
        "SE555": dict(freq=1000.0, duty=0.5, vhigh=5.0, vlow=0.0),
        "LM555": dict(freq=1000.0, duty=0.5, vhigh=5.0, vlow=0.0),
        "LMC555": dict(freq=1000.0, duty=0.5, vhigh=5.0, vlow=0.0),
    },
    "ldo": {
        "LM7805": dict(vout=5.0, dropout=2.0),
        "LM7812": dict(vout=12.0, dropout=2.0),
        "LM317": dict(vout=1.25, dropout=3.0),
        "AMS1117-3.3": dict(vout=3.3, dropout=1.1),
        "AMS1117-5.0": dict(vout=5.0, dropout=1.3),
    },
}

TIMER_SPECS = {
    "ne555": dict(
        kind="ne555",
        label="555 定时器（无稳态）",
        description="行为级方波源：按 freq/duty 输出 vhigh/vlow，不建模 RC 充放电。",
        params=(
            choice_param("model", "型号", "NE555",
                         (("custom", "自定义"),) + tuple((k, k) for k in TIMER_MODELS["ne555"]),
                         help="NE555/SE555/LM555/LMC555：行为级方波，参数只影响频率/占空比/电平"),
            ParamSpec("vcc_node", "供电节点", "node", ""),
            float_param("freq", "频率", 1000.0, unit="Hz", positive=True),
            float_param("duty", "高电平占空比", 0.5),
            float_param("vhigh", "高电平", 5.0, unit="V"),
            float_param("vlow", "低电平", 0.0, unit="V"),
        ),
        cls=Astable555,
        formula="Vout = vhigh（phase<duty）否则 vlow；phase=(t·freq) mod 1",
        notes="行为级；不建模 TRIG/THRES/DIS 与 RC 充放电",
        source="netlab/timers.py",
        presets=TIMER_MODELS["ne555"],
    ),
    "ldo": dict(
        kind="ldo",
        label="LDO 稳压器",
        description="行为级线性稳压：Vout=min(Vtarget, Vin−dropout)。",
        params=(
            choice_param("model", "型号", "LM7805",
                         (("custom", "自定义"),) + tuple((k, k) for k in TIMER_MODELS["ldo"]),
                         help="固定输出：LM7805/LM7812/AMS1117；可调：LM317（vout=目标值）"),
            ParamSpec("vin_node", "输入节点", "node", ""),
            float_param("vout", "目标输出电压", 5.0, unit="V"),
            float_param("dropout", "压差", 0.5, unit="V"),
        ),
        cls=LDO,
        formula="Vout = min(Vtarget, max(0, Vin − dropout))",
        notes="行为级；无电流限制/热保护；常用型号 " + "/".join(TIMER_MODELS["ldo"]),
        source="netlab/timers.py",
        presets=TIMER_MODELS["ldo"],
    ),
}

__all__ = ["Astable555", "LDO", "TIMER_SPECS"]
