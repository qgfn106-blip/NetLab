"""P2-A A2 窄口径增量：惰性实例模型的 roundtrip / snapshot-restore 契约与试点节点证据。

纯测试、不接线、不双写；只为 P2-A 退出条件提供可验证证据：
  · NodeDesc/NodeRuntime 与唯一事实源 NodeRecord 的 roundtrip 一致性；
  · 适配器构造不改变/不别名 NodeRecord（不得双写）；
  · Runtime snapshot/restore 深拷贝语义；
  · 试点 sum + integrate 节点在序列化往返后保持 kind/params/data。
"""

from __future__ import annotations

import copy
import dataclasses

import pytest

from netlab.core.model.instance_model import NodeDesc, NodeRuntime
from netlab.core.model.scene import Scene


def _pilot_scene() -> Scene:
    scene = Scene("signal")
    scene.add_node(name="u", kind="manual", data={"value": 1.0})
    scene.add_node(name="s", kind="sum")
    scene.add_node(name="i", kind="integrate")
    return scene


def _record(scene: Scene, name: str):
    for node in scene.nodes.values():
        if node.name == name:
            return node
    raise AssertionError(name)


@pytest.mark.parametrize("name", ["s", "i"])
def test_pilot_desc_roundtrip_and_frozen(name: str) -> None:
    rec = _record(_pilot_scene(), name)
    desc = NodeDesc.from_record(rec)
    fields = desc.to_fields()
    assert fields["id"] == rec.id and fields["name"] == rec.name and fields["kind"] == rec.kind
    assert fields["params"] == dict(rec.params)
    with pytest.raises(dataclasses.FrozenInstanceError):
        desc.kind = "noop"  # frozen


@pytest.mark.parametrize("name", ["s", "i"])
def test_runtime_roundtrip_independent_of_record(name: str) -> None:
    rec = _record(_pilot_scene(), name)
    rt = NodeRuntime.from_record(rec)
    assert rt.state == copy.deepcopy(dict(rec.state))
    # 适配器不得别名原 record：改 record.state 不应影响 runtime
    rec.state["__probe__"] = 1
    assert "__probe__" not in rt.state


def test_snapshot_restore_deep_copy() -> None:
    rec = _record(_pilot_scene(), "i")
    rt = NodeRuntime.from_record(rec)
    rt.state["acc"] = 7.0
    snap = rt.snapshot()
    assert snap["state"]["acc"] == 7.0
    rt.state["acc"] = 99.0
    rt.restore(snap)
    assert rt.state["acc"] == 7.0
    # restore 深拷贝：改传入快照不应污染 runtime
    snap["state"]["acc"] = -1.0
    rt.state["acc"] = 5.0
    rt.restore(snap)
    assert rt.state["acc"] == -1.0
    assert rt.state is not snap["state"]


def test_adapters_do_not_mutate_scene() -> None:
    scene = _pilot_scene()
    before = copy.deepcopy(scene.to_payload())
    for node in scene.nodes.values():
        NodeDesc.from_record(node)
        NodeRuntime.from_record(node)
    assert scene.to_payload() == before


def test_scene_payload_roundtrip_preserves_pilot_nodes() -> None:
    scene = _pilot_scene()
    payload = scene.to_payload()
    restored = Scene("signal")
    restored.load_payload(payload)
    got = {n.name: n.kind for n in restored.nodes.values()}
    assert got.get("s") == "sum" and got.get("i") == "integrate"


# --- A2 边界：不可篡改 / 异常输入（v1 严格期望，用于 RED 取证） ---


def test_desc_to_fields_deep_copied() -> None:
    desc = NodeDesc.from_record(_record(_pilot_scene(), "s"))
    fields = desc.to_fields()
    fields["params"]["__x__"] = 1
    assert "__x__" not in desc.params, "to_fields 返回体被外部篡改不应回写 desc.params"


def test_runtime_restore_rejects_non_mapping() -> None:
    # 非映射输入被显式拒绝：当前实现对 .get 取属性抛 AttributeError（不静默吞掉）。
    rt = NodeRuntime.from_record(_record(_pilot_scene(), "i"))
    for bad in (None, 42, "x", [1, 2]):  # type: ignore[list-item]
        with pytest.raises((AttributeError, TypeError)):
            rt.restore(bad)  # type: ignore[arg-type]


def test_runtime_restore_missing_keys_falls_back_empty() -> None:
    # 现状契约：snapshot 缺 state/inputs 键时回落为空态（不崩）。「显式拒绝缺失键」
    # 属更强契约，当前生产实现未提供，记入退出条件 gap（见 scratch 证据），不在本纯测试片强改。
    rt = NodeRuntime.from_record(_record(_pilot_scene(), "i"))
    rt.state["acc"] = 9.0
    rt.restore({})
    assert rt.state == {} and rt.inputs == {}
