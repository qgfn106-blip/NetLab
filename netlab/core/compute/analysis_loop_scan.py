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
                    "feedback_sign": None,
                    "feedback_sign_confirmed": False,
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
    缩略图/一次选中整环；拓扑本身不推断极性，feedback_sign 返回 None 并标记
    feedback_sign_confirmed=False，须用户确认（+1 负反馈 / -1 正反馈）。
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
        "feedback_sign": None,
        "feedback_sign_confirmed": False,
    }
    return {
        "ok": True,
        "mode": mode,
        "loop": loop,
        "loops": [loop],
        "warnings": [
            "电路模式按无向拓扑搜索包含该支路的最短闭合路径；feedback_sign 未推断，需用户确认极性（+1 负反馈 / -1 正反馈）。"
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
    try:
        sign = float(feedback_sign)
    except (TypeError, ValueError) as exc:
        raise AnalysisError("feedback_sign 必须为 +1（负反馈）或 -1（正反馈）") from exc
    if sign not in (-1.0, 1.0):
        raise AnalysisError("feedback_sign 必须为 +1（负反馈）或 -1（正反馈）")
    feedback_label = "负反馈" if sign > 0 else "正反馈"
    if not input_source or not output:
        raise AnalysisError("虚拟单位反馈需要 input_source 与 output")
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
        raise AnalysisError(f"虚拟单位{feedback_label}无法取得频响数据")
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
        "feedback_sign": sign,
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
         "feedback_sign": sign, "op_present": bool(operating_point)},
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
            raise AnalysisError(f"虚拟单位{feedback_label}缺少阶跃结果")
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
            "feedback_sign": sign,
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
            output=f"T({output}) 虚拟单位{feedback_label}",
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
            raise AnalysisError(f"虚拟单位{feedback_label}缺少 Bode 结果")
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
        "feedback_sign": sign,
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

