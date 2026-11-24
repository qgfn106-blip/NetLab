"""P2-01：每 kind 的 element.stamp 与 descriptor 静态装配对拍。

证明 descriptor._assemble_matrices 收敛到单一 StampBuilder 后：
- 静态 A/E 装配与旧内联实现逐项相等（引用实现见 _reference_matrices）；
- 对电阻/开关/传感器/独立电压源/VCVS/VCCS，element.stamp 的 A 贡献与
  descriptor 静态装配逐项相等；
- 电容：descriptor 的 E 贡献等价于 element 交流 stamp 的 A 贡献除以 jω；
- 电感：descriptor 采用独立支路电流形式（A 关联项 + E[row,row]=-L），
  与 element 的伴随电导形式（二端、无支路）未知量布局不同，无法逐项统一，
  此处只对 descriptor 侧做参考对拍并如实说明（详见审计报告）。
"""
from __future__ import annotations

import numpy as np
import pytest

from netlab.core.compute.circuit import DescriptorModel
from netlab.core.compute.circuit.stamps import StampContext, stamp_laplacian
from netlab.core.model.scene import Scene


def _new() -> Scene:
    return Scene("circuit")


def _model(scene: Scene) -> DescriptorModel:
    return DescriptorModel.from_scene(scene)


def _element_matrix(model, element, *, mode="ac", omega=1000.0):
    size = model.index.size
    ctx = StampContext(
        A=np.zeros((size, size), dtype=complex),
        rhs=np.zeros(size, dtype=complex),
        index=model.index.node_index,
        solution=np.zeros(size, dtype=complex),
        dt=1.0e-6,
        time=0.0,
        iteration=0,
        mode=mode,
        omega=omega,
    )
    if getattr(element, "needs_branch", False):
        element.branch_index = model.index.branch_index[element.name]
    element.stamp(ctx)
    return ctx.A


def _reference_matrices(model) -> tuple[np.ndarray, np.ndarray]:
    """旧 _assemble_matrices 的字面重写（P2-01 前的内联实现），用于逐项对拍。"""
    index = model.index
    size = index.size
    A = np.zeros((size, size), dtype=float)
    E = np.zeros((size, size), dtype=float)

    def g_stamp(a, b, value):
        stamp_laplacian(A, index.node_index, a, b, float(value))

    for element in model.elements:
        kind = element.kind
        if kind == "resistor" or kind == "switch":
            g_stamp(element.a, element.b, element.conductance)
        elif kind == "capacitor":
            stamp_laplacian(E, index.node_index, element.a, element.b, float(element.capacitance))
        elif kind == "inductor":
            row = index.branch_index[element.name]
            ai = index.node_index.get(element.a)
            bi = index.node_index.get(element.b)
            if ai is not None:
                A[ai, row] += 1.0
                A[row, ai] += 1.0
            if bi is not None:
                A[bi, row] -= 1.0
                A[row, bi] -= 1.0
            E[row, row] -= float(element.inductance)
        elif kind == "sensor":
            for node in (element.a, element.b):
                pos = index.node_index.get(node)
                if pos is not None:
                    A[pos, pos] += 1.0e-12
        elif kind == "vsource":
            row = index.branch_index[element.name]
            ai = index.node_index.get(element.a)
            bi = index.node_index.get(element.b)
            if ai is not None:
                A[ai, row] += 1.0
                A[row, ai] += 1.0
            if bi is not None:
                A[bi, row] -= 1.0
                A[row, bi] -= 1.0
        elif kind == "vcvs":
            row = index.branch_index[element.name]
            ai = index.node_index.get(element.a)
            bi = index.node_index.get(element.b)
            if ai is not None:
                A[ai, row] += 1.0
                A[row, ai] += 1.0
            if bi is not None:
                A[bi, row] -= 1.0
                A[row, bi] -= 1.0
            ci = index.node_index.get(element.control_a)
            di = index.node_index.get(element.control_b)
            if ci is not None:
                A[row, ci] -= float(element.gain)
            if di is not None:
                A[row, di] += float(element.gain)
        elif kind == "vccs":
            gm = float(element.transconductance)
            ai = index.node_index.get(element.a)
            bi = index.node_index.get(element.b)
            ci = index.node_index.get(element.control_a)
            di = index.node_index.get(element.control_b)
            if ai is not None and ci is not None:
                A[ai, ci] += gm
            if ai is not None and di is not None:
                A[ai, di] -= gm
            if bi is not None and ci is not None:
                A[bi, ci] -= gm
            if bi is not None and di is not None:
                A[bi, di] += gm
        elif kind == "isource":
            continue
    return A, E


def _assert_equal(actual, expected):
    np.testing.assert_allclose(actual, expected, rtol=0.0, atol=0.0)


def _r_scene():
    s = _new(); g = s.add_node(name="g", kind="ground"); a = s.add_node(name="a", kind="node")
    s.add_edge(name="R1", source=a.id, target=g.id, kind="resistor", params={"R": 100.0})
    return s


def _sw_scene():
    s = _new(); g = s.add_node(name="g", kind="ground"); a = s.add_node(name="a", kind="node")
    s.add_edge(name="S1", source=a.id, target=g.id, kind="switch",
               params={"closed": True, "ron": 0.5, "roff": 1.0e6})
    return s


