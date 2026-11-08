"""层 D：收敛阶（Richardson，dt 减半）。

审计 §3.2 已指出：源步末单点采样让 trapezoidal 在含源电路上实测只有 1 阶。
本文件用 xfail(strict=True) 显式登记该缺陷；内核修复后 xpass 会强制更新。
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


def test_observed_order_is_currently_first_order() -> None:
    """当前实现的实测阶≈1（记录事实，不是验收标准）。"""
    orders = _orders(_errors())
    assert all(0.8 <= value <= 1.2 for value in orders), orders


@pytest.mark.xfail(
    strict=True,
    reason="审计 §3.2：源步末单点采样使 trapezoidal 实测 1 阶，声明 2 阶不成立",
)
def test_declared_second_order_is_met() -> None:
    orders = _orders(_errors())
    for value in orders:
        assert value == pytest.approx(2.0, abs=0.3)
