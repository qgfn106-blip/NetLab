"""节点电压法（MNA）瞬态电路求解器。

未知量 = 非接地节点电压 + 独立电压源/VCVS 的支路电流。
线性元件直接盖章；电容、电感使用梯形法或后向欧拉伴随模型；
二极管用 Newton–Raphson 迭代并带结电压限幅。

这一层天然支持反馈、双向元件与理想源，是“电路模式”的计算内核。
"""

from __future__ import annotations

import math
import time as _time
from dataclasses import dataclass, field, replace as _dataclass_replace
from typing import Any

import numpy as np

from .. import accel
from ..clock import SimClock
from ..profiling import timed
from ...common.fastcopy import copy_state as _copy_state
from ...common.limits import ComputeError, ConflictError, ValidationError
from ..linalg import solve_linear
from ..math_accel.config import math_accel_mode
from ..math_accel.diagnostics import record as record_math_diag
from ..math_accel.woodbury_ac import (
    AC_WOODBURY_MIN_SIZE,
    ACWoodburySolver,
    collect_reactive_stamps,
)
from ..params import ParamSpec, choice_param, float_param, validate_params

from ..waveform import WAVEFORM_SPECS, waveform_value

from .elements import (
    ActuatorCurrent,
    ActuatorSource,
    Capacitor,
    CircuitElement,
    Comparator,
    CurrentSource,
    DFlipFlop,
    Diode,
    Inductor,
    OpAmp,
    Resistor,
    SensorElement,
    Switch,
    VCCS,
    VCVS,
    VoltageSource,
    Zener,
)
from .stamps import (
    K_BOLTZMANN,
    MAX_ABS_VOLTAGE,
    MAX_NEWTON_ITERATIONS,
    NEWTON_ABS_TOL,
    NEWTON_REL_TOL,
    CircuitNode,
    SolverOptions,
    StampContext,
    _stamp_conductance,
    _stamp_current,
)

# SciPy 改为**按需导入**：`import scipy.linalg` 要 200~300 ms，而信号流/矢量
# 模式根本不需要它。只有真正构造电路求解器时才付这笔钱（启动快 ~0.3 s）。
_scipy_lu_factor: Any = None
_scipy_lu_solve: Any = None
_sparse: Any = None
_splu: Any = None
_scipy_loaded = False


def _load_scipy() -> None:
    """第一次用到电路求解时才导入 SciPy（幂等，失败则退回纯 NumPy）。"""
    global _scipy_loaded, _scipy_lu_factor, _scipy_lu_solve, _sparse, _splu
    if _scipy_loaded:
        return
    _scipy_loaded = True
    try:  # SciPy 已在 requirements 中；没有时仍可用 NumPy 求解。
        from scipy.linalg import lu_factor, lu_solve

        _scipy_lu_factor, _scipy_lu_solve = lu_factor, lu_solve
    except Exception:  # pragma: no cover - 依赖环境
        pass
    try:  # 稀疏装配/分解（R26/D53）；缺失时 auto 自动回退稠密。
        from scipy import sparse
        from scipy.sparse.linalg import splu

        _sparse, _splu = sparse, splu
    except Exception:  # pragma: no cover - 依赖环境
        pass





from .catalog import (
    COMPARATOR_MODELS,
    DFF_MODELS,
    ELEMENT_SPECS,
    OPAMP_MODELS,
    ElementSpec,
)


from .catalog import (
    ELEMENT_FORMULAS,
    create_element,
    create_element_from_pins,
    element_catalog,
    element_spec,
)


