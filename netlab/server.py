"""FastAPI 应用：REST 接口与静态演示页面。

服务端只执行注册表中的受控计算，不执行用户提交的代码；所有请求体先经
Pydantic 与场景层校验，错误以统一的 ``{"detail": "..."}`` 返回。
"""

from __future__ import annotations

import json
import os
import secrets
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict

from . import __version__
from .core.compute.fem import FemSimulation

#: 服务端代码版本（与 frontend/index.html 的 ?v= 对齐）；用于检测「前端已更新、后端进程仍是旧的」
APP_BUILD = __version__
from .core.common.limits import NetlabError, ValidationError
from .core.model.networks import NetworkContainer

#: 最近一次打开/保存/创建的工程目录（用于把校验报告写进它的 exports/）。
CURRENT_WORKSPACE: Path | None = None

#: 降级打开时的原始工程载荷；补回库文件后可 POST /api/project/retry 重新解析。
LAST_PROJECT: dict[str, Any] | None = None
LAST_PROJECT_LIBRARY: str | None = None
from .core.compute.simulation import default_simulation
from .core.model.templates import build_template, template_catalog  # noqa: F401 - 保留旧导入路径
from . import vscode_bridge
from .core.model.plugins import get_plugin_manager
from .server_plugins import router as plugins_router
from .server_help import build_router as build_help_router
from .server_fem import build_router as build_fem_router
from .server_blocks import build_router as build_blocks_router
from .server_analysis import build_router as build_analysis_router
from .server_preferences import build_router as build_preferences_router
from .server_tools import build_router as build_tools_router
from .server_extensions import build_router as build_extensions_router
from .server_control import build_router as build_control_router
from .server_workspace import build_router as build_workspace_router
from .server_networks import build_router as build_networks_router
from .server_scene import build_router as build_scene_router
from .server_shell import build_router as build_shell_router
from . import server_project
from .server_plotkit import (  # noqa: F401 - precompute_step_dt 保留旧导入路径
    build_router as build_plotkit_router,
    precompute_step_dt,
)


def _resolve_frontend_dir() -> Path:
    """前端资源目录：环境变量 > NetlabHome/frontend > 包内 static（历史回退）。"""
    override = os.environ.get("NETLAB_FRONTEND_DIR")
    if override:
        return Path(override)
    here = Path(__file__).resolve()
    for cand in (here.parents[1] / "frontend", here.parent / "static"):
        if (cand / "index.html").is_file():
            return cand
    return here.parent / "static"


FRONTEND_DIR = _resolve_frontend_dir()
STATIC_DIR = FRONTEND_DIR  # 兼容旧名字：前端资源已迁到 NetlabHome/frontend/
SERVICE: NetworkContainer = NetworkContainer(default_simulation(), name="网络 1")
FEM: FemSimulation = FemSimulation()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    SERVICE.ensure_thread()
    FEM.ensure_thread()
    try:
        get_plugin_manager().scan(load=True)
    except Exception:  # pragma: no cover - 插件错误不能阻止主程序启动
        pass
    try:
        yield
    finally:
        # PlotKit 同步线程持有全局 DATA_LOCK，必须在 SERVICE 之前停掉并 join，
        # 否则进程退出时它可能还在读已销毁的仿真对象。
        try:
            plotkit_bridge.stop()
        except Exception:  # pragma: no cover - plotkit 未安装或已停止
            pass
        vscode_bridge.shutdown()
        SERVICE.shutdown()
        FEM.shutdown()


app = FastAPI(
    title="Netlab 拓扑网络仿真",
    version="1.0.0",
    description="节点数据流 + 状态空间 + 节点电压法电路求解",
    lifespan=lifespan,
)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
app.include_router(plugins_router)
app.include_router(
    build_help_router(
        service=SERVICE,
        templates=template_catalog,
        docs_dir=Path(__file__).resolve().parent / "docs",
    )
)
_DESKTOP_TOKEN = os.environ.get("NETLAB_DESKTOP_TOKEN")
# 桌面会话 cookie：桌面外壳打开 ``/?token=...`` 时由宿主种下，供同源 iframe
# （PlotKit 子应用）自动携带；HttpOnly + SameSite=Strict，脚本读不到也跨站带不出。
DESKTOP_COOKIE_NAME = "netlab_desktop_token"


