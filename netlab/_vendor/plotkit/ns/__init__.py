"""Navier–Stokes 涡旋可视化（任务书 m05966，模式 A′：前导阶自相似解）。

模块划分（对应任务书要求的十件套）：

    field.py         NSField 协议 / SimilarityField（解析场）/ ArrayField（npz）
    diagnostics.py   VortexStats：解析列 + N³ 网格列 + 收敛趋势

后续阶段（数据接口 → 三维场景 → 动态演化 → 交互 → 导出）都建立在这两个模块上，
渲染层只依赖 `NSField` 协议，不依赖解析场的实现细节。
"""

from .diagnostics import VortexStats, analyze, convergence, grid_stats
from .field import (
    ArrayField,
    NSField,
    SimilarityField,
    SimilarityParams,
    inverse_map,
    profile_table,
    velocity_at,
)

__all__ = [
    "NSField",
    "SimilarityField",
    "SimilarityParams",
    "ArrayField",
    "VortexStats",
    "analyze",
    "convergence",
    "grid_stats",
    "inverse_map",
    "profile_table",
    "velocity_at",
]

from . import scene  # noqa: E402,F401
