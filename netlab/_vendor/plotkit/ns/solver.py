"""三维不可压 Navier–Stokes 的**真数值解**（伪谱 + 2/3 去混叠 + 投影）。

用途：给 NS 页面提供与参考工程（cmccomb/navier-stokes-singularity-simulation）同构的
"从静止起步 → 外力平滑开启 → 向内螺旋 + 轴向拉伸 → 峰值持续增长" 的数据源。

## 与参考工程对齐的地方

参考工程（AMReX/incflo + PhiFlow）的公开描述是：

- 立方域，初始**静止**；
- 一个**紧支撑的制造外力**，随时间平滑开启、由三个脉冲组成；
- 归一化奇异时间 `t* = 1`，已审计状态覆盖 `0 … 0.995`；
- 诊断量：峰值速度、峰值涡量、半峰值半径、散度、动能、外力。

本模块复现的是**同一套结构与同名诊断量**，但：

- 外力剖面是**自建的**（`_force`，三个高斯脉冲 × 轴对称旋涡力），
  不是论文 appendix-B 的 exact pulse hierarchy；
- 分辨率只有 `N³`（默认 32³，可到 64³），因此**峰值受网格限制**；
- 因此它属于"有限时间代理（finite surrogate）"，**不是奇异性证明**。

界面上必须显示这条声明（见 `MODE_LABEL`）。

## 数值方法

- 周期立方域 `[-1,1]³`，均匀网格 `N³`；
- 速度在谱空间演化：`∂û/∂t = -P[(u·∇)u] - ν|k|²û + P f̂`，`P = I - kkᵀ/|k|²` 保证不可压；
- 2/3 去混叠（`|k_i| > N/3` 的模态置零）；
- 时间推进：Heun（RK2），`dt` 由 CFL 与粘性稳定性估计；
- 诊断量全部在物理空间由场直接算，不做任何"美化"。
"""

from __future__ import annotations

from dataclasses import dataclass, replace

import numpy as np

__all__ = ["SolverParams", "SolverResult", "solve", "SolverField"]

#: 界面必须原样显示的声明
MODE_LABEL = "Mode B · 三维不可压 NS 数值解（有限时间代理，非奇异性证明）"


@dataclass(frozen=True)
class SolverParams:
    n: int = 32                # 每方向网格数
    length: float = 2.0        # 立方域边长（[-1,1]³）
    nu: float = 4.0e-3         # 运动粘度
    dt: float = 4.0e-3         # 时间步
    t_end: float = 0.95        # 归一化时间终点（t* = 1 为参考工程的"奇异时刻"）
    save_every: float = 0.01   # 存档间隔
    amp: float = 1.0           # 外力幅值
    t_on: float = 0.10         # 外力开启时刻
    ramp: float = 0.08         # 开启平滑宽度
    sigma: float = 0.30        # 径向尺度
    sigma_z: float = 0.55      # 轴向尺度
    swirl: float = 1.0         # 角向分量权重
    stretch: float = 0.35      # 轴向拉伸分量权重


@dataclass
class SolverResult:
    params: SolverParams
    times: np.ndarray          # (F,)
    frames: np.ndarray         # (F, 3, N, N, N) float32，u 分量在最前
    diag: dict                 # 峰值速度/涡量/半峰值半径/散度/动能/Enstrophy/外力功率

    @property
    def grid(self) -> np.ndarray:
        p = self.params
        return np.linspace(-p.length / 2, p.length / 2, p.n, endpoint=False)

    def as_dict(self) -> dict:
        return {"n": self.params.n, "t_end": float(self.params.t_end),
                "frames": int(self.frames.shape[0]),
                "diag": {k: [float(x) for x in v] for k, v in self.diag.items()}}


def _wavenumbers(n: int, length: float):
    k = 2 * np.pi * np.fft.fftfreq(n, d=length / n)
    kx, ky, kz = np.meshgrid(k, k, k, indexing="ij")
    return kx, ky, kz


def _dealias_mask(n: int) -> np.ndarray:
    """2/3 规则：|k| 超过 1/3 网格的模态置零。"""
    k = np.fft.fftfreq(n) * n
    kx, ky, kz = np.meshgrid(k, k, k, indexing="ij")
    return (np.abs(kx) <= n / 3) & (np.abs(ky) <= n / 3) & (np.abs(kz) <= n / 3)


