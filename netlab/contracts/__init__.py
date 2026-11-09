"""契约真源访问与校验（C1/C2）。

唯一真源在 ``docs/canonical/contracts``；本包只读，不复制规则。
运行期校验按需导入 jsonschema，避免把校验依赖带进生产路径。
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from .generated import (
    API_VERSION,
    PLOT_DOWNSAMPLE,
    PLOT_GRID_WIDTH,
    PLOT_LINE_WIDTH,
    PLOT_MAX_CHANNELS,
    PLOT_MAX_POINTS,
    PLOT_SYNC_PULL_LIMIT,
    PLOT_TIME_FIELD,
    PLOT_VALUE_FIELD,
    PLOTKIT_MAX_EXCLUSIVE,
    PLOTKIT_MIN,
    SCHEMA_VERSIONS,
)

__all__ = [
    "API_VERSION",
    "PLOTKIT_MIN",
    "PLOTKIT_MAX_EXCLUSIVE",
    "SCHEMA_VERSIONS",
    "PLOT_TIME_FIELD",
    "PLOT_VALUE_FIELD",
    "PLOT_LINE_WIDTH",
    "PLOT_GRID_WIDTH",
    "PLOT_MAX_POINTS",
    "PLOT_SYNC_PULL_LIMIT",
    "PLOT_MAX_CHANNELS",
    "PLOT_DOWNSAMPLE",
    "schema_dir",
    "schema",
    "validate",
]

_SCHEMA_NAMES = ("channel_key", "frame", "project", "plot_spec")


def schema_dir() -> Path:
    override = os.environ.get("NETLAB_CANONICAL_DIR")
    if override:
        return Path(override)
    return Path(__file__).resolve().parents[2] / "docs" / "canonical" / "contracts" / "schemas"


def schema(name: str) -> dict[str, Any]:
    if name not in _SCHEMA_NAMES:
        raise KeyError(f"unknown contract schema: {name}")
    path = schema_dir() / f"{name}.schema.json"
    return json.loads(path.read_text(encoding="utf-8"))


def validate(name: str, payload: Any) -> None:
    """按 canonical schema 校验；失败抛 jsonschema.ValidationError。"""
    import jsonschema

    jsonschema.validate(payload, schema(name))
