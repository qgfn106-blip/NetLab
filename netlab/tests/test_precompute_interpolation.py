"""需求④：预计算结果的后处理插值（Simulation.precompute 接线）。"""

from __future__ import annotations

import pytest

from netlab.core.common.limits import ValidationError
from netlab.core.compute.simulation import Simulation
from netlab.core.model.scene import Scene


def _sim() -> Simulation:
    s = Scene("signal")
    s.add_node(name="a", kind="manual", data={"voltage": 1.0})
    sim = Simulation(s)
    sim.apply_config({"fps": 30, "dt": 0.01, "steps_per_frame": 1, "sample_every": 1})
    return sim


def test_no_interpolation_when_absent():
    sim = _sim()
    try:
        r = sim.precompute(0.1, 0.01, 1)
        assert r["interpolation"] is None
    finally:
        sim.shutdown()


def test_average_upsample_doubles_points():
    sim = _sim()
    try:
        base = sim.precompute(0.1, 0.01, 1)
        n = base["frames"]
        r = sim.precompute(0.1, 0.01, 1, interpolation_method="average", interpolation_rounds=1)
        interp = r["interpolation"]
        assert interp is not None and interp["method"] == "average"
        assert interp["frame_count"] == 2 * n - 1  # rounds=1 中点细分
        ts = [fr["t"] for fr in interp["frames"]]
        assert ts == sorted(ts)
        vals = [v for fr in interp["frames"] for v in fr["v"].values()]
        assert all(abs(x - 1.0) < 1e-9 for x in vals)  # 恒压 1.0，插值仍 1.0
    finally:
        sim.shutdown()


def test_rounds_zero_is_identity_and_gaussian_works():
    sim = _sim()
    try:
        n = sim.precompute(0.1, 0.01, 1)["frames"]
        r0 = sim.precompute(0.1, 0.01, 1, interpolation_method="average", interpolation_rounds=0)
        assert r0["interpolation"]["frame_count"] == n
        rg = sim.precompute(0.1, 0.01, 1, interpolation_method="gaussian", interpolation_rounds=2)
        assert rg["interpolation"]["method"] == "gaussian"
        assert rg["interpolation"]["frame_count"] >= 3 * n
    finally:
        sim.shutdown()


def test_invalid_method_and_rounds_rejected():
    sim = _sim()
    try:
        with pytest.raises(ValidationError):
            sim.precompute(0.1, 0.01, 1, interpolation_method="bogus")
        with pytest.raises(ValidationError):
            sim.precompute(0.1, 0.01, 1, interpolation_method="average", interpolation_rounds=99)
    finally:
        sim.shutdown()
