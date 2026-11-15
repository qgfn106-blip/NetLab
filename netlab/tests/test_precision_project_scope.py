"""Task5 后端部分：数值精度模式的全局开关语义（工程级应用由前端在加载工程时调用）。

覆盖：exact→符号/传函链用精确有理数（无 sp.Float）；standard→回退 float64（出现 sp.Float）；
非法模式被拒绝且不改变当前模式。
"""

from __future__ import annotations

import pytest
import sympy as sp

from netlab.core.compute import analysis
from netlab.core.compute.simulation import Simulation
from netlab.core.model.scene import Scene


def _scene(gain: float) -> Scene:
    scene = Scene("signal")
    u = scene.add_node(name="u", kind="manual", data={"value": 1.0})
    g = scene.add_node(name="g", kind="gain", params={"gain": gain})
    p = scene.add_node(name="p", kind="transfer_function", params={"form": "expr", "expr": "1/(s+1)"})
    scene.add_edge(source=u.id, target=g.id, kind="pass")
    scene.add_edge(source=g.id, target=p.id, kind="pass")
    return scene


def test_mode_switch_exact_and_standard() -> None:
    prev = analysis.numeric_precision_mode()
    try:
        analysis.set_numeric_precision_mode("exact")
        exact = sp.sympify(analysis.transfer_function(Simulation(_scene(0.1)), "u", "p")["expression"])
        assert exact.atoms(sp.Float) == set()

        analysis.set_numeric_precision_mode("standard")
        standard = sp.sympify(analysis.transfer_function(Simulation(_scene(0.1)), "u", "p")["expression"])
        assert standard.atoms(sp.Float) != set()
    finally:
        analysis.set_numeric_precision_mode(prev if prev in ("exact", "standard") else "exact")


def test_invalid_mode_rejected() -> None:
    prev = analysis.numeric_precision_mode()
    with pytest.raises(ValueError):
        analysis.set_numeric_precision_mode("double")
    assert analysis.numeric_precision_mode() == prev
