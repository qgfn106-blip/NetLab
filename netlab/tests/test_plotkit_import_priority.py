"""PlotKit 加载链（2026-11-08 S4 / D154）。

C-4 之后只剩两级来源：已安装的包 → ``NETLAB_PLOTKIT_SRC`` 显式开发目录。
内置副本、插件副本、同仓库相对路径都不再是候选；任何一级都不得改动
``sys.path``。这些测试锁住加载链的形状，防止后续把隐式回退加回来。
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
BRIDGE = REPO / "netlab" / "plotkit_bridge.py"


def _loader_function_source() -> str:
    source = BRIDGE.read_text(encoding="utf-8")
    start = source.index("def ensure_plotkit_importable()")
    end = source.index("def last_error()")
    return source[start:end]


def test_loader_no_longer_knows_vendor_or_sys_path_insert():
    body = _loader_function_source()
    assert "sys.path.insert" not in body
    assert "plotkit_vendor" not in body
    assert "_vendor" not in body
    assert "NETLAB_PLOTKIT_SRC" in body


def test_development_source_loads_without_touching_sys_path(tmp_path, monkeypatch):
    package = tmp_path / "plotkit"
    package.mkdir()
    (package / "__init__.py").write_text(
        "MARKER = 'override'\n__version__ = '0.2.9'\n", encoding="utf-8"
    )

    from netlab import plotkit_bridge

    real_import = importlib.import_module

    def fake_import(name, *args, **kwargs):
        if name == "plotkit":
            raise ModuleNotFoundError("No module named 'plotkit'")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(plotkit_bridge.importlib, "import_module", fake_import)
    monkeypatch.setenv("NETLAB_PLOTKIT_SRC", str(tmp_path))
    monkeypatch.delitem(sys.modules, "plotkit", raising=False)

    before = list(sys.path)
    assert plotkit_bridge.ensure_plotkit_importable(), plotkit_bridge.last_error()
    import plotkit

    assert plotkit.MARKER == "override"
    assert Path(plotkit.__file__).resolve().parent == package.resolve()
    assert list(sys.path) == before
    sys.modules.pop("plotkit", None)


def test_missing_plotkit_reports_readable_error(monkeypatch):
    from netlab import plotkit_bridge

    real_import = importlib.import_module

    def fake_import(name, *args, **kwargs):
        if name == "plotkit":
            raise ModuleNotFoundError("No module named 'plotkit'")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(plotkit_bridge.importlib, "import_module", fake_import)
    monkeypatch.delenv("NETLAB_PLOTKIT_SRC", raising=False)
    monkeypatch.delitem(sys.modules, "plotkit", raising=False)

    assert not plotkit_bridge.ensure_plotkit_importable()
    assert "未安装" in plotkit_bridge.last_error()
    assert plotkit_bridge.probe()["state"] == "missing"


def test_installed_package_is_used_without_vendor(monkeypatch):
    if importlib.util.find_spec("plotkit") is None:
        pytest.skip("本环境未安装 plotkit")
    from netlab import plotkit_bridge

    monkeypatch.delenv("NETLAB_PLOTKIT_SRC", raising=False)
    assert plotkit_bridge.ensure_plotkit_importable(), plotkit_bridge.last_error()
    import plotkit

    assert "_vendor" not in str(plotkit.__file__).lower()
