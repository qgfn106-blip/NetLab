"""D90+: enforce one token-aware seam for browser API requests."""
from __future__ import annotations

from pathlib import Path

APP_JS = Path(__file__).resolve().parents[2] / "frontend" / "app.js"


def test_frontend_api_fetches_only_through_token_aware_helper():
    source = APP_JS.read_text(encoding="utf-8")
    fetch_calls = [line.strip() for line in source.splitlines() if "fetch(" in line]
    assert fetch_calls == [
        "const response = await fetch(path, config);",
        "await fetch('/api/shutdown', {",
    ]
    assert "if (DESKTOP_TOKEN) headers['X-Netlab-Token'] = DESKTOP_TOKEN;" in source


def test_cache_ui_uses_helper_and_does_not_misreport_failures_as_empty_or_success():
    source = APP_JS.read_text(encoding="utf-8")
    cache_start = source.index("  function renderCacheBody()")
    cache_end = source.index("  function openDocSearch()", cache_start)
    cache_ui = source[cache_start:cache_end]

    assert "api('/api/cache/status')" in cache_ui
    assert "api('/api/cache/clean'" in cache_ui
    assert "fetch('/api/cache/" not in cache_ui
    assert "扫描失败：${error?.message || error}" in cache_ui
    assert "清理失败：${error?.message || error}" in cache_ui
    assert ".catch(() => {})" in cache_ui  # startup-only quiet cache-size hint
