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


# ---- config validation branches ----

def test_normalize_none_returns_default() -> None:
    assert normalize_analysis_workbench(None) == default_analysis_workbench()


@pytest.mark.parametrize("bad", [42, "x", [], True])
def test_normalize_rejects_non_object(bad) -> None:
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(bad)


def test_rejects_unknown_schema() -> None:
    payload = default_analysis_workbench()
    payload["schema"] = "netlab-analysis-workbench/9"
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(payload)


def test_rejects_unknown_active_analysis() -> None:
    payload = default_analysis_workbench()
    payload["active_analysis"] = "ghost"
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(payload)


def test_rejects_non_array_canvases() -> None:
    payload = default_analysis_workbench()
    payload["canvases"] = "nope"
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(payload)


def test_rejects_non_object_canvas() -> None:
    payload = default_analysis_workbench()
    payload["canvases"] = [42]
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(payload)


def test_rejects_canvas_missing_id() -> None:
    payload = default_analysis_workbench()
    payload["canvases"] = [{"kind": "bode"}]
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(payload)


def test_rejects_duplicate_canvas_id() -> None:
    payload = default_analysis_workbench()
    payload["canvases"] = [_canvas("a"), _canvas("a")]
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(payload)


def test_rejects_canvas_bad_kind() -> None:
    payload = default_analysis_workbench()
    payload["canvases"] = [_canvas("a", "ghost")]
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(payload)


def test_rejects_canvas_missing_figure_id() -> None:
    payload = default_analysis_workbench()
    payload["canvases"] = [{"canvas_id": "a", "kind": "bode"}]
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(payload)


@pytest.mark.parametrize("slot", [-1, "x", True, 1.5])
def test_rejects_bad_slot_id(slot) -> None:
    payload = default_analysis_workbench()
    rec = _canvas("a")
    rec["slot_id"] = slot
    payload["canvases"] = [rec]
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(payload)


def test_default_slot_id_is_index() -> None:
    payload = default_analysis_workbench()
    payload["canvases"] = [_canvas("a")]
    out = normalize_analysis_workbench(payload)
    assert out["canvases"][0]["slot_id"] == 0


# ---- layout node validation branches ----

def _v2_with_root(root) -> dict:
    return {
        "schema": ANALYSIS_WORKBENCH_SCHEMA,
        "active_analysis": "bode",
        "canvases": [_canvas("a"), _canvas("b")],
        "layout": {"tabs": [{"id": "t", "root": root}], "activeTab": "t"},
    }


@pytest.mark.parametrize("bad", [None, 42, "x", []])
def test_rejects_non_object_layout_node(bad) -> None:
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(_v2_with_root(bad))


def test_rejects_unknown_node_type() -> None:
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(_v2_with_root({"type": "ghost"}))


def test_canvas_node_bad_id() -> None:
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(_v2_with_root({"type": "canvas", "canvasId": ""}))
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(_v2_with_root({"type": "canvas", "canvasId": "missing"}))


def test_split_axis_ratio_validation() -> None:
    base = {"type": "canvas", "canvasId": "a"}
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(_v2_with_root({"type": "split", "axis": "x", "first": base, "second": base}))
    for bad in ("x", True, None):
        with pytest.raises(ValidationError):
            normalize_analysis_workbench(_v2_with_root({"type": "split", "axis": "row", "ratio": bad, "first": base, "second": {"type": "canvas", "canvasId": "b"}}))
    for bad in (0.01, 0.99):
        with pytest.raises(ValidationError):
            normalize_analysis_workbench(_v2_with_root({"type": "split", "axis": "row", "ratio": bad, "first": base, "second": {"type": "canvas", "canvasId": "b"}}))


def test_split_with_valid_ratio() -> None:
    root = {"type": "split", "axis": "column", "ratio": 0.42, "first": {"type": "canvas", "canvasId": "a"}, "second": {"type": "canvas", "canvasId": "b"}}
    out = normalize_analysis_workbench(_v2_with_root(root))
    assert out["layout"]["tabs"][0]["root"]["ratio"] == 0.42


def test_tabs_children_validation() -> None:
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(_v2_with_root({"type": "tabs", "children": [], "active": "a"}))
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(_v2_with_root({"type": "tabs", "children": [{"type": "split"}], "active": "a"}))
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(_v2_with_root({"type": "tabs", "children": [{"type": "canvas", "canvasId": None}], "active": "a"}))


def test_tabs_active_falls_back_to_first_child() -> None:
    root = {"type": "tabs", "children": [{"type": "canvas", "canvasId": "a"}, {"type": "canvas", "canvasId": "b"}], "active": "ghost"}
    out = normalize_analysis_workbench(_v2_with_root(root))
    assert out["layout"]["tabs"][0]["root"]["active"] == "a"


def test_tabs_node_as_split_child() -> None:
    inner = {"type": "tabs", "children": [{"type": "canvas", "canvasId": "b"}], "active": "b"}
    out = normalize_analysis_workbench(_v2_with_root({"type": "split", "axis": "row", "first": inner, "second": {"type": "canvas", "canvasId": "a"}}))
    root = out["layout"]["tabs"][0]["root"]
    assert root["first"]["type"] == "tabs"
    assert root["second"]["canvasId"] == "a"


def test_auto_node_validation() -> None:
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(_v2_with_root({"type": "auto", "canvasIds": []}))
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(_v2_with_root({"type": "auto", "canvasIds": ["missing"]}))
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(_v2_with_root({"type": "auto", "canvasIds": ["a", "a"]}))
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(_v2_with_root({"type": "auto", "canvasIds": [42]}))


