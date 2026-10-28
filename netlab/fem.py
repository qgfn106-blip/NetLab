"""二维有限元瞬态热传导（Q4 双线性单元）。

求解：

    ρc ∂T/∂t = ∇·(k∇T) + q(x,y,t)

- 区域：单位正方形，Q4 结构化网格；
- 时间：后向欧拉（无条件稳定）；
- 边界：左右两端 Dirichlet，上下绝缘；
- 热源：高斯分布、位置随时间摆动，用于观察热扩散与动态响应；
- 线性系统：SciPy 稀疏 LU，一次分解后每步只做回代。

这是真正经过弱形式装配的有限元求解器，而不是有限差分近似：
单元刚度/质量矩阵用 2×2 Gauss 积分在参考单元上计算后装配到全局稀疏矩阵。
"""

from __future__ import annotations

import math
import threading
import time
from array import array
from collections import deque
from dataclasses import asdict, dataclass
from typing import Any

import numpy as np

from .limits import (
    ComputeError,
    ValidationError,
    as_float,
    as_int,
)

try:  # 可选依赖：没有 SciPy 时给出明确的安装提示
    from scipy.sparse import coo_matrix, diags
    from scipy.sparse.linalg import splu

    _HAS_SCIPY = True
except Exception:  # pragma: no cover - 环境相关
    coo_matrix = None  # type: ignore[assignment]
    diags = None  # type: ignore[assignment]
    splu = None  # type: ignore[assignment]
    _HAS_SCIPY = False


MAX_FEM_FRAMES = 900
_FEM_GP = 1.0 / math.sqrt(3.0)
_GAUSS_POINTS = (
    (-_FEM_GP, -_FEM_GP),
    (_FEM_GP, -_FEM_GP),
    (_FEM_GP, _FEM_GP),
    (-_FEM_GP, _FEM_GP),
)


@dataclass
class FemConfig:
    nx: int = 36
    ny: int = 24
    dt: float = 0.002
    fps: int = 30
    steps_per_frame: int = 8
    sample_every: int = 1
    conductivity: float = 1.0
    capacity: float = 1.0
    source_amplitude: float = 5000.0
    source_frequency: float = 0.08
    source_sigma: float = 0.09
    source_x: float = 0.35
    boundary_left: float = 20.0
    boundary_right: float = 20.0
    initial_temperature: float = 20.0


