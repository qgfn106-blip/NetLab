"""电路的小信号描述符（Descriptor）模型。

本模块不依赖 :class:`~netlab.core.compute.circuit.solver.CircuitSolver` 的 AC
路径，直接装配描述符形式::

    E ẋ + A x = B u
    y = C x + D u

其中状态 ``x`` 由非接地节点电压与独立电感、独立电压源、VCVS、运放/比较器的
支路电流组成。频域响应通过求解 ``(A + jωE) X = B`` 得到，不显式求逆。

支持元件：电阻、电容、电感、独立电压源、独立电流源、VCVS、VCCS 与固定状态
开关。二极管（含齐纳/LED）、BJT、MOSFET、运放/比较器可在给定直流工作点通过
``operating_point``/``linearize`` 入口按各自解析小信号模型线性化；未给出工作
点时仍显式抛出 :class:`ComputeError`，不做静默线性化降级。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Iterable, Sequence

import numpy as np

from ...common.limits import ComputeError, ConflictError, ValidationError
from .elements import CircuitElement
from .stamps import CircuitNode, StampContext
from ..waveform import waveform_value

#: 本模型支持装配的线性元件种类。
SUPPORTED_KINDS = frozenset(
    {
        "resistor",
        "capacitor",
        "inductor",
        "vsource",
        "isource",
        "vcvs",
        "vccs",
        "switch",
    }
)

#: 仅用于错误提示归类的已知非线性器件。
NONLINEAR_KINDS = frozenset(
    {
        "diode",
        "zener",
        "led",
        "opamp",
        "comparator",
        "transistor",
        "npn",
        "pnp",
        "nmos",
        "pmos",
        "jfet",
    }
)

#: 可在给定直流工作点处线性化的非线性器件（使用各自已有的解析小信号模型）。
LINEARIZABLE_NONLINEAR_KINDS = frozenset(
    {
        "diode",
        "zener",
        "led",
        "opamp",
        "comparator",
        "npn",
        "pnp",
        "nmos",
        "pmos",
    }
)

_EPS = float(np.finfo(float).eps)


class DescriptorIndex:
    """Descriptor 未知量索引。

    未知量排列顺序固定为：

    1. 非接地节点电压（按节点物理 id 排序，保证可复现）；
    2. 独立电感支路电流（按元件列表顺序）；
    3. 独立电压源支路电流（按元件列表顺序）；
    4. VCVS 支路电流（按元件列表顺序）。

    与 ``CircuitSolver._build_index`` 不同，电感在这里总是拥有独立支路电流，
    因为它承担 ``v = L di/dt`` 的动态方程。
    """

    __slots__ = (
        "ground",
        "node_ids",
        "node_index",
        "branch_names",
        "branch_index",
        "inductor_index",
        "vsource_index",
        "vcvs_index",
        "opamp_index",
        "element_by_name",
        "node_by_id",
        "node_name_to_id",
        "size",
        "node_count",
        "branch_count",
    )

    def __init__(
        self,
        nodes: Sequence[CircuitNode],
        elements: Sequence[CircuitElement],
    ) -> None:
        if not nodes:
            raise ConflictError("电路中没有节点")

        ground_nodes = [node for node in nodes if node.ground]
        if not ground_nodes:
            raise ComputeError("电路需要至少一个接地节点（把某个节点设为 ground）")
        if len(ground_nodes) > 1:
            raise ComputeError("电路只能有一个接地节点")

        self.ground = ground_nodes[0].id
        node_ids = {node.id for node in nodes}
        unknown: list[str] = [node.id for node in nodes if not node.ground]

        # 兼容带内部节点的器件；当前支持的线性元件均无内部节点。
        internal: list[str] = []
        for element in elements:
            for node_id in getattr(element, "internal_nodes", ()):
                if node_id in node_ids or node_id in internal:
                    raise ComputeError(f"内部节点 id 冲突：{node_id!r}")
                internal.append(node_id)
        unknown.extend(internal)

        valid_ids = node_ids | set(internal)
        for element in elements:
            for node_id in (element.a, element.b):
                if node_id not in valid_ids:
                    raise ComputeError(
                        f"元件 {element.name!r} 连接到了不存在的节点 {node_id!r}"
                    )
            for attribute in ("control_a", "control_b"):
                control = getattr(element, attribute, None)
                if control and control not in valid_ids:
                    raise ComputeError(
                        f"元件 {element.name!r} 的控制节点不存在 {control!r}"
                    )

        unknown.sort()
        self.node_ids = tuple(unknown)
        self.node_index = {
            node_id: position for position, node_id in enumerate(self.node_ids)
        }
        self.node_count = len(self.node_ids)

        self.node_by_id = {node.id: node for node in nodes}
        self.node_name_to_id: dict[str, str] = {}
        for node in nodes:
            if node.ground:
                continue
            name = str(node.name)
            if name and name not in self.node_name_to_id:
                self.node_name_to_id[name] = node.id

        names = [element.name for element in elements]
        if len(names) != len(set(names)):
            duplicates = sorted({name for name in names if names.count(name) > 1})
            raise ComputeError(f"元件名称重复：{'、'.join(duplicates[:3])}")
        self.element_by_name = {element.name: element for element in elements}

        inductors = [element for element in elements if element.kind == "inductor"]
        voltage_sources = [
            element for element in elements if element.kind == "vsource"
        ]
        vcvs = [element for element in elements if element.kind == "vcvs"]
        opamps = [
            element
            for element in elements
            if element.kind in ("opamp", "comparator")
        ]
        self.inductor_index: dict[str, int] = {}
        self.vsource_index: dict[str, int] = {}
        self.vcvs_index: dict[str, int] = {}
        self.opamp_index: dict[str, int] = {}
        ordered_branches: list[CircuitElement] = []
        position = self.node_count
        for group, target in (
            (inductors, self.inductor_index),
            (voltage_sources, self.vsource_index),
            (vcvs, self.vcvs_index),
            (opamps, self.opamp_index),
        ):
            for element in group:
                if element.a == element.b:
                    raise ComputeError(
                        f"元件 {element.name!r} 两端连接到同一节点，无法建立支路方程"
                    )
                if element.a == self.ground and element.b == self.ground:
                    raise ComputeError(f"电压源 {element.name!r} 两端都接地，电路不合法")
                target[element.name] = position
                ordered_branches.append(element)
                position += 1

        self.branch_names = tuple(element.name for element in ordered_branches)
        self.branch_count = len(ordered_branches)
        self.branch_index = {
            name: self.node_count + offset
            for offset, name in enumerate(self.branch_names)
        }
        self.size = self.node_count + self.branch_count
        if self.size == 0:
            raise ComputeError("电路没有可求解的未知量")

    def position(self, name: str) -> int:
        """按节点 id 或支路元件名取矩阵位置，找不到返回 ``-1``。"""
        if name in self.node_index:
            return self.node_index[name]
        return self.branch_index.get(name, -1)


@dataclass(frozen=True)
class DescriptorSystem:
    """一次装配好的描述符系统（单位输入激励）。"""

    A: np.ndarray
    E: np.ndarray
    B: np.ndarray
    index: DescriptorIndex
    input_source: str

    @property
    def size(self) -> int:
        return int(self.A.shape[0])

    def matrix(self, omega: float) -> np.ndarray:
        """返回频域矩阵 ``A + jωE``。"""
        return self.A + 1j * float(omega) * self.E

    def solve(self, omega: float) -> np.ndarray:
        """求解 ``(A + jωE) X = B``。"""
        return np.linalg.solve(self.matrix(omega), self.B)

    def residual(self, omega: float) -> float:
        """返回归一化矩阵残差，用于数值健康检查。"""
        matrix = self.matrix(omega)
        solution = np.linalg.solve(matrix, self.B)
        numerator = float(np.linalg.norm(matrix @ solution - self.B))
        denominator = (
            float(np.linalg.norm(matrix)) * float(np.linalg.norm(solution))
            + float(np.linalg.norm(self.B))
            + _EPS
        )
        return numerator / denominator


class DescriptorModel:
    """电路的小信号描述符模型（线性 RLC，或给定工作点上的非线性器件）。

    用法::

        model = DescriptorModel(nodes, elements)
        data = model.frequency_response([100, 1000], input_source="V1", probes=["out"])

    非线性器件需要提供直流工作点，例如::

        model = DescriptorModel.from_scene(scene, operating_point=op)
        # 或者手动调用 model.linearize(op)

    也可以从现有求解器/场景构造::

        model = DescriptorModel.from_solver(scene.ensure_engine().solver)
    """

    def __init__(
        self,
        nodes: Sequence[CircuitNode],
        elements: Sequence[CircuitElement],
        operating_point: dict[str, Any] | None = None,
    ) -> None:
        self.nodes = list(nodes)
        self.elements = list(elements)
        if operating_point is not None and not isinstance(operating_point, dict):
            raise ValidationError("工作点必须是字典")
        if operating_point is None:
            self._validate_elements(self.elements)
        else:
            self._validate_linearizable_elements(self.elements)
        self.index = DescriptorIndex(self.nodes, self.elements)
        self.A, self.E = self._assemble_matrices()
        if operating_point is not None:
            self._apply_operating_point(operating_point)

    def linearize(self, operating_point: dict[str, Any]) -> "DescriptorModel":
        """按给定直流工作点重新线性化本模型并返回自身。

        ``operating_point`` 可以是 :meth:`CircuitSolver.operating_point` 返回的
        字典（含 ``node_voltages`` 子字典），也可以是 ``{节点 id 或节点名: 电压}``
        的直接映射。
        """
        if not isinstance(operating_point, dict):
            raise ValidationError("工作点必须是字典")
        self._validate_linearizable_elements(self.elements)
        self.index = DescriptorIndex(self.nodes, self.elements)
        self.A, self.E = self._assemble_matrices()
        self._apply_operating_point(operating_point)
        return self

    # ---- 构造辅助 ---------------------------------------------------------
    @staticmethod
    def _validate_elements(elements: Sequence[CircuitElement]) -> None:
        nonlinear: list[CircuitElement] = []
        unsupported: list[CircuitElement] = []
        for element in elements:
            if getattr(element, "nonlinear", False) or element.kind in NONLINEAR_KINDS:
                nonlinear.append(element)
            elif element.kind not in SUPPORTED_KINDS:
                unsupported.append(element)
        if nonlinear:
            names = "、".join(element.name for element in nonlinear[:3])
            raise ComputeError(
                f"Descriptor 模型不支持非线性元件 {names!r}"
                f"（{nonlinear[0].kind}）：请先线性化或改用瞬态分析"
            )
        if unsupported:
            names = "、".join(element.name for element in unsupported[:3])
            raise ComputeError(
                f"Descriptor 模型暂不支持元件 {names!r}（{unsupported[0].kind}）："
                "仅支持线性 R/C/L、独立源、VCVS/VCCS 与固定状态开关"
            )

    @staticmethod
    def _validate_linearizable_elements(elements: Sequence[CircuitElement]) -> None:
        """校验元素集合能否在工作点处线性化。"""
        unsupported: list[CircuitElement] = []
        for element in elements:
            if element.kind in SUPPORTED_KINDS:
                continue
            if element.kind in LINEARIZABLE_NONLINEAR_KINDS:
                continue
            unsupported.append(element)
        if unsupported:
            names = "、".join(element.name for element in unsupported[:3])
            raise ComputeError(
                f"Descriptor 模型无法线性化元件 {names!r}"
                f"（{unsupported[0].kind}）：仅支持 R/C/L、独立源、VCVS/VCCS、"
                "固定状态开关以及二极管、BJT、MOSFET、运放"
            )

    @classmethod
    def from_solver(
        cls,
        solver: Any,
        operating_point: dict[str, Any] | None = None,
    ) -> "DescriptorModel":
        """从 ``CircuitSolver``（或任何带 ``nodes``/``elements`` 的对象）构造。

        给出 ``operating_point`` 时按该直流工作点线性化非线性器件；否则要求
        全部元件均为线性元件（保持原有行为）。
        """
        nodes = getattr(solver, "nodes", None)
        elements = getattr(solver, "elements", None)
        if nodes is None or elements is None:
            raise ValidationError("Descriptor 模型需要提供 nodes 与 elements")
        return cls(nodes, elements, operating_point=operating_point)

    @classmethod
    def from_scene(
        cls,
        scene: Any,
        operating_point: dict[str, Any] | None = None,
    ) -> "DescriptorModel":
        """从电路 ``Scene`` 构造（仅电路模式）。

        给出 ``operating_point`` 时按该直流工作点线性化非线性器件。
        """
        engine = scene.ensure_engine()
        solver = getattr(engine, "solver", None)
        if solver is None:
            raise ValidationError("Descriptor 模型仅支持电路模式")
        return cls.from_solver(solver, operating_point=operating_point)

    @classmethod
    def from_operating_point(
        cls,
        nodes: Sequence[CircuitNode],
        elements: Sequence[CircuitElement],
        operating_point: dict[str, Any],
    ) -> "DescriptorModel":
        """在给定直流工作点处线性化并构造 Descriptor 模型。

        ``operating_point`` 支持两种形式：

        * :meth:`CircuitSolver.operating_point` 的返回字典（含 ``node_voltages``）；
        * 直接给出 ``{节点 id 或节点名: 直流电压}``。

        二极管（含串联电阻内部节点）、BJT、MOSFET 与运放分别复用各自已有的
        解析导数/工作点模型；线性元件与独立源按原有方式装配。
        """
        if not isinstance(operating_point, dict):
            raise ValidationError("工作点必须是字典")
        return cls(nodes, elements, operating_point=operating_point)

    def dc_solution(self) -> dict[str, Any]:
        """求解直流工作点 ``A x = B``（电感理想短路、电容开路）。

        与瞬态求解器的 ``operating_point()`` 不同，电感由独立支路电流和
        ``v_L = 0`` 约束表达，不使用 ``DC_CONDUCTANCE`` 有限电导近似。
        """
        rhs = np.zeros(self.index.size, dtype=float)
        for element in self.elements:
            value = float(waveform_value(element.params, 0.0))
            if element.kind == "vsource":
                rhs[self.index.vsource_index[element.name]] += value
            elif element.kind == "isource":
                ai = self.index.node_index.get(element.a)
                bi = self.index.node_index.get(element.b)
                if ai is not None:
                    rhs[ai] -= value
                if bi is not None:
                    rhs[bi] += value
        solution = np.linalg.solve(self.A, rhs)
        denominator = float(np.linalg.norm(self.A)) * float(np.linalg.norm(solution)) + float(np.linalg.norm(rhs)) + _EPS
        residual = float(np.linalg.norm(self.A @ solution - rhs)) / denominator
        node_voltages = {node_id: float(solution[position]) for node_id, position in self.index.node_index.items()}
        branch_currents = {
            name: float(solution[position])
            for name, position in (
                list(self.index.inductor_index.items())
                + list(self.index.vsource_index.items())
                + list(self.index.vcvs_index.items())
            )
        }
        return {
            "solution": solution,
            "node_voltages": node_voltages,
            "branch_currents": branch_currents,
            "residual": residual,
        }

    # ---- 矩阵装配 ---------------------------------------------------------
    def _assemble_matrices(self) -> tuple[np.ndarray, np.ndarray]:
        """装配不随频率变化的 A、E 矩阵。"""
        size = self.index.size
        A = np.zeros((size, size), dtype=float)
        E = np.zeros((size, size), dtype=float)
        index = self.index

        def stamp_conductance(a: str, b: str, conductance: float) -> None:
            g = float(conductance)
            ai = index.node_index.get(a)
            bi = index.node_index.get(b)
            if ai is not None:
                A[ai, ai] += g
            if bi is not None:
                A[bi, bi] += g
            if ai is not None and bi is not None:
                A[ai, bi] -= g
                A[bi, ai] -= g

        for element in self.elements:
            kind = element.kind
            if kind == "resistor":
                stamp_conductance(element.a, element.b, element.conductance)
            elif kind == "switch":
                stamp_conductance(element.a, element.b, element.conductance)
            elif kind == "capacitor":
                capacitance = float(element.capacitance)
                ai = index.node_index.get(element.a)
                bi = index.node_index.get(element.b)
                if ai is not None:
                    E[ai, ai] += capacitance
                if bi is not None:
                    E[bi, bi] += capacitance
                if ai is not None and bi is not None:
                    E[ai, bi] -= capacitance
                    E[bi, ai] -= capacitance
            elif kind == "inductor":
                row = index.branch_index[element.name]
                ai = index.node_index.get(element.a)
                bi = index.node_index.get(element.b)
                # KCL：电感电流从 a 流向 b。
                if ai is not None:
                    A[ai, row] += 1.0
                if bi is not None:
                    A[bi, row] -= 1.0
                # 电感方程：v_a - v_b - L di/dt = 0。
                if ai is not None:
                    A[row, ai] += 1.0
                if bi is not None:
                    A[row, bi] -= 1.0
                E[row, row] -= float(element.inductance)
            elif kind == "vsource":
                row = index.branch_index[element.name]
                ai = index.node_index.get(element.a)
                bi = index.node_index.get(element.b)
                if ai is not None:
                    A[ai, row] += 1.0
                    A[row, ai] += 1.0
                if bi is not None:
                    A[bi, row] -= 1.0
                    A[row, bi] -= 1.0
            elif kind == "vcvs":
                row = index.branch_index[element.name]
                ai = index.node_index.get(element.a)
                bi = index.node_index.get(element.b)
                if ai is not None:
                    A[ai, row] += 1.0
                    A[row, ai] += 1.0
                if bi is not None:
                    A[bi, row] -= 1.0
                    A[row, bi] -= 1.0
                ci = index.node_index.get(element.control_a)
                di = index.node_index.get(element.control_b)
                if ci is not None:
                    A[row, ci] -= float(element.gain)
                if di is not None:
                    A[row, di] += float(element.gain)
            elif kind == "vccs":
                gm = float(element.transconductance)
                ai = index.node_index.get(element.a)
                bi = index.node_index.get(element.b)
                ci = index.node_index.get(element.control_a)
                di = index.node_index.get(element.control_b)
                if ai is not None and ci is not None:
                    A[ai, ci] += gm
                if ai is not None and di is not None:
                    A[ai, di] -= gm
                if bi is not None and ci is not None:
                    A[bi, ci] -= gm
                if bi is not None and di is not None:
                    A[bi, di] += gm
            elif kind == "isource":
                # 独立电流源只进入 B 向量，不改变 A/E。
                continue
        return A, E

    # ---- 工作点线性化 -----------------------------------------------------
    def _apply_operating_point(self, operating_point: dict[str, Any]) -> None:
        """把各非线性器件在当前直流工作点的解析 Jacobian 叠加到 A 矩阵。

        小信号 AC 分析只需要增量电导/跨导，不需要直流偏置电流，因此不向
        ``rhs`` 写入任何 offset。
        """
        voltages = self._operating_point_voltages(operating_point)
        index = self.index
        A = self.A

        def node_voltage(node_id: str) -> float:
            if node_id not in index.node_index:
                return 0.0
            return voltages.get(node_id, 0.0)

        def stamp_conductance(a: str, b: str, conductance: float) -> None:
            g = float(conductance)
            ai = index.node_index.get(a)
            bi = index.node_index.get(b)
            if ai is not None:
                A[ai, ai] += g
            if bi is not None:
                A[bi, bi] += g
            if ai is not None and bi is not None:
                A[ai, bi] -= g
                A[bi, ai] -= g

        for element in self.elements:
            # 二极管（含 Zener/LED）的解析小信号电导；串联电阻形成内部节点时
            # 先串联 1/rs，再在结节点与阴极之间 stamp gd。
            if element.kind in ("diode", "zener", "led") and hasattr(
                element, "_conductance"
            ):
                junction = getattr(element, "junction", element.a)
                series = float(getattr(element, "series_resistance", 0.0) or 0.0)
                if junction not in voltages:
                    terminal = node_voltage(element.a) - node_voltage(element.b)
                    if series > 0.0:
                        junction_voltage = self._solve_series_diode_voltage(
                            element, terminal
                        )
                        voltages[junction] = (
                            node_voltage(element.b) + junction_voltage
                        )
                    else:
                        voltages[junction] = node_voltage(element.a)
                vd = node_voltage(junction) - node_voltage(element.b)
                _, conductance = element._conductance(vd)
                if series > 0.0:
                    stamp_conductance(element.a, junction, 1.0 / series)
                stamp_conductance(junction, element.b, float(conductance))
                continue

            # BJT/MOSFET：直接调用其自身 stamp —— 其中 A 矩阵部分正是非线性
            # 电流对节点电压的解析 Jacobian，rhs 只是直流偏置项，这里丢弃。
            if element.kind in ("npn", "pnp", "nmos", "pmos"):
                context = self._linearization_context(voltages)
                element.stamp(context)
                continue

            # 运放/比较器：输出支路在现有模型中是受控电压源，工作点处取
            # value + slope * (u - u0)，小信号方程只保留 slope。
            if element.kind in ("opamp", "comparator"):
                self._linearize_opamp(element, node_voltage)
                continue

    def _linearization_context(self, voltages: dict[str, float]) -> StampContext:
        solution = np.zeros(self.index.size, dtype=float)
        for node_id, position in self.index.node_index.items():
            solution[position] = voltages.get(node_id, 0.0)
        return StampContext(
            A=self.A,
            rhs=np.zeros(self.index.size, dtype=float),
            index=self.index.node_index,
            solution=solution,
            dt=0.0,
            time=0.0,
            iteration=0,
            mode="dc",
            omega=0.0,
        )

    def _linearize_opamp(
        self,
        element: CircuitElement,
        node_voltage: Any,
    ) -> None:
        index = self.index
        A = self.A
        row = index.opamp_index[element.name]
        for node, sign in ((element.a, 1.0), (element.b, -1.0)):
            position = index.node_index.get(node)
            if position is not None:
                A[position, row] += sign
                A[row, position] += sign
        context = self._linearization_context(
            {node_id: node_voltage(node_id) for node_id in index.node_ids}
        )
        u = node_voltage(element.vp) - node_voltage(element.vn)
        _, slope = element._evaluate(context, u)
        slope = float(slope)
        if not math.isfinite(slope):
            raise ComputeError(f"运放 {element.name!r} 的工作点跨导不是有限数")
        vp = index.node_index.get(element.vp)
        vn = index.node_index.get(element.vn)
        if vp is not None:
            A[row, vp] -= slope
        if vn is not None:
            A[row, vn] += slope

    def _operating_point_voltages(
        self, operating_point: dict[str, Any]
    ) -> dict[str, float]:
        """把工作点归一化为 ``{节点 id: 电压}``，同时兼容节点名键。"""
        raw = (
            operating_point["node_voltages"]
            if "node_voltages" in operating_point
            else operating_point
        )
        if not isinstance(raw, dict):
            raise ValidationError("工作点的 node_voltages 必须是字典")

        name_to_id: dict[str, str] = {}
        for node in self.nodes:
            name = str(node.name)
            if name and name not in name_to_id:
                name_to_id[name] = node.id

        voltages: dict[str, float] = {}
        for key, value in raw.items():
            try:
                voltage = float(value)
            except (TypeError, ValueError) as error:
                raise ValidationError(f"工作点电压不是数值：{key!r}") from error
            if not math.isfinite(voltage):
                raise ValidationError(f"工作点电压不是有限数：{key!r}")
            text = str(key)
            if text in self.index.node_index:
                voltages[text] = voltage
                continue
            node_id = name_to_id.get(text)
            if node_id is not None and node_id in self.index.node_index:
                voltages[node_id] = voltage

        internal_ids = {
            node_id
            for element in self.elements
            for node_id in getattr(element, "internal_nodes", ())
        }
        missing = [
            node_id
            for node_id in self.index.node_ids
            if node_id not in internal_ids and node_id not in voltages
        ]
        if missing:
            raise ComputeError(f"工作点缺少节点电压：{missing[0]!r}")
        return voltages

    @staticmethod
    def _solve_series_diode_voltage(
        element: CircuitElement, terminal_voltage: float
    ) -> float:
        """没有给出内部节点电压时，由串联电阻方程解出结电压。"""
        series = float(getattr(element, "series_resistance", 0.0) or 0.0)
        vd = min(float(terminal_voltage), 0.7)
        for _ in range(100):
            current, conductance = element._conductance(vd)
            residual = vd + series * current - terminal_voltage
            derivative = 1.0 + series * conductance
            step = residual / derivative
            vd -= step
            if abs(step) <= 1e-13 * (1.0 + abs(vd)):
                break
        return vd

    # ---- 输入 -------------------------------------------------------------
    def _resolve_input_source(self, input_source: str | None) -> CircuitElement:
        sources = [
            element
            for element in self.elements
            if element.kind in ("vsource", "isource")
        ]
        if not sources:
            raise ComputeError("AC 分析需要至少一个独立源作为激励")
        if input_source is None:
            return sources[0]
        key = str(input_source)
        for element in sources:
            if element.name == key:
                return element
        raise ComputeError(f"AC 分析找不到激励源 {input_source!r}")

    def _build_input_vector(self, input_element: CircuitElement) -> np.ndarray:
        vector = np.zeros(self.index.size, dtype=float)
        if input_element.kind == "vsource":
            vector[self.index.branch_index[input_element.name]] = 1.0
        elif input_element.kind == "isource":
            ai = self.index.node_index.get(input_element.a)
            bi = self.index.node_index.get(input_element.b)
            if ai is not None:
                vector[ai] -= 1.0
            if bi is not None:
                vector[bi] += 1.0
        return vector

    def build(self, input_source: str | None = None) -> DescriptorSystem:
        """装配指定输入源为单位激励时的完整描述符系统。"""
        input_element = self._resolve_input_source(input_source)
        return DescriptorSystem(
            A=self.A.copy(),
            E=self.E.copy(),
            B=self._build_input_vector(input_element),
            index=self.index,
            input_source=input_element.name,
        )

    # ---- 探针 -------------------------------------------------------------
    def _default_probe_tokens(self) -> list[str]:
        tokens = [node_id for node_id in self.index.node_ids]
        tokens.extend(
            element.name
            for element in self.elements
            if element.kind in ("resistor", "capacitor", "inductor", "vsource", "isource")
        )
        return tokens

    def _resolve_probes(
        self, probes: Sequence[str] | None
    ) -> list[tuple[str, tuple[str, object]]]:
        if probes:
            tokens = [str(token) for token in probes]
        else:
            tokens = self._default_probe_tokens()

        resolved: list[tuple[str, tuple[str, object]]] = []
        for token in tokens:
            node_id = token if token in self.index.node_index else None
            if node_id is None:
                node_id = self.index.node_name_to_id.get(token)
            if node_id is not None:
                resolved.append((token, ("node", node_id)))
                continue
            element = self.index.element_by_name.get(token)
            if element is not None:
                resolved.append((token, ("element", element)))
                continue
            raise ComputeError(f"AC 探针不存在：{token!r}")
        return resolved

    def _probe_value(
        self,
        probe: tuple[str, object],
        solution: np.ndarray,
        omega: float,
        input_name: str,
    ) -> complex:
        kind, target = probe
        if kind == "node":
            return complex(solution[self.index.node_index[str(target)]])

        element = target
        assert isinstance(element, CircuitElement)
        index = self.index

        def node_voltage(node_id: str) -> complex:
            position = index.node_index.get(node_id)
            return complex(solution[position]) if position is not None else 0j

        va = node_voltage(element.a)
        vb = node_voltage(element.b)
        difference = va - vb
        if element.kind == "resistor":
            return difference * float(element.conductance)
        if element.kind == "capacitor":
            return 1j * omega * float(element.capacitance) * difference
        if element.kind == "inductor":
            return complex(solution[index.branch_index[element.name]])
        if element.kind == "vsource":
            return complex(solution[index.branch_index[element.name]])
        if element.kind == "isource":
            return 1.0 + 0j if element.name == input_name else 0j
        if element.kind == "vcvs":
            return complex(solution[index.branch_index[element.name]])
        if element.kind == "vccs":
            gm = float(element.transconductance)
            return gm * (node_voltage(element.control_a) - node_voltage(element.control_b))
        if element.kind == "switch":
            return difference * float(element.conductance)
        raise ComputeError(f"AC 探针 {element.name!r} 的元件类型不支持：{element.kind!r}")

    # ---- 频域响应 ---------------------------------------------------------
    @staticmethod
    def _validate_frequencies(frequencies: Iterable[float]) -> list[float]:
        values = [float(frequency) for frequency in frequencies]
        if not values:
            raise ValidationError("AC 扫频至少需要一个频率点")
        if any(not math.isfinite(value) or value <= 0.0 for value in values):
            raise ValidationError("AC 频率必须为正的有限数")
        if any(values[position] >= values[position + 1] for position in range(len(values) - 1)):
            raise ValidationError("AC 频率必须严格递增")
        return values

    def frequency_response(
        self,
        frequencies: Iterable[float],
        input_source: str | None = None,
        probes: Sequence[str] | None = None,
    ) -> dict[str, Any]:
        """返回与 ``CircuitSolver.ac_sweep`` 兼容的 Bode 数据。

        频率单位为 Hz；内部使用 ``ω = 2πf``。选中独立源取单位激励（1 V / 1 A），
        其余独立源置零。返回 ``frequencies``、``omega_rad_s``（同时提供别名
        ``omega``）、``input`` 与 ``probes``；每个探针含
        ``real/imag/magnitude/phase_deg/db`` 六个长度相同的列表。
        """
        values = self._validate_frequencies(frequencies)
        system = self.build(input_source)
        resolved = self._resolve_probes(probes)
        omegas = [2.0 * math.pi * frequency for frequency in values]

        output: dict[str, Any] = {
            "frequencies": values,
            "omega_rad_s": omegas,
            "omega": list(omegas),
            "input": system.input_source,
            "probes": {},
        }
        chains = {
            token: {
                "real": [],
                "imag": [],
                "magnitude": [],
                "phase_deg": [],
                "db": [],
            }
            for token, _ in resolved
        }
        for token in chains:
            output["probes"][token] = chains[token]

        for omega in omegas:
            solution = system.solve(omega)
            for token, probe in resolved:
                value = self._probe_value(probe, solution, omega, system.input_source)
                magnitude = abs(value)
                chain = chains[token]
                chain["real"].append(float(value.real))
                chain["imag"].append(float(value.imag))
                chain["magnitude"].append(float(magnitude))
                chain["phase_deg"].append(
                    math.degrees(math.atan2(value.imag, value.real))
                )
                chain["db"].append(20.0 * math.log10(max(magnitude, 1.0e-30)))
        return output

    def __repr__(self) -> str:  # pragma: no cover - 调试辅助
        return (
            f"DescriptorModel(nodes={self.index.node_count}, "
            f"branches={self.index.branch_count})"
        )
