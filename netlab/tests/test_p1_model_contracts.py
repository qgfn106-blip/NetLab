"""P1 Model 描述契约层测试：递归深不可变 / 隔离 / 构造校验 / CompiledModel 无运行态引用。

全部为纯契约层测试（不切执行路径）。断言尽量用「尝试写入即失败」验证递归不可变，
覆盖嵌套 dict/list/tuple/set（D-T1-2 教训：只验顶层 dict 不够）。
"""
from __future__ import annotations

from dataclasses import FrozenInstanceError

import pytest

from netlab.core.model.compiled_model import CompiledModel, compile_from_records
from netlab.core.model.instance_model import (
    EdgeDesc,
    FrozenDict,
    FrozenList,
    NodeDesc,
)
from netlab.core.model.records import EdgeRecord, NodeRecord


def _node() -> NodeRecord:
    return NodeRecord(
        id="n1",
        name="n1",
        kind="gain",
        params={
            "gain": 2.0,
            "nested": {"a": [1, 2, {"b": 3}]},
            "tup": (4, 5),
            "tags": {"x", "y"},
        },
        state={"y": 1.0},
        inputs={"in": {"value": 3.0}},
    )


def _edge() -> EdgeRecord:
    return EdgeRecord(
        id="e1",
        name="e1",
        source="n1",
        target="n2",
        kind="signal",
        params={"gain": 1.0, "deep": {"k": [7, 8]}},
        state={"prev": 9.0},
        source_port="out",
        target_port="in",
        delay=True,
    )


def test_node_desc_recursive_immutable() -> None:
    rec = _node()
    desc = NodeDesc.from_record(rec)
    # 顶层写失败
    with pytest.raises((TypeError, FrozenInstanceError)):
        desc.params["gain"] = 3.0  # type: ignore[index]
    # 嵌套 dict 写失败
    with pytest.raises((TypeError, FrozenInstanceError)):
        desc.params["nested"]["a"][2]["b"] = 99  # type: ignore[index]
    # 嵌套 list 追加失败
    with pytest.raises((TypeError, FrozenInstanceError)):
        desc.params["nested"]["a"].append(9)  # type: ignore[union-attr]
    # setdefault / update 失败
    with pytest.raises((TypeError, FrozenInstanceError)):
        desc.params.setdefault("new", 1)  # type: ignore[union-attr]
    with pytest.raises((TypeError, FrozenInstanceError)):
        desc.params.update({"z": 1})  # type: ignore[union-attr]
    # 冻结类型正确
    assert isinstance(desc.params, FrozenDict)
    assert isinstance(desc.params["nested"]["a"], FrozenList)
    assert isinstance(desc.params["tup"], tuple)
    assert isinstance(desc.params["tags"], frozenset)


def test_node_desc_isolated_from_record() -> None:
    rec = _node()
    desc = NodeDesc.from_record(rec)
    before = desc.to_fields()
    # 修改原始记录（含深层）不应污染描述
    rec.params["gain"] = 999.0
    rec.params["nested"]["a"].append(123)
    rec.params["nested"]["a"][2]["b"] = 777
    assert desc.to_fields() == before
    # 描述的非冻结 id/kind 也不能改（frozen dataclass）
    with pytest.raises((FrozenInstanceError, TypeError)):
        desc.kind = "sum"  # type: ignore[misc]


def test_to_fields_has_no_shared_mutable_refs() -> None:
    desc = NodeDesc.from_record(_node())
    exported = desc.to_fields()
    exported["params"]["nested"]["a"].append(555)
    exported["params"]["gain"] = -1.0
    # 导出物改动不回流描述
    assert desc.to_fields()["params"]["gain"] == 2.0
    assert 555 not in desc.to_fields()["params"]["nested"]["a"]
    # 原生记录与描述无共享容器
    rec = _node()
    d2 = NodeDesc.from_record(rec)
    assert d2.params is not rec.params
    assert d2.params["nested"] is not rec.params["nested"]


def test_edge_desc_immutable_and_no_state() -> None:
    rec = _edge()
    ed = EdgeDesc.from_record(rec)
    assert isinstance(ed.params, FrozenDict)
    with pytest.raises((TypeError, FrozenInstanceError)):
        ed.params["deep"]["k"].append(1)  # type: ignore[index]
    with pytest.raises((FrozenInstanceError, TypeError)):
        ed.delay = False  # type: ignore[misc]
    # EdgeDesc 绝不持运行态 state
    assert not hasattr(ed, "state")
    # 原始 EdgeRecord.state 变化不影响描述
    rec.state["prev"] = 123.0
    assert not hasattr(ed, "state")


def test_compiled_model_static_no_runtime_refs() -> None:
    nodes = [_node(), NodeRecord(id="n2", name="n2", kind="sum", params={})]
    edges = [_edge()]
    cm = compile_from_records("signal", nodes, edges)
    assert isinstance(cm, CompiledModel)
    assert all(isinstance(n, NodeDesc) for n in cm.nodes)
    assert all(isinstance(e, EdgeDesc) for e in cm.edges)
    # 不持有 Scene/Engine/NodeRecord/EdgeRecord 实例
    assert not hasattr(cm, "engine")
    assert not hasattr(cm, "scene")
    assert all(not isinstance(n, NodeRecord) for n in cm.nodes)
    assert all(not isinstance(e, EdgeRecord) for e in cm.edges)
    # 冻结、不可改
    with pytest.raises((FrozenInstanceError, TypeError)):
        cm.mode = "vector"  # type: ignore[misc]
    # 原始记录后续变更不影响编译产物
    before = cm.to_dict()
    nodes[0].params["gain"] = 12345.0
    assert cm.to_dict() == before
    # 映射只读
    with pytest.raises(TypeError):
        cm.node_map()["n1"] = cm.nodes[0]  # type: ignore[index]


def test_compiled_model_fingerprint_stable_and_order() -> None:
    a = [_node(), NodeRecord(id="n2", name="n2", kind="sum", params={})]
    b = list(reversed(a))
    cm1 = compile_from_records("signal", a, [_edge()])
    cm2 = compile_from_records("signal", b, [_edge()])
    # 指纹与节点顺序无关（内部排序）
    assert cm1.fingerprint == cm2.fingerprint
    # 默认 order 按输入节点顺序
    assert cm1.order == ("n1", "n2")
    assert cm2.order == ("n2", "n1")


def test_construction_validation() -> None:
    with pytest.raises(TypeError):
        NodeDesc(id="x", name="x", kind="gain", params=[1, 2])  # type: ignore[arg-type]
    with pytest.raises(TypeError):
        EdgeDesc(id="e", name="e", source="a", target="b", kind="signal", params=5)  # type: ignore[arg-type]
    n = NodeDesc(id="a", name="a", kind="gain", params={})
    with pytest.raises(ValueError):
        CompiledModel(mode="", nodes=(n,), edges=(), order=("a",), fingerprint="f")
    with pytest.raises(ValueError):
        CompiledModel(mode="signal", nodes=(n,), edges=(), order=("x",), fingerprint="f")
    with pytest.raises(ValueError):
        CompiledModel(mode="signal", nodes=(n,), edges=(), order=(), fingerprint="f")
