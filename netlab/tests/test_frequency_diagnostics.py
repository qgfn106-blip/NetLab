"""Task4：频响求解质量诊断（S5 最小版）测试。

审批口径：诊断默认不跑（不增加默认路径开销）；仅 ``NETLAB_FREQ_DIAG=1``
时才计算每频点残差/条件数。测试在此显式开启环境变量。
"""

from __future__ import annotations

import numpy as np
import pytest

from netlab.core.compute import analysis
from netlab.core.compute.frequency_diag import point_diagnostics, summarize
from netlab.core.compute.simulation import Simulation
from netlab.core.model.scene import Scene


def _signal_scene() -> Scene:
    scene = Scene("signal")
    u = scene.add_node(name="u", kind="manual", data={"value": 1.0})
    g = scene.add_node(name="g", kind="gain", params={"gain": 1.0})
    p = scene.add_node(
        name="p", kind="transfer_function", params={"form": "expr", "expr": "1/(s+1)"}
    )
    scene.add_edge(source=u.id, target=g.id, kind="pass")
    scene.add_edge(source=g.id, target=p.id, kind="pass")
    return scene


def test_point_marks_ill_conditioned(monkeypatch):
    monkeypatch.setenv("NETLAB_FREQ_DIAG", "1")
    m = np.array([[1.0, 1e8], [0.0, 1.0]], dtype=complex)
    x = np.array([1.0, 1.0], dtype=complex)
    d = point_diagnostics(m, m @ x, x)
    assert d["ill_conditioned"] is True
    assert d["cond_est"] is not None and d["cond_est"] > 1e12

    m2 = np.array([[2.0, 0.0], [0.0, 3.0]], dtype=complex)
    x2 = np.array([1.0, 1.0], dtype=complex)
    d2 = point_diagnostics(m2, m2 @ x2, x2)
    assert d2["ill_conditioned"] is False


def test_signal_response_healthy_has_small_residual(monkeypatch):
    monkeypatch.setenv("NETLAB_FREQ_DIAG", "1")
    result = analysis.frequency_response(Simulation(_signal_scene()), "u", "p")
    diag = result["diagnostics"]
    assert diag["diag_enabled"] is True
    assert diag["any_ill_conditioned"] is False
    assert len(diag["points"]) == len(result["frequencies_hz"])
    assert diag["max_rel_residual"] is not None and diag["max_rel_residual"] < 1e-9


def test_signal_response_env_off_skips_diagnostics(monkeypatch):
    monkeypatch.delenv("NETLAB_FREQ_DIAG", raising=False)

    def _boom(*_a, **_k):
        raise AssertionError("env 关闭时不应调用 np.linalg.cond")

    monkeypatch.setattr(np.linalg, "cond", _boom)
    result = analysis.frequency_response(Simulation(_signal_scene()), "u", "p")
    diag = result["diagnostics"]
    assert diag["diag_enabled"] is False
    assert diag["points"] == []


def test_summarize_aggregates():
    pts = [
        {"rel_residual": 1e-12, "ill_conditioned": False, "cond_est": None},
        {"rel_residual": 1e-3, "ill_conditioned": True, "cond_est": 1e14},
    ]
    s = summarize(pts)
    assert s["any_ill_conditioned"] is True
    assert s["max_rel_residual"] == 1e-3
    assert s["max_cond_est"] == 1e14


# ---- 描述符路径（DescriptorModel.frequency_response）覆盖 ----
import math
from netlab.core.compute.circuit import DescriptorModel


def _rc_low_pass() -> Scene:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    out = scene.add_node(name="out", kind="node")
    scene.add_edge(name="V1", source=vin.id, target=gnd.id, kind="vsource",
                   params={"wave": "dc", "offset": 0.0, "amplitude": 1.0})
    scene.add_edge(name="R1", source=vin.id, target=out.id, kind="resistor", params={"R": 1000.0})
    scene.add_edge(name="C1", source=out.id, target=gnd.id, kind="capacitor", params={"C": 1.0e-6})
    return scene


def _series_rlc(resistance: float) -> Scene:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    mid = scene.add_node(name="mid", kind="node")
    out = scene.add_node(name="out", kind="node")
    scene.add_edge(name="V1", source=vin.id, target=gnd.id, kind="vsource",
                   params={"wave": "dc", "offset": 0.0, "amplitude": 1.0})
    scene.add_edge(name="L1", source=vin.id, target=mid.id, kind="inductor", params={"L": 1.0e-3})
    scene.add_edge(name="R1", source=mid.id, target=out.id, kind="resistor", params={"R": resistance})
    scene.add_edge(name="C1", source=out.id, target=gnd.id, kind="capacitor", params={"C": 1.0e-6})
    return scene


def test_descriptor_healthy_env_on(monkeypatch):
    monkeypatch.setenv("NETLAB_FREQ_DIAG", "1")
    result = DescriptorModel.from_scene(_rc_low_pass()).frequency_response([10.0, 100.0, 1000.0])
    diag = result["diagnostics"]
    assert diag["any_ill_conditioned"] is False
    assert diag["max_rel_residual"] is not None and diag["max_rel_residual"] < 1e-9
    assert len(diag["points"]) == 3
    assert "probes" in result and "frequencies" in result


def test_descriptor_env_off_no_cond(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("env 关闭时不应调用 np.linalg.cond")
    monkeypatch.delenv("NETLAB_FREQ_DIAG", raising=False)
    monkeypatch.setattr(np.linalg, "cond", boom)
    result = DescriptorModel.from_scene(_rc_low_pass()).frequency_response([100.0])
    assert result["diagnostics"]["points"] == []


def test_descriptor_pathological_flagged(monkeypatch):
    monkeypatch.setenv("NETLAB_FREQ_DIAG", "1")
    model = DescriptorModel.from_scene(_series_rlc(1.0e-9))
    f0 = 1.0 / (2.0 * math.pi * math.sqrt(1.0e-3 * 1.0e-6))
    diag = model.frequency_response([f0 * 0.999, f0, f0 * 1.001])["diagnostics"]
    assert diag["any_ill_conditioned"] is True
