"""分析工作台布局（`ui.analysis_workbench`）的 schema、默认值与规范化。

D9（2026-11-19 电路分析工作台规格）：工程文件持有工作台布局，随工程走；
PROJECT_VERSION 7→8 时旧工程补默认空布局。本模块只做纯数据校验，不碰 UI 与仿真。

v2（2026-11-21 布局优化）：布局由全局 grid/tile/split/max 模式升级为
Tab → SplitTree → Leaf 两级模型；旧 schema /1 在读取时自动迁移到 /2。
"""

from __future__ import annotations

import copy
from typing import Any

from ..common.limits import ValidationError, json_safe

ANALYSIS_WORKBENCH_SCHEMA = "netlab-analysis-workbench/2"
LEGACY_ANALYSIS_WORKBENCH_SCHEMA = "netlab-analysis-workbench/1"
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
LAYOUT_RATIO_RANGE = (0.15, 0.85)
# 工作台布局是递归的 Tab→SplitTree→Leaf 树，ui 整体允许比普通数据更深的嵌套；
# 但仍设置上限，防止恶意构造的深层对象拖垮校验。
UI_JSON_MAX_DEPTH = 32


def default_analysis_workbench() -> dict[str, Any]:
    """工作台默认布局：无子窗口、空标签页、标准侧栏宽度。"""
    return {
        "schema": ANALYSIS_WORKBENCH_SCHEMA,
        "active_analysis": "bode",
        "canvases": [],
        "layout": {"tabs": [], "activeTab": ""},
        "sizes": {"sidebar": 280, "detail": 320},
        "collapsed": {"sidebar": False, "detail": False},
        "selected_state_ids": [],
    }


