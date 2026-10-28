"""R15 第三批（首批）：NPN/PNP 三极管与 NMOS/PMOS 行为模型。"""

from __future__ import annotations

import math
from typing import Any

from .nodal import CircuitElement, StampContext, _stamp_conductance, _stamp_current
from .params import ParamSpec, choice_param, float_param

K_BOLTZMANN = 8.617333262e-5


def _limit_junction(vnew: float, vold: float, thermal: float) -> float:
    if not math.isfinite(vnew):
        return vold
    if vnew > 0.9 and abs(vnew - vold) > 2.0 * thermal:
        argument = 1.0 + (vnew - vold) / thermal
        if argument > 0:
            vnew = vold + thermal * math.log(argument)
    return vnew


class BipolarJunction(CircuitElement):
    """三极管行为模型（Ebers-Moll 简化）：B-E 二极管 + β 倍集电极电流。"""

    kind = "npn"
    label = "NPN 三极管"
    nonlinear = True
    polarity = 1.0  # NPN=+1，PNP=-1
    output_fields = ("current", "voltage_difference", "power", "ic", "ib")

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.base_node = self.pin("B", "base_node")
        self.saturation = float(self.params["Is"])
        self.emission = float(self.params["n"])
        self.temperature = float(self.params["temperature"])
        self.beta = max(1.0, float(self.params["beta"]))
        self.vbe_on = float(self.params.get("vbe_on", 0.7))
        self.rin = max(1.0, float(self.params.get("rin", 1000.0)))
        # datasheet 限值参数只做记录与展示，不参与盖章（避免附加电导破坏收敛）。
        self.vce_sat = max(0.0, float(self.params.get("Vce_sat", 0.0)))
        self.ic_max = max(1.0e-12, float(self.params.get("Ic_max", 1.0)))
        self.leak = 1.0e-9
        self.thermal = K_BOLTZMANN * self.temperature * self.emission
        self.state.setdefault("vbe", 0.0)
        self.iteration_guess.setdefault("vbe", self.state["vbe"])

    def reset(self) -> None:
        super().reset()
        self.state["vbe"] = 0.0
        self.iteration_guess["vbe"] = 0.0

    def _junction(self, vbe: float) -> tuple[float, float]:
        # 行为级分段线性：开启后 B-E 呈 Rin，开启前高阻；避免指数发散。
        if vbe <= self.vbe_on:
            return vbe * self.leak, self.leak
        over = vbe - self.vbe_on
        return over / self.rin + vbe * self.leak, 1.0 / self.rin + self.leak

    def stamp(self, ctx: StampContext) -> None:
        polarity = self.polarity
        base = self.base_node
        collector = self.a
        emitter = self.b
        vbe = polarity * (ctx.voltage(base) - ctx.voltage(emitter))
        ib0, gbe = self._junction(vbe)
        beta = self.beta
        # B-E 结：电导对称；电流方向用 polarity 统一表达（NPN B→E，PNP E→B）。
        _stamp_conductance(ctx, base, emitter, gbe)
        _stamp_current(ctx, base, emitter, polarity * (ib0 - gbe * vbe))
        # 集电极电流 Ic = β·Ib：电流 C→E = polarity·Ic。
        gm = beta * gbe
        ci = ctx.index.get(collector)
        ei = ctx.index.get(emitter)
        bi = ctx.index.get(base)
        if bi is not None:
            if ci is not None:
                ctx.A[ci, bi] += gm
            if ei is not None:
                ctx.A[ei, bi] -= gm
        if ei is not None:
            if ci is not None:
                ctx.A[ci, ei] -= gm
            if ei is not None:
                ctx.A[ei, ei] += gm
        _stamp_current(ctx, collector, emitter, polarity * (beta * ib0 - gm * vbe))

    def update_guess(self, ctx: StampContext) -> None:
        vbe = self.polarity * (ctx.voltage(self.base_node) - ctx.voltage(self.b))
        previous = float(self.iteration_guess.get("vbe", self.state.get("vbe", 0.0)))
        self.iteration_guess["vbe"] = _limit_junction(vbe, previous, self.thermal)

    def current(self, ctx: StampContext) -> float:
        vbe = self.polarity * (ctx.voltage(self.base_node) - ctx.voltage(self.b))
        ib, _ = self._junction(min(vbe, 60.0 * self.thermal))
        return float(self.polarity * self.beta * ib)

    def commit(self, ctx: StampContext) -> None:
        voltage = ctx.voltage(self.a) - ctx.voltage(self.b)
        current = self.current(ctx)
        vbe = self.polarity * (ctx.voltage(self.base_node) - ctx.voltage(self.b))
        ib, _ = self._junction(min(vbe, 60.0 * self.thermal))
        self.state["vbe"] = vbe
        self.iteration_guess["vbe"] = vbe
        self.result = {
            "current": float(current),
            "voltage_difference": float(voltage),
            "power": float(voltage * current),
            "ic": float(current),
            "ib": float(ib),
        }


