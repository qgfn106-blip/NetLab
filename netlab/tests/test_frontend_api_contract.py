"""D90+: enforce one token-aware seam for browser API requests."""

from __future__ import annotations

from pathlib import Path

from netlab.tests.frontend_sources import read_frontend_ts

APP_JS = Path(__file__).resolve().parents[2] / "frontend" / "app.ts"
APP_NET = Path(__file__).resolve().parents[2] / "frontend" / "app" / "net.ts"
APP_CACHE = Path(__file__).resolve().parents[2] / "frontend" / "app" / "cache.ts"
APP_ENDPOINTS = Path(__file__).resolve().parents[2] / "frontend" / "app" / "endpoints.ts"


def test_frontend_api_fetches_only_through_token_aware_helper():
    source = read_frontend_ts()
    fetch_calls = [line.strip() for line in source.splitlines() if "fetch(" in line]
    # 允许的裸 fetch 只有 token-aware seam：net.ts 的 api()，以及需要原始 Response 的工作台导出。
    assert sorted(fetch_calls) == sorted([
        "const response = await fetch(path, config);",
        "const response = await fetch('/api/analysis/workbench/export', {",
    ])
    assert "api(ENDPOINTS.shutdown" in source
    assert APP_ENDPOINTS.read_text(encoding="utf-8").find("shutdown: '/api/shutdown'") >= 0
    assert "if (DESKTOP_TOKEN) headers['X-Netlab-Token'] = DESKTOP_TOKEN;" in source


def test_cache_ui_uses_helper_and_does_not_misreport_failures_as_empty_or_success():
    cache_ui = APP_CACHE.read_text(encoding="utf-8")

    assert "api('/api/cache/status')" in cache_ui
    assert "api('/api/cache/clean'" in cache_ui
    assert "fetch('/api/cache/" not in cache_ui
    assert "扫描失败：" in cache_ui
    assert "清理失败：" in cache_ui
    assert ".catch(() => {})" in cache_ui  # startup-only quiet cache-size hint
