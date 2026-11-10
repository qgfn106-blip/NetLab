"""M3：Descriptor 非线性器件工作点线性化测试。

解析导数测试用中心差分仅作参考；小信号极限测试用同一电路在不同直流偏置
下的工作点差分对照描述符 AC 结果。实现本身不依赖有限差分。
"""

from __future__ import annotations

import numpy as np
import pytest

from netlab.core.common.limits import ComputeError, ValidationError
from netlab.core.compute.circuit import DescriptorModel
from netlab.core.compute.circuit.elements import CircuitElement, Diode
from netlab.core.compute.circuit.stamps import CircuitNode, StampContext
from netlab.core.compute.transistors import BipolarJunction, Mosfet
from netlab.core.model.scene import Scene


# ---------------------------------------------------------------------------
# 场景与工具
# ---------------------------------------------------------------------------


def _dc(scene: Scene, name: str, a, b, value: float):
    return scene.add_edge(
        name=name,
        source=a.id,
        target=b.id,
        kind="vsource",
        params={"wave": "dc", "offset": value, "amplitude": 0.0},
    )


def _resistor(scene: Scene, name: str, a, b, value: float):
    return scene.add_edge(
        name=name, source=a.id, target=b.id, kind="resistor", params={"R": value}
    )


def _node_voltage(operating_point: dict, scene: Scene, name: str) -> float:
    target = next(item for item in scene.nodes.values() if item.name == name)
    values = operating_point["node_voltages"]
    if target.id in values:
        return float(values[target.id])
    return float(values[name])


def _model_from_scene(scene: Scene) -> tuple[DescriptorModel, dict]:
    engine = scene.ensure_engine()
    operating_point = engine.operating_point()
    model = DescriptorModel.from_operating_point(
        engine.solver.nodes, engine.solver.elements, operating_point
    )
    return model, operating_point


def _ac_gain(model: DescriptorModel, probe: str = "out") -> float:
    data = model.frequency_response([1.0], input_source="V1", probes=[probe])
    return float(data["probes"][probe]["real"][0])


def _diode_scene(offset: float, series_resistance: float = 5.0) -> Scene:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    out = scene.add_node(name="out", kind="node")
    _dc(scene, "V1", vin, gnd, offset)
    _resistor(scene, "R1", vin, out, 100.0)
    scene.add_edge(
        name="D1",
        source=out.id,
        target=gnd.id,
        kind="diode",
        params={
            "Is": 1.0e-9,
            "n": 1.0,
            "temperature": 300.0,
            "rs": series_resistance,
        },
    )
    return scene


def _diode_cathode_bias_scene(offset: float) -> Scene:
    """带串联电阻的二极管，其阴极接在非零电位（检查内部节点换算）。"""
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    out = scene.add_node(name="out", kind="node")
    cathode = scene.add_node(name="cathode", kind="node")
    _dc(scene, "V1", vin, gnd, offset)
    _dc(scene, "V2", cathode, gnd, 0.5)
    _resistor(scene, "R1", vin, out, 100.0)
    scene.add_edge(
        name="D1",
        source=out.id,
        target=cathode.id,
        kind="diode",
        params={
            "Is": 1.0e-9,
            "n": 1.0,
            "temperature": 300.0,
            "rs": 5.0,
        },
    )
    return scene


def _bjt_scene(offset: float) -> Scene:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vcc = scene.add_node(name="vcc", kind="node")
    base = scene.add_node(name="base", kind="node")
    coll = scene.add_node(name="coll", kind="node")
    _dc(scene, "VCC", vcc, gnd, 5.0)
    _dc(scene, "V1", base, gnd, offset)
    _resistor(scene, "RC", vcc, coll, 100.0)
    scene.add_edge(
        name="Q1",
        source=coll.id,
        target=gnd.id,
        kind="npn",
        params={
            "Is": 1.0e-14,
            "n": 1.0,
            "temperature": 300.0,
            "beta": 100.0,
            "base_node": base.id,
            "rin": 1000.0,
            "vbe_on": 0.7,
        },
    )
    return scene


def _mos_scene(offset: float) -> Scene:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vdd = scene.add_node(name="vdd", kind="node")
    gate = scene.add_node(name="gate", kind="node")
    drain = scene.add_node(name="drain", kind="node")
    _dc(scene, "VDD", vdd, gnd, 5.0)
    _dc(scene, "V1", gate, gnd, offset)
    _resistor(scene, "RD", vdd, drain, 1000.0)
    scene.add_edge(
        name="M1",
        source=drain.id,
        target=gnd.id,
        kind="nmos",
        params={"k": 1.0e-3, "Vth": 1.0, "gate_node": gate.id},
    )
    return scene


