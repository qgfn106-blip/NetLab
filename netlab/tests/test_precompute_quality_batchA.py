"""批次A 边界与校验：P2-01 空序列、P2-02 缺测语义、P2-03 窗口校验。"""

from __future__ import annotations

import math

import pytest

import netlab.core.compute.interpolation as I
from netlab.core.common.limits import ValidationError
from netlab.core.compute.simulation import Simulation, _build_interp_series
from netlab.core.model.scene import Scene


def test_empty_mapping_returns_empty_not_assert():
    t = [0.0, 1.0]
    nt, out = I.resample_multi(t, {}, method="average", rounds=1)
    assert out == {} and nt == t


def test_empty_list_returns_empty_not_assert():
    nt, out = I.resample_multi([0.0, 1.0], [], method="average", rounds=1)
    assert out == []


def test_zero_and_one_point():
    assert I.midpoint_resample([0.0], [1.0], method="gaussian", rounds=3) == ([0.0], [1.0])
    assert I.midpoint_resample([], [], method="average", rounds=2) == ([], [])


@pytest.mark.parametrize("w", [0.0, -1.0, float("nan"), float("inf")])
def test_invalid_window_rejected(w):
    with pytest.raises(ValueError):
        I.midpoint_resample([0.0, 1.0], [1.0, 2.0], method="gaussian", rounds=1, window=w)


def _sim():
    sc = Scene("signal")
    sc.add_node(name="a", kind="manual", data={"voltage": 1.0})
    sim = Simulation(sc)
    sim.apply_config({"fps": 30, "dt": 0.01, "steps_per_frame": 1, "sample_every": 1})
    return sim


def test_sim_rejects_non_positive_window():
    sim = _sim()
    with pytest.raises(ValidationError):
        sim.precompute(0.1, dt=0.01, sample_every=1,
                       interpolation_method="average", interpolation_rounds=1,
                       interpolation_window=0.0)


def test_build_series_rejects_missing_channel():
    frames = [{"t": 0.0, "v": {"x": 1.0}}, {"t": 1.0, "v": {}}]
    with pytest.raises(ValidationError):
        _build_interp_series(frames)


def test_build_series_ok():
    frames = [{"t": 0.0, "v": {"x": 1.0}}, {"t": 1.0, "v": {"x": 2.0}}]
    t, k, s = _build_interp_series(frames)
    assert t == [0.0, 1.0] and k == ["x"] and s["x"] == [1.0, 2.0]
