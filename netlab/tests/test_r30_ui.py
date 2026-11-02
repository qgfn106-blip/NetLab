"""R30：启动引导/文档中心/外观偏好的接口契约。"""

from __future__ import annotations

import pytest


def test_default_simulation_is_blank():
    from netlab.core.compute.simulation import default_simulation

    simulation = default_simulation()
    assert len(simulation.scene.nodes) == 0
    assert len(simulation.scene.edges) == 0


def test_docs_index_returns_five_user_docs(client):
    response = client.get("/api/docs")
    assert response.status_code == 200
    docs = response.json()["docs"]
    assert [doc["slug"] for doc in docs] == [
        "quickstart",
        "interface",
        "glossary",
        "faq",
        "shortcuts",
    ]
    for doc in docs:
        assert doc["title"]
        assert doc["text"].lstrip().startswith("#")
        assert len(doc["text"]) > 200


def test_docs_single_and_unknown_slug(client):
    response = client.get("/api/docs/glossary")
    assert response.status_code == 200
    assert response.json()["slug"] == "glossary"
    assert "术语" in response.json()["text"]

    missing = client.get("/api/docs/nope")
    assert missing.status_code == 404


def test_ui_settings_defaults_and_validation(client, tmp_path, monkeypatch):
    from netlab.core.model.workspace import default_settings, load_settings, save_settings

    # 隔离到临时设置目录，避免污染本机 %APPDATA%/Netlab 的真实偏好
    monkeypatch.setenv("NETLAB_SETTINGS_DIR", str(tmp_path / "settings"))

    settings = client.get("/api/settings").json()["settings"]
    assert settings["ui_motion"] == "low"
    assert settings["ui_perf"] == "perf"
    assert settings["ui_guide"] == "always"
    assert settings["ui_accent"] == ""
    assert settings == default_settings()

    patched = client.patch("/api/settings", json={"ui_motion": "high"})
    assert patched.status_code == 200
    assert load_settings()["ui_motion"] == "high"

    with pytest.raises(Exception, match="ui_motion"):
        save_settings({"ui_motion": "turbo"})
    with pytest.raises(Exception, match="ui_perf"):
        save_settings({"ui_perf": "ultra"})
    with pytest.raises(Exception, match="#rrggbb"):
        save_settings({"ui_accent": "red"})
    assert save_settings({"ui_accent": "#9b7247"})["ui_accent"] == "#9b7247"
    assert save_settings({"ui_guide": "never"})["ui_guide"] == "never"