def _opamp_scene() -> Scene:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    vn = scene.add_node(name="vn", kind="node")
    out = scene.add_node(name="out", kind="node")
    _dc(scene, "V1", vin, gnd, 0.0)
    _resistor(scene, "R1", vin, vn, 1000.0)
    _resistor(scene, "R2", vn, out, 10000.0)
    scene.add_edge(
        name="OP1",
        source=out.id,
        target=gnd.id,
        kind="opamp",
        params={"vp": gnd.id, "vn": vn.id, "gain": 1.0e5, "vmax": 15.0},
    )
    return scene


def _mos_context(
    vg: float, vd: float, vs: float = 0.0, vb: float = 0.0
) -> StampContext:
    return StampContext(
        A=np.zeros((4, 4)),
        rhs=np.zeros(4),
        index={"g": 0, "d": 1, "s": 2, "b": 3},
        solution=np.array([vg, vd, vs, vb], dtype=float),
        dt=0.0,
        time=0.0,
        iteration=0,
        mode="dc",
    )


# ---------------------------------------------------------------------------
# 解析导数对照（有限差分只作参考）
# ---------------------------------------------------------------------------


def test_diode_conductance_matches_central_difference() -> None:
    diode = Diode(
        "D",
        "a",
        "b",
        {"Is": 1.0e-12, "n": 1.2, "temperature": 300.0},
        {},
    )
    step = 1.0e-7
    for vd in (0.0, 0.1, 0.4, 0.6):
        _, conductance = diode._conductance(vd)
        finite_difference = (
            diode._conductance(vd + step)[0] - diode._conductance(vd - step)[0]
        ) / (2.0 * step)
        assert conductance == pytest.approx(finite_difference, rel=1.0e-5)


def test_bjt_junction_derivative_matches_central_difference() -> None:
    bjt = BipolarJunction(
        "Q",
        "c",
        "e",
        {
            "Is": 1.0e-14,
            "n": 1.0,
            "temperature": 300.0,
            "beta": 100.0,
            "base_node": "b",
            "rin": 1000.0,
        },
        {},
    )
    step = 1.0e-7
    for vbe in (0.5, 0.75):
        _, conductance = bjt._junction(vbe)
        finite_difference = (
            bjt._junction(vbe + step)[0] - bjt._junction(vbe - step)[0]
        ) / (2.0 * step)
        assert conductance == pytest.approx(finite_difference, rel=1.0e-6)


def test_mosfet_operating_point_derivatives_match_central_difference() -> None:
    mosfet = Mosfet(
        "M",
        "d",
        "s",
        {
            "k": 1.0e-3,
            "Vth": 1.0,
            "lambda": 0.02,
            "gamma": 0.1,
            "phi": 0.7,
            "gate_node": "g",
            "body_node": "b",
        },
        {},
    )
    step = 1.0e-5

    def current(vg: float, vd: float, vb: float = 0.0) -> float:
        return mosfet._operating_point(_mos_context(vg, vd, 0.0, vb))[0]

    for vd in (0.2, 3.0):
        _, gm, gds, _, _, _, _ = mosfet._operating_point(
            _mos_context(1.5, vd, 0.0, 0.0)
        )
        gm_fd = (current(1.5 + step, vd) - current(1.5 - step, vd)) / (2.0 * step)
        gds_fd = (current(1.5, vd + step) - current(1.5, vd - step)) / (
            2.0 * step
        )
        assert gm == pytest.approx(gm_fd, rel=1.0e-5)
        assert gds == pytest.approx(gds_fd, rel=1.0e-5)

    # 体效应：背栅跨导
    _, _, _, gmbs, _, _, _ = mosfet._operating_point(_mos_context(1.5, 3.0, 0.0, -0.5))
    gmbs_fd = (
        current(1.5, 3.0, -0.5 + step) - current(1.5, 3.0, -0.5 - step)
    ) / (2.0 * step)
    assert gmbs == pytest.approx(gmbs_fd, rel=1.0e-5)


# ---------------------------------------------------------------------------
# 小信号极限：描述符 AC 结果 vs 工作点有限差分
# ---------------------------------------------------------------------------


def test_diode_small_signal_limit_with_series_resistance() -> None:
    model, _ = _model_from_scene(_diode_scene(0.4))
    assert "__D1__junction" in model.index.node_index

    gain = _ac_gain(model)
    step = 1.0e-4
    high_scene = _diode_scene(0.4 + step)
    low_scene = _diode_scene(0.4 - step)
    high = _node_voltage(high_scene.ensure_engine().operating_point(), high_scene, "out")
    low = _node_voltage(low_scene.ensure_engine().operating_point(), low_scene, "out")
    finite_difference = (high - low) / (2.0 * step)
    assert gain == pytest.approx(finite_difference, rel=2.0e-3, abs=1.0e-6)