def _json_default(value: Any) -> Any:
    """把 NumPy 标量/数组转成原生类型；其余无法序列化的对象退化为字符串。"""
    if type(value).__module__.split(".")[0] == "numpy":  # pragma: no cover - 取决于数据
        try:
            import numpy as np
        except Exception:
            return str(value)
        if isinstance(value, np.generic):
            return value.item()
        if isinstance(value, np.ndarray):
            return value.tolist()
    if isinstance(value, (set, frozenset)):
        return list(value)
    return str(value)


def fast_json(payload: Any) -> Response:
    """直接产出紧凑 JSON，绕开 FastAPI 的 ``jsonable_encoder``。

    原因（实测见 docs/ARCHITECTURE.md「数据结构与数据通路」）：对 600 帧 ×
    7 探针的 /api/live 响应，``jsonable_encoder`` 要 10.7 ms，而 ``json.dumps``
    只要 1.5 ms（约 7 倍），且紧凑分隔符再省约 9% 字节；对 204 节点场景
    6.3 ms → 0.5 ms。返回值与默认路径的 JSON 结构完全一致（同 key、同值）。
    """
    body = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        default=_json_default,
        allow_nan=False,
    )
    return Response(content=body.encode("utf-8"), media_type="application/json")


def _set_current_workspace(root: Path) -> None:
    global CURRENT_WORKSPACE
    CURRENT_WORKSPACE = root


def _apply_project(*args: Any, **kwargs: Any) -> dict[str, Any]:
    """兼容旧导入路径；实际实现位于 netlab.server_project。"""
    return server_project.apply_project(*args, **kwargs)


# 二维有限元路由（独立包），依赖由服务端注入。
server_project.init(service=SERVICE, fem=FEM)
app.include_router(server_project.router)
app.include_router(build_fem_router(fem=FEM, fast_json=fast_json))
app.include_router(build_blocks_router(service=SERVICE, current_workspace=lambda: CURRENT_WORKSPACE))
app.include_router(build_analysis_router(service=SERVICE, current_workspace=lambda: CURRENT_WORKSPACE))
app.include_router(build_preferences_router(service=SERVICE))
app.include_router(build_tools_router())
app.include_router(build_extensions_router(service=SERVICE))
app.include_router(build_control_router(service=SERVICE))
app.include_router(build_networks_router(service=SERVICE))
app.include_router(build_scene_router(service=SERVICE, fast_json=fast_json))
app.include_router(
    build_shell_router(
        service=SERVICE,
        fem=FEM,
        fast_json=fast_json,
        static_dir=STATIC_DIR,
        app_build=APP_BUILD,
    )
)
app.include_router(
    build_workspace_router(
        service=SERVICE,
        apply_project=lambda *args, **kwargs: _apply_project(*args, **kwargs),
        set_current_workspace=_set_current_workspace,
    )
)


# 绘图子应用（可选依赖）：装了 plotkit 就挂到 /plotkit，没装则完全不出现。
try:  # pragma: no cover - 取决于环境里是否装了 plotkit
    from . import plotkit_bridge

    PLOTKIT_MOUNTED = plotkit_bridge.mount(app, SERVICE)
    if not PLOTKIT_MOUNTED:
        # 明确降级：/plotkit 下返回三态 JSON，而不是 404 / 500 / 空白页。
        plotkit_bridge.mount_fallback(app)
except Exception:  # pragma: no cover
    PLOTKIT_MOUNTED = False


def _set_plotkit_mounted(value: bool) -> None:
    """让 PlotKit 路由包在自愈重挂载后回写 server 持有的挂载状态。"""

    global PLOTKIT_MOUNTED
    PLOTKIT_MOUNTED = value


app.include_router(
    build_plotkit_router(
        service=SERVICE,
        app=app,
        build=APP_BUILD,
        mounted=lambda: PLOTKIT_MOUNTED,
        set_mounted=_set_plotkit_mounted,
    )
)


