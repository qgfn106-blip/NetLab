"""Phase E 事务契约：整步失败回滚、重试与干净运行一致、功能块/电路状态隔离。

覆盖 SOLVER_OPTIMIZATION_REPORT §6 遗留的 S-01/S-02/S-03/S-04 与延迟边输出
缓冲问题：任何一步失败都必须回滚到步首，绝不留下「半个网络已推进」。
"""

from __future__ import annotations

import copy

import pytest

from netlab.core.model.blocks import encapsulate_nodes, instantiate_block
from netlab.core.model.graph import Network, Node
from netlab.core.common.limits import ComputeError
from netlab.core.model.scene import Scene


# ---------------------------------------------------------------------------
# 工具
# ---------------------------------------------------------------------------
def node(scene: Scene, name: str, kind: str = "node"):
    return scene.add_node(name=name, kind=kind)


def voltage(scene: Scene, name: str) -> float:
    target = next(item for item in scene.nodes.values() if item.name == name)
    return float(target.data.get("value", target.data.get("voltage", 0.0)))


def _pass(source, target, params, state, dt):
    state["calls"] = int(state.get("calls", 0)) + 1
    return {"voltage": float(source.data.get("voltage", 0.0))}


def _adder(ctx):
    ctx.state["calls"] = int(ctx.state.get("calls", 0)) + 1
    return {"voltage": float(ctx.inputs["e1"]["voltage"]) + 1.0}


def _maybe_fail(ctx):
    value = float(ctx.inputs["e2"]["voltage"])
    if value > 1.4:
        raise ComputeError("阈值过高")
    return {"voltage": value}


def _network() -> Network:
    net = Network()
    src = Node(name="src", data={"voltage": 0.5})
    mid = Node(name="mid", handler=_adder)
    out = Node(name="out", handler=_maybe_fail)
    net.add_node(src)
    net.add_node(mid)
    net.add_node(out)
    net.connect("e1", src, mid, method=_pass)
    net.connect("e2", mid, out, method=_pass)
    return net


# ---------------------------------------------------------------------------
# S-01/S-02/S-03：Network.step 整步事务
# ---------------------------------------------------------------------------
def test_network_step_rolls_back_on_failure():
    net = _network()
    e1 = net.connection("e1")
    e2 = net.connection("e2")
    with pytest.raises(ComputeError):
        net.step(0.1)

    assert net.time == 0.0
    mid = net.node("mid")
    out = net.node("out")
    assert mid.data == {} and mid.state == {}
    assert out.data == {} and out.state == {}
    assert e1.state == {} and e2.state == {}
    assert e1.output == {} and e2.output == {}


def test_retry_after_failure_matches_clean_run():
    net = _network()
    with pytest.raises(ComputeError):
        net.step(0.1)
    net.node("src").set_data({"voltage": 0.1})
    net.step(0.1)

    clean = _network()
    clean.node("src").set_data({"voltage": 0.1})
    clean.step(0.1)

    for name in ("src", "mid", "out"):
        assert net.node(name).data == clean.node(name).data, name
        assert net.node(name).state == clean.node(name).state, name
    assert net.time == clean.time == pytest.approx(0.1)
    for conn in ("e1", "e2"):
        assert net.connection(conn).output == clean.connection(conn).output, conn


# ---------------------------------------------------------------------------
# S-04：用户 handler 的 state 是隔离副本
# ---------------------------------------------------------------------------
def test_untrusted_handler_state_isolated_on_failure():
    net = Network()
    src = Node(name="src", data={"voltage": 1.0})
    worker = Node(name="worker", trusted=False)
    net.add_node(src)
    net.add_node(worker)
    net.connect("in", src, worker, method=_pass)

    seen: dict[str, bool] = {}

    def dirty(ctx):
        seen["shared"] = ctx.state is worker.state
        ctx.state["half"] = 1
        raise ComputeError("失败")

    worker.handler = dirty
    with pytest.raises(ComputeError):
        net.step(0.1)
    assert seen["shared"] is False
    assert worker.state == {}


def test_untrusted_handler_state_written_back_in_place():
    net = Network()
    src = Node(name="src", data={"voltage": 1.0})
    worker = Node(name="worker", trusted=False)
    net.add_node(src)
    net.add_node(worker)
    net.connect("in", src, worker, method=_pass)
    state_id = id(worker.state)

    def spy(ctx):
        ctx.state["done"] = True
        return {"voltage": 1.0}

    worker.handler = spy
    net.step(0.1)
    assert worker.state == {"done": True}
    assert id(worker.state) == state_id  # 原地回写，记录共享身份不变


# ---------------------------------------------------------------------------
# E2：功能块内部状态参与快照
# ---------------------------------------------------------------------------
def _integrator_block():
    scene = Scene("signal")
    a = scene.add_node(name="a", kind="manual", data={"voltage": 1.0})
    b = scene.add_node(name="b", kind="integrate", params={"gain": 1.0, "initial": 0.0})
    c = scene.add_node(name="c", kind="sum")
    scene.add_edge(source=a.id, target=b.id, kind="scale", params={"gain": 1.0})
    scene.add_edge(source=b.id, target=c.id, kind="scale", params={"gain": 1.0})
    return encapsulate_nodes(scene, [b.id], name="intg")


def _block_scene() -> Scene:
    block = _integrator_block()
    scene = Scene("signal")
    scene.blocks.add(copy.deepcopy(block))
    src = scene.add_node(name="src", kind="manual", data={"voltage": 1.0})
    inst = instantiate_block(scene, block.id, position={"x": 0.0, "y": 0.0})
    out = scene.add_node(name="t", kind="sum")
    scene.add_edge(source=src.id, target=inst["input_nodes"]["in_scale-1"], kind="pass")
    scene.add_edge(
        source=inst["output_nodes"]["out_scale-2"],
        target=out.id,
        kind="scale",
        params={"gain": 1.0},
    )
    return scene


def test_signal_checkpoint_restores_block_state():
    scene = _block_scene()
    for _ in range(4):
        scene.step(0.1)
    assert voltage(scene, "t") == pytest.approx(0.4)

    engine = scene.ensure_engine()
    checkpoint = engine.capture_checkpoint()
    for _ in range(3):
        scene.step(0.1)
    assert voltage(scene, "t") == pytest.approx(0.7)

    engine.restore_checkpoint(checkpoint)
    assert voltage(scene, "t") == pytest.approx(0.4)
    for _ in range(2):
        scene.step(0.1)
    # 回滚后重放两步 == 从第 4 步继续跑两步（块内积分器 state 也已回退）。
    assert voltage(scene, "t") == pytest.approx(0.6)


def test_signal_step_rolls_back_block_state_on_failure():
    scene = _block_scene()
    for _ in range(4):
        scene.step(0.1)
    engine = scene.ensure_engine()

    def boom(ctx):
        raise ComputeError("注入失败")

    bad = Node(name="bad", handler=boom)
    engine.network.add_node(bad)
    with pytest.raises(ComputeError):
        scene.step(0.1)
    assert voltage(scene, "t") == pytest.approx(0.4)  # 外层节点已回滚
    engine.network.remove_node(bad)

    scene.step(0.1)
    # 块内积分器若被失败步推进过，这里会变成 0.6。
    assert voltage(scene, "t") == pytest.approx(0.5)

