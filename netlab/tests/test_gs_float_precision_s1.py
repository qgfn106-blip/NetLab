"""S1：输入数值语义治理（十进制输入保持精确有理数，避免早期 float 漂移）。

方案依据《NetLab Gs 浮点精度与传递函数算法改进方案》§1.1 / §3.1：
用户十进制输入经二进制 float 再进 SymPy 会丢失原始语义；应为数值建立
「原始输入语义 → 精确有理数」的转换入口（to_exact），使符号传函中不再出现
二进制浮点 sp.Float 原子。
"""

from __future__ import annotations

import sympy as sp

from netlab.core.compute import analysis
from netlab.core.compute.exact_input import to_exact
from netlab.core.compute.simulation import Simulation
from netlab.core.model.scene import Scene

S = sp.Symbol("s")


def _series_scene(gain: float) -> Scene:
    scene = Scene("signal")
    u = scene.add_node(name="u", kind="manual", data={"value": 1.0})
    g = scene.add_node(name="g", kind="gain", params={"gain": gain})
    p = scene.add_node(
        name="p", kind="transfer_function", params={"form": "expr", "expr": "1/(s+1)"}
    )
    scene.add_edge(source=u.id, target=g.id, kind="pass")
    scene.add_edge(source=g.id, target=p.id, kind="pass")
    return scene


def test_to_exact_preserves_decimal_semantics() -> None:
    assert to_exact(0.1) == sp.Rational(1, 10)
    assert to_exact(0.3) == sp.Rational(3, 10)
    assert to_exact(0.1) != sp.Float(0.1)
    assert to_exact(2.0) == sp.Integer(2)
    assert to_exact("0.25") == sp.Rational(1, 4)


def test_gain_decimal_expression_has_no_float_atoms() -> None:
    result = analysis.transfer_function(Simulation(_series_scene(0.1)), "u", "p")
    assert result["ok"] is True, result
    expr = sp.sympify(result["expression"])
    assert expr.atoms(sp.Float) == set(), f"表达式残留二进制浮点：{expr}"
    assert sp.simplify(expr - sp.Rational(1, 10) / (S + 1)) == 0
