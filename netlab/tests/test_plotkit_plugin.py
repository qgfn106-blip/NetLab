"""PlotKit 插件声明与宿主桥接的边界测试。"""

from __future__ import annotations

from pathlib import Path

from netlab import plotkit_bridge
from netlab.core.model.plugins import PluginManager


def test_plotkit_plugin_manifest_registers_panel(tmp_path: Path) -> None:
    root = Path(__file__).resolve().parents[2] / "extensions" / "plugins"
    manager = PluginManager(root=root, data_root=tmp_path / "plugin_data")
    records = manager.scan(load=True)

    record = next(item for item in records if item["id"] == "netlab.plotkit")
    assert record["status"] == "loaded", record
    assert "netlab.plotkit.plotkit" in manager.panels
    panel = manager.panels["netlab.plotkit.plotkit"]
    assert panel.title == "PlotKit"
    assert panel.layout["src"] == "/plotkit/"


def test_plotkit_bridge_reports_plugin_metadata() -> None:
    assert plotkit_bridge.plugin_available() is True
    info = plotkit_bridge.diagnose()
    assert info["plugin_id"] == "netlab.plotkit"
    assert info["plugin_available"] is True
    assert info["plugin_path"].endswith("netlab.plotkit")
