"""桌面入口：Qt 原生界面（2026-11-02 起为唯一界面，D77）。

    python -m netlab.desktop            # 原生 Qt 界面（等价 --native）
    python -m netlab.desktop --native   # 显式写法，保留兼容

旧 pywebview + WebView2 壳与原 web 前端已于 2026-11-02 退役并备份到
GitHub（分支 backup/web-ui-static-2026-11-02、标签 web-legacy-2026-11-02、
docs/archive/netlab-web-ui-2026-11-02.zip）。
"""

import sys

if "--web" in sys.argv:
    print(
        "旧的 web 界面已退役（D77）。请改用原生界面：\n"
        "  python -m netlab.desktop --native\n"
        "原 web 前端备份在 GitHub 分支 backup/web-ui-static-2026-11-02。",
        file=sys.stderr,
    )
    raise SystemExit(2)

sys.argv = [arg for arg in sys.argv if arg != "--native"]

from ..ui.app import main  # noqa: E402

raise SystemExit(main())
