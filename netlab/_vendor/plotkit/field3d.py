"""三维流体场 → PlotKit 图层的通用翻译层。

这一层的存在理由：三维流场数据长得千奇百怪（解析场、CFD 网格、粒子轨迹、PIV 实测），
但"画出来"只需要两件事——**在任意点求速度**，以及**知道计算域有多大**。
所以契约只有一个必选方法：

```python
class Field3D(Protocol):
    def velocity(self, points: (N, 3) float, t: float) -> (N, 3): ...
    bounds: tuple[lo(3), hi(3)]        # 可选，默认 [-0.5,-0.5,-1.2]…[0.5,0.5,1.2]
    times: list[float]                 # 可选，默认 [0.0]
```

满足它就能一行得到可渲染的 `Figure`：

```python
import plotkit as pk
fig = pk.field3d.scene(my_field, t=0.05)     # volume + particles + streamlines
```

图层词汇表刻意不扩张：只用 `volume` / `particles` / `segments` 三种既有图层，
渲染器（mpl / pyvista / 浏览器 WebGL）完全复用，不新增 kind。
"""

from __future__ import annotations

from typing import Any, Iterable, Protocol, Sequence, runtime_checkable

import numpy as np

DEFAULT_BOUNDS = ((-0.5, -0.5, -1.2), (0.5, 0.5, 1.2))


@runtime_checkable
class Field3D(Protocol):
    """三维流场的最小契约：能在任意点、任意时刻给出速度。"""

    def velocity(self, points: np.ndarray, t: float) -> np.ndarray:  # pragma: no cover
        ...


def bounds_of(
    field: Any,
) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    """取场的包围盒；没有就退回默认盒子（保证 scene() 永远能跑）。"""
    b = getattr(field, "bounds", None)
    if b is None:
        return DEFAULT_BOUNDS
    lo, hi = b
    lo = tuple(float(v) for v in lo)
    hi = tuple(float(v) for v in hi)
    if len(lo) != 3 or len(hi) != 3:
        return DEFAULT_BOUNDS
    return lo, hi


def times_of(field: Any) -> list[float]:
    ts = getattr(field, "times", None)
    if not ts:
        return [0.0]
    return [float(v) for v in ts]


def _velocity(field: Any, pts: np.ndarray, t: float) -> np.ndarray:
    v = np.asarray(field.velocity(pts, t), dtype=np.float64)
    v = v.reshape(-1, 3)
    if not np.all(np.isfinite(v)):
        v = np.nan_to_num(v, nan=0.0, posinf=0.0, neginf=0.0)
    return v


def sample_velocity(
    field: Any,
    t: float,
    *,
    n: int = 48,
    extent: float | None = None,
    z_extent: float | None = None,
    center: Sequence[float] | None = None,
):
    """在规则网格上采速度模长，返回 `(xs, ys, zs, speed(nz,ny,nx))`。

    `speed` 的布局（x 变化最快）就是 `/api/volume` 与 `fig.add("volume", …)` 的约定。
    """
    lo, hi = bounds_of(field)
    cx, cy, cz = (
        center
        if center is not None
        else ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2)
    )
    ex = (
        float(extent)
        if extent is not None
        else max(abs(hi[0] - cx), abs(cx - lo[0]), 1e-3)
    )
    ey = (
        float(extent)
        if extent is not None
        else max(abs(hi[1] - cy), abs(cy - lo[1]), 1e-3)
    )
    ez = (
        float(z_extent)
        if z_extent is not None
        else max(abs(hi[2] - cz), abs(cz - lo[2]), 1e-3)
    )

    n = max(8, int(n))
    xs = np.linspace(cx - ex, cx + ex, n)
    ys = np.linspace(cy - ey, cy + ey, n)
    zs = np.linspace(cz - ez, cz + ez, n)
    X, Y, Z = np.meshgrid(xs, ys, zs, indexing="ij")  # (nx, ny, nz)
    pts = np.stack([X.ravel(), Y.ravel(), Z.ravel()], axis=1)
    vel = _velocity(field, pts, t)
    speed = np.linalg.norm(vel, axis=1).reshape(n, n, n)
    return xs, ys, zs, np.transpose(speed, (2, 1, 0)).copy()  # → (nz, ny, nx)


