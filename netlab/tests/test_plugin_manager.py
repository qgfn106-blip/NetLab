"""R40 插件包加载器测试。"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from netlab.core.compute.computes import COMPUTE_SPECS
from netlab.core.model.plugins import PluginManager, version_satisfies
from netlab.core.common.limits import ValidationError


def _write_plugin(
    root: Path, plugin_id: str = "com.example.demo", *, version: str = "1.0.0"
) -> None:
    directory = root / plugin_id
    directory.mkdir(parents=True)
    manifest = {
        "schema": "netlab-plugin/1",
        "id": plugin_id,
        "name": "Demo",
        "version": version,
        "plugin_api": "1.0",
        "netlab": ">=3.0 <4.0",
        "entry": "plugin:register",
        "capabilities": ["compute"],
    }
    (directory / "plugin.json").write_text(json.dumps(manifest), encoding="utf-8")
    (directory / "plugin.py").write_text(
        "from netlab.plugin_api.v1 import ComputeSpec\n\n"
        "def register(ctx):\n"
        "    ctx.register_compute(ComputeSpec(\n"
        "        kind='double', label='Double', group='测试', description='', params=(),\n"
        "        factory=lambda params: (lambda ctx: {}),\n"
        "    ))\n",
        encoding="utf-8",
    )


def test_plugin_scan_loads_and_disable_unloads(tmp_path: Path) -> None:
    _write_plugin(tmp_path)
    manager = PluginManager(root=tmp_path, data_root=tmp_path / "data")
    records = manager.scan(load=True)
    assert len(records) == 1
    assert records[0]["status"] == "loaded", records[0]
    kind = "com.example.demo.double"
    assert kind in COMPUTE_SPECS
    assert manager.set_enabled("com.example.demo", False)["status"] == "disabled"
    assert kind not in COMPUTE_SPECS
    manager.set_enabled("com.example.demo", True)
    assert kind in COMPUTE_SPECS

    # 清理全局注册表，避免影响后续用例
    manager.set_enabled("com.example.demo", False)


def test_plugin_rejects_invalid_manifest(tmp_path: Path) -> None:
    directory = tmp_path / "bad"
    directory.mkdir()
    (directory / "plugin.json").write_text("{", encoding="utf-8")
    manager = PluginManager(root=tmp_path, data_root=tmp_path / "data")
    records = manager.scan(load=True)
    assert records and records[0]["status"] == "error"


def test_version_satisfies() -> None:
    assert version_satisfies("3.19.0", ">=3.0 <4.0")
    assert not version_satisfies("2.0.0", ">=3.0 <4.0")
    assert version_satisfies("1.2.3", "1.2.3")
    with pytest.raises(ValueError):
        version_satisfies("1.0.0", "nope")