def _sensor_scene():
    s = _new(); g = s.add_node(name="g", kind="ground"); a = s.add_node(name="a", kind="node")
    s.add_edge(name="SEN1", source=a.id, target=g.id, kind="sensor", params={})
    return s


def _vsrc_scene():
    s = _new(); g = s.add_node(name="g", kind="ground"); a = s.add_node(name="a", kind="node")
    s.add_edge(name="V1", source=a.id, target=g.id, kind="vsource",
               params={"wave": "dc", "offset": 0.0, "amplitude": 1.0})
    return s


def _vcvs_scene():
    s = _new(); g = s.add_node(name="g", kind="ground")
    a = s.add_node(name="a", kind="node"); b = s.add_node(name="b", kind="node")
    s.add_edge(name="E1", source=b.id, target=g.id, kind="vcvs",
               params={"gain": 1.5, "control_source": a.id, "control_target": g.id})
    return s


def _vccs_scene():
    s = _new(); g = s.add_node(name="g", kind="ground")
    a = s.add_node(name="a", kind="node"); c = s.add_node(name="c", kind="node")
    s.add_edge(name="G1", source=c.id, target=g.id, kind="vccs",
               params={"gm": 0.002, "control_source": a.id, "control_target": g.id})
    return s


def _descriptor_a_e(scene):
    model = _model(scene)
    return model, model._assemble_matrices()


@pytest.mark.parametrize("factory,name", [
    (_r_scene, "R1"),
    (_sw_scene, "S1"),
    (_sensor_scene, "SEN1"),
])
def test_two_terminal_element_matches_descriptor(factory, name) -> None:
    model, (A, E) = _descriptor_a_e(factory())
    element = next(e for e in model.elements if e.name == name)
    A_el = _element_matrix(model, element, mode="tran")
    _assert_equal(A_el, A)
    _assert_equal(E, np.zeros_like(E))


@pytest.mark.parametrize("factory,name", [
    (_vsrc_scene, "V1"),
    (_vcvs_scene, "E1"),
    (_vccs_scene, "G1"),
])
def test_branch_or_controlled_element_a_matches_descriptor(factory, name) -> None:
    model, (A, E) = _descriptor_a_e(factory())
    element = next(e for e in model.elements if e.name == name)
    A_el = _element_matrix(model, element, mode="tran")
    _assert_equal(np.real(A_el), A)
    _assert_equal(E, np.zeros_like(E))


def test_capacitor_element_ac_equals_descriptor_e_scaled() -> None:
    s = _new(); g = s.add_node(name="g", kind="ground"); a = s.add_node(name="a", kind="node")
    s.add_edge(name="C1", source=a.id, target=g.id, kind="capacitor", params={"C": 2.0e-6})
    model, (A, E) = _descriptor_a_e(s)
    element = next(e for e in model.elements if e.name == "C1")
    omega = 1234.0
    A_el = _element_matrix(model, element, mode="ac", omega=omega)
    _assert_equal(A, np.zeros_like(A))
    _assert_equal(A_el, 1j * omega * E)


def test_inductor_descriptor_uses_branch_form() -> None:
    s = _new(); g = s.add_node(name="g", kind="ground"); a = s.add_node(name="a", kind="node")
    s.add_edge(name="L1", source=a.id, target=g.id, kind="inductor", params={"L": 1.0e-3})
    model, (A, E) = _descriptor_a_e(s)
    index = model.index
    row = index.branch_index["L1"]
    ai = index.node_index.get(a.id)
    assert E[row, row] == pytest.approx(-1.0e-3)
    if ai is not None:
        assert A[ai, row] == pytest.approx(1.0)
        assert A[row, ai] == pytest.approx(1.0)
    # element 侧为伴随电导（二端无支路），未知量布局不同，故不做 elementwise 对拍。


def _kitchen_sink_scene() -> Scene:
    s = _new()
    g = s.add_node(name="g", kind="ground")
    vin = s.add_node(name="vin", kind="node")
    a = s.add_node(name="a", kind="node")
    b = s.add_node(name="b", kind="node")
    c = s.add_node(name="c", kind="node")
    s.add_edge(name="V1", source=vin.id, target=g.id, kind="vsource",
               params={"wave": "dc", "offset": 0.0, "amplitude": 1.0})
    s.add_edge(name="R1", source=vin.id, target=a.id, kind="resistor", params={"R": 1000.0})
    s.add_edge(name="L1", source=a.id, target=b.id, kind="inductor", params={"L": 1.0e-3})
    s.add_edge(name="C1", source=b.id, target=g.id, kind="capacitor", params={"C": 1.0e-6})
    s.add_edge(name="SEN1", source=b.id, target=g.id, kind="sensor", params={})
    s.add_edge(name="E1", source=c.id, target=g.id, kind="vcvs",
               params={"gain": 1.2, "control_source": a.id, "control_target": g.id})
    s.add_edge(name="G1", source=c.id, target=g.id, kind="vccs",
               params={"gm": 0.001, "control_source": b.id, "control_target": g.id})
    s.add_edge(name="I1", source=b.id, target=g.id, kind="isource",
               params={"wave": "dc", "offset": 0.0, "amplitude": 1.0e-3})
    return s


def test_descriptor_assembly_equals_pre_refactor_reference() -> None:
    model = _model(_kitchen_sink_scene())
    A, E = model._assemble_matrices()
    A_ref, E_ref = _reference_matrices(model)
    _assert_equal(A, A_ref)
    _assert_equal(E, E_ref)
