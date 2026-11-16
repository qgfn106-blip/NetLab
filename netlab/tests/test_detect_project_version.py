"""P2-D D2：`detect_project_version` 纯函数边界（行为保持型抽取，零回归）。"""

from __future__ import annotations

import copy

import pytest

from netlab.core.common.limits import ValidationError
from netlab.core.model import project as P


def _proj(version) -> dict:
    return {"format": P.PROJECT_FORMAT, "version": version, "networks": [], "current": ""}


def test_non_mapping_rejected() -> None:
    with pytest.raises(ValidationError):
        P.detect_project_version(["not", "a", "dict"])  # type: ignore[arg-type]


def test_missing_format_and_not_scene_json_rejected() -> None:
    with pytest.raises(ValidationError):
        P.detect_project_version({"foo": 1})


def test_scene_json_returns_project_version() -> None:
    scene = {"mode": "signal", "nodes": [{"id": "a"}], "edges": []}
    assert P.detect_project_version(scene) == P.PROJECT_VERSION


@pytest.mark.parametrize("v", [0, 1, 2, 3, 4, 5, 6, 7])
def test_known_versions_return_self(v: int) -> None:
    assert P.detect_project_version(_proj(v)) == v


def test_future_version_rejected() -> None:
    with pytest.raises(ValidationError):
        P.detect_project_version(_proj(8))


def test_bool_is_int_quirk_preserved() -> None:
    # 历史怪癖：isinstance(True, int) 为真 → 视为 version 1，原样保留。
    assert P.detect_project_version(_proj(True)) is True


def test_negative_and_non_int_rejected() -> None:
    for bad in (-1, "7", 7.0, None):
        with pytest.raises(ValidationError):
            P.detect_project_version(_proj(bad))


def test_does_not_mutate_payload() -> None:
    payload = _proj(6)
    snapshot = copy.deepcopy(payload)
    P.detect_project_version(payload)
    assert payload == snapshot
