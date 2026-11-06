import numpy as np

from mathspec.hybrid import Guard, HybridAutomaton


def test_event_location():
    modes = {
        "grow": lambda t, x: np.array([1.0]),
        "flat": lambda t, x: np.array([0.0]),
    }
    ha = HybridAutomaton(modes)
    ha.add_guard(Guard("grow", "flat", lambda t, x: x[0] - 0.5,
                       reset=lambda t, x: np.array([0.0])))
    ts, xs, qs = ha.simulate(np.array([0.0]), "grow", 0.0, 0.6, dt=0.13, event_tol=1e-9)
    evt_idx = qs.index("flat")
    assert abs(ts[evt_idx] - 0.5) < 1e-6
    # 状态在事件处被重置为 0
    assert abs(xs[evt_idx][0]) < 1e-12
