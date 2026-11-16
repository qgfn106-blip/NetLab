"""频响数值健康诊断（只读，不改变求解算法与数值结果）。

按审批口径：默认实时路径不做诊断；仅当 ``NETLAB_FREQ_DIAG=1``（显式诊断/测试）
时才计算每频点残差与（可选）条件数。``point_diagnostics`` 复用调用方已求得的解，
不重复求解。
"""

from __future__ import annotations

import os

import numpy as np

ILL_THRESHOLD = 1.0e-6
COND_THRESHOLD = 1.0e12


def cond_enabled() -> bool:
    """是否处于显式诊断路径（环境变量 NETLAB_FREQ_DIAG=1）。"""
    return os.environ.get("NETLAB_FREQ_DIAG") == "1"


def point_diagnostics(
    matrix: np.ndarray,
    rhs: np.ndarray,
    solution: np.ndarray,
) -> dict[str, object]:
    """基于已求得的解评估单个频点数值健康度（不重新求解）。"""
    m = np.asarray(matrix)
    b = np.asarray(rhs)
    x = np.asarray(solution)
    finite = bool(np.all(np.isfinite(m)) and np.all(np.isfinite(x)))
    rel: float | None = None
    if finite:
        numerator = float(np.linalg.norm(m @ x - b))
        denominator = (
            float(np.linalg.norm(m)) * float(np.linalg.norm(x))
            + float(np.linalg.norm(b))
        )
        rel = numerator / denominator if denominator > 1e-300 else numerator
    ill = (not finite) or (rel is not None and rel > ILL_THRESHOLD)
    cond: float | None = None
    if cond_enabled() or ill:
        try:
            cond = float(np.linalg.cond(m))
        except Exception:
            cond = None
        if cond is not None and cond > COND_THRESHOLD:
            ill = True
    return {
        "solver_ok": bool(finite),
        "finite": finite,
        "rel_residual": rel,
        "ill_conditioned": bool(ill),
        "cond_est": cond,
    }


def summarize(points: list[dict[str, object]]) -> dict[str, object]:
    max_rel: float | None = None
    max_cond: float | None = None
    any_ill = False
    for point in points:
        rel = point.get("rel_residual")
        if rel is not None:
            max_rel = rel if max_rel is None else max(max_rel, float(rel))
        cond = point.get("cond_est")
        if cond is not None:
            max_cond = cond if max_cond is None else max(max_cond, float(cond))
        if point.get("ill_conditioned"):
            any_ill = True
    return {
        "threshold": ILL_THRESHOLD,
        "cond_threshold": COND_THRESHOLD,
        "diag_enabled": cond_enabled(),
        "any_ill_conditioned": any_ill,
        "max_rel_residual": max_rel,
        "max_cond_est": max_cond,
        "points": points,
    }
