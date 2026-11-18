"""S6：工程网格设置保存/回读，且不覆盖既有 manual 连线。"""

from __future__ import annotations

import json

from netlab.core.model.project import compute_checksum


def _edge_geometry(edge: dict) -> dict:
    return {
        "id": edge["id"],
        "source": edge["source"],
        "target": edge["target"],
        "route": edge.get("route", "auto"),
        "waypoints": edge.get("waypoints", []),
        "anchors": edge.get("anchors", {}),
        "layout": edge.get("layout", {}),
        "source_pin": edge.get("source_pin", ""),
        "target_pin": edge.get("target_pin", ""),
    }


def test_project_ui_grid_roundtrip_preserves_grid_and_wire_geometry(client) -> None:
    grid = {
        "spacing": 24,
        "subdivisions": 4,
        "show": True,
        "snap": True,
        "markers": False,
        "angle_mode": "constrained",
        "angle_set": [0, 60],
        "angle_tolerance_deg": 2.5,
        "show_origin": True,
        "show_ruler": False,
        "adaptive_zoom": True,
        "orthogonal": True,
    }
    exported = client.post("/api/project/export", json={"ui": {"grid": grid}})
    assert exported.status_code == 200, exported.text
    project = exported.json()["project"]
    assert project["ui"]["grid"] == grid
    scene_edges = project["networks"][0]["scene"]["edges"]
    scene_edges[0]["route"] = "manual"
    scene_edges[0]["waypoints"] = [{"x": 40, "y": 40}]
    project["checksum"] = compute_checksum(project)
    geometry_before = [_edge_geometry(edge) for edge in scene_edges]
    imported = client.post("/api/project/import", json={"project": json.loads(json.dumps(project))})
    assert imported.status_code == 200, imported.text
    body = imported.json()
    assert body["ui"]["grid"] == grid
    geometry_after = [_edge_geometry(edge) for edge in body["scene"]["edges"]]
    assert geometry_after == geometry_before
