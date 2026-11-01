"""S2 seam：视图模型是纯函数，不依赖 Qt，可直接单测。"""

from __future__ import annotations

from netlab.scene import Scene
from netlab.ui.models import (
    build_live_vm,
    build_scene_vm,
    build_tree_vm,
    pin_index,
    series_extent,
    visible_series,
)


def make_scene() -> Scene:
    scene = Scene("signal")
    a = scene.add_node(name="src", kind="manual", data={"voltage": 1.0}, position={"x": 0.0, "y": 0.0})
    b = scene.add_node(name="sink", kind="sum", position={"x": 240.0, "y": 0.0}, size={"w": 80})
    scene.add_edge(source=a.id, target=b.id, kind="scale", params={"gain": 2.0})
    return scene


def test_scene_projection_keeps_geometry_and_ids():
    scene = make_scene()
    vm = build_scene_vm(scene.to_payload())
    assert vm.mode == "signal"
    assert [node.name for node in vm.nodes] == ["src", "sink"]
    assert vm.nodes[1].w == 80.0
    assert len(vm.edges) == 1
    edge = vm.edges[0]
    assert edge.source == vm.nodes[0].id
    assert edge.target == vm.nodes[1].id
    assert len(edge.points) >= 2
    assert edge.length > 0


def test_node_hit_uses_circle_then_rect():
    scene = make_scene()
    vm = build_scene_vm(scene.to_payload())
    circle = vm.nodes[0]
    assert circle.contains(circle.x, circle.y)
    assert not circle.contains(circle.x + circle.w, circle.y)
    from netlab.ui.models import NodeVM

    rect = NodeVM(id="r", name="r", kind="sum", x=0.0, y=0.0, w=80.0, h=60.0)
    assert rect.contains(39.0, 29.0)
    assert not rect.contains(41.0, 0.0)


def test_edge_hit_and_miss():
    scene = make_scene()
    vm = build_scene_vm(scene.to_payload())
    edge = vm.edges[0]
    mid = edge.points[len(edge.points) // 2]
    assert edge.hit(*mid, tolerance=3.0)
    assert not edge.hit(mid[0], mid[1] + 500.0, tolerance=3.0)


def test_bounds_expand_by_radius():
    scene = make_scene()
    vm = build_scene_vm(scene.to_payload())
    x0, y0, x1, y1 = vm.bounds()
    assert x0 < 0 and x1 > 240
    assert y0 <= -46 and y1 >= 46


def test_pin_index_and_empty_scene():
    scene = make_scene()
    vm = build_scene_vm(scene.to_payload())
    pins = pin_index(vm.nodes[0])
    assert pins
    empty = build_scene_vm(None)
    assert empty.nodes == () and empty.bounds() == (0.0, 0.0, 0.0, 0.0)


def test_tree_projection_marks_current_network():
    vm = build_scene_vm(make_scene().to_payload())
    tree = build_tree_vm(
        [{"id": "n1", "name": "网络 1", "current": True}, {"id": "n2", "name": "网络 2"}],
        vm,
    )
    assert len(tree.networks) == 2
    assert tree.networks[0].current is True
    assert tree.nodes is vm.nodes


def test_live_projection_and_series_helpers():
    payload = {
        "frames": [
            {"seq": 1, "a": 1.0, "b": 2.0},
            {"seq": 2, "a": 3.0, "b": 4.0},
        ],
        "cursor": 2,
        "keys": ["a", "b"],
        "sim": {"running": True, "actual_fps": 30.0},
    }
    live = build_live_vm(payload)
    assert live.cursor == 2
    assert live.running is True
    assert visible_series(live, "a") == [1.0, 3.0]
    assert series_extent([1.0, 3.0]) == (1.0, 3.0)
    assert series_extent([2.0, 2.0]) == (1.0, 3.0)
    assert series_extent([]) == (0.0, 1.0)


def test_live_projection_ignores_non_numeric_fields():
    live = build_live_vm({"frames": [{"seq": 3, "x": 1.5, "note": "hi"}], "cursor": 3})
    assert live.frames[0].values == {"x": 1.5}
