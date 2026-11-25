"""运行前「建议预计算」提示（前端静态约束）。"""

from pathlib import Path

from netlab.tests.frontend_sources import read_frontend_ts

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT.parent / "frontend" / "app.ts"
CONSTANTS = ROOT.parent / "frontend" / "app" / "constants.ts"
ENDPOINTS = ROOT.parent / "frontend" / "app" / "endpoints.ts"
INDEX = ROOT.parent / "frontend" / "index.html"


def test_run_warn_dialog_hooks():
    src = read_frontend_ts()
    assert "openRunWarn" in src
    assert "precomputeDialog" in src
    assert "openPrecomputeDialog" in src
    assert "ENDPOINTS.plotkitPrecompute" in src
    assert "plotkitPrecompute: '/api/plotkit/precompute'" in ENDPOINTS.read_text(encoding="utf-8")
    assert "skipWarn" in src
    start = src.index("async function runPlotkitPrecompute(")
    handler = src[start : start + 1800]
    assert "api(ENDPOINTS.plotkitPrecompute" in handler
    assert "catch (error)" in src
    assert ".message" in src


def test_build_stamp_matches_index_version():
    from fastapi.testclient import TestClient

    from netlab.server import APP_BUILD, app

    html = TestClient(app).get("/").text
    assert f"?v={APP_BUILD}" in html
    source = read_frontend_ts()
    assert "UI_BUILD = __NETLAB_BUILD__" in source
    assert f"UI_BUILD = '{APP_BUILD}'" not in source
