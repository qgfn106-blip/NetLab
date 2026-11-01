"""功能块（模块化功能节点）回归测试。

覆盖：端口直通、扁平网络与功能块数值等价、实例状态隔离、保存/加载往返、
递归拒绝、非法端口映射拒绝、reset 行为与嵌套封装前置校验。
"""

from __future__ import annotations

import copy
import json

import pytest

from netlab.blocks import (
    BlockDef,
    BlockStore,
    encapsulate_nodes,
    instantiate_block,
)
from netlab.limits import ComputeError, ValidationError
from netlab.methods import METHOD_SPECS, prepare_method
from netlab.scene import Scene


def node_by_name(scene: Scene, name: str):
    return next(item for item in scene.nodes.values() if item.name == name)


def build_flat(gain_a: float = 2.0, gain_b: float = 3.0, source: float = 1.0) -> Scene:
    scene = Scene("signal")
    a = scene.add_node(name="a", kind="manual", data={"voltage": source})
    b = scene.add_node(name="b", kind="sum")
    c = scene.add_node(name="c", kind="sum")
    scene.add_edge(source=a.id, target=b.id, kind="scale", params={"gain": gain_a})
    scene.add_edge(source=b.id, target=c.id, kind="scale", params={"gain": gain_b})
    return scene


# ---------------------------------------------------------------------------
# 直通连接
# ---------------------------------------------------------------------------
def test_pass_method_copies_numeric_fields_only():
    assert "pass" in METHOD_SPECS
    _spec, _params, method = prepare_method("pass", {"max_fields": 2})

    class _Node:
        name = "src"
        data = {"voltage": 1.5, "flag": True, "label": "x", "current": 2.0, "power": 3.0}

    result = method(_Node(), None, {}, {}, 0.01)
    assert result == {"voltage": 1.5, "current": 2.0}


# ---------------------------------------------------------------------------
# 封装与扁平网络等价
# ---------------------------------------------------------------------------
def test_encapsulation_matches_flat_network():
    flat = build_flat()
    flat.step(0.01)
    expected = node_by_name(flat, "c").data["voltage"]
    assert expected == pytest.approx(6.0)

    scene = build_flat()
    block = encapsulate_nodes(scene, [node_by_name(scene, "b").id], name="twice")
    assert {port.direction for port in block.ports} == {"input", "output"}
    assert len(block.nodes) == 3  # b + 两个接口节点
    scene.step(0.01)
    assert node_by_name(scene, "c").data["voltage"] == pytest.approx(expected)
    assert scene.stats().get("blocks") == 1

    # 端口节点与块节点都在父场景里，且端口节点不带 state。
    kinds = sorted(item.kind for item in scene.nodes.values())
    assert kinds == ["block", "manual", "module_input", "module_output", "sum"]


# ---------------------------------------------------------------------------
# 实例状态隔离
# ---------------------------------------------------------------------------
def build_integrator_block() -> BlockDef:
    scene = Scene("signal")
    a = scene.add_node(name="a", kind="manual", data={"voltage": 1.0})
    b = scene.add_node(name="b", kind="integrate", params={"gain": 1.0, "initial": 0.0})
    c = scene.add_node(name="c", kind="sum")
    scene.add_edge(source=a.id, target=b.id, kind="scale", params={"gain": 1.0})
    scene.add_edge(source=b.id, target=c.id, kind="scale", params={"gain": 1.0})
    return encapsulate_nodes(scene, [b.id], name="intg")


