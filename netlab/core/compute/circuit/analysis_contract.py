"""分析结果契约 `netlab-analysis-result/1`。

后端所有频域/时域/稳定度分析最终都产出这个信封结构：坐标轴、曲线、关键点标记、
指标、告警与证据。前端只做选择、联动与展示，不再自己推导数值。

契约刻意保持"扁平且可校验"：
* 每条曲线引用已声明的坐标轴 id，长度必须一致；
* 所有数值必须是有限实数（复数走 `complex_curve` 拆成实部/虚部两条）；
* 标记点带分类与明细，前端仅按分类开关；
* `fingerprint` 由电路快照 + 分析参数哈希得到，用于缓存失效。
"""

from __future__ import annotations

import hashlib
import json
import math
import time
import uuid
from typing import Any, Iterable, Mapping, Sequence

import numpy as np

from ...common.limits import ComputeError, ValidationError

SCHEMA = "netlab-analysis-result/1"
MAX_CURVE_POINTS = 200_000

ANALYSIS_KINDS = frozenset({"bode", "time", "nyquist", "metrics"})
AXIS_SCALES = frozenset({"linear", "log10", "log"})
MARKER_SHAPES = frozenset(
    {
        "pole",
        "zero",
        "cross_gain",
        "cross_phase",
        "peak",
        "cutoff",
        "gm",
        "pm",
        "nyquist_crit",
    }
)
MARKER_CATEGORIES = frozenset({"stability", "response", "margin", "loop"})


def _as_finite(value: Any, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"{label} 必须是实数，收到 {value!r}") from exc
    if not math.isfinite(number):
        raise ValidationError(f"{label} 必须是有限实数，收到 {number!r}")
    return number


def _as_finite_list(values: Iterable[Any], label: str) -> list[float]:
    items = [_as_finite(value, f"{label}[{index}]") for index, value in enumerate(values)]
    if len(items) > MAX_CURVE_POINTS:
        raise ComputeError(f"{label} 点数 {len(items)} 超过上限 {MAX_CURVE_POINTS}")
    return items


def axis(
    axis_id: str,
    label: str,
    unit: str,
    values: Sequence[float],
    *,
    scale: str = "linear",
) -> dict[str, Any]:
    """声明一条坐标轴；频率轴用 `values=Hz` + `scale='log10'`。"""
    if not axis_id or not isinstance(axis_id, str):
        raise ValidationError("axis.id 必须是非空字符串")
    if scale not in AXIS_SCALES:
        raise ValidationError(f"未知坐标轴刻度 {scale!r}（允许 {sorted(AXIS_SCALES)}）")
    data = _as_finite_list(values, f"axis[{axis_id}]")
    if scale in {"log10", "log"} and any(item <= 0.0 for item in data):
        raise ValidationError(f"对数坐标轴 {axis_id!r} 的值必须大于 0")
    return {
        "id": axis_id,
        "label": str(label),
        "unit": str(unit),
        "scale": scale,
        "n": len(data),
        "values": data,
    }


def complex_axes(
    prefix: str,
    *,
    label: str,
    values: Sequence[complex],
    axis_x_label: str = "实部",
    axis_y_label: str = "虚部",
) -> tuple[dict[str, Any], dict[str, Any], list[float], list[float]]:
    """把复数序列拆成两条线性坐标轴（Nyquist 用）。"""
    real = [float(np.real(item)) for item in values]
    imag = [float(np.imag(item)) for item in values]
    x_axis = axis(f"{prefix}_re", axis_x_label, "", real, scale="linear")
    y_axis = axis(f"{prefix}_im", axis_y_label, "", imag, scale="linear")
    x_axis["label"] = label
    return x_axis, y_axis, real, imag