# VS Code Server（可选依赖）：按需拉起到空闲端口，前端 iframe 直接加载 /code/。
# 桌面 token 守卫只拦 /api/，前端用统一 api() 请求即可带上 X-Netlab-Token。
@app.get("/api/vscode/status")
def vscode_status(start: bool = Query(default=False)) -> dict[str, Any]:
    """查询（或按需拉起）本地 VS Code Server；start=1 时最多阻塞数秒等待就绪。"""
    return vscode_bridge.status(start_request=start)


def is_guarded_api_path(path: str) -> bool:
    """桌面 token 需要覆盖的 API 路径。

    2026-11-03 修复：绘图子应用挂在 ``/plotkit``，它的 ``/plotkit/api/*`` 与宿主
    ``/api/*`` 一样是可写接口（改 spec / 清空 / 导出）。此前守卫只判断 ``/api/``，
    子应用整套接口在桌面模式下无 token 也能调用。首页与静态资源保持公开，否则
    iframe 连页面都加载不了。
    """
    return (
        path.startswith("/api/")
        or path == "/plotkit/api"
        or path.startswith("/plotkit/api/")
    )


@app.middleware("http")
async def desktop_token_guard(request: Request, call_next):
    """桌面模式下只允许携带会话 token 的本地页面调用 API。

    token 可来自 ``X-Netlab-Token`` 请求头（宿主前端 api() 助手）或同源
    ``netlab_desktop_token`` cookie（PlotKit 子应用自己的 fetch/导航）。cookie 只在
    桌面外壳打开首页 ``/?token=...`` 且 token 匹配时种下，HttpOnly + SameSite=Strict。
    """
    path = request.url.path
    supplied = request.headers.get("x-netlab-token") or request.cookies.get(
        DESKTOP_COOKIE_NAME
    ) or ""
    if (
        _DESKTOP_TOKEN
        and is_guarded_api_path(path)
        and path != "/api/health"
        and not secrets.compare_digest(supplied, _DESKTOP_TOKEN)
    ):
        return JSONResponse(
            status_code=403,
            content={"detail": "桌面会话 token 无效，请从桌面窗口打开页面"},
        )
    response = await call_next(request)
    if _DESKTOP_TOKEN and path == "/":
        query_token = request.query_params.get("token") or ""
        if secrets.compare_digest(query_token, _DESKTOP_TOKEN):
            response.set_cookie(
                DESKTOP_COOKIE_NAME,
                _DESKTOP_TOKEN,
                path="/",
                httponly=True,
                samesite="strict",
            )
    return response


@app.exception_handler(NetlabError)
async def netlab_error_handler(_request, exc: NetlabError) -> JSONResponse:
    return JSONResponse(status_code=exc.status, content={"detail": str(exc)})


@app.exception_handler(RequestValidationError)
async def validation_error_handler(
    _request, exc: RequestValidationError
) -> JSONResponse:
    messages = []
    for error in exc.errors():
        location = ".".join(str(part) for part in error.get("loc", ()))
        messages.append(f"{location}: {error.get('msg', '不合法')}")
    return JSONResponse(
        status_code=422,
        content={"detail": "请求参数不合法：" + "；".join(messages[:5])},
    )


# ---- 请求模型 --------------------------------------------------------------
class ShutdownRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    confirm: bool = False


# 工程文件、导入/导出、校验与重试路由已拆到 netlab/server_project。


# 多网络管理路由已拆到 netlab/server_networks。


# ---- 工作台：网络状态（W1） -------------------------------------------------
class NetworkStateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: str
    network_id: str | None = None
    state_id: str | None = None
    name: str | None = None
    base: bool = False
    # W2：统一仿真设置时可显式给一套 sim，或指定来源状态。
    source_state_id: str | None = None
    sim: dict[str, Any] | None = None


@app.get("/api/network/states")
def network_states_list(network_id: str | None = None) -> dict[str, Any]:
    return SERVICE.list_states(network_id)


