"""分析工作台导出（规格 D10）。

把工作台会话里缓存的结果信封转成 PlotKit spec / PNG / SVG / PDF / CSV /
JSON / ZIP。数值全部来自后端结果，前端只提交选择（会话、状态、结果键）。
"""

from __future__ import annotations

import csv
import io
import json
import tempfile
import time
import zipfile
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from ..core.common.limits import NotFoundError, ValidationError

EXPORT_SCHEMA = "netlab-analysis-export/1"
EXPORT_FORMATS = ("png", "svg", "pdf", "spec", "csv", "json", "zip")
MAX_STATES = 8
_PALETTE = ("#9b7247", "#7a6fb0", "#c98a2e", "#5d8a6b", "#b3566e", "#4f7fa8", "#8a6d3b", "#666666")
MARKER_SYMBOL = {
    "pole": "cross",
    "zero": "circle",
    "cross_gain": "diamond",
    "cross_phase": "triangle",
    "peak": "square",
    "cutoff": "circle",
    "gm": "diamond",
    "pm": "diamond",
    "nyquist_crit": "cross",
}
MARKER_COLOR = {
    "stability": "#d05a5a",
    "response": "#9b7247",
    "margin": "#c98a2e",
    "loop": "#7a6fb0",
}
MEDIA_TYPES = {
    "png": "image/png",
    "svg": "image/svg+xml",
    "pdf": "application/pdf",
    "spec": "application/json",
    "csv": "text/csv; charset=utf-8",
    "json": "application/json",
    "zip": "application/zip",
}
AXIS_SCALE = {"log": "log", "log10": "log", "linear": "linear"}


@dataclass(frozen=True)
class ExportArtifact:
    filename: str
    media_type: str
    data: bytes


@dataclass(frozen=True)
class ExportEntry:
    result_id: str
    state_id: str
    state_label: str
    kind: str
    envelope: dict[str, Any]
    fingerprint: str | None
    generated_at: float
    stale: bool
    stale_reason: str | None


def _require_format(value: str) -> str:
    fmt = str(value or "").strip().lower()
    if fmt not in EXPORT_FORMATS:
        raise ValidationError(f"不支持的导出格式：{value!r}（可选 {'/'.join(EXPORT_FORMATS)}）")
    return fmt


def _version(package: str) -> str:
    try:
        module = __import__(package)
    except Exception:  # pragma: no cover - 插件缺失时由启动门禁先行报错
        return "unknown"
    return str(getattr(module, "__version__", "unknown"))