def _bounded_int(value: Any, *, field: str, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise ValidationError(f"{field} 必须是 {low}–{high} 的整数")
    return value


def _balanced_root(ids: list[str], axis: str) -> dict[str, Any] | None:
    """把画布 id 列表组织成平衡 split 树；单元素直接返回 canvas 叶子。"""
    if not ids:
        return None
    if len(ids) == 1:
        return {"type": "canvas", "canvasId": ids[0]}
    mid = (len(ids) + 1) // 2
    first = _balanced_root(ids[:mid], axis)
    second = _balanced_root(ids[mid:], axis)
    assert first is not None and second is not None
    return {
        "type": "split",
        "axis": axis,
        "ratio": 0.5,
        "first": first,
        "second": second,
    }


def _migrate_v1_layout(layout: Any, canvas_ids: list[str]) -> dict[str, Any]:
    """旧 mode/rows/cols/order → 单标签页 v2 树。"""
    source = copy.deepcopy(layout) if isinstance(layout, dict) else {}
    order = source.get("order", [])
    if not isinstance(order, list) or any(not isinstance(entry, str) for entry in order):
        order = []
    ids = [entry for entry in order if entry in canvas_ids]
    if not ids:
        ids = list(canvas_ids)
    if not ids:
        return {"tabs": [], "activeTab": ""}
    mode = source.get("mode", "grid")
    if mode in ("grid", "tile", "max"):
        root: dict[str, Any] = {"type": "auto", "canvasIds": ids}
    else:
        root = _balanced_root(ids, "row")
        assert root is not None
    return {
        "tabs": [{"id": "tab-1", "title": "主视图", "root": root}],
        "activeTab": "tab-1",
    }


def _normalize_layout_node(
    value: Any,
    *,
    valid_canvases: set[str],
    used: set[str],
    field: str,
    allow_tabs: bool = True,
) -> dict[str, Any]:
    """校验一个 LayoutNode，返回深拷贝；同一画布只允许出现在树中一次。"""
    if not isinstance(value, dict):
        raise ValidationError(f"{field} 必须是布局节点对象")
    node = copy.deepcopy(value)
    node_type = node.get("type")
    if node_type == "canvas":
        canvas_id = node.get("canvasId")
        if not isinstance(canvas_id, str) or not canvas_id:
            raise ValidationError(f"{field}.canvasId 必须是非空字符串")
        if canvas_id not in valid_canvases:
            raise ValidationError(f"{field} 引用了不存在的子窗口：{canvas_id}")
        if canvas_id in used:
            raise ValidationError(f"同一子窗口在布局树中重复：{canvas_id}")
        used.add(canvas_id)
        node["canvasId"] = canvas_id
        return node
    if node_type == "split":
        axis = node.get("axis")
        if axis not in ("row", "column"):
            raise ValidationError(f"{field}.axis 必须是 row/column")
        ratio = node.get("ratio", 0.5)
        if isinstance(ratio, bool) or not isinstance(ratio, (int, float)):
            raise ValidationError(f"{field}.ratio 必须是数字")
        low, high = LAYOUT_RATIO_RANGE
        if not low <= float(ratio) <= high:
            raise ValidationError(f"{field}.ratio 必须在 {low}–{high} 之间")
        node["axis"] = axis
        node["ratio"] = float(ratio)
        node["first"] = _normalize_layout_node(
            node.get("first"), valid_canvases=valid_canvases, used=used, field=f"{field}.first", allow_tabs=allow_tabs
        )
        node["second"] = _normalize_layout_node(
            node.get("second"), valid_canvases=valid_canvases, used=used, field=f"{field}.second", allow_tabs=allow_tabs
        )
        return node
    if node_type == "tabs":
        if not allow_tabs:
            raise ValidationError(f"{field} 不允许嵌套标签页")
        children = node.get("children")
        if not isinstance(children, list) or not children:
            raise ValidationError(f"{field}.children 必须是非空数组")
        normalized_children: list[dict[str, Any]] = []
        for index, child in enumerate(children):
            if not isinstance(child, dict) or child.get("type") != "canvas":
                raise ValidationError(f"{field}.children[{index}] 必须是 canvas 叶子")
            normalized_children.append(
                _normalize_layout_node(
                    child,
                    valid_canvases=valid_canvases,
                    used=used,
                    field=f"{field}.children[{index}]",
                    allow_tabs=False,
                )
            )
        active = node.get("active")
        child_ids = [child["canvasId"] for child in normalized_children]
        if not isinstance(active, str) or active not in child_ids:
            active = child_ids[0]
        node["active"] = active
        node["children"] = normalized_children
        return node
    if node_type == "auto":
        raw_ids = node.get("canvasIds")
        if not isinstance(raw_ids, list) or not raw_ids:
            raise ValidationError(f"{field}.canvasIds 必须是非空数组")
        ids: list[str] = []
        for index, canvas_id in enumerate(raw_ids):
            if not isinstance(canvas_id, str) or not canvas_id:
                raise ValidationError(f"{field}.canvasIds[{index}] 必须是非空字符串")
            if canvas_id not in valid_canvases:
                raise ValidationError(f"{field} 引用了不存在的子窗口：{canvas_id}")
            if canvas_id in used:
                raise ValidationError(f"同一子窗口在布局树中重复：{canvas_id}")
            used.add(canvas_id)
            ids.append(canvas_id)
        node["canvasIds"] = ids
        return node
    raise ValidationError(f"{field}.type 必须是 canvas/split/tabs/auto")


def _normalize_v2_layout(layout: Any, canvas_ids: list[str]) -> dict[str, Any]:
    if not isinstance(layout, dict):
        raise ValidationError("analysis_workbench.layout 必须是对象")
    result = copy.deepcopy(layout)
    valid = set(canvas_ids)
    used: set[str] = set()
    raw_tabs = result.get("tabs")
    if not isinstance(raw_tabs, list):
        raw_tabs = []
    tabs: list[dict[str, Any]] = []
    seen_tab_ids: set[str] = set()
    for index, raw_tab in enumerate(raw_tabs):
        if not isinstance(raw_tab, dict):
            raise ValidationError(f"layout.tabs[{index}] 必须是对象")
        tab = copy.deepcopy(raw_tab)
        tab_id = tab.get("id")
        if not isinstance(tab_id, str) or not tab_id:
            tab_id = f"tab-{index + 1}"
        if tab_id in seen_tab_ids:
            raise ValidationError(f"layout.tabs 的 id 重复：{tab_id}")
        title = tab.get("title")
        if not isinstance(title, str) or not title:
            title = f"视图 {index + 1}"
        root = _normalize_layout_node(
            tab.get("root"), valid_canvases=valid, used=used, field=f"layout.tabs[{index}].root"
        )
        seen_tab_ids.add(tab_id)
        tab["id"] = tab_id
        tab["title"] = title
        tab["root"] = root
        tabs.append(tab)
    missing = [canvas_id for canvas_id in canvas_ids if canvas_id not in used]
    if missing:
        if tabs:
            last = tabs[-1]
            root = last["root"]
            if root.get("type") == "auto":
                root["canvasIds"] = list(root.get("canvasIds", [])) + missing
            elif root.get("type") == "tabs":
                root["children"] = list(root.get("children", [])) + [
                    {"type": "canvas", "canvasId": canvas_id} for canvas_id in missing
                ]
            else:
                last["root"] = {
                    "type": "split",
                    "axis": "row",
                    "ratio": 0.7,
                    "first": root,
                    "second": {"type": "auto", "canvasIds": missing},
                }
        else:
            tabs = [{"id": "tab-1", "title": "主视图", "root": {"type": "auto", "canvasIds": missing}}]
    if not tabs:
        return {"tabs": [], "activeTab": ""}
    active_tab = result.get("activeTab")
    if not isinstance(active_tab, str) or not any(tab["id"] == active_tab for tab in tabs):
        active_tab = tabs[0]["id"]
    result["tabs"] = tabs
    result["activeTab"] = active_tab
    return result


def normalize_analysis_workbench(value: Any) -> dict[str, Any]:
    """校验并规范化 `ui.analysis_workbench`，返回新对象，不修改入参。

    schema /1（mode/rows/cols/order）自动迁移到 /2；缺省/空对象 → 默认布局；
    已有字段做类型、取值范围、重复 id 校验；未知键原样保留（向前兼容）。
    错误一律抛 ValidationError（fail-closed）。
    """
    if value is None:
        return default_analysis_workbench()
    if not isinstance(value, dict):
        raise ValidationError("工程的 ui.analysis_workbench 必须是对象")
    workbench = copy.deepcopy(value)
    schema = workbench.get("schema", ANALYSIS_WORKBENCH_SCHEMA)
    if schema not in (ANALYSIS_WORKBENCH_SCHEMA, LEGACY_ANALYSIS_WORKBENCH_SCHEMA):
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
    if schema == LEGACY_ANALYSIS_WORKBENCH_SCHEMA or (
        isinstance(layout, dict) and "tabs" not in layout
    ):
        workbench["layout"] = _migrate_v1_layout(layout, [c["canvas_id"] for c in normalized])
    else:
        workbench["layout"] = _normalize_v2_layout(layout, [c["canvas_id"] for c in normalized])

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

    collapsed = workbench.get("collapsed", {})
    if not isinstance(collapsed, dict):
        raise ValidationError("analysis_workbench.collapsed 必须是对象")
    workbench["collapsed"] = {
        "sidebar": collapsed.get("sidebar") is True,
        "detail": collapsed.get("detail") is True,
    }

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
    data = json_safe(ui or {}, where="界面设置", max_depth=UI_JSON_MAX_DEPTH)
    if not isinstance(data, dict):
        raise ValidationError("工程的 ui 必须是对象")
    data["analysis_workbench"] = normalize_analysis_workbench(data.get("analysis_workbench"))
    return data
