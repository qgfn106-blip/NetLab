"""页面外壳、UI 配置、实时状态与诊断路由。

从 ``netlab.server`` 拆出的只读/元数据域：页面入口、目录、UI 配置、插件分析入口、
``/api/state``/``/api/live``、健康检查与只读诊断。所有计算仍由调用方注入的
``service``/``fem`` 完成，本包只负责 HTTP 适配与响应格式化。
"""

from __future__ import annotations

import os
from typing import Any, Callable

from fastapi import APIRouter, Query, Response
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel, Field

from ..core.compute import accel
from ..core.compute.analysis_plugins import (
    analysis_catalog,
    run_analysis as run_plugin_analysis,
)
from ..core.compute.math_accel.diagnostics import (
    snapshot as math_accel_diagnostics_snapshot,
)
from ..core.model.engine_registry import plugin_modes
from ..core.model.plugins import get_plugin_manager
from ..core.model.templates import template_catalog
from ..core.model.ui_profile import default_ui, normalize_ui, ui_catalog


class UIProfileRequest(BaseModel):
    profile: str = "netlab-ui/1"
    mode: str = "professional"
    tokens: dict[str, str] = Field(default_factory=dict)
    layout: dict[str, float] = Field(default_factory=dict)
    node: dict[str, Any] = Field(default_factory=dict)
    edge: dict[str, Any] = Field(default_factory=dict)


class PluginAnalysisRequest(BaseModel):
    kind: str
    params: dict[str, Any] = Field(default_factory=dict)
    probes: list[str] = Field(default_factory=list)
    input_node: str | None = None
    output_node: str | None = None


def build_router(
    *,
    service: Any,
    fem: Any,
    fast_json: Callable[[Any], Response],
    static_dir: Any,
    app_build: str,
) -> APIRouter:
    router = APIRouter()

    @router.get("/", include_in_schema=False)
    def index() -> Response:
        page = static_dir / "index.html"
        if os.environ.get("NETLAB_DESKTOP_SHELL") == "pywebview":
            # 桌面壳（pywebview）需要把 Promise 风格的原生桥映射成 QWebChannel 风格；
            # 只在桌面进程里注入，浏览器访问拿到的仍是原页面。
            html = page.read_text(encoding="utf-8")
            if "desktop-shim.js" not in html:
                html = html.replace(
                    "</head>",
                    f'  <script src="/static/desktop-shim.js?v={app_build}"></script>\n</head>',
                    1,
                )
            return HTMLResponse(html, headers={"Cache-Control": "no-store"})
        return FileResponse(page, headers={"Cache-Control": "no-store"})

    @router.get("/api/catalog")
    def catalog() -> dict[str, Any]:
        manager = get_plugin_manager()
        return {
            "catalog": service.scene.catalog(),
            "templates": template_catalog(),
            "default_template": "signal_chain",
            "accel": accel.status(),
            "project": {"format_version": 7, "suffix": ".netlab"},
            "plugins": manager.summaries(),
            "plugin_catalog": manager.capability_catalog(),
            "analysis": analysis_catalog(),
            "engines": [{"mode": mode, "label": mode} for mode in plugin_modes()],
        }

    @router.get("/api/ui")
    def ui_get() -> dict[str, Any]:
        return {"current": normalize_ui(service.ui or default_ui()), **ui_catalog()}

    @router.post("/api/ui")
    def ui_set(request: UIProfileRequest) -> dict[str, Any]:
        service.ui = normalize_ui(request.model_dump())
        return {"ok": True, "current": service.ui}

    @router.post("/api/analysis/plugin")
    def analysis_plugin(request: PluginAnalysisRequest) -> dict[str, Any]:
        try:
            result = run_plugin_analysis(
                request.kind,
                scene=service.current.scene,
                simulation=service.current.simulation,
                params=request.params,
                probes=request.probes,
                input_node=request.input_node,
                output_node=request.output_node,
            )
            return {"ok": True, "result": result}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.get("/api/state")
    def state() -> Response:
        return fast_json(service.snapshot())

    @router.get("/api/live")
    def live(
        cursor: int = Query(default=0, ge=0),
        limit: int = Query(default=400, ge=1, le=600),
    ) -> Response:
        return fast_json(service.live(cursor, limit))

    @router.get("/api/health")
    def health() -> dict[str, Any]:
        return {
            "ok": True,
            "build": app_build,
            "running": service.running,
            "mode": service.scene.mode,
            "fem_running": fem.running,
        }

    @router.get("/api/diagnostics/telemetry")
    def diagnostics_telemetry() -> dict[str, Any]:
        """P5：只读遥测质量口径；不改变 /api/live 的任何字段与语义。"""
        return {"ok": True, "telemetry": service.current.telemetry_quality()}

    @router.get("/api/diagnostics/math-accel")
    def diagnostics_math_accel(
        limit: int = Query(default=50, ge=1, le=256),
    ) -> dict[str, Any]:
        """P3/P1 影子诊断事件（只读环形缓冲）。"""
        return {"ok": True, "events": math_accel_diagnostics_snapshot(limit)}

    return router
