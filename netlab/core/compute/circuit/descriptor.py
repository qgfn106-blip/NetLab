"""线性 RLC 电路的独立连续时间描述符（Descriptor）模型。

本模块不依赖 :class:`~netlab.core.compute.circuit.solver.CircuitSolver` 的 AC
路径，直接装配描述符形式::

    E ẋ + A x = B u
    y = C x + D u

其中状态 ``x`` 由非接地节点电压与独立电感、独立电压源、VCVS 的支路电流组成。
频域响应通过求解 ``(A + jωE) X = B`` 得到，不显式求逆。

支持元件：电阻、电容、电感、独立电压源、独立电流源、VCVS、VCCS 与固定状态
开关。二极管、运放、三极管等非线性元件会显式抛出 :class:`ComputeError`，
不做静默线性化降级。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Iterable, Sequence

import numpy as np

from ...common.limits import ComputeError, ConflictError, ValidationError
from .elements import CircuitElement
from .stamps import CircuitNode

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
        self.inductor_index: dict[str, int] = {}
        self.vsource_index: dict[str, int] = {}
        self.vcvs_index: dict[str, int] = {}
        ordered_branches: list[CircuitElement] = []
        position = self.node_count
        for group, target in (
            (inductors, self.inductor_index),
            (voltage_sources, self.vsource_index),
            (vcvs, self.vcvs_index),
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
    """线性 RLC 电路的独立连续时间描述符模型。

    用法::

        model = DescriptorModel(nodes, elements)
        data = model.frequency_response([100, 1000], input_source="V1", probes=["out"])

    也可以从现有求解器/场景构造::

        model = DescriptorModel.from_solver(scene.ensure_engine().solver)
    """

    def __init__(
        self,
        nodes: Sequence[CircuitNode],
        elements: Sequence[CircuitElement],
    ) -> None:
        self.nodes = list(nodes)
        self.elements = list(elements)
        self._validate_elements(self.elements)
        self.index = DescriptorIndex(self.nodes, self.elements)
        self.A, self.E = self._assemble_matrices()

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

    @classmethod
    def from_solver(cls, solver: Any) -> "DescriptorModel":
        """从 ``CircuitSolver``（或任何带 ``nodes``/``elements`` 的对象）构造。"""
        nodes = getattr(solver, "nodes", None)
        elements = getattr(solver, "elements", None)
        if nodes is None or elements is None:
            raise ValidationError("Descriptor 模型需要提供 nodes 与 elements")
        return cls(nodes, elements)

    @classmethod
    def from_scene(cls, scene: Any) -> "DescriptorModel":
        """从电路 ``Scene`` 构造（仅电路模式）。"""
        engine = scene.ensure_engine()
        solver = getattr(engine, "solver", None)
        if solver is None:
            raise ValidationError("Descriptor 模型仅支持电路模式")
        return cls.from_solver(solver)

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
