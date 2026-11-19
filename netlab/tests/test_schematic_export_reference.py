"""S7：视觉对照页与人工签收材料的静态检查。"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

pytest.importorskip("schemdraw")

from netlab.core.compute.schematic_symbols import supported_kinds

DOCS = Path(__file__).parent.parent.parent / "docs" / "schematic_reference"


def test_symbol_contact_sheet_covers_every_supported_kind_and_style():
    text = (DOCS / "symbol_contact_sheet.html").read_text(encoding="utf-8")
    for kind in supported_kinds():
        assert f'<td class="kind">{kind}</td>' in text
    assert "GB 风格" in text and "Classic 风格" in text
    assert text.count("<svg ") == len(supported_kinds()) * 2


def test_acceptance_page_embeds_both_full_fixture_drawings():
    text = (DOCS / "acceptance.html").read_text(encoding="utf-8")
    assert "bridge_rectifier.svg" in text
    assert "two_bjt_regulator.svg" in text
    assert "人工签收" in text
    for name in ("bridge_rectifier", "two_bjt_regulator"):
        svg = (DOCS / f"{name}.svg").read_text(encoding="utf-8")
        root = ET.fromstring(svg.encode("utf-8"))
        assert root.tag.rsplit("}", 1)[-1] == "svg"
        assert root.attrib.get("viewBox")
        assert 'id="netlab-structure"' in svg
