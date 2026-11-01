"""服务桥：GUI 与 :data:`netlab.server.SERVICE` 之间唯一的一层。

约束（spec C4/C6）：
- 所有服务调用都发生在 GUI 线程**之外**的读取线程里（``LiveWorker``），
  或者是一次很短的同步变更（``mutate``），GUI 永不持有求解器锁；
- 每次变更后由服务端重建不可变快照（``SceneVM``/``TreeVM``），控件只读快照。

没有 HTTP：控制面直接调用 ``SERVICE``，数据面由读取线程取帧。
"""

from __future__ import annotations

from typing import Any, Callable

from PySide6.QtCore import QObject, QThread, QTimer, Signal

from .models import LiveVM, SceneVM, TreeVM, build_live_vm, build_scene_vm, build_tree_vm


class LiveWorker(QThread):
    """独立线程按固定节拍取增量帧，避免 GUI 线程被求解器锁拖住。"""

    payload = Signal(object)
    failed = Signal(str)

    def __init__(self, service: Any, interval_ms: int = 33, parent: QObject | None = None) -> None:
        super().__init__(parent)
        self._service = service
        self._interval = max(10, int(interval_ms))
        self._stop = False
        self._cursor = 0

    def reset_cursor(self) -> None:
        self._cursor = 0

    def stop(self) -> None:
        self._stop = True
        self.wait(1500)

    def run(self) -> None:  # pragma: no cover - 线程体
        while not self._stop:
            try:
                payload = self._service.live(self._cursor, 600)
            except Exception as exc:  # 求解器重启/网络切换时游标可能失效
                self._cursor = 0
                self.failed.emit(str(exc))
                self.msleep(120)
                continue
            cursor = int(payload.get("cursor") or 0)
            if cursor < self._cursor:
                self._cursor = 0
            else:
                self._cursor = cursor
            if payload.get("frames"):
                self.payload.emit(payload)
            self.msleep(self._interval)


