"""R36/P1：执行图标签、SCC 检测与自动延迟可见记录的回归测试。"""

from __future__ import annotations

from netlab.core.compute.computes import solver_traits
from netlab.core.model.graph import Network, Node
from netlab.core.model.scene import Scene


def _dummy_method(source, target, params, state, dt):
    return {}


def test_solver_traits_for_stateful_and_direct_nodes():
    tf = solver_traits(
        "transfer_function",
        {
            "form": "coeff",
            "numerator": [1.0],
            "denominator": [1.0, 1.0],
            "field": "value",
            "output": "value",
            "method": "zoh",
        },
    )
    assert tf["stateful"] is True
    assert tf["direct_feedthrough"] is False

    signal = solver_traits("signal", {})
    assert signal["stateful"] is True
    assert signal["direct_feedthrough"] is False

    gain = solver_traits("gain", {"gain": 2.0})
    assert gain["linear"] is True
    assert gain["direct_feedthrough"] is True


def test_solver_plan_detects_direct_feedthrough_cycle():
    network = Network()
    a = Node("a", kind="gain")
    b = Node("b", kind="gain")
    network.add_node(a)
    network.add_node(b)
    network.connect("ab", a, b, _dummy_method)
    network.connect("ba", b, a, _dummy_method)

    plan = network.solver_plan()

    assert len(plan.algebraic) == 1
    assert set(plan.algebraic[0]) == {"a", "b"}
    stage = next(stage for stage in plan.stages if "a" in stage.nodes)
    assert stage.algebraic is True
    assert stage.linear is True


def test_solver_plan_breaks_cycle_at_stateful_transfer():
    network = Network()
    a = Node("a", kind="gain")
    tf = Node("tf", kind="transfer_function", stateful=True, direct_feedthrough=False)
    b = Node("b", kind="gain")
    for node in (a, tf, b):
        network.add_node(node)
    network.connect("a_tf", a, tf, _dummy_method)
    network.connect("tf_b", tf, b, _dummy_method)
    network.connect("b_a", b, a, _dummy_method)

    plan = network.solver_plan()

    assert plan.breakpoints == ("tf",)
    assert plan.algebraic == ()


def test_scene_records_auto_delay_edges():
    scene = Scene("signal")
    a = scene.add_node(name="a", kind="gain", params={"gain": 1.0})
    b = scene.add_node(name="b", kind="gain", params={"gain": 1.0})
    scene.add_edge(source=a.id, target=b.id, kind="pass")
    edge = scene.add_edge(source=b.id, target=a.id, kind="pass", auto_delay=True)

    assert edge.delay is True
    assert edge.auto_delay is True
    engine = scene.ensure_engine()
    assert [
        connection.name for connection in engine.network.auto_delayed_connections()
    ] == [edge.name]
