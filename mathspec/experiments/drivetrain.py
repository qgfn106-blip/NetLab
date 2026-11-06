"""复杂系统试验台：DC 电机 → 减速器 → 弹性轴 → 机械负载（规范 §14）。

状态 x = (i, wm, wl, theta)：
    L  di/dt   = V - R i - Ke wm
    Jm dwm/dt  = Kt i - bm wm - tau_s / N
    Jl dwl/dt  = tau_s - bl wl - tau_L
    dtheta/dt  = wm / N - wl
    tau_s      = ks theta + cs (wm / N - wl)

这是 §10 纵切案例的"加长版"：比 netlab 现有的 2 状态 DC 电机多了
减速比 N、弹性轴（ks, cs）与负载惯量 Jl，用来验证多域耦合、能量守恒、
振荡模态、模型降阶与数据管线的数学形式。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Tuple

import numpy as np


@dataclass
class DriveTrainParams:
    R: float = 0.5       # 电枢电阻
    L: float = 0.01      # 电枢电感
    Ke: float = 0.05     # 反电动势常数
    Kt: float = 0.05     # 力矩常数
    Jm: float = 0.002    # 电机转子惯量
    bm: float = 0.0005   # 电机轴承阻尼
    N: float = 10.0      # 减速比
    Jl: float = 0.05     # 负载惯量
    bl: float = 0.01     # 负载阻尼
    ks: float = 5.0      # 弹性轴刚度
    cs: float = 0.02     # 弹性轴阻尼
    Vmax: float = 24.0   # 电压限幅


def state_matrix(p: DriveTrainParams) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """线性化：dx/dt = A x + B V + E tau_L。返回 (A, B, E)。"""
    A = np.array([
        [-p.R / p.L, -p.Ke / p.L, 0.0, 0.0],
        [p.Kt / p.Jm,
         -(p.bm + p.cs / p.N**2) / p.Jm,
         (p.cs / p.N) / p.Jm,
         -p.ks / (p.N * p.Jm)],
        [0.0,
         (p.cs / p.N) / p.Jl,
         -(p.bl + p.cs) / p.Jl,
         p.ks / p.Jl],
        [0.0, 1.0 / p.N, -1.0, 0.0],
    ], dtype=float)
    B = np.array([[1.0 / p.L], [0.0], [0.0], [0.0]], dtype=float)
    E = np.array([[0.0], [0.0], [-1.0 / p.Jl], [0.0]], dtype=float)
    return A, B, E


def observation_matrix() -> np.ndarray:
    """观测量 y = (i, wm, wl)。"""
    return np.array([[1.0, 0.0, 0.0, 0.0],
                     [0.0, 1.0, 0.0, 0.0],
                     [0.0, 0.0, 1.0, 0.0]], dtype=float)


def steady_state(p: DriveTrainParams, V: float, tau_L: float = 0.0) -> np.ndarray:
    """解析稳态：解 A x + B V + E tau_L = 0。"""
    A, B, E = state_matrix(p)
    return -np.linalg.solve(A, (B * V + E * tau_L).ravel())


def deriv_factory(p: DriveTrainParams, V: float, tau_L: float = 0.0):
    def f(_t, x):
        i, wm, wl, th = x
        tau_s = p.ks * th + p.cs * (wm / p.N - wl)
        di = (V - p.R * i - p.Ke * wm) / p.L
        dwm = (p.Kt * i - p.bm * wm - tau_s / p.N) / p.Jm
        dwl = (tau_s - p.bl * wl - tau_L) / p.Jl
        dth = wm / p.N - wl
        return np.array([di, dwm, dwl, dth], dtype=float)

    return f


def simulate(p: DriveTrainParams, V: float = 12.0, tau_L: float = 0.5,
             t_end: float = 3.0, dt: float = 1e-4,
             x0: Optional[np.ndarray] = None) -> Tuple[np.ndarray, np.ndarray]:
    """固定步长 RK4（参考实现；非刚性测试台够用）。"""
    if x0 is None:
        x0 = np.zeros(4, dtype=float)
    f = deriv_factory(p, V, tau_L)
    n = int(round(t_end / dt))
    ts = np.linspace(0.0, n * dt, n + 1)
    xs = np.empty((n + 1, 4), dtype=float)
    x = np.asarray(x0, dtype=float).copy()
    xs[0] = x
    for k in range(n):
        t = ts[k]
        k1 = f(t, x)
        k2 = f(t + dt / 2, x + dt / 2 * k1)
        k3 = f(t + dt / 2, x + dt / 2 * k2)
        k4 = f(t + dt, x + dt * k3)
        x = x + dt / 6 * (k1 + 2 * k2 + 2 * k3 + k4)
        xs[k + 1] = x
    return ts, xs


def energy(x: np.ndarray, p: DriveTrainParams) -> np.ndarray:
    """总储能 E = ½L i² + ½Jm wm² + ½Jl wl² + ½ks θ²（逐行计算）。"""
    x = np.atleast_2d(np.asarray(x, float))
    return (0.5 * p.L * x[:, 0] ** 2
            + 0.5 * p.Jm * x[:, 1] ** 2
            + 0.5 * p.Jl * x[:, 2] ** 2
            + 0.5 * p.ks * x[:, 3] ** 2)


def power_terms(ts: np.ndarray, xs: np.ndarray, p: DriveTrainParams,
                V: float, tau_L: float = 0.0):
    """返回 (P_in, P_loss)：P_in=V i，P_loss=R i²+bm wm²+bl wl²+cs(ωm/N-ωl)²+τ_L ωl。"""
    i, wm, wl = xs[:, 0], xs[:, 1], xs[:, 2]
    p_in = V * i
    p_loss = (p.R * i ** 2 + p.bm * wm ** 2 + p.bl * wl ** 2
              + p.cs * (wm / p.N - wl) ** 2 + tau_L * wl)
    return p_in, p_loss


def energy_balance_error(ts: np.ndarray, xs: np.ndarray, p: DriveTrainParams,
                         V: float, tau_L: float = 0.0) -> float:
    """∫(P_in - P_loss)dt 与 E(t_end)-E(t_0) 的相对误差（梯形积分）。"""
    p_in, p_loss = power_terms(ts, xs, p, V, tau_L)
    net = p_in - p_loss
    integral = float(np.trapezoid(net, ts))
    e = energy(xs, p)
    delta = float(e[-1] - e[0])
    scale = max(abs(integral), abs(delta), 1e-12)
    return abs(integral - delta) / scale


def torsional_frequency(p: DriveTrainParams) -> float:
    """线性化系统的主导振荡频率（Hz）= max |Im λ| / 2π。"""
    A, _, _ = state_matrix(p)
    eig = np.linalg.eigvals(A)
    imag = np.abs(np.imag(eig))
    return float(np.max(imag) / (2.0 * np.pi))
