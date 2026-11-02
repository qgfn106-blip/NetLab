"""R15 第三批（收尾）：变压器与互感线圈（双端口磁耦合）。

两个元件都用「额外支路电流」在 MNA 中表达磁耦合，不引入内部节点：

- ``transformer``：理想变压器 v2 = n·v1、i1 + n·i2 = 0（功率守恒），
  可选励磁电感 Lm 与原边并联（Lm>0 时多一条支路方程）。
- ``coupling_inductor``：互感耦合电感，v1 = L1·di1/dt + M·di2/dt，
  v2 = M·di1/dt + L2·di2/dt，M = k·sqrt(L1·L2)；用梯形法/后向欧拉
  的伴随模型盖章，块矩阵为 2×2 的逆电感阵。

副边是参数绑定的节点（``secondary_source`` / ``secondary_target``），
和运放控制端一样需要在图上有直流通路（负载或接地），否则 MNA 奇异。
"""

from __future__ import annotations

import math
from typing import Any

from .nodal import CircuitElement, StampContext
from .params import ParamSpec, float_param


def _stamp_branch_kcl(
    ctx: StampContext,
    row: int,
    positive: str,
    negative: str,
) -> None:
    """支路电流对节点 KCL 的贡献（只写节点行，不写支路方程行）。"""
    pi = ctx.index.get(positive)
    ni = ctx.index.get(negative)
    if pi is not None:
        ctx.A[pi, row] += 1.0
    if ni is not None:
        ctx.A[ni, row] -= 1.0


class Transformer(CircuitElement):
    """理想变压器（可选励磁电感）。

    ``ratio`` = 副边/原边电压比 n：v2 = n·v1，i1 + n·i2 = 0。
    原边端点 = (a, b)，副边节点由参数绑定。
    """

    kind = "transformer"
    label = "变压器"
    needs_branch = True
    output_fields = ("current", "voltage_difference", "power", "v2", "i2")

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.ratio = float(self.params["ratio"])
        self.magnetizing = max(0.0, float(self.params.get("Lm", 0.0)))
        self.sec_source = self.pin("S1", "secondary_source")
        self.sec_target = self.pin("S2", "secondary_target")
        #: 理想变压器 2 条支路；带励磁电感时第 3 条为励磁支路。
        self.branch_width = 3 if self.magnetizing > 0.0 else 2
        self.state.setdefault("im", 0.0)
        self.state.setdefault("vm", 0.0)
        self.mag_g = 0.0
        self.mag_rhs = 0.0

    def reset(self) -> None:
        self.state["im"] = 0.0
        self.state["vm"] = 0.0

    def prepare(self, dt: float, time: float) -> None:
        super().prepare(dt, time)
        if self.magnetizing <= 0.0:
            return
        previous_i = float(self.state.get("im", 0.0))
        if self.integration == "backward_euler":
            self.mag_g = self.magnetizing / dt
            self.mag_rhs = -self.mag_g * previous_i
        else:
            self.mag_g = 2.0 * self.magnetizing / dt
            previous_v = float(self.state.get("vm", 0.0))
            self.mag_rhs = -self.mag_g * previous_i - previous_v

    def stamp(self, ctx: StampContext) -> None:
        primary = self.branch_indices[0]
        secondary = self.branch_indices[1]
        # 支路电流 → 节点 KCL
        _stamp_branch_kcl(ctx, primary, self.a, self.b)
        _stamp_branch_kcl(ctx, secondary, self.sec_source, self.sec_target)
        # 电压比约束：v_c − v_d − n·(v_a − v_b) = 0
        ai = ctx.index.get(self.a)
        bi = ctx.index.get(self.b)
        ci = ctx.index.get(self.sec_source)
        di = ctx.index.get(self.sec_target)
        if ci is not None:
            ctx.A[primary, ci] += 1.0
        if di is not None:
            ctx.A[primary, di] -= 1.0
        if ai is not None:
            ctx.A[primary, ai] -= self.ratio
        if bi is not None:
            ctx.A[primary, bi] += self.ratio
        # 安匝平衡：i1 + n·i2 − i_m = 0
        ctx.A[secondary, primary] += 1.0
        ctx.A[secondary, secondary] += self.ratio
        if self.magnetizing > 0.0:
            magnetizing_row = self.branch_indices[2]
            ctx.A[secondary, magnetizing_row] -= 1.0
            # 励磁电感：v_a − v_b − g·i_m = rhs
            if ai is not None:
                ctx.A[magnetizing_row, ai] += 1.0
            if bi is not None:
                ctx.A[magnetizing_row, bi] -= 1.0
            ctx.A[magnetizing_row, magnetizing_row] -= self.mag_g
            ctx.rhs[magnetizing_row] = self.mag_rhs

    def update_guess(self, ctx: StampContext) -> None:
        pass

    def current(self, ctx: StampContext) -> float:
        return float(ctx.solution[self.branch_indices[0]])

    def commit(self, ctx: StampContext) -> None:
        primary_current = float(ctx.solution[self.branch_indices[0]])
        secondary_current = float(ctx.solution[self.branch_indices[1]])
        primary_voltage = ctx.voltage(self.a) - ctx.voltage(self.b)
        secondary_voltage = ctx.voltage(self.sec_source) - ctx.voltage(self.sec_target)
        if self.magnetizing > 0.0:
            self.state["im"] = float(ctx.solution[self.branch_indices[2]])
            self.state["vm"] = primary_voltage
        self.result = {
            "current": primary_current,
            "voltage_difference": primary_voltage,
            "power": primary_voltage * primary_current
            + secondary_voltage * secondary_current,
            "v2": secondary_voltage,
            "i2": secondary_current,
        }


