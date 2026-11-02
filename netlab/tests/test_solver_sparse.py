"""稀疏矩阵装配：阈值切换、与稠密解一致、奇异诊断。"""

from __future__ import annotations

import numpy as np
import pytest

from netlab.core.common.limits import ComputeError, ValidationError
from netlab.core.compute.nodal import SolverOptions
from netlab.core.model.scene import Scene


def _ladder(count: int, *, source: float = 1.0, r_series: float = 1000.0,
            r_shunt: float = 1000.0) -> Scene:
    """count 节 RC 梯形网络：每节串联电阻 + 对地电阻。"""
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    nodes = [scene.add_node(name=f"n{i}", kind="node") for i in range(count)]
    scene.add_edge(name="V1", source=nodes[0].id, target=gnd.id, kind="vsource",
                   params={"wave": "dc", "offset": source, "amplitude": 0.0})
    for index in range(count - 1):
        scene.add_edge(
            name=f"Rs{index}", source=nodes[index].id, target=nodes[index + 1].id,
            kind="resistor", params={"R": r_series},
        )
    for index, node in enumerate(nodes):
        scene.add_edge(
            name=f"Rp{index}", source=node.id, target=gnd.id, kind="resistor",
            params={"R": r_shunt},
        )
    return scene


def _voltages(scene: Scene) -> list[float]:
    return [float(record.data.get("voltage", 0.0)) for record in scene.nodes.values()
            if record.name.startswith("n")]


def test_sparse_auto_threshold_switches():
    scene = _ladder(12)
    scene.set_solver_options(SolverOptions(sparse="auto", sparse_threshold=5))
    engine = scene.ensure_engine()
    engine.step(1e-4)
    assert engine.solver.sparse is True

    scene = _ladder(4)
    scene.set_solver_options(SolverOptions(sparse="auto", sparse_threshold=200))
    engine = scene.ensure_engine()
    engine.step(1e-4)
    assert engine.solver.sparse is False


def test_sparse_on_reports_flag_and_matches_dense():
    dense_scene = _ladder(60, source=3.0)
    dense_scene.set_solver_options(SolverOptions(sparse="off"))
    dense_engine = dense_scene.ensure_engine()
    dense_engine.step(1e-4)
    dense = np.array(_voltages(dense_scene))

    sparse_scene = _ladder(60, source=3.0)
    sparse_scene.set_solver_options(SolverOptions(sparse="on"))
    sparse_engine = sparse_scene.ensure_engine()
    assert sparse_engine.solver.sparse is True
    sparse_engine.step(1e-4)
    sparse = np.array(_voltages(sparse_scene))

    np.testing.assert_allclose(sparse, dense, rtol=1e-9, atol=1e-12)
    # 梯形网络确实衰减，不是全 0 或全等（避免退化测试）。
    assert dense[0] > dense[1] > dense[10] > 0.0


def test_operating_point_reports_sparse():
    scene = _ladder(30, source=2.0)
    scene.set_solver_options(SolverOptions(sparse="on"))
    result = scene.operating_point()
    assert result["sparse"] is True
    assert result["node_voltages"]["n0"] == pytest.approx(2.0, rel=1e-9)


def test_sparse_singular_matrix_diagnostic():
    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    n1 = scene.add_node(name="n1", kind="node")
    scene.add_edge(name="V1", source=n1.id, target=gnd.id, kind="vsource",
                   params={"wave": "dc", "offset": 5.0, "amplitude": 0.0})
    scene.add_edge(name="V2", source=n1.id, target=gnd.id, kind="vsource",
                   params={"wave": "dc", "offset": 3.0, "amplitude": 0.0})
    scene.set_solver_options(SolverOptions(sparse="on"))
    with pytest.raises(ComputeError, match="奇异"):
        scene.ensure_engine().step(1e-4)


def test_sparse_invalid_option_rejected():
    scene = _ladder(3)
    scene.set_solver_options(SolverOptions(sparse="bogus"))
    with pytest.raises(ValidationError, match="sparse 必须是"):
        scene.ensure_engine()


def test_sparse_config_passthrough():
    scene = _ladder(4)
    from netlab.core.compute.simulation import Simulation

    sim = Simulation(scene)
    config = sim.apply_config({"sparse": "on", "sparse_threshold": 50})
    assert config["sparse"] == "on"
    assert config["sparse_threshold"] == 50
    assert scene.solver_options.sparse == "on"
    assert scene.solver_options.sparse_threshold == 50
    with pytest.raises(ValidationError, match="sparse 必须是"):
        sim.apply_config({"sparse": "maybe"})
