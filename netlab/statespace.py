"""连续/离散状态空间模型与离散化。

节点计算 ``state_space`` 用它承载现代控制意义上的 x' = Ax + Bu、y = Cx + Du；
离散化方法支持 ZOH、前向欧拉、后向欧拉与双线性（Tustin）。
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from .limits import ComputeError
from .linalg import as_array, cont2discrete
from .params import ParamSpec, choice_param, json_param, list_param, matrix_param

DISCRETIZATION_METHODS: tuple[tuple[str, str], ...] = (
    ("zoh", "零阶保持 ZOH"),
    ("tustin", "双线性 Tustin"),
    ("backward", "后向欧拉"),
    ("forward", "前向欧拉"),
)


def state_space_specs() -> list[ParamSpec]:
    return [
        matrix_param(
            "A",
            "状态矩阵 A",
            [[0.0, 1.0], [-1.0, -1.0]],
            help="n×n，描述状态自身的演化",
        ),
        matrix_param(
            "B", "输入矩阵 B", [[0.0], [1.0]], help="n×m，描述输入如何驱动状态"
        ),
        matrix_param(
            "C", "输出矩阵 C", [[1.0, 0.0]], help="p×n，描述由状态读取输出"
        ),
        matrix_param(
            "D", "直通矩阵 D", [[0.0]], help="p×m，描述输入到输出的直通项"
        ),
        choice_param(
            "method", "离散化方法", "zoh", DISCRETIZATION_METHODS
        ),
        json_param(
            "input_map",
            "输入映射",
            ["in.voltage"],
            help='按顺序列出 m 个输入来源，格式 "连接名.字段名"',
        ),
        json_param(
            "output_map",
            "输出字段",
            ["y0"],
            help="按顺序列出 p 个输出写入节点数据的字段名",
        ),
        list_param("x0", "初始状态", [0.0, 0.0], help="长度必须等于 n"),
    ]


@dataclass
class StateSpaceModel:
    a: np.ndarray
    b: np.ndarray
    c: np.ndarray
    d: np.ndarray
    input_map: list[str]
    output_map: list[str]
    method: str = "zoh"
    x0: np.ndarray = field(default_factory=lambda: np.zeros(1))
    _cache_key: tuple[float, str] | None = field(default=None, repr=False)
    _cache: tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray] | None = field(
        default=None, repr=False
    )

    # ---- 构造 -------------------------------------------------------------
    @classmethod
    def from_params(cls, params: dict[str, Any]) -> "StateSpaceModel":
        a = as_array(params.get("A"), "A 矩阵")
        b = as_array(params.get("B"), "B 矩阵")
        c = as_array(params.get("C"), "C 矩阵")
        d = as_array(params.get("D"), "D 矩阵", max_size=12)
        n = a.shape[0]
        if a.shape != (n, n):
            raise ComputeError("A 矩阵必须是方阵")
        if b.ndim != 2 or b.shape[0] != n:
            raise ComputeError("B 矩阵行数必须等于状态维数 n")
        m = b.shape[1]
        if c.ndim != 2 or c.shape[1] != n:
            raise ComputeError("C 矩阵列数必须等于状态维数 n")
        p = c.shape[0]
        if d.shape != (p, m):
            raise ComputeError("D 矩阵形状必须是 p×m，与 C、B 匹配")
        if m > 6 or p > 6:
            raise ComputeError("输入/输出维数不能超过 6")
        if np.max(np.abs(np.concatenate([a.ravel(), b.ravel(), c.ravel(), d.ravel()]))) > 1.0e9:
            raise ComputeError("状态空间矩阵数值过大，请先做归一化")

        method = str(params.get("method", "zoh"))
        if method not in {item[0] for item in DISCRETIZATION_METHODS}:
            raise ComputeError(f"未知离散化方法：{method!r}")

        input_map = params.get("input_map") or []
        output_map = params.get("output_map") or []
        if not isinstance(input_map, list) or len(input_map) != m:
            raise ComputeError(f"输入映射必须包含 {m} 项")
        if not all(isinstance(item, str) and item.strip() for item in input_map):
            raise ComputeError("输入映射的每一项都必须是非空字符串")
        if not isinstance(output_map, list) or len(output_map) != p:
            raise ComputeError(f"输出字段必须包含 {p} 项")
        if not all(isinstance(item, str) and item.strip() for item in output_map):
            raise ComputeError("输出字段的每一项都必须是非空字符串")

        x0 = np.asarray(params.get("x0") or [0.0] * n, dtype=float).ravel()
        if x0.size != n:
            raise ComputeError(f"初始状态长度必须为 {n}")
        if not np.all(np.isfinite(x0)):
            raise ComputeError("初始状态含有非有限数值")

        return cls(
            a=a.copy(),
            b=b.copy(),
            c=c.copy(),
            d=d.copy(),
            input_map=[item.strip() for item in input_map],
            output_map=[item.strip() for item in output_map],
            method=method,
            x0=x0.copy(),
        )

    # ---- 离散化与推进 -----------------------------------------------------
    def discretized(
        self, dt: float
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        if not math.isfinite(dt) or dt <= 0:
            raise ComputeError("dt 必须为正数")
        key = (float(dt), self.method)
        if self._cache_key != key or self._cache is None:
            self._cache = cont2discrete(
                self.a, self.b, self.c, self.d, dt, self.method
            )
            self._cache_key = key
        return self._cache

    def resolve_inputs(self, inputs: dict[str, dict[str, Any]]) -> np.ndarray:
        values: list[float] = []
        for spec in self.input_map:
            if "." in spec:
                connection, field_name = spec.split(".", 1)
            else:
                connection, field_name = spec, "voltage"
            payload = inputs.get(connection)
            value = 0.0
            if payload is not None and field_name in payload:
                raw = payload[field_name]
                if isinstance(raw, bool) or not isinstance(raw, (int, float)):
                    raise ComputeError(
                        f"输入映射 {spec!r} 指向的不是数值字段"
                    )
                value = float(raw)
            values.append(value)
        return np.asarray(values, dtype=float)

    def state_from(self, state: dict[str, Any]) -> np.ndarray:
        stored = state.get("x")
        if isinstance(stored, list) and len(stored) == self.x0.size:
            try:
                array = np.asarray(stored, dtype=float)
            except (TypeError, ValueError):
                array = self.x0.copy()
            if array.size == self.x0.size and np.all(np.isfinite(array)):
                return array
        return self.x0.copy()

    def step(
        self, state: dict[str, Any], u: np.ndarray, dt: float
    ) -> tuple[np.ndarray, np.ndarray]:
        ad, bd, cd, dd = self.discretized(dt)
        x = self.state_from(state)
        if u.size != self.b.shape[1]:
            raise ComputeError(
                f"输入维数不匹配：模型需要 {self.b.shape[1]} 个输入"
            )
        y = cd @ x + dd @ u
        x_next = ad @ x + bd @ u
        if not np.all(np.isfinite(x_next)) or not np.all(np.isfinite(y)):
            raise ComputeError("状态空间模型发散了（出现非有限数值）")
        state["x"] = [float(value) for value in x_next]
        return y, x_next

    def describe(self) -> dict[str, Any]:
        ad, _bd, _cd, _dd = self.discretized(1.0) if self._cache is None else self._cache
        return {
            "states": int(self.a.shape[0]),
            "inputs": int(self.b.shape[1]),
            "outputs": int(self.c.shape[0]),
            "method": self.method,
            "spectral_radius": float(
                np.max(np.abs(np.linalg.eigvals(ad)))
            )
            if ad.size
            else 0.0,
        }
