"""Phase D 元件契约：目录公式与实现一致、迟滞方向记忆、逻辑门电流、运放动态、MOS 三态。

这些用例锁定「元件行为模型 ↔ catalog 公式」的一致性（P1-03/P1-04/P1-05/
P1-06/P1-08/P1-12），防止文档公式再次漂移出实现。
"""

from __future__ import annotations

import numpy as np
import pytest

from netlab.core.compute.nodal import Comparator, OpAmp, StampContext, element_catalog
from netlab.core.model.scene import Scene
from netlab.core.compute.transistors import Mosfet


# ---------------------------------------------------------------------------
# 工具
# ---------------------------------------------------------------------------
def _ctx(solution, index: dict[str, int], dt: float = 1e-4) -> StampContext:
    size = len(solution)
    return StampContext(
        A=np.zeros((size, size)),
        rhs=np.zeros(size),
        index=index,
        solution=np.asarray(solution, dtype=float),
        dt=dt,
        time=0.0,
        iteration=0,
    )


def _formula(kind: str) -> str:
    for item in element_catalog():
        if item["kind"] == kind:
            return item["formula"]
    raise AssertionError(f"catalog 缺少 {kind}")


def _notes(kind: str) -> str:
    for item in element_catalog():
        if item["kind"] == kind:
            return item.get("notes", "")
    raise AssertionError(f"catalog 缺少 {kind}")


def node(scene: Scene, name: str, kind: str = "node"):
    return scene.add_node(name=name, kind=kind)


def voltage(scene: Scene, name: str) -> float:
    target = next(item for item in scene.nodes.values() if item.name == name)
    return float(target.data.get("voltage", 0.0))


# ---------------------------------------------------------------------------
# P1-12：目录公式必须描述真实执行路径
# ---------------------------------------------------------------------------
def test_catalog_formulas_track_implementation():
    diode = _formula("diode")
    assert "min(60" in diode and "__name__junction" in diode

    assert "softplus" in _formula("zener")
    assert "60·Vt" in _formula("led") or "限幅" in _formula("led")

    # P1-05：BJT 是分段线性，不再宣称指数模型。
    npn = _formula("npn")
    assert "分段线性" in npn and "rin" in npn and "e^{" not in npn
    assert "Vbe(on)" in npn

    # P1-06：三态 + 沟道长度调制 + 体效应。
    nmos = _formula("nmos")
    for token in ("Vov", "线性区", "饱和区", "λ", "γ", "Vbs"):
        assert token in nmos, token
    assert "三态与体效应" in _formula("pmos")

    # P1-03：数字口径的迟滞（±hys/2 双阈值）。
    assert "off = +hys/2" in _formula("comparator")
    assert "回差方向记忆" in _notes("comparator")

    # P1-08：运放动态参数可见。
    assert "tanh" in _formula("opamp")
    assert "slew_rate" in _notes("opamp") and "gbw" in _notes("opamp")


# ---------------------------------------------------------------------------
# P1-03：比较器迟滞带回差方向记忆
# ---------------------------------------------------------------------------
def _comparator(hysteresis: float) -> Comparator:
    return Comparator(
        "CMP",
        "out",
        "gnd",
        {
            "gain": 1.0e5,
            "vmax": 15.0,
            "vp": "in",
            "vn": "gnd",
            "hysteresis": hysteresis,
        },
        {},
    )


def _comparator_output(element: Comparator, u: float) -> float:
    element.prepare(1e-4, 0.0)
    ctx = _ctx([0.0, u, 0.0], {"out": 0, "in": 1, "gnd": 2})
    value, _ = element._f(ctx, u)
    return float(value)


def test_comparator_hysteresis_remembers_direction():
    cmp = _comparator(1.0)
    # 未判定方向时阈值在 0。
    assert _comparator_output(cmp, 0.2) > 1.0
    assert _comparator_output(cmp, -0.2) < -1.0

    # 输出为高（level=+1）：只有 u 跌到 −hys/2 以下才翻低。
    cmp.state["hys_level"] = 1
    assert _comparator_output(cmp, 0.2) > 1.0
    assert _comparator_output(cmp, -0.8) < -1.0

    # 输出为低（level=−1）：只有 u 升到 +hys/2 以上才翻高。
    cmp.state["hys_level"] = -1
    assert _comparator_output(cmp, -0.2) < -1.0
    assert _comparator_output(cmp, 0.8) > 1.0


