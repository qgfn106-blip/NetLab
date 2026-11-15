# 职责边界：A1 = 接缝契约（NodeDesc/NodeRuntime 形状/冻结/隔离基础）
"""P2-A A1：NodeDesc / NodeRuntime 惰性并行接缝（纯新增，不改数值路径）。

验收要点（审批 m05956 条件）：NodeDesc 不含运行态；NodeRuntime 持 state/inputs
且 snapshot/restore 深拷贝；适配器不改动源 NodeRecord（单一事实源仍为 NodeRecord）；
构造适配器不改变既有引擎单步输出。
"""

from __future__ import annotations

import copy
import dataclasses

import pytest

from netlab.core.compute.simulation import Simulation
from netlab.core.model.scene import Scene
from netlab.core.model.records import NodeRecord


def _rec(name="n", kind="sum", state=None, inputs=None, params=None):
    return NodeRecord(
        id=f"id-{name}",
        name=name,
        kind=kind,
        params=params or {"k": 1},
        data={},
        state=state or {"v": 0.0},
        inputs=inputs or {"in": {"v": 1.0}},
    )


def test_desc_has_no_runtime_fields_and_is_frozen():
    from netlab.core.model.instance_model import NodeDesc

    rec = _rec()
    desc = NodeDesc.from_record(rec)
    assert desc.id == rec.id and desc.name == rec.name and desc.kind == rec.kind
    assert not hasattr(desc, "state") and not hasattr(desc, "inputs")
    with pytest.raises(dataclasses.FrozenInstanceError):
        desc.kind = "x"  # type: ignore[misc]


def test_desc_roundtrip_matches_record_fields():
    from netlab.core.model.instance_model import NodeDesc

    rec = _rec()
    fields = NodeDesc.from_record(rec).to_fields()
    assert fields == {"id": rec.id, "name": rec.name, "kind": rec.kind, "params": rec.params}


def test_adapter_does_not_mutate_record():
    from netlab.core.model.instance_model import NodeDesc, NodeRuntime

    rec = _rec(state={"v": 3.0}, inputs={"in": {"v": 2.0}})
    before = rec.snapshot()
    NodeDesc.from_record(rec)
    rt = NodeRuntime.from_record(rec)
    rt.state["v"] = 999.0  # 改 runtime 不得回写 record
    assert rec.snapshot() == before


def test_runtime_snapshot_restore_deep_copy():
    from netlab.core.model.instance_model import NodeRuntime

    rt = NodeRuntime.from_record(_rec(state={"v": 1.0}, inputs={"in": {"v": 5.0}}))
    snap = rt.snapshot()
    rt.state["v"] = 42.0
    rt.restore(snap)
    assert rt.state == {"v": 1.0}
    assert rt.inputs == {"in": {"v": 5.0}}
    # snapshot 是深拷贝
    snap["state"]["v"] = 7.0
    assert rt.state == {"v": 1.0}


def _scene() -> Scene:
    sc = Scene("signal")
    u = sc.add_node(name="u", kind="manual", data={"value": 1.0})
    g = sc.add_node(name="g", kind="gain", params={"gain": 2.0})
    s = sc.add_node(name="s", kind="sum")
    sc.add_edge(source=u.id, target=g.id, kind="pass")
    sc.add_edge(source=g.id, target=s.id, kind="pass")
    return sc


def _step_once(with_adapters: bool):
    sc = _scene()
    if with_adapters:
        from netlab.core.model.instance_model import NodeDesc, NodeRuntime

        for rec in sc.nodes.values():
            NodeDesc.from_record(rec)
            NodeRuntime.from_record(rec)
    return sc.step(0.01)


def test_adapter_construction_does_not_change_step_output():
    def _stable(out):
        # 忽略墙钟耗时字段，只比较确定性数值输出
        return {k: v for k, v in out.items() if k != "step_ms"}

    assert _stable(_step_once(False)) == _stable(_step_once(True))
