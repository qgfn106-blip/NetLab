"""R40 P-B 元素外观前端静态护栏。"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def test_appearance_panel_has_extended_controls_and_batch_targets() -> None:
    source = _read("frontend/app.ts") + _read("frontend/app/appearance_panel.ts")
    for marker in (
        "appearanceTargets",
        "元素外观（已选",
        "strokeColor",
        "fillColor",
        "textColor",
        "portColor",
        "tickColor",
        "lineStyle",
        "contrastRatio",
        "persistElementAppearance",
        "视图设计…",
    ):
        assert marker in source, marker


def test_appearance_types_and_renderers_share_extended_fields() -> None:
    types = _read("frontend/app/types.ts")
    for field in ("fillColor", "strokeColor", "textColor", "portColor", "tickColor", "lineStyle"):
        assert field in types, field
    assert "AppearanceLineStyle" in types
    for path in ("frontend/app/canvas_nodes.ts", "frontend/app/canvas_edges.ts", "frontend/app/canvas_glyphs.ts"):
        source = _read(path)
        assert "appearanceOf" in source or "AppearanceRec" in source, path


def test_scene_types_accepts_extended_appearance() -> None:
    source = _read("netlab/core/model/scene_types.py")
    for field in ("fillColor", "strokeColor", "textColor", "portColor", "tickColor", "lineStyle"):
        assert field in source, field
    assert "APPEARANCE_LINE_STYLES" in source


def test_appearance_batch_endpoint_and_presentation_revision() -> None:
    server = _read("netlab/server_scene/__init__.py")
    edit = _read("netlab/core/model/scene_edit.py")
    app_ts = _read("frontend/app.ts")
    assert "/api/scene/appearance" in server
    assert "AppearanceBatch" in server
    assert "update_appearance_batch" in edit
    assert "self.revision += 1" in edit  # 外观不进入物理编译缓存键
    assert "persistElementAppearanceBatch" in app_ts
