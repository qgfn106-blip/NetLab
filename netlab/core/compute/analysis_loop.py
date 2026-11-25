"""P3-02 analysis 分层模块（由 analysis.py 抽出，公共 API 不变）。"""
from __future__ import annotations

import math
import threading
import time
from pathlib import Path
from typing import Any, Callable

import numpy as np

from .frequency_diag import (
    cond_enabled as _freq_diag_enabled,
    point_diagnostics as _freq_point,
    summarize as _freq_summarize,
)
from . import complex_support as complex_layer
from . import transfer as transfer_math
from .exact_input import to_exact as _to_exact
from .circuit.descriptor import DescriptorModel
from .circuit.analysis_envelopes import bode_envelope, scene_fingerprint, step_envelope
from .circuit.fft_frequency import approximation_envelope, estimate_transfer_fft, multisine
from .circuit.loop_analysis import (
    branch_candidates,
    break_candidates,
    extract_branch_loop,
    extract_controlled_source_loop,
)
from .circuit.nyquist import nyquist_envelope, stability_margins
from .circuit.analysis_contract import curve, warning
from .circuit.descriptor_analysis import (
    UnsupportedAnalysisError,
    analyze_poles,
    analyze_zeros,
    build_output_matrices,
    descriptor_step_response,
    descriptor_transfer_function,
    descriptor_transient_response,
)
from ..common.limits import MAX_NODES, ComputeError, ValidationError
from .statespace import StateSpaceModel
from .analysis_errors import ANALYSIS_TIMEOUT, AnalysisError, MAX_EXPORT_ROWS
from .analysis_numerics import (
    _complex_list,
    _complex_pairs,
    _crossing,
    _frequency_axis,
    _number,
    _period_windows,
    _shift_score,
    _uniform,
)

from .analysis_envelopes import tf_analysis
from .analysis_transfer import frequency_response, transfer_function


def _analytic_loop_frequency_response(
    extraction: Any, frequencies: Any
) -> np.ndarray | None:
    """用断环解析传函计算回路频响，避免数值断环在高频的条件数退化。

    extraction.loop_gain 来自每个频点的描述系统数值求解；当回路增益幅值
    很小（高频段）时，断环测试解与输入解会发生严重相消，出现虚假的
    -160 dB 地板和相位跳回 0°。open_loop_transfer 是同一描述系统铅笔
    的解析传函（表达式形式），低频已与数值解逐点一致，全程用它可保证
    Bode/Nyquist 符合数学推导。解析不可用时回退到原始数值解。
    """
    transfer = getattr(extraction, "open_loop_transfer", None)
    if not isinstance(transfer, dict):
        return None
    if not transfer.get("supported") or not transfer.get("expression"):
        return None
    try:
        tf = transfer_math.parse_expression(str(transfer["expression"]))
        magnitude, phase = tf.frequency_response(
            2.0 * math.pi * np.asarray(frequencies, dtype=np.float64)
        )
        response = np.asarray(magnitude, dtype=np.float64) * np.exp(
            1j * np.asarray(phase, dtype=np.float64)
        )
    except Exception:  # noqa: BLE001 - 解析不可用时保持原有数值路径
        return None
    if response.shape != np.asarray(frequencies).shape:
        return None
    if not np.all(np.isfinite(response.real)) or not np.all(np.isfinite(response.imag)):
        return None
    return response




def _resolve_operating_point(
    sim: Any, operating_point: dict[str, float] | None
) -> dict[str, float] | None:
    """断环分析缺少工作点时，先求一次直流工作点。

    含运放/二极管等非线性器件的电路必须在工作点处线性化，否则
    DescriptorModel 会拒收这些元件；这里自动补一次 DC 工作点。纯线性
    电路也会额外求解一次，但结果与器件线性化无关。
    """
    if operating_point:
        return operating_point
    try:
        result = sim.operating_point()
    except (ComputeError, ValidationError, ValueError) as exc:
        raise AnalysisError(
            f"断环分析需要直流工作点，但工作点求解失败：{exc}"
        ) from exc
    values = result.get("node_voltages") if isinstance(result, dict) else None
    return values or None


def _loop_model(
    sim: Any, operating_point: dict[str, float] | None
) -> tuple[Any, DescriptorModel]:
    if sim is None:
        raise AnalysisError("断环分析必须提供电路仿真")
    scene = getattr(sim, "scene", None)
    if scene is None or getattr(scene, "mode", None) != "circuit":
        raise AnalysisError("断环分析需要 circuit 模式场景")
    operating_point = _resolve_operating_point(sim, operating_point)
    try:
        model = DescriptorModel.from_scene(scene, operating_point=operating_point)
    except ComputeError as exc:
        raise AnalysisError(f"断环状态空间构建失败：{exc}") from exc
    return scene, model


def break_points(sim: Any, *, operating_point: dict[str, float] | None = None) -> dict[str, Any]:
    """列出当前电路可断环的受控源，供前端选择。"""
    scene, model = _loop_model(sim, operating_point)
    candidates = break_candidates(model)
    for item in candidates:
        for key in ("control_a", "control_b", "output_a", "output_b"):
            node_id = item.get(key)
            node = model.index.node_by_id.get(node_id) if node_id is not None else None
            item[key] = str(getattr(node, "name", None) or node_id)
    return {
        "ok": True,
        "candidates": candidates,
        "branch_candidates": branch_candidates(model),
        "scene": {
            "mode": getattr(scene, "mode", "circuit"),
            "elements": len(getattr(scene, "edges", {}) or {}),
        },
    }


