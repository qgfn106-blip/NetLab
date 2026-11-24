"""P2-05：Q4 有限元单元矩阵与边界条件的基础解析/物理一致性测试。"""

from __future__ import annotations

import numpy as np
import pytest

pytest.importorskip("scipy")

from netlab.core.compute.fem import FemConfig, FemModel, _element_matrices


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
