"""C2 兼容矩阵：canonical yaml、生成常量、bridge 三态必须一致。"""
from __future__ import annotations

import sys
import types
from pathlib import Path

import yaml

from netlab import plotkit_bridge
from netlab.contracts import PLOTKIT_MAX_EXCLUSIVE, PLOTKIT_MIN

ROOT = Path(__file__).resolve().parents[2]
COMPAT = ROOT / "docs" / "canonical" / "contracts" / "compatibility.yaml"


def _tuple(text: str) -> tuple[int, ...]:
    return tuple(int(part) for part in str(text).split("."))


def test_canonical_matrix_matches_generated_constants() -> None:
    data = yaml.safe_load(COMPAT.read_text(encoding="utf-8"))
    plotkit = data["plotkit"]
    assert PLOTKIT_MIN == _tuple(plotkit["min"])
    assert PLOTKIT_MAX_EXCLUSIVE == _tuple(plotkit["max_exclusive"])
    assert plotkit_bridge.PLOTKIT_MIN == PLOTKIT_MIN
    assert plotkit_bridge.PLOTKIT_MAX_EXCLUSIVE == PLOTKIT_MAX_EXCLUSIVE


def _fake_plotkit(monkeypatch, version: str, probe=None) -> None:
    module = types.ModuleType("plotkit")
    module.__version__ = version
    if probe is not None:
        module.probe = probe
    monkeypatch.setitem(sys.modules, "plotkit", module)
    monkeypatch.setattr(plotkit_bridge, "ensure_plotkit_importable", lambda: True)


def test_probe_incompatible_below_min(monkeypatch) -> None:
    _fake_plotkit(monkeypatch, "0.1.9")
    result = plotkit_bridge.probe()
    assert result["state"] == "incompatible"
    assert result["version"] == "0.1.9"


def test_probe_available_inside_range(monkeypatch) -> None:
    _fake_plotkit(monkeypatch, "0.2.1")
    result = plotkit_bridge.probe()
    assert result["state"] == "available"
    assert result["version"] == "0.2.1"


def test_probe_incompatible_at_max(monkeypatch) -> None:
    _fake_plotkit(monkeypatch, "0.3.0")
    result = plotkit_bridge.probe()
    assert result["state"] == "incompatible"
    assert result["version"] == "0.3.0"


def test_probe_prefers_public_probe(monkeypatch) -> None:
    _fake_plotkit(monkeypatch, "0.2.1", probe=lambda: {"state": "available", "detail": "ok"})
    result = plotkit_bridge.probe()
    assert result["state"] == "available"
    assert result["detail"] == "ok"