def build_two_instances(block: BlockDef) -> Scene:
    scene = Scene("signal")
    scene.blocks.add(copy.deepcopy(block))
    src1 = scene.add_node(name="src1", kind="manual", data={"voltage": 1.0})
    src2 = scene.add_node(name="src2", kind="manual", data={"voltage": 2.0})
    first = instantiate_block(scene, block.id, position={"x": 0.0, "y": 0.0})
    second = instantiate_block(scene, block.id, position={"x": 0.0, "y": 200.0})
    t1 = scene.add_node(name="t1", kind="sum")
    t2 = scene.add_node(name="t2", kind="sum")
    scene.add_edge(source=src1.id, target=first["input_nodes"]["in_scale-1"], kind="pass")
    scene.add_edge(
        source=first["output_nodes"]["out_scale-2"],
        target=t1.id,
        kind="scale",
        params={"gain": 1.0},
    )
    scene.add_edge(source=src2.id, target=second["input_nodes"]["in_scale-1"], kind="pass")
    scene.add_edge(
        source=second["output_nodes"]["out_scale-2"],
        target=t2.id,
        kind="scale",
        params={"gain": 1.0},
    )
    return scene


def test_two_instances_keep_state_isolated():
    block = build_integrator_block()
    scene = build_two_instances(block)
    for _ in range(5):
        scene.step(0.1)
    assert node_by_name(scene, "t1").data["voltage"] == pytest.approx(0.5)
    assert node_by_name(scene, "t2").data["voltage"] == pytest.approx(1.0)

    # 改一个实例的输入不应影响另一个实例的内部 state。
    src1 = node_by_name(scene, "src1")
    scene.update_node(src1.id, {"data": {"voltage": 5.0}})
    for _ in range(2):
        scene.step(0.1)
    assert node_by_name(scene, "t1").data["voltage"] == pytest.approx(1.5)
    assert node_by_name(scene, "t2").data["voltage"] == pytest.approx(1.4)


def test_scene_reset_clears_block_state():
    block = build_integrator_block()
    scene = build_two_instances(block)
    for _ in range(4):
        scene.step(0.1)
    assert node_by_name(scene, "t1").data["voltage"] == pytest.approx(0.4)
    scene.reset()
    for _ in range(2):
        scene.step(0.1)
    assert node_by_name(scene, "t1").data["voltage"] == pytest.approx(0.2)


# ---------------------------------------------------------------------------
# 保存 / 加载
# ---------------------------------------------------------------------------
def test_block_scene_payload_roundtrip():
    scene = build_two_instances(build_integrator_block())
    for _ in range(3):
        scene.step(0.1)
    payload = scene.to_payload(include_state=False)
    assert len(payload["blocks"]) == 1
    assert all("state" not in item for item in payload["nodes"])

    restored = Scene("signal")
    restored.load_payload(json.loads(json.dumps(payload)))
    restored.ensure_engine()
    for _ in range(2):
        restored.step(0.1)
    # 状态不随工程保存：恢复后重新累计 2 步。
    assert node_by_name(restored, "t1").data["voltage"] == pytest.approx(0.2)
    assert node_by_name(restored, "t2").data["voltage"] == pytest.approx(0.4)
    assert restored.stats().get("blocks") == 2


def test_block_definition_survives_scene_copy():
    scene = build_two_instances(build_integrator_block())
    payload = scene.to_payload(include_state=False)
    restored = Scene("signal")
    restored.load_payload(payload)
    assert restored.blocks.require(payload["blocks"][0]["id"]).name == "intg"


# ---------------------------------------------------------------------------
# 非法结构
# ---------------------------------------------------------------------------
def test_self_reference_is_rejected():
    store = BlockStore()
    block = BlockDef(
        id="aaaaaaaaaaaa",
        name="A",
        mode="signal",
        description="",
        nodes=[
            {
                "id": "bbbbbbbbbbbb",
                "name": "inner",
                "kind": "block",
                "params": {"block_id": "aaaaaaaaaaaa"},
                "data": {},
                "position": {"x": 0.0, "y": 0.0},
            }
        ],
        edges=[],
        ports=[],
    )
    with pytest.raises(ValidationError):
        store.add(block)