def _shape(xi: float, eta: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Q4 形函数与对参考坐标的导数（节点顺序：左下、右下、右上、左上）。"""
    n = np.array(
        [
            0.25 * (1 - xi) * (1 - eta),
            0.25 * (1 + xi) * (1 - eta),
            0.25 * (1 + xi) * (1 + eta),
            0.25 * (1 - xi) * (1 + eta),
        ]
    )
    dxi = np.array(
        [
            -0.25 * (1 - eta),
            0.25 * (1 - eta),
            0.25 * (1 + eta),
            -0.25 * (1 + eta),
        ]
    )
    deta = np.array(
        [
            -0.25 * (1 - xi),
            -0.25 * (1 + xi),
            0.25 * (1 + xi),
            0.25 * (1 - xi),
        ]
    )
    return n, dxi, deta


@dataclass
class FemMesh:
    nx: int
    ny: int
    x: np.ndarray
    y: np.ndarray
    elements: np.ndarray
    left: np.ndarray
    right: np.ndarray
    revision: int = 1

    @property
    def node_count(self) -> int:
        return int(self.x.size)

    @property
    def element_count(self) -> int:
        return int(self.elements.shape[0])

    def payload(self) -> dict[str, Any]:
        return {
            "nx": self.nx,
            "ny": self.ny,
            "revision": self.revision,
            "x": [round(float(value), 6) for value in self.x],
            "y": [round(float(value), 6) for value in self.y],
            "elements": self.elements.astype(int).tolist(),
            "left": self.left.astype(int).tolist(),
            "right": self.right.astype(int).tolist(),
        }


def build_mesh(nx: int, ny: int, revision: int = 1) -> FemMesh:
    xs = np.linspace(0.0, 1.0, nx + 1)
    ys = np.linspace(0.0, 1.0, ny + 1)
    grid_x, grid_y = np.meshgrid(xs, ys)
    x = grid_x.ravel()
    y = grid_y.ravel()
    elements = np.empty((nx * ny, 4), dtype=np.int32)
    index = 0
    width = nx + 1
    for j in range(ny):
        for i in range(nx):
            n0 = j * width + i
            n1 = n0 + 1
            n2 = n1 + width
            n3 = n0 + width
            elements[index] = (n0, n1, n2, n3)
            index += 1
    left = np.arange(0, ny + 1) * width
    right = left + nx
    return FemMesh(nx, ny, x, y, elements, left.astype(np.int32), right.astype(np.int32), revision)


def _element_matrices(nx: int, ny: int, conductivity: float, capacity: float):
    hx = 1.0 / nx
    hy = 1.0 / ny
    det_j = hx * hy / 4.0
    stiffness = np.zeros((4, 4))
    mass = np.zeros((4, 4))
    for xi, eta in _GAUSS_POINTS:
        n, dxi, deta = _shape(xi, eta)
        dndx = dxi * (2.0 / hx)
        dndy = deta * (2.0 / hy)
        stiffness += conductivity * det_j * (
            np.outer(dndx, dndx) + np.outer(dndy, dndy)
        )
        mass += capacity * det_j * np.outer(n, n)
    return stiffness, mass


class FemModel:
    """一个可推进的 Q4 热传导模型；重建网格或 dt 时重新装配 / 分解。"""

    def __init__(self, config: FemConfig) -> None:
        if not _HAS_SCIPY:
            raise ComputeError("二维有限元需要 SciPy，请运行 pip install scipy")
        self.config = config
        self.mesh = build_mesh(config.nx, config.ny)
        self.stiffness, self.mass = _element_matrices(
            config.nx, config.ny, config.conductivity, config.capacity
        )
        self.node_count = self.mesh.node_count
        self.mass_matrix, self.stiffness_matrix = self._assemble()
        self.dirichlet = np.zeros(self.node_count, dtype=bool)
        self.dirichlet[self.mesh.left] = True
        self.dirichlet[self.mesh.right] = True
        self.boundary_values = np.zeros(self.node_count)
        self.boundary_values[self.mesh.left] = config.boundary_left
        self.boundary_values[self.mesh.right] = config.boundary_right
        self.temperature = np.full(
            self.node_count, float(config.initial_temperature), dtype=float
        )
        self.temperature[self.mesh.left] = config.boundary_left
        self.temperature[self.mesh.right] = config.boundary_right
        self.time = 0.0
        self.last_solve_ms = 0.0
        self._lu = None
        self._factor_dt: float | None = None
        self._bc_correction: np.ndarray | None = None
        self._source_operator, self._source_coords = self._build_source_operator()
        self._build_factorization()

    # ---- 装配 -------------------------------------------------------------
    def _assemble(self):
        elements = self.mesh.elements
        count = elements.shape[0]
        rows = []
        cols = []
        k_data = []
        m_data = []
        for a in range(4):
            for b in range(4):
                rows.append(elements[:, a])
                cols.append(elements[:, b])
                k_data.append(np.full(count, self.stiffness[a, b]))
                m_data.append(np.full(count, self.mass[a, b]))
        rows_array = np.concatenate(rows)
        cols_array = np.concatenate(cols)
        shape = (self.node_count, self.node_count)
        stiffness = coo_matrix(
            (np.concatenate(k_data), (rows_array, cols_array)), shape=shape
        ).tocsr()
        mass = coo_matrix(
            (np.concatenate(m_data), (rows_array, cols_array)), shape=shape
        ).tocsr()
        return mass, stiffness

    def _build_factorization(self) -> None:
        dt = max(1.0e-9, float(self.config.dt))
        operator = self.mass_matrix / dt + self.stiffness_matrix
        bc = self.dirichlet
        coo = operator.tocoo()
        keep = (~bc[coo.row]) & (~bc[coo.col])
        reduced = coo_matrix(
            (coo.data[keep], (coo.row[keep], coo.col[keep])),
            shape=operator.shape,
        ).tocsr()
        reduced = reduced + diags(bc.astype(float), format="csr")
        self._lu = splu(reduced.tocsc())
        self._factor_dt = dt
        # 消去已知边界列时，右端需要减去 A[:, bc] · T_bc。
        known = np.zeros(self.node_count)
        known[bc] = self.boundary_values[bc]
        correction = operator @ known
        correction[bc] = 0.0
        self._bc_correction = np.asarray(correction).ravel()
        self._operator = operator

    # ---- 热源 -------------------------------------------------------------
    def _build_source_operator(self):
        """预计算高斯热源到节点的映射，避免每步 bincount 循环。

        返回 ``(operator, coords)``：
        * ``operator``：``(node_count, 4×4)`` 稀疏矩阵，列 = 高斯点 × 局部节点；
        * ``coords``：每个高斯点在所有单元上的物理坐标 ``(px, py)``。
        每步只需计算 16 个高斯点上的 q 值，再做一次稀疏矩阵乘。
        """
        cfg = self.config
        elements = self.mesh.elements
        element_x = self.mesh.x[elements]
        element_y = self.mesh.y[elements]
        det_j = (1.0 / cfg.nx) * (1.0 / cfg.ny) / 4.0
        element_count = elements.shape[0]
        rows: list[np.ndarray] = []
        cols: list[np.ndarray] = []
        values: list[np.ndarray] = []
        coords: list[tuple[np.ndarray, np.ndarray]] = []
        for gauss_index, (xi, eta) in enumerate(_GAUSS_POINTS):
            n, _dxi, _deta = _shape(xi, eta)
            coords.append((element_x @ n, element_y @ n))
            columns = gauss_index * element_count + np.arange(element_count)
            for local in range(4):
                rows.append(elements[:, local])
                cols.append(columns)
                values.append(np.full(element_count, float(n[local]) * det_j))
        operator = coo_matrix(
            (
                np.concatenate(values),
                (np.concatenate(rows), np.concatenate(cols)),
            ),
            shape=(self.node_count, len(_GAUSS_POINTS) * element_count),
        ).tocsr()
        return operator, coords

    def _source_vector(self, time_value: float) -> np.ndarray:
        cfg = self.config
        amplitude = float(cfg.source_amplitude)
        if amplitude <= 0.0:
            return np.zeros(self.node_count)
        modulation = 0.55 + 0.45 * math.sin(2.0 * math.pi * cfg.source_frequency * time_value)
        center_x = float(cfg.source_x)
        center_y = 0.5 + 0.22 * math.sin(2.0 * math.pi * 0.055 * time_value + 0.6)
        sigma = max(1.0e-4, float(cfg.source_sigma))
        two_sigma_sq = 2.0 * sigma * sigma
        parts: list[np.ndarray] = []
        for px, py in self._source_coords:
            distance = (px - center_x) ** 2 + (py - center_y) ** 2
            parts.append(amplitude * modulation * np.exp(-distance / two_sigma_sq))
        q = np.concatenate(parts)
        return np.asarray(self._source_operator @ q).ravel()

    # ---- 推进 -------------------------------------------------------------
    def step(self, dt: float | None = None) -> dict[str, Any]:
        if not _HAS_SCIPY:
            raise ComputeError("二维有限元需要 SciPy")
        dt_value = float(dt if dt is not None else self.config.dt)
        if not math.isfinite(dt_value) or dt_value <= 0:
            raise ValidationError("有限元 dt 必须为正数")
        if abs(dt_value - float(self._factor_dt or -1.0)) > 1.0e-12:
            self.config.dt = dt_value
            self._build_factorization()
        started = time.perf_counter()
        force = self._source_vector(self.time + dt_value)
        rhs = (self.mass_matrix @ self.temperature) / dt_value + force
        if self._bc_correction is not None:
            rhs = rhs - self._bc_correction
        rhs[self.dirichlet] = self.boundary_values[self.dirichlet]
        assert self._lu is not None
        solution = self._lu.solve(rhs)
        if not np.all(np.isfinite(solution)):
            raise ComputeError("有限元求解出现非有限温度")
        if float(np.max(np.abs(solution))) > 1.0e7:
            raise ComputeError("有限元温度发散，请减小 dt 或提高导热系数")
        self.temperature = solution
        self.time += dt_value
        self.last_solve_ms = (time.perf_counter() - started) * 1000.0
        stats = self.stats()
        stats["step_ms"] = self.last_solve_ms
        return stats

    def reset(self) -> None:
        cfg = self.config
        self.temperature = np.full(
            self.node_count, float(cfg.initial_temperature), dtype=float
        )
        self.temperature[self.mesh.left] = cfg.boundary_left
        self.temperature[self.mesh.right] = cfg.boundary_right
        self.time = 0.0

    def stats(self) -> dict[str, Any]:
        data = self.temperature
        return {
            "dof": int(self.node_count),
            "elements": int(self.mesh.element_count),
            "nodes": int(self.node_count),
            "matrix_size": int(self.node_count),
            "solve_ms": float(getattr(self, "last_solve_ms", 0.0)),
            "min": float(np.min(data)),
            "max": float(np.max(data)),
            "mean": float(np.mean(data)),
            "time": float(self.time),
            "nonlinear": False,
            "kind": "fem",
        }

    def field(self) -> list[float]:
        return [round(float(value), 3) for value in self.temperature]


@dataclass
class _FemFrame:
    seq: int
    t: float
    field: array
    minimum: float
    maximum: float
    mean: float


class FemRecorder:
    def __init__(self, capacity: int = MAX_FEM_FRAMES) -> None:
        self.capacity = capacity
        self.frames: deque[_FemFrame] = deque()
        self.seq = 0

    def push(self, time_value: float, field: list[float]) -> None:
        values = array("f", field)
        minimum = float(min(field)) if field else 0.0
        maximum = float(max(field)) if field else 0.0
        mean = float(sum(field) / len(field)) if field else 0.0
        self.seq += 1
        self.frames.append(
            _FemFrame(self.seq, round(time_value, 9), values, minimum, maximum, mean)
        )
        while len(self.frames) > self.capacity:
            self.frames.popleft()

    def since(self, cursor: int, limit: int) -> list[dict[str, Any]]:
        selected = [frame for frame in self.frames if frame.seq > cursor]
        if len(selected) > limit:
            selected = selected[-limit:]
        return [
            {
                "seq": frame.seq,
                "t": frame.t,
                "min": frame.minimum,
                "max": frame.maximum,
                "mean": frame.mean,
                "field": list(frame.field),
            }
            for frame in selected
        ]

    def clear(self) -> None:
        self.frames.clear()
        self.seq = 0

    def __len__(self) -> int:
        return len(self.frames)


class FemSimulation:
    """二维有限元场的固定步长线程与增量录制。"""

    def __init__(self, config: FemConfig | None = None) -> None:
        self.lock = threading.RLock()
        self.config = config or FemConfig()
        self.model = FemModel(self.config)
        self.recorder = FemRecorder()
        self.running = False
        self.steps = 0
        self.error: str | None = None
        self.error_at: float | None = None
        self._thread: threading.Thread | None = None
        self._stop = False
        self._frame_times: deque[float] = deque(maxlen=300)
        self._mesh_revision = 1
        self.recorder.push(0.0, self.model.field())

    def ensure_thread(self) -> None:
        with self.lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._stop = False
            thread = threading.Thread(target=self._loop, name="netlab-fem", daemon=True)
            self._thread = thread
            thread.start()

    def shutdown(self) -> None:
        with self.lock:
            self._stop = True
            self.running = False
        thread = self._thread
        if thread is not None and thread.is_alive():
            thread.join(timeout=2.0)

    def _loop(self) -> None:
        while not self._stop:
            with self.lock:
                running = self.running
                fps = self.config.fps
                steps = self.config.steps_per_frame
                dt = self.config.dt
            if not running:
                time.sleep(0.01)
                continue
            started = time.perf_counter()
            with self.lock:
                if not self.running:
                    continue
                for _ in range(max(1, steps)):
                    if not self._advance_locked(dt):
                        break
                self._frame_times.append(started)
                self._prune(started)
            remaining = 1.0 / max(1, fps) - (time.perf_counter() - started)
            if remaining > 0:
                time.sleep(min(remaining, 0.25))

    def _advance_locked(self, dt: float) -> bool:
        try:
            self.model.step(dt)
            self.steps += 1
            if self.config.sample_every <= 1 or self.steps % self.config.sample_every == 0:
                self.recorder.push(self.model.time, self.model.field())
            return True
        except Exception as exc:
            self.error = str(exc)
            self.error_at = self.model.time
            self.running = False
            return False

    def _prune(self, now: float) -> None:
        while self._frame_times and now - self._frame_times[0] > 1.0:
            self._frame_times.popleft()

    def actual_fps(self) -> float:
        self._prune(time.perf_counter())
        return float(len(self._frame_times))

    # ---- 控制 -------------------------------------------------------------
    def start(self) -> None:
        with self.lock:
            self.ensure_thread()
            self.error = None
            self.error_at = None
            self.running = True

    def pause(self) -> None:
        with self.lock:
            self.running = False

    def toggle(self) -> None:
        if self.running:
            self.pause()
        else:
            self.start()

    def step_once(self, steps: int | None = None) -> None:
        with self.lock:
            self.ensure_thread()
            self.running = False
            count = max(1, min(100, int(steps if steps is not None else 1)))
            for _ in range(count):
                if not self._advance_locked(self.config.dt):
                    break

    def reset(self) -> None:
        with self.lock:
            self.model.reset()
            self.steps = 0
            self.running = False
            self.error = None
            self.error_at = None
            self.recorder.clear()
            self.recorder.push(0.0, self.model.field())
            self._frame_times.clear()

    def apply_config(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise ValidationError("有限元配置必须是对象")
        allowed = set(FemConfig.__dataclass_fields__.keys())
        unknown = set(payload) - allowed
        if unknown:
            raise ValidationError(f"未知有限元配置：{', '.join(sorted(unknown))}")
        with self.lock:
            config = FemConfig(**asdict(self.config))
            if "nx" in payload:
                config.nx = as_int(payload["nx"], "网格 nx", lo=6, hi=80)
            if "ny" in payload:
                config.ny = as_int(payload["ny"], "网格 ny", lo=6, hi=60)
            if (config.nx + 1) * (config.ny + 1) > 6000:
                raise ValidationError("有限元节点数不能超过 6000")
            if "dt" in payload:
                config.dt = as_float(payload["dt"], "有限元 dt", positive=True, lo=1.0e-5, hi=0.1)
            if "fps" in payload:
                config.fps = as_int(payload["fps"], "有限元帧率", lo=1, hi=120)
            if "steps_per_frame" in payload:
                config.steps_per_frame = as_int(payload["steps_per_frame"], "每帧步数", lo=1, hi=50)
            if "sample_every" in payload:
                config.sample_every = as_int(payload["sample_every"], "采样间隔", lo=1, hi=20)
            if "conductivity" in payload:
                config.conductivity = as_float(
                    payload["conductivity"], "导热系数", positive=True, lo=1.0e-4, hi=1000.0
                )
            if "capacity" in payload:
                config.capacity = as_float(
                    payload["capacity"], "热容 ρc", positive=True, lo=1.0e-4, hi=1000.0
                )
            if "source_amplitude" in payload:
                config.source_amplitude = as_float(
                    payload["source_amplitude"], "热源幅值", lo=0.0, hi=1.0e6
                )
            if "source_frequency" in payload:
                config.source_frequency = as_float(
                    payload["source_frequency"], "热源频率", lo=0.0, hi=20.0
                )
            if "source_sigma" in payload:
                config.source_sigma = as_float(
                    payload["source_sigma"], "热源半径", positive=True, lo=0.02, hi=0.5
                )
            if "source_x" in payload:
                config.source_x = as_float(
                    payload["source_x"], "热源 x", lo=0.05, hi=0.95
                )
            if "boundary_left" in payload:
                config.boundary_left = as_float(
                    payload["boundary_left"], "左边界温度", lo=-500.0, hi=1000.0
                )
            if "boundary_right" in payload:
                config.boundary_right = as_float(
                    payload["boundary_right"], "右边界温度", lo=-500.0, hi=1000.0
                )
            if "initial_temperature" in payload:
                config.initial_temperature = as_float(
                    payload["initial_temperature"], "初始温度", lo=-500.0, hi=1000.0
                )
            if config.dt * config.steps_per_frame > 2.0:
                raise ValidationError("每帧推进的有限元时间过大，请减小 dt 或步数")
            self.config = config
            self.model = FemModel(config)
            self.steps = 0
            self.error = None
            self.error_at = None
            self.recorder.clear()
            self.recorder.push(0.0, self.model.field())
            self._mesh_revision += 1
            self._frame_times.clear()
            return asdict(config)

    # ---- 读取 -------------------------------------------------------------
    def _stats_locked(self) -> dict[str, Any]:
        stats = self.model.stats()
        stats["step_ms"] = stats.get("solve_ms", 0.0)
        return stats

    def snapshot(self, include_mesh: bool = True) -> dict[str, Any]:
        with self.lock:
            mesh = self.model.mesh
            return {
                "running": self.running,
                "time": float(self.model.time),
                "steps": self.steps,
                "actual_fps": self.actual_fps(),
                "config": asdict(self.config),
                "stats": self._stats_locked(),
                "field": self.model.field(),
                "mesh": mesh.payload() if include_mesh else None,
                "mesh_revision": self._mesh_revision,
                "cursor": self.recorder.seq,
                "frames_recorded": len(self.recorder),
                "error": self.error,
                "error_at": self.error_at,
                "probe": {
                    "center": float(
                        self.model.temperature[
                            (self.config.ny // 2) * (self.config.nx + 1)
                            + self.config.nx // 2
                        ]
                    ),
                },
            }

    def live(self, cursor: int, limit: int = 60) -> dict[str, Any]:
        if not isinstance(cursor, int) or cursor < 0:
            raise ValidationError("cursor 必须是非负整数")
        limit = max(1, min(120, int(limit)))
        with self.lock:
            frames = self.recorder.since(cursor, limit)
            return {
                "frames": frames,
                "cursor": self.recorder.seq,
                "stats": self._stats_locked(),
                "running": self.running,
                "time": float(self.model.time),
                "steps": self.steps,
                "actual_fps": self.actual_fps(),
                "config": asdict(self.config),
                "error": self.error,
            }

    def info(self) -> dict[str, Any]:
        with self.lock:
            return {
                "running": self.running,
                "time": float(self.model.time),
                "steps": self.steps,
                "error": self.error,
                "config": asdict(self.config),
                "stats": self._stats_locked(),
            }
