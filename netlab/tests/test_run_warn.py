"""运行前「建议预计算」提示（前端静态约束）。"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT.parent / "frontend" / "app.ts"
CONSTANTS = ROOT.parent / "frontend" / "app" / "constants.ts"
INDEX = ROOT.parent / "frontend" / "index.html"


def test_run_warn_dialog_hooks():
    src = APP.read_text(encoding="utf-8")
    assert "openRunWarn" in src
    assert "precomputeDialog" in src
    assert "openPrecomputeDialog" in src
    assert "/api/plotkit/precompute" in src
    assert "skipWarn" in src
    start = src.index("async function runPlotkitPrecompute(")
    handler = src[start : start + 1800]
    assert "api('/api/plotkit/precompute'" in handler
    assert "catch (error)" in src
    assert ".message" in src


def test_build_stamp_matches_index_version():
    from fastapi.testclient import TestClient

    from netlab.server import APP_BUILD, app

    html = TestClient(app).get("/").text
    assert f"?v={APP_BUILD}" in html
    source = APP.read_text(encoding="utf-8") + CONSTANTS.read_text(encoding="utf-8")
    assert "UI_BUILD = __NETLAB_BUILD__" in source
    assert f"UI_BUILD = '{APP_BUILD}'" not in source
