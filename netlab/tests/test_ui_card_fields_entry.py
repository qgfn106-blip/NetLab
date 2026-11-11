"""R40 阶段 3：节点卡片自由字段编辑静态护栏。"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def test_card_fields_module_is_declarative_whitelist() -> None:
    source = _read("frontend/app/card_fields.ts")
    for marker in (
        "CARD_FIELDS",
        "CARD_FIELD_LABELS",
        "DEFAULT_CARD_FIELDS",
        "normalizeCardFields",
        "cardFieldOffsets",
        "isDefaultCardFields",
        "['kind', 'name', 'value', 'id']",
        "[-0.56, -0.06, 0.38]",
    ):
        assert marker in source, marker
    # 声明式白名单：不得执行任意 HTML/CSS/JS 或表达式
    for forbidden in ("eval(", "Function(", "innerHTML", "dangerouslySetInnerHTML"):
        assert forbidden not in source, forbidden


def test_backend_ui_profile_validates_card_fields() -> None:
    source = _read("netlab/core/model/ui_profile.py")
    for marker in (
        "CARD_FIELDS",
        "CARD_FIELD_LABELS",
        "DEFAULT_CARD_FIELDS",
        "_normalize_card_fields",
        "ui.node.card_fields 必须是字段数组",
        "未知节点卡片字段",
        "节点卡片字段重复",
        "节点卡片字段过多",
        '"card_fields": [',
        'section == "node" and key == "card_fields"',
    ):
        assert marker in source, marker


def test_card_fields_wired_through_frontend() -> None:
    app_ts = _read("frontend/app.ts")
    canvas = _read("frontend/app/canvas_nodes.ts")
    project = _read("frontend/app/project.ts")
    types = _read("frontend/app/types.ts")
    assert "normalizeCardFields" in app_ts
    assert "cardFieldOffsets" in canvas
    assert "cardFields.includes('kind')" in canvas
    assert "cardFields.includes('value')" in canvas
    assert "cardFields.includes('id')" in canvas
    assert "cardFields: normalizeCardFields(state.ui.cardFields)" in project
    assert "cardFields?: string[]" in types
    assert "dataset.cardField" in app_ts
    assert "dataset.cardMove" in app_ts
    assert "response.card_fields" in app_ts


def test_card_fields_e2e_registered() -> None:
    package = _read("frontend/package.json")
    assert "card_fields_ux.mjs" in package
    allowlist = _read("frontend/tools/parity_body_allowlist.json")
    for name in ("openViewDesigner", "applyProjectUi", "buildProjectPayload", "drawNodes"):
        assert name in allowlist, name
