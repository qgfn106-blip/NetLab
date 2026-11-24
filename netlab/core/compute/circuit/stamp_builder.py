"""单一 StampBuilder 契约（P2-01 收敛）。

把每个器件 kind 的 MNA 贡献收敛到一处（per-kind 贡献函数），供两条路径共享：

- StaticMatrixSink：descriptor 静态 A/E 矩阵装配（描述符形式 E ẋ + A x = B u）。
- ElementStampSink：包装 elements.StampContext，供 element.stamp 复用同一贡献函数。

每个 kind 一个 stamp_<kind>(element, sink) 函数；descriptor._assemble_matrices 与
对应的 element.stamp 都调用它们，从而删除 descriptor 里的 kind 特判，并保证两条
路径共享同一份装配逻辑。

注意：电感在 transient 求解器里用伴随电导（二端、无支路未知量），而 descriptor 静态
装配把电感作为独立支路电流（branch row + E[row,row] -= L），两者未知量布局不同，无法
在不改数值语义的前提下 elementwise 统一。因此 element.stamp 的 Inductor 分支保留旧的
伴随实现，只有 descriptor 静态装配走本模块的 stamp_inductor_static（详见审计报告）。
"""
from __future__ import annotations

from typing import Any, Protocol, Sequence

from .stamps import StampContext, _stamp_conductance, _stamp_current, stamp_laplacian


class StampSink(Protocol):
    """kind 贡献函数与后端之间的桥：屏蔽 descriptor 静态矩阵与 element 上下文的差异。"""

    mode: str
    omega: float

    def node(self, name: str | None) -> int | None: ...

    def branch(self, element: Any) -> int: ...

    def add_A(self, row: int, col: int, value: Any) -> None: ...

    def add_E(self, row: int, col: int, value: Any) -> None: ...

    def add_conductance(self, a: str, b: str, value: Any) -> None: ...

    def add_E_conductance(self, a: str, b: str, value: Any) -> None: ...

    def add_current(self, a: str, b: str, value: Any) -> None: ...

    def set_rhs(self, row: int, value: Any) -> None: ...


class StaticMatrixSink:
    """descriptor 静态 A/E 装配后端（float 矩阵，无 rhs）。"""

    mode = "static"
    omega = 0.0

    def __init__(self, A: Any, E: Any, index: Any) -> None:
        self.A = A
        self.E = E
        self.index = index

    def node(self, name: str | None) -> int | None:
        if name is None:
            return None
        return self.index.node_index.get(name)

    def branch(self, element: Any) -> int:
        return self.index.branch_index[element.name]

    def add_A(self, row: int, col: int, value: Any) -> None:
        self.A[row, col] += value

    def add_E(self, row: int, col: int, value: Any) -> None:
        self.E[row, col] += value

    def add_conductance(self, a: str, b: str, value: Any) -> None:
        stamp_laplacian(self.A, self.index.node_index, a, b, float(value))

    def add_E_conductance(self, a: str, b: str, value: Any) -> None:
        stamp_laplacian(self.E, self.index.node_index, a, b, float(value))

    def add_current(self, a: str, b: str, value: Any) -> None:
        # 独立源只进 B 向量，由 _build_input_vector 负责；静态 A/E 装配不涉及 rhs。
        return None

    def set_rhs(self, row: int, value: Any) -> None:
        return None


class ElementStampSink:
    """element.stamp 装配后端（包装 StampContext）。"""

    def __init__(self, ctx: StampContext) -> None:
        self.ctx = ctx

    @property
    def mode(self) -> str:
        return self.ctx.mode

    @property
    def omega(self) -> float:
        return float(getattr(self.ctx, "omega", 0.0) or 0.0)

    def node(self, name: str | None) -> int | None:
        if name is None:
            return None
        return self.ctx.index.get(name)

    def branch(self, element: Any) -> int:
        return element.branch_index

    def add_A(self, row: int, col: int, value: Any) -> None:
        self.ctx.A[row, col] += value

    def add_E(self, row: int, col: int, value: Any) -> None:
        raise NotImplementedError("ElementStampSink 无独立 E 矩阵；E 语义由电容伙伴模型承载")

    def add_conductance(self, a: str, b: str, value: Any) -> None:
        _stamp_conductance(self.ctx, a, b, value)

    def add_E_conductance(self, a: str, b: str, value: Any) -> None:
        raise NotImplementedError("ElementStampSink 无独立 E 矩阵")

    def add_current(self, a: str, b: str, value: Any) -> None:
        _stamp_current(self.ctx, a, b, value)

    def set_rhs(self, row: int, value: Any) -> None:
        self.ctx.rhs[row] = value


def stamp_resistor(element: Any, sink: StampSink) -> None:
    sink.add_conductance(element.a, element.b, element.conductance)


def stamp_switch(element: Any, sink: StampSink) -> None:
    sink.add_conductance(element.a, element.b, element.conductance)


def stamp_sensor(element: Any, sink: StampSink) -> None:
    # 高阻电压测量：两脚各自对地 1e-12 漏电，等价于开路。
    for name in (element.a, element.b):
        position = sink.node(name)
        if position is not None:
            sink.add_A(position, position, 1.0e-12)