class ServiceBridge(QObject):
    """把 ``SERVICE`` 的变更翻译成信号；所有 UI 都订阅这里。"""

    sceneChanged = Signal(object)   # SceneVM
    treeChanged = Signal(object)    # TreeVM
    liveChanged = Signal(object)    # LiveVM
    statusChanged = Signal(object)  # dict
    errorRaised = Signal(str)
    logRaised = Signal(str)

    def __init__(self, service: Any, parent: QObject | None = None) -> None:
        super().__init__(parent)
        self._service = service
        self._scene: SceneVM = build_scene_vm(None)
        self._tree: TreeVM = build_tree_vm(None, self._scene)
        self._catalog: dict[str, Any] = {}
        self._worker: LiveWorker | None = None
        self._pending = False
        self._coalesce = QTimer(self)
        self._coalesce.setSingleShot(True)
        self._coalesce.setInterval(60)
        self._coalesce.timeout.connect(self._flush)
        self.refresh()

    # ---- 只读访问 ---------------------------------------------------------
    @property
    def service(self) -> Any:
        return self._service

    @property
    def scene(self) -> SceneVM:
        return self._scene

    @property
    def tree(self) -> TreeVM:
        return self._tree

    @property
    def catalog(self) -> dict[str, Any]:
        return self._catalog

    def snapshot(self) -> dict[str, Any]:
        return self._service.snapshot()

    def status(self) -> dict[str, Any]:
        try:
            info = self._service.info()
        except Exception as exc:  # pragma: no cover - 服务不可用
            return {"error": str(exc)}
        return info

    # ---- 刷新 -------------------------------------------------------------
    def refresh(self, *, immediate: bool = False) -> None:
        """重建快照；多次变更合并成一次重绘。"""
        if immediate:
            self._flush()
            return
        if not self._pending:
            self._pending = True
            self._coalesce.start()

    def _flush(self) -> None:
        self._pending = False
        try:
            snapshot = self._service.snapshot()
            self._scene = build_scene_vm(snapshot.get("scene"))
            self._tree = build_tree_vm(self._service.list_networks(), self._scene)
        except Exception as exc:
            self.errorRaised.emit(str(exc))
            return
        self.sceneChanged.emit(self._scene)
        self.treeChanged.emit(self._tree)
        self.statusChanged.emit(self.status())

    def reload_catalog(self) -> None:
        try:
            self._catalog = self._service.scene.catalog()
        except Exception as exc:
            self.errorRaised.emit(str(exc))

    # ---- 实时数据 ---------------------------------------------------------
    def start_live(self, interval_ms: int = 33) -> None:
        if self._worker is not None:
            return
        self._worker = LiveWorker(self._service, interval_ms, self)
        self._worker.payload.connect(self._on_live)
        self._worker.failed.connect(self.logRaised.emit)
        self._worker.start()

    def stop_live(self) -> None:
        if self._worker is not None:
            self._worker.stop()
            self._worker = None

    def reset_live(self) -> None:
        if self._worker is not None:
            self._worker.reset_cursor()

    def _on_live(self, payload: object) -> None:
        if not isinstance(payload, dict):
            return
        live: LiveVM = build_live_vm(payload)
        self.liveChanged.emit(live)
        self.statusChanged.emit(self.status())

    # ---- 变更 -------------------------------------------------------------
    def _mutate(self, action: Callable[[Any], Any], *, message: str = "") -> Any:
        try:
            result = self._service.mutate(action)
        except Exception as exc:
            self.errorRaised.emit(str(exc))
            return None
        if message:
            self.logRaised.emit(message)
        self.refresh()
        return result

    def add_node(
        self,
        kind: str,
        x: float,
        y: float,
        name: str = "",
        params: dict[str, Any] | None = None,
    ) -> Any:
        label = name or self._next_name(kind)
        extra = dict(params or {})
        return self._mutate(
            lambda scene: scene.add_node(
                name=label,
                kind=kind,
                params=extra or None,
                position={"x": float(x), "y": float(y)},
            ),
            message=f"添加节点 {label}（{kind}）",
        )

    def _next_name(self, kind: str) -> str:
        existing = {node.name for node in self._scene.nodes}
        for index in range(1, 999):
            candidate = f"{kind}{index}"
            if candidate not in existing:
                return candidate
        return kind

    def add_edge(self, source: str, target: str, kind: str = "wire") -> Any:
        return self._mutate(
            lambda scene: scene.add_edge(source=source, target=target, kind=kind),
            message="连接两个节点",
        )

    def delete_node(self, node_id: str) -> Any:
        return self._mutate(lambda scene: scene.delete_node(node_id), message="删除节点")

    def delete_edge(self, edge_id: str) -> Any:
        return self._mutate(lambda scene: scene.delete_edge(edge_id), message="删除连接")

    def move_nodes(self, items: list[dict[str, float]]) -> Any:
        if not items:
            return None
        return self._mutate(lambda scene: scene.update_positions(items))

    def update_node(self, node_id: str, payload: dict[str, Any]) -> Any:
        return self._mutate(lambda scene: scene.update_node(node_id, payload))

    def update_edge(self, edge_id: str, payload: dict[str, Any]) -> Any:
        return self._mutate(lambda scene: scene.update_edge(edge_id, payload))

    def add_waypoint(self, edge_id: str, x: float, y: float) -> Any:
        edge = self._scene.edge(edge_id)
        if edge is None:
            return None
        points = [{"x": px, "y": py} for px, py in edge.waypoints]
        points.append({"x": float(x), "y": float(y)})
        return self.update_edge(edge_id, {"route": "orthogonal", "waypoints": points})

    def clear_waypoints(self, edge_id: str) -> Any:
        return self.update_edge(edge_id, {"route": "auto", "waypoints": []})

    # ---- 网络与仿真 -------------------------------------------------------
    def switch_network(self, network_id: str) -> Any:
        result = self._mutate(lambda _scene: self._service.switch(network_id))
        self.reset_live()
        self.refresh(immediate=True)
        return result

    def add_network(self, name: str = "") -> Any:
        return self._mutate(lambda _scene: self._service.add_network(name or None))

    def rename_network(self, network_id: str, name: str) -> Any:
        return self._mutate(lambda _scene: self._service.rename_network(network_id, name))

    def remove_network(self, network_id: str) -> Any:
        result = self._mutate(lambda _scene: self._service.remove_network(network_id))
        self.reset_live()
        self.refresh(immediate=True)
        return result

    def control(self, action: str) -> Any:
        try:
            if action == "run":
                self._service.start()
            elif action == "pause":
                self._service.pause()
            elif action == "toggle":
                self._service.toggle()
            elif action == "step":
                self._service.step_once(1)
            elif action == "zero":
                self._service.zero_time()
            elif action == "reset":
                self._service.reset()
                self.reset_live()
        except Exception as exc:
            self.errorRaised.emit(str(exc))
            return None
        self.statusChanged.emit(self.status())
        self.refresh()
        return True

    def set_mode(self, mode: str) -> Any:
        from ..templates import build_template

        name = {"signal": "blank_signal", "circuit": "blank_circuit", "vector": "blank_vector"}[mode]
        payload = build_template(name)
        result = self._mutate(lambda _scene: self._service.load_scene(payload), message=f"切换模式：{mode}")
        self.reset_live()
        self.refresh(immediate=True)
        return result

    def run_all(self) -> Any:
        try:
            self._service.run_all()
        except Exception as exc:
            self.errorRaised.emit(str(exc))
        self.refresh()

    def pause_all(self) -> Any:
        try:
            self._service.pause_all()
        except Exception as exc:
            self.errorRaised.emit(str(exc))
        self.refresh()

    # ---- 工程 -------------------------------------------------------------
    def export_scene(self, include_state: bool = False) -> dict[str, Any]:
        return self._service.export_scene(include_state=include_state)

    def import_scene(self, payload: dict[str, Any]) -> Any:
        result = self._mutate(lambda _scene: self._service.import_scene(payload), message="导入场景")
        self.reset_live()
        self.refresh(immediate=True)
        return result

    def clear_scene(self) -> Any:
        return self._mutate(lambda _scene: self._service.clear_scene(), message="清空场景")


class FemWorker(QThread):
    """有限元独立读取线程（FEM 有自己的求解器与锁）。"""

    snapshotReady = Signal(object)
    failed = Signal(str)

    def __init__(self, parent: QObject | None = None, interval_ms: int = 250) -> None:
        super().__init__(parent)
        self._interval = max(50, int(interval_ms))
        self._stop = False

    def stop(self) -> None:
        self._stop = True
        self.wait(1500)

    def run(self) -> None:  # pragma: no cover - 线程体
        from ..server import FEM

        tick = 0
        while not self._stop:
            try:
                payload = FEM.snapshot(include_mesh=(tick % 8 == 0))
            except Exception as exc:
                self.failed.emit(str(exc))
                self.msleep(400)
                continue
            self.snapshotReady.emit(payload)
            tick += 1
            self.msleep(self._interval)


__all__ = ["FemWorker", "LiveWorker", "ServiceBridge"]