class PNP(BipolarJunction):
    kind = "pnp"
    label = "PNP 三极管"
    polarity = -1.0


class Mosfet(CircuitElement):
    """MOSFET 行为模型：平方律（截止/线性/饱和）+ 沟道长度调制 + 体效应。

    只做行为级：栅极无直流电流；不建模反向导通（Vds<0 时按 Vds=0 钳位）、
    结电容、击穿与热效应。``lambda``/``gamma`` 为 0 时退化为旧饱和平方律。
    """

    kind = "nmos"
    label = "N 沟道 MOSFET"
    nonlinear = True
    polarity = 1.0
    output_fields = ("current", "voltage_difference", "power", "id")

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.gate_node = self.pin("G", "gate_node")
        # 体端可用引脚 B 或参数 body_node 指定；缺省接源极（Vbs=0）。
        self.body_node = self.pin("B", "body_node") or ""
        self.k = max(1.0e-9, float(self.params["k"]))
        self.vth = float(self.params["Vth"])
        self.lam = max(0.0, float(self.params.get("lambda", 0.0) or 0.0))
        self.gamma = max(0.0, float(self.params.get("gamma", 0.0) or 0.0))
        self.phi = max(1.0e-3, float(self.params.get("phi", 0.7) or 0.7))

    def _threshold(self, vbs: float) -> tuple[float, float]:
        """返回 (体效应后的阈值, dVth/dVbs)。

        ``Vth(Vbs) = Vth0 + γ·(√(φ−Vbs) − √φ)``，只在反偏（Vbs ≤ 0）时生效。
        """
        if self.gamma <= 0.0:
            return self.vth, 0.0
        vbs = min(0.0, vbs)
        root = math.sqrt(max(self.phi - vbs, 1.0e-9))
        return self.vth + self.gamma * (root - math.sqrt(self.phi)), -self.gamma / (
            2.0 * root
        )

    def _operating_point(
        self, ctx: StampContext
    ) -> tuple[float, float, float, float, float, float, float]:
        """在解向量上取工作点，返回 (Id, gm, gds, gmbs, Vgs, Vds, Vbs)。"""
        polarity = self.polarity
        source = ctx.voltage(self.b)
        vgs = polarity * (ctx.voltage(self.gate_node) - source)
        vds = polarity * (ctx.voltage(self.a) - source)
        body = self.body_node
        if body and body != self.b:
            vbs = polarity * (ctx.voltage(body) - source)
        else:
            body = ""
            vbs = 0.0
        vth_eff, dth = self._threshold(vbs)
        over = vgs - vth_eff
        if over <= 0.0 or vds <= 0.0:
            return 0.0, 0.0, 0.0, 0.0, vgs, vds, vbs
        clm = 1.0 + self.lam * vds
        if vds < over:
            # 线性区（triode）：沟道未夹断。
            current = self.k * (over * vds - 0.5 * vds * vds) * clm
            gm = self.k * vds * clm
            gds = self.k * (over - vds) * clm + 0.5 * self.k * (
                over * vds - 0.5 * vds * vds
            ) * 2.0 * self.lam
        else:
            # 饱和区：沟道夹断后只受沟道长度调制影响。
            current = 0.5 * self.k * over * over * clm
            gm = self.k * over * clm
            gds = 0.5 * self.k * over * over * self.lam
        gmbs = -gm * dth if body else 0.0
        return current, gm, gds, gmbs, vgs, vds, vbs

    def _drain_current(self, vgs: float, vds: float = 0.0) -> tuple[float, float]:
        """兼容旧接口：给定 Vgs/Vds（不含体效应）返回 (Id, gm)。"""
        vth_eff, _ = self._threshold(0.0)
        over = vgs - vth_eff
        if over <= 0.0:
            return 0.0, 0.0
        vds = max(0.0, vds)
        clm = 1.0 + self.lam * vds
        if vds < over:
            return (
                self.k * (over * vds - 0.5 * vds * vds) * clm,
                self.k * vds * clm,
            )
        return 0.5 * self.k * over * over * clm, self.k * over * clm

    def stamp(self, ctx: StampContext) -> None:
        polarity = self.polarity
        drain = self.a
        source = self.b
        gate = self.gate_node
        current, gm, gds, gmbs, vgs, vds, vbs = self._operating_point(ctx)
        di = ctx.index.get(drain)
        si = ctx.index.get(source)
        gi = ctx.index.get(gate)
        bi = ctx.index.get(self.body_node) if self.body_node else None
        if di is not None:
            if gi is not None:
                ctx.A[di, gi] += gm
            # 自电导项：即使源极接地（不在索引中）也必须加到漏极对角线上，
            # 否则线性区/饱和区交界处的 Newton 会退化成两点振荡。
            ctx.A[di, di] += gds
            if si is not None:
                ctx.A[di, si] -= gm + gds + gmbs
            if bi is not None:
                ctx.A[di, bi] += gmbs
        if si is not None:
            if gi is not None:
                ctx.A[si, gi] -= gm
            ctx.A[si, si] += gm + gds + gmbs
            if di is not None:
                ctx.A[si, di] -= gds
            if bi is not None:
                ctx.A[si, bi] -= gmbs
        _stamp_current(
            ctx,
            drain,
            source,
            polarity * (current - gm * vgs - gds * vds - gmbs * vbs),
        )

    def update_guess(self, ctx: StampContext) -> None:
        # 无内部状态；保留接口（Newton 每轮由 stamp 重新线性化）。
        pass

    def current(self, ctx: StampContext) -> float:
        current, _, _, _, _, _, _ = self._operating_point(ctx)
        return float(self.polarity * current)

    def commit(self, ctx: StampContext) -> None:
        voltage = ctx.voltage(self.a) - ctx.voltage(self.b)
        current = self.current(ctx)
        self.result = {
            "current": float(current),
            "voltage_difference": float(voltage),
            "power": float(voltage * current),
            "id": float(current),
        }


