"""缓存、应用内文档与加速后端路由（D145）。

只搬运既有实现，不改变路由路径、请求模型或响应结构。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Body
from pydantic import BaseModel, ConfigDict

from ..core.common.limits import NotFoundError
from ..core.compute import accel


class AccelRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    policy: Literal["auto", "cpu", "gpu"]


USER_DOCS_DIR = Path(__file__).resolve().parents[1] / "docs" / "user"
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


def build_router() -> APIRouter:
    router = APIRouter(tags=["tools"])

    @router.get("/api/cache/status")
    def cache_status() -> dict[str, Any]:
        from .. import cache_guard

        return cache_guard.scan()

    @router.post("/api/cache/clean")
    def cache_clean(payload: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        """默认 dry-run；只有显式 dry_run=False 才真删，且只删 safe（可选 caution）档。"""
        from .. import cache_guard

        dry_run = bool(payload.get("dry_run", True))
        tiers = ("safe", "caution") if payload.get("caution") else ("safe",)
        return cache_guard.clean(tiers=tiers, dry_run=dry_run)

    @router.get("/api/docs")
    def docs_index() -> dict[str, Any]:
        return {"docs": _user_docs()}

    @router.get("/api/docs/{slug}")
    def docs_one(slug: str) -> dict[str, Any]:
        for doc in _user_docs():
            if doc["slug"] == slug:
                return doc
        raise NotFoundError(f"没有这篇文档：{slug}")

    @router.get("/api/accel")
    def accel_state() -> dict[str, Any]:
        return accel.status()

    @router.patch("/api/accel")
    def accel_configure(request: AccelRequest) -> dict[str, Any]:
        return accel.configure(request.policy)

    return router