def seed_points(
    field: Any,
    t: float,
    *,
    count: int = 12000,
    extent: float | None = None,
    z_extent: float | None = None,
    shells: int = 26,
    seed: int = 7,
    center: Sequence[float] | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """离散同心壳上的示踪种子（确定性），返回 `(xyz, speed)`。

    涡类流场向轴收缩，纯随机撒点几秒就糊成一团；按壳撒点才看得出"内旋 + 轴向拉伸"。
    """
    lo, hi = bounds_of(field)
    cx, cy, cz = (
        center
        if center is not None
        else ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2)
    )
    ex = (
        float(extent)
        if extent is not None
        else max(abs(hi[0] - cx), abs(cx - lo[0]), 1e-3)
    )
    ez = (
        float(z_extent)
        if z_extent is not None
        else max(abs(hi[2] - cz), abs(cz - lo[2]), 1e-3)
    )

    rng = np.random.default_rng(seed)
    count = max(64, int(count))
    shells = max(4, int(shells))
    n_disk = int(count * 0.85)
    n_col = count - n_disk

    idx = rng.integers(0, shells, n_disk)
    rad = ex * (idx + 0.5) / shells * (0.985 + 0.03 * rng.random(n_disk))
    th = rng.random(n_disk) * 2 * np.pi
    zz = (rng.random(n_disk) * 2 - 1) * 0.035 * ez
    disk = np.stack([cx + rad * np.cos(th), cy + rad * np.sin(th), cz + zz], axis=1)

    rad2 = 0.02 + 0.12 * ex * np.sqrt(rng.random(n_col))
    th2 = rng.random(n_col) * 2 * np.pi
    z2 = (rng.random(n_col) * 2 - 1) * ez
    taper = 1.0 - 0.78 * np.power(np.abs(z2) / max(ez, 1e-9), 1.1)
    col = np.stack(
        [cx + rad2 * taper * np.cos(th2), cy + rad2 * taper * np.sin(th2), cz + z2],
        axis=1,
    )

    xyz = np.concatenate([disk, col], axis=0)
    vel = _velocity(field, xyz, t)
    return xyz, np.linalg.norm(vel, axis=1)


def streamline_segments(
    field: Any,
    t: float,
    *,
    seeds: int = 28,
    steps: int = 90,
    dt: float = 0.02,
    extent: float | None = None,
    z_extent: float | None = None,
    seed: int = 11,
    center: Sequence[float] | None = None,
):
    """从一圈种子里 RK4 积分流线，返回 `segments` 图层要的**端点点对**。

    速度可能随 t 放大（自相似场按 τ^(-1/2-h) 发散），固定步长会把流线甩出计算域，
    所以单步位移超过域长 2% 时自动缩步长。
    """
    lo, hi = bounds_of(field)
    cx, cy, cz = (
        center
        if center is not None
        else ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2)
    )
    ex = (
        float(extent)
        if extent is not None
        else max(abs(hi[0] - cx), abs(cx - lo[0]), 1e-3)
    )
    ez = (
        float(z_extent)
        if z_extent is not None
        else max(abs(hi[2] - cz), abs(cz - lo[2]), 1e-3)
    )

    rng = np.random.default_rng(seed)
    xs: list[float] = []
    ys: list[float] = []
    zs: list[float] = []
    limit = 0.02 * max(ex, 1e-6)
    for i in range(max(1, int(seeds))):
        r0 = ex * (0.35 + 0.55 * rng.random())
        th = 2.0 * np.pi * (i + 0.5) / max(1, int(seeds))
        z0 = (rng.random() * 2.0 - 1.0) * 0.35 * ez
        p = np.array([cx + r0 * np.cos(th), cy + r0 * np.sin(th), cz + z0], dtype=float)
        prev = p.copy()
        for _ in range(max(2, int(steps))):
            v = _velocity(field, p[None, :], t)[0]
            speed = float(np.linalg.norm(v))
            if not np.isfinite(speed) or speed <= 0.0:
                break
            h = min(float(dt), limit / speed)
            k1 = v
            k2 = _velocity(field, (p + 0.5 * h * k1)[None, :], t)[0]
            k3 = _velocity(field, (p + 0.5 * h * k2)[None, :], t)[0]
            k4 = _velocity(field, (p + h * k3)[None, :], t)[0]
            p = p + (h / 6.0) * (k1 + 2 * k2 + 2 * k3 + k4)
            if not np.all(np.isfinite(p)) or abs(p[2] - cz) > ez * 1.25:
                break
            if np.hypot(p[0] - cx, p[1] - cy) > ex * 1.15:
                break
            xs.extend((prev[0], p[0]))
            ys.extend((prev[1], p[1]))
            zs.extend((prev[2], p[2]))
            prev = p.copy()
    return (
        np.asarray(xs, dtype=float),
        np.asarray(ys, dtype=float),
        np.asarray(zs, dtype=float),
    )


