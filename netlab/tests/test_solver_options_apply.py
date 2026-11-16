"""M-01/COMP-03：solver_options 静默失效复现（先 RED 后 GREEN）。

两个缺陷：
1) Scene.set_solver_options 未置 _dirty → 后续 ensure_engine 不重建，新选项不生效；
2) Simulation.load_scene 先 ensure_engine 再 apply_config → 引擎用默认选项构建，
   工程里的非默认 solver_options 不落到实际引擎。
"""

from __future__ import annotations

from netlab.core.compute.circuit.stamps import SolverOptions
from netlab.core.compute.simulation import Simulation
from netlab.core.model.scene import Scene


def _rc_scene() -> Scene:
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    n1 = scene.add_node(name="n1", kind="node")
    scene.add_edge(name="V1", source=n1.id, target=gnd.id, kind="vsource",
                   params={"wave": "dc", "offset": 5.0, "amplitude": 0.0})
    scene.add_edge(name="R1", source=n1.id, target=gnd.id, kind="resistor",
                   params={"R": 1000.0})
    scene.add_edge(name="C1", source=n1.id, target=gnd.id, kind="capacitor",
                   params={"C": 1.0e-6})
    return scene


def test_set_solver_options_marks_dirty_and_rebuilds() -> None:
    scene = _rc_scene()
    engine1 = scene.ensure_engine()
    assert scene._dirty is False
    scene.set_solver_options(SolverOptions(gmin=0.02))
    assert scene._dirty is True, "set_solver_options 必须置 _dirty 以触发重建"
    engine2 = scene.ensure_engine()
    assert engine2 is not engine1, "选项变更后 ensure_engine 应重建引擎"
    assert abs(float(engine2.solver.options.gmin) - 0.02) < 1e-15


def test_load_scene_applies_nondefault_solver_options() -> None:
    base = _rc_scene()
    payload = dict(base.to_payload())
    payload["sim"] = {"fps": 60, "dt": 1.0e-4, "steps_per_frame": 2,
                      "gmin": 0.02, "reltol": 1.0e-6}
    sim = Simulation(Scene("circuit"))
    sim.load_scene(payload)
    engine = sim.scene.ensure_engine()
    assert abs(float(engine.solver.options.gmin) - 0.02) < 1e-15, "工程 solver_options 未生效"
    assert abs(float(engine.solver.options.reltol) - 1.0e-6) < 1e-18
