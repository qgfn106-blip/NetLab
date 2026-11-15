"""P2-B B1/B2：端口类型契约纯函数（纯新增、不接线）。

依据审批 m06270 裁定：PortType 最小集 scalar/complex/vector2/electrical/power；
unit/dimension 仅提示、不参与硬校验；PortDesc 暂不写入 NodeDesc。
"""

from __future__ import annotations

import pytest

from netlab.core.model.ports import PortSpec, PinSpec
from netlab.core.model.port_types import (
    PORT_TYPES,
    PortDesc,
    can_connect,
    from_spec,
)


def _d(type_, direction, dimension=""):
    return PortDesc(name="p", type=type_, direction=direction, dimension=dimension)


def test_port_types_minimal_set() -> None:
    assert set(PORT_TYPES) == {"scalar", "complex", "vector2", "electrical", "power"}


def test_connect_input_output_scalar_ok() -> None:
    ok, _ = can_connect(_d("scalar", "output"), _d("scalar", "input"))
    assert ok is True


def test_two_outputs_rejected() -> None:
    ok, reason = can_connect(_d("scalar", "output"), _d("scalar", "output"))
    assert ok is False and "输出" in reason


def test_two_inputs_rejected() -> None:
    ok, _ = can_connect(_d("scalar", "input"), _d("scalar", "input"))
    assert ok is False


def test_incompatible_types_rejected() -> None:
    ok, reason = can_connect(_d("scalar", "output"), _d("power", "input"))
    assert ok is False and "类型" in reason


def test_scalar_complex_promotable() -> None:
    ok, _ = can_connect(_d("complex", "output"), _d("scalar", "input"))
    assert ok is True


def test_unknown_type_rejected() -> None:
    ok, reason = can_connect(_d("bogus", "output"), _d("scalar", "input"))
    assert ok is False and "未知" in reason


def test_dimension_mismatch_is_hint_not_hard() -> None:
    # 同类型、不同量纲：仅提示，不判不兼容（审批裁定 unit/dimension 仅提示）
    ok, reason = can_connect(
        _d("electrical", "output", dimension="voltage"),
        _d("electrical", "input", dimension="current"),
    )
    assert ok is True and "量纲" in reason


def test_from_spec_derives_fields() -> None:
    spec = PortSpec(name="in1", role="input", required=True, order=3)
    desc = from_spec(spec, "scalar")
    assert desc.name == "in1" and desc.role == "input" and desc.order == 3
    assert desc.type == "scalar" and desc.required is True


def test_from_pinspec_derives_and_keeps_role() -> None:
    pin = PinSpec(name="A", role="passive", order=1)
    desc = from_spec(pin, "electrical", unit="V", dimension="voltage")
    assert desc.name == "A" and desc.role == "passive" and desc.order == 1
    assert desc.unit == "V" and desc.dimension == "voltage"


def test_portdesc_frozen() -> None:
    d = _d("scalar", "input")
    with pytest.raises(Exception):
        d.name = "x"  # type: ignore[misc]
