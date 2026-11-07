"""FastAPI 应用：REST 接口与静态演示页面。

服务端只执行注册表中的受控计算，不执行用户提交的代码；所有请求体先经
Pydantic 与场景层校验，错误以统一的 ``{"detail": "..."}`` 返回。
"""

from __future__ import annotations

import copy
import json
import os
import secrets
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from fastapi import Body, FastAPI, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from .core.compute.fem import FemSimulation

#: 服务端代码版本（与 frontend/index.html 的 ?v= 对齐）；用于检测「前端已更新、后端进程仍是旧的」
APP_BUILD = "3.20.1"
from .core.common.limits import (
    ConflictError,
    NetlabError,
    NotFoundError,
    ValidationError,
)
from .core.model.networks import NetworkContainer
from .core.model.project import (
    compute_checksum,
    migrate_scene_to_devices,
    project_current_network,
    validate_project,
)
from .core.model.workspace import (
    create_project,
    list_snapshots,
    load_settings,
    load_snapshot,
    load_workspace,
    prune_snapshots,
    save_settings,
    save_workspace,
    scan_block_references,
    scan_library,
    settings_file,
    workspace_for,
    write_snapshot,
)

#: 最近一次打开/保存/创建的工程目录（用于把校验报告写进它的 exports/）。
CURRENT_WORKSPACE: Path | None = None

