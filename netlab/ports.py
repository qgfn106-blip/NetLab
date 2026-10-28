"""端口契约（R20/D37）：器件节点的引脚声明。

引脚是「电气连接」与「求解器」之间的桥：

- ``name`` 是迁移与导线绑定用的稳定标识；
- ``role`` 只用于显示/校验提示（input/output/bidirectional/power/passive）；
- ``required`` 的引脚必须恰好接一条导线到网络节点；
- ``dx/dy`` 是符号本地几何（前端渲染用，单位=符号本地单位）。

设备节点使用 ``kind="device"``，``params.element`` 指向下面的元件 kind。
"""

from __future__ import annotations

from dataclasses import dataclass

ROLE_VALUES = ("input", "output", "bidirectional", "power", "passive")


@dataclass(frozen=True)
class PortSpec:
    """信号/矢量节点的输入端口（R20/Q8）；输出端口沿用 ComputeSpec.outputs。"""

    name: str
    role: str = "input"
    required: bool = False
    order: int = 0

    def to_dict(self) -> dict[str, object]:
        return {
            "name": self.name,
            "role": self.role,
            "required": self.required,
            "order": self.order,
        }


@dataclass(frozen=True)
class PinSpec:
    name: str
    role: str = "passive"
    required: bool = True
    order: int = 0
    dx: float = 0.0
    dy: float = 0.0

    def to_dict(self) -> dict[str, object]:
        return {
            "name": self.name,
            "role": self.role,
            "required": self.required,
            "order": self.order,
            "dx": self.dx,
            "dy": self.dy,
        }


def _pins(*items: tuple[str, str] | tuple[str, str, bool]) -> tuple[PinSpec, ...]:
    rows: list[PinSpec] = []
    for index, item in enumerate(items):
        name, role = item[0], item[1]
        required = bool(item[2]) if len(item) > 2 else True
        rows.append(PinSpec(name=name, role=role, required=required, order=index))
    return tuple(rows)


#: 每个电路元件 kind 的引脚表（R20 起逐步替换参数端口）。
PINS: dict[str, tuple[PinSpec, ...]] = {
    "resistor": _pins(("1", "passive"), ("2", "passive")),
    "capacitor": _pins(("1", "passive"), ("2", "passive")),
    "inductor": _pins(("1", "passive"), ("2", "passive")),
    "switch": _pins(("1", "passive"), ("2", "passive")),
    "vsource": _pins(("+", "output"), ("-", "output")),
    "isource": _pins(("+", "output"), ("-", "output")),
    "diode": _pins(("A", "passive"), ("K", "passive")),
    "led": _pins(("A", "passive"), ("K", "passive")),
    "zener": _pins(("A", "passive"), ("K", "passive")),
    "opamp": _pins(
        ("IN+", "input"),
        ("IN-", "input"),
        ("V+", "power", False),
        ("V-", "power", False),
        ("OUT", "output"),
    ),
    "comparator": _pins(
        ("IN+", "input"),
        ("IN-", "input"),
        ("V+", "power", False),
        ("V-", "power", False),
        ("OUT", "output"),
    ),
    "vcvs": _pins(
        ("IN+", "input"), ("IN-", "input"), ("OUT+", "output"), ("OUT-", "output")
    ),
    "vccs": _pins(
        ("IN+", "input"), ("IN-", "input"), ("OUT+", "output"), ("OUT-", "output")
    ),
    "dflipflop": _pins(
        ("D", "input"), ("CLK", "input"), ("Q+", "output"), ("Q-", "output")
    ),
    "ne555": _pins(("OUT", "output"), ("VCC", "power"), ("GND", "power")),
    "ldo": _pins(("IN", "input"), ("OUT", "output"), ("GND", "power")),
    "transformer": _pins(
        ("P1", "bidirectional"),
        ("P2", "bidirectional"),
        ("S1", "bidirectional"),
        ("S2", "bidirectional"),
    ),
    "coupling_inductor": _pins(
        ("P1", "bidirectional"),
        ("P2", "bidirectional"),
        ("S1", "bidirectional"),
        ("S2", "bidirectional"),
    ),
    "npn": _pins(("C", "passive"), ("B", "input"), ("E", "passive")),
    "pnp": _pins(("C", "passive"), ("B", "input"), ("E", "passive")),
    "nmos": _pins(("D", "passive"), ("G", "input"), ("S", "passive")),
    "pmos": _pins(("D", "passive"), ("G", "input"), ("S", "passive")),
    "and_gate": _pins(
        ("A", "input"), ("B", "input"), ("VDD", "power"), ("Y", "output"), ("GND", "power")
    ),
    "or_gate": _pins(
        ("A", "input"), ("B", "input"), ("VDD", "power"), ("Y", "output"), ("GND", "power")
    ),
    "not_gate": _pins(("A", "input"), ("VDD", "power"), ("Y", "output"), ("GND", "power")),
    "xor_gate": _pins(
        ("A", "input"), ("B", "input"), ("VDD", "power"), ("Y", "output"), ("GND", "power")
    ),
    "counter4": _pins(
        ("CLK", "input"),
        ("RST", "input"),
        ("Q0", "output"),
        ("Q1", "output"),
        ("Q2", "output"),
        ("Q3", "output"),
        ("COM", "power"),
    ),
    "shift4": _pins(
        ("D", "input"),
        ("CLK", "input"),
        ("RST", "input"),
        ("Q0", "output"),
        ("Q1", "output"),
        ("Q2", "output"),
        ("Q3", "output"),
        ("COM", "power"),
    ),
    "adc4": _pins(
        ("VIN", "input"),
        ("CLK", "input"),
        ("Q0", "output"),
        ("Q1", "output"),
        ("Q2", "output"),
        ("Q3", "output"),
        ("COM", "power"),
    ),
    "dac4": _pins(
        ("B0", "input"),
        ("B1", "input"),
        ("B2", "input"),
        ("B3", "input"),
        ("OUT", "output"),
        ("COM", "power"),
    ),
}


def pins_for_device(kind: str) -> tuple[PinSpec, ...]:
    """返回元件 kind 的引脚表；未登记时抛 KeyError（调用方转成可读错误）。"""
    table = PINS.get(kind)
    if table is None:
        raise KeyError(f"元件 {kind!r} 还没有引脚声明（R20）")
    return table


def required_pin_names(kind: str) -> list[str]:
    return [pin.name for pin in pins_for_device(kind) if pin.required]


def pin_table(kind: str) -> list[dict[str, object]]:
    return [pin.to_dict() for pin in pins_for_device(kind)]


__all__ = [
    "PinSpec",
    "PortSpec",
    "PINS",
    "ROLE_VALUES",
    "pins_for_device",
    "required_pin_names",
    "pin_table",
]