@app.post("/api/network/state")
def network_state_action(request: NetworkStateRequest) -> dict[str, Any]:
    action = (request.action or "").strip()
    network_id = request.network_id
    if action == "create":
        return SERVICE.create_state(
            request.name, base=request.base, network_id=network_id
        )
    if action == "duplicate":
        if not request.state_id:
            raise ValidationError("复制状态需要 state_id")
        return SERVICE.duplicate_state(
            request.state_id, request.name, network_id=network_id
        )
    if action == "rename":
        if not request.state_id:
            raise ValidationError("重命名状态需要 state_id")
        if request.name is None:
            raise ValidationError("重命名状态需要 name")
        return SERVICE.rename_state(
            request.state_id, request.name, network_id=network_id
        )
    if action == "delete":
        if not request.state_id:
            raise ValidationError("删除状态需要 state_id")
        return SERVICE.delete_state(request.state_id, network_id=network_id)
    if action == "set_base":
        if not request.state_id:
            raise ValidationError("设基准需要 state_id")
        return SERVICE.set_base_state(request.state_id, network_id=network_id)
    if action == "update":
        if not request.state_id:
            raise ValidationError("更新状态需要 state_id")
        return SERVICE.update_state(request.state_id, network_id=network_id)
    if action == "apply":
        if not request.state_id:
            raise ValidationError("切换状态需要 state_id")
        return SERVICE.apply_state(request.state_id, network_id=network_id)
    if action == "unify_sim":
        return SERVICE.unify_state_sim(
            network_id=network_id,
            source_state_id=request.source_state_id or request.state_id,
            sim=request.sim,
        )
    raise ValidationError(f"未知的状态操作：{action!r}")


# ---- 工作台：每状态预计算缓存 + 多状态对比（W2） --------------------------
class StatePrecomputeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    state_id: str
    network_id: str | None = None
    seconds: float = 5.0
    dt: float | None = None
    sample_every: int | None = None


class StateCompareRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    state_ids: list[str]
    signals: list[str] | None = None
    network_id: str | None = None


@app.post("/api/network/state/compare")
def network_state_compare(request: StateCompareRequest) -> dict[str, Any]:
    """读多状态缓存，返回共享信号组下的多子图数据（前端 canvas 渲染）。"""
    return SERVICE.compare_states(
        request.state_ids, request.signals, network_id=request.network_id
    )


@app.post("/api/network/state/precompute")
def network_state_precompute(request: StatePrecomputeRequest) -> dict[str, Any]:
    """对某状态 apply_state 后整段预计算，结果写入工程同级 .netlab-states。"""
    return SERVICE.precompute_state(
        request.state_id,
        network_id=request.network_id,
        seconds=request.seconds,
        dt=request.dt,
        sample_every=request.sample_every,
    )


@app.get("/api/network/state/cache")
def network_state_cache(network_id: str | None = None) -> dict[str, Any]:
    """列出每个状态的缓存状态（是否已算 / 帧数 / 是否失效）。"""
    return SERVICE.state_cache_status(network_id)


@app.get("/api/network/state/cache/series")
def network_state_cache_series(
    state_id: str, network_id: str | None = None
) -> dict[str, Any]:
    """按需 lazy 读取单个状态的缓存：时间轴 + 各探针序列。"""
    return SERVICE.load_state_cache(state_id, network_id=network_id)


# 工作区路由已拆到 netlab/server_workspace。


# 应用内 Python 扩展路由已拆到 netlab/server_extensions。


# 二维有限元路由已拆到 netlab/server_fem。


@app.post("/api/shutdown")
def shutdown(request: ShutdownRequest, http_request: Request) -> dict[str, Any]:
    """关闭后台线程并终止服务进程，释放监听端口。仅允许本机调用。"""
    if not request.confirm:
        raise ValidationError("关闭服务需要 confirm=true")
    if _DESKTOP_TOKEN:
        raise ValidationError("桌面模式请直接关闭窗口，不要调用 /api/shutdown")
    client = http_request.client
    host = client.host if client is not None else ""
    if host not in ("127.0.0.1", "::1", "localhost"):
        raise ValidationError("只允许从本机关闭服务")
    SERVICE.shutdown()
    FEM.shutdown()

    def terminate() -> None:
        time.sleep(0.4)
        os._exit(0)

    threading.Thread(target=terminate, name="netlab-shutdown", daemon=True).start()
    return {"ok": True, "message": "服务正在关闭，端口即将释放"}
