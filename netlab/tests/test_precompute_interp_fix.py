"""预计算插值卡死/超时缺陷（P1–P5）回归测试。

- P1：gaussian 用二分窗口后应足够快（n≈5556, rounds=2 远小于 5s）。
- P1/P5：插值规模过大时快速抛 ValidationError，而非卡到前端超时。
- P2：插值阶段进度 status == "interpolating" 且 percent != 100；完成后才 done/100。
- P3：前端 net.ts 的超时报文使用真实 timeoutMs，不再硬编码「15 秒」。
"""

from __future__ import annotations

import time
from pathlib import Path

import pytest

import netlab.core.compute.interpolation as interp
from netlab.core.common.limits import ValidationError
from netlab.core.compute.simulation import Simulation
from netlab.core.model.scene import Scene


def _sim() -> Simulation:
    sc = Scene("signal")
    sc.add_node(name="a", kind="manual", data={"voltage": 1.0})
    sim = Simulation(sc)
    sim.apply_config({"fps": 30, "dt": 0.01, "steps_per_frame": 1, "sample_every": 1})
    return sim


def test_estimate_frames_exact():
    assert interp.estimate_frames(2, 0) == 2
    assert interp.estimate_frames(2, 1) == 3
    assert interp.estimate_frames(3, 2) == (3 - 1) * 4 + 1


def test_gaussian_bisect_is_fast():
    n = 5556
    t = [i * 1e-3 for i in range(n)]
    v = [float(i % 7) for i in range(n)]
    start = time.perf_counter()
    interp.midpoint_resample(t, v, method="gaussian", rounds=2)
    assert time.perf_counter() - start < 5.0, "gaussian 插值仍然过慢（疑似退化为 O(n²)）"


def test_over_limit_fast_fail(monkeypatch):
    monkeypatch.setattr(interp, "estimate_frames", lambda n, r: 10_000_000)
    sim = _sim()
    with pytest.raises(ValidationError):
        sim.precompute(
            0.1, dt=0.01, sample_every=1,
            interpolation_method="gaussian", interpolation_rounds=2,
        )


def test_progress_stage_interpolating_before_done(monkeypatch):
    sim = _sim()
    seen = {}
    orig = interp.resample_multi

    def slow(*a, **k):
        snap = sim.precompute_progress()
        seen["status_during"] = snap.get("status")
        seen["percent_during"] = snap.get("percent")
        time.sleep(0.03)
        return orig(*a, **k)

    monkeypatch.setattr(interp, "resample_multi", slow)
    sim.precompute(0.2, dt=0.01, sample_every=1, interpolation_method="average", interpolation_rounds=1)

    assert seen["status_during"] == "interpolating", seen
    assert seen["percent_during"] != 100.0, seen
    final = sim.precompute_progress()
    assert final.get("status") == "done" and final.get("percent") == 100.0


def test_net_ts_timeout_uses_real_value():
    txt = Path("frontend/app/net.ts").read_text(encoding="utf-8")
    assert "15 秒" not in txt
    assert "timeoutMs" in txt
