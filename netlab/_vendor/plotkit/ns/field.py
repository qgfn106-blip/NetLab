"""Navier–Stokes 自相似涡旋场（论文前导阶复现，A′ 模式）。

来源
----
OpenAI, *Finite time blowup for Navier–Stokes*, 2026-09-08
(https://openai.com/index/navier-stokes-solution/)，§2 物理描述与 §3.1 相似坐标：

    τ = 1 − t,  A = 1/2 + h,  D = 1/2 − h,  0 < h < 1/100
    τ = q(1 − η²),  z = q^D η,  X = r² / (2q)
    u_θ = q^(−A) E(X, η),  u_z = q^(−A) U(X, η),  r·u_r = V₀(X, η)
    p   = q^(−2A) Π(X, η),  Π(X, η) = −∫_X^∞ E(x, η)² / (2x) dx

由此得到论文给出的标度（本模块用数值方式复核，见 tests/test_ns_field.py）：

    ℓ_r ≍ τ^(1/2),  ℓ_z ≍ τ^(1/2−h)  ⟹  ℓ_z/ℓ_r ≍ τ^(−h) → ∞
    ‖u_θ‖, ‖u_z‖ ≍ τ^(−1/2−h),  ‖u_r‖ = O(τ^(−1/2))

**哪些是论文的、哪些是我选的**（界面与文档必须保持这个区分）：

* 照搬：相似坐标、指数 A/D、上述标度、压力积分 Π 的形式、不可压条件。
* 自选：剖面 E、U 的具体形状（论文 §4 用隐式 profile 方程构造，无闭式解）。
  本模块取「单参数核 + 幂律尾」族：

      s(X)      = √X / (1 + (X/X₀)^(h+1))            # 近轴 √X、远场 X^(−1/2−h)
      E(X, η)   = c∞ · sech²(η/η₀) · s(X)
      U(X, η)   = c∞ · α · η · sech²(η/η₀) · s(X)

  近轴 E ≈ c∞·√X 使 u_θ = E/√(2X) 在轴上光滑（论文要求），远场 E ~ X^(−1/2−h)
  与论文衰减一致；U ∝ η 使 u_z 在 z=0 两侧反向（论文 §2「分层两侧上下流出」）。
* 未复现：§7 的环带振荡脉冲、§10 的光滑紧支外力、§4 的精确剖面。
  因此本场是**前导阶自相似解**，不是论文定理 1.1 的完整构造，不能用来宣称证明。
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Protocol

import numpy as np

__all__ = [
    "SimilarityParams",
    "NSField",
    "SimilarityField",
    "ArrayField",
    "profile_table",
    "inverse_map",
    "velocity_at",
]


@dataclass(frozen=True)
class SimilarityParams:
    """剖面参数。h 是论文里的小指数，X₀/η₀/α 控制核心粗细与轴向包络。"""

    h: float = 0.005  # 论文约束 0 < h < 1/100；UI 允许放大到 0.2 仅作视觉演示
    x0: float = 0.6  # 核心尺度（相似坐标 X 方向）
    eta0: float = 1.0  # 轴向包络宽度
    c_inf: float = 1.0  # 远场涡量强度系数
    alpha: float = 0.6  # 轴向速度相对强度
    nu: float = 1e-3  # 运动黏度（仅用于 Re 诊断）
    t_blow: float = 1.0  # 奇异时间 T*

    def __post_init__(self) -> None:
        if not (0.0 < self.h < 0.5):
            raise ValueError("h 必须落在 0 < h < 1/2（论文证明要求 h < 1/100）")
        if self.x0 <= 0 or self.eta0 <= 0:
            raise ValueError("x0 / eta0 必须为正")

    @property
    def paper_compliant(self) -> bool:
        """h 是否落在论文 §2 允许的 0 < h < 1/100 区间。"""
        return self.h < 0.01

    @property
    def A(self) -> float:
        return 0.5 + self.h

    @property
    def D(self) -> float:
        return 0.5 - self.h

    def with_(self, **kw) -> "SimilarityParams":
        return replace(self, **kw)


class NSField(Protocol):
    """只读三维流场接口：渲染层只认这个，不认具体是解析解还是文件。"""

    def velocity(self, points: np.ndarray, t: float) -> np.ndarray:
        """points: (N, 3) 物理坐标 (x, y, z)；返回 (N, 3) 速度。"""

    def time_bounds(self) -> tuple[float, float]:
        """可用时间区间 [t0, t1)。"""


# --------------------------------------------------------------------------- #
# 相似坐标
# --------------------------------------------------------------------------- #


def _tau(t: float, p: SimilarityParams) -> float:
    tau = p.t_blow - float(t)
    if tau <= 0.0:
        raise ValueError("t 必须小于奇异时间 T*")
    return tau


def _q_from_eta(eta: np.ndarray, tau: float) -> np.ndarray:
    """q = τ / (1 − η²)。|η|→1 时 q→∞，对应 z 方向被无限拉长。"""
    denom = 1.0 - np.square(eta)
    denom = np.maximum(denom, 1e-9)
    return tau / denom


def inverse_map(
    z: np.ndarray, r: np.ndarray, t: float, p: SimilarityParams, *, iters: int = 12
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """物理坐标 → 相似坐标 (X, η, q)。

    解 τ = q − z²·q^(1−2D) 里的 q（论文写作 q ≍ τ + |z|^(1/D)）。
    初值取该渐近式，Newton 迭代 12 次；与前端 shader 里 4 次迭代的结果在
    可视化精度内一致（见 docs/NS_VORTEX.md）。
    """
    tau = _tau(t, p)
    D = p.D
    z = np.asarray(z, dtype=np.float64)
    r = np.asarray(r, dtype=np.float64)

    q = tau + np.power(np.abs(z), 1.0 / D)
    q = np.maximum(q, 1e-12)
    for _ in range(iters):
        f = q - np.square(z) * np.power(q, 1.0 - 2.0 * D) - tau
        fp = 1.0 + (2.0 * D - 1.0) * np.square(z) * np.power(q, -2.0 * D)
        q = np.maximum(q - f / fp, 1e-12)

    eta = z / np.power(q, D)
    eta = np.clip(eta, -0.999999, 0.999999)
    X = np.square(r) / (2.0 * q)
    return X, eta, q


# --------------------------------------------------------------------------- #
# 剖面
# --------------------------------------------------------------------------- #


def _sech2(u: np.ndarray) -> np.ndarray:
    return 1.0 / np.cosh(np.clip(u, -40.0, 40.0)) ** 2


def _shape(X: np.ndarray, p: SimilarityParams) -> np.ndarray:
    """s(X) = √X / (1 + (X/X₀)^(h+1))：近轴 √X、远场 X^(−1/2−h)。"""
    X = np.maximum(X, 0.0)
    return np.sqrt(X) / (1.0 + np.power(X / p.x0, p.h + 1.0))


def profile_table(
    p: SimilarityParams, *, n_x: int = 512, n_eta: int = 257, x_max: float = 40.0
):
    """在相似坐标 (X, η) 上算 E、U、V₀ 三张表（CPU 侧唯一的重活）。

    返回 dict：
        X (n_x,), eta (n_eta,), E (n_eta, n_x), U (n_eta, n_x), V0 (n_eta, n_x)

    V₀ 由不可压条件沿 X 积分得到：
        ∂_X V₀ = −q ∂_z u_z = − ∂_η U / (1 + 2D η²/(1−η²))
    （推导见模块 docstring；结果与 τ 无关，是纯相似剖面。）
    """
    # X 在轴上用二次加密：E ~ √X 的区域只有前几个百分点，等距网格会把近轴插值成 ∝X
    u = np.linspace(0.0, 1.0, n_x)
    X = x_max * u * u
    eta = np.linspace(-0.995, 0.995, n_eta)

    Xg, Eg = np.meshgrid(X, eta)  # (n_eta, n_x)
    s = _shape(Xg, p)
    env = _sech2(Eg / p.eta0)

    E = p.c_inf * env * s
    U = p.c_inf * p.alpha * Eg * env * s

    # ∂_η U 用解析式，避免数值差分在 η→±1 处放大噪声
    # ---- V₀：由不可压条件 ∂_X V₀ = −q ∂_z u_z（**固定 r**）沿 X 积分 ------
    # 关键：∂_z 要在固定 r 下求。u_z = q^(−A)U(X,η) 里 q、η、X 都随 z 变
    # （X = r²/(2q)），只对 η 求导会漏掉 X 那一支，残差 10–40%。
    tau_ref = 0.5  # 只用来标定 η→z 的映射，结果与 τ 无关
    d_z = 1e-4

    def _q(e):
        return tau_ref / np.maximum(1.0 - e * e, 1e-9)

    def _uz_at(z_phys, r_phys):
        Xq, eq, qq = inverse_map(z_phys, r_phys, tau_ref, p)
        _, Uq, _ = _sample(
            {"u": u, "X": X, "eta": eta, "E": E, "U": U, "V0": np.zeros_like(U)}, Xq, eq
        )
        return np.power(qq, -p.A) * Uq

    q_row = _q(eta)[:, None]  # (n_eta, 1)
    z_row = np.power(q_row, p.D) * eta[:, None]  # (n_eta, 1)
    r_grid = np.sqrt(2.0 * q_row * X[None, :])  # (n_eta, n_x)

    duz_dz = (_uz_at(z_row + d_z, r_grid) - _uz_at(z_row - d_z, r_grid)) / (2.0 * d_z)
    integrand = -q_row * duz_dz
    dX = np.diff(X, prepend=X[0])  # 非均匀网格：必须逐格乘步长
    V0 = np.cumsum(integrand * dX, axis=1)
    V0[:, 0] = 0.0

    return {"u": u, "X": X, "eta": eta, "E": E, "U": U, "V0": V0}


def _sample(table: dict, X: np.ndarray, eta: np.ndarray):
    """双线性查表：X 轴按 u=√(X/X_max) 均匀（近轴加密）、η 轴均匀。"""
    us = table["u"]
    es = table["eta"]
    nx, ne = us.size, es.size

    fu = np.clip(
        np.sqrt(np.maximum(X, 0.0) / table["X"][-1]) * (nx - 1), 0.0, nx - 1.000001
    )
    fe = np.clip((eta - es[0]) / (es[-1] - es[0]) * (ne - 1), 0.0, ne - 1.000001)
    i0 = fu.astype(np.int64)
    j0 = fe.astype(np.int64)
    tu = fu - i0
    te = fe - j0

    def get(field):
        a = field[j0, i0] * (1 - tu) + field[j0, i0 + 1] * tu
        b = field[j0 + 1, i0] * (1 - tu) + field[j0 + 1, i0 + 1] * tu
        return a * (1 - te) + b * te

    return get(table["E"]), get(table["U"]), get(table["V0"])


def velocity_at(r, z, t: float, p: SimilarityParams, table: dict | None = None):
    """返回柱坐标速度 (u_r, u_θ, u_z)。"""
    if table is None:
        table = profile_table(p)
    X, eta, q = inverse_map(z, r, t, p)
    E, U, V0 = _sample(table, X, eta)
    qA = np.power(q, -p.A)
    u_theta = qA * E
    u_z = qA * U
    r_safe = np.maximum(np.asarray(r, dtype=np.float64), 1e-12)
    u_r = V0 / r_safe
    return u_r, u_theta, u_z


# --------------------------------------------------------------------------- #
# 场对象
# --------------------------------------------------------------------------- #


class SimilarityField:
    """解析自相似场，实现 NSField 协议（点采样，无状态）。"""

    def __init__(
        self,
        params: SimilarityParams | None = None,
        *,
        n_x: int = 512,
        n_eta: int = 257,
    ):
        self.params = params or SimilarityParams()
        self.table = profile_table(self.params, n_x=n_x, n_eta=n_eta)

    def velocity(self, points: np.ndarray, t: float) -> np.ndarray:
        pts = np.asarray(points, dtype=np.float64).reshape(-1, 3)
        r = np.hypot(pts[:, 0], pts[:, 1])
        theta = np.arctan2(pts[:, 1], pts[:, 0])
        u_r, u_th, u_z = velocity_at(r, pts[:, 2], t, self.params, self.table)
        out = np.empty_like(pts)
        out[:, 0] = u_r * np.cos(theta) - u_th * np.sin(theta)
        out[:, 1] = u_r * np.sin(theta) + u_th * np.cos(theta)
        out[:, 2] = u_z
        return out

    def time_bounds(self) -> tuple[float, float]:
        return 0.0, float(self.params.t_blow)

    def with_params(self, **kw) -> "SimilarityField":
        return SimilarityField(self.params.with_(**kw))


def _read_hdf5(path, group: str | None = None) -> dict[str, np.ndarray]:
    """读 HDF5：优先 `group`，否则找第一个同时含 x/y/z/u/v/w 的组（含根）。"""
    try:
        import h5py  # type: ignore
    except Exception as exc:  # pragma: no cover - 取决于环境
        raise ImportError("读 .h5/.hdf5 需要 h5py：pip install h5py") from exc

    need = {"x", "y", "z", "u", "v", "w"}
    with h5py.File(path, "r") as fh:
        node = fh[group] if group else None
        if node is None:
            candidates = [fh]
            fh.visit(
                lambda name: (
                    candidates.append(fh[name])
                    if isinstance(fh[name], h5py.Group)
                    else None
                )
            )
            for cand in candidates:
                if need.issubset(set(cand.keys())):
                    node = cand
                    break
        if node is None:
            raise KeyError(f"{path} 里找不到同时包含 {sorted(need)} 的组")
        data = {
            key: np.asarray(node[key][()])
            for key in node.keys()
            if key in need | {"t", "scattered"}
        }
    if "t" not in data:
        data["t"] = np.array([0.0])
    return data


class ArrayField:
    """从文件加载的场（.npz 或 .h5/.hdf5：t/x/y/z/u/v/w，可选 scattered）。

    规则网格：x/y/z 是坐标轴，u 形状 (nz,ny,nx) 或 (nt,nz,ny,nx)。
    散点/非结构：x/y/z 是点表（长度 N），u 形状 (N,) 或 (nt,N)；可用 `scattered=True` 显式声明。
    HDF5 需要 h5py（可选依赖），组内键名与 npz 一致。
    """

    def __init__(self, path: str, *, group: str | None = None):
        suffix = str(path).lower().rsplit(".", 1)[-1]
        if suffix in ("h5", "hdf5"):
            data = _read_hdf5(path, group)
        else:
            data = np.load(path)
        self.t = np.asarray(data["t"], dtype=np.float64)
        self.x = np.asarray(data["x"], dtype=np.float64)
        self.y = np.asarray(data["y"], dtype=np.float64)
        self.z = np.asarray(data["z"], dtype=np.float64)
        self.u = np.asarray(data["u"], dtype=np.float32)
        self.v = np.asarray(data["v"], dtype=np.float32)
        self.w = np.asarray(data["w"], dtype=np.float32)
        # 两种形态：规则网格（x/y/z 是坐标轴，u 形状 (nz,ny,nx) 或 (nt,nz,ny,nx)）
        # 与散点/非结构（x/y/z 是点表，长度 N，u 形状 (N,) 或 (nt,N)）
        hint = data.get("scattered") if hasattr(data, "get") else None
        if hint is not None:
            self.scattered = bool(hint)
        else:
            self.scattered = bool(
                self.x.ndim == 1
                and self.x.size == self.y.size == self.z.size
                and self.x.size > 8
                and self.u.shape[-1] == self.x.size
            )
        self._cells: dict | None = None

    def time_bounds(self) -> tuple[float, float]:
        return float(self.t[0]), float(self.t[-1])

    @property
    def times(self) -> list[float]:
        return [float(v) for v in self.t]

    @property
    def bounds(self):
        return (
            (float(self.x[0]), float(self.y[0]), float(self.z[0])),
            (float(self.x[-1]), float(self.y[-1]), float(self.z[-1])),
        )

    def _build_cells(self) -> None:
        """把散点装进均匀桶网格（每桶约 1 个点），查询时只看 3×3×3 邻域。"""
        lo = np.array([self.x.min(), self.y.min(), self.z.min()], dtype=float)
        hi = np.array([self.x.max(), self.y.max(), self.z.max()], dtype=float)
        span = np.maximum(hi - lo, 1e-9)
        n = self.x.size
        cell = float(np.cbrt(span.prod() / max(n, 1)) * 2.0)
        cell = max(cell, float(span.max()) / 64.0)
        idx = np.floor((np.stack([self.x, self.y, self.z], axis=1) - lo) / cell).astype(
            np.int64
        )
        buckets: dict[tuple[int, int, int], list[int]] = {}
        for i, key in enumerate(map(tuple, idx)):
            buckets.setdefault(key, []).append(i)
        self._cells = {"lo": lo, "cell": cell, "buckets": buckets}

    def _scattered_velocity(self, pts: np.ndarray, t: float) -> np.ndarray:
        if self._cells is None:
            self._build_cells()
        assert self._cells is not None
        lo, cell, buckets = (
            self._cells["lo"],
            self._cells["cell"],
            self._cells["buckets"],
        )
        ti = int(np.argmin(np.abs(self.t - t)))
        U = self.u[ti] if self.u.ndim == 2 else self.u
        V = self.v[ti] if self.v.ndim == 2 else self.v
        W = self.w[ti] if self.w.ndim == 2 else self.w
        coords = np.stack([self.x, self.y, self.z], axis=1)
        out = np.zeros((pts.shape[0], 3), dtype=np.float64)
        keys = np.floor((pts - lo) / cell).astype(np.int64)
        # 反距离加权（IDW，p=2）：最近点会让速度场出现块状跳变，
        # 加权后至少在邻域内连续；权重只在 3×3×3 桶内取，成本与点数无关。
        for j, key in enumerate(map(tuple, keys)):
            idx: list[int] = []
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for dz in (-1, 0, 1):
                        idx.extend(
                            buckets.get((key[0] + dx, key[1] + dy, key[2] + dz), ())
                        )
            if not idx:
                continue
            cand = np.asarray(idx, dtype=np.int64)
            d2 = np.sum((coords[cand] - pts[j]) ** 2, axis=1)
            if float(d2.min()) < 1e-18:
                out[j] = (
                    float(U[cand[int(np.argmin(d2))]]),
                    float(V[cand[int(np.argmin(d2))]]),
                    float(W[cand[int(np.argmin(d2))]]),
                )
                continue
            w = 1.0 / (d2 + 1e-12)
            w = w / w.sum()
            out[j] = (
                float(np.dot(w, U[cand])),
                float(np.dot(w, V[cand])),
                float(np.dot(w, W[cand])),
            )
        return out

    def _frame(self, t: float) -> np.ndarray:
        """取最接近 t 的那一帧，形状统一成 `(nz, ny, nx, 3)`。"""
        ti = int(np.argmin(np.abs(self.t - t)))
        stack = np.stack(
            [
                self.u[ti] if self.u.ndim == 4 else self.u,
                self.v[ti] if self.v.ndim == 4 else self.v,
                self.w[ti] if self.w.ndim == 4 else self.w,
            ],
            axis=-1,
        )
        if stack.shape[:3] != (self.z.size, self.y.size, self.x.size):
            raise ValueError(
                f"ArrayField 期望 u/v/w 形状 (nz,ny,nx) 或 (nt,nz,ny,nx)，"
                f"实际 {stack.shape[:3]}，坐标 {self.z.size}×{self.y.size}×{self.x.size}"
            )
        return stack.astype(np.float64)

    def velocity(self, points: np.ndarray, t: float) -> np.ndarray:
        """规则网格上的三线性插值（越界按最近边界夹住）。"""
        pts = np.asarray(points, dtype=np.float64).reshape(-1, 3)
        if self.scattered:
            return self._scattered_velocity(pts, t)
        grid = self._frame(t)

        def axis(coord, values):
            i = np.searchsorted(values, coord) - 1
            i = np.clip(i, 0, values.size - 2)
            span = values[i + 1] - values[i]
            frac = np.clip(
                (coord - values[i]) / np.where(span == 0, 1.0, span), 0.0, 1.0
            )
            return i, frac

        ix, fx = axis(pts[:, 0], self.x)
        iy, fy = axis(pts[:, 1], self.y)
        iz, fz = axis(pts[:, 2], self.z)
        out = np.zeros((pts.shape[0], 3), dtype=np.float64)
        for dz in (0, 1):
            wz = fz if dz else 1.0 - fz
            for dy in (0, 1):
                wy = fy if dy else 1.0 - fy
                for dx in (0, 1):
                    wx = fx if dx else 1.0 - fx
                    w = wz * wy * wx
                    out += w[:, None] * grid[iz + dz, iy + dy, ix + dx]
        return out


@dataclass(frozen=True)
class PhysicalParams:
    """物理量旋钮（给界面用）：环量 Γ、轴向拉伸 a、涡核半径 r_core。

    与 `SimilarityParams` 的关系是**一步映射**，不是新模型：
    - r_core：自相似剖面里 Ω 降到轴上值一半的位置。Ω ∝ 1/(1+(X/X₀)^{1+h})，
      该点在 X≈X₀，而 X=r²/(2q) → 取 q=0.5 得 r_core≈sqrt(X₀)，故 X₀ = r_core²。
    - a：直接就是相似解里的轴向/径向速度比 α（U = c∞·α·η·g(η)·…）。
    - Γ：在 r=2·r_core 的圆周上测到的环量；用它反算剖面幅值 c∞，
      保证「界面上写多少 Γ，画面上那个圆上就是多少环量」。
    """

    gamma: float = 4.26
    a: float = 0.6
    r_core: float = 0.775
    h: float = 0.005
    eta0: float = 1.0
    nu: float = 1e-3
    t_blow: float = 1.0

    def to_similarity(self) -> "SimilarityParams":
        if not (0.02 <= self.r_core <= 3.0):
            raise ValueError("r_core 必须在 0.02..3.0")
        if not (0.02 <= self.a <= 6.0):
            raise ValueError("a 必须在 0.02..6.0")
        x0 = float(self.r_core) ** 2
        c_inf = float(self.gamma) / _circulation_unit(
            x0, float(self.eta0), float(self.h), r_ref=float(self.r_core)
        )
        return SimilarityParams(
            h=self.h,
            x0=x0,
            eta0=self.eta0,
            c_inf=c_inf,
            alpha=float(self.a),
            nu=self.nu,
            t_blow=self.t_blow,
        )


def _circulation_unit(
    x0: float, eta0: float, h: float, *, r_ref: float = 0.775
) -> float:
    """c∞=1 时，r=2·r_core 圆周上的环量（η=0 赤道面，q 取 0.5）。"""
    q = 0.5
    r = 2.0 * r_ref
    X = r * r / (2.0 * q)
    E = np.sqrt(X) / (1.0 + (X / x0) ** (h + 1.0))
    u_theta = q ** -(0.5 + h) * E
    return float(2.0 * np.pi * r * u_theta)
