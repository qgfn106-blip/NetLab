"""时间积分（规范 §5.3）：后向欧拉 / RK4 / 速度 Verlet（辛）。"""
from __future__ import annotations

import numpy as np

from .newton import damped_newton


def backward_euler(f, x0, t0, t1, dt, jac=None):
    """后向欧拉（L-稳定，1 阶）：每步用 Newton 解隐式方程。"""
    x = np.asarray(x0, float).copy()
    t = t0
    ts, xs = [t], [x.copy()]
    while t < t1 - 1e-15:
        h = min(dt, t1 - t)
        xk = x
        F = lambda xn: xn - xk - h * np.asarray(f(t + h, xn), float)
        J = None
        if jac is not None:
            J = lambda xn: np.eye(xk.size) - h * np.asarray(jac(t + h, xn), float)
        xn, _ = damped_newton(F, xk, jac=J)
        x = np.asarray(xn, float)
        t += h
        ts.append(t)
        xs.append(x.copy())
    return np.array(ts), np.array(xs)


def rk4(f, x0, t0, t1, dt):
    x = np.asarray(x0, float).copy()
    t = t0
    ts, xs = [t], [x.copy()]
    while t < t1 - 1e-15:
        h = min(dt, t1 - t)
        k1 = np.asarray(f(t, x), float)
        k2 = np.asarray(f(t + h / 2, x + h / 2 * k1), float)
        k3 = np.asarray(f(t + h / 2, x + h / 2 * k2), float)
        k4 = np.asarray(f(t + h, x + h * k3), float)
        x = x + h / 6 * (k1 + 2 * k2 + 2 * k3 + k4)
        t += h
        ts.append(t)
        xs.append(x.copy())
    return np.array(ts), np.array(xs)


def verlet(accel, x0, v0, t0, t1, dt):
    """速度 Verlet（辛积分，P2）。accel(t, x) -> a。

    辛性质适用于保守、可分离力场且固定步长；变步长（包括本函数对末段
    的截断步）会破坏严格辛性，因此长期能量守恒只能作为数值观察，不是
    对任意力场/步长的定理。
    """
    x = np.asarray(x0, float).copy()
    v = np.asarray(v0, float).copy()
    t = t0
    ts, xs, vs = [t], [x.copy()], [v.copy()]
    a = np.asarray(accel(t, x), float)
    while t < t1 - 1e-15:
        h = min(dt, t1 - t)
        v_half = v + 0.5 * h * a
        x = x + h * v_half
        a = np.asarray(accel(t + h, x), float)
        v = v_half + 0.5 * h * a
        t += h
        ts.append(t)
        xs.append(x.copy())
        vs.append(v.copy())
    return np.array(ts), np.array(xs), np.array(vs)
