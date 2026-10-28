"""桌面入口：``python -m netlab.desktop``。"""

from __future__ import annotations

import argparse
import os
import secrets
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
PACKAGE_PARENT = PROJECT_ROOT.parent
if str(PACKAGE_PARENT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_PARENT))


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Netlab 桌面版")
    parser.add_argument("--selftest", action="store_true", help="运行无交互自检并退出")
    parser.add_argument("--strict", action="store_true", help="自检中 QtWebEngine 不可用也视为失败")
    parser.add_argument("--port", type=int, default=0, help="本地服务端口（0 = 自动选择）")
    parser.add_argument("--debug", action="store_true", help="允许开发者工具")
    parser.add_argument("--no-token", action="store_true", help="关闭桌面会话 token（仅调试）")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.selftest:
        from .selftest import run_selftest

        return run_selftest(strict=args.strict)

    if sys.platform == "win32":
        try:
            import ctypes

            ctypes.windll.kernel32.SetConsoleOutputCP(65001)
        except Exception:
            pass

    try:
        from PySide6.QtCore import Qt
        from PySide6.QtWidgets import QApplication
    except Exception as exc:
        print("桌面模式需要 PySide6。请先运行：", file=sys.stderr)
        print("  python -m pip install -r netlab/requirements-desktop.txt", file=sys.stderr)
        print(f"详细错误：{exc}", file=sys.stderr)
        return 2

    # 高 DPI 在 Qt6 默认开启；显式设置渲染属性，避免首次启动字体过小。
    QApplication.setHighDpiScaleFactorRoundingPolicy(
        Qt.HighDpiScaleFactorRoundingPolicy.PassThrough
    )
    app = QApplication(sys.argv[:1])
    app.setApplicationName("Netlab")
    app.setOrganizationName("Netlab")

    from .main_window import MainWindow
    from .server_host import ServerHost

    token = None if args.no_token else secrets.token_urlsafe(24)
    host = ServerHost(port=args.port or None)
    try:
        host.start(token=token, log_level="warning")
    except Exception as exc:
        print(f"本地服务启动失败：{exc}", file=sys.stderr)
        return 1
    url = host.url + (f"?token={token}" if token else "")
    window = MainWindow(url, debug=args.debug)
    window.show()
    try:
        code = app.exec()
    finally:
        host.stop()
    return int(code)


if __name__ == "__main__":
    raise SystemExit(main())