def _axis_index(envelope: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    return {str(item.get("id")): item for item in envelope.get("axes") or [] if isinstance(item, Mapping)}


def _subplot_axes(entries: Sequence[ExportEntry]) -> list[str]:
    """按曲线 y 轴出现顺序分配子图（Bode -> 幅频 + 相频）。"""
    seen: list[str] = []
    for entry in entries:
        for curve in entry.envelope.get("curves") or []:
            axes = curve.get("axes") or []
            if len(axes) >= 2:
                y_axis = str(axes[1])
                if y_axis not in seen:
                    seen.append(y_axis)
    return seen[:2] if seen else ["value"]


def _curve_label(entry: ExportEntry, curve: Mapping[str, Any], multi: bool) -> str:
    label = str(curve.get("label") or curve.get("id") or "曲线")
    return f"{entry.state_label} · {label}" if multi else label


def _layer(
    figure: Any,
    *,
    x: Sequence[float],
    y: Sequence[float],
    subplot: int,
    label: str,
    color: str,
    dash: str,
    view: Mapping[str, Any] | None = None,
) -> None:
    dash_map = {"solid": "solid", "dashed": "dash", "dotted": "dot"}
    style: dict[str, Any] = {"color": color, "width": 1.6, "dash": dash_map.get(dash, "solid")}
    figure.add_plot(
        "line",
        x=list(x),
        y=list(y),
        subplot=subplot,
        label=label,
        legend=True,
        view=view,
        style=style,
    )


def build_figure(entries: Sequence[ExportEntry], *, title: str | None = None) -> Any:
    """把信封曲线拼成 PlotKit Figure（多状态叠加，保持 marker 标签）。"""
    if not entries:
        raise ValidationError("没有可导出的分析结果")
    plotkit = __import__("plotkit")
    y_axes = _subplot_axes(entries)
    axis_ids: dict[str, Mapping[str, Any]] = {}
    for entry in entries:
        axis_ids.update(_axis_index(entry.envelope))
    subplot_of = {axis_id: index for index, axis_id in enumerate(y_axes)}
    multi = len({entry.state_id for entry in entries}) > 1
    curve_colors: dict[str, str] = {}
    dash_by_state: dict[str, str] = {}
    for index, state_id in enumerate(dict.fromkeys(entry.state_id for entry in entries)):
        dash_by_state[state_id] = "solid" if index == 0 else ("dashed" if index == 1 else "dotted")

    figure = plotkit.figure(
        subplots=max(1, len(y_axes)),
        title=title or "NetLab 电路分析导出",
        size=(12.2, 7.6 if len(y_axes) > 1 else 5.6),
        dpi=120,
    )
    for entry in entries:
        for curve in entry.envelope.get("curves") or []:
            axes = curve.get("axes") or []
            if len(axes) < 2:
                continue
            x_axis, y_axis = str(axes[0]), str(axes[1])
            subplot = subplot_of.get(y_axis, 0)
            x_values = [float(v) for v in curve.get("x") or []]
            y_values = [float(v) for v in curve.get("y") or []]
            if not x_values or len(x_values) != len(y_values):
                continue
            curve_id = str(curve.get("id") or "curve")
            color = curve_colors.setdefault(curve_id, _PALETTE[len(curve_colors) % len(_PALETTE)])
            x_meta = axis_ids.get(x_axis) or {}
            y_meta = axis_ids.get(y_axis) or {}
            view = {
                "xlabel": str(x_meta.get("label") or x_axis),
                "ylabel": str(y_meta.get("label") or y_axis),
                "xscale": AXIS_SCALE.get(str(x_meta.get("scale") or "linear"), "linear"),
                "yscale": AXIS_SCALE.get(str(y_meta.get("scale") or "linear"), "linear"),
                "grid": True,
            }
            _layer(
                figure,
                x=x_values,
                y=y_values,
                subplot=subplot,
                label=_curve_label(entry, curve, multi),
                color=color,
                dash=dash_by_state.get(entry.state_id, "solid"),
                view=view,
            )

    notes: list[dict[str, Any]] = []
    for entry in entries:
        for marker in entry.envelope.get("markers") or []:
            shape = str(marker.get("shape") or "peak")
            axis_x = str(marker.get("axis_x") or "")
            axis_y = str(marker.get("axis_y") or "")
            if axis_y not in subplot_of:
                continue
            try:
                x_value = float(marker.get("x"))
                y_value = float(marker.get("y"))
            except (TypeError, ValueError):
                continue
            category = str(marker.get("category") or "response")
            color = MARKER_COLOR.get(category, "#666666")
            symbol = MARKER_SYMBOL.get(shape, "circle")
            figure.add_plot(
                "scatter",
                x=[x_value],
                y=[y_value],
                subplot=subplot_of[axis_y],
                label=None,
                legend=False,
                style={
                    "color": color,
                    "marker": {"symbol": symbol, "size": 8},
                    "mode": "markers",
                    "opacity": 0.95,
                },
            )
            label = str(marker.get("label") or shape)
            notes.append(
                {
                    "kind": "mark",
                    "text": label,
                    "x": x_value,
                    "y": y_value,
                    "subplot": subplot_of[axis_y],
                    "color": color,
                    "size": 9.5,
                }
            )
            del axis_x

    figure.spec.setdefault("figure", {})["notes"] = notes
    figure.validate()
    return figure


def plot_spec_payload(figure: Any) -> dict[str, Any]:
    """自包含 PlotKit JSON：spec + 图层引用的数据集数组。"""
    datasets: dict[str, list[float]] = {}
    for name in figure.store.names():
        datasets[name] = [float(value) for value in figure.store.values(name)]
    return {
        "schema": "netlab-plotkit-export/1",
        "plot_spec_version": figure.to_spec().get("spec_version"),
        "spec": figure.to_spec(),
        "datasets": datasets,
    }


def _csv_text(entries: Sequence[ExportEntry]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "state_label",
            "state_id",
            "result_id",
            "kind",
            "curve_id",
            "curve_label",
            "x_axis",
            "x_unit",
            "y_axis",
            "y_unit",
            "x",
            "y",
        ]
    )
    for entry in entries:
        axis_ids = _axis_index(entry.envelope)
        for curve in entry.envelope.get("curves") or []:
            axes = curve.get("axes") or []
            if len(axes) < 2:
                continue
            x_axis, y_axis = str(axes[0]), str(axes[1])
            x_meta = axis_ids.get(x_axis) or {}
            y_meta = axis_ids.get(y_axis) or {}
            for x_value, y_value in zip(curve.get("x") or [], curve.get("y") or []):
                writer.writerow(
                    [
                        entry.state_label,
                        entry.state_id,
                        entry.result_id,
                        entry.kind,
                        curve.get("id"),
                        curve.get("label"),
                        x_axis,
                        x_meta.get("unit") or "",
                        y_axis,
                        y_meta.get("unit") or "",
                        repr(float(x_value)),
                        repr(float(y_value)),
                    ]
                )
    return buffer.getvalue()


