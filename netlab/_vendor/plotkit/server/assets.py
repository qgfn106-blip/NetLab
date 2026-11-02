"""静态资源位置（plotly bundle 已于 P13-09 删除，渲染统一走 matplotlib，D33）。"""

from __future__ import annotations

from pathlib import Path

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
