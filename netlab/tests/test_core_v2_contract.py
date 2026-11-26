"""P3-01：Core V2 冻结契约的可执行断言。

对应 docs/audit/CORE_V2_CONTRACT_FREEZE.md 的 CF-01..CF-14。
"""
from __future__ import annotations

import inspect
import math
import os
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

import netlab
from netlab.core.common.limits import ComputeError, ValidationError
from netlab.core.compute import accel
from netlab.core.compute.accel import solve_dense
from netlab.core.compute.circuit import DescriptorModel, stamp_builder
from netlab.core.compute.circuit.ac_backend import (
    FastLinearStrategy,
    NativePerFrequencyStrategy,
    ac_sweep,
    select_strategy,
)
from netlab.core.compute.circuit.stamp_builder import StampSink
from netlab.core.compute.fem import FemConfig, FemModel
from netlab.core.model import path_guard
from netlab.core.model.path_guard import ensure_allowed_path
from netlab.core.model.project import APP_VERSION, PROJECT_VERSION
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


def test_version_constants():
    """CF-01/CF-02：Schema 与版本常量。"""
    assert PROJECT_VERSION == 8
    assert APP_VERSION == "2.1.0"
    assert netlab.__version__ == "3.20.2"


def test_stamp_sink_protocol_members():
    """CF-04：sink 协议成员固定。"""
    required = {
        "mode", "omega", "node", "branch", "add_A", "add_E",
        "add_conductance", "add_E_conductance", "add_current", "set_rhs",
    }
    annotations = set(getattr(StampSink, "__annotations__", {}))
    for name in required:
        assert hasattr(StampSink, name) or name in annotations, name


def test_descriptor_assembly_delegates_to_stamp_builder():
    """CF-03：descriptor 静态装配必须委托单一入口。"""
    source = inspect.getsource(DescriptorModel._assemble_matrices)
    assert "stamp_element_static" in source
    assert "stamp_element_static(" in source


def test_stamp_element_static_supported_kinds():
    """CF-05：总分派覆盖既有 kind 集合，非线性 kind 跳过。"""
    source = inspect.getsource(stamp_builder.stamp_element_static)
    for kind in (
        "resistor", "switch", "capacitor", "inductor", "sensor",
        "vsource", "actuator", "vcvs", "vccs", "isource", "actuator_i",
    ):
        assert kind in source, kind


def test_inductor_dual_path_exception_documented():
    """CF-06：电感双路径例外必须在模块契约中记录。"""
    doc = stamp_builder.__doc__ or ""
    assert "电感" in doc
    assert "stamp_inductor_static" in doc


def _assert_probe_equal(a: dict, b: dict, probe: str) -> None:
    for key in ("real", "imag", "magnitude", "phase_deg", "db"):
        np.testing.assert_allclose(
            np.asarray(a["probes"][probe][key], dtype=float),
            np.asarray(b["probes"][probe][key], dtype=float),
            rtol=1e-8, atol=1e-12, err_msg=key,
        )


def test_ac_sweep_result_contract():
    """CF-07：统一 AC API 与返回结构。"""
    model = DescriptorModel.from_scene(_series_rlc())
    fast = ac_sweep(model, FREQS, input_source="V1", probes=["out"], strategy=FastLinearStrategy())
    native = ac_sweep(model, FREQS, input_source="V1", probes=["out"], strategy=NativePerFrequencyStrategy())
    for result in (fast, native):
        assert set(("frequencies", "omega_rad_s", "omega", "input", "strategy", "probes")) <= set(result)
        assert len(result["frequencies"]) == len(FREQS)
        assert len(result["omega_rad_s"]) == len(FREQS)
        probe = result["probes"]["out"]
        assert set(("real", "imag", "magnitude", "phase_deg", "db")) <= set(probe)
        assert len(probe["magnitude"]) == len(FREQS)
    assert fast["strategy"] == "fast"
    assert native["strategy"] == "native"


def test_ac_strategy_selection_contract():
    """CF-08：策略选择优先级。"""
    assert isinstance(select_strategy(DescriptorModel.from_scene(_series_rlc())), FastLinearStrategy)
    forced = DescriptorModel.from_scene(_series_rlc())
    forced.ac_backend = "descriptor"
    assert isinstance(select_strategy(forced), NativePerFrequencyStrategy)
    nonlinear = SimpleNamespace(ac_backend="legacy", elements=[SimpleNamespace(kind="diode")])
    assert isinstance(select_strategy(nonlinear), NativePerFrequencyStrategy)


