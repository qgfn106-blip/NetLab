"""层 F：变异测试——已知错误必须被解析解门杀死。"""
from __future__ import annotations

from netlab.core.compute.circuit.elements import Resistor
from netlab.core.compute.circuit.stamps import _stamp_conductance

from eval_helpers import rc_analytic, rc_voltage_after

TAU = 1.0e-3
ABS_TOL = 1.0e-2


def test_resistor_stamp_mutation_is_killed(monkeypatch) -> None:
    original = Resistor.stamp

    def mutated(self, ctx):  # type: ignore[no-untyped-def]
        _stamp_conductance(ctx, self.a, self.b, self.conductance * 1.05)

    monkeypatch.setattr(Resistor, "stamp", mutated)
    value = rc_voltage_after(TAU / 100.0, 400)
    analytic = rc_analytic(4.0 * TAU)
    assert abs(value - analytic) > ABS_TOL, "5% 电阻变异未被解析解门杀死"


def test_baseline_is_green() -> None:
    value = rc_voltage_after(TAU / 100.0, 400)
    analytic = rc_analytic(4.0 * TAU)
    assert abs(value - analytic) <= ABS_TOL