def loop_candidates(sim: Any, *, operating_point: dict[str, float] | None = None) -> dict[str, Any]:
    """列出候选反馈环路，供前端缩略图/一次选中整环。

    信号流模式：按有向连接图（enabled 且非延迟）做 Tarjan SCC，自动枚举反馈环，
    返回成员节点/边与候选断点；电路模式：暂不自动枚举拓扑环，返回受控源候选断点。
    """
    scene = getattr(sim, "scene", sim)
    mode = str(getattr(scene, "mode", "circuit"))
    scene_summary = {
        "mode": mode,
        "nodes": len(getattr(scene, "nodes", {}) or {}),
        "edges": len(getattr(scene, "edges", {}) or {}),
    }
    if mode == "signal":
        engine = scene.ensure_engine()
        network = getattr(engine, "network", None)
        if network is None:
            return {"ok": False, "mode": mode, "loops": [], "reason": "信号流引擎未就绪"}
        edge_id_by_name = {
            conn.name: rid for rid, conn in getattr(engine, "edge_map", {}).items()
        }
        node_id_by_name = {
            node.name: rid for rid, node in getattr(engine, "node_map", {}).items()
        }
        loops: list[dict[str, Any]] = []
        for index, group in enumerate(network.algebraic_cycle_groups(), start=1):
            members = list(group["nodes"])
            internal = list(group["edges"])
            self_loops = [c for c in internal if c.source is c.target]
            ordered = self_loops + [c for c in internal if c not in self_loops]
            breaks = [
                {
                    "break_id": edge_id_by_name.get(c.name, c.name),
                    "name": c.name,
                    "kind": "signal_edge",
                    "suggested": pos == 0,
                }
                for pos, c in enumerate(ordered)
            ]
            loops.append(
                {
                    "loop_id": f"loop-{index}",
                    "label": f"候选环 {index}",
                    "member_node_ids": [node_id_by_name.get(n.name, n.name) for n in members],
                    "member_node_names": [n.name for n in members],
                    "member_edge_ids": [edge_id_by_name.get(c.name, c.name) for c in internal],
                    "member_edge_names": [c.name for c in internal],
                    "candidate_breaks": breaks,
                    "suggested_break_id": breaks[0]["break_id"] if breaks else None,
                    "feedback_sign": 1,
                }
            )
        return {"ok": True, "mode": mode, "loops": loops, "scene": scene_summary}
    scene2, model = _loop_model(sim, operating_point)
    circuit_candidates = break_candidates(model)
    for item in circuit_candidates:
        for key in ("control_a", "control_b", "output_a", "output_b"):
            node_id = item.get(key)
            node = model.index.node_by_id.get(node_id) if node_id is not None else None
            item[key] = str(getattr(node, "name", None) or node_id)
    branches = branch_candidates(model)
    return {
        "ok": True,
        "mode": mode,
        "loops": [],
        "break_candidates": circuit_candidates,
        "branch_candidates": branches,
        "reason": "电路模式暂不自动枚举拓扑环，请从候选断点或反馈支路点选后解析",
        "scene": {
            "mode": mode,
            "nodes": len(getattr(scene2, "nodes", {}) or {}),
            "edges": len(getattr(scene2, "edges", {}) or {}),
        },
    }


