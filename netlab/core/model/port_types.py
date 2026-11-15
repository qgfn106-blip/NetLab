"""端口类型契约（P2-B B1/B2：纯数据契约 + 纯函数，不接线）。

依据审批 m06270：PortType 最小集 scalar/complex/vector2/electrical/power；
unit/dimension 仅提示、不参与硬校验；PortDesc 暂不写入 NodeDesc；不改 ports.py 现有语义。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

PORT_TYPES: tuple[str, ...] = (
    "scalar",
    "complex",
    "vector2",
    "electrical",
    "power",
)

# 仅「可提升兼容」的裸类型对（其余不同类型一律不兼容；electrical/power 只与自身兼容）。
_PROMOTABLE: frozenset[frozenset[str]] = frozenset(
    {
        frozenset({"scalar", "complex"}),
        frozenset({"scalar", "electrical"}),
    }
)


@dataclass(frozen=True)
class PortDesc:
    """类型化端口描述：在 PortSpec/PinSpec 之上补充类型/单位/量纲（单位量纲仅提示）。"""

    name: str
    type: str
    role: str = ""
    direction: str = "input"
    unit: str = ""
    dimension: str = ""
    required: bool = False
    order: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "type": self.type,
            "role": self.role,
            "direction": self.direction,
            "unit": self.unit,
            "dimension": self.dimension,
            "required": self.required,
            "order": self.order,
        }


def from_spec(
    spec: Any,
    type_: str,
    *,
    unit: str = "",
    dimension: str = "",
    direction: str | None = None,
) -> PortDesc:
    """从 PortSpec/PinSpec 派生 PortDesc，保留 name/role(order/required)。"""
    role = str(getattr(spec, "role", "input"))
    return PortDesc(
        name=str(getattr(spec, "name")),
        type=str(type_),
        role=role,
        direction=str(direction) if direction is not None else role,
        unit=str(unit),
        dimension=str(dimension),
        required=bool(getattr(spec, "required", False)),
        order=int(getattr(spec, "order", 0)),
    )


def can_connect(a: PortDesc, b: PortDesc) -> tuple[bool, str]:
    """判断两个端口能否连接；返回 (ok, 说明)。纯函数，不接入引擎。

    * 未知类型 → 拒绝；两输出或两输入 → 拒绝；类型不兼容 → 拒绝。
    * 同类型但量纲不同 → 允许，但 reason 标注「量纲（仅提示）」，不硬校验。
    """
    if a.type not in PORT_TYPES:
        return False, f"未知端口类型：{a.type!r}"
    if b.type not in PORT_TYPES:
        return False, f"未知端口类型：{b.type!r}"
    if a.direction == "output" and b.direction == "output":
        return False, "两个输出端口不能直连"
    if a.direction == "input" and b.direction == "input":
        return False, "两个输入端口不能直连"
    if a.type != b.type and frozenset({a.type, b.type}) not in _PROMOTABLE:
        return False, f"类型不兼容：{a.type} ↔ {b.type}"
    if a.dimension and b.dimension and a.dimension != b.dimension:
        return True, f"量纲不同（仅提示）：{a.dimension} ↔ {b.dimension}"
    return True, "兼容"
