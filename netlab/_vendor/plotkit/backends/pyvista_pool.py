"""PyVista 三维渲染的进程池（批量出图用）。

为什么必须是**进程**而不是线程：Windows 上 OpenGL 上下文（HGLRC）由
`wglMakeCurrent` 绑在创建它的线程上，跨线程用会 `code 6` 出黑图、跨线程销毁直接段错误。
所以单进程里所有三维渲染只能排在一个 VTK 线程上（见 `pyvista_backend._WORKER`）。
要真正并行，只能开多个进程，每个进程各自持有一个上下文。

代价：每个 worker 第一次渲染要 import pyvista/vtk（约 1–2 s）。所以它适合
**批量出图**（动画帧、参数扫描、论文多联图），不适合"一次只画一张"。

    from plotkit.backends import pyvista_pool
    frames = pyvista_pool.render_many(jobs, workers=6)

`jobs` 的每一项是 `(spec, store, kwargs)`，和 `pyvista_backend.render_result` 同参。
"""

from __future__ import annotations

import os
from concurrent.futures import ProcessPoolExecutor
from typing import Any, Iterable, Mapping

DEFAULT_WORKERS = int(os.environ.get("PLOTKIT_PYVISTA_WORKERS", "0") or 0)


def workers_default() -> int:
    """默认并发数：`PLOTKIT_PYVISTA_WORKERS` 优先，否则 min(4, CPU-1)。"""
    if DEFAULT_WORKERS > 0:
        return DEFAULT_WORKERS
    cpu = os.cpu_count() or 2
    return max(1, min(4, cpu - 1))


def _render_one(payload: Mapping[str, Any]) -> bytes:
    """子进程入口：重建 DataStore → 调后端 → 只回传图片字节。"""
    from ..store.registry import DataStore
    from . import pyvista_backend

    store = DataStore()
    for name, values in (payload["data"] or {}).items():
        store.add(name, values, role="auto", overwrite=True)
    result = pyvista_backend.render_result(
        payload["spec"], store,
        width=payload["width"], height=payload["height"], dpi=payload["dpi"],
        fmt=payload["fmt"], xlim=payload["xlim"], ylim=payload["ylim"],
        with_limits=False,
    )
    return result.payload


def _snapshot(store, spec: Mapping[str, Any]) -> dict[str, Any]:
    """把 spec 引用到的数据集一次性拷出来（子进程没有原 store）。"""
    names: set[str] = set()
    for layer in spec.get("layers") or []:
        for key, value in (layer.get("data") or {}).items():
            if isinstance(value, str):
                names.add(value)
    out: dict[str, Any] = {}
    for name in names:
        try:
            out[name] = store.values(name)
        except KeyError:
            continue
    return out


def render_many(jobs: Iterable[tuple], *, workers: int | None = None) -> list[bytes]:
    """批量渲染：每个 job 是 `(spec, store, kwargs)`，返回与 job 同序的 PNG 列表。"""
    items = list(jobs)
    if not items:
        return []
    payloads = []
    for spec, store, kwargs in items:
        payloads.append({
            "spec": spec,
            "data": _snapshot(store, spec),
            "width": int(kwargs.get("width", 900)),
            "height": int(kwargs.get("height", 520)),
            "dpi": int(kwargs.get("dpi", 100)),
            "fmt": str(kwargs.get("fmt", "png")),
            "xlim": kwargs.get("xlim"),
            "ylim": kwargs.get("ylim"),
        })
    count = max(1, int(workers or workers_default()))
    if count == 1 or len(payloads) == 1:
        return [_render_one(p) for p in payloads]
    with ProcessPoolExecutor(max_workers=count) as pool:
        return list(pool.map(_render_one, payloads))
