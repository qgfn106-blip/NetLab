"""宿主集成公开接口（v1）。

netlab 等宿主只允许经本模块使用 PlotKit 的服务端能力，不得 import
``plotkit.store.*`` / ``plotkit.server.*`` 的内部符号（C-4 / R2④）。

稳定承诺：
- ``API_VERSION`` 为接口代次；``create_server`` / ``PlotRenderPort`` / ``probe`` /
  ``store_lock`` / ``index_html`` 的签名变更必须 bump 本包次版本号；
- 本模块内部可以引用私有实现，但宿主不应看到这些细节。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

API_VERSION = "1"

_MIN_VERSION = (0, 2)
_MAX_VERSION = (0, 3)


def _version_tuple(version: str) -> tuple[int, ...]:
    parts: list[int] = []
    for chunk in str(version).split(".")[:3]:
        digits = "".join(ch for ch in chunk if ch.isdigit())
        parts.append(int(digits or 0))
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts)


def probe() -> dict[str, Any]:
    """返回 PlotKit 侧可用性判定（available / incompatible）。"""
    from . import __version__

    version = str(__version__)
    if _MIN_VERSION <= _version_tuple(version)[:2] < _MAX_VERSION:
        return {
            "state": "available",
            "version": version,
            "api_version": API_VERSION,
            "detail": "",
        }
    return {
        "state": "incompatible",
        "version": version,
        "api_version": API_VERSION,
        "detail": f"PlotKit {version} 不在 >=0.2,<0.3 兼容范围内",
    }


def create_server(
    figure: Any,
    *,
    title: str | None = None,
    layout_path: str | Path | None = None,
    with_ns: bool = False,
) -> Any:
    """创建可挂载的 ASGI 服务（宿主只依赖返回值可被 ``app.mount`` 使用）。"""
    from .server.app import create_app

    return create_app(figure, title=title, layout_path=layout_path, with_ns=with_ns)


class PlotRenderPort:
    """最小渲染端口：宿主只依赖 ``.app`` 与 ``.probe()``。"""

    def __init__(
        self,
        figure: Any,
        *,
        title: str | None = None,
        layout_path: str | Path | None = None,
        with_ns: bool = False,
    ) -> None:
        self.app = create_server(
            figure, title=title, layout_path=layout_path, with_ns=with_ns
        )

    @staticmethod
    def probe() -> dict[str, Any]:
        return probe()


def store_lock() -> Any:
    """数据锁：宿主同步线程与出图线程互斥用的公开锁对象。"""
    from .store.registry import DATA_LOCK

    return DATA_LOCK


def index_html() -> str:
    """读取 PlotKit 自带首页 HTML 原文（宿主需要在其上做同源包装时使用）。"""
    from .server.assets import STATIC_DIR

    return (Path(STATIC_DIR) / "index.html").read_text(encoding="utf-8")
