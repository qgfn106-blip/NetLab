"""桌面版无交互自检：后端、工程往返、QtWebEngine 可用性。"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path


def backend_selftest() -> dict:
    checks: list[dict] = []
    try:
        from fastapi.testclient import TestClient

        from netlab.project import atomic_write, load_project
        from netlab.server import app

        with TestClient(app) as client:
            health = client.get("/api/health")
            checks.append({"name": "health", "ok": health.status_code == 200})
            catalog = client.get("/api/catalog").json()
            checks.append(
                {
                    "name": "catalog",
                    "ok": bool(catalog["catalog"]["computes"])
                    and bool(catalog["templates"]),
                }
            )
            project = client.get("/api/project").json()["project"]
            checks.append(
                {
                    "name": "project_build",
                    "ok": project.get("format") == "netlab-project"
                    and bool(project.get("checksum")),
                }
            )
            imported = client.post(
                "/api/project/import", json={"project": project}
            )
            checks.append(
                {
                    "name": "project_import",
                    "ok": imported.status_code == 200
                    and imported.json()["scene"].get("mode")
                    in {"signal", "circuit", "vector"},
                }
            )
            with tempfile.TemporaryDirectory(prefix="netlab-selftest-") as folder:
                path = Path(folder) / "selftest.netlab"
                atomic_write(path, project)
                loaded = load_project(path)
                checks.append(
                    {
                        "name": "project_roundtrip",
                        "ok": loaded.get("checksum") == project.get("checksum")
                        and loaded.get("version") == project.get("version"),
                    }
                )
    except Exception as exc:
        checks.append(
            {"name": "backend", "ok": False, "error": f"{type(exc).__name__}: {exc}"}
        )
    return {"ok": all(item.get("ok") for item in checks), "checks": checks}


def qt_selftest() -> dict:
    try:
        from PySide6.QtCore import QTimer
        from PySide6.QtWidgets import QApplication
        from PySide6.QtWebEngineWidgets import QWebEngineView
    except Exception as exc:
        return {"status": "skip", "reason": f"{type(exc).__name__}: {exc}"}
    try:
        app = QApplication.instance() or QApplication(sys.argv[:1])
        view = QWebEngineView()
        view.resize(640, 480)
        view.setHtml("<html><body>netlab-selftest</body></html>")
        view.show()
        # 处理事件循环一小段时间，验证 Chromium 子进程能启动。
        from PySide6.QtCore import QEventLoop

        loop = QEventLoop()
        QTimer.singleShot(1200, loop.quit)
        loop.exec()
        title = view.title()
        view.close()
        view.deleteLater()
        app.processEvents()
        return {"status": "ok", "title": title or "(blank)"}
    except Exception as exc:
        return {"status": "fail", "reason": f"{type(exc).__name__}: {exc}"}


def run_selftest(strict: bool = False) -> int:
    if sys.platform == "win32":
        os.environ.setdefault("QT_QPA_PLATFORM", "windows")
    backend = backend_selftest()
    qt = qt_selftest()
    report = {"backend": backend, "qt": qt, "ok": backend["ok"]}
    if qt["status"] == "fail":
        report["ok"] = False
    if strict and qt["status"] == "skip":
        report["ok"] = False
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(run_selftest())
