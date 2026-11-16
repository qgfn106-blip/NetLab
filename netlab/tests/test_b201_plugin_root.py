"""REM-B2-01（PS-01）：默认插件根必须指向真实的 NetlabHome/extensions/plugins，
并能发现 netlab.plotkit。修复前 plugins.PLUGIN_ROOT 用 parents[2] 指到 netlab/extensions。"""

from __future__ import annotations

from netlab.core.model import plugins as plugins_mod
from netlab.core.model.plugins import PluginManager


def test_default_plugin_root_is_real_extensions() -> None:
    root = plugins_mod.PLUGIN_ROOT
    assert root.name == "plugins", root
    assert root.parent.name == "extensions", root
    assert (root / "netlab.plotkit" / "plugin.json").is_file(), root


def test_scan_discovers_plotkit() -> None:
    manager = PluginManager()
    records = manager.scan(load=False)
    ids = {str(r.get("id")) for r in records}
    assert "netlab.plotkit" in ids, ids