def loop_from_break(
    sim: Any, *, break_id: str, operating_point: dict[str, float] | None = None
) -> dict[str, Any]:
    """电路模式：以用户点选的反馈支路为断点，搜索包含它的最短闭合拓扑路径。

    导线（kind=="wire"）先并查集合并为电气 net，器件作为 net 间无向边；删除所选
    支路后从其一端 BFS 回到另一端，找到即组成一个候选 LoopGroup。该结果仅用于
    缩略图/一次选中整环，feedback_sign 默认 +1，须用户确认。
    """
    scene = getattr(sim, "scene", sim)
    mode = str(getattr(scene, "mode", "circuit"))
    if mode != "circuit":
        raise AnalysisError("按支路选环需要 circuit 模式场景")
    edges = dict(getattr(scene, "edges", {}) or {})
    nodes = dict(getattr(scene, "nodes", {}) or {})
    edge_by_token: dict[str, Any] = {}
    for edge in edges.values():
        edge_by_token[str(getattr(edge, "id", ""))] = edge
        edge_by_token[str(getattr(edge, "name", ""))] = edge
    break_edge = edge_by_token.get(str(break_id))
    if break_edge is None:
        raise AnalysisError(f"未找到反馈支路：{break_id}")
    parent = {node_id: node_id for node_id in nodes}

    def find(x: str) -> str:
        root = x
        while parent[root] != root:
            root = parent[root]
        while parent[x] != root:
            parent[x], x = root, parent[x]
        return root

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for edge in edges.values():
        if edge is break_edge:
            continue
        if getattr(edge, "enabled", True) and str(getattr(edge, "kind", "")) == "wire":
            union(str(edge.source), str(edge.target))

    def net_of(token: str) -> str:
        return find(token) if token in parent else str(token)

    source_net = net_of(str(break_edge.source))
    target_net = net_of(str(break_edge.target))
    adjacency: dict[str, list[tuple[str, Any]]] = {}
    for edge in edges.values():
        if edge is break_edge:
            continue
        if not getattr(edge, "enabled", True):
            continue
        if str(getattr(edge, "kind", "")) == "wire":
            continue
        a = net_of(str(edge.source))
        b = net_of(str(edge.target))
        if a == b:
            continue
        adjacency.setdefault(a, []).append((b, edge))
        adjacency.setdefault(b, []).append((a, edge))

    prev: dict[str, tuple[str, Any] | None] = {target_net: None}
    queue = [target_net]
    found = False
    while queue:
        current = queue.pop(0)
        if current == source_net:
            found = True
            break
        for neighbor, edge in adjacency.get(current, ()):
            if neighbor in prev:
                continue
            prev[neighbor] = (current, edge)
            queue.append(neighbor)
    scene_summary = {"mode": mode, "nodes": len(nodes), "edges": len(edges)}
    if not found:
        return {
            "ok": False,
            "mode": mode,
            "break_id": str(break_id),
            "reason": "所选的反馈支路不在任何闭合反馈环中",
            "scene": scene_summary,
        }
    path_edges: list[Any] = []
    cursor = source_net
    while prev[cursor] is not None:
        parent_net, edge = prev[cursor]
        path_edges.append(edge)
        cursor = parent_net
    loop_edges = path_edges + [break_edge]
    node_ids: list[str] = []
    for edge in loop_edges:
        for endpoint in (str(edge.source), str(edge.target)):
            if endpoint not in node_ids:
                node_ids.append(endpoint)
    node_names = [str(getattr(nodes.get(nid), "name", nid)) for nid in node_ids]
    loop = {
        "loop_id": f"loop-{getattr(break_edge, 'id', break_id)}",
        "label": f"反馈环（{getattr(break_edge, 'name', break_id)}）",
        "member_node_ids": node_ids,
        "member_node_names": node_names,
        "member_edge_ids": [str(getattr(e, "id", "")) for e in loop_edges],
        "member_edge_names": [str(getattr(e, "name", "")) for e in loop_edges],
        "candidate_breaks": [
            {
                "break_id": str(getattr(break_edge, "id", break_id)),
                "name": str(getattr(break_edge, "name", break_id)),
                "kind": "circuit_branch",
                "suggested": True,
            }
        ],
        "suggested_break_id": str(getattr(break_edge, "id", break_id)),
        "feedback_sign": 1,
    }
    return {
        "ok": True,
        "mode": mode,
        "loop": loop,
        "loops": [loop],
        "warnings": [
            "电路模式按无向拓扑搜索包含该支路的最短闭合路径；feedback_sign 默认 +1，需用户确认。"
        ],
        "scene": scene_summary,
    }


def _resolve_loop_probe(
    sim: Any,
    *,
    loop_probe: dict[str, Any] | None,
    operating_point: dict[str, float] | None,
) -> tuple[str, str | None]:
    """把虚拟支路探针解析为环内可断开的线性受控源。

    LoopProbeSpec 只带 break_id（用户点选的反馈支路）与 loop_id。分析层不向
    用户电路插入任何 BRK 夹具：先按支路找出所属闭合环，再在环内选择已有的
    VCVS/VCCS 作为矩阵级断点。若环内没有线性受控源，则无法在不改变电路
    的前提下定义唯一开环 L(s)，明确 fail-closed。
    """
    probe = dict(loop_probe or {})
    break_id = str(probe.get("break_id") or probe.get("element") or "").strip()
    if not break_id:
        raise AnalysisError("虚拟断环探针需要 break_id（用户点选的反馈支路）")
    scene = getattr(sim, "scene", sim)
    edges = dict(getattr(scene, "edges", {}) or {})
    by_token: dict[str, Any] = {}
    for edge in edges.values():
        by_token[str(getattr(edge, "id", ""))] = edge
        by_token[str(getattr(edge, "name", ""))] = edge
    selected = by_token.get(break_id)
    if selected is not None and str(getattr(selected, "kind", "")) in ("vcvs", "vccs"):
        return str(getattr(selected, "name", "") or break_id), str(probe.get("loop_id") or "") or None
    # v8 器件节点场景：用户点选的反馈支路可能是 device 节点（电阻），直接作为无源支路断点。
    for node in (getattr(scene, "nodes", {}) or {}).values():
        token = str(getattr(node, "id", "")) or str(getattr(node, "name", ""))
        if break_id not in (str(getattr(node, "id", "")), str(getattr(node, "name", ""))):
            continue
        params = getattr(node, "params", {}) or {}
        if str(getattr(node, "kind", "")) == "device" and str(params.get("element", "")) == "resistor":
            return str(getattr(node, "name", "") or token), str(probe.get("loop_id") or "") or None
    group = loop_from_break(sim, break_id=break_id, operating_point=operating_point)
    if not group.get("ok"):
        raise AnalysisError(str(group.get("reason") or "所选反馈支路不在任何闭合反馈环中"))
    loop = dict(group.get("loop") or {})
    for edge_id in loop.get("member_edge_ids") or []:
        candidate = edges.get(str(edge_id)) or by_token.get(str(edge_id))
        if candidate is not None and str(getattr(candidate, "kind", "")) in ("vcvs", "vccs"):
            return str(getattr(candidate, "name", "") or edge_id), str(loop.get("loop_id") or "")
    raise AnalysisError(
        "所选环路不含 VCVS/VCCS 线性受控源，无法在不改变电路的前提下定义唯一开环 L(s)；"
        "当前只能显示闭环 T(s)"
    )


