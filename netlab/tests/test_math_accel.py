"""R43/M1b 数学加速器测试：开关、Woodbury 对拍与 AC 扫频影子模式。"""

from __future__ import annotations

import math

import numpy as np
import pytest

from netlab.core.compute.math_accel.config import math_accel_mode
from netlab.core.compute.math_accel.diagnostics import reset as reset_diagnostics
from netlab.core.compute.math_accel.diagnostics import snapshot
from netlab.core.compute.math_accel.woodbury_ac import ACWoodburySolver, ReactiveStamp
from netlab.core.compute.simulation import Simulation
from netlab.core.model.scene import Scene


def _rc_ladder(parts: int = 40, cap_every: int = 4) -> Scene:
    """RC 梯形网络：R 串联链，每 cap_every 个节点一只对地电容。"""
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    previous = None
    first = None
    for index in range(parts + 1):
        node = scene.add_node(name=f"n{index}", kind="node")
        if first is None:
            first = node
        if previous is not None:
            scene.add_edge(
                name=f"R{index}",
                source=previous.id,
                target=node.id,
                kind="resistor",
                params={"R": 100.0},
            )
        if index % cap_every == 0 and index > 0:
            scene.add_edge(
                name=f"C{index}",
                source=node.id,
                target=gnd.id,
                kind="capacitor",
                params={"C": 1.0e-6},
            )
        previous = node
    assert first is not None
    scene.add_edge(
        name="V1",
        source=first.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": 0.0, "amplitude": 1.0},
    )
    return scene


def test_math_accel_mode_default_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("NETLAB_MATH_ACCEL", raising=False)
    monkeypatch.delenv("NETLAB_MATH_ACCEL_P3", raising=False)
    assert math_accel_mode() == "off"
    assert math_accel_mode("P3") == "off"


def test_math_accel_mode_component_override_and_invalid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("NETLAB_MATH_ACCEL", "shadow")
    monkeypatch.setenv("NETLAB_MATH_ACCEL_P3", "on")
    assert math_accel_mode("P3") == "on"
    assert math_accel_mode("P1") == "shadow"
    monkeypatch.setenv("NETLAB_MATH_ACCEL", "bogus")
    assert math_accel_mode() == "off"


def test_synthetic_woodbury_matches_dense() -> None:
    rng = np.random.default_rng(7)
    size = 60
    base = rng.normal(size=(size, size)) + 1j * rng.normal(size=(size, size))
    base = base + base.T + 20.0 * np.eye(size)
    stamps = [
        ReactiveStamp(name=f"C{i}", a=i, b=i + 1, kind="C", value=1.0e-6 * (i + 1))
        for i in range(8)
    ]
    solver = ACWoodburySolver(base, stamps, omega0=2.0 * math.pi * 1.0e3)
    assert solver.usable, solver.reason
    rhs = rng.normal(size=size) + 1j * rng.normal(size=size)
    for frequency in (10.0, 100.0, 1.0e3, 1.0e4, 1.0e5):
        omega = 2.0 * math.pi * frequency
        dense = base.copy()
        for stamp in stamps:
            vector = stamp.vector(size)
            dense += stamp.conductance(omega) * np.outer(vector, vector)
        expected = np.linalg.solve(dense, rhs)
        actual = solver.solve(omega, rhs)
        np.testing.assert_allclose(actual, expected, rtol=1e-10, atol=1e-12)


def test_ratio_gate_blocks_large_reactive_fraction() -> None:
    size = 6
    base = np.eye(size, dtype=complex) * 10.0
    stamps = [
        ReactiveStamp(name=f"C{i}", a=i, b=None, kind="C", value=1.0e-6)
        for i in range(size)
    ]
    solver = ACWoodburySolver(base, stamps, omega0=1.0e3)
    assert not solver.usable
    assert "max_ratio" in solver.reason


def test_ac_sweep_modes_agree() -> None:
    frequencies = [10.0, 100.0, 1.0e3, 1.0e4, 1.0e5]
    reset_diagnostics()
    off = Simulation(_rc_ladder(parts=200, cap_every=10)).ac_sweep(
        frequencies, probes=["n200"]
    )
    assert snapshot()["counters"] == {}
    import os

    os.environ["NETLAB_MATH_ACCEL"] = "shadow"
    try:
        shadow = Simulation(_rc_ladder(parts=200, cap_every=10)).ac_sweep(
            frequencies, probes=["n200"]
        )
        counters = snapshot()["counters"]
        assert counters.get("p3.shadow", 0) >= 1
    finally:
        os.environ.pop("NETLAB_MATH_ACCEL", None)
    reset_diagnostics()
    os.environ["NETLAB_MATH_ACCEL"] = "on"
    try:
        on = Simulation(_rc_ladder(parts=200, cap_every=10)).ac_sweep(
            frequencies, probes=["n200"]
        )
        counters = snapshot()["counters"]
        assert counters.get("p3.used", 0) >= 1
    finally:
        os.environ.pop("NETLAB_MATH_ACCEL", None)
    for mode_result in (shadow, on):
        np.testing.assert_allclose(
            mode_result["probes"]["n200"]["magnitude"],
            off["probes"]["n200"]["magnitude"],
            rtol=1e-9,
            atol=1e-12,
        )
        off_magnitude = np.asarray(off["probes"]["n200"]["magnitude"])
        mask = off_magnitude > max(1.0, float(off_magnitude.max())) * 1.0e-9
        np.testing.assert_allclose(
            np.asarray(mode_result["probes"]["n200"]["phase_deg"])[mask],
            np.asarray(off["probes"]["n200"]["phase_deg"])[mask],
            atol=1e-8,
        )


def test_small_matrix_skips_woodbury(monkeypatch: pytest.MonkeyPatch) -> None:
    """n<160 时 on 路径必须直接退回稠密解，不产生 Woodbury 记录。"""
    monkeypatch.setenv("NETLAB_MATH_ACCEL", "on")
    reset_diagnostics()
    result = Simulation(_rc_ladder(parts=50, cap_every=10)).ac_sweep(
        [10.0, 100.0, 1.0e3], probes=["n50"]
    )
    counters = snapshot()["counters"]
    assert counters.get("p3.used", 0) == 0
    assert len(result["probes"]["n50"]["magnitude"]) == 3
