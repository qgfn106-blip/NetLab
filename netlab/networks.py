"""多网络容器（R07 / D18）。

一个工程可以有多个 **网络**（界面口语里的「层」）；同一时刻只有一个是「当前网络」，
编辑与单层运行只作用于当前网络，其余网络保持冻结（不 step、不轮询、不重绘）。

设计取舍：

* 每条网络是一个独立的 ``Simulation``（各自线程、录制器、锁），互不共享运行时状态；
* 工程级资源（blocks / extensions / FEM / ui）仍由工程层持有，网络只持有场景与节奏；
* **兼容层**：容器用 ``__getattr__`` 把未知属性代理给当前 ``Simulation``，让既有的
  ``/api/scene``、``/api/nodes`` 等单网络接口无需重写就能继续工作；新增的多网络能力
  走容器自身的显式方法。
"""

from __future__ import annotations

import copy
import threading
import uuid
from dataclasses import asdict
from typing import Any

from .limits import ConflictError, NotFoundError, ValidationError
from .project import build_project_from_networks, project_scene_payload
from .schematic import fill_missing_layout
from .scene import Scene
from .simulation import Simulation
from .templates import build_template


class NetworkContainer:
    """管理一个工程内的多条网络；默认只推进当前网络。"""

    def __init__(self, initial: Simulation, *, name: str = "网络 1") -> None:
        self.lock = threading.RLock()
        self._entries: dict[str, Simulation] = {}
        self._names: dict[str, str] = {}
        self._order: list[str] = []
        self._current = ""
        self.degraded: dict[str, Any] | None = None
        self._append(initial, name)

    # ---- 内部 ---------------------------------------------------------------
    def _append(self, simulation: Simulation, name: str) -> str:
        network_id = uuid.uuid4().hex[:12]
        self._entries[network_id] = simulation
        self._names[network_id] = str(name or f"网络 {len(self._order) + 1}")[:60]
        self._order.append(network_id)
        if not self._current:
            self._current = network_id
        return network_id

    def _entry(self, network_id: str) -> Simulation:
        simulation = self._entries.get(network_id)
        if simulation is None:
            raise NotFoundError(f"网络 {network_id!r} 不存在")
        return simulation

    # ---- 当前网络与兼容代理 --------------------------------------------------
    @property
    def current_id(self) -> str:
        return self._current

    @property
    def current_name(self) -> str:
        return self._names.get(self._current, "")

    @property
    def current(self) -> Simulation:
        return self._entry(self._current)

    def simulation(self, network_id: str) -> Simulation:
        return self._entry(network_id)

    def __getattr__(self, name: str) -> Any:
        # 仅代理 Simulation 的成员；下划线/内部名字必须走显式方法，避免意外递归。
        if name.startswith("_"):
            raise AttributeError(name)
        current = self.__dict__.get("_entries", {}).get(self.__dict__.get("_current", ""))
        if current is None:
            raise AttributeError(name)
        return getattr(current, name)

    # ---- 查询 ---------------------------------------------------------------
    def list_networks(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        with self.lock:
            for network_id in self._order:
                simulation = self._entries[network_id]
                items.append(
                    {
                        "id": network_id,
                        "name": self._names[network_id],
                        "current": network_id == self._current,
                        "mode": simulation.scene.mode,
                        "nodes": len(simulation.scene.nodes),
                        "edges": len(simulation.scene.edges),
                        "running": simulation.running,
                        "time": simulation.time,
                        "steps": simulation.steps,
                    }
                )
        return items

    def info(self) -> dict[str, Any]:
        payload = self.current.info()
        payload["degraded"] = self.degraded
        payload["network"] = {
            "id": self._current,
            "name": self.current_name,
            "count": len(self._order),
        }
        return payload

    # ---- 生命周期 -----------------------------------------------------------
    def ensure_thread(self) -> None:
        # 只给当前网络起线程；其余网络在被切换为当前或「全局运行」时才启动。
        self.current.ensure_thread()

    def shutdown(self) -> None:
        with self.lock:
            items = list(self._entries.values())
        for simulation in items:
            simulation.shutdown()

    def run_all(self) -> list[dict[str, Any]]:
        """全局运行：所有网络各自起线程并开始推进（D18）。"""
        with self.lock:
            items = list(self._entries.items())
        for _network_id, simulation in items:
            simulation.ensure_thread()
            simulation.start()
        return self.list_networks()

    def pause_all(self) -> list[dict[str, Any]]:
        with self.lock:
            items = list(self._entries.values())
        for simulation in items:
            simulation.pause()
        return self.list_networks()

    # ---- 结构编辑 -----------------------------------------------------------
    def add_network(self, name: str | None = None) -> dict[str, Any]:
        mode = self.current.scene.mode
        template = build_template(
            {"signal": "blank_signal", "circuit": "blank_circuit", "vector": "blank_vector"}[
                mode
            ]
        )
        simulation = Simulation(Scene(mode))
        try:
            simulation.load_scene(template)
        except Exception:
            simulation.shutdown()
            raise
        with self.lock:
            label = str(name or f"网络 {len(self._order) + 1}")[:60]
            network_id = self._append(simulation, label)
        return {"id": network_id, "name": label, "networks": self.list_networks()}

    def rename_network(self, network_id: str, name: str) -> dict[str, Any]:
        self._entry(network_id)
        clean = str(name or "").strip()
        if not clean:
            raise ValidationError("网络名称不能为空")
        if len(clean) > 60:
            raise ValidationError("网络名称最长 60 个字符")
        with self.lock:
            self._names[network_id] = clean
        return {"id": network_id, "name": clean, "networks": self.list_networks()}

    def remove_network(self, network_id: str) -> dict[str, Any]:
        simulation = self._entry(network_id)
        with self.lock:
            if len(self._order) <= 1:
                raise ValidationError("工程至少需要保留一个网络")
            self._order.remove(network_id)
            self._entries.pop(network_id, None)
            self._names.pop(network_id, None)
            was_current = network_id == self._current
            if was_current:
                self._current = self._order[0]
        simulation.pause()
        simulation.shutdown()
        if was_current:
            self.current.ensure_thread()
        return {"removed": network_id, "current": self._current, "networks": self.list_networks()}

    def switch(self, network_id: str) -> dict[str, Any]:
        simulation = self._entry(network_id)
        with self.lock:
            previous = self._entries.get(self._current)
            self._current = network_id
        if previous is not None and previous is not simulation:
            previous.pause()
        simulation.ensure_thread()
        return {"current": network_id, "networks": self.list_networks()}

    # ---- 工程读写 -----------------------------------------------------------
    def build_project(
        self,
        *,
        name: str | None = None,
        fem: Any | None = None,
        ui: dict[str, Any] | None = None,
        extensions: list[dict[str, Any]] | None = None,
        created: str | None = None,
        metadata: dict[str, Any] | None = None,
        library: str | None = None,
    ) -> dict[str, Any]:
        """把全部网络打包成工程；blocks 汇总到顶层一份。

        ``library`` 非空时按引用式保存（只记 id+version）。
        """
        networks: list[dict[str, Any]] = []
        blocks_by_id: dict[str, dict[str, Any]] = {}
        for network_id in list(self._order):
            simulation = self._entries[network_id]
            with simulation.lock:
                payload = simulation.scene.to_payload(include_state=False)
                scene_blocks = payload.pop("blocks", []) or []
                for block in scene_blocks:
                    blocks_by_id[str(block.get("id"))] = copy.deepcopy(block)
                networks.append(
                    {
                        "id": network_id,
                        "name": self._names[network_id],
                        "scene": payload,
                        "sim": asdict(simulation.config),
                    }
                )
        return build_project_from_networks(
            networks,
            current=self._current,
            fem=fem,
            name=name,
            ui=ui,
            blocks=list(blocks_by_id.values()),
            extensions=extensions,
            created=created,
            metadata=metadata,
            library=library,
        )

    def set_degraded(self, info: dict[str, Any] | None) -> None:
        self.degraded = info or None

    def mutate(self, function):
        # D7：降级只读期间禁止任何结构/参数修改；补回库文件或替换占位块后解除。
        if self.degraded:
            raise ConflictError(
                "工程处于降级只读模式：请先补回缺失的库文件，或确认用占位块替换后再编辑"
            )
        return self.current.mutate(function)

    def load_scene(self, payload):
        self.degraded = None
        result = self.current.load_scene(payload)
        fill_missing_layout(self.current.scene)
        return result

    def load_project(
        self,
        project: dict[str, Any],
        library: str | None = None,
        *,
        allow_degraded: bool = False,
    ) -> dict[str, Any]:
        """用已校验的工程整体替换所有网络（旧网络线程会被关闭）。"""
        raw_networks = project.get("networks")
        if not isinstance(raw_networks, list) or not raw_networks:
            raise ValidationError("工程的 networks 必须是非空数组")
        created: list[tuple[str, str, Simulation]] = []
        try:
            for item in raw_networks:
                network_id = str(item.get("id") or uuid.uuid4().hex[:12])
                name = str(item.get("name") or f"网络 {len(created) + 1}")[:60]
                simulation = Simulation(Scene("signal"))
                simulation.load_scene(
                    project_scene_payload(
                        project,
                        network_id or None,
                        library=library,
                        allow_degraded=allow_degraded,
                    )
                )
                fill_missing_layout(simulation.scene)
                created.append((network_id, name, simulation))
        except Exception:
            for _id, _name, simulation in created:
                simulation.shutdown()
            raise

        with self.lock:
            old = list(self._entries.values())
            self._entries = {}
            self._names = {}
            self._order = []
            self._current = ""
            for network_id, name, simulation in created:
                self._entries[network_id] = simulation
                self._names[network_id] = name
                self._order.append(network_id)
            self._current = str(project.get("current") or "")
            if self._current not in self._entries:
                self._current = self._order[0]
        for simulation in old:
            simulation.shutdown()
        self.current.ensure_thread()
        self.degraded = project.get("degraded") or None
        return {
            "current": self._current,
            "networks": self.list_networks(),
            "degraded": self.degraded,
        }


__all__ = ["NetworkContainer"]
