"""阶段6 P1-R2 · B 支：descriptor.frequency_response 纯线性委托 canonical / 线性化非线性保留原生。

守护点：
- 纯线性（全部 kind ∈ CircuitSolver.AC_KINDS）→ 委托 canonical `_ac_bode`，数值须与直接 `ac_sweep` 逐点一致；
- 含 LINEARIZABLE_NONLINEAR_KINDS 且给定 operating_point → 必须保留原生线性化路径（不因切换后端回归）；
  `ac_backend="descriptor"` 与默认(legacy) 对非线性电路结果完全一致（均原生）。
"""

from __future__ import annotations

import math

import numpy as np

from netlab.core.compute.circuit import DescriptorModel
from netlab.core.compute.simulation import Simulation
from netlab.core.model.scene import Scene

_PROBE_KEYS = ("real", "imag", "magnitude", "phase_deg", "db")


def _rc() -> Scene:
    s = Scene("circuit")
    gnd = s.add_node(name="gnd", kind="ground")
    vin = s.add_node(name="vin", kind="node")
    out = s.add_node(name="out", kind="node")
    s.add_edge(name="V1", source=vin.id, target=gnd.id, kind="vsource",
               params={"wave": "dc", "offset": 0.0, "amplitude": 1.0})
    s.add_edge(name="R1", source=vin.id, target=out.id, kind="resistor", params={"R": 1000.0})
    s.add_edge(name="C1", source=out.id, target=gnd.id, kind="capacitor", params={"C": 1.0e-6})
    return s


def _diode() -> Scene:
    s = Scene("circuit")
    gnd = s.add_node(name="gnd", kind="ground")
    vin = s.add_node(name="vin", kind="node")
    out = s.add_node(name="out", kind="node")
    s.add_edge(name="V1", source=vin.id, target=gnd.id, kind="vsource",
               params={"wave": "dc", "offset": 0.7, "amplitude": 1.0})
    s.add_edge(name="R1", source=vin.id, target=out.id, kind="resistor", params={"R": 1000.0})
    s.add_edge(name="D1", source=out.id, target=gnd.id, kind="diode",
               params={"Is": 1e-14, "n": 1.0, "temperature": 300.0, "rs": 0.0})
    return s


def test_pure_linear_delegates_equals_ac_sweep():
    scene = _rc()
    freqs = [10.0, 100.0, 1000.0]
    delegated = DescriptorModel.from_scene(scene).frequency_response(
        freqs, input_source="V1", probes=["out"]
    )
    direct = Simulation(scene).ac_sweep(freqs, input_source="V1", probes=["out"])
    for key in _PROBE_KEYS:
        np.testing.assert_allclose(
            np.asarray(delegated["probes"]["out"][key], dtype=float),
            np.asarray(direct["probes"]["out"][key], dtype=float),
            rtol=1e-12, atol=0.0, err_msg=f"{key} 委托后与 ac_sweep 不一致",
        )
    assert delegated["omega_rad_s"] == [2.0 * math.pi * f for f in freqs]


def test_linearized_nonlinear_path_preserved():
    scene = _diode()
    op = scene.ensure_engine().solver.operating_point()
    model = DescriptorModel.from_scene(scene, operating_point=op)
    legacy = model.frequency_response([10.0, 1000.0], input_source="V1", probes=["out"])
    model.ac_backend = "descriptor"  # 强制原生后端
    native = model.frequency_response([10.0, 1000.0], input_source="V1", probes=["out"])
    for key in _PROBE_KEYS:
        np.testing.assert_allclose(
            np.asarray(legacy["probes"]["out"][key], dtype=float),
            np.asarray(native["probes"]["out"][key], dtype=float),
            rtol=0.0, atol=0.0, err_msg=f"非线性线性化回归：{key}",
        )
    assert all(v > 0.0 for v in legacy["probes"]["out"]["magnitude"])
