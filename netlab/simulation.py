"""固定步长仿真循环与增量数据录制。

后台线程按目标帧率推进：每帧执行 ``steps_per_frame`` 次 ``dt`` 步长，
把探针值写入环形缓冲区，HTTP 层只读取增量帧，避免每帧全量传输。
"""

from __future__ import annotations

import copy
import math
import threading
import time
from collections import deque
from dataclasses import asdict, dataclass, field
from typing import Any, Callable

from .limits import (
    MAX_NUMBER,
    ComputeError,
    NetlabError,
    ValidationError,
    as_bool,
    as_float,
    as_int,
)
from .scene import Scene

RECORDER_CAPACITY = 1200


@dataclass
class SimConfig:
    fps: int = 30
    dt: float = 0.002
    steps_per_frame: int = 1
    #: 单步（播放器「单步」按钮）推进的仿真时间；0 表示跟随 dt（R11/D14）。
    t_step: float = 0.0
    lock_dt: bool = False
    sample_every: int = 1
    realtime: bool = True
    #: 单步计算耗时上限（ms）；0 = 关闭（R13 超时保护）。
    step_timeout_ms: float = 0.0
    # P0：MNA/Newton 收敛参数（旧工程缺省即用这些默认值）。
    reltol: float = 1.0e-9
    vntol: float = 1.0e-6
    abstol: float = 1.0e-6
    max_iter: int = 60
    #: gmin stepping 起始泄漏电导（默认 1e-3，保持旧救急行为）。
    gmin: float = 1.0e-3
    gmin_steps: int = 10
    src_steps: int = 10
    residual_tol: float = 0.0
    # P1/P2：默认开启尺度无关残差安全阈值与行列均衡。
    residual_safety_tol: float = 1.0e-8
    scaling: bool = True
    pivot_tol: float = 1.0e-14
    breakpoints: bool = True
    #: 稀疏矩阵策略：auto（按规模自动）/ on / off；无 SciPy 时自动退回稠密。
    sparse: str = "auto"
    #: auto 模式下矩阵尺寸超过该值才启用稀疏装配。
    sparse_threshold: int = 200


