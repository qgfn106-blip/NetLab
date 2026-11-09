"""固定步长仿真循环与增量数据录制。

后台线程按目标帧率推进：每帧执行 ``steps_per_frame`` 次 ``dt`` 步长，
把探针值写入环形缓冲区，HTTP 层只读取增量帧，避免每帧全量传输。
"""

from __future__ import annotations

import math
import threading
import time
import uuid
from collections import deque
from dataclasses import asdict, dataclass, field
from typing import Any, Callable, ClassVar

from ..common.limits import (
    MAX_PRECOMPUTE_STEPS,
    ComputeError,
    ValidationError,
    as_bool,
    as_float,
    as_int,
)
from ..model.scene import Scene
from .clock import SimClock
from .telemetry_quality import (
    fifo_delay_bound,
    interpolation_error_bound,
    sample_dt_from_frames,
)

#: 录制环形缓冲的帧数上限。2026-11-03：1200 → 6000。
#: 预计算按这个容量反推 ``sample_every``（整段 0→T 必须装得下），所以它同时
#: 就是「一次预计算最多保留多少采样点」的上限：容量太小的话，把 dt 调小只会
#: 让 sample_every 变大，曲线点数不变，用户看到的精度自然毫无变化。
RECORDER_CAPACITY = 6000


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
    #: auto 模式下矩阵尺寸超过该值才启用稀疏装配。当前 LIL 装配在 ≤400 节点反而更慢，
    #: 默认提高到 512；显式 on/off 不受影响（P0）。
    sparse_threshold: int = 512

    #: A-3 / N-06：把“数值参数”和“呈现参数”分开。字段仍保留在平铺 dataclass 中，
    #: 以免破坏旧工程/HTTP 配置契约；调用方通过下面两个快照方法取得分组。
    NUMERICAL_FIELDS: ClassVar[tuple[str, ...]] = (
        "dt",
        "lock_dt",
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
    )
    PRESENTATION_FIELDS: ClassVar[tuple[str, ...]] = (
        "fps",
        "steps_per_frame",
        "t_step",
        "sample_every",
        "realtime",
    )

    def numerical_params(self) -> dict[str, Any]:
        """只包含影响求解器数值行为的参数。"""
        return {name: getattr(self, name) for name in self.NUMERICAL_FIELDS}

    def presentation_params(self) -> dict[str, Any]:
        """只包含帧率、采样、播放等呈现参数。"""
        return {name: getattr(self, name) for name in self.PRESENTATION_FIELDS}


