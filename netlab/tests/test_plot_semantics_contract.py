"""C-3 / N-14：帧数据→绘图语义唯一真源。"""
from __future__ import annotations

from pathlib import Path

import yaml

from netlab import plotkit_bridge
from netlab.contracts import (
    PLOT_DOWNSAMPLE,
    PLOT_GRID_WIDTH,
    PLOT_LINE_WIDTH,
    PLOT_MAX_CHANNELS,
    PLOT_MAX_POINTS,
    PLOT_SYNC_PULL_LIMIT,
    PLOT_TIME_FIELD,
    PLOT_VALUE_FIELD,
)

ROOT = Path(__file__).resolve().parents[2]
SEMANTICS = ROOT / "docs" / "canonical" / "contracts" / "plot_semantics.yaml"


def _semantics() -> dict:
    return yaml.safe_load(SEMANTICS.read_text(encoding="utf-8"))


def test_generated_constants_match_canonical_yaml() -> None:
    data = _semantics()
    assert PLOT_TIME_FIELD == data["time_field"]
    assert PLOT_VALUE_FIELD == data["value_field"]
    assert PLOT_LINE_WIDTH == data["line_width"]
    assert PLOT_GRID_WIDTH == data["grid_width"]
    assert PLOT_MAX_POINTS == data["max_points"]
    assert PLOT_SYNC_PULL_LIMIT == data["sync_pull_limit"]
    assert PLOT_MAX_CHANNELS == data["max_channels"]
    assert PLOT_DOWNSAMPLE == data["downsample"]


def test_bridge_uses_shared_plot_semantics() -> None:
    data = _semantics()
    assert plotkit_bridge.MAX_POINTS == data["max_points"]
    assert plotkit_bridge.SYNC_PULL_LIMIT == data["sync_pull_limit"]
    assert plotkit_bridge.MAX_CHANNELS == data["max_channels"]
    assert plotkit_bridge.LINE_STYLE["width"] == data["line_width"]


def test_frame_and_plot_spec_share_time_field() -> None:
    frame = _semantics()
    schemas = ROOT / "docs" / "canonical" / "contracts" / "schemas"
    frame_schema = yaml.safe_load((schemas / "frame.schema.json").read_text(encoding="utf-8"))
    plot_schema = yaml.safe_load((schemas / "plot_spec.schema.json").read_text(encoding="utf-8"))
    assert frame["time_field"] in frame_schema["properties"]
    assert frame["value_field"] in frame_schema["properties"]
    assert plot_schema["properties"]["layers"]["type"] == "array"
    assert "layers" in plot_schema["required"]
