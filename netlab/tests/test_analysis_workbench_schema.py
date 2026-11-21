"""分析工作台 schema v2 与 v1 布局迁移的回归测试。"""

from __future__ import annotations

import pytest

from netlab.core.common.limits import ValidationError
from netlab.core.model.analysis_workbench_schema import (
    ANALYSIS_WORKBENCH_SCHEMA,
    default_analysis_workbench,
    normalize_analysis_workbench,
)


def _canvas(canvas_id: str, kind: str = "bode") -> dict:
    return {
        "canvas_id": canvas_id,
        "kind": kind,
        "figure_id": "f1",
        "slot_id": 0,
        "title": canvas_id,
    }


def _v1(mode: str, order: list[str]) -> dict:
    return {
        "schema": "netlab-analysis-workbench/1",
        "active_analysis": "bode",
        "canvases": [_canvas(canvas_id) for canvas_id in order],
        "layout": {"mode": mode, "rows": 1, "cols": len(order), "order": order},
        "sizes": {"sidebar": 280, "detail": 320},
        "selected_state_ids": [],
    }


def test_default_analysis_workbench_uses_v2_schema() -> None:
    workbench = default_analysis_workbench()
    assert workbench["schema"] == ANALYSIS_WORKBENCH_SCHEMA
    assert workbench["layout"] == {"tabs": [], "activeTab": ""}
    assert workbench["collapsed"] == {"sidebar": False, "detail": False}


def test_v1_grid_layout_migrates_to_auto_tab() -> None:
    workbench = normalize_analysis_workbench(_v1("grid", ["a", "b"]))
    layout = workbench["layout"]
    assert layout["activeTab"]
    assert len(layout["tabs"]) == 1
    assert layout["tabs"][0]["root"] == {"type": "auto", "canvasIds": ["a", "b"]}


def test_v1_split_layout_migrates_to_balanced_row_split() -> None:
    workbench = normalize_analysis_workbench(_v1("split", ["a", "b"]))
    root = workbench["layout"]["tabs"][0]["root"]
    assert root["type"] == "split"
    assert root["axis"] == "row"
    assert root["ratio"] == 0.5
    assert root["first"] == {"type": "canvas", "canvasId": "a"}
    assert root["second"] == {"type": "canvas", "canvasId": "b"}


def test_v2_layout_appends_canvas_missing_from_tree() -> None:
    workbench = normalize_analysis_workbench(
        {
            "schema": ANALYSIS_WORKBENCH_SCHEMA,
            "active_analysis": "bode",
            "canvases": [_canvas("a"), _canvas("b")],
            "layout": {
                "tabs": [{"id": "t1", "title": "主视图", "root": {"type": "canvas", "canvasId": "a"}}],
                "activeTab": "t1",
            },
        }
    )
    root = workbench["layout"]["tabs"][0]["root"]
    assert root["type"] == "split"
    assert root["second"] == {"type": "auto", "canvasIds": ["b"]}


def test_v2_layout_rejects_duplicate_canvas() -> None:
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(
            {
                "schema": ANALYSIS_WORKBENCH_SCHEMA,
                "active_analysis": "bode",
                "canvases": [_canvas("a")],
                "layout": {
                    "tabs": [
                        {
                            "id": "t1",
                            "title": "主视图",
                            "root": {
                                "type": "split",
                                "axis": "row",
                                "ratio": 0.5,
                                "first": {"type": "canvas", "canvasId": "a"},
                                "second": {"type": "canvas", "canvasId": "a"},
                            },
                        }
                    ],
                    "activeTab": "t1",
                },
            }
        )
