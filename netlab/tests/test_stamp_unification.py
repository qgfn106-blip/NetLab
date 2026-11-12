"""P1-R1: zero-numerical-regression parity for the unified stamp primitive.

Stage 5 deliverable. Proves that converging the four duplicated two-terminal
Laplacian stamping sites onto :func:`stamps.stamp_laplacian` changes no number:

* element level -- the shared primitive is elementwise identical to a literal
  reproduction of the pre-convergence inline body, for real and complex
  weights and for every grounded-node pattern;
* Legacy entry point -- ``_stamp_conductance`` is a faithful delegate;
* element model -- ``Resistor.stamp`` still writes the same MNA matrix;
* whole circuit -- descriptor A/E matrices and the RC low-pass frequency
  response still match closed-form results;
* single source -- descriptor.py has no remaining inline Laplacian body.

See netlab/docs/P1_R1_STAMP_CONVERGENCE.md for the convergence plan.
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pytest

from netlab.core.compute.circuit import DescriptorModel
from netlab.core.compute.circuit import descriptor as descriptor_module
from netlab.core.compute.circuit.elements import Resistor
from netlab.core.compute.circuit.stamps import (
    StampContext,
    _stamp_conductance,
    stamp_laplacian,
)
from netlab.core.model.scene import Scene


def _reference(matrix, index, a, b, weight):
    """Literal reproduction of the pre-P1-R1 inline Laplacian body."""
    ai = index.get(a)
    bi = index.get(b)
    if ai is not None:
        matrix[ai, ai] += weight
    if bi is not None:
        matrix[bi, bi] += weight
    if ai is not None and bi is not None:
        matrix[ai, bi] -= weight
        matrix[bi, ai] -= weight


@pytest.mark.parametrize(
    "index,a,b",
    [
        ({"a": 0, "b": 1}, "a", "b"),
        ({"a": 0}, "a", "gnd"),
        ({"b": 1}, "gnd", "b"),
        ({}, "gnd", "gnd"),
        ({"a": 2, "b": 0, "c": 1}, "a", "c"),
    ],
)
@pytest.mark.parametrize("weight", [0.001, -3.25, 1e-6, 1j * 2.0e-3, 0.0])
def test_shared_primitive_matches_pre_convergence_body(index, a, b, weight):
    dtype = complex if isinstance(weight, complex) else float
    got = np.zeros((3, 3), dtype=dtype)
    want = np.zeros((3, 3), dtype=dtype)
    stamp_laplacian(got, index, a, b, weight)
    _reference(want, index, a, b, weight)
    np.testing.assert_array_equal(got, want)


def test_legacy_stamp_conductance_is_a_faithful_delegate():
    A = np.zeros((2, 2), dtype=float)
    ctx = StampContext(
        A=A,
        rhs=np.zeros(2),
        index={"a": 0, "b": 1},
        solution=np.zeros(2),
        dt=1e-4,
        time=0.0,
        iteration=0,
    )
    _stamp_conductance(ctx, "a", "b", 0.0025)
    expected = np.array([[0.0025, -0.0025], [-0.0025, 0.0025]])
    np.testing.assert_array_equal(A, expected)


def test_legacy_stamp_conductance_preserves_complex_ac_admittance():
    A = np.zeros((2, 2), dtype=complex)
    ctx = StampContext(
        A=A,
        rhs=np.zeros(2, dtype=complex),
        index={"a": 0, "b": 1},
        solution=np.zeros(2),
        dt=1e-4,
        time=0.0,
        iteration=0,
        mode="ac",
        omega=1000.0,
    )
    admittance = 1j * 1000.0 * 1.0e-6
    _stamp_conductance(ctx, "a", "b", admittance)
    np.testing.assert_array_equal(
        A, np.array([[admittance, -admittance], [-admittance, admittance]])
    )


def test_resistor_element_stamp_matches_shared_primitive():
    r = Resistor("R1", "a", "b", {"R": 470.0}, {})
    index = {"a": 0, "b": 1, "g": 2}
    A = np.zeros((3, 3), dtype=float)
    ctx = StampContext(
        A=A,
        rhs=np.zeros(3),
        index=index,
        solution=np.zeros(3),
        dt=1e-4,
        time=0.0,
        iteration=0,
    )
    r.stamp(ctx)
    expected = np.zeros((3, 3), dtype=float)
    stamp_laplacian(expected, index, "a", "b", 1.0 / 470.0)
    np.testing.assert_array_equal(A, expected)


def _rc_low_pass():
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    out = scene.add_node(name="out", kind="node")
    scene.add_edge(
        name="V1",
        source=vin.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": 0.0, "amplitude": 1.0},
    )
    scene.add_edge(
        name="R1", source=vin.id, target=out.id, kind="resistor", params={"R": 1000.0}
    )
    scene.add_edge(
        name="C1", source=out.id, target=gnd.id, kind="capacitor", params={"C": 1.0e-6}
    )
    return scene, vin, out


def test_descriptor_rc_low_pass_frequency_response_matches_analytic():
    scene, _, _ = _rc_low_pass()
    model = DescriptorModel.from_scene(scene)
    frequencies = [1.0, 10.0, 100.0, 1000.0, 10000.0]
    result = model.frequency_response(frequencies, input_source="V1", probes=["out"])
    omega = 2.0 * math.pi * np.asarray(frequencies)
    expected = 1.0 / (1.0 + 1j * omega * 1000.0 * 1.0e-6)
    probe = result["probes"]["out"]
    np.testing.assert_allclose(probe["real"], expected.real, rtol=1e-9, atol=1e-12)
    np.testing.assert_allclose(probe["imag"], expected.imag, rtol=1e-9, atol=1e-12)


def test_descriptor_rc_low_pass_E_matrix_is_single_capacitor_laplacian():
    scene, vin, out = _rc_low_pass()
    model = DescriptorModel.from_scene(scene)
    E_expected = np.zeros_like(model.E)
    # Grounded capacitor: only the out/out diagonal receives C.
    pos = model.index.node_index[out.id]
    E_expected[pos, pos] = 1.0e-6
    np.testing.assert_array_equal(model.E, E_expected)


def test_descriptor_rc_low_pass_A_matrix_resistor_block_unchanged():
    scene, vin, out = _rc_low_pass()
    model = DescriptorModel.from_scene(scene)
    pvin = model.index.node_index[vin.id]
    pout = model.index.node_index[out.id]
    g = 1.0 / 1000.0
    assert model.A[pvin, pvin] == pytest.approx(g)
    assert model.A[pout, pout] == pytest.approx(g)
    assert model.A[pvin, pout] == pytest.approx(-g)
    assert model.A[pout, pvin] == pytest.approx(-g)


def test_descriptor_floating_capacitor_E_has_off_diagonal_laplacian():
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    a = scene.add_node(name="a", kind="node")
    b = scene.add_node(name="b", kind="node")
    scene.add_edge(
        name="V1",
        source=vin.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": 0.0, "amplitude": 1.0},
    )
    scene.add_edge(
        name="R1", source=vin.id, target=a.id, kind="resistor", params={"R": 100.0}
    )
    scene.add_edge(
        name="C1", source=a.id, target=b.id, kind="capacitor", params={"C": 2.0e-6}
    )
    scene.add_edge(
        name="R2", source=b.id, target=gnd.id, kind="resistor", params={"R": 100.0}
    )
    model = DescriptorModel.from_scene(scene)
    pa = model.index.node_index[a.id]
    pb = model.index.node_index[b.id]
    C = 2.0e-6
    assert model.E[pa, pa] == pytest.approx(C)
    assert model.E[pb, pb] == pytest.approx(C)
    assert model.E[pa, pb] == pytest.approx(-C)
    assert model.E[pb, pa] == pytest.approx(-C)


def test_descriptor_has_no_inline_laplacian_body():
    source = Path(descriptor_module.__file__).read_text(encoding="utf-8")
    assert source.count("stamp_laplacian(") >= 3
    assert "E[ai, bi] -= capacitance" not in source
    assert "A[ai, bi] -= g" not in source
