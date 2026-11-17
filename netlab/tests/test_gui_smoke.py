"""GUI 级 e2e 冒烟（需真窗口）。

默认跳过；本机有 WebView2 且设 `NETLAB_GUI_SMOKE=1` 时启用：
    $env:NETLAB_GUI_SMOKE='1'; python -m pytest netlab/tests/test_gui_smoke.py -q

跳过原因保持稳定可检索（netlab-gui-smoke: <category>），并在 result.json 记录环境探测。
启用时把 probe.json / stdout.log / stderr.log / environment.json 写入
reports/gui_smoke/<UTC 时间戳>/，即使失败也保留。
"""
from __future__ import annotations

import json
import os
import platform
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]


def _webview2_version() -> str | None:
    if sys.platform != "win32":
        return None
    try:
        import winreg
    except ImportError:
        return None
    roots = (
        r"SOFTWARE\Microsoft\EdgeUpdate\Clients",
        r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients",
    )
    for root in roots:
        try:
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, root) as clients:
                index = 0
                while True:
                    try:
                        name = winreg.EnumKey(clients, index)
                    except OSError:
                        break
                    index += 1
                    try:
                        with winreg.OpenKey(clients, name) as client:
                            display, _ = winreg.QueryValueEx(client, "name")
                            version, _ = winreg.QueryValueEx(client, "pv")
                    except OSError:
                        continue
                    if "webview2" in str(display).lower():
                        return str(version)
        except OSError:
            continue
    for candidate in (
        Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "Microsoft" / "EdgeWebView" / "Application",
        Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Microsoft" / "EdgeWebView" / "Application",
    ):
        try:
            return sorted((item.name for item in candidate.iterdir() if item.is_dir()), reverse=True)[0]
        except (OSError, IndexError):
            continue
    return None


def gui_environment() -> dict[str, object]:
    env: dict[str, object] = {
        "platform": sys.platform,
        "python": sys.version.split()[0],
        "machine": platform.machine(),
        "webview2": _webview2_version(),
        "pywebview": None,
    }
    try:
        import webview

        try:
            from importlib.metadata import version

            env["pywebview"] = version("pywebview")
        except Exception:
            env["pywebview"] = getattr(webview, "__version__", "installed")
    except Exception:
        pass
    return env


def skip_category(env: dict[str, object]) -> str | None:
    if env["platform"] != "win32":
        return "unsupported-platform"
    if not env["webview2"]:
        return "webview2-unavailable"
    if not env["pywebview"]:
        return "pywebview-unavailable"
    if os.environ.get("NETLAB_GUI_SMOKE") != "1":
        return "opt-in-disabled"
    return None


ENVIRONMENT = gui_environment()
NODEID = "netlab/tests/test_gui_smoke.py::test_gui_probe_smoke"


def _artifact_dir() -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = REPO / "reports" / "gui_smoke" / stamp
    path.mkdir(parents=True, exist_ok=True)
    return path


def test_gui_probe_smoke() -> None:
    from tools.gui_smoke import check_invariants, run_probe

    artifact_dir = _artifact_dir()
    (artifact_dir / "environment.json").write_text(
        json.dumps(ENVIRONMENT, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    category = skip_category(ENVIRONMENT)
    if category is not None:
        reason = f"netlab-gui-smoke: {category}"
        (artifact_dir / "skip.json").write_text(
            json.dumps(
                {"nodeid": NODEID, "reason": reason, "category": category, "environment": ENVIRONMENT},
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        pytest.skip(reason)
    rc, data, out, err = run_probe(seconds=20)
    (artifact_dir / "stdout.log").write_text(out, encoding="utf-8")
    (artifact_dir / "stderr.log").write_text(err, encoding="utf-8")
    if data is not None:
        (artifact_dir / "probe.json").write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    failed = [c for c in check_invariants(data) if not c[1]] if data is not None else [("probe", False, None)]
    (artifact_dir / "result.json").write_text(
        json.dumps({"rc": rc, "failed": failed, "artifacts": str(artifact_dir)}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    assert rc == 0, f"probe rc={rc}\n{out[-1500:]}\n{err[-1500:]}"
    assert data is not None, "probe 未输出 JSON"
    assert not failed, f"GUI 冒烟不通过: {failed}"
