"""桌面入口：pywebview + WebView2 网页壳（D78 恢复为 Web UI）。

    python -m netlab.desktop            # pywebview + WebView2

Qt 原生界面（R33/D74/D77）已于 2026-11-02 按用户决定整体备份到
git 分支 ``backup/qt-native-2026-11-02``（标签 ``qt-native-2026-11-02``）后删除。
"""

import sys


def _main() -> int:
    if "--native" in sys.argv:
        sys.stderr.write(
            "Qt 原生界面已移除（备份见分支 backup/qt-native-2026-11-02）。\n"
            "请直接运行：python -m netlab.desktop\n"
        )
        return 2
    from .webview_app import main

    return main()


raise SystemExit(_main())
