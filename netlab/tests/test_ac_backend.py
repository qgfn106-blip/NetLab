"""P2-02：AC 扫频后端策略（fast / native / 强制 native）对拍与策略选择。

验证同一线性电路在三条路径下 Bode 幅相逐点一致，且策略选择符合预期：
- FastLinearStrategy：纯线性委托 canonical solver 快速核；
- NativePerFrequencyStrategy：描述符原生逐频点重建求解；
- ac_backend="descriptor"：强制原生。
并验证非线性元件（kind ∉ AC_KINDS）自动选择原生后端。
"""
from __future__ import annotations

import math
from types import SimpleNamespace

import numpy as np

from netlab.core.compute.circuit import DescriptorModel
from netlab.core.compute.circuit.ac_backend import (
    FastLinearStrategy,
    NativePerFrequencyStrategy,
    ac_sweep,
    select_strategy,
)
from netlab.core.model.scene import Scene

FREQS = [10.0, 100.0, 1000.0, 10000.0]


def _series_rlc() -> Scene:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    mid = scene.add_node(name="mid", kind="node")
    out = scene.add_node(name="out", kind="node")
    scene.add_edge(
        name="V1", source=vin.id, target=gnd.id, kind="vsource",
        params={"wave": "dc", "offset": 0.0, "amplitude": 1.0},
    )
    scene.add_edge(name="R1", source=vin.id, target=mid.id, kind="resistor", params={"R": 1000.0})
    scene.add_edge(name="L1", source=mid.id, target=out.id, kind="inductor", params={"L": 1.0e-3})
    scene.add_edge(name="C1", source=out.id, target=gnd.id, kind="capacitor", params={"C": 1.0e-6})
    return scene


def _assert_bode_equal(a: dict, b: dict, probe: str) -> None:
    for key in ("real", "imag", "magnitude", "db"):
        np.testing.assert_allclose(
            np.asarray(a["probes"][probe][key], dtype=float),
            np.asarray(b["probes"][probe][key], dtype=float),
            rtol=1e-8, atol=1e-12,
            err_msg=f"{key} 不一致",
        )


def test_fast_native_forced_three_way_parity() -> None:
    scene = _series_rlc()
    model = DescriptorModel.from_scene(scene)
    fast = ac_sweep(model, FREQS, input_source="V1", probes=["out"], strategy=FastLinearStrategy())
    native = ac_sweep(model, FREQS, input_source="V1", probes=["out"], strategy=NativePerFrequencyStrategy())

    forced_model = DescriptorModel.from_scene(scene)
    forced_model.ac_backend = "descriptor"
    forced = ac_sweep(forced_model, FREQS, input_source="V1", probes=["out"])

    default = model.frequency_response(FREQS, input_source="V1", probes=["out"])

    assert fast["strategy"] == "fast"
    assert native["strategy"] == "native"
    assert forced["strategy"] == "native"
    assert default["strategy"] == "fast"

    _assert_bode_equal(fast, native, "out")
    _assert_bode_equal(fast, forced, "out")
    _assert_bode_equal(fast, default, "out")
    np.testing.assert_allclose(
        np.asarray(fast["omega_rad_s"], dtype=float),
        2.0 * math.pi * np.asarray(FREQS, dtype=float),
        rtol=0, atol=0,
    )


def test_select_strategy_linear_fast() -> None:
    model = DescriptorModel.from_scene(_series_rlc())
    assert isinstance(select_strategy(model), FastLinearStrategy)


def test_select_strategy_forced_native() -> None:
    model = DescriptorModel.from_scene(_series_rlc())
    model.ac_backend = "descriptor"
    assert isinstance(select_strategy(model), NativePerFrequencyStrategy)


def test_select_strategy_nonlinear_native() -> None:
    class _Stub:
        ac_backend = "legacy"
        elements = [SimpleNamespace(kind="diode")]

    assert isinstance(select_strategy(_Stub()), NativePerFrequencyStrategy)


def test_ac_sweep_strategy_key_and_default_frequencies() -> None:
    model = DescriptorModel.from_scene(_series_rlc())
    result = ac_sweep(model, FREQS, input_source="V1", probes=["out"])
    assert result["strategy"] == "fast"
    assert result["frequencies"] == FREQS
    assert result["omega"] == result["omega_rad_s"]
