"""批次C：#5 非线性 SCC 外部有状态入边——真实 Network.step 集成 + 数值等价。

在 Network.step 层验证：
1) 每拍外部有状态入边只求值一次（状态按步推进，不被 Newton probe 重复推进）；
2) 输出与独立标量参考解数值等价（y 满足 y = tanh(y) + u，u=本拍应达的求值次数）。
"""

from __future__ import annotations

import math

from netlab.core.model.scene import Scene


def _build():
    scene = Scene("signal")
    scene.set_algebraic_solver(True)
    source = scene.add_node(name="u", kind="manual", data={"value": 0.5})
    loop = scene.add_node(
        name="y",
        kind="expression",
        params={"expr": "tanh(y) + u", "variables": {"y": "fb", "u": "in"}, "output": "value"},
    )
    in_edge = scene.add_edge(name="in", source=source.id, target=loop.id, kind="pass")
    scene.add_edge(name="fb", source=loop.id, target=loop.id, kind="pass")
    return scene, in_edge


def _reference(n: float) -> float:
    lo, hi = -10.0, 10.0
    f = lambda z: z - math.tanh(z) - n
    for _ in range(200):
        mid = (lo + hi) / 2.0
        if f(mid) <= 0.0:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


def test_network_step_external_once_and_numeric_equivalence():
    scene, in_edge = _build()
    engine = scene.ensure_engine()
    network = engine.network
    conn = engine.edge_map[in_edge.id]
    orig = conn.evaluate
    state = {"n": 0}

    def counted(dt, time=0.0):
        state["n"] += 1
        payload = dict(orig(dt, time))
        payload["value"] = float(state["n"])  # 有状态：把输入替换为“已求值次数”
        return payload

    conn.evaluate = counted

    for step in range(1, 4):
        network.step(0.1)
        assert state["n"] == step, f"第 {step} 拍外部应只求值一次，累计={state['n']}"
        y = float(network.node("y").data["value"])
        ref = _reference(step)
        assert abs(y - ref) < 1e-6, f"第 {step} 拍 y={y} 与独立参考 {ref} 不等价"