def _virtual_loop_analysis(
    sim: Any,
    *,
    input_source: str | None,
    output: str | None,
    feedback_sign: float,
    f_start: float,
    f_stop: float,
    points: int,
    scale: str,
    display: str,
    step_dt: float,
    step_duration: float,
    operating_point: dict[str, float] | None,
) -> dict[str, Any]:
    """无实体断环时仅展示直接求得的闭环 T(s)（明确标注，不参与判稳，不冒充开环）。"""
    if not input_source or not output:
        raise AnalysisError("虚拟单位负反馈需要 input_source 与 output")
    tf = tf_analysis(
        sim,
        mode="circuit",
        input_source=input_source,
        output=output,
        operating_point=operating_point,
        step_dt=step_dt,
        step_duration=step_duration,
        f_start=f_start,
        f_stop=f_stop,
        points=points,
        scale=scale,
    )
    bode = tf.get("bode") or {}
    probe = (bode.get("probes") or {}).get(output) or bode
    frequencies = np.asarray(probe.get("frequencies") or bode.get("frequencies") or [], dtype=float)
    magnitude_db = np.asarray(probe.get("db") or bode.get("db") or [], dtype=float)
    phase_deg = np.asarray(probe.get("phase_deg") or bode.get("phase_deg") or [], dtype=float)
    count = min(frequencies.size, magnitude_db.size, phase_deg.size)
    frequencies = frequencies[:count]
    magnitude_db = magnitude_db[:count]
    phase_deg = phase_deg[:count]
    if count == 0:
        raise AnalysisError("虚拟单位负反馈无法取得频响数据")
    # 电路未断环时，直接测量得到的响应就是真实闭环 T(jω)；
    # 开环 L(s) 必须来自实体断环，绝不在此反推、冒充开环。
    closed = 10.0 ** (magnitude_db / 20.0) * np.exp(1j * np.radians(phase_deg))
    source_payload = {
        "domain": "circuit",
        "mode": "circuit",
        "model": "descriptor_linearized",
        "path": "descriptor_linearized",
        "kind": "loop",
        "loop_origin": "virtual_unit_feedback",
        "break_element": "__virtual__",
        "break_kind": "virtual",
        "input_source": input_source,
        "output": output,
        "feedback_sign": 1.0,
        "operating_point_supplied": bool(operating_point),
    }
    warning_items = [
        warning(
            "no_physical_loop",
            "电路未选择实体断环元件，当前仅显示直接求得的闭环 T(s)；未断环，无法给出开环 L(s)，也不会把闭环误标为开环。",
            severity="warning",
        )
    ]
    metrics = {
        "phase_margin_deg": None,
        "gain_margin_db": None,
        "stable_from_margins": None,
        "gain_crossings": [],
        "phase_crossings": [],
        "loop_gain_available": False,
    }
    fingerprint_value = scene_fingerprint(
        sim.scene,
        {"kind": "virtual_loop", "input_source": input_source, "output": output,
         "f_start": float(f_start), "f_stop": float(f_stop), "points": int(points),
         "op_present": bool(operating_point)},
    )
    # 直接闭环 T(s) 来自 tf_analysis 的解析式；开环不可得，标记为 unsupported。
    closed_loop_transfer = tf.get("transfer_function")
    open_loop_transfer = {
        "supported": False,
        "reason": "电路未选择实体断环元件，无法给出开环 L(s)；当前仅显示闭环 T(s)。",
    }
    if display == "step":
        step_payload = dict((tf.get("envelopes") or {}).get("time") or {})
        if not step_payload:
            raise AnalysisError("虚拟单位负反馈缺少阶跃结果")
        step_payload["source"] = {**source_payload, "kind": "loop_step"}
        step_payload["warnings"] = [*(step_payload.get("warnings") or []), *warning_items]
        step_payload["metrics"] = {**metrics, "approximate_closed_loop": True}
        return {
            "ok": True,
            "kind": "loop_step",
            "display": "step",
            "element": "__virtual__",
            "break_kind": "virtual",
            "input_source": input_source,
            "output": output,
            "feedback_sign": 1.0,
            "loop_origin": "virtual_unit_feedback",
            "parity_max_rel": None,
            "poles": tf.get("poles"),
            "metrics": metrics,
            "warnings": warning_items,
            "fingerprint": fingerprint_value,
            "envelopes": {"time": step_payload},
            "source": source_payload,
            "transfer_function": closed_loop_transfer,
            "open_loop_transfer_function": open_loop_transfer,
            "closed_loop_transfer_function": closed_loop_transfer,
            "transfer_role": "closed_loop",
        }
    if display == "closed_loop":
        closed_mag = 20.0 * np.log10(np.maximum(np.abs(closed), 1e-300))
        closed_phase = np.degrees(np.unwrap(np.angle(closed)))
        bode_payload = bode_envelope(
            frequencies=frequencies,
            magnitude_db=closed_mag,
            phase_deg=closed_phase,
            source={**source_payload, "kind": "loop_closed"},
            output=f"T({output}) 虚拟单位负反馈",
            poles=(tf.get("poles") or {}).get("finite", []),
            metrics=dict(metrics),
            warnings=warning_items,
            fingerprint_value=fingerprint_value,
        )
        bode_payload["curves"][0]["label"] = "闭环 T(s) 幅值"
        bode_payload["curves"][1]["label"] = "闭环 T(s) 相位"
    else:
        bode_payload = dict((tf.get("envelopes") or {}).get("bode") or {})
        if not bode_payload:
            raise AnalysisError("虚拟单位负反馈缺少 Bode 结果")
        bode_payload["source"] = source_payload
        bode_payload["warnings"] = [*(bode_payload.get("warnings") or []), *warning_items]
        bode_payload["metrics"] = {**metrics, "approximate_closed_loop": False}
    return {
        "ok": True,
        "kind": "loop",
        "display": display,
        "element": "__virtual__",
        "break_kind": "virtual",
        "input_source": input_source,
        "output": output,
        "feedback_sign": 1.0,
        "loop_origin": "virtual_unit_feedback",
        "frequencies_hz": [float(value) for value in frequencies],
        "loop_gain": [],
        "forward_gain": [],
        "closed_loop": _complex_list(closed),
        "loop_gain_available": False,
        "direct_response": None,
        "parity_max_rel": None,
        "poles": tf.get("poles"),
        "metrics": metrics,
        "warnings": warning_items,
        "fingerprint": fingerprint_value,
        "envelopes": {"bode": bode_payload},
        "source": source_payload,
        "transfer_function": closed_loop_transfer,
        "open_loop_transfer_function": open_loop_transfer,
        "closed_loop_transfer_function": closed_loop_transfer,
        "transfer_role": "closed_loop",
    }