def manifest(
    entries: Sequence[ExportEntry],
    *,
    session_id: str,
    scene_fingerprint: str,
    scene_revision: int,
    layout: Mapping[str, Any] | None,
    source_path: str | None,
    format: str,
) -> dict[str, Any]:
    markers: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    result_hashes: dict[str, str] = {}
    for entry in entries:
        payload = json.dumps(entry.envelope, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        result_hashes[entry.result_id] = sha256(payload.encode("utf-8")).hexdigest()
        for marker in entry.envelope.get("markers") or []:
            markers.append(
                {
                    "marker_id": marker.get("id"),
                    "label": marker.get("label"),
                    "shape": marker.get("shape"),
                    "category": marker.get("category"),
                    "state_id": entry.state_id,
                    "result_id": entry.result_id,
                }
            )
        if entry.stale:
            warnings.append(
                {
                    "code": "result_stale",
                    "severity": "warning",
                    "message": entry.stale_reason or "结果已过期",
                    "result_id": entry.result_id,
                }
            )
        for item in entry.envelope.get("warnings") or []:
            if isinstance(item, Mapping):
                warnings.append(dict(item))
    grid = dict(layout or {}).get("grid") if isinstance(layout, Mapping) else None
    if not isinstance(grid, Mapping):
        grid = {"rows": 1, "cols": 1}
    return {
        "schema": EXPORT_SCHEMA,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "session_id": session_id,
        "scene_fingerprint": scene_fingerprint,
        "scene_revision": int(scene_revision),
        "state_ids": list(dict.fromkeys(entry.state_id for entry in entries)),
        "result_hashes": result_hashes,
        "source": {
            "path": source_path or None,
            "network": (entries[0].envelope.get("source") or {}).get("network") if entries else None,
        },
        "netlab_version": _version("netlab"),
        "plotkit_version": _version("plotkit"),
        "grid": dict(grid),
        "markers": markers,
        "warnings": warnings,
        "format": format,
    }


def _scene_fingerprint(entries: Sequence[ExportEntry], states: Mapping[str, Any]) -> str:
    import hashlib

    state_ids = list(dict.fromkeys(entry.state_id for entry in entries))
    fingerprints = [str(states[state_id].fingerprint) for state_id in state_ids if state_id in states]
    return hashlib.sha256("|".join(sorted(fingerprints)).encode("utf-8")).hexdigest()


def _plotkit_save(figure: Any, fmt: str) -> bytes:
    with tempfile.TemporaryDirectory(prefix="netlab-export-") as tmp:
        target = Path(tmp) / f"analysis.{fmt}"
        figure.savefig(target)
        return target.read_bytes()


def export_session(
    session: Any,
    *,
    format: str,
    result_ids: Iterable[str] | None = None,
    state_ids: Iterable[str] | None = None,
    kind: str | None = None,
    layout: Mapping[str, Any] | None = None,
    source_path: str | None = None,
    title: str | None = None,
) -> ExportArtifact:
    """解析会话缓存并生成导出文件。"""
    fmt = _require_format(format)
    wanted_keys = [str(key) for key in (result_ids or []) if str(key).strip()]
    wanted_states = [str(item) for item in (state_ids or []) if str(item).strip()]
    if len(wanted_states) > MAX_STATES:
        raise ValidationError(f"一次最多导出 {MAX_STATES} 个状态")

    entries: list[ExportEntry] = []
    if wanted_keys:
        available = {item.key: item for item in session.cached_results()}
        missing = [key for key in wanted_keys if key not in available]
        if missing:
            raise NotFoundError(f"分析结果不存在或已被淘汰：{', '.join(missing[:3])}")
        selected = [available[key] for key in wanted_keys]
    else:
        target_states = wanted_states or ([session.active_state_id] if session.active_state_id else [])
        if not target_states:
            raise ValidationError("会话里没有可导出的状态")
        selected = session.cached_results(
            state_ids=target_states,
            kinds=[kind] if kind else None,
        )
        if not selected:
            raise ValidationError("所选状态尚无分析结果，请先运行分析再导出")
        wanted_kinds = {item.kind for item in selected}
        selected = [item for item in selected if item.kind == (kind or sorted(wanted_kinds)[0])]

    for item in selected[:64]:
        envelope = (item.result or {}).get("envelope")
        if not isinstance(envelope, Mapping):
            continue
        state = session.get_state(item.state_id)
        entries.append(
            ExportEntry(
                result_id=item.key,
                state_id=item.state_id,
                state_label=state.label,
                kind=str(item.kind),
                envelope=dict(envelope),
                fingerprint=(item.result or {}).get("fingerprint"),
                generated_at=item.generated_at,
                stale=bool(item.stale),
                stale_reason=item.stale_reason,
            )
        )
    if not entries:
        raise ValidationError("缓存结果里没有可导出的结果信封")

    kinds = {entry.kind for entry in entries}
    if len(kinds) > 1 and fmt in ("png", "svg", "pdf", "spec"):
        raise ValidationError(f"一次只能导出同一种分析类型（当前包含 {'/'.join(sorted(kinds))}）")

    states = {state.state_id: state for state in session.states.values()}
    scene_fingerprint = _scene_fingerprint(entries, states)
    info = manifest(
        entries,
        session_id=session.session_id,
        scene_fingerprint=scene_fingerprint,
        scene_revision=session.revision,
        layout=layout,
        source_path=source_path,
        format=fmt,
    )
    stamp = time.strftime("%Y%m%d-%H%M%S")
    base = f"netlab-analysis-{stamp}"
    if fmt == "json":
        body = {
            "schema": EXPORT_SCHEMA,
            "manifest": info,
            "results": [
                {
                    "result_id": entry.result_id,
                    "state_id": entry.state_id,
                    "state_label": entry.state_label,
                    "kind": entry.kind,
                    "envelope": entry.envelope,
                }
                for entry in entries
            ],
        }
        return ExportArtifact(f"{base}.json", MEDIA_TYPES[fmt], json.dumps(body, ensure_ascii=False, indent=2).encode("utf-8"))
    if fmt == "csv":
        return ExportArtifact(f"{base}.csv", MEDIA_TYPES[fmt], _csv_text(entries).encode("utf-8-sig"))
    if fmt == "zip":
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("manifest.json", json.dumps(info, ensure_ascii=False, indent=2))
            archive.writestr("curves.csv", _csv_text(entries))
            archive.writestr(
                "results.json",
                json.dumps(
                    [
                        {
                            "result_id": entry.result_id,
                            "state_id": entry.state_id,
                            "kind": entry.kind,
                            "envelope": entry.envelope,
                        }
                        for entry in entries
                    ],
                    ensure_ascii=False,
                    indent=2,
                ),
            )
            try:
                figure = build_figure(entries, title=title)
            except Exception as exc:  # PlotKit 不可用时不阻断数据包
                archive.writestr("errors.txt", f"PlotKit spec 生成失败：{exc}")
            else:
                archive.writestr(
                    "plot_spec.json",
                    json.dumps(plot_spec_payload(figure), ensure_ascii=False, indent=2),
                )
        return ExportArtifact(f"{base}.zip", MEDIA_TYPES[fmt], buffer.getvalue())

    figure = build_figure(entries, title=title)
    if fmt == "spec":
        payload = plot_spec_payload(figure)
        return ExportArtifact(
            f"{base}.plotkit.json",
            MEDIA_TYPES[fmt],
            json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8"),
        )
    data = _plotkit_save(figure, fmt)
    return ExportArtifact(f"{base}.{fmt}", MEDIA_TYPES[fmt], data)
