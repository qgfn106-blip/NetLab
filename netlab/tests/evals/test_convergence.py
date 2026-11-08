"""层 D：收敛阶（Richardson，dt 减半）。

P3 修复前实测 1 阶；根因是阶跃源在 t=0 跳变时电容初始电流被当成 0，
梯形历史不自洽。solver 现在用一次 BE 预测步求 i(0+)，实测阶恢复 2 阶。
"""
from __future__ import annotations

import math

import pytest

from eval_helpers import rc_analytic, rc_voltage_after

TAU = 1.0e-3


def _errors() -> list[float]:
    target = rc_analytic(TAU)
    return [abs(rc_voltage_after(TAU / n, n) - target) for n in (20, 40, 80, 160)]


def _orders(errors: list[float]) -> list[float]:
    return [math.log2(errors[i] / errors[i + 1]) for i in range(len(errors) - 1)]


def test_observed_order_is_second_order() -> None:
    """dt 减半时误差应约除以 4（P3 修复后实测 1.98–1.99）。"""
    orders = _orders(_errors())
    for value in orders:
        assert value == pytest.approx(2.0, abs=0.15), orders
