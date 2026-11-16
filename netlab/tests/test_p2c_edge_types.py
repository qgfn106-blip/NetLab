"""P2-C Edge 三型契约测试（纯新增，不接线）。"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from netlab.core.model.edge_types import (
    EDGE_TYPES,
    EdgeDesc,
    EdgeTypeInfo,
    classify_edge_kind,
    edge_participates_in_solve,
    try_classify_edge_kind,
)


def test_edge_types_tuple():
    assert EDGE_TYPES == ("dependency", "physical", "layout")


@pytest.mark.parametrize(
    "kind,expected",
    [("dependency", "dependency"), ("physical", "physical"), ("layout", "layout"),
     ("wire", "physical"), ("signal", "dependency")],
)
def test_classify_known_and_legacy(kind, expected):
    assert classify_edge_kind(kind) == expected


def test_classify_unknown_fail_closed():
    with pytest.raises(ValueError):
        classify_edge_kind("bogus")
    with pytest.raises(ValueError):
        classify_edge_kind(123)
    assert try_classify_edge_kind("bogus") is None
    assert try_classify_edge_kind("wire") == "physical"


@pytest.mark.parametrize(
    "kind,expected",
    [("dependency", True), ("physical", True), ("layout", False), ("wire", True)],
)
def test_participates_in_solve(kind, expected):
    assert edge_participates_in_solve(kind) is expected


def test_edge_type_info_registry():
    for k in EDGE_TYPES:
        info = __import__("netlab.core.model.edge_types", fromlist=["EDGE_TYPE_INFO"]).EDGE_TYPE_INFO[k]
        assert isinstance(info, EdgeTypeInfo) and info.kind == k


def test_edge_desc_from_record_maps_and_copies():
    rec = SimpleNamespace(id="e1", source="n1", target="n2", kind="wire", params={"r": 1.0})
    desc = EdgeDesc.from_record(rec)
    assert (desc.id, desc.source, desc.target, desc.edge_type) == ("e1", "n1", "n2", "physical")
    assert desc.params == {"r": 1.0}
    desc.params["r"] = 2.0
    assert rec.params == {"r": 1.0}, "EdgeDesc 不应与原记录共享可变 params"


def test_edge_desc_unknown_kind_fail_closed():
    rec = SimpleNamespace(id="e2", source="a", target="b", kind="wat", params={})
    with pytest.raises(ValueError):
        EdgeDesc.from_record(rec)