# ---- 求解器 ----------------------------------------------------------------
class CircuitSolver:
    def __init__(
        self,
        nodes: list[CircuitNode],
        elements: list[CircuitElement],
        *,
        integration: str = "trapezoidal",
        options: SolverOptions | None = None,
        clock: SimClock | None = None,
    ) -> None:
        if integration not in ("trapezoidal", "backward_euler", "gear2"):
            raise ValidationError("积分方法必须是 trapezoidal、backward_euler 或 gear2")
        self.nodes = nodes
        self.elements = elements
        self.integration = integration
        self.options = options or SolverOptions()
        for element in self.elements:
            element.integration = integration
        self._clock = clock if clock is not None else SimClock()
        self.solution: np.ndarray | None = None
        self.node_voltages: dict[str, float] = {node.id: 0.0 for node in nodes}
        self.last_iterations = 0
        self.last_solve_ms = 0.0
        self.last_residual = 0.0
        self.last_strategies: tuple[str, ...] = ()
        self.last_scaled = False
        self.last_row_scale: np.ndarray | None = None
        self.last_col_scale: np.ndarray | None = None
        self._worst_residual_index: int | None = None
        self.matrix_size = 0
        self.nonlinear = any(element.nonlinear for element in elements)
        self._build_index()

    @property
    def time(self) -> float:
        return self._clock.time

    @time.setter
    def time(self, value: float) -> None:
        self._clock.time = value

    def _build_index(self) -> None:
        if not self.nodes:
            raise ConflictError("电路中没有节点")
        ground_nodes = [node for node in self.nodes if node.ground]
        if not ground_nodes:
            raise ComputeError("电路需要至少一个接地节点（把某个节点设为 ground）")
        if len(ground_nodes) > 1:
            raise ComputeError("电路只能有一个接地节点")
        self.ground = ground_nodes[0].id
        node_ids = {node.id for node in self.nodes}
        unknown: list[str] = [node.id for node in self.nodes if not node.ground]
        internal: list[str] = []
        for element in self.elements:
            for node_id in element.internal_nodes:
                if node_id in node_ids or node_id in internal:
                    raise ComputeError(f"内部节点 id 冲突：{node_id!r}")
                internal.append(node_id)
        unknown.extend(internal)
        valid_ids = node_ids | set(internal)
        # 在建立未知量索引前验证所有元件端点与控制端点，避免非法引用
        # 被静默排除后，装配阶段才以难以定位的 KeyError 失败。
        for element in self.elements:
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
        # 固定按物理 id 排序：均衡/消元顺序与 dict 插入历史无关，报告也稳定。
        unknown = sorted(unknown)
        self.unknown_ids = unknown
        self.index = {node_id: position for position, node_id in enumerate(unknown)}

        branch_elements = [element for element in self.elements if element.needs_branch]
        branch_count = sum(
            int(getattr(element, "branch_width", 1)) for element in branch_elements
        )
        offset = 0
        for element in branch_elements:
            width = int(getattr(element, "branch_width", 1))
            element.branch_index = len(unknown) + offset
            element.branch_indices = tuple(
                len(unknown) + offset + index for index in range(width)
            )
            offset += width
            if element.a == self.ground and element.b == self.ground:
                raise ComputeError(f"电压源 {element.name!r} 两端都接地，电路不合法")
        self.branch_count = branch_count
        self.matrix_size = len(unknown) + branch_count
        if self.matrix_size == 0:
            raise ComputeError("电路没有可求解的未知量")
        self.solution = np.zeros(self.matrix_size)
        self.sparse = self._decide_sparse()
        self._matrix = self._blank_matrix()
        self._rhs = np.zeros(self.matrix_size)
        self._lu_cache = None
        self._lu_matrix: np.ndarray | None = None
        self._lu_col_scale: np.ndarray | None = None
        self._lu_row_scale: np.ndarray | None = None
        self._cached_dt: float | None = None
        self._sparse_lu = None
        self._sparse_key: tuple[Any, ...] | None = None
        self._sparse_col_scale: np.ndarray | None = None
        self.linear_reuse = 0
        #: N-36：最近一步的求解器快照，供 Scene/Simulation 超时回滚复用。
        self._last_step_checkpoint: dict[str, Any] | None = None

    def _decide_sparse(self) -> bool:
        _load_scipy()
        """按 SolverOptions.sparse 决定装配/求解后端（R26/D53）。"""
        mode = str(getattr(self.options, "sparse", "auto")).lower()
        if mode not in ("auto", "on", "off"):
            raise ValidationError("sparse 必须是 auto、on 或 off")
        if mode == "off":
            return False
        if _sparse is None:  # 没有 SciPy 时只能稠密
            return False
        if mode == "on":
            return True
        return self.matrix_size > int(getattr(self.options, "sparse_threshold", 512))

    def _blank_matrix(self) -> Any:
        """新建全零系数矩阵（稀疏时为 LIL，便于逐元素盖章）。"""
        if self.sparse:
            return _sparse.lil_matrix((self.matrix_size, self.matrix_size))
        return np.zeros((self.matrix_size, self.matrix_size))

    # ---- 事务检查点（P0-01） ---------------------------------------------
    def _capture_element_state(self) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for element in self.elements:
            row: dict[str, Any] = {
                "state": _copy_state(element.state),
                "guess": _copy_state(element.iteration_guess),
                "result": _copy_state(element.result),
                "time": float(getattr(element, "time", 0.0)),
            }
            if hasattr(element, "value"):
                row["value"] = getattr(element, "value")
            if hasattr(element, "source_scale"):
                row["source_scale"] = float(getattr(element, "source_scale"))
            rows.append(row)
        return rows

    def capture_checkpoint(self) -> dict[str, Any]:
        """冻结求解器时间轴、解、节点电压与元件历史状态（失败步可完整回滚）。"""
        return {
            "time": self.time,
            "solution": None if self.solution is None else self.solution.copy(),
            "node_voltages": dict(self.node_voltages),
            "last_iterations": self.last_iterations,
            "last_solve_ms": self.last_solve_ms,
            "elements": self._capture_element_state(),
        }

    def restore_checkpoint(self, checkpoint: dict[str, Any]) -> None:
        self.time = float(checkpoint["time"])
        solution = checkpoint.get("solution")
        self.solution = None if solution is None else np.array(solution, copy=True)
        self.node_voltages = dict(checkpoint.get("node_voltages", {}))
        self.last_iterations = int(checkpoint.get("last_iterations", 0))
        self.last_solve_ms = float(checkpoint.get("last_solve_ms", 0.0))
        for element, row in zip(self.elements, checkpoint.get("elements", [])):
            element.state = _copy_state(row.get("state", {}))
            element.iteration_guess = _copy_state(row.get("guess", {}))
            element.result = _copy_state(row.get("result", {}))
            element.time = float(row.get("time", element.time))
            if "value" in row:
                element.value = row["value"]
            if "source_scale" in row:
                element.source_scale = row["source_scale"]
        # 失败步可能已用污染矩阵生成 LU；一律失效，避免后续线性步复用。
        self._lu_cache = None
        self._lu_matrix = None
        self._lu_col_scale = None
        self._lu_row_scale = None
        self._cached_dt = None
        self._sparse_lu = None
        self._sparse_key = None

    def zero_time(self) -> None:
        """只归零时间轴，不修改状态（由 restore/reset 之外的推进层调用）。"""
        self.time = 0.0

    def _restore_element_states(self, snapshot: list[dict[str, Any]]) -> None:
        for element, row in zip(self.elements, snapshot):
            element.state = _copy_state(row["state"])
            element.iteration_guess = _copy_state(row["guess"])

    # ---- 推进 -------------------------------------------------------------
    @timed("circuit.solver.step")
    def step(self, dt: float) -> dict[str, Any]:
        if not math.isfinite(dt) or dt <= 0:
            raise ValidationError("dt 必须为正的有限数")
        started = _time.perf_counter()
        checkpoint = self.capture_checkpoint()
        self._last_step_checkpoint = checkpoint
        try:
            return self._step_locked(dt, started)
        except Exception:
            self.restore_checkpoint(checkpoint)
            raise

    def restore_last_step_checkpoint(self) -> None:
        """回滚到最近一次 ``step`` 开始前的求解器快照（N-36）。"""
        checkpoint = self._last_step_checkpoint
        if checkpoint is not None:
            self.restore_checkpoint(checkpoint)

    def _step_locked(self, dt: float, started: float) -> dict[str, Any]:
        self.time += dt
        for element in self.elements:
            element.prepare(dt, self.time)

        guess = (
            self.solution if self.solution is not None else np.zeros(self.matrix_size)
        )
        solution, iterations, converged, residual, attempted = (
            self._newton_with_strategies(dt, guess, mode="tran")
        )
        if not converged:
            trouble = self._trouble_name(solution, dt=dt, residual=residual)
            tried = "、".join(attempted) if attempted else "未启用 gmin/source stepping"
            raise ComputeError(
                f"非线性电路在 {self.options.max_iter} 次 Newton 迭代内未收敛"
                f"（后向残差 {residual:.3g}，最大残差节点 {trouble!r}）；"
                f"已尝试：{tried}；请减小 dt、检查悬空/强反馈，或放宽 SolverOptions"
            )

        self.solution = solution
        self.last_residual = float(residual)
        self.last_strategies = tuple(attempted)
        ctx = StampContext(
            A=np.zeros((0, 0)),
            rhs=np.zeros(0),
            index=self.index,
            solution=solution,
            dt=dt,
            time=self.time,
            iteration=iterations,
        )
        for element in self.elements:
            element.commit(ctx)
            element.state.update(element.result)
        self.node_voltages = {node.id: 0.0 for node in self.nodes}
        for node_id, position in self.index.items():
            if node_id in self.node_voltages:
                self.node_voltages[node_id] = float(solution[position])
        self.node_voltages[self.ground] = 0.0
        self.last_iterations = iterations
        self.last_solve_ms = (_time.perf_counter() - started) * 1000.0
        return {
            "iterations": iterations,
            "matrix_size": self.matrix_size,
            "solve_ms": self.last_solve_ms,
            "residual": self.last_residual,
            "strategies": list(self.last_strategies),
            "scaling": self.last_scaled,
        }

    def _newton_with_strategies(
        self, dt: float, guess: np.ndarray, *, mode: str = "tran"
    ) -> tuple[np.ndarray, int, bool, float, list[str]]:
        """Newton + gmin/source stepping 的统一入口（瞬态与 DC 工作点共用）。"""
        options = self.options
        nonlinear = any(element.nonlinear for element in self.elements)
        solution, iterations, converged, residual = self._newton_solve(
            dt, 0.0, guess, mode=mode
        )
        attempted: list[str] = []
        if not converged and nonlinear and options.gmin_steps > 0:
            attempted.append("gmin stepping")
            # gmin stepping：起始值与步数来自 SolverOptions；失败试验完整回滚。
            gmin = max(1.0e-15, float(options.gmin))
            for _ in range(max(1, int(options.gmin_steps))):
                trial_snapshot = self._capture_element_state()
                trial, trial_iters, trial_ok, _ = self._newton_solve(
                    dt, gmin, solution, mode=mode
                )
                iterations += trial_iters
                if trial_ok:
                    solution = trial
                else:
                    self._restore_element_states(trial_snapshot)
                gmin *= 0.1
            solution, trial_iters, converged, residual = self._newton_solve(
                dt, 0.0, solution, mode=mode
            )
            iterations += trial_iters
        if not converged and nonlinear and options.src_steps > 0:
            # source stepping：独立源从 0 斜坡到 1，上一解作初值。
            attempted.append("source stepping")
            steps = max(1, int(options.src_steps))
            for step in range(1, steps + 1):
                scale = step / steps
                trial_snapshot = self._capture_element_state()
                trial, trial_iters, trial_ok, _ = self._newton_solve(
                    dt, 0.0, solution, source_scale=scale, mode=mode
                )
                iterations += trial_iters
                if trial_ok:
                    solution = trial
                else:
                    self._restore_element_states(trial_snapshot)
                    break
            solution, trial_iters, converged, residual = self._newton_solve(
                dt, 0.0, solution, source_scale=1.0, mode=mode
            )
            iterations += trial_iters
        return solution, iterations, converged, residual, attempted

    def _tolerance(
        self, new_solution: np.ndarray, old_solution: np.ndarray
    ) -> np.ndarray:
        options = self.options
        node_count = len(self.unknown_ids)
        tol = np.empty(self.matrix_size)
        tol[:node_count] = options.vntol
        tol[node_count:] = options.abstol
        return tol + options.reltol * np.maximum(
            np.abs(new_solution), np.abs(old_solution)
        )

    def _index_name(self, index: int) -> str:
        if index < len(self.unknown_ids):
            node_id = self.unknown_ids[index]
            for node in self.nodes:
                if node.id == node_id:
                    return f"节点 {node.name!r}"
            return f"节点 {node_id!r}"
        branch = index - len(self.unknown_ids)
        offset = 0
        for element in self.elements:
            if not getattr(element, "needs_branch", False):
                continue
            width = int(getattr(element, "branch_width", 1))
            if branch < offset + width:
                return f"支路 {element.name!r}"
            offset += width
        return f"未知量 #{index}"

    def _trouble_name(
        self,
        solution: np.ndarray,
        *,
        dt: float | None = None,
        residual: float | None = None,
    ) -> str:
        if not self.matrix_size:
            return "?"
        quality = residual if residual is not None else 0.0
        worst = self._worst_residual_index
        if quality > 0.0 and worst is not None:
            label = self._index_name(worst)
            for prefix in ("节点 ", "支路 "):
                if label.startswith(prefix):
                    return label[len(prefix) :].strip("'")
            return label
        index = int(np.argmax(np.abs(solution)))
        if index < len(self.unknown_ids):
            node_id = self.unknown_ids[index]
            for node in self.nodes:
                if node.id == node_id:
                    return node.name
            return node_id
        return self._index_name(index).replace("支路 ", "").strip("'")

    @staticmethod
    def _residual_metric(
        matrix: Any, solution: np.ndarray, rhs: np.ndarray, dt: float
    ) -> tuple[float, int | None]:
        """尺度无关的后向误差：‖Ax−b‖∞ / (‖|A||x|‖∞ + dt·‖b‖∞)。

        稀疏矩阵 ``matrix @ x`` 返回 ndarray，``abs(matrix) @ |x|`` 同样返回
        ndarray，因此稠密/稀疏共用同一判据（R26/D53）。
        """
        residual = np.asarray(np.abs(matrix @ solution - rhs)).ravel()
        if not residual.size:
            return 0.0, None
        denominator = float(np.max(np.asarray(abs(matrix) @ np.abs(solution)).ravel()))
        denominator += dt * float(np.max(np.abs(rhs))) + 1.0e-30
        worst = int(np.argmax(residual))
        return float(residual[worst]) / denominator, worst

    def _newton_solve(
        self,
        dt: float,
        gmin: float,
        initial: np.ndarray,
        source_scale: float = 1.0,
        *,
        mode: str = "tran",
    ) -> tuple[np.ndarray, int, bool, float]:
        options = self.options
        sources = [e for e in self.elements if e.kind in ("vsource", "isource")]
        nonlinear_elements = [element for element in self.elements if element.nonlinear]
        solution = initial.copy()
        iterations = 0
        converged = not nonlinear_elements
        residual = 0.0
        max_iter = max(1, int(options.max_iter))
        self._worst_residual_index = None
        try:
            for iteration in range(max_iter if nonlinear_elements else 1):
                iterations = iteration + 1
                matrix = self._blank_matrix()
                rhs = self._rhs
                rhs.fill(0.0)
                ctx = StampContext(
                    A=matrix,
                    rhs=rhs,
                    index=self.index,
                    solution=solution,
                    dt=dt,
                    time=self.time,
                    iteration=iteration,
                    mode=mode,
                )
                for element in sources:
                    element.source_scale = source_scale
                for element in self.elements:
                    element.stamp(ctx)
                if iteration == 0:
                    # 悬空检测只看结构（哪些元件在该行盖章），与迭代次数无关；
                    # 每次 Newton 迭代重复扫描是纯浪费。
                    self._check_floating(matrix)
                if gmin > 0:
                    for index in range(len(self.unknown_ids)):
                        matrix[index, index] += gmin
                new_solution = self._solve_matrix(matrix, rhs, dt)
                if not np.all(np.isfinite(new_solution)):
                    raise ComputeError("电路求解出现非有限数值")
                if np.max(np.abs(new_solution)) > MAX_ABS_VOLTAGE:
                    raise ComputeError("电路电压超过 1e9 V，仿真已发散")
                residual, worst = self._residual_metric(matrix, new_solution, rhs, dt)
                self._worst_residual_index = worst
                if not nonlinear_elements:
                    limit = (
                        float(options.residual_tol)
                        if options.residual_tol > 0
                        else float(options.residual_safety_tol)
                    )
                    if limit > 0 and residual > limit:
                        raise ComputeError(
                            f"线性电路解质量不足（后向残差 {residual:.3g} > {limit:.3g}）："
                            f"最大残差量 {self._trouble_name(new_solution, dt=dt, residual=residual)!r}；"
                            "请检查病态参数、悬空节点或极小的并联电阻"
                        )
                    solution = new_solution
                    break
                delta = np.abs(new_solution - solution)
                node_ok = bool(np.all(delta <= self._tolerance(new_solution, solution)))
                solution = new_solution
                if options.residual_tol > 0:
                    residual_ok = residual <= options.residual_tol
                elif options.residual_safety_tol > 0:
                    residual_ok = residual <= options.residual_safety_tol
                else:
                    residual_ok = True
                if iteration > 0 and node_ok and residual_ok:
                    converged = True
                    break
                guess_ctx = StampContext(
                    A=matrix,
                    rhs=rhs,
                    index=self.index,
                    solution=solution,
                    dt=dt,
                    time=self.time,
                    iteration=iteration,
                    mode=mode,
                )
                for element in nonlinear_elements:
                    element.update_guess(guess_ctx)
        finally:
            # 无论成功/异常，独立源缩放必须恢复；失败步不能污染下一拍。
            for element in sources:
                element.source_scale = 1.0
        return solution, iterations, converged, residual

    def _solve_matrix(self, matrix: Any, rhs: np.ndarray, dt: float) -> np.ndarray:
        """求解本拍 MNA 方程；矩阵未变时复用 LU 分解。

        线性电路（R/L/C/独立源/受控源/开关）的系数矩阵只依赖 dt 与元件参数，
        因此第一拍分解后，后续拍只需 ``lu_solve`` 回代。非线性电路每次
        Newton 迭代矩阵都会变化，缓存自然失效；这保证数值语义完全不变。
        稀疏后端的语义与稠密一致，只是分解改用 ``splu``（R26/D53）。
        """
        _load_scipy()
        if self.sparse:
            return self._solve_sparse(matrix, rhs, dt)
        use_gpu = (
            accel.available() and self.matrix_size >= accel.status()["gpu_min_size"]
        )
        if use_gpu:  # pragma: no cover - 依赖本机 GPU
            return solve_linear(matrix, rhs, what="电路")
        scaling = bool(self.options.scaling)
        # 命中缓存时连均衡因子一起复用：均衡只取决于矩阵，矩阵不变时算它是白费。
        if (
            _scipy_lu_factor is not None
            and self._lu_cache is not None
            and self._lu_matrix is not None
            and self._lu_col_scale is not None
            and self._lu_row_scale is not None
            and self._cached_dt == dt
            and matrix.shape == self._lu_matrix.shape
            and np.array_equal(matrix, self._lu_matrix)
        ):
            self.linear_reuse += 1
            self.last_scaled = scaling
            self.last_row_scale = self._lu_row_scale
            self.last_col_scale = self._lu_col_scale
            return (
                _scipy_lu_solve(self._lu_cache, rhs / self._lu_row_scale)
                / self._lu_col_scale
            )
        row_scale, col_scale = (
            self._equilibration(matrix)
            if scaling
            else (
                np.ones(matrix.shape[0]),
                np.ones(matrix.shape[1]),
            )
        )
        self.last_scaled = scaling
        self.last_row_scale = row_scale
        self.last_col_scale = col_scale
        scaled = matrix / row_scale[:, None] / col_scale[None, :]
        scaled_rhs = rhs / row_scale
        if _scipy_lu_factor is not None:
            try:
                factor = _scipy_lu_factor(scaled, check_finite=False)
                diagonal = np.abs(np.diag(factor[0]))
                scale = max(
                    1.0e-300,
                    float(np.max(diagonal)) if diagonal.size else 1.0,
                )
                bad = np.where(diagonal <= float(self.options.pivot_tol) * scale)[0]
                if bad.size:
                    raise ComputeError(
                        f"电路矩阵奇异（零主元）：{self._index_name(int(bad[0]))}；"
                        "请检查悬空节点、缺少直流通路或重复接地的元件"
                    )
                z = _scipy_lu_solve(factor, scaled_rhs)
                solution = z / col_scale
                if not np.all(np.isfinite(solution)):
                    raise ComputeError("电路求解出现非有限数值")
                self._lu_cache = factor
                self._lu_matrix = matrix.copy()
                self._lu_col_scale = col_scale.copy()
                self._lu_row_scale = row_scale.copy()
                self._cached_dt = dt
                return solution
            except ComputeError:
                raise
            except Exception:
                # 奇异/数值失败交给统一的 solve_linear，输出可读错误。
                pass
        return solve_linear(matrix, rhs, what="电路")

    def _sparse_equilibration(self, csr: Any) -> tuple[np.ndarray, np.ndarray]:
        """稀疏版本的行/列最大模均衡（不展开成稠密）。"""
        tiny = 1.0e-300
        abs_csr = abs(csr)
        row_scale = np.asarray(abs_csr.max(axis=1).todense()).ravel()
        row_scale = np.maximum(row_scale, tiny)
        row_norm = abs_csr.multiply(1.0 / row_scale[:, None]).tocsr()
        col_scale = np.asarray(row_norm.max(axis=0).todense()).ravel()
        return row_scale, np.maximum(col_scale, tiny)

    def _solve_sparse(self, matrix: Any, rhs: np.ndarray, dt: float) -> np.ndarray:
        """稀疏 LU：行列均衡 + splu，零主元映射为可读的奇异诊断（R26/D53）。"""
        if _splu is None:  # pragma: no cover - 环境缺少 SciPy
            raise ComputeError("稀疏求解需要 SciPy，请安装 scipy 或把 sparse 设为 off")
        csr = matrix.tocsr()
        csr.sum_duplicates()
        csr.sort_indices()
        if self.options.scaling:
            row_scale, col_scale = self._sparse_equilibration(csr)
        else:
            row_scale = np.ones(self.matrix_size)
            col_scale = np.ones(self.matrix_size)
        self.last_scaled = bool(self.options.scaling)
        self.last_row_scale = row_scale
        self.last_col_scale = col_scale
        scaled = (
            csr.multiply(1.0 / row_scale[:, None])
            .multiply(1.0 / col_scale[None, :])
            .tocsc()
        )
        scaled_rhs = rhs / row_scale
        key = (
            round(float(dt), 12),
            scaled.nnz,
            scaled.indptr.tobytes(),
            scaled.indices.tobytes(),
            scaled.data.tobytes(),
            row_scale.tobytes(),
            col_scale.tobytes(),
        )
        if self._sparse_lu is not None and self._sparse_key == key:
            self.linear_reuse += 1
            solution = self._sparse_lu.solve(scaled_rhs) / col_scale
            if not np.all(np.isfinite(solution)):
                raise ComputeError("电路求解出现非有限数值")
            return solution
        try:
            factor = _splu(scaled)
        except RuntimeError as exc:
            raise ComputeError(
                "电路矩阵奇异（稀疏 LU）；请检查悬空节点、缺少直流通路"
                "或重复接地的元件"
            ) from exc
        diagonal = np.abs(factor.U.diagonal())
        if diagonal.size:
            scale = max(1.0e-300, float(np.max(diagonal)))
            bad = np.where(diagonal <= float(self.options.pivot_tol) * scale)[0]
            if bad.size:
                raise ComputeError(
                    f"电路矩阵奇异（零主元）：{self._index_name(int(bad[0]))}；"
                    "请检查悬空节点、缺少直流通路或重复接地的元件"
                )
        solution = factor.solve(scaled_rhs) / col_scale
        if not np.all(np.isfinite(solution)):
            raise ComputeError("电路求解出现非有限数值")
        self._sparse_lu = factor
        self._sparse_key = key
        return solution

    @staticmethod
    def _equilibration(matrix: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """行/列最大模均衡，保留原始矩阵只用于缓存比较。"""
        tiny = 1.0e-300
        absolute = np.abs(matrix)  # 只取一次绝对值，避免两次整矩阵分配
        row_scale = np.maximum(np.max(absolute, axis=1), tiny)
        row_normalized = absolute / row_scale[:, None]
        col_scale = np.maximum(np.max(row_normalized, axis=0), tiny)
        return row_scale, col_scale

    def _check_floating(self, matrix: Any) -> None:
        if _sparse is not None and _sparse.issparse(matrix):
            nonempty = np.asarray(matrix.getnnz(axis=1)).ravel()
        else:
            nonempty = np.any(matrix, axis=1)
        for row in range(len(self.unknown_ids)):
            if not nonempty[row]:
                names = [
                    node.name for node in self.nodes if node.id == self.unknown_ids[row]
                ]
                label = names[0] if names else self.unknown_ids[row]
                raise ComputeError(
                    f"节点 {label!r} 没有任何直流通路（悬空），请增加元件或接地"
                )

    # ---- 直流工作点与交流小信号（R26/D54–D56） -----------------------------
    #: 支持交流 stamp 的元件 kind；其余元件（二极管/晶体管/数字器件等）在 AC 中显式拒绝。
    AC_KINDS = frozenset(
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

    def operating_point(self) -> dict[str, Any]:
        """DC 工作点（.op）：电容开路、电感短路近似、源取 t=0 的值。

        求解全程在一个事务检查点内进行：无论成功失败，都不改变瞬态时间轴、
        节点电压与元件历史状态（可随时在暂停/运行中调用）。
        """
        checkpoint = self.capture_checkpoint()
        try:
            self.time = 0.0
            for element in self.elements:
                if hasattr(element, "value"):
                    element.value = waveform_value(element.params, 0.0)
            guess = np.zeros(self.matrix_size)
            solution, iterations, converged, residual, attempted = (
                self._newton_with_strategies(1.0e-9, guess, mode="dc")
            )
            if not converged:
                trouble = self._trouble_name(solution, residual=residual)
                tried = "、".join(attempted) or "未启用 gmin/source stepping"
                raise ComputeError(
                    f"直流工作点在 {self.options.max_iter} 次 Newton 迭代内未收敛"
                    f"（后向残差 {residual:.3g}，最大残差节点 {trouble!r}）；"
                    f"已尝试：{tried}；请检查悬空节点或强反馈"
                )
            ctx = StampContext(
                A=self._blank_matrix(),
                rhs=np.zeros(self.matrix_size),
                index=self.index,
                solution=solution,
                dt=1.0e-9,
                time=0.0,
                iteration=iterations,
                mode="dc",
            )
            for element in self.elements:
                element.commit(ctx)
            node_voltages = {node.id: 0.0 for node in self.nodes}
            for node_id, position in self.index.items():
                if node_id in node_voltages:
                    node_voltages[node_id] = float(solution[position])
            node_voltages[self.ground] = 0.0
            elements = {
                element.name: {
                    key: float(value)
                    for key, value in element.result.items()
                    if isinstance(value, (int, float))
                }
                for element in self.elements
            }
            return {
                "time": 0.0,
                "node_voltages": node_voltages,
                "elements": elements,
                "iterations": iterations,
                "matrix_size": self.matrix_size,
                "residual": float(residual),
                "strategies": list(attempted),
                "sparse": bool(self.sparse),
            }
        finally:
            self.restore_checkpoint(checkpoint)
            self._lu_cache = None
            self._lu_matrix = None
            self._sparse_lu = None
            self._sparse_key = None

    def ac_sweep(
        self,
        frequencies: list[float],
        *,
        input_source: str | None = None,
        probes: list[str] | None = None,
    ) -> dict[str, Any]:
        """单点/扫频 AC 小信号（Bode 数据），基于 DC 工作点线性化。

        只支持线性/受控源类元件（``AC_KINDS``）：被选中的独立源取单位激励
        （1 V / 1 A），其余独立源置零；电容 jωC、电感 1/(jωL)。
        返回每个探针的 magnitude/phase_deg/db；调用不改变瞬态状态。
        """
        freqs = [float(f) for f in frequencies]
        if not freqs:
            raise ValidationError("AC 扫频至少需要一个频率点")
        if any(not math.isfinite(f) or f <= 0.0 for f in freqs):
            raise ValidationError("AC 频率必须为正的有限数")
        unsupported = [e for e in self.elements if e.kind not in self.AC_KINDS]
        if unsupported:
            names = "、".join(element.name for element in unsupported[:3])
            raise ComputeError(
                f"AC 分析暂不支持元件 {names!r}（{unsupported[0].kind}）："
                "小信号只对线性元件与受控源线性化；请改用瞬态分析或移除该元件"
            )
        sources = [
            element
            for element in self.elements
            if element.kind in ("vsource", "isource")
        ]
        if not sources:
            raise ComputeError("AC 分析需要至少一个独立源作为激励")
        if input_source is None:
            input_element = sources[0]
        else:
            matches = [e for e in sources if e.name == input_source]
            if not matches:
                raise ComputeError(f"AC 分析找不到激励源 {input_source!r}")
            input_element = matches[0]
        node_names = {node.id: node.name for node in self.nodes}
        if probes:
            wanted: list[str] = []
            for token in probes:
                key = str(token)
                if key in self.index or key in node_names.values():
                    wanted.append(key)
                elif any(element.name == key for element in self.elements):
                    wanted.append(key)
                else:
                    raise ComputeError(f"AC 探针不存在：{token!r}")
        else:
            wanted = [
                node_id for node_id in self.unknown_ids if node_id in node_names
            ] + [
                element.name
                for element in self.elements
                if element.kind
                in ("resistor", "capacitor", "inductor", "vsource", "isource")
            ]
        checkpoint = self.capture_checkpoint()
        try:
            self.time = 0.0
            for element in self.elements:
                if hasattr(element, "value"):
                    element.value = waveform_value(element.params, 0.0)
            guess = np.zeros(self.matrix_size)
            op, iterations, converged, residual, attempted = (
                self._newton_with_strategies(1.0e-9, guess, mode="dc")
            )
            if not converged:
                raise ComputeError(
                    "AC 分析前无法求得直流工作点（后向残差 "
                    f"{residual:.3g}）；请先让电路在 DC 下可解"
                )
            results: dict[str, dict[str, list[float]]] = {
                token: {
                    "real": [],
                    "imag": [],
                    "magnitude": [],
                    "phase_deg": [],
                    "db": [],
                }
                for token in wanted
            }
            size = self.matrix_size
            # R43/P3 影子路径：默认 off，不改变任何既有行为。
            mode = math_accel_mode("P3")
            solver: ACWoodburySolver | None = None
            stamp_count = 0
            base_matrix: np.ndarray | None = None
            base_rhs: np.ndarray | None = None
            if mode != "off" and size >= AC_WOODBURY_MIN_SIZE:
                omega0 = 2.0 * math.pi * math.sqrt(min(freqs) * max(freqs))
                ctx0 = StampContext(
                    A=np.zeros((size, size), dtype=complex),
                    rhs=np.zeros(size, dtype=complex),
                    index=self.index,
                    solution=op,
                    dt=0.0,
                    time=0.0,
                    iteration=0,
                    mode="ac",
                    omega=omega0,
                )
                for element in self.elements:
                    if hasattr(element, "value"):
                        element.value = 1.0 if element is input_element else 0.0
                    element.stamp(ctx0)
                try:
                    stamps = collect_reactive_stamps(self.elements, self.index)
                    stamp_count = len(stamps)
                    base = np.array(ctx0.A, dtype=complex, copy=True)
                    for stamp in stamps:
                        vector = stamp.vector(size)
                        base -= stamp.conductance(omega0) * np.outer(vector, vector)
                    base_matrix = base
                    base_rhs = np.array(ctx0.rhs, dtype=complex, copy=True)
                    # 快速路径下 base_matrix 与频率无关，悬空检查只需做一次；
                    # 逐频点重复 np.any(...,axis=1) 是 O(n²) 的无谓开销。
                    self._check_floating(base_matrix)
                    solver = ACWoodburySolver(base, stamps, omega0)
                    record_math_diag("p3.init", solver.summary())
                except Exception as exc:  # pragma: no cover - 防御性回退
                    solver = None
                    record_math_diag("p3.init_error", {"error": repr(exc)})
            for frequency in freqs:
                omega = 2.0 * math.pi * frequency
                fast = (
                    mode == "on"
                    and solver is not None
                    and solver.usable
                    and solver.ratio <= 0.10
                    and base_matrix is not None
                    and base_rhs is not None
                )
                if fast:
                    # 频率无关的静态矩阵只装配一次；逐频点只更新 RHS 与
                    # Woodbury 小解，避免每频点 O(n²) 重新 stamp。
                    ctx = StampContext(
                        A=base_matrix,
                        rhs=base_rhs.copy(),
                        index=self.index,
                        solution=op,
                        dt=0.0,
                        time=0.0,
                        iteration=0,
                        mode="ac",
                        omega=omega,
                    )
                else:
                    ctx = StampContext(
                        A=np.zeros((size, size), dtype=complex),
                        rhs=np.zeros(size, dtype=complex),
                        index=self.index,
                        solution=op,
                        dt=0.0,
                        time=0.0,
                        iteration=0,
                        mode="ac",
                        omega=omega,
                    )
                    for element in self.elements:
                        if hasattr(element, "value"):
                            element.value = 1.0 if element is input_element else 0.0
                        element.stamp(ctx)
                if not fast:
                    self._check_floating(ctx.A)
                solution = None
                if fast:
                    solution = solver.solve(omega, ctx.rhs)
                    record_math_diag(
                        "p3.used",
                        {
                            "n": size,
                            "r": stamp_count,
                            "ratio": solver.ratio,
                            "omega": omega,
                        },
                    )
                elif solver is not None and solver.usable:
                    if mode == "shadow" or (mode == "on" and solver.ratio <= 0.25):
                        direct = np.linalg.solve(ctx.A, ctx.rhs)
                        try:
                            shadow = solver.solve(omega, ctx.rhs)
                            relative = float(
                                np.linalg.norm(shadow - direct)
                                / max(np.linalg.norm(direct), 1.0e-300)
                            )
                            record_math_diag(
                                "p3.shadow",
                                {
                                    "n": size,
                                    "r": stamp_count,
                                    "ratio": solver.ratio,
                                    "omega": omega,
                                    "rel_err": relative,
                                },
                            )
                        except Exception as exc:  # pragma: no cover - 防御性回退
                            record_math_diag(
                                "p3.shadow_error", {"omega": omega, "error": repr(exc)}
                            )
                        solution = direct
                if solution is None:
                    solution = np.linalg.solve(ctx.A, ctx.rhs)
                for token in wanted:
                    value = self._ac_probe(token, ctx, solution, node_names)
                    magnitude = float(abs(value))
                    phase = math.degrees(math.atan2(value.imag, value.real))
                    row = results[token]
                    row["real"].append(float(value.real))
                    row["imag"].append(float(value.imag))
                    row["magnitude"].append(magnitude)
                    row["phase_deg"].append(phase)
                    row["db"].append(20.0 * math.log10(max(magnitude, 1.0e-30)))
            return {
                "frequencies": freqs,
                "input": input_element.name,
                "probes": results,
                "operating_point": {
                    "iterations": iterations,
                    "node_voltages": {
                        node_names.get(node_id, node_id): float(op[position])
                        for node_id, position in self.index.items()
                        if node_id in node_names
                    },
                },
            }
        finally:
            self.restore_checkpoint(checkpoint)
            self._sparse_lu = None
            self._sparse_key = None

    def _ac_probe(
        self,
        token: str,
        ctx: StampContext,
        solution: np.ndarray,
        node_names: dict[str, str],
    ) -> complex:
        position = self.index.get(token)
        if position is None:
            # 允许用节点显示名（name）作探针。
            for node_id, name in node_names.items():
                if name == token and node_id in self.index:
                    position = self.index[node_id]
                    break
        if position is not None:
            return complex(solution[position])
        for element in self.elements:
            if element.name != token:
                continue
            va = (
                complex(solution[self.index[element.a]])
                if element.a in self.index
                else 0j
            )
            vb = (
                complex(solution[self.index[element.b]])
                if element.b in self.index
                else 0j
            )
            difference = va - vb
            if element.kind == "resistor":
                return difference / float(element.params["R"])
            if element.kind == "capacitor":
                return 1j * ctx.omega * float(element.params["C"]) * difference
            if element.kind == "inductor":
                return difference / (1j * ctx.omega * float(element.params["L"]))
            if element.kind == "vsource":
                return complex(solution[element.branch_index])
            if element.kind == "isource":
                return complex(element.value)
            raise ComputeError(f"AC 探针 {token!r} 的电流暂不支持")
        raise ComputeError(f"AC 探针不存在：{token!r}")

    def reset(self) -> None:
        self.time = 0.0
        self.solution = np.zeros(self.matrix_size)
        self._lu_cache = None
        self._lu_matrix = None
        self._lu_col_scale = None
        self._lu_row_scale = None
        self._cached_dt = None
        self._sparse_lu = None
        self._sparse_key = None
        self.linear_reuse = 0
        self.node_voltages = {node.id: 0.0 for node in self.nodes}
        for element in self.elements:
            element.reset()
            element.result = {}
            for key in ("current", "voltage_difference", "power"):
                element.state.pop(key, None)
        self.last_iterations = 0
        self.last_solve_ms = 0.0
        self.last_residual = 0.0
        self.last_strategies = ()
        self.last_trouble = None
        self.last_scaled = False
        self.last_row_scale = None
        self.last_col_scale = None


def integration_methods() -> list[dict[str, str]]:
    return [
        {"value": "trapezoidal", "label": "梯形法（默认，精度高）"},
        {"value": "backward_euler", "label": "后向欧拉（更稳定）"},
        {"value": "gear2", "label": "Gear2 / BDF2（二阶，固定步长）"},
    ]


def node_catalog() -> list[dict[str, Any]]:
    """电路模式的节点类型。

    和元素规格一样返回「公式 + 真实源码 + 源码路径」，前端规格页才能对
    电路节点给出与实现一致的说明，而不是空白。
    """
    from ..introspection import safe_source, source_path

    entries: list[dict[str, Any]] = [
        {
            "kind": "node",
            "label": "电学节点",
            "group": "电路节点",
            "description": "一个等电位节点，数据中保存 voltage。",
            "outputs": ["voltage"],
            "notes": "节点本身没有独立算式：它的电压由整张 MNA 方程一起解出。",
            "formula": (
                "MNA：对每个非接地节点 Σ 注入电流 = 0 → G·V = I；\n"
                "解出后把 V_i 写回 data.voltage（非线性元件走 Newton 迭代）"
            ),
            "target": CircuitSolver.step,
        },
        {
            "kind": "ground",
            "label": "接地",
            "group": "电路节点",
            "description": "参考节点（0 V）。每个电路至少需要一个接地节点。",
            "outputs": [],
            "notes": "接地节点不进入未知量集合，作为矩阵的参考电位。",
            "formula": "V_ground ≡ 0（参考电位）；未知量只包含非接地节点",
            "target": CircuitSolver._build_index,
        },
    ]
    result: list[dict[str, Any]] = []
    for entry in entries:
        target = entry.pop("target")
        result.append(
            {
                **entry,
                "mode": "circuit",
                "editable": False,
                "builtin": True,
                "addable": True,
                "params": [],
                "source": safe_source(target),
                "source_path": source_path(target),
            }
        )
    return result
