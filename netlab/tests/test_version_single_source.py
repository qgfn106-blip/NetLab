"""D-2 / N-21：版本号单一来源。

版本只允许写在 ``netlab/__init__.py``；前端 ``index.html`` 用占位符
``__NETLAB_VERSION__``，由服务端在响应时注入 ``APP_BUILD``。
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from fastapi.testclient import TestClient

from netlab import __version__
from netlab.server import app

ROOT = Path(__file__).resolve().parents[2]
INDEX = ROOT / "frontend" / "index.html"
CHECKER = ROOT / "tools" / "check_version.py"


def test_index_html_has_no_hardcoded_version() -> None:
    text = INDEX.read_text(encoding="utf-8")
    assert "__NETLAB_VERSION__" in text
    assert f"?v={__version__}" not in text


def test_served_index_injects_runtime_version() -> None:
    client = TestClient(app)
    response = client.get("/")
    assert response.status_code == 200
    body = response.text
    assert "__NETLAB_VERSION__" not in body
    assert f"?v={__version__}" in body


def test_version_checker_reports_single_source() -> None:
    result = subprocess.run(
        [sys.executable, str(CHECKER)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