def test_comparator_without_hysteresis_matches_ideal():
    cmp = _comparator(0.0)
    cmp.state["hys_level"] = 1  # hys=0 时方向记忆不影响阈值
    assert _comparator_output(cmp, 0.2) > 1.0
    assert _comparator_output(cmp, -0.2) < -1.0


def test_comparator_commit_sets_direction():
    cmp = _comparator(1.0)
    ctx = _ctx([15.0, 0.5, 0.0], {"out": 0, "in": 1, "gnd": 2})
    cmp.commit(ctx)
    assert cmp.state["hys_level"] == 1
    ctx = _ctx([-15.0, -0.5, 0.0], {"out": 0, "in": 1, "gnd": 2})
    cmp.commit(ctx)
    assert cmp.state["hys_level"] == -1


def test_comparator_schmitt_thresholds_in_circuit():
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    src = node(scene, "src")
    out = node(scene, "out")
    scene.add_edge(
        name="V1",
        source=src.id,
        target=gnd.id,
        kind="vsource",
        params={
            "wave": "triangle",
            "offset": 0.0,
            "amplitude": 1.0,
            "frequency": 10.0,
            "phase": 0.0,
        },
    )
    scene.add_edge(
        name="CMP",
        source=out.id,
        target=gnd.id,
        kind="comparator",
        params={
            "gain": 1.0e5,
            "vmax": 15.0,
            "hysteresis": 1.0,
            "vp": src.id,
            "vn": gnd.id,
        },
    )
    rising: list[float] = []
    falling: list[float] = []
    previous = None
    for _ in range(2400):  # 三角波 10 Hz，2.4 个周期
        scene.step(1e-4)
        u = voltage(scene, "src")
        level = 1 if voltage(scene, "out") > 0.0 else -1
        if previous is not None and level != previous:
            (rising if level > 0 else falling).append(u)
        previous = level
    # 首个周期从冷启动（未判定方向）开始，只看后沿。
    assert rising and falling
    assert all(0.35 < u < 0.65 for u in rising[-1:])
    assert all(-0.65 < u < -0.35 for u in falling[-1:])


# ---------------------------------------------------------------------------
# P1-04：逻辑门电流/功率不再恒为 0
# ---------------------------------------------------------------------------
def test_logic_gate_reports_branch_current():
    scene = Scene("circuit")
    gnd = node(scene, "gnd", "ground")
    vdd = node(scene, "vdd")
    a = node(scene, "a")
    b = node(scene, "b")
    out = node(scene, "out")
    scene.add_edge(
        name="VDD",
        source=vdd.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": 5.0},
    )
    scene.add_edge(
        name="VA",
        source=a.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": 5.0},
    )
    scene.add_edge(
        name="VB",
        source=b.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": 5.0},
    )
    scene.add_edge(
        name="G1",
        source=out.id,
        target=gnd.id,
        kind="and_gate",
        params={
            "in_a": a.id,
            "in_b": b.id,
            "vdd_node": vdd.id,
            "vth": 2.5,
            "ron": 50.0,
            "slope": 10.0,
        },
    )
    scene.add_edge(
        name="RD", source=out.id, target=gnd.id, kind="resistor", params={"R": 1000.0}
    )
    for _ in range(6):
        scene.step(1e-4)
    probes = scene.probes()
    out_voltage = probes["n:out:voltage"]
    current = probes["e:G1:current"]
    # 输出高时电流经上管从输出端流向 VDD：(vout−5)/Ron。
    assert current == pytest.approx((out_voltage - 5.0) / 50.0, rel=0.05, abs=1e-5)
    assert abs(current) > 1e-5
    assert probes["e:G1:power"] >= 0.0


# ---------------------------------------------------------------------------
# P1-06：MOS 三态 + λ + 体效应
# ---------------------------------------------------------------------------
def _mosfet(**params) -> Mosfet:
    base = {"k": 0.001, "Vth": 2.0, "gate_node": "g"}
    base.update(params)
    return Mosfet("M", "d", "s", base, {})


