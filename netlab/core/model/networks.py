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
import hashlib
import json
import os
import tempfile
import threading
import time
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Any

from ..common.limits import ConflictError, NotFoundError, ValidationError
from .project import build_project_from_networks, project_scene_payload
from .schematic import fill_missing_layout
from .scene import MODES, Scene
from ..compute.simulation import Simulation
from .templates import build_template


class NetworkContainer:
    """管理一个工程内的多条网络；默认只推进当前网络。"""

    def __init__(self, initial: Simulation, *, name: str = "网络 1") -> None:
        self.lock = threading.RLock()
        self._entries: dict[str, Simulation] = {}
        self._names: dict[str, str] = {}
        self._order: list[str] = []
        self._current = ""
        self._states: dict[str, list[dict[str, Any]]] = {}
        self.degraded: dict[str, Any] | None = None
        self.ui: dict[str, Any] = {}
        self.plugins: list[dict[str, Any]] = []
        # W2：每状态预计算缓存。工程目录由前端通过 /api/project/context 告知；
        # 未保存时缓存落在进程临时目录，保存后迁移到「工程文件同级 .netlab-states」。
        self._project_dir: str | None = None
        self._temp_cache_root: str | None = None
        # 正在跑「每状态预计算」的网络 id（进度/取消要读它，而不是恒读当前网络）。
        self._precompute_net: str | None = None
        self._append(initial, name)

    # ---- 内部 ---------------------------------------------------------------
    def _append(self, simulation: Simulation, name: str) -> str:
        network_id = uuid.uuid4().hex[:12]
        self._entries[network_id] = simulation
        self._names[network_id] = str(name or f"网络 {len(self._order) + 1}")[:60]
        self._order.append(network_id)
        self._states.setdefault(network_id, [])
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
        current = self.__dict__.get("_entries", {}).get(
            self.__dict__.get("_current", "")
        )
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

    # ---- 工作台：网络状态（W1） --------------------------------------------
    # 每个状态是某条网络参数的一次快照：params=节点/连线参数深拷贝 + integration，
    # sim=该网络仿真设置快照（dt/fps/reltol…）。点击状态=把快照写回当前网络。
    STATE_CACHE_DIRNAME = ".netlab-states"

    @classmethod
    def _state_cache_key(cls, network_id: str, state_id: str) -> str:
        """缓存键形状：隐藏目录 + 网络/状态（前端展示用；物理路径由 _cache_path 决定）。"""
        return f"{cls.STATE_CACHE_DIRNAME}/{network_id}/{state_id}.npz"

    # ---- W2：每状态预计算缓存（.npz） --------------------------------------
    # 每个状态可单独跑一次预计算，把 0→T 的时间轴 + 各探针数组存 numpy .npz。
    # 落点：已保存工程→<工程文件同级>/.netlab-states/<net>/<state>.npz；
    #       未保存工程→进程临时目录，保存后由 set_project_dir 迁移。
    # 失效：load 时把 metadata.params_hash 与状态当前 params+sim 的稳定指纹比对，
    #       不符即删缓存重算；参数变化（update_state）、删除/改名/复制状态也会级联处理。
    def _cache_root(self) -> Path:
        if self._project_dir:
            return Path(self._project_dir) / self.STATE_CACHE_DIRNAME
        if not self._temp_cache_root:
            self._temp_cache_root = tempfile.mkdtemp(prefix="netlab-states-")
        return Path(self._temp_cache_root)

    def _cache_path(self, network_id: str, state_id: str) -> Path:
        return self._cache_root() / str(network_id) / f"{state_id}.npz"

    @staticmethod
    def _params_hash(params: dict[str, Any], sim: dict[str, Any]) -> str:
        """参数快照 + 仿真设置的稳定指纹：任一变化，旧缓存即失效。"""
        canonical = json.dumps(
            {"params": params, "sim": sim},
            sort_keys=True,
            ensure_ascii=False,
            default=str,
        )
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    def set_project_dir(self, path: str | None) -> dict[str, Any]:
        """登记当前工程所在目录（决定缓存落点）；临时→正式时迁移已算好的缓存。"""
        migrated = 0
        previous = self._project_dir
        target_dir: str | None = None
        raw = str(path or "").strip()
        if raw:
            candidate = Path(raw)
            directory = candidate if candidate.is_dir() else candidate.parent
            try:
                directory = directory.resolve()
            except OSError:
                pass
            target_dir = str(directory)
        self._project_dir = target_dir
        if target_dir and self._temp_cache_root:
            source_root = Path(self._temp_cache_root)
            destination_root = Path(target_dir) / self.STATE_CACHE_DIRNAME
            if source_root.is_dir():
                for npz in sorted(source_root.glob("*/*.npz")):
                    relative = npz.relative_to(source_root)
                    destination = destination_root / relative
                    try:
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        if destination.exists():
                            destination.unlink()
                        os.replace(str(npz), str(destination))
                        migrated += 1
                    except OSError:
                        continue
                for shard in sorted(source_root.glob("*"), reverse=True):
                    try:
                        shard.rmdir()
                    except OSError:
                        pass
                try:
                    source_root.rmdir()
                except OSError:
                    pass
                self._temp_cache_root = None
        return {
            "ok": True,
            "project_dir": self._project_dir,
            "cache_root": str(self._cache_root()),
            "temporary": not bool(self._project_dir),
            "migrated": migrated,
            "previous": previous,
        }

    def _invalidate_state_cache(self, network_id: str, state_id: str) -> None:
        path = self._cache_path(network_id, state_id)
        try:
            if path.is_file():
                path.unlink()
            parent = path.parent
            if parent.is_dir() and not any(parent.iterdir()):
                parent.rmdir()
        except OSError:
            pass

    def _drop_network_cache(self, network_id: str) -> None:
        directory = self._cache_root() / str(network_id)
        try:
            if directory.is_dir():
                for item in directory.glob("*.npz"):
                    try:
                        item.unlink()
                    except OSError:
                        pass
                if not any(directory.iterdir()):
                    directory.rmdir()
        except OSError:
            pass

    def _write_state_cache(
        self, network_id: str, state: dict[str, Any], result: dict[str, Any]
    ) -> dict[str, Any]:
        import numpy as np

        if not int(result.get("frames") or 0):
            raise ValidationError("预计算没有产生任何帧，无法写入缓存")
        simulation = self._entry(network_id)
        with simulation.lock:
            frame_list = list(simulation.recorder.frames)
            probe_names = [str(key) for key in simulation.recorder.keys()]
        times = np.asarray(
            [float(frame.get("t") or 0.0) for frame in frame_list], dtype="float64"
        )
        matrix = np.empty((len(frame_list), len(probe_names)), dtype="float64")
        for row, frame in enumerate(frame_list):
            values = frame.get("v") or {}
            for col, key in enumerate(probe_names):
                try:
                    matrix[row, col] = float(values.get(key, float("nan")))
                except (TypeError, ValueError):
                    matrix[row, col] = float("nan")
        params = copy.deepcopy(state.get("params") or {})
        sim_payload = copy.deepcopy(state.get("sim") or {})
        meta = {
            "schema": "netlab-state-cache/1",
            "network_id": network_id,
            "state_id": state.get("id"),
            "state_name": state.get("name"),
            "params_hash": self._params_hash(params, sim_payload),
            "created": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "frames": len(frame_list),
            "duration": round(float(result.get("last_time") or 0.0), 9),
            "dt": result.get("dt"),
            "sample_every": result.get("sample_every"),
            "probe_names": probe_names,
        }
        path = self._cache_path(network_id, str(state.get("id")))
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".tmp")
        with open(tmp, "wb") as handle:
            np.savez_compressed(
                handle,
                t=times,
                signals=matrix,
                probe_names=np.asarray(probe_names, dtype="U"),
                meta=np.asarray(json.dumps(meta, ensure_ascii=False)),
            )
        os.replace(str(tmp), str(path))
        return {
            "cache_key": self._state_cache_key(network_id, str(state.get("id"))),
            "path": str(path),
            "meta": meta,
        }

    def _read_state_cache(
        self, network_id: str, state: dict[str, Any]
    ) -> dict[str, Any]:
        import numpy as np

        state_id = str(state.get("id"))
        path = self._cache_path(network_id, state_id)
        if not path.is_file():
            return {
                "ok": False,
                "missing": True,
                "state_id": state_id,
                "reason": "尚未预计算",
            }
        try:
            with np.load(path, allow_pickle=False) as data:
                meta = json.loads(str(data["meta"].item()))
                matrix = np.asarray(data["signals"], dtype="float64")
                times = np.asarray(data["t"], dtype="float64")
                probe_names = [str(name) for name in data["probe_names"].tolist()]
        except Exception as exc:  # 损坏 / 版本不符 → 删掉重算
            self._invalidate_state_cache(network_id, state_id)
            return {
                "ok": False,
                "stale": True,
                "state_id": state_id,
                "reason": f"缓存读取失败：{exc}",
            }
        expected = self._params_hash(
            copy.deepcopy(state.get("params") or {}),
            copy.deepcopy(state.get("sim") or {}),
        )
        if meta.get("params_hash") != expected:
            self._invalidate_state_cache(network_id, state_id)
            return {
                "ok": False,
                "stale": True,
                "state_id": state_id,
                "reason": "参数/仿真设置已变化，缓存失效",
            }
        return {
            "ok": True,
            "state_id": state_id,
            "times": times,
            "matrix": matrix,
            "probe_names": probe_names,
            "meta": meta,
        }

    def _update_state_cache_meta(
        self, network_id: str, state_id: str, *, name: str
    ) -> None:
        import numpy as np

        path = self._cache_path(network_id, state_id)
        if not path.is_file():
            return
        try:
            with np.load(path, allow_pickle=False) as data:
                meta = json.loads(str(data["meta"].item()))
                times = np.asarray(data["t"])
                matrix = np.asarray(data["signals"])
                probe_names = np.asarray(data["probe_names"])
            meta["state_name"] = name
            tmp = path.with_name(path.name + ".tmp")
            with open(tmp, "wb") as handle:
                np.savez_compressed(
                    handle,
                    t=times,
                    signals=matrix,
                    probe_names=probe_names,
                    meta=np.asarray(json.dumps(meta, ensure_ascii=False)),
                )
            os.replace(str(tmp), str(path))
        except Exception:
            # 元数据改写失败不影响主流程：下次 load 仍按 params_hash 判定。
            pass

    def state_cache_status(self, network_id: str | None = None) -> dict[str, Any]:
        """列出每个状态的缓存状态（是否已算、帧数、创建时间、是否失效）。"""
        target = network_id or self._current
        self._entry(target)
        with self.lock:
            states = copy.deepcopy(self._ensure_default_state(target))
        rows: list[dict[str, Any]] = []
        for state in states:
            row: dict[str, Any] = {
                "state_id": state.get("id"),
                "name": state.get("name"),
            }
            path = self._cache_path(target, str(state.get("id")))
            if not path.is_file():
                row["cached"] = False
            else:
                cache = self._read_state_cache(target, state)
                if cache.get("ok"):
                    meta = cache["meta"]
                    row.update(
                        {
                            "cached": True,
                            "frames": meta.get("frames"),
                            "created": meta.get("created"),
                            "duration": meta.get("duration"),
                            "probes": cache["probe_names"],
                            "params_hash": meta.get("params_hash"),
                        }
                    )
                else:
                    row.update(
                        {
                            "cached": False,
                            "invalid": True,
                            "reason": cache.get("reason"),
                        }
                    )
            rows.append(row)
        return {
            "network": target,
            "cache_root": str(self._cache_root()),
            "temporary": not bool(self._project_dir),
            "states": rows,
        }

    def precompute_state(
        self,
        state_id: str,
        *,
        network_id: str | None = None,
        seconds: float = 5.0,
        dt: float | None = None,
        sample_every: int | None = None,
    ) -> dict[str, Any]:
        """对某状态 apply_state 后走与正常预计算相同的 Simulation/Recorder 路径，
        把结果写入该状态的 .npz 缓存。"""
        self._require_writable()
        target = network_id or self._current
        simulation = self._entry(target)
        try:
            duration = float(seconds)
        except (TypeError, ValueError):
            duration = 5.0
        if duration <= 0:
            duration = 5.0
        # 与 server.precompute_step_dt 同一口径：尊重请求 dt，超步数上限才降级。
        requested_dt = float(dt) if dt else float(simulation.config.dt)
        max_steps = 200_000
        step_dt = requested_dt
        degraded = False
        if requested_dt > 0 and duration / requested_dt > max_steps:
            step_dt = duration / max_steps
            degraded = True
        # 预计算只是取快照，不该改变用户当前视图：先记下当前节点/连线参数，
        # 算完再把它们写回去（apply_state 会修改实时场景）。
        before_params, before_sim = self._snapshot_params(simulation)
        self.apply_state(state_id, network_id=target)
        with self.lock:
            states = self._states_for(target)
            state = copy.deepcopy(self._find_state(states, state_id))
        self._precompute_net = target
        try:
            result = simulation.precompute(
                duration, dt=step_dt, sample_every=sample_every
            )
        finally:
            self._precompute_net = None
            try:
                self._restore_params(simulation, before_params, before_sim)
            except Exception:
                pass
        if result.get("cancelled"):
            return {
                "ok": False,
                "cancelled": True,
                "state_id": state_id,
                "frames": result.get("frames"),
                "degraded": degraded,
            }
        if result.get("error"):
            return {
                "ok": False,
                "state_id": state_id,
                "error": result.get("error"),
                "degraded": degraded,
            }
        try:
            written = self._write_state_cache(target, state, result)
        except Exception as exc:
            return {
                "ok": False,
                "state_id": state_id,
                "error": f"写缓存失败：{exc}",
                "degraded": degraded,
            }
        return {
            "ok": True,
            "state_id": state_id,
            "state_name": state.get("name"),
            "network": target,
            "cache_key": written["cache_key"],
            "cache_root": str(self._cache_root()),
            "temporary": not bool(self._project_dir),
            "frames": result.get("frames"),
            "duration": result.get("last_time"),
            "dt": result.get("dt"),
            "degraded": degraded,
            "probes": written["meta"].get("probe_names"),
            "created": written["meta"].get("created"),
        }

    def load_state_cache(
        self, state_id: str, *, network_id: str | None = None
    ) -> dict[str, Any]:
        """按需 lazy 读取某状态的缓存，返回 JSON 友好的时间轴 + 探针序列。"""
        target = network_id or self._current
        self._entry(target)
        with self.lock:
            states = self._states_for(target)
            state = copy.deepcopy(self._find_state(states, state_id))
        cache = self._read_state_cache(target, state)
        if not cache.get("ok"):
            payload: dict[str, Any] = {
                "ok": False,
                "state_id": state_id,
                "network": target,
            }
            for key in ("missing", "stale", "reason"):
                if key in cache:
                    payload[key] = cache[key]
            return payload
        return {
            "ok": True,
            "state_id": state_id,
            "network": target,
            "times": cache["times"].tolist(),
            "probe_names": cache["probe_names"],
            "series": {
                name: cache["matrix"][:, index].tolist()
                for index, name in enumerate(cache["probe_names"])
            },
            "meta": cache["meta"],
        }

    def compare_states(
        self,
        state_ids: list[str],
        signals: list[str] | None = None,
        *,
        network_id: str | None = None,
        max_points: int = 2000,
    ) -> dict[str, Any]:
        """读取多个状态的缓存，返回共享信号组下的多子图数据（供前端 canvas 渲染）。"""
        target = network_id or self._current
        self._entry(target)
        if not state_ids or len(state_ids) < 2:
            raise ValidationError("对比分析至少需要选择两个状态")
        with self.lock:
            states = copy.deepcopy(self._states_for(target))
        wanted = [str(item) for item in (signals or [])]
        entries: list[dict[str, Any]] = []
        available: list[str] = []
        for state_id in state_ids:
            try:
                state = self._find_state(states, str(state_id))
            except NotFoundError:
                entries.append(
                    {
                        "state_id": str(state_id),
                        "ok": False,
                        "missing": True,
                        "reason": "状态不存在",
                    }
                )
                continue
            cache = self._read_state_cache(target, state)
            if not cache.get("ok"):
                entries.append(
                    {
                        "state_id": str(state_id),
                        "name": state.get("name"),
                        "ok": False,
                        "missing": cache.get("missing"),
                        "stale": cache.get("stale"),
                        "reason": cache.get("reason"),
                    }
                )
                continue
            keys = [key for key in (wanted or cache["probe_names"]) if key in cache["probe_names"]]
            for key in keys:
                if key not in available:
                    available.append(key)
            times = cache["times"]
            matrix = cache["matrix"]
            index = {name: pos for pos, name in enumerate(cache["probe_names"])}
            stride = max(1, -(-len(times) // max_points)) if len(times) > max_points else 1
            entries.append(
                {
                    "state_id": str(state_id),
                    "name": state.get("name"),
                    "ok": True,
                    "t": times[::stride].tolist(),
                    "series": {
                        key: matrix[::stride, index[key]].tolist() for key in keys
                    },
                    "probe_names": cache["probe_names"],
                    "meta": {
                        "frames": cache["meta"].get("frames"),
                        "duration": cache["meta"].get("duration"),
                        "created": cache["meta"].get("created"),
                        "dt": cache["meta"].get("dt"),
                    },
                }
            )
        return {
            "ok": True,
            "network": target,
            "states": entries,
            "signals": available,
            "requested": wanted,
        }

    def unify_state_sim(
        self,
        *,
        network_id: str | None = None,
        source_state_id: str | None = None,
        sim: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """把某套仿真设置统一写进当前网络的每个状态（Q15=A：保证对比可比）。"""
        self._require_writable()
        target = network_id or self._current
        self._entry(target)
        with self.lock:
            states = self._states_for(target)
            if not states:
                raise ValidationError("当前网络还没有状态")
            if isinstance(sim, dict) and sim:
                payload = copy.deepcopy(sim)
            else:
                if source_state_id:
                    source = self._find_state(states, source_state_id)
                else:
                    source = next(
                        (item for item in states if item.get("base")), states[0]
                    )
                payload = copy.deepcopy(source.get("sim") or {})
            for item in states:
                item["sim"] = copy.deepcopy(payload)
            result = self._state_payload(target, states)
            ids = [str(item.get("id")) for item in states]
        for state_id in ids:
            self._invalidate_state_cache(target, state_id)
        result["unified"] = True
        result["sim"] = payload
        return result

    def active_precompute_progress(self) -> dict[str, Any]:
        """预计算进度：优先读正在跑「每状态预计算」的那条网络。"""
        target = self._precompute_net
        if target:
            entry = self._entries.get(target)
            if entry is not None:
                return entry.precompute_progress()
        return self.current.precompute_progress()

    def cancel_precompute(self) -> None:
        """取消预计算（每状态预计算可能跑在非当前网络）。"""
        target = self._precompute_net or self._current
        entry = self._entries.get(target)
        if entry is not None:
            entry.cancel_precompute()
        else:
            self.current.cancel_precompute()

    def _states_for(self, network_id: str) -> list[dict[str, Any]]:
        states = self._states.get(network_id)
        if states is None:
            states = []
            self._states[network_id] = states
        return states

    def _snapshot_params(
        self, simulation: Simulation
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """返回 (params, sim)：params 是节点/连线参数与 integration 的深拷贝。"""
        with simulation.lock:
            scene = simulation.scene
            nodes = {
                node_id: copy.deepcopy(record.params)
                for node_id, record in scene.nodes.items()
            }
            edges = {
                edge_id: copy.deepcopy(record.params)
                for edge_id, record in scene.edges.items()
            }
            integration = getattr(scene, "integration", None)
            sim_payload = asdict(simulation.config)
        return (
            {"nodes": nodes, "edges": edges, "integration": integration},
            sim_payload,
        )

    def _restore_params(
        self,
        simulation: Simulation,
        params: dict[str, Any],
        sim_payload: dict[str, Any],
    ) -> None:
        """把 _snapshot_params 抓到的节点/连线参数写回场景（预计算后复原用）。"""
        nodes = params.get("nodes") if isinstance(params.get("nodes"), dict) else {}
        edges = params.get("edges") if isinstance(params.get("edges"), dict) else {}
        integration = params.get("integration")

        def _writeback(scene: Scene) -> None:
            for node_id, values in nodes.items():
                if node_id in scene.nodes and isinstance(values, dict):
                    try:
                        scene.update_node(node_id, {"params": values})
                    except ValidationError:
                        continue
            for edge_id, values in edges.items():
                if edge_id in scene.edges and isinstance(values, dict):
                    try:
                        scene.update_edge(edge_id, {"params": values})
                    except ValidationError:
                        continue
            if isinstance(integration, str) and integration:
                try:
                    scene.set_integration(integration)
                except ValidationError:
                    pass

        simulation.mutate(_writeback)
        if sim_payload:
            simulation.apply_config(sim_payload)

    @staticmethod
    def _find_state(states: list[dict[str, Any]], state_id: str) -> dict[str, Any]:
        for state in states:
            if state.get("id") == state_id:
                return state
        raise NotFoundError(f"状态 {state_id!r} 不存在")

    @staticmethod
    def _unique_state_name(states: list[dict[str, Any]], base: str) -> str:
        existing = {str(item.get("name")) for item in states}
        name = (str(base or "").strip() or "状态")[:60]
        if name not in existing:
            return name
        suffix = 2
        while f"{name} {suffix}"[:60] in existing:
            suffix += 1
        return f"{name} {suffix}"[:60]

    def _state_payload(
        self, network_id: str, states: list[dict[str, Any]]
    ) -> dict[str, Any]:
        base = next((s["id"] for s in states if s.get("base")), None)
        if base is None and states:
            states[0]["base"] = True
            base = states[0]["id"]
        return {
            "network": network_id,
            "current": self._current,
            "states": copy.deepcopy(states),
            "base": base,
        }

    def _ensure_default_state(self, network_id: str) -> list[dict[str, Any]]:
        """状态列表为空时，按当前网络参数自动建立一个基准状态（首个为默认）。"""
        states = self._states_for(network_id)
        if states:
            return states
        params, sim_payload = self._snapshot_params(self._entry(network_id))
        states.append(
            {
                "id": uuid.uuid4().hex[:12],
                "name": "默认",
                "params": params,
                "sim": sim_payload,
                "base": True,
                "created": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            }
        )
        return states

    def list_states(self, network_id: str | None = None) -> dict[str, Any]:
        target = network_id or self._current
        self._entry(target)
        with self.lock:
            states = self._ensure_default_state(target)
            return self._state_payload(target, states)

    def create_state(
        self,
        name: str | None = None,
        *,
        base: bool = False,
        network_id: str | None = None,
    ) -> dict[str, Any]:
        self._require_writable()
        target = network_id or self._current
        params, sim_payload = self._snapshot_params(self._entry(target))
        with self.lock:
            states = self._states_for(target)
            make_base = bool(base) or not states
            if make_base:
                for item in states:
                    item["base"] = False
            states.append(
                {
                    "id": uuid.uuid4().hex[:12],
                    "name": self._unique_state_name(states, name or "状态"),
                    "params": params,
                    "sim": sim_payload,
                    "base": make_base,
                    "created": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                }
            )
            return self._state_payload(target, states)

    def duplicate_state(
        self,
        state_id: str,
        name: str | None = None,
        *,
        network_id: str | None = None,
    ) -> dict[str, Any]:
        self._require_writable()
        target = network_id or self._current
        self._entry(target)
        with self.lock:
            states = self._states_for(target)
            source = self._find_state(states, state_id)
            clone = copy.deepcopy(source)
            clone["id"] = uuid.uuid4().hex[:12]
            clone["name"] = self._unique_state_name(states, name or f"{source['name']} 副本")
            clone["base"] = False
            clone["created"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
            states.append(clone)
            return self._state_payload(target, states)

    def rename_state(
        self,
        state_id: str,
        name: str,
        *,
        network_id: str | None = None,
    ) -> dict[str, Any]:
        self._require_writable()
        target = network_id or self._current
        self._entry(target)
        clean = str(name or "").strip()
        if not clean:
            raise ValidationError("状态名称不能为空")
        clean = clean[:60]
        with self.lock:
            states = self._states_for(target)
            state = self._find_state(states, state_id)
            for item in states:
                if item.get("id") != state_id and item.get("name") == clean:
                    raise ValidationError(f"状态名称已存在：{clean!r}")
            state["name"] = clean
            payload = self._state_payload(target, states)
        # 改名不改 id：缓存依旧有效，只刷新 meta 里的 state_name。
        self._update_state_cache_meta(target, state_id, name=clean)
        return payload

    def delete_state(
        self, state_id: str, *, network_id: str | None = None
    ) -> dict[str, Any]:
        self._require_writable()
        target = network_id or self._current
        self._entry(target)
        with self.lock:
            states = self._states_for(target)
            state = self._find_state(states, state_id)
            states.remove(state)
            if state.get("base") and states:
                states[0]["base"] = True
            payload = self._state_payload(target, states)
            payload["removed"] = state_id
            payload["cache_key"] = self._state_cache_key(target, state_id)
        # 删除状态 → 级联删掉它的 .npz 缓存。
        self._invalidate_state_cache(target, state_id)
        return payload

    def set_base_state(
        self, state_id: str, *, network_id: str | None = None
    ) -> dict[str, Any]:
        self._require_writable()
        target = network_id or self._current
        self._entry(target)
        with self.lock:
            states = self._states_for(target)
            self._find_state(states, state_id)
            for item in states:
                item["base"] = item.get("id") == state_id
            return self._state_payload(target, states)

    def update_state(
        self, state_id: str, *, network_id: str | None = None
    ) -> dict[str, Any]:
        """把当前网络参数覆盖写回指定状态（「更新到此状态」）。"""
        self._require_writable()
        target = network_id or self._current
        params, sim_payload = self._snapshot_params(self._entry(target))
        with self.lock:
            states = self._states_for(target)
            state = self._find_state(states, state_id)
            state["params"] = params
            state["sim"] = sim_payload
            payload = self._state_payload(target, states)
        # 参数已变 → 旧缓存失效（即使 hash 比对也能发现，这里显式删更干净）。
        self._invalidate_state_cache(target, state_id)
        return payload

    def apply_state(
        self, state_id: str, *, network_id: str | None = None
    ) -> dict[str, Any]:
        """把某状态的参数写回当前网络（切换状态），返回新的 snapshot。"""
        self._require_writable()
        target = network_id or self._current
        simulation = self._entry(target)
        with self.lock:
            states = self._states_for(target)
            state = self._find_state(states, state_id)
            params = copy.deepcopy(state.get("params") or {})
            sim_payload = copy.deepcopy(state.get("sim") or {})
        nodes = params.get("nodes") if isinstance(params.get("nodes"), dict) else {}
        edges = params.get("edges") if isinstance(params.get("edges"), dict) else {}
        integration = params.get("integration")

        def _writeback(scene: Scene) -> None:
            for node_id, values in nodes.items():
                if node_id in scene.nodes and isinstance(values, dict):
                    try:
                        scene.update_node(node_id, {"params": values})
                    except ValidationError:
                        continue
            for edge_id, values in edges.items():
                if edge_id in scene.edges and isinstance(values, dict):
                    try:
                        scene.update_edge(edge_id, {"params": values})
                    except ValidationError:
                        continue
            if isinstance(integration, str) and integration:
                try:
                    scene.set_integration(integration)
                except ValidationError:
                    pass

        simulation.mutate(_writeback)
        if sim_payload:
            simulation.apply_config(sim_payload)
        snapshot = simulation.snapshot()
        snapshot["state"] = state_id
        return snapshot

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
    def add_network(self, name: str | None = None, mode: str | None = None) -> dict[str, Any]:
        self._require_writable()
        # 每条网络独立保存自己的工作模式；未指定时沿用当前网络的模式（向后兼容）。
        chosen = str(mode).strip() if mode is not None else self.current.scene.mode
        if chosen not in MODES:
            raise ValidationError(f"未知的工作模式：{chosen!r}")
        template = build_template(
            {
                "signal": "blank_signal",
                "circuit": "blank_circuit",
                "vector": "blank_vector",
            }[chosen]
        )
        simulation = Simulation(Scene(chosen))
        try:
            simulation.load_scene(template)
        except Exception:
            simulation.shutdown()
            raise
        with self.lock:
            label = str(name or f"网络 {len(self._order) + 1}")[:60]
            network_id = self._append(simulation, label)
        return {"id": network_id, "name": label, "mode": chosen, "networks": self.list_networks()}

    def set_network_mode(self, network_id: str, mode: str) -> dict[str, Any]:
        """设置某条网络的工作模式（用该模式的空白模板重建其场景）。

        只影响传入的那条网络：当前网络会顺带重建并保持线程可用，其它网络保持冻结。
        """
        self._require_writable()
        clean = str(mode or "").strip()
        if clean not in MODES:
            raise ValidationError(f"未知的工作模式：{clean!r}")
        target = self._entry(network_id)
        if target.scene.mode == clean:
            return {"id": network_id, "mode": clean, "networks": self.list_networks()}
        template = build_template(
            {
                "signal": "blank_signal",
                "circuit": "blank_circuit",
                "vector": "blank_vector",
            }[clean]
        )
        replacement = Simulation(Scene(clean))
        try:
            replacement.load_scene(template)
        except Exception:
            replacement.shutdown()
            raise
        with self.lock:
            previous = self._entries.get(network_id)
            self._entries[network_id] = replacement
            was_current = network_id == self._current
        if previous is not None and previous is not replacement:
            previous.pause()
            previous.shutdown()
        if was_current:
            replacement.ensure_thread()
        return {"id": network_id, "mode": clean, "networks": self.list_networks()}

    def rename_network(self, network_id: str, name: str) -> dict[str, Any]:
        self._require_writable()
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
        self._require_writable()
        simulation = self._entry(network_id)
        with self.lock:
            if len(self._order) <= 1:
                raise ValidationError("工程至少需要保留一个网络")
            self._order.remove(network_id)
            self._entries.pop(network_id, None)
            self._names.pop(network_id, None)
            self._states.pop(network_id, None)
            was_current = network_id == self._current
            if was_current:
                self._current = self._order[0]
        # 删除网络 → 级联清掉它的整目录状态缓存。
        self._drop_network_cache(network_id)
        simulation.pause()
        simulation.shutdown()
        if was_current:
            self.current.ensure_thread()
        return {
            "removed": network_id,
            "current": self._current,
            "networks": self.list_networks(),
        }

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
        plugins: list[dict[str, Any]] | None = None,
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
                        "states": copy.deepcopy(self._states.get(network_id, [])),
                    }
                )
        return build_project_from_networks(
            networks,
            current=self._current,
            fem=fem,
            name=name,
            ui=ui if ui is not None else self.ui,
            blocks=list(blocks_by_id.values()),
            extensions=extensions,
            plugins=plugins if plugins is not None else self.plugins,
            created=created,
            metadata=metadata,
            library=library,
        )

    def set_degraded(self, info: dict[str, Any] | None) -> None:
        self.degraded = info or None

    def _require_writable(self) -> None:
        """D7：降级只读期间禁止任何结构/参数修改。"""
        if self.degraded:
            raise ConflictError(
                "工程处于降级只读模式：请先补回缺失的库文件，或确认用占位块替换后再编辑"
            )

    def mutate(self, function):
        self._require_writable()
        return self.current.mutate(function)

    def load_scene(self, payload):
        self._require_writable()
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
        states_by_id: dict[str, list[dict[str, Any]]] = {}
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
                raw_states = item.get("states")
                states_by_id[network_id] = (
                    copy.deepcopy(raw_states) if isinstance(raw_states, list) else []
                )
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
            self._states = {}
            for network_id, name, simulation in created:
                self._entries[network_id] = simulation
                self._names[network_id] = name
                self._order.append(network_id)
                self._states[network_id] = states_by_id.get(network_id, [])
            self._current = str(project.get("current") or "")
            if self._current not in self._entries:
                self._current = self._order[0]
        for simulation in old:
            simulation.shutdown()
        self.current.ensure_thread()
        self.degraded = project.get("degraded") or None
        self.ui = copy.deepcopy(project.get("ui") or {})
        self.plugins = copy.deepcopy(project.get("plugins") or [])
        return {
            "current": self._current,
            "networks": self.list_networks(),
            "degraded": self.degraded,
        }


__all__ = ["NetworkContainer"]
