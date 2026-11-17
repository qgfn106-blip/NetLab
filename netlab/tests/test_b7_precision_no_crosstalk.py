"""B7 F-03：/api/numeric-precision 与 /api/settings 不得互相覆盖（最小修回归）。"""
from __future__ import annotations

import pytest

import netlab.server_preferences as prefs
from netlab.server_preferences import NumericPrecisionRequest, build_router


@pytest.fixture()
def endpoints():
    router = build_router(service=object())
    return {(r.path, tuple(sorted(r.methods))): r.endpoint for r in router.routes}


@pytest.fixture(autouse=True)
def _restore_mode():
    from netlab.core.compute import analysis
    prev = analysis.numeric_precision_mode()
    yield
    analysis.set_numeric_precision_mode(prev)


def test_get_settings_does_not_mutate_global_mode(monkeypatch, endpoints):
    from netlab.core.compute import analysis
    analysis.set_numeric_precision_mode("exact")
    monkeypatch.setattr(prefs, "load_settings", lambda: {"numeric_precision": "standard", "numericDigits": 3})
    endpoints[("/api/settings", ("GET",))]()
    assert analysis.numeric_precision_mode() == "exact"  # 读取不产生副作用


def test_post_numeric_precision_persists(monkeypatch, endpoints):
    from netlab.core.compute import analysis
    saved = {}
    monkeypatch.setattr(prefs, "load_settings", lambda: {"numeric_precision": "exact", "keep": 1})
    monkeypatch.setattr(prefs, "save_settings", lambda s: saved.update(s))
    out = endpoints[("/api/numeric-precision", ("POST",))](NumericPrecisionRequest(mode="standard"))
    assert out["mode"] == "standard"
    assert saved.get("numeric_precision") == "standard"
    assert saved.get("keep") == 1  # 保留其它设置键
