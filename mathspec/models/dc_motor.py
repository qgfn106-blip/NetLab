"""DC 电机驱动机械负载（规范 §10 纵切案例）。

状态 x = (i, omega)：电枢电流、角速度。
电气域：  L di/dt = V - R i - Ke omega
机械域：  J domega/dt = Kt i - b omega - tau_L
解析稳态：
  空载： omega = V / Ke,            i = 0
  带载： omega = (Kt V - R tau_L) / (Kt Ke + R b)
         i     = (tau_L + b omega) / Kt
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ..integrate import backward_euler


@dataclass
class DCMotorParams:
    R: float = 1.0
    L: float = 0.1
    Ke: float = 0.1
    Kt: float = 0.1
    J: float = 0.01
    b: float = 0.05


def deriv_factory(p: DCMotorParams, V: float, tau_L: float = 0.0):
    def f(t, x):
        i, w = x
        di = (V - p.R * i - p.Ke * w) / p.L
        dw = (p.Kt * i - p.b * w - tau_L) / p.J
        return np.array([di, dw])

    return f


def jac_factory(p: DCMotorParams):
    def jac(t, x):
        return np.array(
            [[-p.R / p.L, -p.Ke / p.L],
             [p.Kt / p.J, -p.b / p.J]]
        )

    return jac


def steady_state_noload(p: DCMotorParams, V: float):
    """空载稳态（b=0, tau_L=0）：omega=V/Ke, i=0。"""
    return 0.0, V / p.Ke


def steady_state_loaded(p: DCMotorParams, V: float, tau_L: float):
    """带载稳态（解析解，A6）。"""
    denom = p.Kt * p.Ke + p.R * p.b
    w = (p.Kt * V - p.R * tau_L) / denom
    i = (tau_L + p.b * w) / p.Kt
    return i, w


def simulate_to_steady(p: DCMotorParams, V: float, tau_L: float = 0.0,
                       t_end: float = 3.0, dt: float = 1e-3, x0=None):
    """后向欧拉积分到接近稳态。"""
    if x0 is None:
        x0 = np.array([0.0, 0.0])
    f = deriv_factory(p, V, tau_L)
    jac = jac_factory(p)
    ts, xs = backward_euler(f, x0, 0.0, t_end, dt, jac=jac)
    return ts, xs
