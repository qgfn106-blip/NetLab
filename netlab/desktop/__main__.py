"""桌面入口：默认网页壳；``--native`` 走原生 Qt 界面。

    python -m netlab.desktop            # pywebview + WebView2（旧壳，冻结中）
    python -m netlab.desktop --native   # PySide6 原生界面（D74）
"""

import sys

if "--native" in sys.argv:
    sys.argv = [arg for arg in sys.argv if arg != "--native"]
    from ..ui.app import main
else:
    from .webview_app import main

raise SystemExit(main())