def _mos_op(element: Mosfet, vd: float, vs: float, vg: float, vb: float = 0.0):
    element.prepare(1e-4, 0.0)
    index = {"d": 0, "s": 1, "g": 2, "b": 3}
    ctx = _ctx([vd, vs, vg, vb], index)
    return ctx, element._operating_point(ctx)


def test_mosfet_triode_region_and_gm():
    mos = _mosfet()
    _, (current, gm, gds, _, vgs, vds, _) = _mos_op(mos, 0.5, 0.0, 5.0)
    assert vgs == pytest.approx(5.0) and vds == pytest.approx(0.5)
    assert current == pytest.approx(0.001 * (3.0 * 0.5 - 0.125))
    assert gm == pytest.approx(0.001 * 0.5)
    assert gds == pytest.approx(0.001 * (3.0 - 0.5))


def test_mosfet_saturation_region():
    mos = _mosfet()
    _, (current, gm, gds, _, _, vds, _) = _mos_op(mos, 4.0, 0.0, 5.0)
    assert vds == pytest.approx(4.0)
    assert current == pytest.approx(0.5 * 0.001 * 9.0)
    assert gm == pytest.approx(0.001 * 3.0)
    assert gds == pytest.approx(0.0)


def test_mosfet_channel_length_modulation():
    mos = _mosfet(**{"lambda": 0.1})
    _, (current, gm, gds, _, _, _, _) = _mos_op(mos, 4.0, 0.0, 5.0)
    assert current == pytest.approx(0.5 * 0.001 * 9.0 * 1.4)
    assert gm == pytest.approx(0.001 * 3.0 * 1.4)
    assert gds == pytest.approx(0.5 * 0.001 * 9.0 * 0.1)


def test_mosfet_body_effect_reduces_current():
    mos = _mosfet(gamma=0.5, phi=0.7, body_node="b")
    ctx, (current, gm, _, gmbs, _, _, vbs) = _mos_op(mos, 4.0, 0.0, 5.0, -2.0)
    assert vbs == pytest.approx(-2.0)
    vth = 2.0 + 0.5 * (np.sqrt(0.7 + 2.0) - np.sqrt(0.7))
    over = 5.0 - vth
    assert current == pytest.approx(0.5 * 0.001 * over * over)
    assert gm == pytest.approx(0.001 * over)
    # Vbs 越负 → 阈值越高 → 电流越小；∂Id/∂Vbs 为正（gmbs 与 gm 同号约定）。
    assert gmbs == pytest.approx(gm * 0.5 / (2.0 * np.sqrt(2.7)), rel=1e-6)


def test_mosfet_off_region():
    mos = _mosfet()
    _, op = _mos_op(mos, 4.0, 0.0, 1.0)
    assert op[0] == 0.0 and op[1] == 0.0 and op[2] == 0.0


# ---------------------------------------------------------------------------
# P1-08：运放压摆率 / 带宽
# ---------------------------------------------------------------------------
def _opamp(**params) -> OpAmp:
    base = {"gain": 1.0e6, "vmax": 15.0}
    base.update(params)
    return OpAmp("OA", "out", "gnd", base, {})


def _opamp_output(element: OpAmp, u: float) -> float:
    ctx = _ctx([0.0, u, 0.0], {"out": 0, "in": 1, "gnd": 2})
    value, _ = element._f(ctx, u)
    return float(value)


def test_opamp_without_dynamic_params_is_ideal():
    oa = _opamp()
    oa.prepare(1e-4, 0.0)
    assert _opamp_output(oa, 0.1) == pytest.approx(15.0)


def test_opamp_slew_rate_limits_step():
    oa = _opamp(slew_rate=1.0e4)  # 1e4 V/s × 1e-4 s = 1 V/步
    oa.prepare(1e-4, 0.0)
    assert _opamp_output(oa, 10.0) == pytest.approx(1.0)
    oa.state["vout"] = 14.5
    assert _opamp_output(oa, 10.0) == pytest.approx(15.0)


def test_opamp_gain_bandwidth_smooths_step():
    oa = _opamp(gbw=1.0e3)
    oa.prepare(1e-4, 0.0)
    value = _opamp_output(oa, 10.0)
    alpha = -np.expm1(-1e-4 * 2.0 * np.pi * 1.0e3)
    assert value == pytest.approx(15.0 * alpha)
    assert 0.0 < value < 15.0
