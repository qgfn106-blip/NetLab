"""PlotKit 桌面壳：pywebview + WebView2（原型）。

设计取舍（见 docs/DESKTOP.md）：
- **不重写前端**：仍加载现有 FastAPI 应用的静态页面，只是把"浏览器标签页"换成原生窗口；
- **不走 base64 传图**：页面与接口同源（同一个本地端口），`<img src="/api/render...">` 直接走 HTTP，
  避免 base64 带来的 +33% 体积与额外解码；
- **服务只绑 127.0.0.1 + 随机端口**：不对外暴露，也避免和别的实例抢固定端口。

用法：
    python -m plotkit.desktop                # 打开窗口
    python -m plotkit.desktop --selftest     # 自检：量启动耗时/内存/渲染，然后自动关窗
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time

from pathlib import Path

from .server import ServerHandle, serve


def demo_figure(channels: int = 6, points: int = 20_000):
    """原型用演示数据：6 通道正弦，规模与 netlab 当前用量一致。"""
    import numpy as np

    import plotkit as pk

    t = np.arange(points, dtype=float)
    fig = pk.figure(size=(12, 7), dpi=100)
    fig.add_data("t", t, role="coord")
    for i in range(channels):
        fig.add_data(f"ch{i}", np.sin(t / 500.0 + i), role="series")
        fig.add_plot(x="t", y=f"ch{i}", label=f"CH{i + 1}")
    return fig


class Bridge:
    """暴露给 JS 的最小桥：`window.pywebview.api.status()`。

    只做探活/关窗，不承担数据通道——数据仍走 HTTP，避免把图片塞进 IPC。
    """

    def __init__(self, url: str) -> None:
        self.url = url
        self._window = None

    def attach(self, window) -> None:
        self._window = window

    def status(self) -> dict:
        import plotkit

        return {
            "ok": True,
            "url": self.url,
            "version": getattr(plotkit, "__version__", "?"),
            "python": sys.version.split()[0],
        }

    def close(self) -> bool:
        if self._window is not None:
            self._window.destroy()
        return True


def _rss_mb() -> float | None:
    """本进程 + 子进程（WebView2 渲染进程）的 RSS 合计，MB。"""
    try:
        import psutil  # type: ignore

        proc = psutil.Process()
        total = proc.memory_info().rss
        for child in proc.children(recursive=True):
            try:
                total += child.memory_info().rss
            except Exception:
                pass
        return round(total / 1048576, 1)
    except Exception:
        pass
    try:
        import subprocess

        out = subprocess.run(
            [
                "tasklist",
                "/FI",
                f"PID eq {__import__('os').getpid()}",
                "/FO",
                "CSV",
                "/NH",
            ],
            capture_output=True,
            text=True,
            timeout=5,
        ).stdout
        field = out.strip().split(",")[-1].strip('"').replace(" K", "").replace(",", "")
        return round(int(field) / 1024, 1)
    except Exception:
        return None


def _timed_render(url: str, *, width: int, height: int) -> float | None:
    """从 Python 侧打一次 /api/render，量"服务端渲染 + 回环传输"。"""
    import urllib.request

    target = f"{url}/api/render?w={width}&h={height}&fmt=png"
    try:
        start = time.perf_counter()
        with urllib.request.urlopen(target, timeout=30) as response:
            response.read()
        return round((time.perf_counter() - start) * 1000, 1)
    except Exception:
        return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="plotkit.desktop", description="PlotKit 桌面壳（pywebview + WebView2）"
    )
    parser.add_argument(
        "--selftest", action="store_true", help="量启动/内存/渲染后自动关窗"
    )
    parser.add_argument(
        "--seconds", type=float, default=0.0, help="普通模式下自动关窗（0 = 一直开着）"
    )
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=800)
    parser.add_argument("--port", type=int, default=0, help="0 = 系统分配")
    parser.add_argument("--points", type=int, default=20_000)
    parser.add_argument("--channels", type=int, default=6)
    parser.add_argument(
        "--no-private",
        action="store_true",
        help="复用 WebView2 用户数据目录（冷启动更快、内存更低；会留磁盘缓存）",
    )
    args = parser.parse_args(argv)

    t0 = time.perf_counter()
    from plotkit.server.app import create_app

    figure = demo_figure(args.channels, args.points)
    app = create_app(figure, title="PlotKit Desktop")
    t_app = time.perf_counter()

    handle: ServerHandle = serve(app, port=args.port)
    t_serve = time.perf_counter()

    import webview

    bridge = Bridge(handle.url)
    window = webview.create_window(
        "PlotKit Desktop",
        handle.url,
        js_api=bridge,
        width=args.width,
        height=args.height,
        min_size=(820, 560),
        hidden=True,
        background_color="#0f1216",
    )
    bridge.attach(window)
    t_window = time.perf_counter()

    timings: dict[str, object] = {
        "import_and_figure_ms": round((t_app - t0) * 1000, 1),
        "server_start_ms": round((t_serve - t_app) * 1000, 1),
        "window_create_ms": round((t_window - t_serve) * 1000, 1),
        "url": handle.url,
    }
    loaded = threading.Event()

    def on_loaded() -> None:
        try:
            window.show()  # 先隐藏建窗，等首帧就绪再显示，避免 2~3 秒的黑白空窗
        except Exception:  # pragma: no cover - GUI 相关
            pass
        timings["page_loaded_ms"] = round((time.perf_counter() - t0) * 1000, 1)
        if "start_ms" in timings:
            timings["loaded_after_start_ms"] = round(
                timings["page_loaded_ms"] - float(timings["start_ms"]), 1
            )
        try:
            timings["page_title"] = window.evaluate_js("document.title")
        except Exception as exc:  # pragma: no cover - GUI 相关
            timings["page_title"] = f"<error: {exc}>"
        loaded.set()
        if args.selftest:
            _finish()

    def _finish() -> None:
        # 页面就绪后再量一轮渲染，避免把首屏加载算进去
        timings["render_roundtrip_ms"] = _timed_render(
            handle.url, width=900, height=520
        )
        timings["render_roundtrip_hot_ms"] = _timed_render(
            handle.url, width=900, height=520
        )
        timings["rss_mb"] = _rss_mb()
        timings["total_to_loaded_ms"] = timings.get("page_loaded_ms")
        print(json.dumps(timings, ensure_ascii=False), flush=True)
        try:
            window.destroy()
        except Exception:
            pass

    window.events.loaded += on_loaded
    # 兜底：万一 loaded 事件没来，也要把窗口显示出来，绝不静默卡在隐藏状态
    show_fallback = threading.Timer(8.0, lambda: window.show())
    show_fallback.daemon = True
    show_fallback.start()

    if args.seconds > 0 and not args.selftest:
        timer = threading.Timer(args.seconds, _finish)
        timer.daemon = True
        timer.start()

    try:
        timings["start_ms"] = round((time.perf_counter() - t0) * 1000, 1)
        start_kwargs: dict[str, object] = {"debug": False}
        if args.no_private:
            # 默认 private_mode=True：每次启动新建用户数据目录，冷启动更慢、内存更高
            start_kwargs["private_mode"] = False
            start_kwargs["storage_path"] = str(Path.home() / ".plotkit-desktop")
        webview.start(**start_kwargs)
    finally:
        handle.stop()
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
