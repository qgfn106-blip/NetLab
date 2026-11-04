"""运行前「建议预计算」提示（前端静态约束）。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT.parent / "frontend" / "app.js"
INDEX = ROOT.parent / "frontend" / "index.html"


def test_run_warn_dialog_hooks():
    src = APP.read_text(encoding="utf-8")
    assert "openRunWarn" in src
    assert "runWarnWin" in src
    assert "/api/plotkit/precompute" in src
    assert "skipWarn" in src
    start = src.index("card.querySelector('#runWarnPre').onclick")
    end = src.index("    sec.focus();", start)
    handler = src[start:end]
    assert "api('/api/plotkit/precompute'" in handler
    assert "catch (error)" in handler
    assert "error.message" in handler


def test_build_stamp_matches_index_version():
    from netlab.server import APP_BUILD

    html = INDEX.read_text(encoding="utf-8")
    assert f"?v={APP_BUILD}" in html
    assert f"UI_BUILD = '{APP_BUILD}'" in APP.read_text(encoding="utf-8")