DEFAULT_LAYERS = ("volume", "particles", "streamlines")


def auto_n(field: Any, *, budget: int = 200_000, lo: int = 16, hi: int = 128) -> int:
    """三维 LOD：按采样点预算挑分辨率（体积/粒子都是 n³ 级别的采样）。

    有原生分辨率（`field.native_n` 或 ArrayField 的坐标轴长度）时不越界采样——
    对着 32³ 的数值解硬采 96³ 只会把插值误差放大，不会多出信息。
    """
    n = int(round(budget ** (1.0 / 3.0)))
    native = getattr(field, "native_n", None)
    if native is None:
        axes = [getattr(field, name, None) for name in ("x", "y", "z")]
        if all(a is not None and getattr(a, "ndim", 0) == 1 for a in axes):
            try:
                native = int(min(len(a) for a in axes))
            except TypeError:
                native = None
    if isinstance(native, (int, float)) and native > 1:
        n = min(n, int(native))
    return max(lo, min(hi, n))


def scene(
    field: Any,
    *,
    t: float = 0.0,
    layers: Iterable[str] = DEFAULT_LAYERS,
    iso: bool | None = None,
    n: int | str = 48,
    lod_budget: int = 200_000,
    extent: float | None = None,
    z_extent: float | None = None,
    particles: int = 12000,
    streamlines: int = 28,
    level: float = 0.80,
    seed: int = 7,
    title: str | None = None,
    size: tuple[float, float] = (7.2, 5.6),
    dpi: int = 110,
):
    """任意三维流场 → 一份可直接渲染的 `Figure`。

    `layers` 可选 `volume` / `particles` / `streamlines` 的任意组合（顺序无关）。
    """
    import plotkit as pk

    if isinstance(n, str):
        if n != "auto":
            raise ValueError(f"n 只能是整数或 'auto'，收到 {n!r}")
        n = auto_n(field, budget=lod_budget)
    wanted = {str(name) for name in layers}
    # iso 开关：True 强制带等值面层，False 强制去掉，None 跟随 layers
    if iso is True:
        wanted.add("volume")
    elif iso is False:
        wanted.discard("volume")
    xs, ys, zs, speed = sample_velocity(field, t, n=n, extent=extent, z_extent=z_extent)

    fig = pk.figure(size=size, dpi=dpi, title=title or f"3D field · t={t:.3f}")
    if "volume" in wanted:
        fig.add_data("vx", xs, role="coord")
        fig.add_data("vy", ys, role="coord")
        fig.add_data("vz", zs, role="coord")
        fig.add_data("speed", speed, role="field")
        fig.add(
            "volume",
            {"x": "vx", "y": "vy", "z": "vz", "values": "speed"},
            style={"level": float(level), "opacity": 0.30},
        )

    if "particles" in wanted and particles > 0:
        xyz, spd = seed_points(
            field, t, count=particles, extent=extent, z_extent=z_extent, seed=seed
        )
        fig.add_data("px", xyz[:, 0], role="auto")
        fig.add_data("py", xyz[:, 1], role="auto")
        fig.add_data("pz", xyz[:, 2], role="auto")
        fig.add_data("pc", spd, role="auto")
        fig.add(
            "particles",
            {"x": "px", "y": "py", "z": "pz", "scalar": "pc"},
            style={"markersize": 4.2, "opacity": 0.55},
        )

    if "streamlines" in wanted and streamlines > 0:
        sx, sy, sz = streamline_segments(
            field, t, seeds=streamlines, extent=extent, z_extent=z_extent, seed=seed
        )
        if sx.size:
            fig.add_data("sx", sx, role="auto")
            fig.add_data("sy", sy, role="auto")
            fig.add_data("sz", sz, role="auto")
            fig.add(
                "segments",
                {"x": "sx", "y": "sy", "z": "sz"},
                style={"width": 1.0, "color": "#73dbff"},
            )
    return fig
