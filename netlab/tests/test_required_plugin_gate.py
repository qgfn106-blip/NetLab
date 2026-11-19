"""D7：必需插件门禁（PlotKit 不能被禁用/缺失时给具体原因）。"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from netlab.core.common.limits import ValidationError
from netlab.core.model.plugins import (
    LOCKFILE_NAME,
    REQUIRED_PLUGIN_IDS,
    PluginManager,
)

PLUGIN_ID = "netlab.plotkit"


def _write_plugin(root: Path, *, entry: str = "plugin:register") -> Path:
    plugin = root / PLUGIN_ID
    plugin.mkdir(parents=True, exist_ok=True)
    (plugin / "plugin.json").write_text(
        json.dumps(
            {
                "schema": "netlab-plugin/1",
                "id": PLUGIN_ID,
                "name": "Fake PlotKit",
                "version": "0.3.0",
                "plugin_api": "1.0",
                "netlab": ">=0.1",
                "entry": entry,
                "capabilities": ["panel"],
            }
        ),
        encoding="utf-8",
    )
    (plugin / "plugin.py").write_text(
        "def register(ctx):\n    return None\n", encoding="utf-8"
    )
    return plugin


def test_plotkit_is_the_required_plugin() -> None:
    assert PLUGIN_ID in REQUIRED_PLUGIN_IDS


def test_missing_required_plugin_reports_reason(tmp_path: Path) -> None:
    manager = PluginManager(root=tmp_path / "plugins", data_root=tmp_path / "data")
    manager.scan(load=True)

    issues = manager.required_issues()
    assert [issue["plugin_id"] for issue in issues] == [PLUGIN_ID]
    assert issues[0]["status"] == "missing"
    assert PLUGIN_ID in issues[0]["reason"]


def test_required_plugin_loaded_has_no_issue(tmp_path: Path) -> None:
    root = tmp_path / "plugins"
    _write_plugin(root)
    manager = PluginManager(root=root, data_root=tmp_path / "data")
    manager.scan(load=True)

    assert manager.required_issues() == []
    assert manager.set_enabled(PLUGIN_ID, True)["status"] == "loaded"


def test_required_plugin_cannot_be_disabled(tmp_path: Path) -> None:
    root = tmp_path / "plugins"
    _write_plugin(root)
    manager = PluginManager(root=root, data_root=tmp_path / "data")
    manager.scan(load=True)

    with pytest.raises(ValidationError, match="必需插件"):
        manager.set_enabled(PLUGIN_ID, False)

    assert manager.required_issues() == []
    assert manager.set_enabled(PLUGIN_ID, True)["status"] == "loaded"


def test_legacy_disabled_record_is_cleared(tmp_path: Path) -> None:
    root = tmp_path / "plugins"
    _write_plugin(root)
    root.mkdir(parents=True, exist_ok=True)
    (root / LOCKFILE_NAME).write_text(
        json.dumps({"disabled": [PLUGIN_ID, "com.example.optional"]}),
        encoding="utf-8",
    )

    manager = PluginManager(root=root, data_root=tmp_path / "data")
    assert PLUGIN_ID not in manager._disabled
    manager.scan(load=True)
    assert manager.required_issues() == []


def test_failed_required_plugin_reports_status_and_error(tmp_path: Path) -> None:
    root = tmp_path / "plugins"
    _write_plugin(root, entry="missing_module:register")
    manager = PluginManager(root=root, data_root=tmp_path / "data")
    manager.scan(load=True)

    issues = manager.required_issues()
    assert len(issues) == 1
    assert issues[0]["status"] == "error"
    assert issues[0]["reason"]
