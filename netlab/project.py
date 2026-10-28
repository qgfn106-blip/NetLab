"""工程文件（``.netlab``）的构建、校验、迁移与原子保存。

工程文件只保存**可重建的配置与拓扑**：场景记录（不含运行时 state）、仿真节奏、
FEM 配置、界面偏好、模块定义和受信任的扩展代码。录制帧、引擎缓存、锁、
线程、运行时间等运行时数据一律不写入文件。

所有写入都经过“同目录临时文件 → fsync → 备份旧文件 → os.replace”，
因此进程中断不会留下半截工程文件。
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import shutil
import tempfile
import time
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Any

from .limits import LimitError, NetlabError, ValidationError, json_safe
from .scene import MODES, Scene
from .simulation import Simulation, SimConfig

PROJECT_FORMAT = "netlab-project"
PROJECT_VERSION = 5
APP_VERSION = "2.1.0"
MAX_PROJECT_BYTES = 8_000_000
PROJECT_SUFFIX = ".netlab"


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


def _canonical_numbers(value: Any) -> Any:
    """把"整数值的浮点数"归一成整数，供校验和比较使用。

    JSON 在 JavaScript 里只有一种 number：``-430.0`` 经过浏览器
    ``JSON.parse`` / ``JSON.stringify`` 会变成 ``-430``。若校验和直接按
    Python 的 float 写出 ``-430.0``，工程在浏览器里走一圈就会被判成
    "被修改"。这里统一成整数表示，保证跨语言往返后校验和仍然一致。
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, float):
        if value.is_integer() and abs(value) < 2**53:
            return int(value)
        return value
    if isinstance(value, dict):
        return {key: _canonical_numbers(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_canonical_numbers(item) for item in value]
    return value


def canonical_json(payload: Any) -> str:
    return json.dumps(
        _canonical_numbers(payload),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def _legacy_canonical_json(payload: Any) -> str:
    """V1 早期版本的规范化方式，仅用于兼容已有工程文件。"""
    return json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def compute_checksum(payload: dict[str, Any]) -> str:
    body = {key: value for key, value in payload.items() if key != "checksum"}
    return hashlib.sha256(canonical_json(body).encode("utf-8")).hexdigest()


def _legacy_checksum(payload: dict[str, Any]) -> str:
    body = {key: value for key, value in payload.items() if key != "checksum"}
    return hashlib.sha256(_legacy_canonical_json(body).encode("utf-8")).hexdigest()


def verify_checksum(payload: dict[str, Any]) -> bool:
    checksum = payload.get("checksum")
    if not checksum:
        return True
    if not isinstance(checksum, str):
        return False
    return checksum in (compute_checksum(payload), _legacy_checksum(payload))


def _network_id() -> str:
    return uuid.uuid4().hex[:12]


def make_network(name: str, scene_payload: Any, sim_payload: Any) -> dict[str, Any]:
    """构造一条网络记录（R07/D18）；工程至少有一个网络。"""
    return {
        "id": _network_id(),
        "name": str(name or "网络 1")[:60],
        "scene": copy.deepcopy(
            scene_payload or {"mode": "signal", "nodes": [], "edges": []}
        ),
        "sim": copy.deepcopy(sim_payload or {}),
    }


def build_project(
    simulation: Simulation,
    fem: Any | None = None,
    *,
    name: str | None = None,
    ui: dict[str, Any] | None = None,
    blocks: list[dict[str, Any]] | None = None,
    extensions: list[dict[str, Any]] | None = None,
    created: str | None = None,
    metadata: dict[str, Any] | None = None,
    network_name: str = "网络 1",
    library: str | None = None,
) -> dict[str, Any]:
    """从当前运行状态生成单网络工程（v2，兼容旧调用方）。"""
    with simulation.lock:
        scene_payload = simulation.scene.to_payload(include_state=False)
        # 功能块定义只在工程顶层保存一份，避免场景与 blocks 两份数据分叉。
        scene_blocks = scene_payload.pop("blocks", []) or []
        if not blocks:
            blocks = scene_blocks
        sim_payload = asdict(simulation.config)
    network = make_network(network_name, scene_payload, sim_payload)
    return build_project_from_networks(
        [network],
        current=network["id"],
        fem=fem,
        name=name,
        ui=ui,
        blocks=blocks,
        extensions=extensions,
        created=created,
        metadata=metadata,
        library=library,
    )


def build_project_from_networks(
    networks: list[dict[str, Any]],
    *,
    current: str,
    fem: Any | None = None,
    name: str | None = None,
    ui: dict[str, Any] | None = None,
    blocks: list[dict[str, Any]] | None = None,
    extensions: list[dict[str, Any]] | None = None,
    created: str | None = None,
    metadata: dict[str, Any] | None = None,
    library: str | None = None,
) -> dict[str, Any]:
    """把多条网络（R07）打包成工程；blocks/ui/fem/extensions 仍只存顶一份。

    ``library`` 非空时 blocks 以「引用式」保存（只记 id + version，D4）；
    旧调用方不传 library 时仍保存完整 payload（兼容期）。
    """
    cloned = copy.deepcopy(list(networks))
    if not cloned:
        raise ValidationError("工程至少需要一个网络")
    ids = [str(item.get("id") or "") for item in cloned]
    if not all(ids) or len(set(ids)) != len(ids):
        raise ValidationError("网络 id 必须非空且唯一")
    if current not in ids:
        current = ids[0]
    fem_payload: dict[str, Any] = {}
    if fem is not None:
        with fem.lock:
            fem_payload = asdict(fem.config)
    project: dict[str, Any] = {
        "format": PROJECT_FORMAT,
        "version": PROJECT_VERSION,
        "app": f"netlab {APP_VERSION}",
        "name": str(name or "未命名工程")[:120],
        "created": created or _now(),
        "modified": _now(),
        "networks": cloned,
        "current": current,
        "fem": fem_payload,
        "ui": json_safe(ui or {}, where="界面设置"),
        "blocks": (
            [{"id": str(block.get("id") or ""), "version": int(block.get("version") or 1)}
             for block in (blocks or [])]
            if library is not None
            else copy.deepcopy(blocks or [])
        ),
        "extensions": copy.deepcopy(extensions or []),
        "metadata": json_safe(metadata or {}, where="工程元数据"),
    }
    project["checksum"] = compute_checksum(project)
    return project



def migrate_scene_to_devices(scene: Any) -> dict[str, Any]:
    """v3→v4（R20）：把电路元件边迁成「器件节点 + 引脚导线」。

    规则（D36/D40）：
    - 只处理电路模式；已含 device 节点或 wire 边的场景原样返回（幂等）。
    - 每条元件边 → 一个 ``kind="device"`` 节点 + 每条引脚一条 ``kind="wire"``
      导线（device 引脚 → 原网络节点）；位置取 edge.layout，旋转暂存 data.rotation。
    - 多引脚元件用 ``PIN_BINDINGS`` 反向把旧参数端口读成引脚；必接引脚缺失时
      保留旧边（兼容垫片，登记在 REQUIREMENTS §8.1），不生成半残器件。
    """
    from .nodal import LEGACY_PIN_BINDINGS
    from .ports import pins_for_device

    if not isinstance(scene, dict) or scene.get("mode") != "circuit":
        return copy.deepcopy(scene) if isinstance(scene, dict) else scene
    raw_nodes = scene.get("nodes")
    raw_edges = scene.get("edges")
    if not isinstance(raw_nodes, list) or not isinstance(raw_edges, list):
        return copy.deepcopy(scene)
    if any(isinstance(item, dict) and item.get("kind") == "device" for item in raw_nodes):
        return copy.deepcopy(scene)
    if any(isinstance(item, dict) and item.get("kind") == "wire" for item in raw_edges):
        return copy.deepcopy(scene)

    nodes = [copy.deepcopy(item) for item in raw_nodes]
    edges: list[dict[str, Any]] = []
    used_node_ids = {str(item.get("id") or "") for item in nodes}
    used_node_names = {str(item.get("name") or "") for item in nodes}
    used_edge_ids = {str(item.get("id") or "") for item in raw_edges}
    used_edge_names = {str(item.get("name") or "") for item in raw_edges}
    node_pos = {
        str(item.get("id") or ""): (item.get("position") or {})
        for item in nodes
    }

    def next_name(base: str, used: set[str]) -> str:
        base = base[:32]
        candidate = base
        index = 2
        while candidate in used:
            suffix = f"-{index}"
            candidate = base[: 32 - len(suffix)] + suffix
            index += 1
        used.add(candidate)
        return candidate

    def next_id(base: str, used: set[str]) -> str:
        candidate = base
        index = 0
        while candidate in used:
            index += 1
            candidate = (base[:32] + format(index, "x"))[:40]
        used.add(candidate)
        return candidate

    for edge in raw_edges:
        if not isinstance(edge, dict) or edge.get("kind") == "wire":
            edges.append(copy.deepcopy(edge))
            continue
        kind = str(edge.get("kind") or "")
        params = copy.deepcopy(edge.get("params") or {})
        try:
            table = list(pins_for_device(kind))
        except KeyError:
            edges.append(copy.deepcopy(edge))
            continue
        source = str(edge.get("source") or "")
        target = str(edge.get("target") or "")
        if source not in node_pos or target not in node_pos:
            edges.append(copy.deepcopy(edge))
            continue

        pins: dict[str, str] = {}
        bound_params: set[str] = set()
        if len(table) == 2:
            pins[table[0].name] = source
            pins[table[1].name] = target
        else:
            binding = LEGACY_PIN_BINDINGS.get(kind)
            if binding is None:
                edges.append(copy.deepcopy(edge))
                continue
            a_pin, b_pin, param_map = binding
            pins[a_pin] = source
            pins[b_pin] = target
            for pin_name, param_key in param_map.items():
                value = params.get(param_key)
                if isinstance(value, str) and value in node_pos:
                    pins[pin_name] = value
                    bound_params.add(param_key)
        required_missing = [
            pin.name
            for pin in table
            if pin.required and pin.name not in pins
        ]
        if required_missing:
            # 兼容垫片：旧数据缺必接端口时保留旧边，不制造半残器件。
            edges.append(copy.deepcopy(edge))
            continue

        edge_id = str(edge.get("id") or "")
        device_id = next_id(
            hashlib.sha1(f"device:{edge_id}".encode("utf-8")).hexdigest()[:12],
            used_node_ids,
        )
        device_name = next_name(
            str(edge.get("name") or kind), used_node_names
        )
        layout = edge.get("layout") or {}
        position = {
            "x": float(layout.get("x", 0.0) or 0.0),
            "y": float(layout.get("y", 0.0) or 0.0),
        }
        if not (layout.get("x") is not None and layout.get("y") is not None):
            sx = float(node_pos[source].get("x", 0.0))
            sy = float(node_pos[source].get("y", 0.0))
            tx = float(node_pos[target].get("x", 0.0))
            ty = float(node_pos[target].get("y", 0.0))
            position = {"x": (sx + tx) / 2.0, "y": (sy + ty) / 2.0}
        data = copy.deepcopy(edge.get("data") or {})
        if isinstance(layout.get("rot"), int):
            data.setdefault("rotation", int(layout["rot"]) % 360)
        device = {
            "id": device_id,
            "name": device_name,
            "kind": "device",
            "params": {"element": kind, **{k: v for k, v in params.items() if k not in bound_params}},
            "data": data,
            "state": copy.deepcopy(edge.get("state") or {}),
            "position": position,
            "size": {},
        }
        nodes.append(device)

        for pin in table:
            net_id = pins[pin.name]
            digest = hashlib.sha1(
                f"wire:{edge_id}:{pin.name}".encode("utf-8")
            ).hexdigest()[:12]
            wire_id = next_id(digest, used_edge_ids)
            wire_name = next_name(f"{edge.get('name') or kind}.{pin.name}", used_edge_names)
            edges.append(
                {
                    "id": wire_id,
                    "name": wire_name,
                    "source": device_id,
                    "target": net_id,
                    "kind": "wire",
                    "params": {},
                    "state": {},
                    "delay": False,
                    "enabled": bool(edge.get("enabled", True)),
                    "route": "auto",
                    "waypoints": [],
                    "anchors": {},
                    "layout": {},
                    "source_pin": pin.name,
                    "target_pin": "",
                }
            )

    migrated = copy.deepcopy(scene)
    migrated["nodes"] = nodes
    migrated["edges"] = edges
    return migrated


def migrate_scene_rails(
    scene: Any,
    report: list[dict[str, Any]] | None = None,
    *,
    network_name: str = "",
) -> dict[str, Any]:
    """v4→v5（R21/D41/D42）：把旧双端输出（OUT+/OUT−）改成单端（OUT + V±）。

    规则：
    - 仅处理电路场景中的 ``device``，且 ``element`` 为 opamp/comparator；
    - 导线引脚 ``OUT+`` → ``OUT``；``OUT-`` 的导线删除（不删其他器件）；
    - 参数补 ``vcc=+|vmax|``、``vee=-|vmax|``（已有则保留）；
    - 迁移结果写入 ``report``（``removed_net``/``net_is_ground``），供前端提示。
    - 幂等：已是新引脚或没有旧引脚时原样返回。
    """
    if report is None:
        report = []
    if not isinstance(scene, dict) or scene.get("mode") != "circuit":
        return copy.deepcopy(scene) if isinstance(scene, dict) else scene
    raw_nodes = scene.get("nodes")
    raw_edges = scene.get("edges")
    if not isinstance(raw_nodes, list) or not isinstance(raw_edges, list):
        return copy.deepcopy(scene)

    legacy_elements = {"opamp", "comparator"}
    device_nodes: dict[str, dict[str, Any]] = {}
    ground_ids: set[str] = set()
    names: dict[str, str] = {}
    for item in raw_nodes:
        if not isinstance(item, dict):
            continue
        node_id = str(item.get("id") or "")
        names[node_id] = str(item.get("name") or node_id)
        if item.get("kind") == "device":
            element = str((item.get("params") or {}).get("element") or "")
            if element in legacy_elements:
                device_nodes[node_id] = item
        elif item.get("kind") == "ground":
            ground_ids.add(node_id)
    if not device_nodes:
        return copy.deepcopy(scene)

    def touches(pin: str, side: str, edge: dict[str, Any], device_id: str) -> bool:
        if side == "source":
            return edge.get("source") == device_id and edge.get("source_pin") == pin
        return edge.get("target") == device_id and edge.get("target_pin") == pin

    old_pin_edges: list[tuple[dict[str, Any], dict[str, Any], str, str]] = []
    for edge in raw_edges:
        if not isinstance(edge, dict) or edge.get("kind") != "wire":
            continue
        for device_id in device_nodes:
            for pin in ("OUT+", "OUT-"):
                for side in ("source", "target"):
                    if touches(pin, side, edge, device_id):
                        old_pin_edges.append((edge, device_nodes[device_id], pin, side))
    if not old_pin_edges:
        return copy.deepcopy(scene)

    changed = copy.deepcopy(scene)
    dropped: set[str] = set()
    rewritten = 0
    for edge, device, pin, side in old_pin_edges:
        edge_id = str(edge.get("id") or "")
        if pin == "OUT+":
            for item in changed.get("edges") or []:
                if str(item.get("id") or "") != edge_id:
                    continue
                key = "source_pin" if side == "source" else "target_pin"
                item[key] = "OUT"
                rewritten += 1
                break
            continue
        dropped.add(edge_id)
        other_side = "target" if side == "source" else "source"
        net_id = str(edge.get(other_side) or "")
        report.append(
            {
                "network": network_name,
                "device": str(device.get("name") or ""),
                "removed_wire": str(edge.get("name") or edge_id),
                "removed_net": names.get(net_id, net_id),
                "net_is_ground": net_id in ground_ids,
            }
        )
    if dropped:
        changed["edges"] = [
            item
            for item in changed.get("edges") or []
            if str(item.get("id") or "") not in dropped
        ]

    for node_id, device in device_nodes.items():
        params = device.get("params") or {}
        raw_vmax = params.get("vmax")
        if isinstance(raw_vmax, (int, float)) and not isinstance(raw_vmax, bool):
            magnitude = abs(float(raw_vmax))
        else:
            magnitude = 15.0
        for item in changed.get("nodes") or []:
            if str(item.get("id") or "") != node_id:
                continue
            target_params = item.get("params")
            if not isinstance(target_params, dict):
                target_params = {}
            target_params.setdefault("vcc", magnitude)
            target_params.setdefault("vee", -magnitude)
            item["params"] = target_params
            break
    if not rewritten and not dropped:
        return copy.deepcopy(scene)
    return changed


def migrate_project(payload: dict[str, Any]) -> dict[str, Any]:
    """把旧格式升级到当前版本（v2：networks + current）。"""
    if not isinstance(payload, dict):
        raise ValidationError("工程文件必须是 JSON 对象")
    if payload.get("format") != PROJECT_FORMAT:
        if "nodes" in payload and "edges" in payload:
            # 兼容旧版“场景 JSON”：包装为单网络工程，不猜测界面设置。
            scene = copy.deepcopy(payload)
            sim = scene.pop("sim", {}) or {}
            network = make_network("网络 1", scene, sim)
            return {
                "format": PROJECT_FORMAT,
                "version": PROJECT_VERSION,
                "app": f"netlab {APP_VERSION}",
                "name": "导入的场景",
                "created": _now(),
                "modified": _now(),
                "networks": [network],
                "current": network["id"],
                "fem": {},
                "ui": {},
                "blocks": [],
                "extensions": [],
                "metadata": {"migrated_from": "scene-json"},
            }
        raise ValidationError("不是 Netlab 工程文件（缺少 format 字段）")
    version = payload.get("version", 0)
    if not isinstance(version, int) or version < 0:
        raise ValidationError("工程 version 必须是非负整数")
    if version > PROJECT_VERSION:
        raise ValidationError(
            f"工程版本 {version} 高于当前程序支持的 {PROJECT_VERSION}，请升级 Netlab"
        )
    migrated = copy.deepcopy(payload)
    if version < 1:
        migrated.setdefault("scene", {"mode": "signal", "nodes": [], "edges": []})
        migrated.setdefault("sim", {})
        migrated.setdefault("fem", {})
        migrated.setdefault("ui", {})
        migrated.setdefault("blocks", [])
        migrated.setdefault("extensions", [])
    if version < 2 or "networks" not in migrated:
        scene = migrated.pop("scene", {"mode": "signal", "nodes": [], "edges": []})
        sim = migrated.pop("sim", {}) or {}
        network = make_network("网络 1", scene, sim)
        migrated["networks"] = [network]
        migrated["current"] = network["id"]
        metadata = migrated.get("metadata")
        if not isinstance(metadata, dict):
            metadata = {}
        metadata.setdefault("migrated_from_networks", f"v{version}")
        migrated["metadata"] = metadata
    if version < 4:
        for network in migrated.get("networks") or []:
            if isinstance(network, dict) and isinstance(network.get("scene"), dict):
                network["scene"] = migrate_scene_to_devices(network["scene"])
        metadata = migrated.get("metadata")
        if not isinstance(metadata, dict):
            metadata = {}
        metadata.setdefault("migrated_devices", f"v{version}")
        migrated["metadata"] = metadata
    if version < 5:
        rails_report: list[dict[str, Any]] = []
        for network in migrated.get("networks") or []:
            if isinstance(network, dict) and isinstance(network.get("scene"), dict):
                network["scene"] = migrate_scene_rails(
                    network["scene"],
                    rails_report,
                    network_name=str(network.get("name") or ""),
                )
        metadata = migrated.get("metadata")
        if not isinstance(metadata, dict):
            metadata = {}
        metadata.setdefault("migrated_rails", f"v{version}")
        if rails_report:
            metadata["rails_migration"] = rails_report
        migrated["metadata"] = metadata
    migrated["version"] = PROJECT_VERSION
    migrated.setdefault("format", PROJECT_FORMAT)
    migrated.setdefault("app", f"netlab {APP_VERSION}")
    migrated.setdefault("name", "未命名工程")
    migrated.setdefault("created", _now())
    migrated.setdefault("modified", _now())
    migrated.setdefault("ui", {})
    migrated.setdefault("blocks", [])
    migrated.setdefault("extensions", [])
    migrated.setdefault("fem", {})

    networks = migrated.get("networks")
    if not isinstance(networks, list) or not networks:
        raise ValidationError("工程的 networks 必须是非空数组")
    seen: set[str] = set()
    for index, item in enumerate(networks):
        if not isinstance(item, dict):
            raise ValidationError(f"第 {index + 1} 个网络必须是对象")
        network_id = item.get("id")
        if not isinstance(network_id, str) or not network_id:
            network_id = _network_id()
            item["id"] = network_id
        if network_id in seen:
            raise ValidationError(f"网络 id 重复：{network_id}")
        seen.add(network_id)
        item.setdefault("name", f"网络 {index + 1}")
        if not isinstance(item.get("name"), str) or not item["name"].strip():
            item["name"] = f"网络 {index + 1}"
        if not isinstance(item.get("scene"), dict):
            raise ValidationError(f"网络 {item['name']!r} 的 scene 必须是对象")
        if not isinstance(item.get("sim"), dict):
            raise ValidationError(f"网络 {item['name']!r} 的 sim 必须是对象")
    current = migrated.get("current")
    if current not in seen:
        migrated["current"] = networks[0]["id"]
    return migrated


def _is_block_ref(item: Any) -> bool:
    return (
        isinstance(item, dict)
        and isinstance(item.get("id"), str)
        and isinstance(item.get("version"), int)
        and "nodes" not in item
    )


def project_block_refs(project: dict[str, Any]) -> list[dict[str, Any]]:
    """返回工程的块引用（完整 payload 会被折算成 id+version）。"""
    refs: list[dict[str, Any]] = []
    for item in project.get("blocks") or []:
        if _is_block_ref(item):
            refs.append({"id": item["id"], "version": int(item["version"])})
        else:
            refs.append({"id": str(item.get("id") or ""), "version": int(item.get("version") or 1)})
    return refs


def _scene_port_map(project: dict[str, Any]) -> dict[str, dict[str, list[str]]]:
    """从各网络场景里推导每个块的端口名（用于缺失时生成占位块）。"""
    result: dict[str, dict[str, set[str]]] = {}
    for network in project.get("networks") or []:
        scene = network.get("scene") or {}
        for node in scene.get("nodes") or []:
            if node.get("kind") != "block":
                continue
            params = node.get("params") or {}
            block_id = str(params.get("block_id") or "")
            if not block_id:
                continue
            ports = result.setdefault(block_id, {"inputs": set(), "outputs": set()})
            ports["inputs"].update((params.get("input_nodes") or {}).keys())
            ports["outputs"].update((params.get("output_nodes") or {}).keys())
    return {
        block_id: {
            "inputs": sorted(ports["inputs"]),
            "outputs": sorted(ports["outputs"]),
        }
        for block_id, ports in result.items()
    }


def validate_project(
    payload: dict[str, Any],
    library: str | None = None,
    *,
    allow_degraded: bool = False,
) -> dict[str, Any]:
    """完整校验工程（含每条网络）并返回迁移后的副本；不改运行中的服务。

    v3 工程里的 ``blocks`` 是引用（id+version）；给了 ``library`` 才会去库里解析，
    缺失/损坏时直接拒绝并列出清单（D6/D7 的「失败即停」，不做静默替换）。
    """
    if len(json.dumps(payload, ensure_ascii=False)) > MAX_PROJECT_BYTES:
        raise LimitError(f"工程文件不能超过 {MAX_PROJECT_BYTES // 1_000_000} MB")
    project = migrate_project(payload)
    if not verify_checksum(project):
        # 旧版本（v1 / 场景 JSON）的校验和是对迁移前内容算的：迁移后重算，
        # 只要能证明原件未被篡改，就接受并在内存里自洽，不静默丢校验。
        if verify_checksum(payload):
            project["checksum"] = compute_checksum(project)
        else:
            raise ValidationError("工程文件校验和不匹配，可能已损坏或被修改")
    raw_blocks = project.get("blocks") or []
    if not isinstance(raw_blocks, list):
        raise ValidationError("工程的 blocks 必须是数组")
    if any(_is_block_ref(item) for item in raw_blocks):
        from . import blocklib

        mode_for_placeholder = "signal"
        try:
            first_scene = (project.get("networks") or [{}])[0].get("scene") or {}
            mode_for_placeholder = str(first_scene.get("mode") or "signal")
        except Exception:
            mode_for_placeholder = "signal"
        if allow_degraded:
            resolved = blocklib.resolve_refs_degraded(
                library,
                raw_blocks,
                mode=mode_for_placeholder,
                port_map=_scene_port_map(project),
            )
            blocks = resolved["payloads"]
            if resolved["missing"]:
                project["degraded"] = {
                    "read_only": True,
                    "missing": resolved["missing"],
                    "message": "库文件缺失：已用占位块打开，替换或补回库文件前禁止运行",
                }
                # degraded 是内存态标记；重算校验和，保证同一对象再次校验能通过。
                project["checksum"] = compute_checksum(project)
        else:
            blocks = blocklib.resolve_refs(library, raw_blocks)
    else:
        blocks = raw_blocks
    from .blocks import BlockStore

    store = BlockStore()
    store.load_payloads(blocks)

    for index, network in enumerate(project["networks"]):
        label = network.get("name") or f"网络 {index + 1}"
        scene_payload = network.get("scene")
        if not isinstance(scene_payload, dict):
            raise ValidationError(f"网络 {label!r} 的 scene 必须是对象")
        mode = scene_payload.get("mode", "signal")
        if mode not in MODES:
            raise ValidationError(f"网络 {label!r} 的未知场景模式：{mode!r}")
        trial_scene_payload = copy.deepcopy(scene_payload)
        trial_scene_payload["blocks"] = blocks
        trial = Scene(mode)
        # 复用场景层的全部校验（节点/连接/参数/拓扑/接地/功能块引用）。
        trial.load_payload(trial_scene_payload)
        engine = trial.ensure_engine()
        incomplete = getattr(engine, "incomplete_devices", [])
        if incomplete:
            raise ValidationError(
                f"网络 {label!r} 的器件引脚未接齐：{'；'.join(incomplete)}"
            )
        canonical = trial.to_payload(include_state=False)
        canonical.pop("blocks", None)
        network["scene"] = canonical

        sim_payload = network.get("sim") or {}
        if not isinstance(sim_payload, dict):
            raise ValidationError(f"网络 {label!r} 的 sim 必须是对象")
        trial_sim = Simulation(Scene(mode))
        try:
            trial_sim.apply_config(sim_payload)
        finally:
            trial_sim.shutdown()

    # 上面的 `trial.to_payload()` 会把场景规范化（补齐新增参数默认值、字段顺序等）。
    # 规范化是程序自己的行为，不是文件被篡改；这里同步重算校验和，保证
    # 「校验一次后的工程对象再次校验」仍然通过（打开工程会走两次 validate_project）。
    if project.get("checksum"):
        project["checksum"] = compute_checksum(project)

    fem_payload = project.get("fem") or {}
    if not isinstance(fem_payload, dict):
        raise ValidationError("工程的 fem 必须是对象")
    allowed_fem = set(FemConfigFields())
    unknown = set(fem_payload) - allowed_fem
    if unknown:
        raise ValidationError(f"FEM 配置包含未知字段：{', '.join(sorted(unknown))}")

    extensions = project.get("extensions") or []
    if not isinstance(extensions, list):
        raise ValidationError("工程的 extensions 必须是数组")
    for index, item in enumerate(extensions):
        if not isinstance(item, dict) or not isinstance(item.get("code"), str):
            raise ValidationError(f"第 {index + 1} 个扩展缺少 code 字符串")
        if len(item["code"]) > 200_000:
            raise LimitError("单个扩展代码不能超过 200 KB")
    return project


def FemConfigFields() -> tuple[str, ...]:
    from .fem import FemConfig

    return tuple(FemConfig.__dataclass_fields__.keys())


def project_networks(project: dict[str, Any]) -> list[dict[str, Any]]:
    """迁移后的网络列表（不做完整校验，供轻量查询）。"""
    return migrate_project(project)["networks"]


def project_current_network(project: dict[str, Any]) -> dict[str, Any]:
    """当前网络（不做完整校验，供轻量查询）。"""
    migrated = migrate_project(project)
    current = migrated["current"]
    return next(item for item in migrated["networks"] if item["id"] == current)


def project_scene_payload(
    project: dict[str, Any],
    network_id: str | None = None,
    library: str | None = None,
    *,
    allow_degraded: bool = False,
) -> dict[str, Any]:
    """生成可直接交给 ``Simulation.load_scene`` 的场景载荷（默认当前网络）。"""
    project = validate_project(project, library=library, allow_degraded=allow_degraded)
    target = network_id or project["current"]
    network = next(item for item in project["networks"] if item["id"] == target)
    scene = copy.deepcopy(network["scene"])
    # 功能块定义在工程顶层保存；引用式工程在这里解析成完整定义，保持单一数据源。
    raw_blocks = project.get("blocks") or []
    if any(_is_block_ref(item) for item in raw_blocks):
        from . import blocklib

        if allow_degraded:
            scene["blocks"] = blocklib.resolve_refs_degraded(
                library,
                raw_blocks,
                mode=str(network.get("scene", {}).get("mode") or "signal"),
                port_map=_scene_port_map(project),
            )["payloads"]
        else:
            scene["blocks"] = blocklib.resolve_refs(library, raw_blocks)
    else:
        scene["blocks"] = copy.deepcopy(raw_blocks)
    scene["sim"] = network.get("sim") or {}
    return scene


def project_to_text(project: dict[str, Any], *, indent: int = 2) -> str:
    return json.dumps(project, ensure_ascii=False, indent=indent, allow_nan=False)


def atomic_write(path: str | os.PathLike[str], payload: dict[str, Any] | str | bytes) -> Path:
    """原子写入工程文件，并把旧文件备份为 ``<name>.bak``。"""
    target = Path(path).expanduser().resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(payload, dict):
        data = project_to_text(payload).encode("utf-8")
    elif isinstance(payload, str):
        data = payload.encode("utf-8")
    else:
        data = bytes(payload)
    if len(data) > MAX_PROJECT_BYTES:
        raise LimitError(f"工程文件不能超过 {MAX_PROJECT_BYTES // 1_000_000} MB")
    fd, temp_name = tempfile.mkstemp(
        prefix=f".{target.name}.", suffix=".tmp", dir=str(target.parent)
    )
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        if target.exists():
            backup = target.with_suffix(target.suffix + ".bak")
            shutil.copy2(target, backup)
        os.replace(temp_path, target)
    except Exception:
        try:
            temp_path.unlink(missing_ok=True)
        except Exception:
            pass
        raise
    return target


def load_project(
    path: str | os.PathLike[str], library: str | None = None
) -> dict[str, Any]:
    target = Path(path).expanduser().resolve()
    if not target.is_file():
        raise ValidationError(f"工程文件不存在：{target}")
    size = target.stat().st_size
    if size > MAX_PROJECT_BYTES:
        raise LimitError(f"工程文件不能超过 {MAX_PROJECT_BYTES // 1_000_000} MB")
    try:
        payload = json.loads(target.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValidationError(f"工程文件 JSON 解析失败：{exc}") from exc
    return validate_project(payload, library=library)


def load_project_raw(path: str | os.PathLike[str]) -> dict[str, Any]:
    """只做结构/版本/校验和检查，不校验场景与扩展代码。

    桌面桥需要在**执行任何扩展代码之前**把工程交给前端，让用户确认信任；
    因此这里不做需要注册表的运行时校验。
    """
    target = Path(path).expanduser().resolve()
    if not target.is_file():
        raise ValidationError(f"工程文件不存在：{target}")
    size = target.stat().st_size
    if size > MAX_PROJECT_BYTES:
        raise LimitError(f"工程文件不能超过 {MAX_PROJECT_BYTES // 1_000_000} MB")
    try:
        payload = json.loads(target.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValidationError(f"工程文件 JSON 解析失败：{exc}") from exc
    project = migrate_project(payload)
    if not verify_checksum(project):
        # 旧版本（v1 / 场景 JSON）的校验和是对迁移前内容算的：迁移后重算，
        # 只要能证明原件未被篡改，就接受并在内存里自洽，不静默丢校验。
        if verify_checksum(payload):
            project["checksum"] = compute_checksum(project)
        else:
            raise ValidationError("工程文件校验和不匹配，可能已损坏或被修改")
    return project


def save_project(
    path: str | os.PathLike[str],
    simulation: Simulation,
    fem: Any | None = None,
    **kwargs: Any,
) -> Path:
    project = build_project(simulation, fem, **kwargs)
    return atomic_write(path, project)


def touch_project(payload: dict[str, Any], *, name: str | None = None) -> dict[str, Any]:
    project = copy.deepcopy(payload)
    if name is not None:
        project["name"] = str(name)[:120]
    project["modified"] = _now()
    project.pop("checksum", None)
    project["checksum"] = compute_checksum(project)
    return project


def ensure_project_error_types() -> type[NetlabError]:
    """保持模块导入时的异常类型可见（供类型检查/文档使用）。"""
    return NetlabError


__all__ = [
    "PROJECT_FORMAT",
    "PROJECT_VERSION",
    "APP_VERSION",
    "MAX_PROJECT_BYTES",
    "PROJECT_SUFFIX",
    "make_network",
    "build_project",
    "build_project_from_networks",
    "validate_project",
    "migrate_project",
    "migrate_scene_rails",
    "migrate_scene_to_devices",
    "migrate_scene_to_devices",
    "project_networks",
    "project_current_network",
    "project_scene_payload",
    "project_to_text",
    "atomic_write",
    "load_project",
    "load_project_raw",
    "save_project",
    "touch_project",
    "compute_checksum",
]