def test_ac_sweep_fast_native_parity():
    """CF-09：fast 与 native 逐点等价。"""
    model = DescriptorModel.from_scene(_series_rlc())
    fast = ac_sweep(model, FREQS, input_source="V1", probes=["out"], strategy=FastLinearStrategy())
    native = ac_sweep(model, FREQS, input_source="V1", probes=["out"], strategy=NativePerFrequencyStrategy())
    _assert_probe_equal(fast, native, "out")


def test_compute_error_contract():
    """CF-10：数值/输入错误统一为 ComputeError 且消息可判定。"""
    with pytest.raises(ComputeError):
        solve_dense(np.ones((2, 3)), np.ones(2))
    with pytest.raises(ComputeError):
        solve_dense(np.ones((2, 2)), np.ones(3))
    with pytest.raises(ComputeError):
        solve_dense(np.array([[1.0, np.nan], [0.0, 1.0]]), np.ones(2))
    with pytest.raises(ComputeError) as excinfo:
        solve_dense(np.zeros((2, 2)), np.ones(2), what="契约测试")
    assert "奇异" in str(excinfo.value)
    np.testing.assert_allclose(solve_dense(np.eye(2), np.array([2.0, 3.0])), [2.0, 3.0])


def test_gpu_nonfinite_falls_back_to_cpu(monkeypatch):
    """CF-11：GPU 非有限解回退 CPU，而非向外抛错。"""
    class _FakeLinalg:
        def solve(self, matrix, rhs):
            return np.full(rhs.shape, np.inf, dtype=float)

    class _FakeStream:
        def synchronize(self):
            return None

    class _FakeCuda:
        class Stream:
            null = _FakeStream()

    class _FakeGpu:
        linalg = _FakeLinalg()
        cuda = _FakeCuda()

        def asarray(self, value):
            return np.asarray(value)

        def asnumpy(self, value):
            return np.asarray(value)

    monkeypatch.delenv("NETLAB_ACCEL", raising=False)
    monkeypatch.setenv("NETLAB_ACCEL_GPU_MIN_SIZE", "16")
    monkeypatch.setattr(accel, "_GPU", _FakeGpu())
    monkeypatch.setattr(accel, "_GPU_CHECKED", True)
    monkeypatch.setattr(accel, "_GPU_ERROR", None)
    monkeypatch.setattr(accel, "_GPU_CALLS", 0)
    solution = accel.solve_dense(np.eye(16), np.ones(16), what="契约测试")
    assert np.allclose(solution, np.ones(16))
    assert accel.status()["last_backend"] == "cpu"


def test_path_guard_contract(monkeypatch, tmp_path):
    """CF-12：白名单覆盖语义、越界/.. 拒绝、返回原始 Path。"""
    root = tmp_path / "root"
    outside = tmp_path / "outside"
    root.mkdir()
    outside.mkdir()
    monkeypatch.setenv("NETLAB_ALLOWED_ROOTS", str(root))
    assert path_guard.allowed_roots() == (root.resolve(),)
    accepted = ensure_allowed_path(root / "a.txt", purpose="测试")
    assert accepted == root / "a.txt"
    with pytest.raises(ValidationError):
        ensure_allowed_path(outside / "b.txt", purpose="测试")
    with pytest.raises(ValidationError):
        ensure_allowed_path(root / ".." / "outside" / "c.txt", purpose="测试")


def test_fem_config_contract():
    """CF-13：FEM 边界/时间积分枚举与非法值拒绝。"""
    cfg = FemConfig(
        nx=4, ny=4, dt=0.01, steps_per_frame=1,
        boundary_top="dirichlet", boundary_bottom="dirichlet",
        boundary_top_value=30.0, boundary_bottom_value=10.0,
        time_integrator="crank_nicolson",
    )
    model = FemModel(cfg)
    assert model.stats()["time_integrator"] == "crank_nicolson"
    assert model.stats()["boundary_top"] == "dirichlet"
    assert model.stats()["boundary_bottom"] == "dirichlet"
    with pytest.raises(ValidationError):
        FemModel(FemConfig(nx=4, ny=4, dt=0.01, steps_per_frame=1, time_integrator="rk4"))
    with pytest.raises(ValidationError):
        FemModel(FemConfig(nx=4, ny=4, dt=0.01, steps_per_frame=1, boundary_top="open"))