def loop_analysis(
    sim: Any,
    *,
    element: str | None = "",
    input_source: str | None = None,
    output: str | None = None,
    feedback_sign: float = 1.0,
    f_start: float = 1.0,
    f_stop: float = 1_000_000.0,
    points: int = 241,
    scale: str = "log",
    display: str = "loop",
    step_dt: float = 1.0e-5,
    step_duration: float = 5.0e-3,
    operating_point: dict[str, float] | None = None,
    loop_probe: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """断环分析：回路增益 Bode / 闭环 T(s) Bode / 直接闭环阶跃。

    display=loop 返回 L(s) 的 Bode 与稳定裕度；closed_loop 返回 T(s) 与
    直接闭环响应两条曲线；step 返回直接闭环阶跃响应。element 为空或
    "__virtual__" 时仅允许 closed_loop/step（直接闭环 T(s)）；display=loop
    必须显式断环，绝不把闭环冒充开环 L(s)。
    """
    if display not in ("loop", "closed_loop", "step"):
        raise AnalysisError(f"未知闭环显示 {display!r}；只支持 loop / closed_loop / step")
    resolved_loop_id: str | None = None
    probe_mode = "element"
    if loop_probe:
        element, resolved_loop_id = _resolve_loop_probe(
            sim, loop_probe=loop_probe, operating_point=operating_point
        )
        probe_mode = "virtual_branch"
    if not element or element == "__virtual__":
        if display == "loop":
            raise AnalysisError(
                "环路分析必须选择实体断环点，未断环无法求开环 L(s)；"
                "如需直接闭环响应请改用闭环 Bode/阶跃。"
            )
        return _virtual_loop_analysis(
            sim,
            input_source=input_source,
            output=output,
            feedback_sign=feedback_sign,
            f_start=f_start,
            f_stop=f_stop,
            points=points,
            scale=scale,
            display=display,
            step_dt=step_dt,
            step_duration=step_duration,
            operating_point=operating_point,
        )
    scene, model = _loop_model(sim, operating_point)
    frequencies = _frequency_axis(f_start, f_stop, points, scale)
    selected_element = model.index.element_by_name.get(str(element))
    try:
        if selected_element is not None and getattr(selected_element, "kind", "") == "resistor":
            extraction = extract_branch_loop(
                model,
                element,
                frequencies,
                input_source=input_source,
                output=output,
                feedback_sign=feedback_sign,
            )
        else:
            extraction = extract_controlled_source_loop(
                model,
                element,
                frequencies,
                input_source=input_source,
                output=output,
                feedback_sign=feedback_sign,
            )
    except (ComputeError, ValidationError, ValueError) as exc:
        raise AnalysisError(f"断环分析失败：{exc}") from exc

    loop_response = _analytic_loop_frequency_response(extraction, frequencies)
    if loop_response is None:
        loop_response = extraction.loop_gain
    margins = stability_margins(
        frequencies, loop_response, feedback_sign=feedback_sign
    )
    source_payload = {
        "domain": "circuit",
        "mode": "circuit",
        "model": "descriptor_linearized",
        "path": "descriptor_linearized",
        "kind": "loop",
        "break_element": extraction.element,
        "break_kind": extraction.kind,
        "input_source": extraction.input_source,
        "output": extraction.output_name,
        "feedback_sign": float(feedback_sign),
        "operating_point_supplied": bool(operating_point),
    }
    analysis_params = {
        "kind": "circuit_loop",
        "element": extraction.element,
        "input_source": extraction.input_source,
        "output": extraction.output_name,
        "feedback_sign": float(feedback_sign),
        "f_start": float(f_start),
        "f_stop": float(f_stop),
        "points": int(points),
        "scale": str(scale),
        "display": str(display),
        "step_dt": float(step_dt),
        "step_duration": float(step_duration),
    }
    fingerprint_value = scene_fingerprint(
        scene, {**analysis_params, "op_present": bool(operating_point)}
    )

    magnitude_db = 20.0 * np.log10(np.maximum(np.abs(loop_response), 1e-300))
    phase_deg = np.degrees(np.unwrap(np.angle(loop_response)))
    envelope_warnings = list(extraction.warnings)
    if margins["stable_from_margins"] is False:
        envelope_warnings.append(
            warning(
                "loop_negative_margin",
                "回路增益裕度为负，闭环可能不稳定",
                severity="warning",
            )
        )
    bode_payload = bode_envelope(
        frequencies=frequencies,
        magnitude_db=magnitude_db,
        phase_deg=phase_deg,
        source=source_payload,
        output=f"L({extraction.element})",
        poles=extraction.poles.get("finite", []),
        zeros=(),
        metrics={
            "phase_margin_deg": margins["phase_margin_deg"],
            "gain_margin_db": margins["gain_margin_db"],
            "stable_from_margins": margins["stable_from_margins"],
        },
        warnings=envelope_warnings,
        fingerprint_value=fingerprint_value,
    )
    if display == "closed_loop":
        # 闭环 T 直接采用提取器给出的 T = G/(1+L)（G=forward_gain、L=loop_gain，L 已含极性）。
        # 旧实现用 loop_response/(1+sign*loop_response)=L/(1+L) 绘制，非单位反馈会差 1/β（LM-01/LM-04）。
        closed_synth = extraction.closed_loop
        closed_mag = 20.0 * np.log10(np.maximum(np.abs(closed_synth), 1e-300))
        closed_phase = np.degrees(np.unwrap(np.angle(closed_synth)))
        bode_payload = bode_envelope(
            frequencies=frequencies,
            magnitude_db=closed_mag,
            phase_deg=closed_phase,
            source={**source_payload, "kind": "loop_closed"},
            output=f"T({extraction.output_name})",
            poles=extraction.poles.get("finite", []),
            zeros=(),
            metrics={
                "phase_margin_deg": margins["phase_margin_deg"],
                "gain_margin_db": margins["gain_margin_db"],
                "stable_from_margins": margins["stable_from_margins"],
                "parity_max_rel": extraction.parity_max_rel,
            },
            warnings=envelope_warnings,
            fingerprint_value=fingerprint_value,
        )
        bode_payload["curves"][0]["label"] = "闭环 T_synth 幅值"
        bode_payload["curves"][1]["label"] = "闭环 T_synth 相位"
        if extraction.direct_response is not None:
            direct_mag = 20.0 * np.log10(
                np.maximum(np.abs(extraction.direct_response), 1e-300)
            )
            direct_phase = np.degrees(np.unwrap(np.angle(extraction.direct_response)))
            bode_payload["curves"].append(
                curve(
                    "closed_loop_direct_mag",
                    label="直接闭环 T_direct 幅值",
                    x_axis="f",
                    y_axis="mag_db",
                    x=[float(value) for value in frequencies],
                    y=[float(value) for value in direct_mag],
                    style="dashed",
                    category="loop",
                    detail={"parity_max_rel": extraction.parity_max_rel},
                )
            )
            bode_payload["curves"].append(
                curve(
                    "closed_loop_direct_phase",
                    label="直接闭环 T_direct 相位",
                    x_axis="f",
                    y_axis="phase_deg",
                    x=[float(value) for value in frequencies],
                    y=[float(value) for value in direct_phase],
                    style="dashed",
                    category="loop",
                    detail={"parity_max_rel": extraction.parity_max_rel},
                )
            )
    try:
        physical_transfer = descriptor_transfer_function(
            model, extraction.input_source, extraction.output_name
        )
    except Exception as exc:  # noqa: BLE001 - 传函不可得时不应中断整个环路分析
        physical_transfer = {"supported": False, "reason": str(exc)}
    if display == "step":
        steps = int(round(float(step_duration) / max(float(step_dt), 1e-12)))
        actual_dt = float(step_dt)
        if steps > 2000:
            actual_dt = float(step_duration) / 2000.0
        step_payload = descriptor_step_response(
            model,
            extraction.input_source,
            extraction.output_name,
            t_end=float(step_duration),
            dt=actual_dt,
        )
        step_envelope_payload = step_envelope(
            times=step_payload.get("times", []),
            values=step_payload.get("values", []),
            source={**source_payload, "kind": "loop_step"},
            output=extraction.output_name,
            metrics={
                "phase_margin_deg": margins["phase_margin_deg"],
                "gain_margin_db": margins["gain_margin_db"],
                "stable_from_margins": margins["stable_from_margins"],
                "parity_max_rel": extraction.parity_max_rel,
            },
            warnings=envelope_warnings,
            fingerprint_value=fingerprint_value,
        )
        return {
            "ok": True,
            "kind": "loop_step",
            "display": "step",
            "element": extraction.element,
            "break_kind": extraction.kind,
            "loop_id": resolved_loop_id,
            "probe": probe_mode,
            "input_source": extraction.input_source,
            "output": extraction.output_name,
            "feedback_sign": float(feedback_sign),
            "parity_max_rel": extraction.parity_max_rel,
            "poles": extraction.poles,
            "metrics": {
                "phase_margin_deg": margins["phase_margin_deg"],
                "gain_margin_db": margins["gain_margin_db"],
                "stable_from_margins": margins["stable_from_margins"],
                "parity_max_rel": extraction.parity_max_rel,
            },
            "warnings": envelope_warnings,
            "fingerprint": fingerprint_value,
            "envelopes": {"time": step_envelope_payload},
            "source": {**source_payload, "kind": "loop_step"},
            "transfer_function": physical_transfer,
            "open_loop_transfer_function": extraction.open_loop_transfer,
            "transfer_role": "closed_loop",
        }
    return {
        "ok": True,
        "display": display,
        "kind": "loop",
        "element": extraction.element,
        "break_kind": extraction.kind,
        "loop_id": resolved_loop_id,
        "probe": probe_mode,
        "input_source": extraction.input_source,
        "output": extraction.output_name,
        "feedback_sign": float(feedback_sign),
        "frequencies_hz": [float(value) for value in frequencies],
        "loop_gain": _complex_list(loop_response),
        "forward_gain": _complex_list(extraction.forward_gain),
        "closed_loop": _complex_list(extraction.closed_loop),
        "direct_response": (
            _complex_list(extraction.direct_response)
            if extraction.direct_response is not None
            else None
        ),
        "parity_max_rel": extraction.parity_max_rel,
        "poles": extraction.poles,
        "metrics": {
            "phase_margin_deg": margins["phase_margin_deg"],
            "gain_margin_db": margins["gain_margin_db"],
            "stable_from_margins": margins["stable_from_margins"],
            "gain_crossings": margins["gain_crossings"],
            "phase_crossings": margins["phase_crossings"],
        },
        "warnings": envelope_warnings,
        "fingerprint": fingerprint_value,
        "envelopes": {"bode": bode_payload},
        "source": source_payload,
        "transfer_function": (
            extraction.open_loop_transfer if display == "loop" else physical_transfer
        ),
        "open_loop_transfer_function": extraction.open_loop_transfer,
        "transfer_role": "open_loop" if display == "loop" else "closed_loop",
    }


def _extract_frequency_loop(
    model: DescriptorModel,
    element: str,
    frequencies: Any,
    *,
    input_source: str | None = None,
    output: str | None = None,
    feedback_sign: float = 1.0,
):
    """按元件类型选择断环提取：无源电阻走支路返回比，受控源/运放走矩阵断点。"""
    candidate = model.index.element_by_name.get(str(element))
    if candidate is not None and getattr(candidate, "kind", "") == "resistor":
        return extract_branch_loop(
            model,
            element,
            frequencies,
            input_source=input_source,
            output=output,
            feedback_sign=feedback_sign,
        )
    return extract_controlled_source_loop(
        model,
        element,
        frequencies,
        input_source=input_source,
        output=output,
        feedback_sign=feedback_sign,
    )


def nyquist_analysis(
    sim: Any,
    *,
    element: str,
    input_source: str | None = None,
    output: str | None = None,
    feedback_sign: float = 1.0,
    f_start: float = 1.0,
    f_stop: float = 1_000_000.0,
    points: int = 401,
    scale: str = "log",
    operating_point: dict[str, float] | None = None,
) -> dict[str, Any]:
    """断环：Nyquist 轮廓、包围数、P/N/Z 与稳定裕度。

    element 可为受控源（VCVS/VCCS/运放）或无源反馈电阻支路；后者按返回比
    断开外环，适合多级运放电路。
    """
    scene, model = _loop_model(sim, operating_point)
    if not element:
        raise AnalysisError("Nyquist 分析必须选择断环元件")
    frequencies = _frequency_axis(f_start, f_stop, points, scale)
    try:
        extraction = _extract_frequency_loop(
            model,
            element,
            frequencies,
            input_source=input_source,
            output=output,
            feedback_sign=feedback_sign,
        )
    except (ComputeError, ValidationError, ValueError) as exc:
        raise AnalysisError(f"Nyquist 分析失败：{exc}") from exc

    source_payload = {
        "domain": "circuit",
        "mode": "circuit",
        "model": "descriptor_linearized",
        "kind": "nyquist",
        "break_element": extraction.element,
        "break_kind": extraction.kind,
        "input_source": extraction.input_source,
        "output": extraction.output_name,
        "feedback_sign": float(feedback_sign),
        "operating_point_supplied": bool(operating_point),
    }
    analysis_params = {
        "kind": "circuit_nyquist",
        "element": extraction.element,
        "input_source": extraction.input_source,
        "output": extraction.output_name,
        "feedback_sign": float(feedback_sign),
        "f_start": float(f_start),
        "f_stop": float(f_stop),
        "points": int(points),
        "scale": str(scale),
    }
    fingerprint_value = scene_fingerprint(
        scene, {**analysis_params, "op_present": bool(operating_point)}
    )
    loop_response = _analytic_loop_frequency_response(extraction, frequencies)
    if loop_response is None:
        loop_response = extraction.loop_gain
    payload = nyquist_envelope(
        frequencies,
        loop_response,
        source=source_payload,
        poles=extraction.poles,
        feedback_sign=feedback_sign,
        element=extraction.element,
        output=extraction.output_name,
        fingerprint_value=fingerprint_value,
        evidence={
            "parity_max_rel": extraction.parity_max_rel,
            "break_kind": extraction.kind,
        },
    )
    metrics = dict(payload.get("metrics") or {})
    warnings_list = list(payload.get("warnings") or [])
    for item in extraction.warnings:
        if item not in warnings_list:
            warnings_list.append(item)
    payload["warnings"] = warnings_list
    return {
        "ok": True,
        "kind": "nyquist",
        "element": extraction.element,
        "break_kind": extraction.kind,
        "input_source": extraction.input_source,
        "output": extraction.output_name,
        "feedback_sign": float(feedback_sign),
        "frequencies_hz": [float(value) for value in frequencies],
        "loop_gain": _complex_list(loop_response),
        "poles": extraction.poles,
        "metrics": metrics,
        "warnings": warnings_list,
        "fingerprint": fingerprint_value,
        "envelopes": {"nyquist": payload},
        "source": source_payload,
    }


def step_open_analysis(
    sim: Any,
    *,
    element: str | None = "",
    input_source: str | None = None,
    output: str | None = None,
    feedback_sign: float = 1.0,
    f_start: float = 1.0,
    f_stop: float = 1_000_000.0,
    points: int = 241,
    scale: str = "log",
    step_dt: float = 1.0e-5,
    step_duration: float = 5.0e-3,
    operating_point: dict[str, float] | None = None,
    loop_probe: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """开环阶跃：先按断环求真实 L(s)，再由 L(s) 做单位阶跃响应。

    与 loop_analysis(display="loop") 共用同一断环口径；绝不把闭环 T(s)
    直接冒充开环阶跃。
    """
    loop = loop_analysis(
        sim,
        element=element,
        input_source=input_source,
        output=output,
        feedback_sign=feedback_sign,
        f_start=f_start,
        f_stop=f_stop,
        points=points,
        scale=scale,
        display="loop",
        step_dt=step_dt,
        step_duration=step_duration,
        operating_point=operating_point,
        loop_probe=loop_probe,
    )
    open_tf = loop.get("open_loop_transfer_function") or {}
    expression = open_tf.get("expression") if isinstance(open_tf, dict) else None
    if not expression:
        raise AnalysisError("开环阶跃需要可解析的开环传递函数 L(s)，当前断环结果不足")
    try:
        tf = transfer_math.parse_expression(str(expression))
        signal = transfer_math.analyze(
            tf,
            dt=float(step_dt),
            duration=float(step_duration),
            points=int(points),
        )
    except Exception as exc:  # noqa: BLE001 - 统一转分析错误
        raise AnalysisError(f"开环阶跃求解失败：{exc}") from exc
    source_payload = {
        **(loop.get("source") or {}),
        "kind": "step_open",
        "transfer_role": "open_loop",
        "open_loop_expression": str(expression),
    }
    bode_payload_source = {**source_payload, "kind": "step_open_bode"}
    bode = signal.get("bode") or {}
    time_payload = signal.get("step") or {}
    bode_env = bode_envelope(
        frequencies=bode.get("frequency_hz", []),
        magnitude_db=bode.get("magnitude_db", []),
        phase_deg=bode.get("phase_deg", []),
        source=bode_payload_source,
        output=str(loop.get("output") or ""),
    )
    time_env = step_envelope(
        times=time_payload.get("t", []),
        values=time_payload.get("y", []),
        source={**source_payload, "kind": "step_open"},
        output=str(loop.get("output") or ""),
    )
    return {
        **signal,
        "kind": "step_open",
        "display": "step",
        "element": loop.get("element"),
        "break_kind": loop.get("break_kind"),
        "input_source": loop.get("input_source"),
        "output": loop.get("output"),
        "feedback_sign": float(feedback_sign),
        "transfer_role": "open_loop",
        "open_loop_transfer_function": open_tf,
        "envelopes": {"bode": bode_env, "time": time_env},
        "source": source_payload,
    }


def nyquist_closed_analysis(
    sim: Any,
    *,
    input_source: str | None = None,
    output: str | None = None,
    feedback_sign: float = 1.0,
    f_start: float = 1.0,
    f_stop: float = 1_000_000.0,
    points: int = 401,
    scale: str = "log",
    operating_point: dict[str, float] | None = None,
) -> dict[str, Any]:
    """闭环 Nyquist：直接由闭环 T(s) 画 Nyquist 轮廓。

    该曲线只展示闭环传递函数的复平面轨迹；稳定性判定仍应看开环 L(s)
    的 Nyquist 包围或 Bode 裕度，本函数不把闭环轮廓当作开环判据。
    """
    tf_result = tf_analysis(
        sim,
        mode="circuit",
        input_source=input_source,
        output=output,
        operating_point=operating_point,
        f_start=f_start,
        f_stop=f_stop,
        points=points,
        scale=scale,
    )
    transfer = tf_result.get("transfer_function") or {}
    expression = transfer.get("expression") if isinstance(transfer, dict) else None
    if not expression:
        raise AnalysisError("闭环 Nyquist 需要可解析的闭环传递函数 T(s)")
    try:
        tf = transfer_math.parse_expression(str(expression))
    except Exception as exc:  # noqa: BLE001
        raise AnalysisError(f"闭环传递函数解析失败：{exc}") from exc
    frequencies = _frequency_axis(f_start, f_stop, points, scale)
    magnitude, phase = tf.frequency_response(2.0 * math.pi * np.asarray(frequencies))
    loop_gain = np.asarray(magnitude, dtype=np.float64) * np.exp(
        1j * np.asarray(phase, dtype=np.float64)
    )
    source_payload = {
        "domain": "circuit",
        "mode": "circuit",
        "model": "descriptor_linearized",
        "kind": "nyquist_closed",
        "transfer_role": "closed_loop",
        "input_source": input_source,
        "output": output,
        "feedback_sign": float(feedback_sign),
    }
    payload = nyquist_envelope(
        frequencies,
        loop_gain,
        source=source_payload,
        feedback_sign=feedback_sign,
        element="__closed_loop__",
        output=str(output or tf_result.get("output") or ""),
    )
    metrics = dict(payload.get("metrics") or {})
    metrics["role"] = "closed_loop_contour"
    payload["metrics"] = metrics
    warnings_list = list(payload.get("warnings") or [])
    warnings_list.append(
        warning(
            "nyquist_closed_visualization",
            "闭环 Nyquist 轮廓仅展示闭环 T(s) 轨迹，稳定性请以开环 Nyquist/裕度为准",
            severity="info",
        )
    )
    payload["warnings"] = warnings_list
    return {
        "ok": True,
        "kind": "nyquist_closed",
        "transfer_role": "closed_loop",
        "input_source": input_source,
        "output": output,
        "feedback_sign": float(feedback_sign),
        "frequencies_hz": [float(value) for value in frequencies],
        "metrics": metrics,
        "warnings": warnings_list,
        "envelopes": {"nyquist": payload},
        "source": source_payload,
        "transfer_function": transfer,
    }


