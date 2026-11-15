"""S2：状态空间节点的 A/B/C/D 浮点矩阵应转为精确有理数，传函不残留 sp.Float。

方案 §3.2：状态空间标准形式 G(s)=C(sI-A)^-1 B + D，矩阵元素若以二进制 float 进
SymPy，会在 (sI-A)^-1 推导中残留浮点。应为矩阵元素建立精确化入口。
"""

from __future__ import annotations

import sympy as sp

from netlab.core.compute import analysis
from netlab.core.compute.simulation import Simulation
from netlab.core.model.scene import Scene

S = sp.Symbol("s")


def _scene() -> Scene:
    scene = Scene("signal")
    u = scene.add_node(name="u", kind="manual", data={"value": 1.0})
    ss = scene.add_node(
        name="ss",
        kind="state_space",
        params={
            "A": [[0.0, 1.0], [-2.0, -3.0]],
            "B": [[0.0], [1.0]],
            "C": [[1.0, 0.0]],
            "D": [[0.0]],
        },
    )
    scene.add_edge(source=u.id, target=ss.id, kind="pass")
    return scene


def test_state_space_matrix_is_exact_no_float() -> None:
    result = analysis.transfer_function(Simulation(_scene()), "u", "ss")
    assert result["ok"] is True, result
    expr = sp.sympify(result["expression"])
    assert expr.atoms(sp.Float) == set(), f"状态空间传函残留浮点：{expr} ({expr.atoms(sp.Float)})"
    assert sp.simplify(expr - 1 / (S**2 + 3 * S + 2)) == 0
