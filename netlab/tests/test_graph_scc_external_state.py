"""批次3（v2 #5）：非线性 SCC 求解时，SCC 外部（非延迟）入边每拍只求值一次并冻结复用给所有 Newton probe。

缺陷：``_solve_nonlinear_stage`` 旧实现在每次 residual / 雅可比探针里重新
``connection.evaluate`` 外部入边；对有状态连接（evaluate 会写 state）会一步内被
推进多次、状态被污染。修复：求解前预取一次外部非延迟入边并冻结复用。
"""

from __future__ import annotations

import math

from netlab.core.model.scene import Scene


def _scene_with_nonlinear_scc():
    scene = Scene("signal")
    scene.set_algebraic_solver(True)
    source = scene.add_node(name="u", kind="manual", data={"value": 0.5})
    loop = scene.add_node(
        name="y",
        kind="expression",
        params={
            "expr": "tanh(y) + u",
            "variables": {"y": "fb", "u": "in"},
            "output": "value",
        },
    )
    in_edge = scene.add_edge(name="in", source=source.id, target=loop.id, kind="pass")
    scene.add_edge(name="fb", source=loop.id, target=loop.id, kind="pass")
    return scene, in_edge


def test_external_input_evaluated_once_per_step():
    scene, in_edge = _scene_with_nonlinear_scc()
    engine = scene.ensure_engine()
    conn = engine.edge_map[in_edge.id]
    count = {"n": 0}
    orig = conn.evaluate

    def counted(dt, time=0.0):
        count["n"] += 1
        return orig(dt, time)

    conn.evaluate = counted

    scene.step(0.1)
    assert count["n"] == 1, f"每拍外部入边应只求值一次，实际 {count['n']}"
    # 收敛到不动点 y = tanh(y) + 0.5
    y = float(engine.network.node("y").data["value"])
    assert abs(y - (math.tanh(y) + 0.5)) < 1e-6

    scene.step(0.1)
    assert count["n"] == 2, f"两拍应共求值 2 次，实际 {count['n']}"
