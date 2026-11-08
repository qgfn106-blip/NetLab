"""S2：PlotKit 公开接口与宿主私有符号零引用（先红后绿）。

对应 C-4 工作契约 S2 判据：
- PlotKit 侧有最小稳定 API：``probe()`` 三态 + ``PlotRenderPort`` / ``create_server()``；
- 宿主（netlab）不再 import ``plotkit.store.*`` / ``plotkit.server.*`` 内部模块。
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

NETLAB_ROOT = Path(__file__).resolve().parents[1]
_FORBIDDEN = ("plotkit." + "store.", "plotkit." + "server.")


def _iter_source_files():
    for path in NETLAB_ROOT.rglob("*.py"):
        if "_vendor" in path.parts:
            continue
        if path.name == Path(__file__).name:
            continue
        yield path


def test_host_does_not_import_plotkit_private_modules():
    hits: list[str] = []
    for path in _iter_source_files():
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            stripped = line.strip()
            if stripped.startswith("#"):
                continue
            for needle in _FORBIDDEN:
                if needle in line:
                    rel = path.relative_to(NETLAB_ROOT.parent)
                    hits.append(f"{rel}:{lineno}: {stripped}")
    assert not hits, "宿主仍引用 PlotKit 私有模块：\n" + "\n".join(hits)


def test_plotkit_exposes_stable_host_api():
    from netlab import plotkit_bridge

    assert plotkit_bridge.ensure_plotkit_importable()
    import plotkit

    for name in ("probe", "store_lock", "index_html", "create_server", "PlotRenderPort"):
        assert callable(getattr(plotkit, name, None)), f"plotkit.{name} 不是可调用公开接口"


def test_probe_available():
    from netlab import plotkit_bridge

    result = plotkit_bridge.probe()
    assert result["state"] == "available", result
    assert str(result["version"]).startswith("0.2."), result


def test_probe_missing(monkeypatch):
    from netlab import plotkit_bridge

    monkeypatch.setitem(sys.modules, "plotkit", None)
    monkeypatch.setattr(plotkit_bridge, "ensure_plotkit_importable", lambda: False)
    result = plotkit_bridge.probe()
    assert result["state"] == "missing", result


def test_probe_incompatible(monkeypatch):
    from netlab import plotkit_bridge

    fake = types.ModuleType("plotkit")
    fake.__version__ = "0.1.9"
    monkeypatch.setitem(sys.modules, "plotkit", fake)
    result = plotkit_bridge.probe()
    assert result["state"] == "incompatible", result
    assert "0.1.9" in str(result["detail"]), result