class PMOS(Mosfet):
    kind = "pmos"
    label = "P 沟道 MOSFET"
    polarity = -1.0


BJT_PINS = (
    {"name": "C", "role": "output", "bind": "source", "dx": 18, "dy": -10},
    {"name": "B", "role": "input", "bind": "base_node", "dx": -18, "dy": 0},
    {"name": "E", "role": "output", "bind": "target", "dx": 18, "dy": 10},
)
MOSFET_PINS = (
    {"name": "D", "role": "output", "bind": "source", "dx": 18, "dy": -10},
    {"name": "G", "role": "input", "bind": "gate_node", "dx": -18, "dy": 0},
    {"name": "S", "role": "output", "bind": "target", "dx": 18, "dy": 10},
)

BJT_LIMIT_PARAMS = (
    float_param("Vceo", "Vceo 集电极-发射极击穿", 40.0, unit="V", positive=True),
    float_param("Vcbo", "Vcbo 集电极-基极击穿", 60.0, unit="V", positive=True),
    float_param("Vebo", "Vebo 发射极-基极击穿", 6.0, unit="V", positive=True),
    float_param("Ic_max", "最大集电极电流", 0.2, unit="A", positive=True),
    float_param("Pd", "最大耗散功率", 0.625, unit="W", positive=True),
    float_param("hfe_min", "hFE 下限", 100.0, positive=True),
    float_param("hfe_max", "hFE 上限", 300.0, positive=True),
    float_param("Vce_sat", "饱和压降 Vce(sat)", 0.3, unit="V", positive=True),
    float_param("Vbe_sat", "饱和压降 Vbe(sat)", 0.95, unit="V", positive=True),
    float_param("fT", "特征频率 fT", 300.0e6, unit="Hz", positive=True),
)

