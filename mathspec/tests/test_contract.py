import pytest

from mathspec.contract import (
    CORE_SCHEMA,
    ContractError,
    EngineRegistry,
    ExtNamespace,
    KindRegistry,
    assert_core_schema_unchanged,
    schema_of,
)
from mathspec.graph import Edge, Node


def test_core_schema_unchanged():
    assert_core_schema_unchanged()
    assert schema_of(Node) == CORE_SCHEMA["Node"]
    assert schema_of(Edge) == CORE_SCHEMA["Edge"]


def test_ext_namespace_isolation():
    n = Node(id="n", kind="gain")
    a = ExtNamespace(n, "pluginA")
    b = ExtNamespace(n, "pluginB")
    a.set({"k": 1})
    b.set({"k": 2})
    assert a.get() == {"k": 1}
    assert b.get() == {"k": 2}
    assert set(n.ext) == {"pluginA", "pluginB"}


def test_ext_rejects_non_json():
    n = Node(id="n", kind="gain")
    a = ExtNamespace(n, "pluginA")
    with pytest.raises(ContractError):
        a.set(object())


def test_engine_registry_rejects_core():
    reg = EngineRegistry()
    for core in ("signal", "circuit", "vector"):
        with pytest.raises(ContractError):
            reg.register(core, factory=object())
    reg.register("hybrid", factory=object())
    assert "hybrid" in reg.available()


def test_kind_registry_requires_prefix():
    reg = KindRegistry()
    with pytest.raises(ContractError):
        reg.register("gain")  # 无 user. 前缀
    reg.register("user.foo")
    with pytest.raises(ContractError):
        reg.register("user.foo")  # 重复
    assert reg.has("user.foo")
