"""跨版本兼容垫片。

PlotKit 支持 matplotlib 3.6+ / numpy 1.23+ / Python 3.10+，但上游 API 删得很干脆：

- ``matplotlib.cm.get_cmap`` 在 matplotlib 3.9 被删除（只留 ``matplotlib.colormaps`` 注册表）；
- ``numpy.trapezoid`` 是 numpy 2.0 才改的名（1.x 叫 ``numpy.trapz``）。

所有调用点都从这里走，避免在每个后端里各写一遍 try/except（2026-11-01 在 WSL 上
matplotlib 版本较新时 ``hybrid3d`` 就因此报过 ``AttributeError: module 'matplotlib.cm'
has no attribute 'get_cmap'``）。
"""

from __future__ import annotations

import numpy as np

__all__ = ["get_cmap", "trapezoid", "versions", "MIN_VERSIONS"]


#: 各依赖的最低可用版本。`plotkit doctor` 用它给结论，`pyproject.toml` 用同一套口径。
MIN_VERSIONS = {
    "python": (3, 10),
    "numpy": (1, 23),
    "matplotlib": (3, 6),
    "pillow": (9, 0),
}


def get_cmap(name: str | None):
    """按名字取 colormap，兼容 matplotlib 3.6–3.13。

    mpl ≥3.6 有 ``matplotlib.colormaps`` 注册表；更老的版本只有 ``cm.get_cmap``。
    """
    import matplotlib

    cmaps = getattr(matplotlib, "colormaps", None)
    if cmaps is not None:
        try:
            return cmaps[name or "viridis"]
        except (KeyError, ValueError) as exc:  # 名字写错要报清楚，不要静默换默认
            raise ValueError(f"未知 colormap: {name!r}") from exc
    from matplotlib import cm  # pragma: no cover - 老版本兜底

    return cm.get_cmap(name or "viridis")


def trapezoid(y, x=None, dx: float = 1.0):
    """梯形积分，兼容 numpy 1.x（``trapz``）与 2.x（``trapezoid``）。"""
    fn = getattr(np, "trapezoid", None) or getattr(np, "trapz")  # noqa: B009
    return float(fn(y, x=x, dx=dx))


def versions() -> dict[str, str]:
    """当前环境里各依赖的版本（缺失的记为 ``"missing"``）。"""
    import platform
    import sys

    out = {
        "python": platform.python_version(),
        "executable": sys.executable,
        "numpy": np.__version__,
    }
    from importlib import metadata as _md

    for name, module, dist in (
        ("matplotlib", "matplotlib", "matplotlib"),
        ("pillow", "PIL", "pillow"),
        ("fastapi", "fastapi", "fastapi"),
        ("uvicorn", "uvicorn", "uvicorn"),
        ("pyvista", "pyvista", "pyvista"),
        ("vtk", "vtk", "vtk"),
        ("pywebview", "webview", "pywebview"),
        ("psutil", "psutil", "psutil"),
    ):
        try:
            mod = __import__(module)
        except Exception:  # noqa: BLE001 - 缺依赖是正常情况
            out[name] = "missing"
            continue
        version = getattr(mod, "__version__", None)
        if not version:  # pywebview 6.x 去掉了 __version__，退回发行版元数据
            try:
                version = _md.version(dist)
            except Exception:  # noqa: BLE001
                version = "unknown"
        out[name] = str(version)
    return out