@dataclass
class Recorder:
    capacity: int = RECORDER_CAPACITY
    frames: deque = field(default_factory=deque)
    seq: int = 0

    def __post_init__(self) -> None:
        self.frames = deque(maxlen=self.capacity)

    def push(self, time_value: float, probes: dict[str, float]) -> None:
        if not probes:
            return
        self.seq += 1
        self.frames.append(
            {
                "seq": self.seq,
                "t": round(time_value, 9),
                "v": probes,
            }
        )

    def since(self, cursor: int, limit: int) -> list[dict[str, Any]]:
        if not self.frames:
            return []
        if cursor < 0:
            cursor = 0
        selected = [frame for frame in self.frames if frame["seq"] > cursor]
        if len(selected) > limit:
            # 均匀降采样，而不是「只留最后 limit 帧」：后者会让前端把跳过的
            # 那一段直接连成一条直线，极速模式下波形会像被削平/断裂。
            selected = self._resample(selected, limit)
        return selected

    @staticmethod
    def _resample(frames: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
        """把 ``frames`` 等间隔抽成至多 ``limit`` 帧，并保留首尾两帧。"""
        count = len(frames)
        if limit <= 0:
            return []
        if limit == 1:
            return [frames[-1]]
        if limit >= count:
            return frames
        step = (count - 1) / (limit - 1)
        picked = [min(count - 1, int(round(index * step))) for index in range(limit)]
        return [frames[position] for position in picked]

    def latest(self) -> dict[str, Any] | None:
        return self.frames[-1] if self.frames else None

    def keys(self) -> list[str]:
        frame = self.latest()
        return list(frame["v"]) if frame else []

    def clear(self) -> None:
        self.frames.clear()
        self.seq = 0

    def __len__(self) -> int:
        return len(self.frames)


class Simulation:
    """持有场景、配置、后台线程与录制数据；所有读写都在同一把锁下。"""

    def __init__(self, scene: Scene | None = None) -> None:
        self.scene = scene or Scene("signal")
        self.lock = threading.RLock()
        self.config = SimConfig()
        self.recorder = Recorder()
        self.running = False
        self.time = 0.0
        self.steps = 0
        self.error: str | None = None
        self.error_at: float | None = None
        self._frame_times: deque[float] = deque(maxlen=600)
        self._thread: threading.Thread | None = None
        self._stop = False

    # ---- 线程 -------------------------------------------------------------
    def ensure_thread(self) -> None:
        with self.lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._stop = False
            thread = threading.Thread(
                target=self._loop, name="netlab-simulation", daemon=True
            )
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
                steps_per_frame = self.config.steps_per_frame
                dt = self.config.dt
                sample_every = self.config.sample_every
                realtime = self.config.realtime
            if not running:
                time.sleep(0.008)
                continue

            started = time.perf_counter()
            with self.lock:
                if not self.running:
                    continue
                for _ in range(steps_per_frame):
                    if not self._advance_locked(dt, sample_every):
                        break
                self._frame_times.append(started)
                self._prune_frame_times(started)
            if realtime:
                period = 1.0 / max(1, fps)
                remaining = period - (time.perf_counter() - started)
                if remaining > 0:
                    time.sleep(min(remaining, 0.25))

    def _advance_locked(self, dt: float, sample_every: int) -> bool:
        timeout_ms = float(getattr(self.config, "step_timeout_ms", 0.0) or 0.0)
        started = time.perf_counter()
        step_dt = dt
        if self.config.breakpoints and self.scene.mode == "circuit":
            point = self.scene.next_breakpoint(self.time, dt)
            if point is not None:
                step_dt = max(1.0e-12, min(dt, point - self.time))
        checkpoint = self.scene.capture_checkpoint()
        try:
            self.scene.step(step_dt)
        except Exception as exc:  # 计算错误：暂停并保留现场
            self.scene.restore_checkpoint(checkpoint)
            self._record_error(exc)
            return False
        if timeout_ms > 0:
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            if elapsed_ms > timeout_ms:
                # 超时也属于失败步：场景时间/状态/解必须回到步前，不能继续漂移。
                self.scene.restore_checkpoint(checkpoint)
                self._record_error(
                    ComputeError(
                        f"单步计算超时：{elapsed_ms:.1f} ms > 上限 {timeout_ms:.1f} ms"
                        "（R13；调大上限或减小 dt）"
                    )
                )
                return False
        self.time += step_dt
        self.steps += 1
        if (
            sample_every <= 1
            or self.steps == 1
            or self.steps % sample_every == 0
        ):
            try:
                self.recorder.push(self.time, self.scene.probes())
            except Exception as exc:
                self._record_error(exc)
                return False
        return True

    def _record_error(self, exc: Exception) -> None:
        message = str(exc).strip() or type(exc).__name__
        self.error = message
        self.error_at = self.time
        self.running = False

    def _prune_frame_times(self, now: float) -> None:
        while self._frame_times and now - self._frame_times[0] > 1.0:
            self._frame_times.popleft()

    def _actual_fps(self) -> float:
        now = time.perf_counter()
        self._prune_frame_times(now)
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
            sample_every = self.config.sample_every
            count = steps if steps is not None else self._t_step_count_locked()
            count = max(1, min(1000, int(count)))
            for _ in range(count):
                if not self._advance_locked(self.config.dt, sample_every):
                    break

    def precompute(self, duration: float, dt: float | None = None, sample_every: int | None = None) -> dict[str, Any]:
        """P7-05/D48：从 0 开始预计算 0→T，填充录制帧；不改当前场景参数。"""
        with self.lock:
            if not (0.0 < float(duration) <= 120.0):
                raise ValidationError("预计算时长必须在 (0, 120] s 内")
            self.ensure_thread()
            self.running = False
            self.scene.reset()
            self.time = 0.0
            self.steps = 0
            self.error = None
            self.error_at = None
            self.recorder.clear()
            self._frame_times.clear()
            step_dt = float(dt if dt is not None else self.config.dt)
            if not (1.0e-9 <= step_dt <= 10.0):
                raise ValidationError("预计算 dt 必须在 1e-9–10 s 内")
            sample = int(sample_every if sample_every is not None else self.config.sample_every)
            sample = max(1, min(100, sample))
            count = max(1, min(200_000, int(round(float(duration) / step_dt))))
            # 录制环形缓冲只有 RECORDER_CAPACITY 帧：整段 0→T 必须装得下，
            # 否则只剩最后一段，前端看到的「起始时间」就不是 0。
            needed = int(math.ceil(count / RECORDER_CAPACITY))
            sample = max(sample, needed, 1)
            for _ in range(count):
                if not self._advance_locked(step_dt, sample):
                    break
            frames = len(self.recorder)
            first_time = self.recorder.frames[0]["t"] if frames else 0.0
            last_time = self.recorder.frames[-1]["t"] if frames else 0.0
            return {
                "steps": self.steps,
                "time": self.time,
                "frames": frames,
                "error": self.error,
                "dt": step_dt,
                "sample_every": sample,
                "first_time": first_time,
                "last_time": last_time,
            }

    def _t_step_count_locked(self) -> int:
        """T_step（秒）换算成步数；0 表示用每帧步数（R11）。"""
        t_step = float(self.config.t_step)
        dt = float(self.config.dt)
        if t_step <= 0 or dt <= 0:
            return int(self.config.steps_per_frame)
        return max(1, int(round(t_step / dt)))

    def zero_time(self) -> None:
        """时间归零：只重置计时与录制，**不清除**仿真状态（R11/D14）。"""
        with self.lock:
            self.scene.zero_time()
            self.time = 0.0
            self.steps = 0
            self.recorder.clear()
            self._frame_times.clear()
            self.error = None
            self.error_at = None

    def reset(self) -> None:
        with self.lock:
            self.scene.reset()
            self.time = 0.0
            self.steps = 0
            self.running = False
            self.error = None
            self.error_at = None
            self.recorder.clear()
            self._frame_times.clear()

    # ---- 配置 -------------------------------------------------------------
    def apply_config(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise ValidationError("配置必须是对象")
        allowed = {
            "fps",
            "dt",
            "steps_per_frame",
            "t_step",
            "lock_dt",
            "sample_every",
            "realtime",
            "step_timeout_ms",
            "reltol",
            "vntol",
            "abstol",
            "max_iter",
            "gmin",
            "gmin_steps",
            "src_steps",
            "residual_tol",
            "residual_safety_tol",
            "scaling",
            "pivot_tol",
            "breakpoints",
            "sparse",
            "sparse_threshold",
        }
        unknown = set(payload) - allowed
        if unknown:
            raise ValidationError(f"未知配置项：{', '.join(sorted(unknown))}")
        with self.lock:
            config = SimConfig(**asdict(self.config))
            if "fps" in payload:
                config.fps = as_int(payload["fps"], "帧率", lo=1, hi=240)
            if "steps_per_frame" in payload:
                config.steps_per_frame = as_int(
                    payload["steps_per_frame"], "每帧步数", lo=1, hi=200
                )
            if "dt" in payload:
                config.dt = as_float(
                    payload["dt"], "时间步长 dt", positive=True, lo=1.0e-9, hi=10.0
                )
            if "t_step" in payload:
                config.t_step = as_float(
                    payload["t_step"],
                    "单步时间 T_step",
                    nonnegative=True,
                    hi=10.0,
                )
            if "sample_every" in payload:
                config.sample_every = as_int(
                    payload["sample_every"], "采样间隔", lo=1, hi=100
                )
            if "lock_dt" in payload:
                config.lock_dt = as_bool(payload["lock_dt"], "锁定 dt")
            if "realtime" in payload:
                config.realtime = as_bool(payload["realtime"], "实时节拍")
            if "breakpoints" in payload:
                config.breakpoints = as_bool(payload["breakpoints"], "断点对齐")
            if "step_timeout_ms" in payload:
                config.step_timeout_ms = as_float(
                    payload["step_timeout_ms"],
                    "单步超时",
                    nonnegative=True,
                    hi=60_000.0,
                )
            if "reltol" in payload:
                config.reltol = as_float(
                    payload["reltol"], "相对容差 reltol", positive=True, hi=0.1
                )
            if "vntol" in payload:
                config.vntol = as_float(
                    payload["vntol"], "电压容差 vntol", positive=True, hi=1.0
                )
            if "abstol" in payload:
                config.abstol = as_float(
                    payload["abstol"], "电流容差 abstol", positive=True, hi=1.0
                )
            if "max_iter" in payload:
                config.max_iter = as_int(
                    payload["max_iter"], "Newton 迭代上限", lo=1, hi=500
                )
            if "gmin" in payload:
                config.gmin = as_float(
                    payload["gmin"], "gmin", positive=True, hi=1.0
                )
            if "gmin_steps" in payload:
                config.gmin_steps = as_int(
                    payload["gmin_steps"], "gmin 步数", lo=0, hi=100
                )
            if "src_steps" in payload:
                config.src_steps = as_int(
                    payload["src_steps"], "source 步数", lo=0, hi=100
                )
            if "residual_tol" in payload:
                config.residual_tol = as_float(
                    payload["residual_tol"], "残差容差", nonnegative=True, hi=1.0
                )
            if "residual_safety_tol" in payload:
                config.residual_safety_tol = as_float(
                    payload["residual_safety_tol"], "残差安全阈值",
                    nonnegative=True, hi=1.0,
                )
            if "scaling" in payload:
                config.scaling = as_bool(payload["scaling"], "矩阵均衡")
            if "pivot_tol" in payload:
                config.pivot_tol = as_float(
                    payload["pivot_tol"], "零主元阈值", positive=True, hi=1.0e-3
                )
            if "sparse" in payload:
                sparse_value = str(payload["sparse"]).strip().lower()
                if sparse_value not in ("auto", "on", "off"):
                    raise ValidationError("sparse 必须是 auto、on 或 off")
                config.sparse = sparse_value
            if "sparse_threshold" in payload:
                config.sparse_threshold = as_int(
                    payload["sparse_threshold"], "稀疏阈值", lo=1, hi=1_000_000
                )
            if config.lock_dt:
                config.dt = 1.0 / (config.fps * config.steps_per_frame)
            if config.dt * config.steps_per_frame > 10.0:
                raise ValidationError("每帧推进的仿真时间过大，请减小 dt 或步数")
            self.config = config
            from .nodal import SolverOptions

            self.scene.set_solver_options(
                SolverOptions(
                    reltol=config.reltol,
                    vntol=config.vntol,
                    abstol=config.abstol,
                    max_iter=config.max_iter,
                    gmin=config.gmin,
                    gmin_steps=config.gmin_steps,
                    src_steps=config.src_steps,
                    residual_tol=config.residual_tol,
                    residual_safety_tol=config.residual_safety_tol,
                    scaling=config.scaling,
                    pivot_tol=config.pivot_tol,
                    sparse=config.sparse,
                    sparse_threshold=config.sparse_threshold,
                )
            )
            self._frame_times.clear()
            return asdict(config)

    # ---- 场景替换 ---------------------------------------------------------
    def load_scene(self, payload: dict[str, Any]) -> None:
        with self.lock:
            scene = Scene(self.scene.mode)
            scene.load_payload(payload)
            scene.ensure_engine()
            self.scene = scene
            self.time = 0.0
            self.steps = 0
            self.running = False
            self.error = None
            self.error_at = None
            self.recorder.clear()
            self._frame_times.clear()
            sim_payload = payload.get("sim")
            if not isinstance(sim_payload, dict):
                sim_payload = (
                    {"fps": 30, "dt": 0.005, "steps_per_frame": 1}
                    if self.scene.mode == "signal"
                    else {"fps": 60, "dt": 1.0e-4, "steps_per_frame": 2}
                )
            self.apply_config(sim_payload)

    def mutate(self, function: Callable[[Scene], Any]) -> Any:
        with self.lock:
            result = function(self.scene)
            # 立即装配，让参数错误在本次请求内暴露，而不是等到下一帧。
            self.scene.ensure_engine()
            return result

    # ---- 分析（DC / AC，不推进仿真状态） ---------------------------------
    def operating_point(self) -> dict[str, Any]:
        with self.lock:
            return self.scene.operating_point()

    def ac_sweep(
        self,
        frequencies: list[float],
        *,
        input_source: str | None = None,
        probes: list[str] | None = None,
    ) -> dict[str, Any]:
        with self.lock:
            return self.scene.ac_sweep(
                frequencies, input_source=input_source, probes=probes
            )

    # ---- 读取 -------------------------------------------------------------
    def info(self) -> dict[str, Any]:
        with self.lock:
            return self._info_locked()

    def _info_locked(self) -> dict[str, Any]:
        config = asdict(self.config)
        try:
            scene_stats = self.scene.stats()
        except Exception as exc:  # 不应发生，但避免状态接口整体失败
            scene_stats = {"mode": self.scene.mode, "engine_error": str(exc)}
        return {
            "running": self.running,
            "time": self.time,
            "steps": self.steps,
            "actual_fps": self._actual_fps(),
            "steps_per_second": self._actual_fps() * config["steps_per_frame"],
            "config": config,
            "scene": scene_stats,
            "error": self.error,
            "error_at": self.error_at,
            "frames_recorded": len(self.recorder),
            "cursor": self.recorder.seq,
            "probe_keys": self.recorder.keys(),
        }

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {
                "scene": self.scene.runtime_state(),
                "sim": self._info_locked(),
                "limits": {"max_steps": 1000},
            }

    def live(self, cursor: int, limit: int = 400) -> dict[str, Any]:
        if not isinstance(cursor, int) or cursor < 0:
            raise ValidationError("cursor 必须是非负整数")
        limit = max(1, min(600, int(limit)))
        with self.lock:
            frames = self.recorder.since(cursor, limit)
            oldest = frames[0]["seq"] if frames else cursor
            return {
                "frames": frames,
                "cursor": self.recorder.seq,
                "oldest": oldest,
                "keys": self.recorder.keys(),
                "sim": self._info_locked(),
            }


def default_simulation() -> Simulation:
    """启动场景为空白的信号流（2026-10-28 R30：首页不再自动载入 demo）。

    示例网络仍可通过模板（``signal_chain`` 等）或引导页「打开示例工程」进入；
    启动即停止的语义由前端控制：这里只负责给出一个干净的空白场景。
    """
    from .templates import build_template

    scene = Scene("signal")
    scene.load_payload(build_template("blank_signal"))
    simulation = Simulation(scene)
    simulation.apply_config({"fps": 30, "dt": 0.01, "steps_per_frame": 1})
    return simulation
