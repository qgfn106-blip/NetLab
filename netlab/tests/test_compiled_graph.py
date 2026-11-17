"""WP-7：CompiledGraph 缓存与失效契约测试。"""

from __future__ import annotations

import pytest

from netlab.core.common.limits import ComputeError
from netlab.core.model.graph import CompiledGraph, Network, Node


def _pass(source, target, params, state, dt):  # noqa: ANN001
    return dict(source.data)


def _network() -> Network:
    network = Network()
    first = network.add_node(Node(name="a", data={"value": 1.0}))
    second = network.add_node(Node(name="b", data={"value": 0.0}))
    network.connect("a_to_b", first, second, _pass, kind="pass")
    return network


def test_compile_is_cached_and_matches_public_views() -> None:
    network = _network()
    compiled = network.compile()
    assert isinstance(compiled, CompiledGraph)
    assert network.compile() is compiled
    assert compiled.order == tuple(node.name for node in network.topological_order())
    assert compiled.plan == network.solver_plan()
    assert compiled.node_names == ("a", "b")
    assert compiled.revision == network._revision


def test_compile_rebuilds_after_structure_change() -> None:
    network = _network()
    first = network.compile()
    network.add_node(Node(name="c", data={"value": 2.0}))
    second = network.compile()
    assert second is not first
    assert second.revision == first.revision + 1
    assert second.node_names == ("a", "b", "c")

    network.invalidate()
    third = network.compile()
    assert third is not second
    assert third.revision == second.revision + 1


def test_step_reuses_compiled_plan(monkeypatch: pytest.MonkeyPatch) -> None:
    network = _network()
    calls = {"count": 0}
    original = network._build_solver_plan

    def counted():  # noqa: ANN001
        calls["count"] += 1
        return original()

    monkeypatch.setattr(network, "_build_solver_plan", counted)
    network.compile()
    network.step(1.0)
    network.step(1.0)
    assert calls["count"] == 1


def test_compile_keeps_algebraic_loop_in_plan() -> None:
    network = Network()
    first = network.add_node(Node(name="a", data={"value": 1.0}))
    second = network.add_node(Node(name="b", data={"value": 0.0}))
    network.connect("a_to_b", first, second, _pass, kind="pass")
    network.connect("b_to_a", second, first, _pass, kind="pass")
    compiled = network.compile()
    assert compiled.order == ()
    assert compiled.plan.algebraic
