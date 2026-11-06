"""写代码时最省事的一行出图：`pk.quick(y)`。

调试仿真时最常见的诉求是「我手上这串数长什么样」，而不是「打开一个应用、建 spec、
选 kind、写文件」。这个模块只做一件事：把数组立刻变成一张图，返回字节或文件路径。

```python
import plotkit as pk
pk.quick(y)                       # 返回 PNG 字节
pk.quick(x, y, path="a.png")      # 写文件并返回路径
pk.quick(y, kind="marker", show=True)   # 用系统看图器打开
```

约定：
- 参数顺序与 matplotlib 一致（`quick(y)` 或 `quick(x, y)`），不引入新概念；
- 只走既有的 `Figure` + `add_plot`，不绕过渲染管线（保证与正式出图一致）；
- 出错直接抛，不做静默兜底——调试工具吞异常比崩掉更难查。
"""

from __future__ import annotations

import os
import pathlib
import tempfile
from typing import Any, Sequence

import numpy as np

__all__ = ["quick", "show"]


def _as_series(args: Sequence[Any]) -> tuple[np.ndarray, list[np.ndarray]]:
    """把 `quick(y)` / `quick(x, y)` / `quick(x, [y1, y2])` 拆成 (x, [y...])。"""
    if len(args) == 1:
        ys = args[0]
        if isinstance(ys, (list, tuple)) and ys and np.ndim(ys[0]) >= 1:
            series = [np.asarray(item, dtype=float).ravel() for item in ys]
            x = np.arange(series[0].size, dtype=float)
            return x, series
        y = np.asarray(ys, dtype=float).ravel()
        return np.arange(y.size, dtype=float), [y]
    if len(args) == 2:
        x = np.asarray(args[0], dtype=float).ravel()
        ys = args[1]
        if isinstance(ys, (list, tuple)) and ys and np.ndim(ys[0]) >= 1:
            return x, [np.asarray(item, dtype=float).ravel() for item in ys]
        return x, [np.asarray(ys, dtype=float).ravel()]
    raise TypeError("quick() 接受 quick(y)、quick(x, y) 或 quick(x, [y1, y2, ...])")


def _as_xy(args: Sequence[Any]) -> tuple[np.ndarray, np.ndarray]:
    if len(args) == 1:
        y = np.asarray(args[0], dtype=float)
        x = np.arange(y.size, dtype=float)
    elif len(args) == 2:
        x = np.asarray(args[0], dtype=float)
        y = np.asarray(args[1], dtype=float)
    else:
        raise TypeError("quick() 接受 quick(y) 或 quick(x, y)")
    if x.size != y.size:
        raise ValueError(f"x/y 长度不一致：{x.size} vs {y.size}")
    return x, y


def quick(
    *args: Any,
    kind: str = "line",
    title: str | None = None,
    path: str | os.PathLike[str] | None = None,
    width: int = 900,
    height: int = 520,
    dpi: int = 100,
    fmt: str = "png",
    show: bool = False,
    xlabel: str | None = None,
    ylabel: str | None = None,
    labels: Sequence[str] | None = None,
    style: dict[str, Any] | None = None,
    **kwargs: Any,
) -> bytes | str:
    """把一维数组立刻画出来。

    `style` 与其余关键字参数直接并进图层样式（`color=`/`width=`/`marker=`…），
    未知键会走 PlotKit 既有的 warn/strict 逻辑。
    """
    import plotkit as pk

    x, series = _as_series(args)
    for item in series:
        if item.size != x.size:
            raise ValueError(f"x/y 长度不一致：{x.size} vs {item.size}")
    fig = pk.figure(
        size=(width / max(dpi, 1), height / max(dpi, 1)), dpi=dpi, title=title or ""
    )
    fig.add_data("x", x, role="coord")
    merged = dict(style or {})
    merged.update(kwargs)
    for i, y in enumerate(series):
        name = f"y{i}" if len(series) > 1 else "y"
        fig.add_data(name, y, role="series")
        layer_style = dict(merged) if merged else None
        if len(series) > 1 and labels and i < len(labels):
            fig.add_plot(kind, x="x", y=name, style=layer_style, label=str(labels[i]))
        else:
            fig.add_plot(kind, x="x", y=name, style=layer_style)
    if xlabel or ylabel:
        fig.set_view(0, xlabel=xlabel or "", ylabel=ylabel or "")
    payload = fig.render(width=width, height=height, dpi=dpi, fmt=fmt)
    if path is not None:
        out = pathlib.Path(path)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(payload)
        if show:
            show_file(out)
        return str(out)
    if show:
        tmp = pathlib.Path(tempfile.gettempdir()) / f"plotkit_quick.{fmt}"
        tmp.write_bytes(payload)
        show_file(tmp)
    return payload


def show_file(path: str | os.PathLike[str]) -> None:
    """用系统默认程序打开（Windows 用 os.startfile，其它平台尽力而为）。"""
    target = str(path)
    if hasattr(os, "startfile"):  # Windows
        os.startfile(target)  # type: ignore[attr-defined]
        return
    import subprocess
    import sys

    opener = "open" if sys.platform == "darwin" else "xdg-open"
    subprocess.Popen([opener, target])


def show(payload_or_path: bytes | str | os.PathLike[str], fmt: str = "png") -> str:
    """把 `quick()` 的返回值直接显示出来，返回临时文件路径。"""
    if isinstance(payload_or_path, (bytes, bytearray)):
        tmp = pathlib.Path(tempfile.gettempdir()) / f"plotkit_quick.{fmt}"
        tmp.write_bytes(bytes(payload_or_path))
    else:
        tmp = pathlib.Path(payload_or_path)
    show_file(tmp)
    return str(tmp)