def _force(x, y, z, t: float, p: SolverParams):
    """轴对称旋涡力：三个时间脉冲 × 紧支撑空间包络。

    角向分量（-y, x, 0）/r 产生向内螺旋，轴向分量产生拉伸。
    """
    r = np.sqrt(x * x + y * y) + 1e-12
    env_r = np.exp(-(r / p.sigma) ** 2)
    env_z = np.exp(-(z / p.sigma_z) ** 2)
    env = env_r * env_z
    # 三个脉冲：间隔 0.12，幅度递增（后段更强），整体由 ramp 平滑开启
    pulses = np.zeros_like(t, dtype=float) if np.ndim(t) else 0.0
    for centre, weight in ((0.20, 1.0), (0.45, 1.6), (0.72, 2.4)):
        pulses = pulses + weight * np.exp(-(((t - centre) / 0.07) ** 2))
    on = 0.5 * (1.0 + np.tanh((t - p.t_on) / p.ramp))
    amp = p.amp * on * pulses
    fx = -y / r * p.swirl * env * amp
    fy = x / r * p.swirl * env * amp
    fz = p.stretch * env * amp * np.sign(z) * (np.abs(z) / (p.sigma_z + 1e-12))
    return fx, fy, fz


def solve(p: SolverParams | None = None, *, progress=None) -> SolverResult:
    """跑一遍数值解并返回所有存档帧 + 诊断序列。"""
    p = p or SolverParams()
    n, L = p.n, p.length
    g = np.linspace(-L / 2, L / 2, n, endpoint=False)
    X, Y, Z = np.meshgrid(g, g, g, indexing="ij")
    kx, ky, kz = _wavenumbers(n, L)
    k2 = kx * kx + ky * ky + kz * kz
    k2_safe = np.where(k2 == 0, 1.0, k2)
    mask = _dealias_mask(n)

    def project(uh):
        div = kx * uh[0] + ky * uh[1] + kz * uh[2]
        out = [uh[0] - kx * div / k2_safe,
               uh[1] - ky * div / k2_safe,
               uh[2] - kz * div / k2_safe]
        return out

    def nonlinear(uh):
        """-P[(u·∇)u]：入参是谱系数，出参也是谱系数。"""
        u = [np.fft.ifftn(uh[i]).real for i in range(3)]
        conv = []
        for i in range(3):
            acc = np.zeros_like(u[0])
            for j, kj in enumerate((kx, ky, kz)):
                acc = acc + u[j] * np.fft.ifftn(1j * kj * uh[i]).real
            conv.append(acc)
        conv_hat = [np.fft.fftn(c) * mask for c in conv]
        return [-c for c in project(conv_hat)]

    def force_hat(t):
        fx, fy, fz = _force(X, Y, Z, t, p)
        return [np.fft.fftn(c) * mask for c in (fx, fy, fz)]

    def rhs(u, t):
        nl = nonlinear(u)
        fh = force_hat(t)
        return [nl[i] + fh[i] - p.nu * k2 * u[i] for i in range(3)]

    # 从**静止**开始
    u = [np.zeros((n, n, n)) for _ in range(3)]
    uh = [np.zeros((n, n, n), dtype=complex) for _ in range(3)]

    times, frames = [], []
    diag = {k: [] for k in ("t", "peak_speed", "peak_vorticity", "half_peak_radius",
                            "divergence", "energy", "enstrophy", "force_power")}
    next_save = 0.0
    t = 0.0
    dx = L / n
    while t <= p.t_end + 1e-12:
        # 存档
        if t >= next_save - 1e-12:
            sp = [np.fft.ifftn(uh[i]).real for i in range(3)]
            speed = np.sqrt(sum(c * c for c in sp))
            wx = np.fft.ifftn(1j * (ky * uh[2] - kz * uh[1])).real
            wy = np.fft.ifftn(1j * (kz * uh[0] - kx * uh[2])).real
            wz = np.fft.ifftn(1j * (kx * uh[1] - ky * uh[0])).real
            vort = np.sqrt(wx * wx + wy * wy + wz * wz)
            peak = float(speed.max())
            # 半峰值半径：速度幅值 ≥ peak/2 的格点，其到轴距离的 95 分位
            rr = np.sqrt(X * X + Y * Y)
            half = rr[speed >= 0.5 * peak] if peak > 0 else np.array([0.0])
            div = float(np.abs(np.fft.ifftn(1j * (kx * uh[0] + ky * uh[1] + kz * uh[2]))).max())
            times.append(float(t))
            frames.append(np.stack([c.astype(np.float32) for c in sp]))
            diag["t"].append(float(t))
            diag["peak_speed"].append(peak)
            diag["peak_vorticity"].append(float(vort.max()))
            diag["half_peak_radius"].append(float(np.percentile(half, 95)) if half.size else 0.0)
            diag["divergence"].append(div)
            diag["energy"].append(float(0.5 * np.mean(speed ** 2)))
            diag["enstrophy"].append(float(0.5 * np.mean(vort ** 2)))
            fx, fy, fz = _force(X, Y, Z, t, p)
            diag["force_power"].append(float(np.mean(fx * sp[0] + fy * sp[1] + fz * sp[2])))
            next_save += p.save_every
            if progress:
                progress(len(times), float(t), peak)
        # 自适应步长：CFL（对流）+ 粘性稳定性，避免爆掉
        sp_now = [np.fft.ifftn(uh[i]).real for i in range(3)]
        vmax = float(np.sqrt(sum(c * c for c in sp_now)).max())
        dt = min(p.dt, 0.35 * dx / max(vmax, 1e-6), 0.4 * dx * dx / max(p.nu, 1e-9))
        # Heun (RK2)
        k1 = rhs(uh, t)
        u1 = [uh[i] + dt * k1[i] for i in range(3)]
        k2v = rhs(u1, t + dt)
        uh = [uh[i] + 0.5 * dt * (k1[i] + k2v[i]) for i in range(3)]
        uh = project(uh)
        t += dt

    return SolverResult(params=p, times=np.asarray(times),
                        frames=np.asarray(frames, dtype=np.float32), diag=diag)


