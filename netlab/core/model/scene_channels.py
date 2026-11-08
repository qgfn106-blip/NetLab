from __future__ import annotations

import copy
from typing import Any

from .scene_engines import SignalEngine, _Engine


class _SceneChannelsMixin:
    def channel_display_name(self, key: str) -> str:
        """把内部稳定通道键 ``<kind>:<node-or-edge-id>:<field>`` 映射为显示名。

        记录器内部保存 id 键，避免节点/连接改名后历史帧与新帧断档；对外
        ``/api/live`` 仍按当前显示名返回，调用方看到的是同一逻辑通道。
        未知键原样返回，便于兼容旧工程与第三方插件。
        """
        parts = key.split(":", 2)
        if len(parts) != 3:
            return key
        kind, ident, field = parts
        record = None
        if kind in {"n", "state"}:
            record = self.nodes.get(ident)
        elif kind == "e":
            record = self.edges.get(ident)
        if record is None:
            return key
        return f"{kind}:{record.name}:{field}"

    def probes(self, *, by_id: bool = False) -> dict[str, float]:
        engine = self.ensure_engine()
        values = engine.probes(by_id=by_id)
        if len(values) > 240:
            values = dict(list(values.items())[:240])
        return values

    def stats(self) -> dict[str, Any]:
        base: dict[str, Any] = {
            "mode": self.mode,
            "revision": self.revision,
            "integration": self.integration,
            "step_ms": self.last_step_ms,
            "node_count": len(self.nodes),
            "edge_count": len(self.edges),
        }
        try:
            base.update(self.ensure_engine().stats())
        except Exception as exc:  # 让界面仍能渲染并提示问题
            base["engine_error"] = str(exc)
        return base

    def runtime_state(self) -> dict[str, Any]:
        """给 HTTP 层的完整快照：包含最新输出、输入与引擎统计。"""
        engine: _Engine | None = None
        engine_error: str | None = None
        try:
            engine = self.ensure_engine()
        except Exception as exc:
            engine_error = str(exc)

        edges = []
        for record in self.edges.values():
            item = record.snapshot()
            output: dict[str, Any] = {}
            if isinstance(engine, SignalEngine):
                connection = engine.edge_map.get(record.id)
                if connection is not None:
                    output = copy.deepcopy(connection.output)
            else:
                for key in ("current", "voltage_difference", "power"):
                    if key in record.state:
                        output[key] = record.state[key]
            item["output"] = output
            edges.append(item)

        state = {
            "mode": self.mode,
            "integration": self.integration,
            "solve_algebraic": bool(self.solve_algebraic),
            "revision": self.revision,
            "nodes": [record.snapshot() for record in self.nodes.values()],
            "edges": edges,
            "stats": self.stats(),
        }
        if engine_error is not None:
            state["engine_error"] = engine_error
        return state