#: 降级打开时的原始工程载荷；补回库文件后可 POST /api/project/retry 重新解析。
LAST_PROJECT: dict[str, Any] | None = None
LAST_PROJECT_LIBRARY: str | None = None
from .core.compute.simulation import default_simulation
from .core.model.templates import TEMPLATES, build_template, template_catalog
from . import vscode_bridge
from .core.compute import accel, analysis, profiling
from .core.compute.math_accel.diagnostics import (
    snapshot as math_accel_diagnostics_snapshot,
)
from .core.model import block_validate, blocklib, extensions, schematic
from .core.model.plugins import get_plugin_manager
from .core.model.engine_registry import plugin_modes
from .core.model.ui_profile import default_ui, normalize_ui, ui_catalog
from .core.model.blocks import (
    build_block_from_scene,
    encapsulate_nodes,
    instantiate_block,
)
from .core.compute.analysis_plugins import (
    analysis_catalog,
    run_analysis as run_plugin_analysis,
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
_DESKTOP_TOKEN = os.environ.get("NETLAB_DESKTOP_TOKEN")


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


# 绘图子应用（可选依赖）：装了 plotkit 就挂到 /plotkit，没装则完全不出现。
try:  # pragma: no cover - 取决于环境里是否装了 plotkit
    from . import plotkit_bridge

    PLOTKIT_MOUNTED = plotkit_bridge.mount(app, SERVICE)
except Exception:  # pragma: no cover
    PLOTKIT_MOUNTED = False


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
    """桌面模式下只允许携带会话 token 的本地页面调用 API。"""
    path = request.url.path
    if (
        _DESKTOP_TOKEN
        and is_guarded_api_path(path)
        and path != "/api/health"
        and not secrets.compare_digest(
            request.headers.get("x-netlab-token") or "", _DESKTOP_TOKEN
        )
    ):
        return JSONResponse(
            status_code=403,
            content={"detail": "桌面会话 token 无效，请从桌面窗口打开页面"},
        )
    return await call_next(request)


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
class NodeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    kind: str = "manual"
    params: dict[str, Any] = Field(default_factory=dict)
    data: dict[str, Any] = Field(default_factory=dict)
    position: dict[str, float] | None = None
    size: dict[str, float] | None = None


class NodeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    kind: str | None = None
    params: dict[str, Any] | None = None
    data: dict[str, Any] | None = None
    position: dict[str, float] | None = None
    size: dict[str, float] | None = None
    appearance: dict[str, Any] | None = None


class EdgeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: str
    target: str
    kind: str
    name: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    delay: bool = False
    enabled: bool = True
    auto_delay: bool = True
    route: str = "auto"
    waypoints: list[dict[str, float]] = Field(default_factory=list)
    anchors: dict[str, str] = Field(default_factory=dict)
    pins: dict[str, str] | None = None
    layout: dict[str, Any] | None = None
    source_pin: str = ""
    target_pin: str = ""
    source_port: str = ""
    target_port: str = ""


class EdgeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    kind: str | None = None
    params: dict[str, Any] | None = None
    delay: bool | None = None
    enabled: bool | None = None
    source: str | None = None
    target: str | None = None
    route: str | None = None
    waypoints: list[dict[str, float]] | None = None
    anchors: dict[str, str] | None = None
    pins: dict[str, str] | None = None
    layout: dict[str, Any] | None = None
    source_pin: str | None = None
    target_pin: str | None = None
    source_port: str | None = None
    target_port: str | None = None
    appearance: dict[str, Any] | None = None


class PositionItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    position: dict[str, float]


class PositionsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    positions: list[PositionItem]


class ConfigUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fps: int | None = None
    dt: float | None = None
    steps_per_frame: int | None = None
    t_step: float | None = None
    lock_dt: bool | None = None
    sample_every: int | None = None
    realtime: bool | None = None
    step_timeout_ms: float | None = None
    reltol: float | None = None
    vntol: float | None = None
    abstol: float | None = None
    max_iter: int | None = None
    gmin_steps: int | None = None
    src_steps: int | None = None
    residual_tol: float | None = None
    breakpoints: bool | None = None
    sparse: Literal["auto", "on", "off"] | None = None
    sparse_threshold: int | None = None


class SolveWindowRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    duration: float
    dt: float | None = None
    sample_every: int | None = None


class ControlRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal[
        "run", "pause", "toggle", "step", "reset", "zero", "cancel_precompute"
    ]
    steps: int | None = None


class ModeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["signal", "circuit", "vector"]


class IntegrationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    integration: Literal["trapezoidal", "backward_euler", "gear2"]


class ShutdownRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    confirm: bool = False


class FemConfigUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    nx: int | None = None
    ny: int | None = None
    dt: float | None = None
    fps: int | None = None
    steps_per_frame: int | None = None
    sample_every: int | None = None
    conductivity: float | None = None
    capacity: float | None = None
    source_amplitude: float | None = None
    source_frequency: float | None = None
    source_sigma: float | None = None
    source_x: float | None = None
    boundary_left: float | None = None
    boundary_right: float | None = None
    initial_temperature: float | None = None


class ProjectExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    ui: dict[str, Any] = Field(default_factory=dict)
    blocks: list[dict[str, Any]] = Field(default_factory=list)
    extensions: list[dict[str, Any]] = Field(default_factory=list)
    plugins: list[dict[str, Any]] = Field(default_factory=list)
    created: str | None = None


class ProjectImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project: dict[str, Any]
    trust_extensions: bool = False


class AccelRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    policy: Literal["auto", "cpu", "gpu"]


class ExtensionValidateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    filename: str = "<netlab-extension>"


class ExtensionActivateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    filename: str = "<netlab-extension>"
    persist: bool = False
    kind_type: Literal["node", "method"] = "node"


class ExtensionDeactivateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: str
    remove_file: bool = False


# ---- 页面与元数据 ----------------------------------------------------------
@app.get("/", include_in_schema=False)
def index() -> Response:
    page = STATIC_DIR / "index.html"
    if os.environ.get("NETLAB_DESKTOP_SHELL") == "pywebview":
        # 桌面壳（pywebview）需要把 Promise 风格的原生桥映射成 QWebChannel 风格；
        # 只在桌面进程里注入，浏览器访问拿到的仍是原页面。
        html = page.read_text(encoding="utf-8")
        if "desktop-shim.js" not in html:
            html = html.replace(
                "</head>",
                f'  <script src="/static/desktop-shim.js?v={APP_BUILD}"></script>\n</head>',
                1,
            )
        return HTMLResponse(html, headers={"Cache-Control": "no-store"})
    return FileResponse(page, headers={"Cache-Control": "no-store"})


@app.get("/api/help/search")
def help_search(
    q: str = Query("", max_length=80), limit: int = Query(20, ge=1, le=50)
) -> dict[str, Any]:
    """R14：跨元件/节点/模板/文档的只读搜索。"""
    needle = q.strip().casefold()
    if not needle:
        return {"q": q, "items": [], "count": 0}
    items: list[dict[str, Any]] = []
    kind_labels = {
        "element": "元件",
        "circuit_node": "电路节点",
        "compute": "计算",
        "method": "方法",
        "template": "模板",
        "doc": "文档",
    }
    kind_rank = {
        "element": 0,
        "circuit_node": 1,
        "compute": 2,
        "method": 3,
        "template": 4,
        "doc": 5,
    }

    def push(
        kind: str,
        title: str,
        subtitle: str,
        text: str,
        score: int,
        **extra: Any,
    ) -> None:
        items.append(
            {
                "kind": kind,
                "kind_label": kind_labels.get(kind, kind),
                "title": title,
                "subtitle": subtitle,
                "text": text,
                "score": score,
                **extra,
            }
        )

    catalog = SERVICE.scene.catalog()
    for kind_key, rows in (
        ("element", catalog.get("elements", [])),
        ("circuit_node", catalog.get("circuit_nodes", [])),
        ("compute", catalog.get("computes", [])),
        ("method", catalog.get("methods", [])),
    ):
        for row in rows:
            haystack = " ".join(
                str(row.get(key, ""))
                for key in ("kind", "label", "description", "formula", "notes", "group")
            ).casefold()
            if needle not in haystack:
                continue
            title = str(row.get("label") or row.get("kind") or "")
            kind_text = str(row.get("kind", "")).casefold()
            title_text = title.casefold()
            if needle == kind_text:
                rank = 10
            elif kind_text.startswith(needle):
                rank = 8
            elif needle in title_text:
                rank = 6
            elif needle in haystack.split(" ", 1)[0]:
                rank = 4
            else:
                rank = 2
            push(
                kind_key,
                title,
                f"{row.get('kind', '')} · {row.get('group', '')}",
                str(row.get("description") or row.get("formula") or ""),
                rank,
                ref=str(row.get("kind") or ""),
                group=str(row.get("group") or ""),
            )
    for row in template_catalog():
        haystack = f"{row.get('id', '')} {row.get('name', '')} {row.get('description', '')}".casefold()
        if needle not in haystack:
            continue
        name_text = str(row.get("name") or "").casefold()
        rank = 7 if name_text.startswith(needle) else 5 if needle in name_text else 3
        push(
            "template",
            str(row.get("name") or row.get("id") or ""),
            f"模板 · {row.get('mode', '')}",
            str(row.get("description") or ""),
            rank,
            ref=str(row.get("id") or ""),
        )

    docs_dir = Path(__file__).resolve().parent / "docs"
    for path in sorted(docs_dir.glob("*.md")):
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        hit = 0
        for number, line in enumerate(lines, start=1):
            if needle not in line.casefold():
                continue
            push(
                "doc",
                path.name,
                f"第 {number} 行",
                line.strip()[:220],
                1,
                ref=path.name,
                line=number,
            )
            hit += 1
            if hit >= 3:
                break

    items.sort(
        key=lambda item: (
            -item["score"],
            kind_rank.get(item["kind"], 99),
            item["title"],
        )
    )
    selected = items[:limit]
    groups: list[dict[str, Any]] = []
    by_kind: dict[str, dict[str, Any]] = {}
    for item in selected:
        bucket = by_kind.get(item["kind"])
        if bucket is None:
            bucket = {
                "key": item["kind"],
                "label": item["kind_label"],
                "count": 0,
                "items": [],
            }
            by_kind[item["kind"]] = bucket
            groups.append(bucket)
        bucket["count"] += 1
        bucket["items"].append(item)
    return {"q": q, "items": selected, "count": len(items), "groups": groups}


@app.get("/api/help/doc", include_in_schema=False)
def help_doc(path: str = Query(...), line: int = Query(1, ge=1)) -> HTMLResponse:
    """打开 docs/*.md 的只读纯文本页，用于搜索结果新窗口。"""
    import html as html_module

    docs_dir = (Path(__file__).resolve().parent / "docs").resolve()
    target = (docs_dir / path).resolve()
    if (
        target.parent != docs_dir
        or target.suffix.lower() != ".md"
        or not target.is_file()
    ):
        raise NotFoundError(f"文档不存在：{path}")
    rows = []
    for number, text in enumerate(
        target.read_text(encoding="utf-8", errors="replace").splitlines(), start=1
    ):
        escaped = html_module.escape(text)
        if number == line:
            rows.append(
                f'<span id="L{number}" class="hit">{number:>4}  {escaped}</span>'
            )
        else:
            rows.append(f'<span id="L{number}">{number:>4}  {escaped}</span>')
    body = "\n".join(rows)
    page = f"""<!doctype html><meta charset="utf-8"><title>{html_module.escape(path)}</title>
<style>body{{background:#fbf8f2;color:#2c2a26;font:14px/1.55 ui-monospace,Consolas,monospace;margin:24px}}
pre{{white-space:pre-wrap}} .hit{{background:#ffe08a}} .bar{{font-family:system-ui;margin-bottom:12px}}</style>
<div class="bar">{html_module.escape(path)} · 第 {line} 行 · <a href="/api/help/doc?path={html_module.escape(path)}">从头查看</a></div>
<pre>{body}</pre>
<script>document.getElementById('L{line}')?.scrollIntoView({{block:'center'}})</script>"""
    return HTMLResponse(page, headers={"Cache-Control": "no-store"})


@app.get("/api/catalog")
def catalog() -> dict[str, Any]:
    manager = get_plugin_manager()
    return {
        "catalog": SERVICE.scene.catalog(),
        "templates": template_catalog(),
        "default_template": "signal_chain",
        "accel": accel.status(),
        "project": {"format_version": 6, "suffix": ".netlab"},
        "plugins": manager.summaries(),
        "plugin_catalog": manager.capability_catalog(),
        "analysis": analysis_catalog(),
        "engines": [{"mode": mode, "label": mode} for mode in plugin_modes()],
    }


@app.get("/api/plugins")
def plugins_list() -> dict[str, Any]:
    return {"plugins": get_plugin_manager().summaries()}


@app.post("/api/plugins/scan")
def plugins_scan() -> dict[str, Any]:
    return {"plugins": get_plugin_manager().scan(load=True)}


@app.get("/api/plugins/{plugin_id}")
def plugins_detail(plugin_id: str) -> dict[str, Any]:
    try:
        return get_plugin_manager().detail(plugin_id)
    except KeyError as exc:
        raise NotFoundError(f"插件不存在：{plugin_id}") from exc


class PluginToggleRequest(BaseModel):
    enabled: bool


@app.post("/api/plugins/{plugin_id}/enable")
def plugins_enable(plugin_id: str, request: PluginToggleRequest) -> dict[str, Any]:
    try:
        return get_plugin_manager().set_enabled(plugin_id, request.enabled)
    except KeyError as exc:
        raise NotFoundError(f"插件不存在：{plugin_id}") from exc
    except ValidationError:
        raise
    except Exception as exc:
        raise ValidationError(str(exc)) from exc


@app.post("/api/plugins/{plugin_id}/reload")
def plugins_reload(plugin_id: str) -> dict[str, Any]:
    try:
        return get_plugin_manager().reload(plugin_id)
    except KeyError as exc:
        raise NotFoundError(f"插件不存在：{plugin_id}") from exc
    except Exception as exc:
        raise ValidationError(str(exc)) from exc


class UIProfileRequest(BaseModel):
    profile: str = "netlab-ui/1"
    mode: str = "professional"
    tokens: dict[str, str] = Field(default_factory=dict)
    layout: dict[str, float] = Field(default_factory=dict)
    node: dict[str, Any] = Field(default_factory=dict)
    edge: dict[str, Any] = Field(default_factory=dict)


@app.get("/api/ui")
def ui_get() -> dict[str, Any]:
    return {"current": normalize_ui(SERVICE.ui or default_ui()), **ui_catalog()}


@app.post("/api/ui")
def ui_set(request: UIProfileRequest) -> dict[str, Any]:
    SERVICE.ui = normalize_ui(request.model_dump())
    return {"ok": True, "current": SERVICE.ui}


class PluginAnalysisRequest(BaseModel):
    kind: str
    params: dict[str, Any] = Field(default_factory=dict)
    probes: list[str] = Field(default_factory=list)
    input_node: str | None = None
    output_node: str | None = None


@app.post("/api/analysis/plugin")
def analysis_plugin(request: PluginAnalysisRequest) -> dict[str, Any]:
    try:
        result = run_plugin_analysis(
            request.kind,
            scene=SERVICE.current.scene,
            simulation=SERVICE.current.simulation,
            params=request.params,
            probes=request.probes,
            input_node=request.input_node,
            output_node=request.output_node,
        )
        return {"ok": True, "result": result}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.get("/api/state")
def state() -> Response:
    return fast_json(SERVICE.snapshot())


@app.get("/api/live")
def live(
    cursor: int = Query(default=0, ge=0),
    limit: int = Query(default=400, ge=1, le=600),
) -> Response:
    return fast_json(SERVICE.live(cursor, limit))


def _plotkit_available() -> list[str]:
    """当前场景**可接入**的探针通道（不需要先运行仿真）。"""
    try:
        return sorted(SERVICE.scene.probes().keys())
    except Exception:
        return []


@app.get("/api/plotkit/diag")
def plotkit_diag() -> dict[str, Any]:
    """PlotKit 挂载诊断：告诉前端到底缺什么，而不是笼统一句"未挂载"。"""
    return plotkit_bridge.diagnose()


@app.get("/api/plotkit/channels")
def plotkit_channels() -> dict[str, Any]:
    """PlotKit 面板可接入的数据通道（探针），以及当前正在画的那几条。

    `available` 来自场景探针（不运行也能列出）；`channels` 是已经登记到
    PlotKit 的数据集（通常在「接入」预计算之后才会有）。
    """
    available = _plotkit_available()
    if not PLOTKIT_MOUNTED:  # 首次挂载可能因依赖就绪顺序失败：这里再试一次（自愈）
        try:
            if plotkit_bridge.remount(app):
                globals()["PLOTKIT_MOUNTED"] = True
        except Exception:
            pass
    if not PLOTKIT_MOUNTED:
        return {
            "mounted": False,
            "channels": [],
            "selected": [],
            "available": available,
            "build": APP_BUILD,
            "diag": plotkit_bridge.diagnose(),
        }
    try:
        return {
            "mounted": True,
            "channels": plotkit_bridge.channels(),
            "selected": plotkit_bridge.selected_channels(),
            "available": available,
            "build": APP_BUILD,
        }
    except Exception as exc:  # pragma: no cover - 取决于运行状态
        return {
            "mounted": True,
            "channels": [],
            "selected": [],
            "available": available,
            "build": APP_BUILD,
            "error": str(exc),
        }


@app.post("/api/plotkit/channels")
def plotkit_set_channels(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """选择 PlotKit 要画的探针通道；keys 为空表示恢复自动发现。"""
    if not PLOTKIT_MOUNTED:
        return {"ok": False, "mounted": False, "channels": [], "selected": []}
    keys = [str(k) for k in ((payload or {}).get("keys") or [])]
    ok = plotkit_bridge.set_channels(keys)
    return {
        "ok": ok,
        "mounted": True,
        "channels": plotkit_bridge.channels(),
        "selected": plotkit_bridge.selected_channels(),
    }


@app.post("/api/plotkit/active")
def plotkit_active(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """打开/关闭 PlotKit 的数据采样：面板不可见时不采样，省 CPU 与内存。"""
    if not PLOTKIT_MOUNTED:
        return {"mounted": False, "active": False}
    active = bool((payload or {}).get("active", True))
    plotkit_bridge.set_active(active)
    return {"mounted": True, "active": plotkit_bridge.is_active()}


@app.post("/api/plotkit/analysis")
def plotkit_add_analysis(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """把 TF 阶跃/相图等分析曲线作为独立图层送进 PlotKit。

    与探针通道分开：分析曲线使用自己的 x/y，不参与 recorder 时间轴追加。
    """
    if not PLOTKIT_MOUNTED:
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
    return {"ok": True, "mounted": True, **result}


#: PlotKit 预计算的步数上限：超过就把步长降级，并把 ``degraded`` 告诉界面。
PRECOMPUTE_MAX_STEPS = 200_000


def precompute_step_dt(
    seconds: float,
    requested_dt: float,
    *,
    max_steps: int = PRECOMPUTE_MAX_STEPS,
) -> tuple[float, bool]:
    """选预计算的实际步长；返回 ``(step_dt, degraded)``。

    2026-11-03 修复：这里以前写死 ``max(dt, seconds / 2000)``，于是不管用户把 dt
    调多小，预计算都用 seconds/2000 跑出恰好 2000 帧，曲线点数不随精度变化——
    用户看到的「在 netlab 提高仿真精度，PlotKit 里精度依然没提高」。
    现在尊重请求的 dt，只有超过步数上限时才降级，且降级必须能被界面看见。
    """
    step_dt = float(requested_dt)
    if seconds / step_dt > max_steps:
        return seconds / max_steps, True
    return step_dt, False


@app.post("/api/plotkit/precompute")
def plotkit_precompute(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """接入 PlotKit 前先把 0→T 的整段数据算出来并登记（仿真保持停止）。

    用户要求：接入时不要边跑边画，先强制预计算一遍；返回耗时与帧数供前端提示。
    """
    seconds = float((payload or {}).get("seconds") or 5.0)
    if seconds <= 0:
        seconds = 5.0
    started = time.perf_counter()
    try:
        try:
            cfg = (SERVICE.snapshot().get("sim") or {}).get("config") or {}
        except Exception:
            cfg = {}
        raw_dt = (payload or {}).get("dt")
        requested_dt = (
            float(raw_dt) if raw_dt is not None else float(cfg.get("dt") or 0.01)
        )
        if not (1.0e-9 <= requested_dt <= 10.0):
            requested_dt = 0.01
        step_dt, degraded = precompute_step_dt(seconds, requested_dt)
        result = SERVICE.precompute(seconds, dt=step_dt) or {}
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
    # SERVICE.precompute 在求解中途失败时会返回带 error 的部分结果（前面几帧已
    # 登记）。以前这里无条件写 ok=True，界面据此认为预计算成功并压住后续报错。
    merged["ok"] = not result.get("error")
    # 预计算产出的时序已写入 SERVICE.current.recorder（与 /api/solve-window 是同
    # 一条落地路径）。把最新 sim（含 probe_keys / cursor / frames_recorded）一并返
    # 回，前端据此同步 state.sim，netlab 自身「分析·信号」等分析面板才能列出并加
    # 载这些变量——此前只回帧数，前端 state.sim 一直停在旧/空值，分析面板就"没有
    # 数据可加载"（2026-11-08 修复）。
    try:
        merged["sim"] = SERVICE.info()
    except Exception:  # pragma: no cover - info() 不应失败
        pass
    return merged


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "build": APP_BUILD,
        "running": SERVICE.running,
        "mode": SERVICE.scene.mode,
        "fem_running": FEM.running,
    }


@app.get("/api/diagnostics/telemetry")
def diagnostics_telemetry() -> dict[str, Any]:
    """P5：只读遥测质量口径；不改变 /api/live 的任何字段与语义。"""
    return {"ok": True, "telemetry": SERVICE.current.telemetry_quality()}


@app.get("/api/diagnostics/math-accel")
def diagnostics_math_accel(
    limit: int = Query(default=50, ge=1, le=256),
) -> dict[str, Any]:
    """P3/P1 影子诊断事件（只读环形缓冲）。"""
    return {"ok": True, "events": math_accel_diagnostics_snapshot(limit)}


# ---- 仿真控制 --------------------------------------------------------------
@app.post("/api/control")
def control(request: ControlRequest) -> dict[str, Any]:
    if SERVICE.degraded and request.action in ("run", "step", "toggle"):
        raise ConflictError(
            "工程处于降级只读模式（库文件缺失）：补回库文件或确认替换占位块后才能运行"
        )
    if request.action == "run":
        SERVICE.start()
    elif request.action == "pause":
        SERVICE.pause()
    elif request.action == "toggle":
        SERVICE.toggle()
    elif request.action == "step":
        SERVICE.step_once(request.steps)
    elif request.action == "zero":
        SERVICE.zero_time()
    elif request.action == "reset":
        SERVICE.reset()
    elif request.action == "cancel_precompute":
        SERVICE.current.cancel_precompute()
    return {"sim": SERVICE.info()}


@app.post("/api/solve-window")
def solve_window(request: SolveWindowRequest) -> dict[str, Any]:
    if SERVICE.degraded:
        raise ConflictError("工程处于降级只读模式，不能预计算")
    result = SERVICE.precompute(request.duration, request.dt, request.sample_every)
    return {"result": result, "sim": SERVICE.info()}


@app.get("/api/operating-point")
def operating_point() -> dict[str, Any]:
    """DC 工作点：不推进仿真时间，只解一次静态电路。"""
    if SERVICE.degraded:
        raise ConflictError("工程处于降级只读模式，不能做 DC 工作点分析")
    return {"result": SERVICE.current.operating_point(), "sim": SERVICE.info()}


@app.get("/api/ac-sweep")
def ac_sweep(
    input: str | None = Query(None, description="激励源名称，缺省取第一个独立源"),
    f_start: float = Query(1.0, gt=0.0),
    f_stop: float = Query(1.0e6, gt=0.0),
    points: int = Query(61, ge=2, le=2001),
    scale: Literal["log", "lin"] = "log",
    probes: str = Query("", description="逗号分隔的节点/元件名；空 = 默认全部"),
) -> dict[str, Any]:
    """AC 小信号扫频：先求工作点线性化，再逐频点解复数线性方程。"""
    import numpy as np

    if SERVICE.degraded:
        raise ConflictError("工程处于降级只读模式，不能做 AC 分析")
    if f_stop <= f_start:
        raise ValidationError("AC 扫频要求 f_stop 大于 f_start")
    if scale == "log":
        frequencies = np.logspace(
            float(np.log10(f_start)), float(np.log10(f_stop)), int(points)
        ).tolist()
    else:
        frequencies = np.linspace(f_start, f_stop, int(points)).tolist()
    wanted = [item.strip() for item in probes.split(",") if item.strip()] or None
    result = SERVICE.current.ac_sweep(frequencies, input_source=input, probes=wanted)
    return {"result": result, "sim": SERVICE.info()}


@app.patch("/api/config")
def update_config(request: ConfigUpdate) -> dict[str, Any]:
    payload = request.model_dump(exclude_unset=True, exclude_none=True)
    config = SERVICE.apply_config(payload)
    return {"config": config, "sim": SERVICE.info()}


@app.post("/api/mode")
def switch_mode(request: ModeRequest) -> dict[str, Any]:
    name = {
        "signal": "blank_signal",
        "circuit": "blank_circuit",
        "vector": "blank_vector",
    }[request.mode]
    payload = build_template(name)
    SERVICE.load_scene(payload)
    return SERVICE.snapshot()


# ---- 节点 ------------------------------------------------------------------
@app.post("/api/nodes")
def add_node(request: NodeCreate) -> dict[str, Any]:
    record = SERVICE.mutate(
        lambda scene: scene.add_node(
            name=request.name,
            kind=request.kind,
            params=request.params,
            data=request.data,
            position=request.position,
            size=request.size,
        )
    )
    snapshot = SERVICE.snapshot()
    snapshot["node"] = record.snapshot()
    return snapshot


@app.patch("/api/nodes/{node_id}")
def update_node(node_id: str, request: NodeUpdate) -> dict[str, Any]:
    payload = request.model_dump(exclude_unset=True)
    record = SERVICE.mutate(lambda scene: scene.update_node(node_id, payload))
    return {
        "node": record.snapshot(),
        "sim": SERVICE.info(),
        "revision": SERVICE.scene.revision,
    }


@app.delete("/api/nodes/{node_id}")
def delete_node(node_id: str) -> dict[str, Any]:
    removed = SERVICE.mutate(lambda scene: scene.delete_node(node_id))
    snapshot = SERVICE.snapshot()
    snapshot["removed_edges"] = removed
    return snapshot


# ---- 连接 ------------------------------------------------------------------
@app.post("/api/edges")
def add_edge(request: EdgeCreate) -> dict[str, Any]:
    record = SERVICE.mutate(
        lambda scene: scene.add_edge(
            source=request.source,
            target=request.target,
            kind=request.kind,
            name=request.name,
            params=request.params,
            delay=request.delay,
            enabled=request.enabled,
            auto_delay=request.auto_delay,
            route=request.route,
            waypoints=request.waypoints,
            anchors=request.anchors,
            pins=request.pins,
            layout=request.layout,
            source_pin=request.source_pin,
            target_pin=request.target_pin,
            source_port=request.source_port,
            target_port=request.target_port,
        )
    )
    notice = None
    if (
        SERVICE.scene.mode in ("signal", "vector")
        and record.delay
        and not request.delay
    ):
        notice = "该连接会形成代数环，已自动设为单步延迟"
    snapshot = SERVICE.snapshot()
    snapshot["edge"] = record.snapshot()
    snapshot["notice"] = notice
    return snapshot


@app.patch("/api/edges/{edge_id}")
def update_edge(edge_id: str, request: EdgeUpdate) -> dict[str, Any]:
    payload = request.model_dump(exclude_unset=True)
    record = SERVICE.mutate(lambda scene: scene.update_edge(edge_id, payload))
    return {
        "edge": record.snapshot(),
        "sim": SERVICE.info(),
        "revision": SERVICE.scene.revision,
    }


@app.delete("/api/edges/{edge_id}")
def delete_edge(edge_id: str) -> dict[str, Any]:
    SERVICE.mutate(lambda scene: scene.delete_edge(edge_id))
    return SERVICE.snapshot()


@app.post("/api/positions")
def update_positions(request: PositionsUpdate) -> dict[str, Any]:
    items = [{"id": item.id, "position": item.position} for item in request.positions]
    SERVICE.mutate(lambda scene: scene.update_positions(items))
    return {"ok": True, "revision": SERVICE.scene.revision}


# ---- 模板与场景 ------------------------------------------------------------
@app.get("/api/templates")
def templates() -> dict[str, Any]:
    return {"templates": template_catalog()}


@app.post("/api/templates/{name}")
def load_template(name: str) -> dict[str, Any]:
    if name not in TEMPLATES:
        raise NotFoundError(f"模板 {name!r} 不存在")
    SERVICE.load_scene(build_template(name))
    return SERVICE.snapshot()


@app.get("/api/scene/export")
def export_scene(include_state: bool = Query(default=False)) -> Response:
    return fast_json(SERVICE.scene.to_payload(include_state=include_state))


@app.get("/api/export/schematic")
def export_schematic(name: str = Query(""), network: str = Query("")) -> dict[str, Any]:
    """R18/R19：用 SchemDraw 把当前电路场景直接输出为静态 SVG。"""
    from .core.compute.schematic_export import scene_to_svg, svg_filename

    svg = scene_to_svg(SERVICE.scene, project_name=name, network_name=network)
    return {"ok": True, "svg": svg, "filename": svg_filename(name)}


@app.post("/api/scene")
def import_scene(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    if len(str(payload)) > 2_000_000:
        raise ValidationError("场景文件过大")
    SERVICE.load_scene(payload)
    return SERVICE.snapshot()


@app.post("/api/scene/migrate-devices")
def migrate_scene_devices() -> dict[str, Any]:
    """R20：把当前电路场景从「边=元件」迁移为「器件节点 + 引脚导线」。"""
    scene = SERVICE.scene
    if scene.mode != "circuit":
        raise ValidationError("只有电路场景可以迁移为器件模型")
    before = scene.to_payload(include_state=False)
    before_devices = sum(
        1 for node in before.get("nodes") or [] if node.get("kind") == "device"
    )
    migrated = migrate_scene_to_devices(before)
    devices = sum(
        1 for node in migrated.get("nodes") or [] if node.get("kind") == "device"
    )
    wires = sum(1 for edge in migrated.get("edges") or [] if edge.get("kind") == "wire")
    SERVICE.load_scene(migrated)
    snapshot = SERVICE.snapshot()
    snapshot["migration"] = {
        "converted": devices - before_devices,
        "devices": devices,
        "wires": wires,
    }
    return snapshot


@app.post("/api/scene/clear")
def clear_scene(mode: str | None = Query(None)) -> dict[str, Any]:
    if mode is None:
        name = "blank_signal" if SERVICE.scene.mode == "signal" else "blank_circuit"
    else:
        names = {
            "signal": "blank_signal",
            "circuit": "blank_circuit",
            "vector": "blank_vector",
        }
        if mode not in names:
            raise ValidationError(f"未知场景模式：{mode!r}")
        name = names[mode]
    SERVICE.load_scene(build_template(name))
    return SERVICE.snapshot()


@app.patch("/api/scene")
def update_scene_settings(request: IntegrationRequest) -> dict[str, Any]:
    SERVICE.mutate(lambda scene: scene.set_integration(request.integration))
    return SERVICE.snapshot()


# ---- 工程文件 --------------------------------------------------------------
def _extension_payload() -> list[dict[str, Any]]:
    return [
        {
            "kind": item["kind"],
            "type": item["type"],
            "code": item["source"],
            "sha256": item["sha256"],
            "filename": item["filename"],
        }
        for item in extensions.list_extensions()
    ]


def _project_payload(request: ProjectExportRequest | None = None) -> dict[str, Any]:
    request = request or ProjectExportRequest()
    extension_items = request.extensions or _extension_payload()
    library = _library_path()
    from .core.model import blocklib

    with SERVICE.lock:
        block_payloads = SERVICE.scene.blocks.export_user()
    blocklib.ensure_blocks(library, block_payloads)
    project = SERVICE.build_project(
        name=request.name,
        fem=FEM,
        ui=request.ui,
        extensions=extension_items,
        plugins=request.plugins,
        created=request.created,
        library=str(library),
    )
    if request.blocks:
        project["blocks"] = copy.deepcopy(request.blocks)
        project.pop("checksum", None)
        project["checksum"] = compute_checksum(project)
    return project


@app.get("/api/project")
def project_export_get() -> dict[str, Any]:
    return {"project": _project_payload()}


@app.post("/api/project/export")
def project_export(request: ProjectExportRequest) -> dict[str, Any]:
    return {"project": _project_payload(request)}


@app.post("/api/project/validate")
def project_validate(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    library = str(_library_path())
    degraded = None
    try:
        project = validate_project(payload, library=library)
    except ValidationError:
        # 只是看摘要：模块库缺失也应能出摘要，并说明「打开时会是降级只读」。
        project = validate_project(payload, library=library, allow_degraded=True)
        degraded = project.get("degraded")
    scene = project_current_network(project).get("scene") or {}
    return {
        "ok": True,
        "degraded": degraded,
        "summary": {
            "name": project.get("name"),
            "version": project.get("version"),
            "mode": scene.get("mode"),
            "networks": len(project.get("networks") or []),
            "nodes": len(scene.get("nodes") or []),
            "edges": len(scene.get("edges") or []),
            "blocks": len(project.get("blocks") or []),
            "extensions": len(project.get("extensions") or []),
            "modified": project.get("modified"),
        },
    }


def _apply_project(
    project: dict[str, Any],
    trust_extensions: bool,
    library: str | None = None,
    *,
    allow_fallback: bool = True,
) -> dict[str, Any]:
    """把已校验工程装进运行中的服务；供导入与打开工程共用。"""
    extension_items = project.get("extensions") or []
    if extension_items and not trust_extensions:
        raise ValidationError(
            "工程包含 Python 扩展代码。扩展会在本进程执行，不是沙箱；"
            "确认来源可信后，使用 trust_extensions=true 重新导入。"
        )
    if extension_items:
        extensions.activate_project_extensions(extension_items)
    library = library or str(_library_path())
    degraded = None
    try:
        project = validate_project(project, library=library)
    except ValidationError as exc:
        message = str(exc)
        if not allow_fallback or not any(
            marker in message for marker in ("缺失", "不存在", "库路径", "模块")
        ):
            raise
        # D7：缺失时降级只读打开，用占位块顶上；运行与编辑被禁用。
        project = validate_project(project, library=library, allow_degraded=True)
        degraded = project.get("degraded")
    # 先应用 FEM（失败时不破坏当前网络），再载入已通过校验的场景。
    fem_payload = project.get("fem") or {}
    if fem_payload:
        FEM.apply_config(fem_payload)
    SERVICE.load_project(project, library=library, allow_degraded=bool(degraded))
    global LAST_PROJECT, LAST_PROJECT_LIBRARY
    LAST_PROJECT = copy.deepcopy(project) if degraded else None
    LAST_PROJECT_LIBRARY = library
    return {
        "scene": SERVICE.scene.runtime_state(),
        "sim": SERVICE.info(),
        "networks": SERVICE.list_networks(),
        "current": SERVICE.current_id,
        "degraded": SERVICE.degraded,
        "fem": FEM.snapshot(include_mesh=False),
        "ui": project.get("ui") or {},
        "blocks": project.get("blocks") or [],
        "extensions": project.get("extensions") or [],
        "project": {
            "name": project.get("name"),
            "version": project.get("version"),
            "created": project.get("created"),
            "modified": project.get("modified"),
            "checksum": project.get("checksum"),
            "trusted_extensions": bool(trust_extensions),
        },
        "migration": {
            "rails": (project.get("metadata") or {}).get("rails_migration") or [],
        },
    }


@app.post("/api/project/retry")
def project_retry() -> dict[str, Any]:
    """降级只读工程在补齐库文件后重试：仍缺失 → 409；成功 → 解除只读。"""
    if not LAST_PROJECT:
        raise ConflictError("当前没有降级打开的工程")
    if not SERVICE.degraded:
        raise ConflictError("当前工程未处于降级只读模式")
    library = LAST_PROJECT_LIBRARY or str(_library_path())
    refs = [
        item
        for item in (LAST_PROJECT.get("blocks") or [])
        if isinstance(item, dict) and "nodes" not in item
    ]
    missing = blocklib.check_refs(library, refs)["missing"]
    if missing:
        raise ConflictError(
            "库文件仍缺失："
            + "、".join(f"{item['id']}@v{item['version']}" for item in missing)
            + "；补回后再重试"
        )
    payload = copy.deepcopy(LAST_PROJECT)
    payload.pop("degraded", None)
    payload["checksum"] = compute_checksum(payload)
    return _apply_project(payload, False, library=library, allow_fallback=False)


@app.post("/api/project/import")
def project_import(request: ProjectImportRequest) -> dict[str, Any]:
    return _apply_project(request.project, request.trust_extensions)


# ---- 多网络（R07 / D18） ----------------------------------------------------
class NetworkCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    mode: str | None = None


class NetworkUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    mode: str | None = None


@app.get("/api/networks")
def networks_list() -> dict[str, Any]:
    return {
        "networks": SERVICE.list_networks(),
        "current": SERVICE.current_id,
        "degraded": SERVICE.degraded,
        "sim": SERVICE.info(),
    }


@app.post("/api/networks")
def networks_create(request: NetworkCreateRequest) -> dict[str, Any]:
    created = SERVICE.add_network(request.name, request.mode)
    return {
        "created": created["id"],
        "mode": created.get("mode"),
        "networks": SERVICE.list_networks(),
    }


@app.patch("/api/networks/{network_id}")
def networks_update(network_id: str, request: NetworkUpdateRequest) -> dict[str, Any]:
    result: dict[str, Any] | None = None
    if request.name is not None:
        result = SERVICE.rename_network(network_id, request.name)
    if request.mode is not None:
        result = SERVICE.set_network_mode(network_id, request.mode)
    if result is None:
        raise ValidationError("请至少提供 name 或 mode")
    return result


@app.delete("/api/networks/{network_id}")
def networks_delete(network_id: str) -> dict[str, Any]:
    return SERVICE.remove_network(network_id)


@app.post("/api/networks/{network_id}/activate")
def networks_activate(network_id: str) -> dict[str, Any]:
    SERVICE.switch(network_id)
    return {
        "scene": SERVICE.scene.runtime_state(),
        "sim": SERVICE.info(),
        "networks": SERVICE.list_networks(),
        "current": SERVICE.current_id,
    }


@app.post("/api/networks/run-all")
def networks_run_all() -> dict[str, Any]:
    return {"networks": SERVICE.run_all(), "sim": SERVICE.info()}


@app.post("/api/networks/pause-all")
def networks_pause_all() -> dict[str, Any]:
    return {"networks": SERVICE.pause_all(), "sim": SERVICE.info()}


# ---- 工作区（R01：工程目录 / 共享库 / 用户设置） ----------------------------
class WorkspaceCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str
    name: str | None = None
    library_root: str | None = None


class WorkspacePathRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str
    trust_extensions: bool = False
    library_root: str | None = None


class WorkspaceSaveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str
    name: str | None = None
    library_root: str | None = None


class WorkspaceSnapshotRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str
    name: str | None = None
    library_root: str | None = None


class WorkspaceRestoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str
    snapshot: str
    trust_extensions: bool = False
    library_root: str | None = None


@app.get("/api/workspace")
def workspace_info(path: str = Query("")) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "settings": load_settings(),
        "settings_file": str(settings_file()),
    }
    if not path.strip():
        return payload
    workspace = workspace_for(path)
    payload["workspace"] = workspace.as_dict()
    payload["library"] = scan_library(workspace)
    return payload


@app.post("/api/workspace/create")
def workspace_create(request: WorkspaceCreateRequest) -> dict[str, Any]:
    global CURRENT_WORKSPACE
    workspace, project = create_project(
        request.path,
        simulation=SERVICE,
        name=request.name,
        library_root=request.library_root,
    )
    CURRENT_WORKSPACE = workspace.root
    scene = project_current_network(project).get("scene") or {}
    return {
        "workspace": workspace.as_dict(),
        "library": scan_library(workspace),
        "project": {
            "name": project.get("name"),
            "checksum": project.get("checksum"),
            "networks": len(project.get("networks") or []),
            "nodes": len(scene.get("nodes") or []),
        },
    }


@app.post("/api/workspace/save")
def workspace_save(request: WorkspaceSaveRequest) -> dict[str, Any]:
    global CURRENT_WORKSPACE
    if SERVICE.degraded:
        raise ConflictError(
            "工程处于降级只读模式：请先补回缺失的库文件，或确认用占位块替换后再保存"
        )
    workspace, path = save_workspace(
        request.path,
        SERVICE,
        name=request.name,
        library_root=request.library_root,
    )
    CURRENT_WORKSPACE = workspace.root
    return {
        "workspace": workspace.as_dict(),
        "saved": str(path),
        "sim": SERVICE.info(),
    }


@app.post("/api/workspace/open")
def workspace_open(request: WorkspacePathRequest) -> dict[str, Any]:
    global CURRENT_WORKSPACE
    workspace, project = load_workspace(request.path, library_root=request.library_root)
    result = _apply_project(
        project, request.trust_extensions, library=str(workspace.library)
    )
    CURRENT_WORKSPACE = workspace.root
    result["workspace"] = workspace.as_dict()
    result["library"] = scan_library(workspace)
    return result


@app.get("/api/workspace/snapshots")
def workspace_snapshots(path: str = Query(...)) -> dict[str, Any]:
    workspace = workspace_for(path)
    settings = load_settings()
    return {
        "workspace": workspace.as_dict(),
        "snapshots": list_snapshots(workspace),
        "autosave": {
            "enabled": bool(settings["autosave_enabled"]),
            "interval_seconds": int(settings["autosave_interval_seconds"]),
            "keep_recent": int(settings["autosave_keep_recent"]),
            "keep_daily": int(settings["autosave_keep_daily"]),
        },
    }


@app.post("/api/workspace/snapshot")
def workspace_snapshot(request: WorkspaceSnapshotRequest) -> dict[str, Any]:
    """快照式自动保存：只写工程 backups/，不动正本（R16 / D16）。"""
    workspace = workspace_for(request.path, library_root=request.library_root)
    if not workspace.project_file.is_file():
        raise ValidationError(f"工程文件不存在：{workspace.project_file}")
    settings = load_settings()
    project = SERVICE.build_project(name=request.name or "自动快照")
    saved = write_snapshot(workspace, project)
    removed = prune_snapshots(
        workspace,
        keep_recent=int(settings["autosave_keep_recent"]),
        keep_daily=int(settings["autosave_keep_daily"]),
    )
    return {
        "workspace": workspace.as_dict(),
        "saved": str(saved),
        "removed": removed,
        "snapshots": list_snapshots(workspace),
    }


@app.post("/api/workspace/restore")
def workspace_restore(request: WorkspaceRestoreRequest) -> dict[str, Any]:
    global CURRENT_WORKSPACE
    workspace = workspace_for(request.path, library_root=request.library_root)
    project = load_snapshot(workspace, request.snapshot)
    result = _apply_project(
        project,
        request.trust_extensions,
        library=str(workspace.library),
    )
    CURRENT_WORKSPACE = workspace.root
    result["workspace"] = workspace.as_dict()
    result["restored_from"] = request.snapshot
    return result


class ProfileRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = None
    reset: bool = False


class AnalysisExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    keys: list[str] | None = None
    t0: float | None = None
    t1: float | None = None
    decimate: int = 1
    name: str = "analysis"


class AnalysisTFRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    node: str | None = None
    input_node: str | None = None
    output_node: str | None = None
    field: str | None = None
    expr: str | None = None
    numerator: list[float] | None = None
    denominator: list[float] | None = None
    zeros: list[float] | None = None
    poles: list[float] | None = None
    gain: float = 1.0
    method: str = "zoh"
    dt: float | None = None
    duration: float | None = None
    points: int = 240
    delay_pade_order: int = 3


class AnalysisPhaseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    xs: list[float]
    ys: list[float]
    times: list[float] | None = None


class AnalysisFrequencyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input: str = Field(min_length=1)
    output: str = Field(min_length=1)
    f_start: float = Field(default=1.0, gt=0.0)
    f_stop: float = Field(default=1_000_000.0, gt=0.0)
    points: int = Field(default=241, ge=2, le=2001)
    scale: Literal["log", "lin"] = "log"
    input_field: str = "voltage"
    output_field: str = "voltage"


def _analysis_call(function, label: str):
    try:
        return analysis.run_with_timeout(function, label=label)
    except analysis.AnalysisError as exc:
        raise ValidationError(str(exc)) from exc


def _analysis_context() -> dict[str, Any]:
    return {"sim": SERVICE.current, "name": _current_network_name()}


def _current_network_name() -> str:
    for item in SERVICE.list_networks():
        if item.get("id") == SERVICE.current_id:
            return str(item.get("name") or "网络")
    return "网络"


def _exports_dir() -> Path:
    base = (
        CURRENT_WORKSPACE / "exports"
        if CURRENT_WORKSPACE is not None
        else Path.cwd() / "exports"
    )
    return base


@app.get("/api/analysis/metrics")
def analysis_metrics(
    keys: str = Query(""),
    t0: float | None = None,
    t1: float | None = None,
) -> dict[str, Any]:
    wanted = [item.strip() for item in keys.split(",") if item.strip()] or None
    return _analysis_call(
        lambda: analysis.analyze_metrics(SERVICE.current, wanted, t0, t1),
        "指标计算",
    )


@app.get("/api/analysis/spectrum")
def analysis_spectrum(
    key: str = Query(...), t0: float | None = None, t1: float | None = None
) -> dict[str, Any]:
    return _analysis_call(
        lambda: analysis.spectrum(SERVICE.current, key, t0, t1), "频谱计算"
    )


@app.get("/api/analysis/period")
def analysis_period(
    key: str = Query(...), t0: float | None = None, t1: float | None = None
) -> dict[str, Any]:
    return _analysis_call(
        lambda: analysis.recommend_period(SERVICE.current, key, t0, t1), "周期推荐"
    )


@app.get("/api/analysis/math")
def analysis_math() -> dict[str, Any]:
    return _analysis_call(lambda: analysis.math_forms(SERVICE.current), "数学形式")


@app.get("/api/analysis/transfer")
def analysis_transfer(
    input: str = Query(...),
    output: str = Query(...),
    input_field: str = "voltage",
    output_field: str = "voltage",
    domain: str = "s",
    delay_pade_order: int = 3,
) -> dict[str, Any]:
    return _analysis_call(
        lambda: analysis.transfer_function(
            SERVICE.current,
            input,
            output,
            input_field=input_field,
            output_field=output_field,
            domain=domain,
            delay_pade_order=delay_pade_order,
        ),
        "传递函数推导",
    )


@app.post("/api/analysis/tf")
def analysis_tf(request: AnalysisTFRequest) -> dict[str, Any]:
    return _analysis_call(
        lambda: analysis.tf_analysis(
            SERVICE.current,
            node=request.node,
            input_node=request.input_node,
            output_node=request.output_node,
            field=request.field,
            expr=request.expr,
            numerator=request.numerator,
            denominator=request.denominator,
            zeros=request.zeros,
            poles=request.poles,
            gain=request.gain,
            method=request.method,
            dt=request.dt,
            duration=request.duration,
            points=request.points,
            delay_pade_order=request.delay_pade_order,
        ),
        "传递函数分析",
    )


@app.post("/api/analysis/phase")
def analysis_phase(request: AnalysisPhaseRequest) -> dict[str, Any]:
    return _analysis_call(
        lambda: analysis.phase_metrics(request.xs, request.ys, request.times),
        "相平面指标",
    )


@app.post("/api/analysis/frequency")
def analysis_frequency(request: AnalysisFrequencyRequest) -> dict[str, Any]:
    return _analysis_call(
        lambda: analysis.frequency_response(
            SERVICE.current,
            request.input,
            request.output,
            f_start=request.f_start,
            f_stop=request.f_stop,
            points=request.points,
            scale=request.scale,
            input_field=request.input_field,
            output_field=request.output_field,
        ),
        "频响分析",
    )


@app.post("/api/analysis/export")
def analysis_export(request: AnalysisExportRequest) -> dict[str, Any]:
    def run() -> dict[str, Any]:
        return analysis.export_csv(
            SERVICE.current,
            directory=_exports_dir(),
            network_name=_current_network_name(),
            keys=request.keys,
            t0=request.t0,
            t1=request.t1,
            decimate=request.decimate,
            name=request.name,
        )

    return _analysis_call(run, "CSV 导出")


@app.get("/api/schematic/layout")
def schematic_layout_preview() -> dict[str, Any]:
    return schematic.auto_layout(SERVICE.scene)


@app.post("/api/schematic/layout")
def schematic_layout_apply() -> dict[str, Any]:
    layout = schematic.auto_layout(SERVICE.scene)
    if not layout.get("ok"):
        raise ValidationError(str(layout.get("reason") or "自动布局不可用"))
    applied = SERVICE.mutate(lambda scene: schematic.apply_layout(scene, layout))
    snapshot = SERVICE.snapshot()
    snapshot["layout"] = layout
    snapshot["applied"] = applied
    return snapshot


@app.get("/api/schematic/validate")
def schematic_validate() -> dict[str, Any]:
    return schematic.validate_schematic(SERVICE.scene)


@app.get("/api/profile")
def profile_state(top: int = Query(20)) -> dict[str, Any]:
    return profiling.snapshot(top)


@app.patch("/api/profile")
def profile_update(request: ProfileRequest) -> dict[str, Any]:
    if request.enabled is not None:
        profiling.set_enabled(request.enabled)
    if request.reset:
        profiling.clear()
    return profiling.snapshot()


class BlockImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    payload: dict[str, Any]
    library: str | None = None
    version: int | None = None


def _library_path(library: str | None = None) -> Path:
    if library:
        return Path(library).expanduser()
    configured = str(load_settings().get("library_root") or "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path.cwd() / "library"


@app.get("/api/blocks")
def blocks_list(library: str = Query("")) -> dict[str, Any]:
    target = _library_path(library or None)
    return {
        "library": str(target),
        "blocks": blocklib.scan_library(target, include_builtin=True),
    }


class BlockValidateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    payload: dict[str, Any]
    library: str | None = None
    dry_run: bool = True
    save_report: bool = False


@app.post("/api/blocks/validate")
def blocks_validate(request: BlockValidateRequest) -> dict[str, Any]:
    report = block_validate.validate_block_payload(
        request.payload,
        library=str(_library_path(request.library)),
        dry_run=request.dry_run,
    )
    report["text"] = block_validate.report_as_text(report)
    report["library"] = str(_library_path(request.library))
    if request.save_report:
        target = (
            CURRENT_WORKSPACE / "exports"
            if CURRENT_WORKSPACE is not None
            else Path.cwd() / "exports"
        )
        target.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        block_info = report.get("block", {})
        name = f"block-validate-{block_info.get('id', 'unknown')}-v{block_info.get('version', 1)}-{stamp}.json"
        path = target / name
        path.write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        report["report_path"] = str(path)
    return report


class BlockOpenInternalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    library: str | None = None
    version: int | None = None


class BlockSaveCopyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    library: str | None = None
    name: str
    description: str = ""
    model: str | None = None


@app.post("/api/blocks/{block_id}/open-internal")
def blocks_open_internal(
    block_id: str, request: BlockOpenInternalRequest
) -> dict[str, Any]:
    """把结构模型的内部打开成一个临时网络（D30：独立网络，不做面包屑）。"""
    target = _library_path(request.library)
    block = blocklib.load_block(target, block_id, request.version)
    if block.model != "structural":
        raise ConflictError(
            "该模块是行为模型（behavioral）：不提供内部视图。"
            "需要编辑内部时请用结构模型（structural）重新封装。"
        )
    payload = {
        "mode": block.mode,
        "nodes": copy.deepcopy(block.nodes),
        "edges": copy.deepcopy(block.edges),
        "blocks": [block.to_payload()],
    }
    created = SERVICE.add_network(f"模块 {block.name}")
    network_id = created["id"]
    simulation = SERVICE.simulation(network_id)
    try:
        simulation.load_scene(payload)
        SERVICE.switch(network_id)
    except Exception:
        # 载入失败（例如内部网络缺接地）时把临时网络回滚掉，避免留下空壳网络
        if network_id in {item["id"] for item in SERVICE.list_networks()}:
            SERVICE.remove_network(network_id)
        raise
    return {
        "network": network_id,
        "block_id": block.id,
        "block": block.summary(),
        "scene": SERVICE.scene.runtime_state(),
        "sim": SERVICE.info(),
        "networks": SERVICE.list_networks(),
    }


class BlockCompareRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    duration: float = Field(0.02, gt=0, le=10)
    dt: float = Field(0.001, gt=0, le=1)
    inputs: dict[str, dict[str, Any]] | None = None
    library: str | None = None


@app.post("/api/blocks/{block_id}/compare")
def blocks_compare(block_id: str, request: BlockCompareRequest) -> dict[str, Any]:
    """对比内置块的行为快速模型与 structural 内部场景。"""
    from .core.model.blocks import compare_block_modes

    target = _library_path(request.library)
    block = blocklib.load_block(target, block_id)
    return compare_block_modes(
        block,
        duration=request.duration,
        dt=request.dt,
        inputs=request.inputs,
    )


@app.post("/api/blocks/save-copy")
def blocks_save_copy(request: BlockSaveCopyRequest) -> dict[str, Any]:
    """把当前网络另存为新的模块副本（新 id、v1；D10 改内部=另存副本）。"""
    target = _library_path(request.library)
    with SERVICE.lock:
        scene = SERVICE.scene
        model = request.model or "structural"
        block = build_block_from_scene(
            scene,
            name=request.name,
            description=request.description,
            model=model,
        )
    path = blocklib.write_block(target, block)
    return {
        "block": block.summary(),
        "path": str(path),
        "library": str(target),
        "blocks": blocklib.scan_library(target, include_builtin=True),
    }


@app.get("/api/blocks/{block_id}/references")
def blocks_references(
    block_id: str,
    library: str = Query(""),
    projects_root: str = Query(""),
    version: int | None = None,
) -> dict[str, Any]:
    root = projects_root or str(Path.cwd())
    return {
        "block_id": block_id,
        "projects_root": root,
        "references": scan_block_references(root, block_id, version=version),
    }


class BlockDeleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    library: str | None = None
    version: int | None = None
    projects_root: str | None = None
    force: bool = False


class BlockRenameRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    library: str | None = None
    version: int | None = None
    projects_root: str | None = None
    force: bool = False


class BlockOverwriteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    payload: dict[str, Any]
    library: str | None = None
    version: int | None = None
    projects_root: str | None = None
    force: bool = False


@app.post("/api/blocks/{block_id}/rename")
def blocks_rename(block_id: str, request: BlockRenameRequest) -> dict[str, Any]:
    """D6：改名先扫描引用；有引用默认拒绝，force 才执行。"""
    target = _library_path(request.library)
    references = scan_block_references(
        request.projects_root or str(Path.cwd()), block_id
    )
    if references and not request.force:
        raise ConflictError(
            "该模块仍被工程引用："
            + "、".join(item["name"] for item in references[:5])
            + "；确认改名请带 force=true"
        )
    block = blocklib.rename_block(
        target, block_id, request.name, version=request.version
    )
    return {
        "block": block.summary(),
        "references": references,
        "library": str(target),
        "blocks": blocklib.scan_library(target, include_builtin=True),
    }


@app.post("/api/blocks/{block_id}/overwrite")
def blocks_overwrite(block_id: str, request: BlockOverwriteRequest) -> dict[str, Any]:
    """D6/D10：同版本覆盖必须显式 force；先扫描引用。"""
    target = _library_path(request.library)
    payload_id = str(request.payload.get("id") or "")
    if payload_id != block_id:
        raise ValidationError("覆盖内容的 block id 与路径不一致")
    version = int(request.version or request.payload.get("version") or 1)
    references = scan_block_references(
        request.projects_root or str(Path.cwd()), block_id, version=version
    )
    if references and not request.force:
        raise ConflictError(
            "该模块版本仍被工程引用："
            + "、".join(item["name"] for item in references[:5])
            + "；确认覆盖请带 force=true"
        )
    block = blocklib.overwrite_block(target, request.payload, version=version)
    return {
        "block": block.summary(),
        "references": references,
        "library": str(target),
    }


@app.post("/api/blocks/{block_id}/delete")
def blocks_delete(block_id: str, request: BlockDeleteRequest) -> dict[str, Any]:
    target = _library_path(request.library)
    references = scan_block_references(
        request.projects_root or str(Path.cwd()), block_id, version=request.version
    )
    if references and not request.force:
        raise ConflictError(
            "该模块仍被工程引用："
            + "、".join(item["name"] for item in references[:5])
            + "；确认要删除请带 force=true"
        )
    removed = blocklib.remove_block(target, block_id, request.version)
    return {"removed": removed, "references": references, "library": str(target)}


@app.post("/api/blocks/import")
def blocks_import(request: BlockImportRequest) -> dict[str, Any]:
    target = _library_path(request.library)
    result = blocklib.import_block(target, request.payload, version=request.version)
    result["library"] = str(target)
    result["blocks"] = blocklib.scan_library(target, include_builtin=True)
    return result


@app.get("/api/blocks/{block_id}")
def blocks_detail(
    block_id: str, library: str = Query(""), version: int | None = None
) -> dict[str, Any]:
    target = _library_path(library or None)
    versions = blocklib.list_versions(target, block_id)
    block = blocklib.load_block(target, block_id, version)
    return {
        "library": str(target),
        "versions": versions,
        "block": block.to_payload(),
    }


class BlockInstanceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    block_id: str
    library: str | None = None
    version: int | None = None
    position: dict[str, float] | None = None
    name_prefix: str | None = None


class BlockEncapsulateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    node_ids: list[str]
    name: str
    description: str = ""
    library: str | None = None
    include_position: bool = True
    model: str = "behavioral"


@app.post("/api/blocks/instantiate")
def blocks_instantiate(request: BlockInstanceRequest) -> dict[str, Any]:
    target = _library_path(request.library)
    block = blocklib.load_block(target, request.block_id, request.version)

    def apply(scene):
        if scene.blocks.get(block.id) is None:
            scene.blocks.add(block)
        return instantiate_block(
            scene,
            block.id,
            position=request.position,
            name_prefix=request.name_prefix,
        )

    instance = SERVICE.mutate(apply)
    snapshot = SERVICE.snapshot()
    snapshot["instance"] = instance
    return snapshot


@app.post("/api/blocks/encapsulate")
def blocks_encapsulate(request: BlockEncapsulateRequest) -> dict[str, Any]:
    target = _library_path(request.library)

    def apply(scene):
        return encapsulate_nodes(
            scene,
            request.node_ids,
            name=request.name,
            description=request.description,
            include_position=request.include_position,
            model=request.model,
        )

    block = SERVICE.mutate(apply)
    imported = blocklib.import_block(target, block.to_payload())
    return {
        "block": block.summary(),
        "file": imported,
        "blocks": blocklib.scan_library(target, include_builtin=True),
        "scene": SERVICE.scene.runtime_state(),
        "sim": SERVICE.info(),
        "library": str(target),
    }


@app.get("/api/settings")
def settings_get() -> dict[str, Any]:
    return {"settings": load_settings(), "path": str(settings_file())}


@app.patch("/api/settings")
def settings_patch(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    return {"settings": save_settings(payload), "path": str(settings_file())}


# ---- 缓存体检与安全清理（D88）---------------------------------------------
@app.get("/api/cache/status")
def cache_status() -> dict[str, Any]:
    from . import cache_guard

    return cache_guard.scan()


@app.post("/api/cache/clean")
def cache_clean(payload: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    """默认 dry-run；只有显式 dry_run=False 才真删，且只删 safe（可选 caution）档。"""
    from . import cache_guard

    dry_run = bool(payload.get("dry_run", True))
    tiers = ("safe", "caution") if payload.get("caution") else ("safe",)
    return cache_guard.clean(tiers=tiers, dry_run=dry_run)


# ---- 应用内文档中心（R14 / R30-5）-----------------------------------------
USER_DOCS_DIR = Path(__file__).resolve().parent / "docs" / "user"
USER_DOC_ORDER: tuple[tuple[str, str], ...] = (
    ("quickstart", "欢迎 / 快速上手"),
    ("interface", "界面指南"),
    ("glossary", "术语表"),
    ("faq", "常见问题"),
    ("shortcuts", "快捷键"),
)


def _user_docs() -> list[dict[str, str]]:
    docs: list[dict[str, str]] = []
    for slug, title in USER_DOC_ORDER:
        path = USER_DOCS_DIR / f"{slug}.md"
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        docs.append({"slug": slug, "title": title, "text": text})
    return docs


@app.get("/api/docs")
def docs_index() -> dict[str, Any]:
    return {"docs": _user_docs()}


@app.get("/api/docs/{slug}")
def docs_one(slug: str) -> dict[str, Any]:
    for doc in _user_docs():
        if doc["slug"] == slug:
            return doc
    raise NotFoundError(f"没有这篇文档：{slug}")


# ---- 加速后端 --------------------------------------------------------------
@app.get("/api/accel")
def accel_state() -> dict[str, Any]:
    return accel.status()


@app.patch("/api/accel")
def accel_configure(request: AccelRequest) -> dict[str, Any]:
    return accel.configure(request.policy)


# ---- 应用内 Python 扩展 ----------------------------------------------------
def _extension_in_use(kind: str) -> bool:
    with SERVICE.lock:
        if any(node.kind == kind for node in SERVICE.scene.nodes.values()):
            return True
        return any(edge.kind == kind for edge in SERVICE.scene.edges.values())


@app.get("/api/extensions")
def extensions_list() -> dict[str, Any]:
    return {
        "extensions": extensions.list_extensions(),
        "scan": extensions.scan_directory(),
        "notice": (
            "扩展代码在本进程执行，不是沙箱。只启用来源可信的代码；"
            "项目内嵌代码默认不执行。"
        ),
    }


@app.post("/api/extensions/validate")
def extensions_validate(request: ExtensionValidateRequest) -> dict[str, Any]:
    return extensions.validate_code(request.code)


@app.post("/api/extensions/activate")
def extensions_activate(request: ExtensionActivateRequest) -> dict[str, Any]:
    result = extensions.activate_code(
        request.code,
        filename=request.filename,
        persist=request.persist,
        kind_type=request.kind_type,
    )
    # 注册成功后立即重建引擎，让参数/源码错误在本次请求内暴露。
    try:
        SERVICE.mutate(lambda scene: None)
    except Exception:
        for kind in result.get("kinds") or []:
            extensions.deactivate(kind)
        raise
    return {
        "ok": True,
        "kinds": result.get("kinds") or [],
        "extensions": extensions.list_extensions(),
        "catalog": SERVICE.scene.catalog(),
    }


@app.post("/api/extensions/deactivate")
def extensions_deactivate(request: ExtensionDeactivateRequest) -> dict[str, Any]:
    if extensions.get_extension(request.kind) is None:
        raise NotFoundError(f"扩展 {request.kind!r} 不存在")
    if _extension_in_use(request.kind):
        raise ValidationError(
            f"扩展 {request.kind!r} 正在当前场景中使用，请先删除相关节点/连接"
        )
    result = extensions.deactivate(request.kind, remove_file=request.remove_file)
    SERVICE.mutate(lambda scene: None)
    return {
        "ok": True,
        "result": result,
        "extensions": extensions.list_extensions(),
        "catalog": SERVICE.scene.catalog(),
    }


@app.get("/api/extensions/{kind}")
def extensions_detail(kind: str) -> dict[str, Any]:
    item = extensions.get_extension(kind)
    if item is None:
        raise NotFoundError(f"扩展 {kind!r} 不存在")
    return item


@app.post("/api/extensions/scan")
def extensions_scan() -> dict[str, Any]:
    return extensions.scan_directory()


# ---- 二维有限元 ------------------------------------------------------------
@app.get("/api/fem/state")
def fem_state(include_mesh: bool = Query(default=True)) -> Response:
    return fast_json(FEM.snapshot(include_mesh=include_mesh))


@app.get("/api/fem/live")
def fem_live(
    cursor: int = Query(default=0, ge=0),
    limit: int = Query(default=30, ge=1, le=120),
) -> Response:
    return fast_json(FEM.live(cursor, limit))


@app.post("/api/fem/control")
def fem_control(request: ControlRequest) -> dict[str, Any]:
    if request.action == "run":
        FEM.start()
    elif request.action == "pause":
        FEM.pause()
    elif request.action == "toggle":
        FEM.toggle()
    elif request.action == "step":
        FEM.step_once(request.steps)
    elif request.action == "reset":
        FEM.reset()
    return {"fem": FEM.info()}


@app.patch("/api/fem/config")
def fem_config(request: FemConfigUpdate) -> dict[str, Any]:
    payload = request.model_dump(exclude_unset=True, exclude_none=True)
    config = FEM.apply_config(payload)
    return {"config": config, "fem": FEM.snapshot(include_mesh=True)}


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