def test_auto_node_valid() -> None:
    out = normalize_analysis_workbench(_v2_with_root({"type": "auto", "canvasIds": ["a", "b"]}))
    assert out["layout"]["tabs"][0]["root"]["canvasIds"] == ["a", "b"]


# ---- v2 layout structure branches ----

def test_rejects_non_object_layout() -> None:
    payload = default_analysis_workbench()
    payload["layout"] = "bad"
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(payload)


def test_tabs_non_object_entries_rejected() -> None:
    payload = default_analysis_workbench()
    payload["layout"] = {"tabs": [42], "activeTab": ""}
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(payload)


def test_duplicate_tab_ids_rejected() -> None:
    payload = default_analysis_workbench()
    payload["canvases"] = [_canvas("a"), _canvas("b")]
    payload["layout"] = {"tabs": [
        {"id": "t", "root": {"type": "canvas", "canvasId": "a"}},
        {"id": "t", "root": {"type": "canvas", "canvasId": "b"}},
    ], "activeTab": "t"}
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(payload)


def test_missing_tab_id_title_active_fallback() -> None:
    payload = default_analysis_workbench()
    payload["canvases"] = [_canvas("a")]
    payload["layout"] = {"tabs": [{"root": {"type": "canvas", "canvasId": "a"}}], "activeTab": "ghost"}
    out = normalize_analysis_workbench(payload)
    assert out["layout"]["tabs"][0]["id"] == "tab-1"
    assert out["layout"]["tabs"][0]["title"] == "视图 1"
    assert out["layout"]["activeTab"] == "tab-1"


def test_missing_canvas_appended_to_tabs_root() -> None:
    payload = default_analysis_workbench()
    payload["canvases"] = [_canvas("a"), _canvas("b")]
    payload["layout"] = {"tabs": [{"id": "t", "root": {"type": "canvas", "canvasId": "a"}}], "activeTab": "t"}
    out = normalize_analysis_workbench(payload)
    root = out["layout"]["tabs"][0]["root"]
    assert root["type"] == "split"
    assert root["second"] == {"type": "auto", "canvasIds": ["b"]}


def test_missing_canvas_appended_to_auto_root() -> None:
    payload = default_analysis_workbench()
    payload["canvases"] = [_canvas("a"), _canvas("b")]
    payload["layout"] = {"tabs": [{"id": "t", "root": {"type": "auto", "canvasIds": ["a"]}}], "activeTab": "t"}
    out = normalize_analysis_workbench(payload)
    assert out["layout"]["tabs"][0]["root"]["canvasIds"] == ["a", "b"]


def test_missing_canvas_appended_to_tabs_node() -> None:
    payload = default_analysis_workbench()
    payload["canvases"] = [_canvas("a"), _canvas("b")]
    payload["layout"] = {"tabs": [{"id": "t", "root": {"type": "tabs", "children": [{"type": "canvas", "canvasId": "a"}], "active": "a"}}], "activeTab": "t"}
    out = normalize_analysis_workbench(payload)
    assert len(out["layout"]["tabs"][0]["root"]["children"]) == 2


def test_no_tabs_creates_auto_from_missing_canvases() -> None:
    payload = default_analysis_workbench()
    payload["canvases"] = [_canvas("a"), _canvas("b")]
    payload["layout"] = {"tabs": [], "activeTab": ""}
    out = normalize_analysis_workbench(payload)
    assert out["layout"]["tabs"][0]["root"] == {"type": "auto", "canvasIds": ["a", "b"]}
    assert out["layout"]["activeTab"] == "tab-1"


# ---- sizes / collapsed / selected branches ----

def test_rejects_non_object_sizes() -> None:
    payload = default_analysis_workbench()
    payload["sizes"] = "bad"
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(payload)


@pytest.mark.parametrize("field,value", [("sidebar", 100), ("sidebar", 999), ("detail", 10), ("detail", True)])
def test_rejects_out_of_range_sizes(field, value) -> None:
    payload = default_analysis_workbench()
    payload["sizes"][field] = value
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(payload)


def test_rejects_non_object_collapsed() -> None:
    payload = default_analysis_workbench()
    payload["collapsed"] = "bad"
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(payload)


def test_collapsed_coerces_to_bool() -> None:
    payload = default_analysis_workbench()
    payload["collapsed"] = {"sidebar": "yes", "detail": True}
    out = normalize_analysis_workbench(payload)
    assert out["collapsed"] == {"sidebar": False, "detail": True}


@pytest.mark.parametrize("bad", ["x", 42, ["a", ""], [42], [[1]]])
def test_rejects_bad_selected_state_ids(bad) -> None:
    payload = default_analysis_workbench()
    payload["selected_state_ids"] = bad
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(payload)


def test_rejects_duplicate_selected_state_ids() -> None:
    payload = default_analysis_workbench()
    payload["selected_state_ids"] = ["a", "a"]
    with pytest.raises(ValidationError):
        normalize_analysis_workbench(payload)


def test_ui_with_analysis_workbench_normalizes_and_preserves_ui() -> None:
    from netlab.core.model.analysis_workbench_schema import ui_with_analysis_workbench

    ui = {"profile": "netlab-ui/1", "analysis_workbench": None}
    out = ui_with_analysis_workbench(ui)
    assert out["profile"] == "netlab-ui/1"
    assert out["analysis_workbench"]["schema"] == ANALYSIS_WORKBENCH_SCHEMA


def test_ui_with_analysis_workbench_rejects_non_object_ui() -> None:
    from netlab.core.model.analysis_workbench_schema import ui_with_analysis_workbench

    with pytest.raises(ValidationError):
        ui_with_analysis_workbench(42)