@dataclass
class Recorder:
    capacity: int = RECORDER_CAPACITY
    frames: deque = field(default_factory=deque)
    seq: int = 0
    #: 记录器代次。``clear()`` 之后 seq 会从 0 重新开始，只看整数 cursor 无法区分
    #: 「同一段记录的追加」和「换了一段新记录」；代次给增量读取方一个可靠的身份。
    generation: str = field(
        default_factory=lambda: uuid.uuid4().hex,
        init=False,
        repr=False,
        compare=False,
    )
    #: P5 遥测质量口径：当前链路无量化/压缩；字段固定，供
    #: ``/api/diagnostics/telemetry`` 只读查询，不进入 ``/api/live``。
    quality: dict[str, Any] = field(
        default_factory=lambda: {
            "sample_dt": None,
            "quant_bits": None,
            "interp_error_bound": None,
            "interp_error_bound_method": "requires_M2_upper_bound",
            "fifo_depth": None,
            "delay_bound": None,
            "delay_bound_method": "requires_fifo_service_model",
            "assumptions": [
                "当前 /api/live 链路无量化/压缩（quant_bits=None）",
                "interp_error_bound 需要 M=max|f''| 上界，未估计时为 null",
                "delay_bound 需要 FIFO 服务参数，未建模时为 null",
            ],
        }
    )

    def __post_init__(self) -> None:
        self.frames = deque(maxlen=self.capacity)
        #: 探针名缓存：帧结构一旦确定就复用同一个 list，避免每拍/每次轮询重建。
        self._keys: list[str] | None = None
        self.quality["fifo_depth"] = self.capacity

    def push(
        self,
        time_value: float,
        probes: dict[str, float],
        sample_dt: float | None = None,
    ) -> None:
        if not probes:
            return
        self.seq += 1
        if (
            self._keys is None
            or len(self._keys) != len(probes)
            or any(key not in probes for key in self._keys)
        ):
            self._keys = list(probes)
        if sample_dt is not None:
            self.quality["sample_dt"] = round(float(sample_dt), 12)
        self.frames.append(
            {
                "seq": self.seq,
                "t": round(time_value, 9),
                "v": probes,
            }
        )

    def snapshot(self) -> dict[str, Any]:
        """原子预计算用：保存帧、序号、键缓存与质量元数据。"""
        return {
            "frames": list(self.frames),
            "seq": self.seq,
            "keys": list(self._keys) if self._keys is not None else None,
            "quality": dict(self.quality),
        }

    def restore(self, snapshot: dict[str, Any]) -> None:
        self.frames = deque(snapshot["frames"], maxlen=self.capacity)
        self.seq = int(snapshot["seq"])
        keys = snapshot.get("keys")
        self._keys = list(keys) if keys is not None else None
        self.quality.update(snapshot.get("quality") or {})

    def since(self, cursor: int, limit: int) -> list[dict[str, Any]]:
        if not self.frames:
            return []
        if cursor < 0:
            cursor = 0
        # 帧按 seq 严格递增且尾部最新：从尾向头收集，遇到 <= cursor 立即停。
        # 每次轮询通常只有个位数新帧，所以这是 O(新帧数)，不再整窗扫描 5000 帧。
        selected: list[dict[str, Any]] = []
        last_seq = self.seq
        # deque 的 reversed() 是 O(1) 逐步的，不复制。
        for frame in reversed(self.frames):
            if frame["seq"] <= cursor:
                break
            selected.append(frame)
            # 已经能覆盖 [cursor+1, last_seq] 的全部帧（seq 连续），无需再往前。
            if len(selected) >= last_seq - cursor:
                break
        selected.reverse()
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
        if self._keys is not None:
            return list(self._keys)
        frame = self.latest()
        return list(frame["v"]) if frame else []

    def clear(self) -> None:
        self.frames.clear()
        self._keys = None
        self.seq = 0
        self.quality["sample_dt"] = None
        # 每次清空都换一个代次：即使清空时一帧都没录过（seq 不变），下游也能
        # 看出这是新的一段记录。
        self.generation = uuid.uuid4().hex

    def quality_snapshot(self) -> dict[str, Any]:
        """P5：只读遥测质量元数据快照（不改变录制状态）。

        误差界按当前录制窗口现场计算，因此不需要在每次 ``push`` 时增加开销；
        ``interp_error_bound`` 是样本二阶差分派生的估计（见模块
        :mod:`netlab.core.compute.telemetry_quality`），不是未观测极值的证书。
        """
        sample_dt = self.quality["sample_dt"]
        if sample_dt is None:
            sample_dt = sample_dt_from_frames(self.frames)
        interp_bound = interpolation_error_bound(self.frames)
        delay_bound = fifo_delay_bound(self.capacity, sample_dt, len(self.frames))
        if interp_bound is None:
            interp_method = "insufficient_samples"
        else:
            interp_method = "sample_second_difference/8"
        if delay_bound is None:
            delay_method = "insufficient_samples"
        else:
            delay_method = "capacity_x_sample_dt"
        assumptions = [
            "当前 /api/live 链路无量化/压缩（quant_bits=None 表示未启用量化）",
            "interp_error_bound=max|Δ²y|/8，基于均匀采样假设与观测到的最坏二阶差分；"
            "不是对采样点之间未观测极值的严格证书",
            "delay_bound=capacity×sample_dt，表示读取 FIFO 窗口最旧帧的最大数据年龄；"
            "不含磁盘/网络传输延迟",
        ]
        return {
            "sample_dt": sample_dt,
            "quant_bits": self.quality["quant_bits"],
            "interp_error_bound": interp_bound,
            "interp_error_bound_method": interp_method,
            "fifo_depth": self.quality["fifo_depth"],
            "delay_bound": delay_bound,
            "delay_bound_method": delay_method,
            "assumptions": assumptions,
            "frames_recorded": len(self.frames),
            "capacity": self.capacity,
            "probe_keys": self.keys(),
        }

    def __len__(self) -> int:
        return len(self.frames)