#: 常用型号的 datasheet 典型值（TA=25°C）。选中型号时前端把这些值填进参数表。
BJT_PRESETS = {
    "2N3904": dict(beta=200.0, vbe_on=0.65, Is=1e-14, n=1.0, rin=1000.0, temperature=300.0,
                   Vceo=40.0, Vcbo=60.0, Vebo=6.0, Ic_max=0.2, Pd=0.625,
                   hfe_min=100.0, hfe_max=300.0, Vce_sat=0.3, Vbe_sat=0.95, fT=300e6),
    "BC547": dict(beta=290.0, vbe_on=0.62, Is=1e-14, n=1.0, rin=1000.0, temperature=300.0,
                  Vceo=45.0, Vcbo=50.0, Vebo=6.0, Ic_max=0.1, Pd=0.625,
                  hfe_min=110.0, hfe_max=800.0, Vce_sat=0.25, Vbe_sat=0.7, fT=300e6),
    "2N2222": dict(beta=200.0, vbe_on=0.65, Is=1e-14, n=1.0, rin=1000.0, temperature=300.0,
                   Vceo=40.0, Vcbo=75.0, Vebo=6.0, Ic_max=0.8, Pd=0.625,
                   hfe_min=100.0, hfe_max=300.0, Vce_sat=0.3, Vbe_sat=1.2, fT=300e6),
    "S8050": dict(beta=120.0, vbe_on=0.65, Is=1e-14, n=1.0, rin=1000.0, temperature=300.0,
                  Vceo=25.0, Vcbo=40.0, Vebo=5.0, Ic_max=0.7, Pd=0.625,
                  hfe_min=85.0, hfe_max=300.0, Vce_sat=0.6, Vbe_sat=1.2, fT=150e6),
    "2N3055": dict(beta=50.0, vbe_on=0.7, Is=1e-12, n=1.0, rin=10.0, temperature=300.0,
                   Vceo=60.0, Vcbo=100.0, Vebo=7.0, Ic_max=15.0, Pd=115.0,
                   hfe_min=20.0, hfe_max=70.0, Vce_sat=1.1, Vbe_sat=1.5, fT=2.5e6),
}

BJT_PRESETS_PNP = {
    "2N3906": dict(beta=180.0, vbe_on=0.65, Is=1e-14, n=1.0, rin=1000.0, temperature=300.0,
                   Vceo=40.0, Vcbo=40.0, Vebo=5.0, Ic_max=0.2, Pd=0.625,
                   hfe_min=100.0, hfe_max=300.0, Vce_sat=0.4, Vbe_sat=0.95, fT=250e6),
    "BC557": dict(beta=290.0, vbe_on=0.62, Is=1e-14, n=1.0, rin=1000.0, temperature=300.0,
                  Vceo=45.0, Vcbo=50.0, Vebo=5.0, Ic_max=0.1, Pd=0.625,
                  hfe_min=110.0, hfe_max=800.0, Vce_sat=0.3, Vbe_sat=0.7, fT=150e6),
    "S8550": dict(beta=120.0, vbe_on=0.65, Is=1e-14, n=1.0, rin=1000.0, temperature=300.0,
                  Vceo=25.0, Vcbo=40.0, Vebo=5.0, Ic_max=0.7, Pd=0.625,
                  hfe_min=85.0, hfe_max=300.0, Vce_sat=0.6, Vbe_sat=1.2, fT=150e6),
    "2N2907": dict(beta=150.0, vbe_on=0.65, Is=1e-14, n=1.0, rin=1000.0, temperature=300.0,
                   Vceo=40.0, Vcbo=60.0, Vebo=5.0, Ic_max=0.6, Pd=0.4,
                   hfe_min=100.0, hfe_max=300.0, Vce_sat=0.4, Vbe_sat=1.3, fT=200e6),
}

