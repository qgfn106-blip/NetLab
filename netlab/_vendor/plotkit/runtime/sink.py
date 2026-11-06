"""展示出口：inline → window → browser 三级自动探测（D9）。

| sink | 触发条件 | 行为 |
|---|---|---|
| `inline` | 在 IPython/Jupyter 里（能拿到 `get_ipython`） | 内联自包含 HTML（SVG 直接嵌进页面，不需网络） |
| `window` | 能 import PySide6 | 起本地服务 + QtWebEngine 原生窗口（VS Code 里不会再跳浏览器） |
| `browser` | 其余 | 起本地服务 + 浏览器打开 |

显式指定 sink 优先级最高；指定失败时降级并在 `figure.warnings` 里留下原因。
"""

from __future__ import annotations

import time
import webbrowser
from typing import Any

from ..server.live import LiveServer


def detect_sink() -> str:
    try:
        from IPython import get_ipython  # type: ignore

        if get_ipython() is not None:
            return "inline"
    except Exception:  # noqa: BLE001 - 没装 IPython 就是没有
        pass
    try:
        import PySide6  # noqa: F401

        return "window"
    except Exception:  # noqa: BLE001
        pass
    return "browser"


def show_figure(
    figure: Any,
    *,
    sink: str | None = None,
    port: int = 0,
    open_browser: bool | None = None,
    block: bool | None = None,
    timeout: float = 60.0,
    title: str | None = None,
) -> Any:
    chosen = sink or detect_sink()
    if chosen == "inline":
        return _show_inline(figure, title=title)

    if chosen == "window":
        try:
            from .window import open_window

            return open_window(figure, port=port, block=block, title=title)
        except Exception as exc:  # noqa: BLE001 - 降级到浏览器
            figure.warnings.append(f"window sink 不可用（{exc}），已降级为 browser")

    return _show_browser(
        figure, port=port, open=open_browser, block=block, timeout=timeout, title=title
    )


def _show_inline(figure: Any, *, title: str | None) -> Any:
    from IPython.display import HTML, display  # type: ignore

    html = figure.html(title=title)
    display(HTML(html))
    return html


def _show_browser(
    figure: Any,
    *,
    port: int,
    open: bool | None,
    block: bool | None,
    timeout: float,
    title: str | None,
) -> LiveServer:
    server = LiveServer(figure, port=port, title=title)
    server.start()
    should_open = True if open is None else bool(open)
    if should_open:
        webbrowser.open(server.url)

    # 脚本里默认阻塞（对齐 matplotlib 的 plt.show()）；notebook 里不阻塞
    if block if block is not None else True:
        if detect_sink() == "inline":
            return server
        try:
            deadline = time.time() + timeout
            while (
                server._thread is not None and server._thread.is_alive()
            ):  # noqa: SLF001
                if time.time() > deadline and timeout > 0 and not should_open:
                    break
                time.sleep(0.2)
        except KeyboardInterrupt:
            pass
        finally:
            server.stop()
    return server
