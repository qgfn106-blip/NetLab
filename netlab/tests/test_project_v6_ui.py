"""R40 工程 v6 与 UI profile 测试。"""

from __future__ import annotations

import copy

from netlab.core.model.project import (
    PROJECT_FORMAT,
    PROJECT_VERSION,
    build_project,
    migrate_project,
    validate_project,
)
from netlab.core.model.project import make_network
from netlab.core.model.templates import build_template
from netlab.core.model.ui_profile import default_ui, normalize_ui
from netlab.core.compute.simulation import Simulation
from netlab.core.common.limits import ValidationError
import pytest


def test_v5_project_migrates_to_v6_with_plugins_and_ui() -> None:
    scene = build_template("signal_chain")
    network = make_network("主网络", scene, {"dt": 0.01})
    project = build_project(Simulation(), name="旧工程")
    # build_project uses the live scene; construct a v5-shaped payload directly
    old = {
        "format": PROJECT_FORMAT,
        "version": 5,
        "app": "netlab 2.1.0",
        "name": "旧工程",
        "created": project["created"],
        "modified": project["modified"],
        "networks": [network],
        "current": network["id"],
        "fem": {},
        "ui": {},
        "blocks": [],
        "extensions": [],
        "metadata": {},
    }
    migrated = migrate_project(old)
    assert migrated["version"] == PROJECT_VERSION == 7
    assert migrated["plugins"] == []
    assert migrated["ui"]["profile"] == "netlab-ui/1"
    assert migrated["metadata"]["migrated_plugins"] == "v5"
    validate_project(migrated)


def test_ui_profile_defaults_and_normalization() -> None:
    base = default_ui()
    assert base["profile"] == "netlab-ui/1"
    changed = copy.deepcopy(base)
    changed["tokens"]["accent"] = "#123abc"
    changed["layout"]["panel_width"] = 400
    normalized = normalize_ui(changed)
    assert normalized["tokens"]["accent"] == "#123abc"
    assert normalized["layout"]["panel_width"] == 400.0


def test_ui_profile_rejects_bad_values() -> None:
    base = default_ui()
    bad = copy.deepcopy(base)
    bad["tokens"]["accent"] = "red"
    with pytest.raises(ValidationError):
        normalize_ui(bad)
    bad = copy.deepcopy(base)
    bad["profile"] = "other"
    with pytest.raises(ValidationError):
        normalize_ui(bad)


def test_plugins_api_lists_plugins(client) -> None:
    response = client.get("/api/plugins")
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body["plugins"], list)


def test_ui_api_roundtrip(client) -> None:
    got = client.get("/api/ui")
    assert got.status_code == 200
    body = got.json()
    assert body["profile"] == "netlab-ui/1"
    payload = body["current"]
    payload["tokens"]["accent"] = "#123abc"
    payload["layout"]["panel_width"] = 360
    saved = client.post("/api/ui", json=payload)
    assert saved.status_code == 200
    assert saved.json()["current"]["tokens"]["accent"] == "#123abc"
    assert saved.json()["current"]["layout"]["panel_width"] == 360.0