def stamp_capacitor(element: Any, sink: StampSink) -> None:
    mode = sink.mode
    if mode == "dc":
        # 直流工作点：电容开路，不参与 KCL。
        return
    if mode == "ac":
        # 小信号交流：导纳 jωC。
        sink.add_conductance(element.a, element.b, 1j * sink.omega * element.capacitance)
        return
    if mode == "static":
        # 描述符静态装配：C 进入 E 矩阵（E ẋ 项）。
        sink.add_E_conductance(element.a, element.b, float(element.capacitance))
        return
    # 瞬态：伴随电导 + 历史电流源。
    sink.add_conductance(element.a, element.b, element.conductance)
    sink.add_current(element.a, element.b, element.source_current)


def stamp_inductor_static(element: Any, sink: StampSink) -> None:
    """descriptor 静态装配：电感作独立支路电流未知量。"""
    row = sink.branch(element)
    ai = sink.node(element.a)
    bi = sink.node(element.b)
    # KCL：电感电流从 a 流向 b。
    if ai is not None:
        sink.add_A(ai, row, 1.0)
    if bi is not None:
        sink.add_A(bi, row, -1.0)
    # 电感方程：v_a - v_b - L di/dt = 0。
    if ai is not None:
        sink.add_A(row, ai, 1.0)
    if bi is not None:
        sink.add_A(row, bi, -1.0)
    sink.add_E(row, row, -float(element.inductance))


def stamp_vsource(
    element: Any,
    sink: StampSink,
    *,
    control: tuple[str, str | None] | None = None,
    gain: float = 1.0,
) -> None:
    row = sink.branch(element)
    ai = sink.node(element.a)
    bi = sink.node(element.b)
    if ai is not None:
        sink.add_A(ai, row, 1.0)
        sink.add_A(row, ai, 1.0)
    if bi is not None:
        sink.add_A(bi, row, -1.0)
        sink.add_A(row, bi, -1.0)
    if control is not None:
        ci = sink.node(control[0])
        di = sink.node(control[1])
        if ci is not None:
            sink.add_A(row, ci, -float(gain))
        if di is not None:
            sink.add_A(row, di, float(gain))
    if sink.mode != "static":
        sink.set_rhs(row, element.value * getattr(element, "source_scale", 1.0))


def stamp_vcvs(element: Any, sink: StampSink) -> None:
    row = sink.branch(element)
    ai = sink.node(element.a)
    bi = sink.node(element.b)
    if ai is not None:
        sink.add_A(ai, row, 1.0)
        sink.add_A(row, ai, 1.0)
    if bi is not None:
        sink.add_A(bi, row, -1.0)
        sink.add_A(row, bi, -1.0)
    ci = sink.node(element.control_a)
    di = sink.node(element.control_b)
    if ci is not None:
        sink.add_A(row, ci, -float(element.gain))
    if di is not None:
        sink.add_A(row, di, float(element.gain))
    if sink.mode != "static":
        sink.set_rhs(row, 0.0)


def stamp_vccs(
    element: Any,
    sink: StampSink,
    *,
    control: tuple[str, str | None] | None = None,
    gain: float | None = None,
) -> None:
    gm = float(element.transconductance) if gain is None else float(gain)
    control_a = element.control_a if control is None else control[0]
    control_b = element.control_b if control is None else control[1]
    ai = sink.node(element.a)
    bi = sink.node(element.b)
    ci = sink.node(control_a)
    di = sink.node(control_b)
    if ci is not None:
        if ai is not None:
            sink.add_A(ai, ci, gm)
        if bi is not None:
            sink.add_A(bi, ci, -gm)
    if di is not None:
        if ai is not None:
            sink.add_A(ai, di, -gm)
        if bi is not None:
            sink.add_A(bi, di, gm)


def stamp_isource(element: Any, sink: StampSink) -> None:
    if sink.mode == "static":
        # 独立电流源只进 B 向量，静态 A/E 装配不涉及。
        return
    sink.add_current(
        element.a, element.b, element.value * getattr(element, "source_scale", 1.0)
    )


def stamp_element_static(
    element: Any,
    sink: StampSink,
    *,
    bridge_control: tuple[str, str | None] | None = None,
    bridge_gain: float = 1.0,
) -> None:
    """descriptor 静态装配的总分派：单一入口取代此前的 9 路 kind 特判。"""
    kind = element.kind
    if kind in ("resistor", "switch"):
        stamp_resistor(element, sink)
    elif kind == "capacitor":
        stamp_capacitor(element, sink)
    elif kind == "inductor":
        stamp_inductor_static(element, sink)
    elif kind == "sensor":
        stamp_sensor(element, sink)
    elif kind in ("vsource", "actuator"):
        stamp_vsource(element, sink, control=bridge_control, gain=bridge_gain)
    elif kind == "vcvs":
        stamp_vcvs(element, sink)
    elif kind == "vccs":
        stamp_vccs(element, sink)
    elif kind == "isource":
        stamp_isource(element, sink)
    elif kind == "actuator_i":
        # 跨域受控电流源：descriptor 按 VCCS 处理，控制端由 bridge_control 给出。
        if bridge_control is not None:
            stamp_vccs(element, sink, control=bridge_control, gain=bridge_gain)
    else:
        # 其余 kind（diode/zener/led/bjt/mosfet/opamp/comparator/dff 等）不向静态
        # A/E 贡献线性项：非线性器件的增量电导由 _apply_operating_point 在工作点
        # 处叠加，这里保持与旧 _assemble_matrices 一致的"跳过"语义。
        return None
