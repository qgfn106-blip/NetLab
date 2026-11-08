"""求解器影子验证（D-5 / N-19）。

任何数值求解器改动都应先经过 ``off -> shadow -> on`` 的验证流程：
``off`` 表示旧路径，``shadow`` 表示新旧同时计算并比较、但不改变输出，
``on`` 表示新路径。本模块只提供结果比较与门控，不依赖具体求解器。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import numpy as np

SHADOW_MODES = ("off", "shadow", "on")
DEFAULT_RTOL = 1.0e-10
DEFAULT_ATOL = 1.0e-12


@dataclass(frozen=True)
class ShadowComparison:
    """一次影子比较的结果。"""

    mode: str
    max_abs_error: float
    max_rel_error: float
    passed: bool


def shadow_gate(
    reference: Sequence[float] | np.ndarray,
    candidate: Sequence[float] | np.ndarray,
    *,
    mode: str = "shadow",
    rtol: float = DEFAULT_RTOL,
    atol: float = DEFAULT_ATOL,
) -> ShadowComparison:
    """比较参考解与候选解，并返回可审计的门控结果。

    ``mode="off"`` 不比较（旧路径本身），``shadow`` 与 ``on`` 都必须满足
    ``max_rel_error <= rtol`` 且 ``max_abs_error <= atol + rtol*|reference|``。
    非有限值直接判为失败，不会因 ``NaN`` 比较而静默通过。
    """
    if mode not in SHADOW_MODES:
        raise ValueError(f"未知影子模式：{mode!r}，可选 {SHADOW_MODES}")
    ref = np.asarray(reference, dtype=float)
    cand = np.asarray(candidate, dtype=float)
    if ref.shape != cand.shape:
        raise ValueError(f"影子比较形状不一致：{ref.shape} vs {cand.shape}")
    if mode == "off":
        return ShadowComparison(mode=mode, max_abs_error=0.0, max_rel_error=0.0, passed=True)

    diff = np.abs(ref - cand)
    scale = np.maximum(np.abs(ref), np.abs(cand))
    max_abs = float(np.max(diff)) if diff.size else 0.0
    max_rel = float(np.max(diff / np.maximum(scale, np.finfo(float).tiny))) if diff.size else 0.0
    finite = bool(np.all(np.isfinite(ref)) and np.all(np.isfinite(cand)))
    tolerance = atol + rtol * np.maximum(np.abs(ref), np.abs(cand))
    passed = finite and bool(np.all(diff <= tolerance))
    return ShadowComparison(mode=mode, max_abs_error=max_abs, max_rel_error=max_rel, passed=passed)


def assert_shadow_agreement(
    reference: Sequence[float] | np.ndarray,
    candidate: Sequence[float] | np.ndarray,
    *,
    mode: str = "shadow",
    rtol: float = DEFAULT_RTOL,
    atol: float = DEFAULT_ATOL,
) -> ShadowComparison:
    """门控失败时抛出带数值证据的 ``AssertionError``。"""
    result = shadow_gate(reference, candidate, mode=mode, rtol=rtol, atol=atol)
    if not result.passed:
        raise AssertionError(
            "求解器影子门失败："
            f"mode={result.mode}, max_abs={result.max_abs_error:.3e}, "
            f"max_rel={result.max_rel_error:.3e}, rtol={rtol:.1e}, atol={atol:.1e}"
        )
    return result
