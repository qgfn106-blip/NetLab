"""PlotKit 接入与预计算路由（D150）。

从 server.py 原样搬运，不改变路由路径、请求/响应结构或挂载自愈语义。
挂载状态仍由 server 持有，通过 ``mounted`` / ``set_mounted`` 回调注入，
避免本包反向导入 server。
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, FastAPI

from .. import plotkit_bridge

#: PlotKit 预计算的步数上限：超过就把步长降级，并把 ``degraded`` 告诉界面。
PRECOMPUTE_MAX_STEPS = 200_000


def precompute_step_dt(
    seconds: float,
    requested_dt: float,
    *,
    max_steps: int = PRECOMPUTE_MAX_STEPS,
) -> tuple[float, bool]:
    """选预计算的实际步长；返回 ``(step_dt, degraded)``。

    尊重请求的 dt，只有超过步数上限时才降级，且降级必须能被界面看见。
    """
    step_dt = float(requested_dt)
    if seconds / step_dt > max_steps:
        return seconds / max_steps, True
    return step_dt, False


def build_router(
    *,
    service: Any,
    app: FastAPI,
    build: str,
    mounted: Callable[[], bool],
    set_mounted: Callable[[bool], None],
) -> APIRouter:
    """构造 PlotKit 路由；状态读写仍由 server 的 ``PLOTKIT_MOUNTED`` 负责。"""

    router = APIRouter(tags=["plotkit"])

    def _available() -> list[str]:
        """当前场景可接入的探针通道（不需要先运行仿真）。"""
        try:
            return sorted(service.scene.probes().keys())
        except Exception:
            return []

    @router.get("/api/plotkit/diag")
    def plotkit_diag() -> dict[str, Any]:
        """PlotKit 挂载诊断：告诉前端到底缺什么，而不是笼统一句“未挂载”。"""
        return plotkit_bridge.diagnose()

    @router.get("/api/plotkit/channels")
    def plotkit_channels() -> dict[str, Any]:
        """PlotKit 面板可接入的数据通道（探针），以及当前正在画的那几条。"""
        available = _available()
        if not mounted():
            # 首次挂载可能因依赖就绪顺序失败：这里再试一次（自愈）。
            try:
                if plotkit_bridge.remount(app):
                    set_mounted(True)
            except Exception:
                pass
        if not mounted():
            return {
                "mounted": False,
                "channels": [],
                "selected": [],
                "available": available,
                "build": build,
                "diag": plotkit_bridge.diagnose(),
            }
        try:
            return {
                "mounted": True,
                "channels": plotkit_bridge.channels(),
                "selected": plotkit_bridge.selected_channels(),
                "available": available,
                "build": build,
            }
        except Exception as exc:  # pragma: no cover - 取决于运行状态
            return {
                "mounted": True,
                "channels": [],
                "selected": [],
                "available": available,
                "build": build,
                "error": str(exc),
            }

    @router.post("/api/plotkit/channels")
    def plotkit_set_channels(payload: dict[str, Any] | None = None) -> dict[str, Any]:
        """选择 PlotKit 要画的探针通道；keys 为空表示恢复自动发现。"""
        if not mounted():
            return {"ok": False, "mounted": False, "channels": [], "selected": []}
        keys = [str(k) for k in ((payload or {}).get("keys") or [])]
        ok = plotkit_bridge.set_channels(keys)
        return {
            "ok": ok,
            "mounted": True,
            "channels": plotkit_bridge.channels(),
            "selected": plotkit_bridge.selected_channels(),
        }

    @router.post("/api/plotkit/active")
    def plotkit_active(payload: dict[str, Any] | None = None) -> dict[str, Any]:
        """打开/关闭 PlotKit 的数据采样：面板不可见时不采样，省 CPU 与内存。"""
        if not mounted():
            return {"mounted": False, "active": False}
        active = bool((payload or {}).get("active", True))
        plotkit_bridge.set_active(active)
        return {"mounted": True, "active": plotkit_bridge.is_active()}

    @router.post("/api/plotkit/analysis")
    def plotkit_add_analysis(payload: dict[str, Any] | None = None) -> dict[str, Any]:
        """把 TF 阶跃/相图等分析曲线作为独立图层送进 PlotKit。"""
        if not mounted():
            return {"ok": False, "mounted": False, "reason": "PlotKit 未挂载"}
        data = payload or {}
        name = str(data.get("name") or "分析曲线")
        x = data.get("x") or []
        y = data.get("y") or []
        try:
            result = plotkit_bridge.add_analysis_curve(
                name,
                x,
                y,
                x_label=str(data.get("x_label") or "t / s"),
                y_label=str(data.get("y_label") or "value"),
            )
        except Exception as exc:
            return {"ok": False, "mounted": True, "reason": str(exc)}
        return {"ok": True, "mounted": True, "result": result}

    @router.post("/api/plotkit/precompute")
    def plotkit_precompute(payload: dict[str, Any] | None = None) -> dict[str, Any]:
        """接入 PlotKit 前先把 0→T 的整段数据算出来并登记（仿真保持停止）。"""
        seconds = float((payload or {}).get("seconds") or 5.0)
        if seconds <= 0:
            seconds = 5.0
        started = time.perf_counter()
        try:
            try:
                cfg = (service.snapshot().get("sim") or {}).get("config") or {}
            except Exception:
                cfg = {}
            raw_dt = (payload or {}).get("dt")
            requested_dt = (
                float(raw_dt) if raw_dt is not None else float(cfg.get("dt") or 0.01)
            )
            if not (1.0e-9 <= requested_dt <= 10.0):
                requested_dt = 0.01
            step_dt, degraded = precompute_step_dt(seconds, requested_dt)
            result = service.precompute(seconds, dt=step_dt) or {}
            result.update(
                {
                    "requested_dt": requested_dt,
                    "dt_used": step_dt,
                    "degraded": degraded,
                }
            )
        except Exception as exc:  # pragma: no cover - 取决于场景
            return {"ok": False, "seconds": seconds, "error": str(exc)}
        elapsed = (time.perf_counter() - started) * 1000.0
        merged = {"seconds": seconds, "elapsed_ms": round(elapsed, 1), **result}
        # SERVICE.precompute 中途失败时返回带 error 的部分结果，保留 ok=False。
        merged["ok"] = not result.get("error")
        try:
            merged["sim"] = service.info()
        except Exception:  # pragma: no cover - info() 不应失败
            pass
        return merged

    @router.get("/api/precompute/progress")
    def precompute_progress() -> dict[str, Any]:
        """只读预计算进度快照（线程安全，不获取仿真锁）。"""
        try:
            snapshot = service.active_precompute_progress()
        except Exception:  # pragma: no cover - 无网络/场景异常时兜底
            snapshot = {
                "status": "idle",
                "running": False,
                "done": 0,
                "total": 0,
                "percent": 0.0,
            }
        return {"ok": True, **snapshot}

    return router
