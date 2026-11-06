import numpy as np

from mathspec.models import dc_motor as dm


def test_noload_steady_formula():
    p = dm.DCMotorParams(R=1.0, L=0.1, Ke=0.1, Kt=0.1, J=0.01, b=0.0)
    i_ss, w_ss = dm.steady_state_noload(p, V=10.0)
    assert abs(i_ss) < 1e-12
    assert abs(w_ss - 10.0 / 0.1) < 1e-9


def test_loaded_steady_simulation():
    p = dm.DCMotorParams(R=1.0, L=0.1, Ke=0.1, Kt=0.1, J=0.01, b=0.05)
    V, tau_L = 10.0, 0.05
    i_ss, w_ss = dm.steady_state_loaded(p, V, tau_L)
    ts, xs = dm.simulate_to_steady(p, V, tau_L, t_end=3.0, dt=1e-3)
    i_end, w_end = xs[-1, 0], xs[-1, 1]
    # 仿真末态应接近解析稳态（相对误差 < 1%）
    assert abs(w_end - w_ss) / abs(w_ss) < 1e-2
    assert abs(i_end - i_ss) / abs(i_ss) < 1e-2