class CoupledInductor(CircuitElement):
    """互感耦合电感（双绕组），M = k·sqrt(L1·L2)。"""

    kind = "coupling_inductor"
    label = "互感线圈"
    needs_branch = True
    branch_width = 2
    output_fields = ("current", "voltage_difference", "power", "v2", "i2")

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.l1 = max(1.0e-12, float(self.params["L1"]))
        self.l2 = max(1.0e-12, float(self.params["L2"]))
        # 互感系数必须 |k|<1，否则 L1·L2 − M² = 0，逆电感阵奇异。
        self.coupling = min(0.999, max(0.0, float(self.params.get("coupling", 0.9))))
        self.mutual = self.coupling * math.sqrt(self.l1 * self.l2)
        self.sec_source = self.pin("S1", "secondary_source")
        self.sec_target = self.pin("S2", "secondary_target")
        self.state.setdefault("i1", float(self.params.get("i1_0", 0.0)))
        self.state.setdefault("i2", float(self.params.get("i2_0", 0.0)))
        self.state.setdefault("v1", 0.0)
        self.state.setdefault("v2", 0.0)
        self.g = ((0.0, 0.0), (0.0, 0.0))
        self.rhs = (0.0, 0.0)

    def reset(self) -> None:
        self.state["i1"] = float(self.params.get("i1_0", 0.0))
        self.state["i2"] = float(self.params.get("i2_0", 0.0))
        self.state["v1"] = 0.0
        self.state["v2"] = 0.0

    def prepare(self, dt: float, time: float) -> None:
        super().prepare(dt, time)
        determinant = self.l1 * self.l2 - self.mutual * self.mutual
        inverse = (
            (self.l2 / determinant, -self.mutual / determinant),
            (-self.mutual / determinant, self.l1 / determinant),
        )
        factor = dt if self.integration == "backward_euler" else 0.5 * dt
        g11, g12 = factor * inverse[0][0], factor * inverse[0][1]
        g21, g22 = factor * inverse[1][0], factor * inverse[1][1]
        self.g = ((g11, g12), (g21, g22))
        previous_i = (float(self.state.get("i1", 0.0)), float(self.state.get("i2", 0.0)))
        if self.integration == "backward_euler":
            self.rhs = (previous_i[0], previous_i[1])
        else:
            previous_v = (float(self.state.get("v1", 0.0)), float(self.state.get("v2", 0.0)))
            self.rhs = (
                previous_i[0] + g11 * previous_v[0] + g12 * previous_v[1],
                previous_i[1] + g21 * previous_v[0] + g22 * previous_v[1],
            )

    def stamp(self, ctx: StampContext) -> None:
        primary = self.branch_indices[0]
        secondary = self.branch_indices[1]
        _stamp_branch_kcl(ctx, primary, self.a, self.b)
        _stamp_branch_kcl(ctx, secondary, self.sec_source, self.sec_target)
        ai = ctx.index.get(self.a)
        bi = ctx.index.get(self.b)
        ci = ctx.index.get(self.sec_source)
        di = ctx.index.get(self.sec_target)
        # 伴随模型：i1 − g11·v1 − g12·v2 = rhs1；i2 − g21·v1 − g22·v2 = rhs2
        for row, (g11, g12) in ((primary, self.g[0]), (secondary, self.g[1])):
            ctx.A[row, row] += 1.0
            if ai is not None:
                ctx.A[row, ai] -= g11
            if bi is not None:
                ctx.A[row, bi] += g11
            if ci is not None:
                ctx.A[row, ci] -= g12
            if di is not None:
                ctx.A[row, di] += g12
        ctx.rhs[primary] = self.rhs[0]
        ctx.rhs[secondary] = self.rhs[1]

    def update_guess(self, ctx: StampContext) -> None:
        pass

    def current(self, ctx: StampContext) -> float:
        return float(ctx.solution[self.branch_indices[0]])

    def commit(self, ctx: StampContext) -> None:
        primary_current = float(ctx.solution[self.branch_indices[0]])
        secondary_current = float(ctx.solution[self.branch_indices[1]])
        primary_voltage = ctx.voltage(self.a) - ctx.voltage(self.b)
        secondary_voltage = ctx.voltage(self.sec_source) - ctx.voltage(self.sec_target)
        self.state["i1"] = primary_current
        self.state["i2"] = secondary_current
        self.state["v1"] = primary_voltage
        self.state["v2"] = secondary_voltage
        self.result = {
            "current": primary_current,
            "voltage_difference": primary_voltage,
            "power": primary_voltage * primary_current
            + secondary_voltage * secondary_current,
            "v2": secondary_voltage,
            "i2": secondary_current,
        }


