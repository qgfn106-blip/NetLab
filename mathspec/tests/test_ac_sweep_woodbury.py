"""M0 原型：AC 扫频双参数仿射族 + Woodbury 的性质测试。"""

from __future__ import annotations

import math

import numpy as np
import pytest

from mathspec.experiments.ac_sweep_woodbury import (
    ReactiveStamp,
    WoodburyFamily,
    ac_sweep_woodbury,
    conductance_matrix,
    rank_ratio,
)


def _rc_ladder(n: int, every: int = 4) -> tuple[np.ndarray, list[ReactiveStamp]]:
    """n 节点 RC 梯形：相邻电阻 + 每隔 every 个节点一个接地电容。"""
    base = np.zeros((n, n), dtype=complex)
    for index in range(n - 1):
        conductance = 1.0e-3 * (1.0 + 0.1 * math.sin(index))
        base[index, index] += conductance
        base[index + 1, index + 1] += conductance
        base[index, index + 1] -= conductance
        base[index + 1, index] -= conductance
    stamps = [
        ReactiveStamp(a=index, b=None, kind="C", value=1.0e-6 / (1.0 + index))
        for index in range(0, n, every)
    ]
    return base, stamps


def _rlc_ladder(n: int) -> tuple[np.ndarray, list[ReactiveStamp]]:
    base = np.zeros((n, n), dtype=complex)
    stamps: list[ReactiveStamp] = []
    for index in range(n - 1):
        base[index, index] += 2.0e-3
        base[index + 1, index + 1] += 2.0e-3
        base[index, index + 1] -= 2.0e-3
        base[index + 1, index] -= 2.0e-3
        stamps.append(ReactiveStamp(a=index, b=index + 1, kind="L", value=1.0e-3))
        stamps.append(ReactiveStamp(a=index, b=None, kind="C", value=2.0e-7))
    return base, stamps


@pytest.mark.parametrize("n, every", [(20, 4), (40, 8)])
def test_rc_ladder_matches_direct(n: int, every: int) -> None:
    base, stamps = _rc_ladder(n, every)
    freqs = [10.0, 100.0, 1000.0, 10000.0, 100000.0]
    rhs = np.ones(n, dtype=complex)
    solutions, family = ac_sweep_woodbury(base, stamps, freqs, rhs)
    for frequency, solution in zip(freqs, solutions):
        direct = np.linalg.solve(
            conductance_matrix(base, stamps, 2.0 * math.pi * frequency), rhs
        )
        relative = np.linalg.norm(solution - direct) / max(
            1e-300, np.linalg.norm(direct)
        )
        assert relative < 1.0e-10


def test_rlc_ladder_matches_direct() -> None:
    base, stamps = _rlc_ladder(40)
    freqs = [100.0, 300.0, 1000.0, 3000.0, 10000.0]
    rhs = np.linspace(1.0, 0.1, base.shape[0]).astype(complex)
    solutions, family = ac_sweep_woodbury(base, stamps, freqs, rhs, max_ratio=3.0)
    assert family.usable
    for frequency, solution in zip(freqs, solutions):
        direct = np.linalg.solve(
            conductance_matrix(base, stamps, 2.0 * math.pi * frequency), rhs
        )
        relative = np.linalg.norm(solution - direct) / max(
            1e-300, np.linalg.norm(direct)
        )
        assert relative < 1.0e-10


def test_rank_ratio_and_gate() -> None:
    base, stamps = _rc_ladder(20, every=2)  # r = 10, n = 20
    assert rank_ratio(stamps, 20) == pytest.approx(0.5)
    family = WoodburyFamily(base, stamps, omega0=2.0 * math.pi * 100.0, max_ratio=0.10)
    assert not family.usable
    assert "max_ratio" in family.reason


def test_zero_delta_at_reference_frequency() -> None:
    base, stamps = _rc_ladder(20)
    omega0 = 2.0 * math.pi * 100.0
    family = WoodburyFamily(base, stamps, omega0)
    rhs = np.arange(20, dtype=complex)
    solution = family.solve(omega0, rhs)
    direct = np.linalg.solve(conductance_matrix(base, stamps, omega0), rhs)
    assert np.allclose(solution, direct, rtol=1e-12, atol=1e-12)


def test_invalid_inputs_rejected() -> None:
    base, stamps = _rc_ladder(4)
    with pytest.raises(ValueError):
        WoodburyFamily(base, [], omega0=1.0)
    with pytest.raises(ValueError):
        WoodburyFamily(base, stamps, omega0=0.0)
    with pytest.raises(ValueError):
        ReactiveStamp(a=0, b=None, kind="R", value=1.0).conductance(1.0)
