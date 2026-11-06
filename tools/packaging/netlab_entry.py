"""PyInstaller entry for the netlab desktop app.

Frozen: bundle resources live under sys._MEIPASS. We point NETLAB_FRONTEND_DIR
there before importing netlab (whose server resolves FRONTEND_DIR at import time).
"""

import os
import sys


def _resource_base() -> str:
    if getattr(sys, "frozen", False):
        return getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


_base = _resource_base()
_frontend = os.path.join(_base, "frontend")
if os.path.isdir(_frontend):
    os.environ.setdefault("NETLAB_FRONTEND_DIR", _frontend)

from netlab.desktop.webview_app import main  # noqa: E402

raise SystemExit(main())
