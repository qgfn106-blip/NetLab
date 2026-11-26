"""P2-05：Q4 有限元单元矩阵与边界条件的基础解析/物理一致性测试。"""

from __future__ import annotations

import numpy as np
import pytest

pytest.importorskip("scipy")

from netlab.core.common.limits import ValidationError
from netlab.core.compute.fem import (
    FemConfig,
    FemModel,
    FemSimulation,
    _element_matrices,
)


def test_q4_element_matrices_partition_of_unity():
    stiffness, mass = _element_matrices(nx=4, ny=4, conductivity=2.0, capacity=3.0)
    # 常温度场的刚度为零（行和为零）
    assert np.allclose(stiffness.sum(axis=1), 0.0, atol=1e-12)
    # 质量矩阵对称正定，且总质量为 rho*c*area
    assert np.allclose(mass, mass.T)
    assert np.isclose(mass.sum(), 3.0 * (1.0 / 4.0) * (1.0 / 4.0))
    eig = np.linalg.eigvalsh(mass)
    assert eig.min() > 0.0


def test_dirichlet_boundary_is_held_and_interior_stays_uniform_without_source():
    cfg = FemConfig(
        nx=6,
        ny=4,
        dt=0.002,
        steps_per_frame=1,
        source_amplitude=0.0,
        boundary_left=20.0,
        boundary_right=20.0,
        initial_temperature=20.0,
    )
    model = FemModel(cfg)
    for _ in range(5):
        model.step()
    values = model.temperature
    assert np.allclose(values[model.mesh.left], 20.0, atol=1e-9)
    assert np.allclose(values[model.mesh.right], 20.0, atol=1e-9)
    # 无热源、初值均匀、边界同温：全场应保持 20（上下绝缘无热量进出）
    assert np.allclose(values, 20.0, atol=1e-6)


def test_gaussian_source_heats_interior_not_boundary():
    cfg = FemConfig(
        nx=10,
        ny=8,
        dt=0.002,
        steps_per_frame=1,
        source_amplitude=5000.0,
        boundary_left=20.0,
        boundary_right=20.0,
        initial_temperature=20.0,
    )
    model = FemModel(cfg)
    for _ in range(20):
        model.step()
    assert model.temperature.max() > 20.0
    assert np.allclose(model.temperature[model.mesh.left], 20.0, atol=1e-9)
    assert np.allclose(model.temperature[model.mesh.right], 20.0, atol=1e-9)


def test_crank_nicolson_preserves_uniform_state():
    cfg = FemConfig(
        nx=6,
        ny=4,
        dt=0.002,
        steps_per_frame=1,
        source_amplitude=0.0,
        boundary_left=20.0,
        boundary_right=20.0,
        initial_temperature=20.0,
        time_integrator="crank_nicolson",
    )
    model = FemModel(cfg)
    for _ in range(20):
        model.step()
    assert np.allclose(model.temperature, 20.0, atol=1e-6)
    assert model.stats()["time_integrator"] == "crank_nicolson"


def test_top_and_bottom_dirichlet_boundaries_are_held():
    cfg = FemConfig(
        nx=8,
        ny=6,
        dt=0.002,
        steps_per_frame=1,
        source_amplitude=0.0,
        boundary_left=20.0,
        boundary_right=20.0,
        boundary_top="dirichlet",
        boundary_top_value=60.0,
        boundary_bottom="dirichlet",
        boundary_bottom_value=40.0,
        initial_temperature=20.0,
    )
    model = FemModel(cfg)
    for _ in range(25):
        model.step()
    sides = np.union1d(model.mesh.left, model.mesh.right)
    top_inner = np.setdiff1d(model.mesh.top, sides)
    bottom_inner = np.setdiff1d(model.mesh.bottom, sides)
    assert np.allclose(model.temperature[top_inner], 60.0, atol=1e-9)
    assert np.allclose(model.temperature[bottom_inner], 40.0, atol=1e-9)
    # 角点由左右侧 Dirichlet 优先持有 20℃
    assert np.allclose(model.temperature[sides], 20.0, atol=1e-9)
    center = (model.mesh.ny // 2) * (model.mesh.nx + 1) + model.mesh.nx // 2
    assert 20.0 <= model.temperature[center] <= 60.0


def test_crank_nicolson_matches_backward_euler_at_steady_state():
    def run(integrator: str) -> np.ndarray:
        cfg = FemConfig(
            nx=8,
            ny=6,
            dt=0.002,
            steps_per_frame=1,
            source_amplitude=0.0,
            boundary_left=20.0,
            boundary_right=20.0,
            boundary_top="dirichlet",
            boundary_top_value=60.0,
            boundary_bottom="dirichlet",
            boundary_bottom_value=40.0,
            initial_temperature=20.0,
            time_integrator=integrator,
        )
        model = FemModel(cfg)
        for _ in range(400):
            model.step()
        return model.temperature

    be = run("backward_euler")
    cn = run("crank_nicolson")
    assert np.max(np.abs(be - cn)) < 5e-2


def test_invalid_boundary_and_time_integrator_are_rejected():
    with pytest.raises(ValidationError, match="上边界条件"):
        FemModel(FemConfig(nx=6, ny=4, boundary_top="robin"))
    with pytest.raises(ValidationError, match="下边界条件"):
        FemModel(FemConfig(nx=6, ny=4, boundary_bottom="convection"))
    with pytest.raises(ValidationError, match="时间积分格式"):
        FemModel(FemConfig(nx=6, ny=4, time_integrator="rk4"))


def test_apply_config_accepts_boundary_and_integrator_fields():
    sim = FemSimulation(FemConfig(nx=6, ny=4))
    exported = sim.apply_config(
        {
            "boundary_top": "dirichlet",
            "boundary_top_value": 55.0,
            "boundary_bottom": "dirichlet",
            "boundary_bottom_value": 35.0,
            "time_integrator": "crank_nicolson",
        }
    )
    assert exported["boundary_top"] == "dirichlet"
    assert exported["boundary_bottom"] == "dirichlet"
    assert exported["boundary_top_value"] == 55.0
    assert exported["boundary_bottom_value"] == 35.0
    assert exported["time_integrator"] == "crank_nicolson"
    assert sim.snapshot(include_mesh=False)["config"]["time_integrator"] == "crank_nicolson"
