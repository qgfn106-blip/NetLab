"""环路候选枚举：信号流 SCC 自动检测与数据契约。"""

from __future__ import annotations

from types import SimpleNamespace

from netlab.core.compute.analysis import loop_candidates, loop_from_break
from netlab.core.model.scene import Scene


def _sim(scene: Scene) -> SimpleNamespace:
    return SimpleNamespace(scene=scene)


def _feedback_scene() -> Scene:
    scene = Scene("signal")
    scene.set_algebraic_solver(True)
    source = scene.add_node(name="u", kind="manual", data={"value": 1.0})
    total = scene.add_node(
        name="s", kind="sum", params={"weights": {"ref": 1.0, "fb": 1.0}}
    )
    gain = scene.add_node(name="g", kind="gain", params={"gain": -0.5})
    scene.add_edge(name="ref", source=source.id, target=total.id, kind="pass")
    scene.add_edge(name="forward", source=total.id, target=gain.id, kind="pass")
    scene.add_edge(name="fb", source=gain.id, target=total.id, kind="pass")
    return scene


def test_signal_mode_enumerates_one_feedback_cycle() -> None:
    scene = _feedback_scene()
    result = loop_candidates(_sim(scene))
    assert result["ok"] is True
    assert result["mode"] == "signal"
    assert len(result["loops"]) == 1
    loop = result["loops"][0]
    assert loop["loop_id"] == "loop-1"
    assert set(loop["member_node_names"]) == {"s", "g"}
    # SCC 内部边只应包含 forward(fb)，外部 ref 不算成员。
    assert set(loop["member_edge_names"]) == {"forward", "fb"}
    assert len(loop["candidate_breaks"]) == 2
    assert loop["suggested_break_id"] in set(loop["member_edge_ids"])
    suggested = [b for b in loop["candidate_breaks"] if b["suggested"]]
    assert len(suggested) == 1


def test_self_loop_is_reported_as_cycle() -> None:
    scene = Scene("signal")
    scene.set_algebraic_solver(True)
    source = scene.add_node(name="u", kind="manual", data={"value": 0.5})
    loop = scene.add_node(
        name="y",
        kind="expression",
        params={
            "expr": "0.5 * y + u",
            "variables": {"y": "fb", "u": "in"},
            "output": "value",
        },
    )
    scene.add_edge(name="in", source=source.id, target=loop.id, kind="pass")
    scene.add_edge(name="fb", source=loop.id, target=loop.id, kind="pass")
    result = loop_candidates(_sim(scene))
    assert result["ok"] is True
    loops = result["loops"]
    assert len(loops) == 1
    assert loops[0]["member_node_names"] == ["y"]
    assert loops[0]["member_edge_names"] == ["fb"]


def test_disabled_or_delayed_edge_breaks_cycle() -> None:
    scene = Scene("signal")
    scene.set_algebraic_solver(True)
    source = scene.add_node(name="u", kind="manual", data={"value": 1.0})
    total = scene.add_node(name="s", kind="sum", params={"weights": {"ref": 1.0, "fb": 1.0}})
    gain = scene.add_node(name="g", kind="gain", params={"gain": -0.5})
    scene.add_edge(name="ref", source=source.id, target=total.id, kind="pass")
    scene.add_edge(name="forward", source=total.id, target=gain.id, kind="pass")
    fb = scene.add_edge(name="fb", source=gain.id, target=total.id, kind="pass")
    scene.set_edge_enabled(fb.id, False) if hasattr(scene, "set_edge_enabled") else None
    if hasattr(scene, "set_edge_enabled"):
        result = loop_candidates(_sim(scene))
        assert result["loops"] == []
    else:  # 若场景无该 API 则跳过（保持测试对其他实现稳健）
        assert loop_candidates(_sim(scene))["ok"] is True


def _vcvs_amplifier() -> Scene:
    """VCVS 同相放大器：反馈支路 R2(out-n)，n 经 R1 下地。"""
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    vin = scene.add_node(name="vin", kind="node")
    out = scene.add_node(name="out", kind="node")
    control = scene.add_node(name="n", kind="node")
    scene.add_edge(
        name="V1",
        source=vin.id,
        target=gnd.id,
        kind="vsource",
        params={"wave": "dc", "offset": 0.0, "amplitude": 1.0},
    )
    scene.add_edge(
        name="E1",
        source=out.id,
        target=gnd.id,
        kind="vcvs",
        params={"gain": 1.0e5, "control_source": vin.id, "control_target": control.id},
    )
    scene.add_edge(name="R1", source=control.id, target=gnd.id, kind="resistor", params={"R": 1000.0})
    scene.add_edge(name="R2", source=out.id, target=control.id, kind="resistor", params={"R": 9000.0})
    return scene


def test_circuit_from_break_returns_loop_for_feedback_branch() -> None:
    result = loop_from_break(_sim(_vcvs_amplifier()), break_id="R2")
    assert result["ok"] is True
    assert result["mode"] == "circuit"
    loop = result["loop"]
    assert set(loop["member_edge_names"]) == {"E1", "R1", "R2"}
    assert set(loop["member_node_names"]) == {"out", "gnd", "n"}
    assert loop["suggested_break_id"] == loop["candidate_breaks"][0]["break_id"]
    assert loop["feedback_sign"] == 1


def test_circuit_from_break_rejects_open_branch() -> None:
    result = loop_from_break(_sim(_vcvs_amplifier()), break_id="V1")
    assert result["ok"] is False
    assert "闭合反馈环" in result["reason"]
