"""B-int-1：connect_diagnostics.diagnose_connection 只读软诊断（不改 add_edge 热路径）。"""
from __future__ import annotations

from netlab.core.model.records import NodeRecord
from netlab.core.model.scene import Scene


def _scene_with(port_types_src=None, port_types_dst=None):
    scene = Scene("signal")
    src = NodeRecord(id="src", name="src", kind="gain")
    dst = NodeRecord(id="dst", name="dst", kind="gain")
    if port_types_src is not None:
        src.port_types = dict(port_types_src)
    if port_types_dst is not None:
        dst.port_types = dict(port_types_dst)
    scene.nodes["src"] = src
    scene.nodes["dst"] = dst
    return scene


def test_no_port_metadata_returns_empty():
    from netlab.core.model.connect_diagnostics import diagnose_connection

    scene = _scene_with()
    assert diagnose_connection(scene, "src", "dst", "signal") == []


def test_compatible_scalar_to_complex_returns_empty():
    from netlab.core.model.connect_diagnostics import diagnose_connection

    scene = _scene_with({"output": "scalar"}, {"input": "complex"})
    assert diagnose_connection(scene, "src", "dst", "signal") == []


def test_incompatible_vector2_to_scalar_warns_without_raising():
    from netlab.core.model.connect_diagnostics import diagnose_connection

    scene = _scene_with({"output": "vector2"}, {"input": "scalar"})
    diags = diagnose_connection(scene, "src", "dst", "signal")
    assert isinstance(diags, list) and len(diags) == 1
    d = diags[0]
    assert d["severity"] == "warning" and d["code"] == "incompatible"
    assert d["source"] == "src" and d["target"] == "dst"


def test_missing_node_warns_readonly():
    from netlab.core.model.connect_diagnostics import diagnose_connection

    scene = _scene_with({"output": "scalar"}, {"input": "scalar"})
    diags = diagnose_connection(scene, "src", "nope", "signal")
    assert len(diags) == 1 and diags[0]["code"] == "target_missing"
