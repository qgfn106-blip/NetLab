# -*- coding: utf-8 -*-
"""W2：每状态预计算 .npz 缓存 + 多状态对比 + 级联失效的接口级测试。"""

from __future__ import annotations

from pathlib import Path


def _states(client):
    response = client.get("/api/network/states")
    assert response.status_code == 200, response.text
    return response.json()


def _make_two_states(client):
    payload = _states(client)
    base_id = payload["states"][0]["id"]
    created = client.post(
        "/api/network/state", json={"action": "create", "name": "状态B"}
    )
    assert created.status_code == 200, created.text
    second_id = next(
        item["id"] for item in created.json()["states"] if item["name"] == "状态B"
    )
    return base_id, second_id


def _precompute(client, state_id, seconds=0.2):
    response = client.post(
        "/api/network/state/precompute",
        json={"state_id": state_id, "seconds": seconds, "dt": 0.002},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_project_context_uses_project_dir(client, tmp_path):
    target = tmp_path / "demo.netlab"
    response = client.post("/api/project/context", json={"path": str(target)})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True
    assert body["temporary"] is False
    assert Path(body["cache_root"]) == tmp_path / ".netlab-states"


def test_project_context_empty_is_temporary(client):
    response = client.post("/api/project/context", json={"path": ""})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["temporary"] is True


def test_precompute_writes_npz_and_status(client, tmp_path):
    client.post("/api/project/context", json={"path": str(tmp_path / "p.netlab")})
    base_id, second_id = _make_two_states(client)
    first = _precompute(client, base_id)
    second = _precompute(client, second_id)
    assert first["ok"] is True and second["ok"] is True
    assert first["frames"] and second["frames"]

    npz_files = sorted((tmp_path / ".netlab-states").glob("*/*.npz"))
    assert len(npz_files) == 2

    status = client.get("/api/network/state/cache").json()
    rows = {row["state_id"]: row for row in status["states"]}
    assert rows[base_id]["cached"] is True
    assert rows[second_id]["cached"] is True
    assert rows[base_id]["frames"] == first["frames"]
    assert rows[base_id]["probes"]


def test_load_state_cache_series(client, tmp_path):
    client.post("/api/project/context", json={"path": str(tmp_path / "p.netlab")})
    base_id, _ = _make_two_states(client)
    pre = _precompute(client, base_id)
    series = client.get(
        "/api/network/state/cache/series", params={"state_id": base_id}
    ).json()
    assert series["ok"] is True
    assert series["times"]
    assert set(series["probe_names"]) == set(pre["probes"])
    first_probe = series["probe_names"][0]
    assert len(series["series"][first_probe]) == len(series["times"])


def test_compare_states_returns_shared_signals(client, tmp_path):
    client.post("/api/project/context", json={"path": str(tmp_path / "p.netlab")})
    base_id, second_id = _make_two_states(client)
    first = _precompute(client, base_id)
    _precompute(client, second_id)
    shared = first["probes"][:2]
    response = client.post(
        "/api/network/state/compare",
        json={"state_ids": [base_id, second_id], "signals": shared},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True
    assert body["signals"] == shared
    ok_entries = [entry for entry in body["states"] if entry["ok"]]
    assert len(ok_entries) == 2
    for entry in ok_entries:
        assert entry["t"]
        for signal in shared:
            assert signal in entry["series"]
            assert len(entry["series"][signal]) == len(entry["t"])


def test_compare_requires_two_states(client, tmp_path):
    client.post("/api/project/context", json={"path": str(tmp_path / "p.netlab")})
    base_id = _states(client)["states"][0]["id"]
    response = client.post(
        "/api/network/state/compare",
        json={"state_ids": [base_id], "signals": []},
    )
    assert response.status_code == 422


def test_update_state_invalidates_cache(client, tmp_path):
    client.post("/api/project/context", json={"path": str(tmp_path / "p.netlab")})
    base_id, second_id = _make_two_states(client)
    _precompute(client, second_id)
    client.post(
        "/api/network/state", json={"action": "update", "state_id": second_id}
    )
    status = client.get("/api/network/state/cache").json()
    rows = {row["state_id"]: row for row in status["states"]}
    assert rows[second_id]["cached"] is False
    assert not list((tmp_path / ".netlab-states").glob(f"*/{second_id}.npz"))


def test_delete_state_cascades_cache(client, tmp_path):
    client.post("/api/project/context", json={"path": str(tmp_path / "p.netlab")})
    base_id, second_id = _make_two_states(client)
    _precompute(client, base_id)
    _precompute(client, second_id)
    assert len(list((tmp_path / ".netlab-states").glob("*/*.npz"))) == 2
    removed = client.post(
        "/api/network/state", json={"action": "delete", "state_id": second_id}
    )
    assert removed.status_code == 200, removed.text
    assert removed.json().get("removed")
    assert removed.json().get("cache_key")
    assert len(list((tmp_path / ".netlab-states").glob("*/*.npz"))) == 1


def test_unify_sim_invalidates_all_caches(client, tmp_path):
    client.post("/api/project/context", json={"path": str(tmp_path / "p.netlab")})
    base_id, second_id = _make_two_states(client)
    _precompute(client, base_id)
    _precompute(client, second_id)
    response = client.post(
        "/api/network/state",
        json={"action": "unify_sim", "state_id": base_id},
    )
    assert response.status_code == 200, response.text
    assert response.json().get("unified") is True
    status = client.get("/api/network/state/cache").json()
    assert all(row["cached"] is False for row in status["states"])


def test_rename_state_keeps_cache(client, tmp_path):
    client.post("/api/project/context", json={"path": str(tmp_path / "p.netlab")})
    base_id, _ = _make_two_states(client)
    _precompute(client, base_id)
    response = client.post(
        "/api/network/state",
        json={"action": "rename", "state_id": base_id, "name": "主状态"},
    )
    assert response.status_code == 200, response.text
    renamed = {row["id"]: row for row in response.json()["states"]}[base_id]
    assert renamed["name"] == "主状态"
    cache = client.get("/api/network/state/cache").json()
    row = {item["state_id"]: item for item in cache["states"]}[base_id]
    assert row["cached"] is True
