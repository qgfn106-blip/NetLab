"""matplotlib 风格的轴代理：`fig, axes = pk.subplots(2, 1)`。

只实现"写 spec 需要的那个子集"（plot/scatter/bar/标签/范围/网格/网格开关/标注），
所有方法都落到同一份 spec 上，因此与 `add_plot()` 完全等价。
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

import numpy as np



class AxesProxy:
    """单个子图槽位的代理。方法名与 matplotlib 保持一致，方便肌肉记忆迁移。"""

    def __init__(self, figure: Any, index: int = 0) -> None:
        self._figure = figure
        self.index = int(index)

    # ---------------- 绘图 ----------------
    def plot(self, x: Any = None, y: Any = None, *, label: str | None = None, **kwargs: Any):
        if y is None:
            x, y = None, x
        if x is None:
            data_name = self._ensure(y, role="series")
            x_name = self._axis_dataset(data_name)
            return self._figure.add_plot("line", x=x_name, y=data_name,
                                         subplot=self.index, label=label, **kwargs)
        return self._figure.add_plot("line", x=x, y=y, subplot=self.index, label=label, **kwargs)

    def scatter(self, x: Any, y: Any, *, label: str | None = None, **kwargs: Any):
        return self._figure.add_plot("marker", x=x, y=y, subplot=self.index, label=label, **kwargs)

    def bar(self, x: Any, y: Any, *, label: str | None = None, **kwargs: Any):
        return self._figure.add_plot("bar", x=x, y=y, subplot=self.index, label=label, **kwargs)

    def _ensure(self, values: Any, *, role: str) -> str:
        if isinstance(values, str):
            return values
        name = f"anon_{role}_{len(self._figure.store) + 1}"
        self._figure.store.add(name, values, role=role, tags=("anon",))
        return name

    def _axis_dataset(self, series_name: str) -> str:
        """没有 x 时用一个等长的索引序列当 x（对齐 mpl 的隐式 x=0..n-1）。"""
        values = self._figure.store.values(series_name)
        length = int(np.asarray(values).shape[0]) if np.asarray(values).ndim else 1
        name = f"idx_{series_name}"
        if name not in self._figure.store:
            self._figure.store.add(name, np.arange(length, dtype=float), role="coord", tags=("index",))
        return name

    # ---------------- 轴属性 ----------------
    def set_xlabel(self, text: str, **_: Any) -> None:
        self._figure.update_view(xlabel=str(text))

    def set_ylabel(self, text: str, **_: Any) -> None:
        self._figure.update_view(ylabel=str(text))

    def set_title(self, text: str, **_: Any) -> None:
        self.set_view(title=str(text))

    def set_xlim(self, *args: Any, **_: Any) -> None:
        self.set_view(xlim=list(self._pair(args)))

    def set_ylim(self, *args: Any, **_: Any) -> None:
        self.set_view(ylim=list(self._pair(args)))

    def set_xscale(self, scale: str = "linear", **_: Any) -> None:
        self.set_view(xscale=str(scale))

    def set_yscale(self, scale: str = "linear", **_: Any) -> None:
        self.set_view(yscale=str(scale))

    def grid(self, visible: bool = True, **_: Any) -> None:
        self.set_view(grid=bool(visible))

    def legend(self, *args: Any, **_: Any) -> None:
        """显式 legend() 在 spec 里是"按 label 自动出图例"，无需落地字段。"""

    def invert_yaxis(self, **_: Any) -> None:
        self.set_view(invert_y=True)

    def set_view(self, **kwargs: Any) -> None:
        for layer in self._figure.spec["layers"]:
            if int(layer.get("subplot", 0)) == self.index:
                layer["view"].update(kwargs)

    @staticmethod
    def _pair(args: Sequence[Any]) -> tuple[float, float]:
        if len(args) == 1 and isinstance(args[0], (tuple, list, np.ndarray)):
            lo, hi = args[0]
            return float(lo), float(hi)
        if len(args) == 2:
            return float(args[0]), float(args[1])
        raise TypeError(f"需要 (lo, hi) 或两个数值，收到 {args!r}")

    # ---------------- 标注 ----------------
    def axhline(self, y: float = 0.0, **kwargs: Any) -> None:
        self._annotate({"type": "hline", "y": float(y), "color": kwargs.get("color", "#94a3b8")})

    def axvline(self, x: float = 0.0, **kwargs: Any) -> None:
        self._annotate({"type": "vline", "x": float(x), "color": kwargs.get("color", "#94a3b8")})

    def axhspan(self, lo: float, hi: float, **kwargs: Any) -> None:
        self._annotate({"type": "band", "from": float(lo), "to": float(hi),
                        "color": kwargs.get("color", "#94a3b8")})

    def text(self, x: float, y: float, text: str, **_: Any) -> None:
        self._annotate({"type": "text", "x": float(x), "y": float(y), "text": str(text)})

    def _annotate(self, annotation: Mapping[str, Any]) -> None:
        for layer in reversed(self._figure.spec["layers"]):
            if int(layer.get("subplot", 0)) == self.index:
                layer["annotations"].append(dict(annotation))
                return
        # 该子图还没有图层：不造"幽灵图层"（空 data 的 layer 过不了校验），只记警告
        msg = f"子图 {self.index} 还没有图层，标注 {annotation.get('type')} 已忽略（先画一条线再加标注）"
        self._figure.warnings.append(msg)

    def __repr__(self) -> str:  # pragma: no cover
        return f"AxesProxy(subplot={self.index}, layers={sum(1 for l in self._figure.spec['layers'] if int(l.get('subplot', 0)) == self.index)})"
