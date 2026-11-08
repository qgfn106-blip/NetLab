"""帮助检索 HTTP 路由（C-1 路由域拆分，D138）。

从 ``server.py`` 拆出的帮助检索域：跨元件/节点/模板/文档只读搜索，以及
docs/*.md 的纯文本查看。路由路径与响应结构保持不变，由 ``server.app``
通过 :func:`build_router` 统一挂载。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Query
from fastapi.responses import HTMLResponse

from ..core.common.limits import NotFoundError


def build_router(
    *,
    service: Any,
    templates: Callable[[], list[dict[str, Any]]],
    docs_dir: Path,
) -> APIRouter:
    router = APIRouter(tags=["help"])

    @router.get("/api/help/search")
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

        catalog = service.scene.catalog()
        for kind_key, rows in (
            ("element", catalog.get("elements", [])),
            ("circuit_node", catalog.get("circuit_nodes", [])),
            ("compute", catalog.get("computes", [])),
            ("method", catalog.get("methods", [])),
        ):
            for row in rows:
                haystack = " ".join(
                    str(row.get(key, ""))
                    for key in (
                        "kind",
                        "label",
                        "description",
                        "formula",
                        "notes",
                        "group",
                    )
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
        for row in templates():
            haystack = (
                f"{row.get('id', '')} {row.get('name', '')} "
                f"{row.get('description', '')}"
            ).casefold()
            if needle not in haystack:
                continue
            name_text = str(row.get("name") or "").casefold()
            rank = (
                7
                if name_text.startswith(needle)
                else 5
                if needle in name_text
                else 3
            )
            push(
                "template",
                str(row.get("name") or row.get("id") or ""),
                f"模板 · {row.get('mode', '')}",
                str(row.get("description") or ""),
                rank,
                ref=str(row.get("id") or ""),
            )

        resolved_docs = docs_dir.resolve()
        for path in sorted(resolved_docs.glob("*.md")):
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

    @router.get("/api/help/doc", include_in_schema=False)
    def help_doc(
        path: str = Query(...), line: int = Query(1, ge=1)
    ) -> HTMLResponse:
        """打开 docs/*.md 的只读纯文本页，用于搜索结果新窗口。"""
        import html as html_module

        resolved_docs = docs_dir.resolve()
        target = (resolved_docs / path).resolve()
        if (
            target.parent != resolved_docs
            or target.suffix.lower() != ".md"
            or not target.is_file()
        ):
            raise NotFoundError(f"文档不存在：{path}")
        rows = []
        for number, text in enumerate(
            target.read_text(encoding="utf-8", errors="replace").splitlines(),
            start=1,
        ):
            escaped = html_module.escape(text)
            if number == line:
                rows.append(
                    f'<span id="L{number}" class="hit">{number:>4}  {escaped}</span>'
                )
            else:
                rows.append(
                    f'<span id="L{number}">{number:>4}  {escaped}</span>'
                )
        body = "\n".join(rows)
        page = f"""<!doctype html><meta charset="utf-8"><title>{html_module.escape(path)}</title>
<style>body{{background:#fbf8f2;color:#2c2a26;font:14px/1.55 ui-monospace,Consolas,monospace;margin:24px}}
pre{{white-space:pre-wrap}} .hit{{background:#ffe08a}} .bar{{font-family:system-ui;margin-bottom:12px}}</style>
<div class="bar">{html_module.escape(path)} · 第 {line} 行 · <a href="/api/help/doc?path={html_module.escape(path)}">从头查看</a></div>
<pre>{body}</pre>
<script>document.getElementById('L{line}')?.scrollIntoView({{block:'center'}})</script>"""
        return HTMLResponse(page, headers={"Cache-Control": "no-store"})

    return router
