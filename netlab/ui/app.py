"""原生界面入口：``python -m netlab.ui`` / ``python -m netlab.desktop --native``。

单实例 + 无监听端口（spec C11）：重复启动只激活已有窗口，不再起第二份。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

SERVER_NAME = "netlab-native-instance"


def _existing_instance() -> bool:
    """已经有一个实例在跑就返回 True（并把它叫到前台）。"""
    from PySide6.QtNetwork import QLocalServer, QLocalSocket

    socket = QLocalSocket()
    socket.connectToServer(SERVER_NAME)
    if socket.waitForConnected(300):
        socket.write(b"activate")
        socket.flush()
        socket.waitForBytesWritten(300)
        socket.disconnectFromServer()
        return True
    QLocalServer.removeServer(SERVER_NAME)
    return False


def _serve_instance(window) -> None:
    """占住本地套接字名，后启动的实例只能激活我们。"""
    from PySide6.QtNetwork import QLocalServer

    server = QLocalServer(window)
    server.setSocketOptions(QLocalServer.UserAccessOption)
    server.listen(SERVER_NAME)

    def _activate() -> None:
        while server.hasPendingConnections():
            connection = server.nextPendingConnection()
            if connection is not None:
                connection.readAll()
                connection.disconnectFromServer()

    server.newConnection.connect(_activate)
    window._instance_server = server  # 保持引用，随窗口释放


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="netlab-native", description="Netlab 原生 Qt 界面")
    parser.add_argument("--theme", default="light", choices=["light", "dark"])
    parser.add_argument("--project", default="", help="启动后打开 .netlab 工程")
    parser.add_argument("--no-live", action="store_true", help="不启动实时取帧线程")
    parser.add_argument("--allow-multi", action="store_true", help="允许同时开多个实例")
    parser.add_argument("--selftest", action="store_true", help="启动后自测并退出（测启动耗时/内存）")
    args = parser.parse_args(argv)

    from PySide6.QtWidgets import QApplication

    from ..server import SERVICE
    from .shell import MainWindow

    app = QApplication.instance() or QApplication(sys.argv[:1])
    app.setApplicationName("Netlab")
    app.setOrganizationName("Netlab")

    if not args.allow_multi and _existing_instance():
        return 0

    SERVICE.ensure_thread()

    if args.selftest:
        return _selftest(app, SERVICE, MainWindow, args)

    window = MainWindow(SERVICE, theme=args.theme)
    if not args.allow_multi:
        _serve_instance(window)
    window.show()
    if args.project:
        window.open_path(args.project)
    if args.no_live:
        window.bridge.stop_live()
    return int(app.exec())


def _rss_mb() -> float:
    """当前进程常驻内存（MB）；优先 psutil，其次 psapi，最后 resource。"""
    try:
        import psutil

        return psutil.Process().memory_info().rss / (1024 * 1024)
    except Exception:
        pass
    try:
        import ctypes
        from ctypes import wintypes

        class Counters(ctypes.Structure):
            _fields_ = [
                ("cb", wintypes.DWORD),
                ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        counters = Counters()
        counters.cb = ctypes.sizeof(Counters)
        handle = ctypes.windll.kernel32.GetCurrentProcess()
        if ctypes.windll.psapi.GetProcessMemoryInfo(handle, ctypes.byref(counters), counters.cb):
            return counters.WorkingSetSize / (1024 * 1024)
    except Exception:
        pass
    try:
        import resource

        return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0
    except Exception:
        return 0.0


def _selftest(app, service, window_cls, args) -> int:
    import time

    started = time.perf_counter()
    window = window_cls(service, theme=args.theme)
    built = time.perf_counter()
    window.show()
    for _ in range(30):
        app.processEvents()
        if window.isVisible():
            break
    painted = time.perf_counter()
    if args.no_live:
        window.bridge.stop_live()
    for _ in range(10):
        app.processEvents()
    ready = time.perf_counter()
    print(f"build_ms={int((built - started) * 1000)}")
    print(f"first_paint_ms={int((painted - started) * 1000)}")
    print(f"ready_ms={int((ready - started) * 1000)}")
    print(f"rss_mb={_rss_mb():.0f}")
    print(f"nodes={len(window.canvas.scene().nodes)}")
    window._dirty = False
    window.bridge.stop_live()
    window.close()
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
