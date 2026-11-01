"""netlab 原生（Qt）界面层。

本包只负责「显示与交互」：数据一律来自 :data:`netlab.server.SERVICE`，
几何计算在 :mod:`netlab.ui.geometry`，投影在 :mod:`netlab.ui.models`。

约束（见 docs/QT_NATIVE_SPEC.md）：
- 求解器、工程格式、API 契约一行不改；
- 除 ``plotkit_panel`` 外，任何模块都不得 import ``QtWebEngineWidgets``；
- ``models`` / ``geometry`` 不 import Qt，可直接单测。
"""

from __future__ import annotations

__all__ = ["__version__"]

__version__ = "1.0.0"
