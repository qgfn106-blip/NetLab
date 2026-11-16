"""C-int-1：edge_diagnostics.diagnose_edge_types 只读诊断（标三型+participates+矛盾告警，不改求解）。"""
from __future__ import annotations

from netlab.core.model.records import EdgeRecord
from netlab.core.model.scene import Scene


def _scene(edges):
    scene = Scene("signal")
    for e in edges:
        scene.edges[e.id] = e
    return scene


def _edge(id, kind, source_port="", target_port="", delay=False):
    return EdgeRecord(
        id=id, name=id, source="a", target="b", kind=kind,
        source_port=source_port, target_port=target_port, delay=delay,
    )


def test_legacy_wire_is_physical_participates():
    from netlab.core.model.edge_diagnostics import diagnose_edge_types

    out = diagnose_edge_types(_scene([_edge("e1", "wire")]))
    assert len(out) == 1
    d = out[0]
    assert d["edge_type"] == "physical" and d["participates"] is True
    assert not d.get("warnings")


def test_signal_is_dependency_participates():
    from netlab.core.model.edge_diagnostics import diagnose_edge_types

    d = diagnose_edge_types(_scene([_edge("e2", "signal")]))[0]
    assert d["edge_type"] == "dependency" and d["participates"] is True


def test_layout_no_binding_no_warning():
    from netlab.core.model.edge_diagnostics import diagnose_edge_types

    d = diagnose_edge_types(_scene([_edge("e3", "layout")]))[0]
    assert d["edge_type"] == "layout" and d["participates"] is False
    assert not d.get("warnings")


def test_layout_with_solve_binding_warns():
    from netlab.core.model.edge_diagnostics import diagnose_edge_types

    d = diagnose_edge_types(_scene([_edge("e4", "layout", source_port="out")]))[0]
    assert d["edge_type"] == "layout" and d["participates"] is False
    codes = [w["code"] for w in d.get("warnings", [])]
    assert "layout_has_solve_binding" in codes


def test_unknown_kind_warns_without_raising():
    from netlab.core.model.edge_diagnostics import diagnose_edge_types

    d = diagnose_edge_types(_scene([_edge("e5", "mystery")]))[0]
    assert d["edge_type"] is None and d["participates"] is None
    assert any(w["code"] == "unknown" for w in d.get("warnings", []))
