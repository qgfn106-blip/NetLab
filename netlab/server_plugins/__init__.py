"""插件管理 HTTP 路由（A-5 巨石文件拆分，D137）。

从 ``server.py`` 拆出的低耦合路由组：插件列表、扫描、详情、启用/停用、重载。
路由路径与响应结构保持不变，由 ``server.app`` 统一挂载。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from ..core.common.limits import NotFoundError, ValidationError
from ..core.model.plugins import get_plugin_manager

router = APIRouter(tags=["plugins"])


@router.get("/api/plugins")
def plugins_list() -> dict[str, Any]:
    return {"plugins": get_plugin_manager().summaries()}


@router.post("/api/plugins/scan")
def plugins_scan() -> dict[str, Any]:
    return {"plugins": get_plugin_manager().scan(load=True)}


@router.get("/api/plugins/{plugin_id}")
def plugins_detail(plugin_id: str) -> dict[str, Any]:
    try:
        return get_plugin_manager().detail(plugin_id)
    except KeyError as exc:
        raise NotFoundError(f"插件不存在：{plugin_id}") from exc


class PluginToggleRequest(BaseModel):
    enabled: bool


@router.post("/api/plugins/{plugin_id}/enable")
def plugins_enable(plugin_id: str, request: PluginToggleRequest) -> dict[str, Any]:
    try:
        return get_plugin_manager().set_enabled(plugin_id, request.enabled)
    except KeyError as exc:
        raise NotFoundError(f"插件不存在：{plugin_id}") from exc
    except ValidationError:
        raise
    except Exception as exc:
        raise ValidationError(str(exc)) from exc


@router.post("/api/plugins/{plugin_id}/reload")
def plugins_reload(plugin_id: str) -> dict[str, Any]:
    try:
        return get_plugin_manager().reload(plugin_id)
    except KeyError as exc:
        raise NotFoundError(f"插件不存在：{plugin_id}") from exc
    except Exception as exc:
        raise ValidationError(str(exc)) from exc