MAGNETIC_SPECS: dict[str, dict[str, Any]] = {
    "transformer": dict(
        kind="transformer",
        label="变压器",
        description="理想变压器（可选励磁电感）：副边电压 = n × 原边电压，双端口磁耦合。",
        params=(
            ParamSpec("secondary_source", "副边正端", "node", ""),
            ParamSpec("secondary_target", "副边负端", "node", ""),
            float_param("ratio", "变比 n（副/原）", 1.0, positive=True, step=0.1),
            float_param(
                "Lm",
                "励磁电感",
                0.0,
                unit="H",
                minimum=0.0,
                help="0=理想变压器；大于 0 时原边并联励磁电感",
            ),
        ),
        cls=Transformer,
        pins=(
            {"name": "P1", "role": "input", "bind": "source", "dx": -18, "dy": 0},
            {"name": "P2", "role": "input", "bind": "target", "dx": 18, "dy": 0},
            {"name": "S1", "role": "output", "bind": "secondary_source", "dx": 18, "dy": -8},
            {"name": "S2", "role": "output", "bind": "secondary_target", "dx": 18, "dy": 8},
        ),
        formula="v2 = n·v1；i1 + n·i2 = 0（Lm>0 时 i1 = i_ideal + i_m，v1 = Lm·di_m/dt）",
        notes=(
            "理想变压器是代数元件，不建模铁损/漏感/饱和；副边节点必须有直流通路"
            "（负载或接地），否则 MNA 奇异"
        ),
        source="netlab/magnetics.py",
    ),
    "coupling_inductor": dict(
        kind="coupling_inductor",
        label="互感线圈",
        description="双绕组互感：v1 = L1·di1/dt + M·di2/dt，v2 = M·di1/dt + L2·di2/dt。",
        params=(
            ParamSpec("secondary_source", "副边正端", "node", ""),
            ParamSpec("secondary_target", "副边负端", "node", ""),
            float_param("L1", "原边电感 L1", 1.0e-3, unit="H", positive=True),
            float_param("L2", "副边电感 L2", 1.0e-3, unit="H", positive=True),
            float_param("coupling", "耦合系数 k", 0.9, minimum=0.0, maximum=0.999),
            float_param("i1_0", "原边初始电流", 0.0, unit="A"),
            float_param("i2_0", "副边初始电流", 0.0, unit="A"),
        ),
        cls=CoupledInductor,
        pins=(
            {"name": "P1", "role": "input", "bind": "source", "dx": -18, "dy": 0},
            {"name": "P2", "role": "input", "bind": "target", "dx": 18, "dy": 0},
            {"name": "S1", "role": "output", "bind": "secondary_source", "dx": 18, "dy": -8},
            {"name": "S2", "role": "output", "bind": "secondary_target", "dx": 18, "dy": 8},
        ),
        formula=(
            "v1 = L1·di1/dt + M·di2/dt；v2 = M·di1/dt + L2·di2/dt；"
            "M = k·sqrt(L1·L2)；伴随模型 i = i_prev + G·v（G = (dt/2)·L⁻¹）"
        ),
        notes="线性磁耦合；|k|<1（k=1 时逆电感阵奇异）；不建模漏感分布/铁芯饱和",
        source="netlab/magnetics.py",
    ),
}

__all__ = ["Transformer", "CoupledInductor", "MAGNETIC_SPECS"]
