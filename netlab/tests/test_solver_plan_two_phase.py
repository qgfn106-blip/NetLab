"""批次D（#4）：solver_plan 真两阶段——指向断点的依赖边不参与排序。

断点定义为 stateful 且非 direct_feedthrough：其当前输出只取上一拍状态、不依赖
本拍输入，故断点组件应先算（phase1），其输入侧的直接馈通组件后算（phase2）。
旧实现把「指向断点」的启用边也加入 component_edges，导致断点被排到其输入组件之后。
"""

from __future__ import annotations

from netlab.core.model.graph import Network, Node


def _dummy(source, target, params, state, dt):
    return {}


def _node(name: str, *, stateful: bool, direct: bool) -> Node:
    node = Node(name)
    node.stateful = stateful
    node.direct_feedthrough = direct
    return node


def test_breakpoint_ordered_before_its_input_direct_node():
    net = Network(solve_algebraic=True)
    a = _node("A", stateful=False, direct=True)   # 直接馈通
    b = _node("B", stateful=True, direct=False)   # 断点
    net.add_node(a)
    net.add_node(b)
    net.connect("a2b", a, b, _dummy)              # A -> B（指向断点）
    net.connect("b2a", b, a, _dummy)              # B -> A（反馈；断点在此打断代数环）

    plan = net.solver_plan()
    idx_a = next(i for i, s in enumerate(plan.stages) if "A" in s.nodes)
    idx_b = next(i for i, s in enumerate(plan.stages) if "B" in s.nodes)
    assert "B" in plan.breakpoints
    assert idx_b < idx_a, (
        f"断点 B 必须先于其输入 A 计算（phase1），实际 stages={[s.nodes for s in plan.stages]}"
    )


def test_all_components_ordered_without_silent_fallback():
    net = Network(solve_algebraic=True)
    nodes = [_node(n, stateful=False, direct=True) for n in ("A", "B", "C")]
    for node in nodes:
        net.add_node(node)
    net.connect("ab", nodes[0], nodes[1], _dummy)
    net.connect("bc", nodes[1], nodes[2], _dummy)
    plan = net.solver_plan()
    assert [s.nodes[0] for s in plan.stages] == ["A", "B", "C"]
