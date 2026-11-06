"""内置 PlotKit 副本：安装 / 卸载 / 状态。"""

from __future__ import annotations

from pathlib import Path

import netlab.plotkit_vendor as vendor


def _fake_pkg(root: Path) -> Path:
    src = root / "src" / "plotkit"
    (src / "server").mkdir(parents=True)
    (src / "__init__.py").write_text('__version__ = "9.9.9"\n', encoding="utf-8")
    (src / "server" / "app.py").write_text("VALUE = 1\n", encoding="utf-8")
    return src


def test_status_when_missing(monkeypatch, tmp_path):
    monkeypatch.setattr(vendor, "VENDOR_DIR", tmp_path / "_vendor")
    monkeypatch.setattr(vendor, "TARGET", tmp_path / "_vendor" / "plotkit")
    info = vendor.status()
    assert info["vendored"] is False


def test_install_and_uninstall(monkeypatch, tmp_path):
    src = _fake_pkg(tmp_path)
    monkeypatch.setattr(vendor, "VENDOR_DIR", tmp_path / "_vendor")
    monkeypatch.setattr(vendor, "TARGET", tmp_path / "_vendor" / "plotkit")

    installed = vendor.install(src)
    assert installed["ok"] is True
    assert installed["vendored"] is True
    assert installed["version"] == "9.9.9"
    assert installed["files"] >= 2
    assert vendor.vendor_path() == tmp_path / "_vendor"

    blocked = vendor.install(src)
    assert blocked["ok"] is False and "已存在" in blocked["error"]
    assert vendor.install(src, force=True)["ok"] is True

    removed = vendor.uninstall()
    assert removed["ok"] is True
    assert removed["vendored"] is False
    assert vendor.vendor_path() is None


def test_repo_ships_vendored_plotkit():
    """netlab 应自带 PlotKit 副本（这样用户不必单独下载）。"""
    info = vendor.status()
    assert (
        info["vendored"] is True
    ), "缺少 netlab/_vendor/plotkit，请运行 python -m netlab.plotkit_vendor install"
    assert info["files"] > 10