def test_nested_cycle_is_rejected():
    store = BlockStore()
    store.add(
        BlockDef(
            id="aaaaaaaaaaaa",
            name="A",
            mode="signal",
            description="",
            nodes=[
                {
                    "id": "bbbbbbbbbbbb",
                    "name": "inner",
                    "kind": "block",
                    "params": {"block_id": "cccccccccccc"},
                    "data": {},
                    "position": {"x": 0.0, "y": 0.0},
                }
            ],
            edges=[],
            ports=[],
        )
    )
    store.add(
        BlockDef(
            id="cccccccccccc",
            name="B",
            mode="signal",
            description="",
            nodes=[
                {
                    "id": "dddddddddddd",
                    "name": "inner",
                    "kind": "block",
                    "params": {"block_id": "aaaaaaaaaaaa"},
                    "data": {},
                    "position": {"x": 0.0, "y": 0.0},
                }
            ],
            edges=[],
            ports=[],
        )
    )
    with pytest.raises(ValidationError, match="循环引用"):
        store.check_cycles()


def test_invalid_port_mapping_is_rejected():
    scene = build_flat()
    block = encapsulate_nodes(scene, [node_by_name(scene, "b").id], name="twice")
    block_node = next(item for item in scene.nodes.values() if item.kind == "block")
    bad_params = copy.deepcopy(block_node.params)
    bad_params["input_nodes"] = {next(iter(bad_params["input_nodes"])): "ffffffffffff"}
    scene.update_node(block_node.id, {"params": bad_params})
    with pytest.raises(ComputeError, match="输入端口"):
        scene.ensure_engine()
    assert block.id in scene.blocks.defs


def test_missing_block_definition_is_rejected_without_partial_scene():
    assert isinstance(build_integrator_block(), BlockDef)
    payload = {
        "mode": "signal",
        "nodes": [
            {
                "id": "eeeeeeeeeeee",
                "name": "blk",
                "kind": "block",
                "params": {"block_id": "ffffffffffff", "block_name": "ghost"},
                "data": {},
                "position": {"x": 0.0, "y": 0.0},
            }
        ],
        "edges": [],
        "blocks": [],
    }
    empty = Scene("signal")
    with pytest.raises(ValidationError, match="功能块不存在"):
        empty.load_payload(payload)
    assert empty.nodes == {}


def test_block_node_without_block_id_is_rejected_with_fix_hint():
    """P0-0：手动加的块节点没有 block_id，加载时必须给可操作提示而不是崩。"""
    payload = {
        "mode": "signal",
        "nodes": [
            {
                "id": "bbbbbbbbbbb1",
                "name": "block1",
                "kind": "block",
                "params": {},
                "data": {},
                "position": {"x": 0.0, "y": 0.0},
            }
        ],
        "edges": [],
    }
    scene = Scene("signal")
    with pytest.raises(ValidationError, match="缺少 block_id") as excinfo:
        scene.load_payload(payload)
    assert "重新实例化" in str(excinfo.value)
    assert scene.nodes == {}

    with pytest.raises(ValidationError, match="重新实例化"):
        scene.add_node(name="block2", kind="block")


def test_encapsulating_block_node_requires_port_nodes():
    scene = build_two_instances(build_integrator_block())
    block_node = next(item for item in scene.nodes.values() if item.kind == "block")
    with pytest.raises(ValidationError, match="端口节点"):
        encapsulate_nodes(scene, [block_node.id], name="outer")

def test_unwired_block_instance_uses_port_defaults():
    """实例刚拖入画布、端口还没接线时，步进不能因为缺少输入字段而失败。"""
    scene = build_flat()
    block = encapsulate_nodes(scene, [node_by_name(scene, "b").id], name="twice")
    fresh = Scene("signal")
    fresh.blocks.add(copy.deepcopy(block))
    instantiate_block(fresh, block.id, position={"x": 0.0, "y": 0.0})
    fresh.step(0.01)  # 不应抛 ComputeError
    assert fresh.stats().get("blocks") == 1
