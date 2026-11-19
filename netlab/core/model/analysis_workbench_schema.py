"""分析工作台布局（``ui.analysis_workbench``）的 schema、默认值与规范化。

D9（2026-11-19 电路分析工作台规格）：工程文件持有工作台布局，随工程走；
PROJECT_VERSION 7→8 时旧工程补默认空布局。本模块只做纯数据校验，不碰 UI 与仿真。
"""

from __future__ import annotations

import copy
from typing import Any

from ..common.limits import ValidationError, json_safe

ANALYSIS_WORKBENCH_SCHEMA = "netlab-analysis-workbench/1"
ANALYSIS_WORKBENCH_KINDS = (
    "bode",
    "time",
    "nyquist",
    "loop",
    "metrics",
    "poles",
    "loop_closed",
    "loop_step",
)
ANALYSIS_WORKBENCH_LAYOUT_MODES = ("grid", "tile", "split", "max")
SIDEBAR_RANGE = (160, 640)
DETAIL_RANGE = (200, 720)


def default_analysis_workbench() -> dict[str, Any]:
    """工作台默认布局：无子窗口、单格网格、标准侧栏宽度。"""
    return {
        "schema": ANALYSIS_WORKBENCH_SCHEMA,
        "active_analysis": "bode",
        "canvases": [],
        "layout": {"mode": "grid", "rows": 1, "cols": 1, "order": []},
        "sizes": {"sidebar": 280, "detail": 320},
        "selected_state_ids": [],
    }


def _bounded_int(value: Any, *, field: str, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise ValidationError(f"{field} 必须是 {low}–{high} 的整数")
    return value


def normalize_analysis_workbench(value: Any) -> dict[str, Any]:
    """校验并规范化 ``ui.analysis_workbench``，返回新对象，不修改入参。

    缺省/空对象 → 默认布局；已有字段做类型、取值范围、重复 id 校验；
    未知键原样保留（向前兼容）。错误一律抛 ValidationError（fail-closed）。
    """
    if value is None:
        return default_analysis_workbench()
    if not isinstance(value, dict):
        raise ValidationError("工程的 ui.analysis_workbench 必须是对象")
    workbench = copy.deepcopy(value)
    schema = workbench.get("schema", ANALYSIS_WORKBENCH_SCHEMA)
    if schema != ANALYSIS_WORKBENCH_SCHEMA:
        raise ValidationError(
            f"不支持的 analysis_workbench schema：{schema!r}（需要 {ANALYSIS_WORKBENCH_SCHEMA}）"
        )
    workbench["schema"] = ANALYSIS_WORKBENCH_SCHEMA

    active = workbench.get("active_analysis", "bode")
    if active not in ANALYSIS_WORKBENCH_KINDS:
        raise ValidationError(
            f"active_analysis 必须是 {ANALYSIS_WORKBENCH_KINDS} 之一"
        )
    workbench["active_analysis"] = active

    canvases = workbench.get("canvases", [])
    if not isinstance(canvases, list):
        raise ValidationError("analysis_workbench.canvases 必须是数组")
    seen: set[str] = set()
    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(canvases):
        if not isinstance(item, dict):
            raise ValidationError(f"第 {index + 1} 个子窗口必须是对象")
        canvas = copy.deepcopy(item)
        canvas_id = canvas.get("canvas_id")
        if not isinstance(canvas_id, str) or not canvas_id:
            raise ValidationError(f"第 {index + 1} 个子窗口缺少 canvas_id 字符串")
        if canvas_id in seen:
            raise ValidationError(f"子窗口 canvas_id 重复：{canvas_id}")
        seen.add(canvas_id)
        kind = canvas.get("kind")
        if kind not in ANALYSIS_WORKBENCH_KINDS:
            raise ValidationError(
                f"子窗口 {canvas_id!r} 的 kind 必须是 {ANALYSIS_WORKBENCH_KINDS} 之一"
            )
        canvas["kind"] = kind
        figure_id = canvas.get("figure_id")
        if not isinstance(figure_id, str) or not figure_id:
            raise ValidationError(f"子窗口 {canvas_id!r} 缺少 figure_id 字符串")
        slot_id = canvas.get("slot_id", index)
        if isinstance(slot_id, bool) or not isinstance(slot_id, int) or slot_id < 0:
            raise ValidationError(f"子窗口 {canvas_id!r} 的 slot_id 必须是非负整数")
        canvas["slot_id"] = slot_id
        normalized.append(canvas)
    workbench["canvases"] = normalized

    layout = workbench.get("layout", {})
    if not isinstance(layout, dict):
        raise ValidationError("analysis_workbench.layout 必须是对象")
    layout = copy.deepcopy(layout)
    mode = layout.get("mode", "grid")
    if mode not in ANALYSIS_WORKBENCH_LAYOUT_MODES:
        raise ValidationError(f"layout.mode 必须是 {ANALYSIS_WORKBENCH_LAYOUT_MODES} 之一")
    layout["mode"] = mode
    layout["rows"] = _bounded_int(layout.get("rows", 1), field="layout.rows", low=1, high=8)
    layout["cols"] = _bounded_int(layout.get("cols", 1), field="layout.cols", low=1, high=8)
    order = layout.get("order", [])
    if not isinstance(order, list) or any(not isinstance(entry, str) for entry in order):
        raise ValidationError("layout.order 必须是字符串数组")
    unknown = [entry for entry in order if entry not in seen]
    if unknown:
        raise ValidationError(f"layout.order 引用了不存在的子窗口：{unknown}")
    layout["order"] = list(order)
    workbench["layout"] = layout

    sizes = workbench.get("sizes", {})
    if not isinstance(sizes, dict):
        raise ValidationError("analysis_workbench.sizes 必须是对象")
    sizes = copy.deepcopy(sizes)
    sizes["sidebar"] = _bounded_int(
        sizes.get("sidebar", 280), field="sizes.sidebar", low=SIDEBAR_RANGE[0], high=SIDEBAR_RANGE[1]
    )
    sizes["detail"] = _bounded_int(
        sizes.get("detail", 320), field="sizes.detail", low=DETAIL_RANGE[0], high=DETAIL_RANGE[1]
    )
    workbench["sizes"] = sizes

    selected = workbench.get("selected_state_ids", [])
    if not isinstance(selected, list) or any(
        not isinstance(entry, str) or not entry for entry in selected
    ):
        raise ValidationError("selected_state_ids 必须是非空字符串数组")
    if len(set(selected)) != len(selected):
        raise ValidationError("selected_state_ids 不能重复")
    workbench["selected_state_ids"] = list(selected)
    return workbench


def ui_with_analysis_workbench(ui: Any) -> dict[str, Any]:
    """界面设置入库前补齐并规范化分析工作台布局。"""
    data = json_safe(ui or {}, where="界面设置")
    if not isinstance(data, dict):
        raise ValidationError("工程的 ui 必须是对象")
    data["analysis_workbench"] = normalize_analysis_workbench(data.get("analysis_workbench"))
    return data