class SolverField:
    """把数值解包装成 PlotKit 的 `NSField` 协议（按时间三线性插值）。"""

    def __init__(self, result: SolverResult):
        self.result = result
        self.params = result.params
        self.grid = result.grid
        self._t = result.times
        self._f = result.frames

    # --- NSField 协议 -----------------------------------------------------
    def velocity(self, points, t: float):
        pts = np.asarray(points, dtype=float).reshape(-1, 3)
        k = int(np.argmin(np.abs(self._t - float(t))))
        frame = self._f[k]
        return self._sample(frame, pts)

    def with_params(self, **kw):
        p = replace(self.params, **kw)
        return SolverField(solve(p))

    # --- 内部 -------------------------------------------------------------
    def _sample(self, frame, pts):
        p = self.params
        n, L = p.n, p.length
        half = L / 2
        idx = (pts + half) / L * n  # 连续格点坐标
        i0 = np.floor(idx).astype(int) % n
        i1 = (i0 + 1) % n
        f = idx - np.floor(idx)
        out = np.zeros((pts.shape[0], 3), dtype=float)
        for comp in range(3):
            c = frame[comp]
            out[:, comp] = (
                c[i0[:, 0], i0[:, 1], i0[:, 2]] * (1 - f[:, 0]) * (1 - f[:, 1]) * (1 - f[:, 2])
                + c[i1[:, 0], i0[:, 1], i0[:, 2]] * f[:, 0] * (1 - f[:, 1]) * (1 - f[:, 2])
                + c[i0[:, 0], i1[:, 1], i0[:, 2]] * (1 - f[:, 0]) * f[:, 1] * (1 - f[:, 2])
                + c[i0[:, 0], i0[:, 1], i1[:, 2]] * (1 - f[:, 0]) * (1 - f[:, 1]) * f[:, 2]
                + c[i1[:, 0], i1[:, 1], i0[:, 2]] * f[:, 0] * f[:, 1] * (1 - f[:, 2])
                + c[i1[:, 0], i0[:, 1], i1[:, 2]] * f[:, 0] * (1 - f[:, 1]) * f[:, 2]
                + c[i0[:, 0], i1[:, 1], i1[:, 2]] * (1 - f[:, 0]) * f[:, 1] * f[:, 2]
                + c[i1[:, 0], i1[:, 1], i1[:, 2]] * f[:, 0] * f[:, 1] * f[:, 2]
            )
        return out