class Simulation:
    """持有场景、配置、后台线程与录制数据；所有读写都在同一把锁下。"""

    def __init__(self, scene: Scene | None = None) -> None:
        self.scene = scene or Scene("signal")
        self.lock = threading.RLock()
        self.config = SimConfig()
        self.recorder = Recorder()
        self._last_sample_time: float | None = None
        self.running = False
        self._clock: SimClock = self.scene.clock
        self.steps = 0
        self.error: str | None = None
        self.error_at: float | None = None
        self._frame_times: deque[float] = deque(maxlen=600)
        self._thread: threading.Thread | None = None
        self._stop = False
        self._precompute_cancel = threading.Event()
        # 预计算进度：独立的小粒度锁 + 状态字典。precompute 执行期间会全程持有
        # self.lock，因此进度查询（GET /api/precompute/progress）必须只读这份
        # 结构、绝不碰 self.lock，否则会被整个预计算阻塞。
        self._progress_lock = threading.Lock()
        self._precompute_progress: dict[str, Any] = {
            "status": "idle",  # idle|starting|running|done|cancelled|error
            "running": False,
            "done": 0,
            "total": 0,
            "percent": 0.0,
            "elapsed": 0.0,
            "eta": None,
            "seconds": 0.0,
            "error": None,
            "started_at": None,
            "updated_at": 0.0,
        }

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
        deadline = started + timeout_ms / 1000.0 if timeout_ms > 0 else None
        try:
            self.scene.step(step_dt, deadline=deadline)
        except Exception as exc:  # 计算错误：暂停并保留现场
            self.scene.rollback_last_step()
            self._record_error(exc)
            return False
        if timeout_ms > 0:
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            if elapsed_ms > timeout_ms:
                # 超时也属于失败步：场景时间/状态/解必须回到步前，不能继续漂移。
                self.scene.rollback_last_step()
                self._record_error(
                    ComputeError(
                        f"单步计算超时：{elapsed_ms:.1f} ms > 上限 {timeout_ms:.1f} ms"
                        "（R13；调大上限或减小 dt）"
                    )
                )
                return False
        # The engine advances the shared SimClock exactly once per successful
        # step.  Do not advance it again here; doing so was the old source of
        # Simulation.time vs Network/CircuitSolver.time drift.
        self.steps += 1
        if sample_every <= 1 or self.steps == 1 or self.steps % sample_every == 0:
            # 断点截断会产生短于 dt 的真实步长；sample_dt 必须记录两次采样
            # 之间的真实时间差，不能用名义步长冒充（N-06：观测层不得掩盖
            # 求解器实际步长序列）。
            # 第一次采样只跨过当前这一步；不能把 sample_every 乘进第一帧，
            # 否则首帧的 sample_dt 会被伪造成未来窗口长度（N-06）。
            sample_dt = step_dt
            if self._last_sample_time is not None:
                sample_dt = max(1.0e-12, self.time - self._last_sample_time)
            try:
                self.recorder.push(
                    self.time,
                    self.scene.probes(by_id=True),
                    sample_dt=sample_dt,
                )
                self._last_sample_time = self.time
            except Exception as exc:
                # 录制失败时，场景已经推进但帧缺失；回滚整步并回退步数，
                # 保证 steps / scene 时间 / 录制帧三者一致。
                self.scene.rollback_last_step()
                self.steps = max(0, self.steps - 1)
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

    def cancel_precompute(self) -> None:
        """请求中断当前预计算；不持有仿真锁，供 API 的并发取消请求使用。"""
        self._precompute_cancel.set()

    # ---- 预计算进度 -------------------------------------------------------
    def _progress_update(self, **fields: Any) -> None:
        """写入进度字段；只取小粒度进度锁，快速返回。"""
        fields["updated_at"] = time.time()
        with self._progress_lock:
            self._precompute_progress.update(fields)

    def precompute_progress(self) -> dict[str, Any]:
        """只读进度快照：仅取进度锁，绝不获取仿真自旋锁 self.lock。

        precompute 在后台同步执行期间全程持有 self.lock，因此本方法能在预计算
        阻塞期间被 HTTP 线程安全地并发调用，用于界面轮询进度条。
        """
        with self._progress_lock:
            snap = dict(self._precompute_progress)
        started_at = snap.pop("started_at", None)
        total = int(snap.get("total") or 0)
        done = int(snap.get("done") or 0)
        if total > 0:
            snap["percent"] = round(min(100.0, done * 100.0 / total), 1)
        if snap.get("status") == "running" and started_at is not None:
            elapsed = max(0.0, time.perf_counter() - float(started_at))
            snap["elapsed"] = round(elapsed, 3)
            if done > 0 and total > done:
                snap["eta"] = round(elapsed * (total - done) / done, 2)
            else:
                snap["eta"] = None
        return snap

    def precompute(
        self, duration: float, dt: float | None = None, sample_every: int | None = None
    ) -> dict[str, Any]:
        """P7-05/D48：从 0 开始预计算 0→T，填充录制帧；不改当前场景参数。"""
        with self.lock:
            # 立即把进度切到 starting，避免前端在本次执行真正开始前读到上一轮
            # 遗留的 done/cancelled 快照而误判完成。校验失败时保持 starting 也
            # 无害：POST 会返回错误，前端按 Promise 结束收掉进度条。
            try:
                _duration_hint = float(duration)
            except (TypeError, ValueError):
                _duration_hint = 0.0
            self._progress_update(
                status="starting",
                running=False,
                done=0,
                total=0,
                percent=0.0,
                elapsed=0.0,
                eta=None,
                seconds=_duration_hint,
                error=None,
                started_at=None,
            )
            # 先完成全部校验，再动任何状态：被拒绝的预计算不能清空当前录制帧
            # 或重置场景，否则用户只是填错参数就会丢掉已经跑出的结果。
            duration = float(duration)
            if not (0.0 < duration <= 120.0):
                raise ValidationError("预计算时长必须在 (0, 120] s 内")
            step_dt = float(dt if dt is not None else self.config.dt)
            if not (1.0e-9 <= step_dt <= 10.0):
                raise ValidationError("预计算 dt 必须在 1e-9–10 s 内")
            sample = int(
                sample_every if sample_every is not None else self.config.sample_every
            )
            sample = max(1, min(100, sample))
            count = max(1, int(round(duration / step_dt)))
            if count > MAX_PRECOMPUTE_STEPS:
                raise ValidationError(
                    f"预计算步数超过 {MAX_PRECOMPUTE_STEPS}；请增大 dt、缩短 duration，或分段预计算"
                )
            # 录制环形缓冲只有 RECORDER_CAPACITY 帧：整段 0→T 必须装得下，
            # 否则只剩最后一段，前端看到的「起始时间」就不是 0。
            needed = int(math.ceil(count / RECORDER_CAPACITY))
            sample = max(sample, needed, 1)
            self.ensure_thread()
            self.running = False
            # 原子预计算：成功才替换；取消/异常恢复旧场景与旧录制。
            before_scene = self.scene.to_payload()
            before_time = self.time
            before_steps = self.steps
            before_last_sample = self._last_sample_time
            before_recorder = self.recorder.snapshot()
            before_error = self.error
            before_error_at = self.error_at
            self.scene.reset()
            self.time = 0.0
            self.steps = 0
            self.error = None
            self.error_at = None
            self.recorder.clear()
            self._last_sample_time = None
            self._frame_times.clear()
            self._precompute_cancel.clear()
            cancelled = False
            started_at = time.perf_counter()
            self._progress_update(
                status="running",
                running=True,
                done=0,
                total=count,
                percent=0.0,
                elapsed=0.0,
                eta=None,
                started_at=started_at,
                seconds=duration,
                error=None,
            )
            # 约 200 次进度刷新即可（写进度只取小锁，开销可忽略），避免每步都写。
            update_every = max(1, count // 200)
            processed = 0
            for index in range(count):
                if self._precompute_cancel.is_set():
                    cancelled = True
                    break
                if not self._advance_locked(step_dt, sample):
                    break
                processed = index + 1
                if processed % update_every == 0 or processed == count:
                    elapsed = time.perf_counter() - started_at
                    pct = processed * 100.0 / count if count else 0.0
                    eta = (
                        elapsed * (count - processed) / processed
                        if processed
                        else None
                    )
                    self._progress_update(
                        done=processed,
                        percent=round(pct, 1),
                        elapsed=round(elapsed, 3),
                        eta=(round(eta, 2) if eta is not None else None),
                    )
            if cancelled or self.error:
                self.scene.load_payload(before_scene)
                self.time = before_time
                self.steps = before_steps
                self._last_sample_time = before_last_sample
                self.recorder.restore(before_recorder)
                if cancelled:
                    self.error = before_error
                    self.error_at = before_error_at
                self._frame_times.clear()
            frames = len(self.recorder)
            first_time = self.recorder.frames[0]["t"] if frames else 0.0
            last_time = self.recorder.frames[-1]["t"] if frames else 0.0
            elapsed_total = time.perf_counter() - started_at
            status = "cancelled" if cancelled else ("error" if self.error else "done")
            final_done = processed if (cancelled or self.error) else count
            self._progress_update(
                status=status,
                running=False,
                done=final_done,
                total=count,
                percent=(
                    round(min(100.0, final_done * 100.0 / count), 1)
                    if count
                    else 0.0
                ),
                elapsed=round(elapsed_total, 3),
                eta=0.0 if status == "done" else None,
                error=self.error,
                started_at=None,
            )
            return {
                "steps": self.steps,
                "time": self.time,
                "frames": frames,
                "error": self.error,
                "dt": step_dt,
                "sample_every": sample,
                "first_time": first_time,
                "last_time": last_time,
                "cancelled": cancelled,
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
            self._last_sample_time = None
            self._frame_times.clear()
            self.error = None
            self.error_at = None

    @property
    def time(self) -> float:
        return self._clock.time

    @time.setter
    def time(self, value: float) -> None:
        self._clock.time = value

    def reset(self) -> None:
        with self.lock:
            self.scene.reset()
            self.time = 0.0
            self.steps = 0
            self.running = False
            self.error = None
            self.error_at = None
            self.recorder.clear()
            self._last_sample_time = None
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
                config.gmin = as_float(payload["gmin"], "gmin", positive=True, hi=1.0)
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
                    payload["residual_safety_tol"],
                    "残差安全阈值",
                    nonnegative=True,
                    hi=1.0,
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
            self._clock = scene.clock
            self.time = 0.0
            self.steps = 0
            self.running = False
            self.error = None
            self.error_at = None
            self.recorder.clear()
            self._last_sample_time = None
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
            # 稳定 id 键（N-08/A-5）：前端用它做选择、取帧数据；
            # 显示名另走 probe_labels，改名不会改变通道身份。
            "probe_keys": self.recorder.keys(),
            "probe_labels": {
                key: self.scene.channel_display_name(key)
                for key in self.recorder.keys()
            },
        }

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {
                "scene": self.scene.runtime_state(),
                "sim": self._info_locked(),
                "limits": {"max_steps": 1000},
            }

    def telemetry_quality(self) -> dict[str, Any]:
        """P5：只读遥测质量口径（采样/量化/插值/FIFO），不进入 /api/live。"""
        with self.lock:
            payload = self.recorder.quality_snapshot()
            payload["sim_time"] = self.time
            payload["steps"] = self.steps
            payload["running"] = self.running
            return payload

    def live(self, cursor: int, limit: int = 400) -> dict[str, Any]:
        if not isinstance(cursor, int) or cursor < 0:
            raise ValidationError("cursor 必须是非负整数")
        limit = max(1, min(RECORDER_CAPACITY, int(limit)))
        with self.lock:
            raw_frames = self.recorder.since(cursor, limit)
            # 记录器内部保存稳定 id 键；对外帧数据映射到当前显示名，避免节点
            # 改名后旧帧与新帧被拆成两个通道（N-08/A-5）。sim.probe_keys 保持
            # 稳定键，sim.probe_labels 提供 id→显示名映射供前端解码。
            frames = []
            for frame in raw_frames:
                item = dict(frame)
                item["v"] = {
                    self.scene.channel_display_name(key): value
                    for key, value in frame.get("v", {}).items()
                }
                frames.append(item)
            oldest = frames[0]["seq"] if frames else cursor
            return {
                "frames": frames,
                "cursor": self.recorder.seq,
                "oldest": oldest,
                "keys": [self.scene.channel_display_name(key) for key in self.recorder.keys()],
                # 同一把锁里取代次：调用方据此判断「这段增量属于哪一段记录」。
                "generation": self.recorder.generation,
                "sim": self._info_locked(),
            }


def default_simulation() -> Simulation:
    """启动场景为空白的信号流（2026-10-28 R30：首页不再自动载入 demo）。

    示例网络仍可通过模板（``signal_chain`` 等）或引导页「打开示例工程」进入；
    启动即停止的语义由前端控制：这里只负责给出一个干净的空白场景。
    """
    from ..model.templates import build_template

    scene = Scene("signal")
    scene.load_payload(build_template("blank_signal"))
    simulation = Simulation(scene)
    simulation.apply_config({"fps": 30, "dt": 0.01, "steps_per_frame": 1})
    return simulation