def test_diode_series_resistance_with_nonzero_cathode() -> None:
    model, _ = _model_from_scene(_diode_cathode_bias_scene(1.0))
    assert "__D1__junction" in model.index.node_index

    gain = _ac_gain(model)
    step = 1.0e-4
    high_scene = _diode_cathode_bias_scene(1.0 + step)
    low_scene = _diode_cathode_bias_scene(1.0 - step)
    high = _node_voltage(
        high_scene.ensure_engine().operating_point(), high_scene, "out"
    )
    low = _node_voltage(
        low_scene.ensure_engine().operating_point(), low_scene, "out"
    )
    finite_difference = (high - low) / (2.0 * step)
    assert gain == pytest.approx(finite_difference, rel=2.0e-3, abs=1.0e-6)


def test_mosfet_common_source_small_signal_limit() -> None:
    model, _ = _model_from_scene(_mos_scene(1.5))
    gain = _ac_gain(model, "drain")

    step = 1.0e-4
    high_scene = _mos_scene(1.5 + step)
    low_scene = _mos_scene(1.5 - step)
    high = _node_voltage(high_scene.ensure_engine().operating_point(), high_scene, "drain")
    low = _node_voltage(low_scene.ensure_engine().operating_point(), low_scene, "drain")
    finite_difference = (high - low) / (2.0 * step)
    assert gain == pytest.approx(finite_difference, rel=2.0e-3, abs=1.0e-6)


def test_bjt_common_emitter_small_signal_limit() -> None:
    model, _ = _model_from_scene(_bjt_scene(0.75))
    gain = _ac_gain(model, "coll")

    step = 1.0e-4
    high_scene = _bjt_scene(0.75 + step)
    low_scene = _bjt_scene(0.75 - step)
    high = _node_voltage(high_scene.ensure_engine().operating_point(), high_scene, "coll")
    low = _node_voltage(low_scene.ensure_engine().operating_point(), low_scene, "coll")
    finite_difference = (high - low) / (2.0 * step)
    assert gain == pytest.approx(finite_difference, rel=2.0e-3, abs=1.0e-6)


def test_opamp_inverting_amplifier_is_linearized() -> None:
    model, _ = _model_from_scene(_opamp_scene())
    assert "OP1" in model.index.opamp_index
    assert _ac_gain(model) == pytest.approx(-10.0, rel=2.0e-4)


# ---------------------------------------------------------------------------
# 错误与边界
# ---------------------------------------------------------------------------


def test_descriptor_still_rejects_nonlinear_without_operating_point() -> None:
    scene = _diode_scene(0.4)
    engine = scene.ensure_engine()
    with pytest.raises(ComputeError, match="不支持非线性元件"):
        DescriptorModel(engine.solver.nodes, engine.solver.elements)


def test_linearization_requires_all_node_voltages() -> None:
    scene = _diode_scene(0.4)
    engine = scene.ensure_engine()
    with pytest.raises(ComputeError, match="工作点缺少节点电压"):
        DescriptorModel.from_operating_point(
            engine.solver.nodes,
            engine.solver.elements,
            {"gnd": 0.0},
        )


def test_linearization_rejects_unsupported_nonlinear_kind() -> None:
    class Unsupported(CircuitElement):
        kind = "jfet"
        nonlinear = True

    nodes = [
        CircuitNode("gnd", "gnd", ground=True),
        CircuitNode("a", "a"),
        CircuitNode("b", "b"),
    ]
    element = Unsupported("X", "a", "b", {}, {})
    with pytest.raises(ComputeError, match="无法线性化元件"):
        DescriptorModel.from_operating_point(nodes, [element], {"a": 0.0, "b": 0.0})


def test_linearize_accepts_node_names_and_is_repeatable() -> None:
    scene = _diode_scene(0.4)
    engine = scene.ensure_engine()
    operating_point = engine.operating_point()
    by_name = {
        node.name: operating_point["node_voltages"][node.name]
        for node in scene.nodes.values()
        if getattr(node, "kind", None) != "ground"
        and node.name in operating_point["node_voltages"]
    }
    model = DescriptorModel.from_operating_point(
        engine.solver.nodes, engine.solver.elements, by_name
    )
    first = _ac_gain(model)
    model.linearize(by_name)
    assert _ac_gain(model) == pytest.approx(first, rel=1.0e-12)


def test_linearize_rejects_non_mapping_operating_point() -> None:
    scene = _diode_scene(0.4)
    engine = scene.ensure_engine()
    with pytest.raises(ValidationError):
        DescriptorModel.from_operating_point(
            engine.solver.nodes, engine.solver.elements, None  # type: ignore[arg-type]
        )
    model, _ = _model_from_scene(scene)
    with pytest.raises(ValidationError):
        model.linearize(None)  # type: ignore[arg-type]
