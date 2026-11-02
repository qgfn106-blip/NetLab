"""pywebview + WebView2 桌面壳（替代 Qt WebEngine 壳）。

与 Qt 壳的差别：
- 窗口由系统 WebView2 渲染，不再打包 Chromium（安装体积小一个数量级）；
- 原生能力通过 `WebviewBridge`（js_api）暴露，网页侧由 `static/desktop-shim.js`
  映射成原来的 QWebChannel 调用风格，**前端代码零改动**；
- 窗口先隐藏、页面加载完再显示，避免"白屏/黑屏卡住"的观感；
  加载超时也会兜底显示，绝不留下一个看不见的进程。

用法：
    python -m netlab.desktop                 # 桌面版（pywebview）
    python -m netlab.desktop --qt            # 旧版 Qt WebEngine 壳（回退用）
    python -m netlab.desktop --selftest      # 不开窗口，检查服务与垫片是否就绪
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
import threading
import urllib.request
from pathlib import Path

_SHOW_FALLBACK_SECONDS = 8.0
_MIN_W, _MIN_H = 1100, 700


def _state_dir() -> Path:
    """和 Qt 壳同目录（QStandardPaths.AppDataLocation），保证升级后设置还在。"""
    base = os.environ.get("APPDATA") or str(Path.home())
    return Path(base) / "Netlab" / "NetlabDesktop"


def _window_state_path() -> Path:
    return _state_dir() / "window.json"


def _virtual_screen() -> tuple[int, int, int, int] | None:
    """Windows 虚拟桌面范围 (x, y, w, h)；非 Windows 返回 None。"""
    try:
        import ctypes

        user32 = ctypes.windll.user32  # type: ignore[attr-defined]
        return (
            int(user32.GetSystemMetrics(76)),
            int(user32.GetSystemMetrics(77)),
            int(user32.GetSystemMetrics(78)),
            int(user32.GetSystemMetrics(79)),
        )
    except Exception:
        return None


def _point_on_screen(x: int, y: int) -> bool:
    box = _virtual_screen()
    if box is None:
        return True
    vx, vy, vw, vh = box
    return (vx - 40) <= x <= (vx + vw - 80) and (vy - 40) <= y <= (vy + vh - 80)


def _load_window_state() -> dict:
    """读窗口几何；坏值（最小化留下的 -32000 / 极小尺寸）一律丢弃。"""
    try:
        data = json.loads(_window_state_path().read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {}
    except Exception:
        return {}
    try:
        width = int(data.get("width") or 0)
        height = int(data.get("height") or 0)
        if width < _MIN_W or height < _MIN_H:
            data.pop("width", None)
            data.pop("height", None)
        x, y = data.get("x"), data.get("y")
        if (
            not isinstance(x, (int, float))
            or not isinstance(y, (int, float))
            or int(x) <= -10000
            or int(y) <= -10000
            or not _point_on_screen(int(x), int(y))
        ):
            data.pop("x", None)
            data.pop("y", None)
    except Exception:
        data.pop("width", None)
        data.pop("height", None)
        data.pop("x", None)
        data.pop("y", None)
    return data


def _save_window_state(window, bridge=None) -> None:
    """记住窗口位置/大小/最大化——下次打开回到原来的样子（Qt 壳用 QSettings 做同样的事）。

    最小化时 Windows 会报 -32000 和极小尺寸，这种状态不写盘，避免下次启动窗口变成一条缝。
    """
    try:
        state = _load_window_state()
        maximized = bool(getattr(bridge, "_maxed", False))
        state["maximized"] = maximized
        if not maximized:
            try:
                x, y = int(window.x), int(window.y)
                width, height = int(window.width), int(window.height)
            except Exception:
                x = y = width = height = 0
            if width >= _MIN_W and height >= _MIN_H and _point_on_screen(x, y):
                state.update({"x": x, "y": y, "width": width, "height": height})
        path = _window_state_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(state), encoding="utf-8")
    except Exception:
        pass


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Netlab 桌面版（pywebview + WebView2）")
    parser.add_argument("--qt", action="store_true", help="改用旧版 Qt WebEngine 壳")
    parser.add_argument("--selftest", action="store_true", help="不开窗口，自检服务与垫片")
    parser.add_argument("--port", type=int, default=0, help="本地服务端口（0 = 自动选择）")
    parser.add_argument("--debug", action="store_true", help="允许开发者工具")
    parser.add_argument("--no-token", action="store_true", help="关闭桌面会话 token（仅调试）")
    parser.add_argument("--seconds", type=float, default=0.0, help="N 秒后自动关窗（0 = 一直开着）")
    parser.add_argument("--probe", action="store_true", help="开窗后检查桥接是否可用，打印结果并退出")
    parser.add_argument("--width", type=int, default=1500)
    parser.add_argument("--height", type=int, default=940)
    return parser.parse_args(argv)


def _fix_console() -> None:
    if sys.platform == "win32":
        try:
            import ctypes

            ctypes.windll.kernel32.SetConsoleOutputCP(65001)
        except Exception:
            pass


def _rss_tree() -> float | None:
    """本进程 + WebView2 子进程的 RSS 合计（MB）。"""
    try:
        import psutil  # type: ignore
    except Exception:
        return None
    try:
        proc = psutil.Process()
        total = proc.memory_info().rss
        for child in proc.children(recursive=True):
            try:
                total += child.memory_info().rss
            except Exception:
                pass
        return round(total / 1048576, 1)
    except Exception:
        return None


def _check_page(url: str) -> dict:
    """自检：页面可达、垫片已注入、静态资源可取。"""
    report: dict[str, object] = {"url": url}
    with urllib.request.urlopen(url, timeout=15) as response:
        html = response.read().decode("utf-8", "replace")
        report["status"] = response.status
    report["shim_injected"] = "desktop-shim.js" in html
    shim_url = url.split("?")[0].rstrip("/") + "/static/desktop-shim.js"
    with urllib.request.urlopen(shim_url, timeout=15) as response:
        report["shim_status"] = response.status
    return report


def _build_menu(window, bridge, *, show_devtools: bool = False):
    """原生菜单栏（pywebview 在 Windows 上走 WinForms ToolStrip）。

    动作全部转发给页面已有的 `window.netlabDesktopCommand`，所以前端不用改。
    """
    from webview.menu import Menu, MenuAction, MenuSeparator

    zoom = {"factor": 1.0}

    def apply_zoom() -> None:
        try:
            window.evaluate_js(f"document.body.style.zoom = '{zoom['factor']:.2f}'")
        except Exception:
            pass

    def zoom_by(delta: float) -> None:
        zoom["factor"] = max(0.5, min(2.0, round(zoom["factor"] + delta, 2)))
        apply_zoom()

    def reset_zoom() -> None:
        zoom["factor"] = 1.0
        apply_zoom()

    def reload_page() -> None:
        try:
            window.evaluate_js("location.reload()")
        except Exception:
            pass

    def quit_app() -> None:
        try:
            window.destroy()
        except Exception:
            pass

    def cmd(name: str):
        def run() -> None:
            bridge.command(name)
        return run

    return [
        Menu("文件", [
            MenuAction("新建工程", cmd("new")),
            MenuAction("打开工程…", cmd("open")),
            MenuSeparator(),
            MenuAction("保存", cmd("save")),
            MenuAction("另存为…", cmd("saveAs")),
            MenuSeparator(),
            MenuAction("恢复自动保存", cmd("recover")),
            MenuSeparator(),
            MenuAction("退出", quit_app),
        ]),
        Menu("视图", [
            MenuAction("重新加载页面", reload_page),
            MenuSeparator(),
            MenuAction("放大", lambda: zoom_by(0.1)),
            MenuAction("缩小", lambda: zoom_by(-0.1)),
            MenuAction("实际大小", reset_zoom),
        ] + ([MenuSeparator(), MenuAction("开发者工具", reload_page)] if show_devtools else [])),
        Menu("帮助", [
            MenuAction("快捷键与说明", cmd("help")),
        ]),
    ]


def main(argv: list[str] | None = None) -> int:
    import time as _time

    t_start = _time.perf_counter()
    args = parse_args(argv)
    _fix_console()

    if args.qt:
        from .app import main as qt_main

        legacy = [a for a in (argv if argv is not None else sys.argv[1:]) if a != "--qt"]
        return qt_main(legacy)

    try:
        import webview
    except Exception as exc:  # pragma: no cover - 依赖桌面环境
        print("桌面模式需要 pywebview。请先运行：", file=sys.stderr)
        print("  python -m pip install pywebview", file=sys.stderr)
        print(f"详细错误：{exc}", file=sys.stderr)
        return 2

    from .server_host import ServerHost
    from .webview_bridge import WebviewBridge

    # 无边框窗口：只有带 `.pywebview-drag-region` 的元素能拖动窗口，
    # 否则 easy_drag 会让画布/面板里任何一次拖拽都变成移动窗口。
    try:
        webview.settings["DRAG_REGION_DIRECT_TARGET_ONLY"] = True
    except Exception:
        pass

    token = None if args.no_token else secrets.token_urlsafe(24)
    # 服务端据此在 index.html 注入桌面垫片；浏览器访问时不存在该变量。
    os.environ["NETLAB_DESKTOP_SHELL"] = "pywebview"

    host = ServerHost(port=args.port or None)
    try:
        host.start(token=token, log_level="warning")
    except Exception as exc:
        print(f"本地服务启动失败：{exc}", file=sys.stderr)
        return 1

    url = host.url + (f"?token={token}" if token else "")

    try:
        if args.selftest:
            report = _check_page(url)
            print(report, flush=True)
            ok = bool(report.get("shim_injected")) and report.get("shim_status") == 200
            return 0 if ok else 1

        bridge = WebviewBridge(url)
        saved = _load_window_state()
        window = webview.create_window(
            "Netlab · 拓扑网络仿真台",
            url,
            js_api=bridge,
            width=int(saved.get("width") or args.width),
            height=int(saved.get("height") or args.height),
            x=int(saved["x"]) if isinstance(saved.get("x"), (int, float)) else None,
            y=int(saved["y"]) if isinstance(saved.get("y"), (int, float)) else None,
            min_size=(1100, 700),
            hidden=True,
            background_color="#0e1116",
            frameless=True,   # 去掉系统标题栏/边框，只留网页自己的外观
            easy_drag=True,   # 无边框时靠 .pywebview-drag-region 区域拖动窗口
        )
        bridge.attach(window)

        def _show() -> None:
            try:
                window.show()
                if saved.get("maximized"):
                    window.maximize()
            except Exception:
                pass

        def _on_closing():
            """关窗前确认：有未保存修改就问一句（Qt 壳的等价能力）。"""
            try:
                if getattr(bridge, "dirty", False):
                    ok = window.create_confirmation_dialog(
                        "退出 Netlab", "工程有未保存的修改，确定要退出吗？")
                    if not ok:
                        return False
                _save_window_state(window, bridge)
                # 关窗即刻释放本地端口（uvicorn 线程随进程一起退出，不留监听）
                try:
                    host.stop()
                except Exception:
                    pass
            except Exception:
                pass
            return True

        window.events.closing += _on_closing

        def _on_loaded() -> None:
            _show()
            if args.probe:
                threading.Thread(target=_probe, daemon=True).start()

        def _probe() -> None:
            """确认网页里桥接真的可用（而不是只有一个空壳对象）。"""
            import json
            import time

            time.sleep(1.0)
            result: dict[str, object] = {}
            result["elapsed_ms"] = round((_time.perf_counter() - t_start) * 1000, 1)
            try:
                result["title"] = window.evaluate_js("document.title")
                result["has_bridge"] = window.evaluate_js("!!window.netlabDesktop")
                result["has_win_ctl"] = window.evaluate_js(
                    "!!document.getElementById('nlWinCtl')")
                result["drag_region"] = window.evaluate_js(
                    "document.querySelectorAll('.pywebview-drag-region').length")
                result["has_command"] = window.evaluate_js(
                    "typeof window.netlabDesktopCommand === 'function'")
                window.evaluate_js(
                    "window.__probeAutosave = '__pending__';"
                    "window.netlabDesktop.hasAutosave(function (v) { window.__probeAutosave = String(v); });")
                time.sleep(0.8)
                result["has_autosave_roundtrip"] = window.evaluate_js("window.__probeAutosave")
                result["dirty_flag"] = window.evaluate_js(
                    "(function(){try{return String(document.querySelector('#saveState')?.textContent||'');}catch(e){return '';}})()")
                result["rss_tree_mb"] = _rss_tree()
            except Exception as exc:
                result["error"] = str(exc)[:200]
            print(json.dumps(result, ensure_ascii=False), flush=True)
            try:
                window.destroy()
            except Exception:
                pass

        window.events.loaded += _on_loaded
        # 兜底：页面迟迟不触发 loaded 也要把窗口显示出来，绝不静默卡住
        fallback = threading.Timer(_SHOW_FALLBACK_SECONDS, _show)
        fallback.daemon = True
        fallback.start()
        if args.seconds > 0:
            closer = threading.Timer(args.seconds, window.destroy)
            closer.daemon = True
            closer.start()

        try:
            webview.start(
                debug=bool(args.debug),
                gui="edgechromium",
                private_mode=False,
                storage_path=str(Path.home() / ".netlab-desktop"),
            )
        finally:
            fallback.cancel()
            host.stop()
        return 0
    finally:
        try:
            host.stop()
        except Exception:
            pass


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
