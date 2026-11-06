"""涡旋诊断：解析（连续场）与网格（N³ 有限差分）双轨。

任务书要求「不得把有限网格的大值解释为无穷」，所以这里同时给出两列：
* **解析列**：在细 r–z 网格上直接采样连续场并求导，反映前导阶自相似解本身；
* **网格列**：在 N³ 笛卡尔网格上用有限差分算旋度/散度，反映离散误差。

两列随 τ→0 都以 τ^(−1/2−h) 增长（这是构造的性质，不是网格伪影）；
网格列会因分辨率不足而**低估**峰值，`convergence()` 用来展示这个趋势。
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .field import SimilarityParams, profile_table, velocity_at

__all__ = ["VortexStats", "analyze", "convergence", "grid_stats"]


@dataclass(frozen=True)
class VortexStats:
    t: float
    tau: float
    u_max: float
    omega_max: float
    enstrophy: float
    kinetic: float
    core_radius: float
    axial_extent: float
    elongation: float
    divergence_rel: float
    re_theta: float
    n_grid: int = 0

    def as_dict(self) -> dict:
        """非有限值一律给 None（JSON 不能表达 NaN，前端显示成「—」）。"""
        out = {
            "t": self.t,
            "tau": self.tau,
            "u_max": self.u_max,
            "omega_max": self.omega_max,
            "enstrophy": self.enstrophy,
            "kinetic": self.kinetic,
            "core_radius": self.core_radius,
            "axial_extent": self.axial_extent,
            "elongation": self.elongation,
            "divergence_rel": self.divergence_rel,
            "re_theta": self.re_theta,
            "n_grid": self.n_grid,
        }
        return {
            k: (float(v) if isinstance(v, (int, float)) and np.isfinite(v) else None)
            for k, v in out.items()
        }


def _polar_grid(
    t: float,
    p: SimilarityParams,
    table,
    *,
    n_r: int,
    n_z: int,
    r_max: float,
    z_max: float,
):
    r = np.linspace(
        0.002, r_max, n_r
    )  # 轴上留 2 mm：r->0 处 (1/r)dr(r u_r) 会放大数值噪声
    z = np.linspace(-z_max, z_max, n_z)
    R, Z = np.meshgrid(r, z, indexing="ij")
    ur, ut, uz = velocity_at(R, Z, t, p, table)
    return r, z, R, Z, ur, ut, uz


def analyze(
    p: SimilarityParams | None = None,
    t: float = 0.5,
    *,
    table: dict | None = None,
    n_r: int = 320,
    n_z: int = 320,
    r_max: float | None = None,
    z_max: float = 1.2,
) -> VortexStats:
    """解析列：在细 r–z 网格上算峰值、能量、Enstrophy、涡核尺度。

    采样半径默认按剖面自适应（r_max ≈ 2.2·√X₀）：写死 0.35 时，一旦把涡核
    调大（r_core>0.5），core_radius 就会被盒子截断、永远是 0.35。
    """
    p = p or SimilarityParams()
    if r_max is None:
        r_max = max(0.35, 2.2 * float(np.sqrt(max(p.x0, 1e-6))))
    table = table if table is not None else profile_table(p)
    r, z, R, Z, ur, ut, uz = _polar_grid(
        t, p, table, n_r=n_r, n_z=n_z, r_max=r_max, z_max=z_max
    )

    dr = r[1] - r[0]
    dz = z[1] - z[0]

    # 轴对称：ω_r = 0，ω_θ = ∂_z u_r − ∂_r u_z，ω_z = (1/r)∂_r(r u_θ)
    d_ur_dz = np.gradient(ur, dz, axis=1)
    d_uz_dr = np.gradient(uz, dr, axis=0)
    w_theta = d_ur_dz - d_uz_dr
    w_z = (np.gradient(R * ut, dr, axis=0)) / np.maximum(R, 1e-12)
    w2 = w_theta**2 + w_z**2

    speed2 = ur**2 + ut**2 + uz**2
    dV = 2.0 * np.pi * R * dr * dz

    # 涡核半径：u_θ 降到轴上值的 1/e 处的 r（取 |z| 最小的那一行附近平均）
    mid = np.abs(z).argmin()
    omega_line = np.abs(ut[:, mid]) / np.maximum(r, 1e-12)
    if omega_line.size and omega_line[0] > 0:
        below = np.nonzero(omega_line < omega_line[0] / np.e)[0]
        core_r = float(r[below[0]]) if below.size else float(r[-1])
    else:
        core_r = float("nan")

    # 轴向尺度：|u_z| 沿 z 降到中点 1/e 的范围（取 r 最小的几列平均）
    col = min(3, ut.shape[0] - 1)
    uz_col = np.abs(uz[col])
    centre = np.abs(z).argmin()
    if uz_col[centre] > 0:
        above = np.nonzero(uz_col > uz_col[centre] / np.e)[0]
        axial = float(z[above[-1]] - z[above[0]]) if above.size else float(z_max)
    else:
        axial = float("nan")

    div = np.gradient(R * ur, dr, axis=0) / np.maximum(R, 1e-12) + np.gradient(
        uz, dz, axis=1
    )
    u_rms = float(np.sqrt(np.mean(speed2)))
    div_rel = float(np.sqrt(np.mean(div**2)) / u_rms) if u_rms > 0 else float("nan")

    tau = p.t_blow - t
    return VortexStats(
        t=float(t),
        tau=float(tau),
        u_max=float(np.sqrt(speed2.max())),
        omega_max=float(np.sqrt(w2.max())),
        enstrophy=float(0.5 * np.sum(w2 * dV)),
        kinetic=float(0.5 * np.sum(speed2 * dV)),
        core_radius=core_r,
        axial_extent=axial,
        elongation=(
            float(axial / core_r) if core_r and core_r == core_r else float("nan")
        ),
        divergence_rel=div_rel,
        re_theta=float(np.sqrt(speed2.max()) * core_r / p.nu),
    )


def grid_stats(
    p: SimilarityParams | None = None,
    t: float = 0.5,
    *,
    table: dict | None = None,
    n: int = 64,
    extent: float = 0.6,
    z_extent: float = 1.0,
) -> VortexStats:
    """网格列：在 n³ 笛卡尔网格上做有限差分（含方位角离散误差）。"""
    p = p or SimilarityParams()
    table = table if table is not None else profile_table(p)

    xs = np.linspace(-extent, extent, n)
    zs = np.linspace(-z_extent, z_extent, n)
    X, Y, Z = np.meshgrid(xs, xs, zs, indexing="ij")
    R = np.hypot(X, Y)
    theta = np.arctan2(Y, X)
    ur, ut, uz = velocity_at(R, Z, t, p, table)

    U = ur * np.cos(theta) - ut * np.sin(theta)
    V = ur * np.sin(theta) + ut * np.cos(theta)
    W = uz

    h = xs[1] - xs[0]
    hz = zs[1] - zs[0]
    dW_dx, dW_dy, dW_dz = np.gradient(W, h, h, hz)
    dV_dx, dV_dy, dV_dz = np.gradient(V, h, h, hz)
    dU_dx, dU_dy, dU_dz = np.gradient(U, h, h, hz)

    wx = dW_dy - dV_dz
    wy = dU_dz - dW_dx
    wz = dV_dx - dU_dy

    w2 = wx**2 + wy**2 + wz**2
    speed2 = U**2 + V**2 + W**2
    dV_cell = h * h * hz

    div = dU_dx + dV_dy + dW_dz
    u_rms = float(np.sqrt(np.mean(speed2)))

    # 网格列里涡核尺度用「轴上 u_θ 剖面」的 1/e 半宽（沿 x 轴取样）
    mid = n // 2
    axis_line = np.abs(np.sqrt(U[:, mid, mid] ** 2 + V[:, mid, mid] ** 2))
    peak = axis_line.max() if axis_line.size else 0.0
    core = float("nan")
    if peak > 0:
        idx = np.nonzero(axis_line < peak / np.e)[0]
        core = float(h * abs(idx[0] - mid))

    return VortexStats(
        t=float(t),
        tau=float(p.t_blow - t),
        u_max=float(np.sqrt(speed2.max())),
        omega_max=float(np.sqrt(w2.max())),
        enstrophy=float(0.5 * np.sum(w2) * dV_cell),
        kinetic=float(0.5 * np.sum(speed2) * dV_cell),
        core_radius=core,
        axial_extent=float("nan"),
        elongation=float("nan"),
        divergence_rel=(
            float(np.sqrt(np.mean(div**2)) / u_rms) if u_rms else float("nan")
        ),
        re_theta=(
            float(np.sqrt(speed2.max()) * core / p.nu) if core == core else float("nan")
        ),
        n_grid=n,
    )


def convergence(
    p: SimilarityParams | None = None,
    t: float = 0.5,
    *,
    sizes: tuple[int, ...] = (32, 64, 128),
) -> list[dict]:
    """同一时刻、不同网格分辨率的诊断，用来看「网格值受 N 限制」。"""
    p = p or SimilarityParams()
    table = profile_table(p)
    out = []
    for n in sizes:
        out.append(grid_stats(p, t, table=table, n=n).as_dict())
    return out