def curve(
    curve_id: str,
    *,
    label: str,
    x_axis: str,
    y_axis: str,
    x: Sequence[float],
    y: Sequence[float],
    style: str = "solid",
    category: str = "response",
    detail: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """一条二维曲线，必须引用已声明的两条坐标轴，且 x/y 等长。"""
    if not curve_id:
        raise ValidationError("curve.id 必须是非空字符串")
    xs = _as_finite_list(x, f"curve[{curve_id}].x")
    ys = _as_finite_list(y, f"curve[{curve_id}].y")
    if len(xs) != len(ys):
        raise ComputeError(
            f"曲线 {curve_id!r} 的 x/y 长度不一致：{len(xs)} != {len(ys)}"
        )
    return {
        "id": str(curve_id),
        "label": str(label),
        "axes": [str(x_axis), str(y_axis)],
        "style": str(style),
        "category": str(category),
        "n": len(xs),
        "x": xs,
        "y": ys,
        "detail": dict(detail or {}),
    }


def marker(
    marker_id: str,
    *,
    shape: str,
    x: float,
    y: float | None,
    label: str,
    category: str = "response",
    axis_x: str = "f",
    axis_y: str = "mag_db",
    detail: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """关键点标记；`detail` 供悬停展开（频率、幅值、相位、局部斜率等）。"""
    if shape not in MARKER_SHAPES:
        raise ValidationError(f"未知标记形状 {shape!r}（允许 {sorted(MARKER_SHAPES)}）")
    if category not in MARKER_CATEGORIES:
        raise ValidationError(f"未知标记分类 {category!r}（允许 {sorted(MARKER_CATEGORIES)}）")
    return {
        "id": str(marker_id),
        "shape": str(shape),
        "label": str(label),
        "category": str(category),
        "axis_x": str(axis_x),
        "axis_y": str(axis_y) if y is not None else None,
        "x": _as_finite(x, f"marker[{marker_id}].x"),
        "y": None if y is None else _as_finite(y, f"marker[{marker_id}].y"),
        "detail": _round_tree(dict(detail or {})),
    }


def warning(code: str, message: str, *, severity: str = "warning", **extra: Any) -> dict[str, Any]:
    if severity not in {"info", "warning", "error"}:
        raise ValidationError(f"未知告警级别 {severity!r}")
    payload = {"code": str(code), "message": str(message), "severity": severity}
    payload.update(_round_tree(dict(extra)))
    return payload


def envelope(
    kind: str,
    *,
    source: Mapping[str, Any],
    axes: Sequence[Mapping[str, Any]],
    curves: Sequence[Mapping[str, Any]],
    markers: Sequence[Mapping[str, Any]] = (),
    metrics: Mapping[str, Any] | None = None,
    warnings: Sequence[Mapping[str, Any]] = (),
    evidence: Mapping[str, Any] | None = None,
    fingerprint: str | None = None,
    analysis_id: str | None = None,
    generated_at: float | None = None,
) -> dict[str, Any]:
    """组装并校验完整信封。"""
    if kind not in ANALYSIS_KINDS:
        raise ValidationError(f"未知分析类型 {kind!r}（允许 {sorted(ANALYSIS_KINDS)}）")
    payload: dict[str, Any] = {
        "schema": SCHEMA,
        "analysis_id": analysis_id or uuid.uuid4().hex,
        "kind": kind,
        "generated_at": float(generated_at if generated_at is not None else time.time()),
        "source": _round_tree(dict(source)),
        "axes": [dict(item) for item in axes],
        "curves": [dict(item) for item in curves],
        "markers": [dict(item) for item in markers],
        "metrics": _round_tree(dict(metrics or {})),
        "warnings": [dict(item) for item in warnings],
        "evidence": _round_tree(dict(evidence or {})),
        "fingerprint": str(fingerprint or ""),
    }
    return validate_envelope(payload)


def validate_envelope(payload: Mapping[str, Any]) -> dict[str, Any]:
    """对外部输入的信封做结构校验；返回浅拷贝，便于测试。"""
    data = dict(payload)
    if data.get("schema") != SCHEMA:
        raise ValidationError(f"信封 schema 必须是 {SCHEMA!r}")
    if data.get("kind") not in ANALYSIS_KINDS:
        raise ValidationError("信封 kind 非法")
    axis_map: dict[str, dict[str, Any]] = {}
    axes = data.get("axes")
    if not isinstance(axes, list) or not axes:
        raise ValidationError("信封至少需要一条坐标轴")
    for item in axes:
        axis_id = item.get("id") if isinstance(item, dict) else None
        if not axis_id or axis_id in axis_map:
            raise ValidationError(f"坐标轴 id 缺失或重复：{axis_id!r}")
        values = item.get("values")
        if not isinstance(values, list):
            raise ValidationError(f"坐标轴 {axis_id!r} 缺少 values")
        _as_finite_list(values, f"axis[{axis_id}]")
        axis_map[str(axis_id)] = item

    curves = data.get("curves")
    if not isinstance(curves, list):
        raise ValidationError("信封缺少 curves 列表")
    curve_ids: set[str] = set()
    for item in curves:
        if not isinstance(item, dict):
            raise ValidationError("曲线必须是对象")
        curve_id = item.get("id")
        if not curve_id or curve_id in curve_ids:
            raise ValidationError(f"曲线 id 缺失或重复：{curve_id!r}")
        curve_ids.add(str(curve_id))
        axis_ids = item.get("axes")
        if not isinstance(axis_ids, list) or len(axis_ids) != 2:
            raise ValidationError(f"曲线 {curve_id!r} 必须引用两条坐标轴")
        for axis_id in axis_ids:
            if axis_id not in axis_map:
                raise ValidationError(f"曲线 {curve_id!r} 引用了未声明的坐标轴 {axis_id!r}")
        xs = _as_finite_list(item.get("x") or [], f"curve[{curve_id}].x")
        ys = _as_finite_list(item.get("y") or [], f"curve[{curve_id}].y")
        if len(xs) != len(ys):
            raise ValidationError(f"曲线 {curve_id!r} 的 x/y 长度不一致")

    markers = data.get("markers")
    if not isinstance(markers, list):
        raise ValidationError("信封缺少 markers 列表")
    marker_ids: set[str] = set()
    for item in markers:
        if not isinstance(item, dict):
            raise ValidationError("标记必须是对象")
        marker_id = item.get("id")
        if not marker_id or marker_id in marker_ids:
            raise ValidationError(f"标记 id 缺失或重复：{marker_id!r}")
        marker_ids.add(str(marker_id))
        if item.get("shape") not in MARKER_SHAPES:
            raise ValidationError(f"标记 {marker_id!r} 形状非法")
        if item.get("axis_x") not in axis_map:
            raise ValidationError(f"标记 {marker_id!r} 引用了未声明的 x 轴")
        if item.get("y") is not None and item.get("axis_y") not in axis_map:
            raise ValidationError(f"标记 {marker_id!r} 引用了未声明的 y 轴")
        _as_finite(item.get("x"), f"marker[{marker_id}].x")
        if item.get("y") is not None:
            _as_finite(item.get("y"), f"marker[{marker_id}].y")

    if not isinstance(data.get("warnings"), list):
        raise ValidationError("信封缺少 warnings 列表")
    if not isinstance(data.get("metrics"), dict):
        raise ValidationError("信封缺少 metrics 对象")
    fingerprint = data.get("fingerprint") or ""
    if fingerprint and (len(str(fingerprint)) != 64 or any(ch not in "0123456789abcdef" for ch in str(fingerprint))):
        raise ValidationError("fingerprint 必须是 64 位小写十六进制")
    return data


def canonical_json(payload: Any) -> str:
    """稳定序列化：排序键、紧凑分隔符、禁止 NaN。"""
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def fingerprint(payload: Any) -> str:
    """对任意可序列化对象做 sha256；用于分析缓存与失效。"""
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


def local_slope(
    x: Sequence[float],
    y: Sequence[float],
    index: int,
    *,
    window: int = 2,
    log_x: bool = True,
) -> float | None:
    """计算 `index` 处的局部斜率（log 频率轴默认输出 dB/dec）。

    采用居中窗口的最小二乘拟合：窗口内至少 3 点才能给出稳定斜率；
    越界或退化时返回 None，由调用方决定是否补点。
    """
    count = min(len(x), len(y))
    if count < 3:
        return None
    index = int(index)
    if index < 0 or index >= count:
        return None
    half = max(1, int(window))
    low = max(0, index - half)
    high = min(count - 1, index + half)
    if high - low + 1 < 3:
        return None
    xs = np.asarray([float(item) for item in x[low : high + 1]], dtype=float)
    ys = np.asarray([float(item) for item in y[low : high + 1]], dtype=float)
    if not np.all(np.isfinite(xs)) or not np.all(np.isfinite(ys)):
        return None
    if log_x:
        if np.any(xs <= 0.0):
            return None
        xs = np.log10(xs)
    span = float(xs.max() - xs.min())
    if span <= 0.0:
        return None
    xs = xs - xs.mean()
    ys = ys - ys.mean()
    denominator = float(np.dot(xs, xs))
    if denominator <= 0.0:
        return None
    return float(np.dot(xs, ys) / denominator)


def nearest_index(values: Sequence[float], target: float) -> int:
    """返回最接近 target 的下标；空序列报错。"""
    if not values:
        raise ComputeError("坐标轴为空，无法定位关键点")
    array = np.asarray([float(item) for item in values], dtype=float)
    return int(np.argmin(np.abs(array - float(target))))


def first_crossing(
    x: Sequence[float],
    y: Sequence[float],
    level: float,
    *,
    rising: bool = False,
) -> int | None:
    """线性插值定位首次穿越 level 的下标（返回穿越点右侧下标）。"""
    xs = np.asarray([float(item) for item in x], dtype=float)
    ys = np.asarray([float(item) for item in y], dtype=float)
    if xs.size < 2 or xs.size != ys.size:
        return None
    delta = ys - float(level)
    for index in range(1, xs.size):
        left, right = delta[index - 1], delta[index]
        if rising:
            if left <= 0.0 < right:
                return index
        else:
            if left >= 0.0 > right:
                return index
    return None


def _round_tree(value: Any, sig: int = 12) -> Any:
    """递归地把浮点数收敛到 sig 位有效数字，避免 JSON 里出现长尾。"""
    if isinstance(value, dict):
        return {str(key): _round_tree(item, sig) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_round_tree(item, sig) for item in value]
    if isinstance(value, (np.floating, float)):
        number = float(value)
        if not math.isfinite(number):
            return None
        return float(f"{number:.{sig}g}")
    if isinstance(value, (np.integer, int)) and not isinstance(value, bool):
        return int(value)
    if isinstance(value, np.bool_):
        return bool(value)
    return value
