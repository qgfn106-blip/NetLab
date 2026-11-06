"""前端右键菜单结构（静态契约）。

浏览器 DOM 不在 pytest 里跑；这里锁住「信号流添加菜单按 catalog 分组」的关键
源码结构，防止后续重构把分类又拉平成一大串。
"""

from __future__ import annotations

from pathlib import Path

APP_JS = Path(__file__).resolve().parents[2] / "frontend" / "app.ts"


def _build_add_menu_body() -> str:
    source = APP_JS.read_text(encoding="utf-8")
    start = source.index("  function buildAddMenuItems")
    end = source.index("  function openAddMenu", start)
    return source[start:end]


def test_signal_add_menu_groups_compute_nodes_by_catalog_group():
    source = APP_JS.read_text(encoding="utf-8")
    body = _build_add_menu_body()

    assert (
        "const COMPUTE_GROUP_ORDER = ['基础', '动态', '高级', '矢量', '模块', '接口'];"
        in source
    )
    assert "if (state.mode !== 'circuit')" in body
    assert "const group = String(spec.group || '未分类');" in body
    assert "label: `节点 · ${group}`" in body
    assert "children: specs.map((spec: SpecRec) => ({" in body
    assert "action: () => addNodeAt(spec.kind, placeX, placeY)" in body


def test_vector_add_menu_puts_vector_group_first():
    body = _build_add_menu_body()

    assert (
        "['矢量', ...COMPUTE_GROUP_ORDER.filter((group: string) => group !== '矢量')]"
        in body
    )