MOS_LIMIT_PARAMS = (
    float_param("Vds_max", "最大漏源电压 Vds", 60.0, unit="V", positive=True),
    float_param("Id_max", "最大漏极电流 Id", 0.2, unit="A", positive=True),
    float_param("Pd", "最大耗散功率", 0.4, unit="W", positive=True),
    float_param("Rds_on", "导通电阻 Rds(on)", 5.0, unit="Ω", positive=True),
)

MOS_PRESETS = {
    "2N7000": dict(k=0.0064, Vth=2.1, Vds_max=60.0, Id_max=0.2, Pd=0.4, Rds_on=5.0),
    "IRF540N": dict(k=1.5, Vth=3.5, Vds_max=100.0, Id_max=33.0, Pd=130.0, Rds_on=0.044),
    "AO3400": dict(k=0.9, Vth=1.1, Vds_max=30.0, Id_max=5.7, Pd=1.4, Rds_on=0.028),
}

MOS_PRESETS_P = {
    "IRF9540N": dict(k=0.9, Vth=3.5, Vds_max=100.0, Id_max=19.0, Pd=150.0, Rds_on=0.117),
    "AO3401": dict(k=0.6, Vth=1.2, Vds_max=30.0, Id_max=4.0, Pd=1.4, Rds_on=0.06),
}


def _bjt_params(presets: dict[str, dict[str, float]], kind: str) -> tuple:
    default = next(iter(presets.values()))
    model_choices = (("custom", "自定义"),) + tuple((name, name) for name in presets)
    limit_specs = (
        ("Vceo", "Vceo 集电极-发射极击穿", "V", True),
        ("Vcbo", "Vcbo 集电极-基极击穿", "V", True),
        ("Vebo", "Vebo 发射极-基极击穿", "V", True),
        ("Ic_max", "最大集电极电流", "A", True),
        ("Pd", "最大耗散功率", "W", True),
        ("hfe_min", "hFE 下限", "", True),
        ("hfe_max", "hFE 上限", "", True),
        ("Vce_sat", "饱和压降 Vce(sat)", "V", True),
        ("Vbe_sat", "饱和压降 Vbe(sat)", "V", True),
        ("fT", "特征频率 fT", "Hz", True),
    )
    params = [
        choice_param("model", "型号", next(iter(presets)), model_choices,
                     help="选择常用型号会填入 datasheet 典型参数；改任意值后仍按当前参数计算"),
        float_param("Is", "饱和电流 Is", default["Is"], unit="A", positive=True),
        float_param("n", "发射系数 n", default["n"]),
        float_param("temperature", "温度", default["temperature"], unit="K"),
        float_param("beta", "电流放大倍数 β", default["beta"], positive=True),
        float_param("vbe_on", "导通电压 Vbe(on)", default["vbe_on"], unit="V"),
        float_param("rin", "B-E 导通电阻", default["rin"], unit="Ω", positive=True),
    ]
    for key, label, unit, positive in limit_specs:
        params.append(float_param(key, label, float(default[key]), unit=unit, positive=positive))
    params.append(ParamSpec("base_node", "基极节点", "node", ""))
    return tuple(params)


