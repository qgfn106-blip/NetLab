"""节点索引前的死端点/控制端点校验。"""

from __future__ import annotations

import pytest

from netlab.limits import ComputeError
from netlab.nodal import CircuitNode, CircuitSolver, Diode


def _nodes():
    return [
        CircuitNode(id="n1", name="n1"),
        CircuitNode(id="gnd", name="gnd", ground=True),
    ]


def _diode(name: str, a: str, b: str = "gnd", **extra) -> Diode:
    params = {"Is": 1e-14, "n": 1.0, "temperature": 300.0, "rs": 2.0, **extra}
    return Diode(name=name, a=a, b=b, params=params, state={})


def test_missing_endpoint_reports_id():
    with pytest.raises(ComputeError, match=r"D1.*'missing'"):
        CircuitSolver(_nodes(), [_diode("D1", "missing")])


def test_missing_control_node_reports_id():
    element = _diode("D2", "n1")
    element.control_a = "ghost"
    with pytest.raises(ComputeError, match=r"D2.*'ghost'"):
        CircuitSolver(_nodes(), [element])


def test_internal_endpoint_is_allowed():
    solver = CircuitSolver(_nodes(), [_diode("D3", "__D3__junction")])
    assert "__D3__junction" in solver.unknown_ids
