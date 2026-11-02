"""NS 涡旋 → Figure 的薄封装。

通用能力（采样 / 播种 / 流线积分 / 场景拼装）已搬到 `plotkit.field3d`，
这里只负责"把 NS 的场对象交出去"，并保持 NS 侧的默认参数不变。
"""

from __future__ import annotations

from typing import Any

from .. import field3d
from ..field3d import sample_velocity as sample_speed  # 旧名字，保留兼容
from ..field3d import seed_points, streamline_segments  # noqa: F401  （对外仍可 import）
from .field import PhysicalParams, SimilarityField, SimilarityParams

__all__ = ["figure", "sample_speed", "seed_points", "streamline_segments"]


def figure(field: Any = None, *, t: float = 0.05, n: int = 48, particles: int = 12000,
           extent: float = 0.5, z_extent: float = 1.2, level: float | None = None,
           physical: PhysicalParams | None = None,
           similarity: SimilarityParams | None = None, title: str | None = None,
           streamlines: int = 28):
    """把 NS 场做成一份可直接喂给主查看器的 Figure。

    ```python
    import plotkit as pk
    fig = pk.ns.scene.figure(t=0.05, n=48)
    fig.render(width=900, height=700, backend="pyvista")   # 服务端出图
    ```
    """
    if field is None:
        if physical is not None:
            field = SimilarityField(physical.to_similarity())
        else:
            field = SimilarityField(similarity or SimilarityParams())

    return field3d.scene(field, t=t, n=n, particles=particles, streamlines=streamlines,
                         extent=extent, z_extent=z_extent,
                         level=0.80 if level is None else float(level),
                         title=title or f"NS vortex · t={t:.3f}")
