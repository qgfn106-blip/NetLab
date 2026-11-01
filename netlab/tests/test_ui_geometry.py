"""S2 seam：几何纯函数（尺寸、引脚、路由、变换）。"""

from __future__ import annotations

import math

from netlab.ui.geometry import (
    DEFAULT_H,
    DEFAULT_W,
    ViewTransform,
    auto_side,
    boundary_point,
    fit_transform,
    node_size,
    pin_points,
    route_points,
    snap,
)


class FakeNode:
    def __init__(self, x: float, y: float, w: float = DEFAULT_W, h: float = DEFAULT_H) -> None:
        self.x = x
        self.y = y
        self.w = w
        self.h = h


def test_node_size_defaults_and_override():
    assert node_size({}) == (DEFAULT_W, DEFAULT_H)
    assert node_size({"size": {"w": 80}}) == (80.0, 80.0)
    assert node_size({"size": {"w": 60, "h": 40}}) == (60.0, 40.0)
    assert node_size({"size": {"w": 0}}) == (12.0, 12.0)


def test_pin_points_for_offset_table():
    points = pin_points("counter4", 100.0, 100.0, 92.0, 92.0)
    assert len(points) == 6
    names = [pin[2]["name"] for pin in points]
    assert "CLK" in names
    # dx=-18 → 左侧
    clk = next(pin for pin in points if pin[2]["name"] == "CLK")
    assert clk[0] == 82.0


def test_pin_points_without_offsets_use_roles():
    points = pin_points("opamp", 0.0, 0.0, 92.0, 92.0)
    by_name = {pin[2]["name"]: pin for pin in points}
    assert by_name["IN+"][0] < 0        # 输入在左
    assert by_name["OUT"][0] > 0        # 输出在右
    assert by_name["V+"][1] > 0         # 电源在下


def test_pin_points_unknown_kind_falls_back_to_default_pair():
    points = pin_points("definitely-not-a-kind", 0.0, 0.0, 92.0, 92.0)
    assert len(points) >= 2
    xs = {round(pin[0], 3) for pin in points}
    assert -46.0 in xs or 46.0 in xs


def test_boundary_and_auto_side():
    assert boundary_point(10, 20, 80, 60, "left") == (-30.0, 20)
    assert boundary_point(10, 20, 80, 60, "bottom") == (10, 50.0)
    assert auto_side(0, 0, 100, 0) == ("right", "left")
    assert auto_side(0, 0, -100, 0) == ("left", "right")
    assert auto_side(0, 0, 0, 100) == ("bottom", "top")


def test_route_straight_is_two_points():
    a = FakeNode(0, 0)
    b = FakeNode(200, 0)
    points = route_points(a, b, route="straight")
    assert points[0] == (46.0, 0.0)
    assert points[-1] == (154.0, 0.0)
    assert len(points) == 2


def test_route_orthogonal_has_bends_and_axis_aligned_segments():
    a = FakeNode(0, 0)
    b = FakeNode(300, 200)
    points = route_points(a, b, route="auto")
    assert len(points) >= 4
    for (x1, y1), (x2, y2) in zip(points, points[1:]):
        assert abs(x1 - x2) < 1e-6 or abs(y1 - y2) < 1e-6


def test_route_respects_waypoints_and_anchors():
    a = FakeNode(0, 0)
    b = FakeNode(300, 0)
    points = route_points(
        a, b, route="orthogonal", waypoints=[(100.0, 50.0)], anchors={"source": "top", "target": "left"}
    )
    assert (100.0, 50.0) in points
    assert points[0] == (0.0, -46.0)
    assert points[-1] == (254.0, 0.0)


def test_route_missing_node_is_empty():
    assert route_points(None, FakeNode(0, 0)) == ()


def test_snap_to_grid():
    assert snap(13, 20) == 20
    assert snap(-13, 20) == -20
    assert snap(10, 0) == 10


def test_view_transform_roundtrip_and_zoom_anchor():
    view = ViewTransform(1.5, 40.0, -10.0)
    sx, sy = view.to_screen(12.0, 34.0)
    assert math.isclose(view.to_world(sx, sy)[0], 12.0)
    assert math.isclose(view.to_world(sx, sy)[1], 34.0)

    before = view.to_world(100.0, 100.0)
    view.zoom_at(100.0, 100.0, 1.4)
    after = view.to_world(100.0, 100.0)
    assert math.isclose(before[0], after[0])
    assert math.isclose(before[1], after[1])


def test_zoom_clamped():
    view = ViewTransform(1.0)
    for _ in range(50):
        view.zoom_at(0, 0, 1.5)
    assert view.k <= 4.0 + 1e-9
    for _ in range(50):
        view.zoom_at(0, 0, 0.5)
    assert view.k >= 0.25 - 1e-9


def test_fit_transform_centers_bounds():
    view = fit_transform((0, 0, 400, 200), 800, 600)
    cx, cy = view.to_screen(200, 100)
    assert math.isclose(cx, 400, abs_tol=1.0)
    assert math.isclose(cy, 300, abs_tol=1.0)