BJT_SPECS = {
    "npn": dict(
        kind="npn",
        label="NPN 三极管",
        description="B-E 二极管 + β 倍集电极电流；含 2N3904/BC547/2N2222/S8050/2N3055 常用型号。",
        params=_bjt_params(BJT_PRESETS, "npn"),
        cls=BipolarJunction,
        source="netlab/transistors.py",
        formula="分段线性：Vbe ≤ Vbe(on) 时 Ib = Vbe·leak；否则 Ib = (Vbe−Vbe(on))/rin + Vbe·leak，"
        "Ic = β·Ib；leak = 1e-9",
        notes="行为级；Is/n/Vt 只用于记录与结电压限幅（不做 Ebers-Moll 指数）；"
        "Vceo/Vcbo/Vebo/Ic_max/Pd/hFE/fT/Vce_sat/Vbe_sat 为 datasheet 限值参数，不做击穿与结电容",
        pins=BJT_PINS,
        presets=BJT_PRESETS,
    ),
    "pnp": dict(
        kind="pnp",
        label="PNP 三极管",
        description="NPN 的极性镜像；含 2N3906/BC557/S8550/2N2907 常用型号。",
        params=_bjt_params(BJT_PRESETS_PNP, "pnp"),
        cls=PNP,
        source="netlab/transistors.py",
        formula="分段线性的 PNP 版本（极性取反，Veb 以发射结为正）：Ib 同 npn 的分段线性，Ic = β·Ib",
        notes="行为级；限值参数仅供参考，不做击穿",
        pins=BJT_PINS,
        presets=BJT_PRESETS_PNP,
    ),
    "nmos": dict(
        kind="nmos",
        label="N 沟道 MOSFET",
        description="平方律三态（截止/线性/饱和）+ 沟道长度调制 + 体效应；含 2N7000/IRF540N/AO3400 常用型号。",
        params=(
            choice_param("model", "型号", "2N7000", (("custom", "自定义"),) + tuple((k, k) for k in MOS_PRESETS)),
            float_param("k", "跨导系数 k", 0.0064, positive=True),
            float_param("Vth", "阈值电压", 2.1, unit="V"),
            float_param("lambda", "沟道长度调制 λ", 0.0, unit="1/V", help="0 = 忽略（默认）"),
            float_param("gamma", "体效应系数 γ", 0.0, unit="V^0.5", help="0 = 忽略（默认）"),
            float_param("phi", "表面势 φ", 0.7, unit="V", positive=True),
            *MOS_LIMIT_PARAMS,
            ParamSpec("gate_node", "栅极节点", "node", ""),
            ParamSpec("body_node", "衬底/体端节点", "node", "", help="缺省接源极（Vbs=0）"),
        ),
        cls=Mosfet,
        source="netlab/transistors.py",
        formula="Vth' = Vth + γ·(√(φ−Vbs) − √φ)；Vov = Vgs − Vth'\n"
        "Vov ≤ 0 或 Vds ≤ 0：Id = 0\n"
        "0 < Vds < Vov（线性区）：Id = k·(Vov·Vds − Vds²/2)\n"
        "Vds ≥ Vov（饱和区）：Id = ½·k·Vov²\n"
        "两者均乘 (1 + λ·Vds)",
        notes="行为级；不建模反向导通（Vds<0 钳位为 0）、结电容、击穿；Vds/Id/Pd/Rds(on) 为 datasheet 限值参数",
        pins=MOSFET_PINS,
        presets=MOS_PRESETS,
    ),
    "pmos": dict(
        kind="pmos",
        label="P 沟道 MOSFET",
        description="PMOS 平方律（三态 + 体效应）；含 IRF9540N/AO3401 常用型号。",
        params=(
            choice_param("model", "型号", "IRF9540N", (("custom", "自定义"),) + tuple((k, k) for k in MOS_PRESETS_P)),
            float_param("k", "跨导系数 k", 0.9, positive=True),
            float_param("Vth", "阈值电压", 3.5, unit="V"),
            float_param("lambda", "沟道长度调制 λ", 0.0, unit="1/V", help="0 = 忽略（默认）"),
            float_param("gamma", "体效应系数 γ", 0.0, unit="V^0.5", help="0 = 忽略（默认）"),
            float_param("phi", "表面势 φ", 0.7, unit="V", positive=True),
            *MOS_LIMIT_PARAMS,
            ParamSpec("gate_node", "栅极节点", "node", ""),
            ParamSpec("body_node", "衬底/体端节点", "node", "", help="缺省接源极（Vbs=0）"),
        ),
        cls=PMOS,
        source="netlab/transistors.py",
        formula="PMOS 版本：Vgs/Vds/Vbs 均取反（Vsg/|Vsd|/|Vbs|），Id 方向相反；三态与体效应公式同 nmos",
        notes="行为级；限值参数仅供参考",
        pins=MOSFET_PINS,
        presets=MOS_PRESETS_P,
    ),
}

__all__ = ["BipolarJunction", "PNP", "Mosfet", "PMOS", "BJT_SPECS"]
