"""R26 前端入口护栏：DC 工作点 / AC 扫频必须能从界面发起（2026-11-02）。"""

from pathlib import Path

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"


def _read(name: str) -> str:
    return (FRONTEND / name).read_text(encoding="utf-8")


def test_index_has_analysis_window() -> None:
    html = _read("index.html")
    assert 'id="analWin"' in html
    assert 'id="analRunOp"' in html
    assert 'id="analRunAc"' in html
    assert 'id="analAcCanvas"' in html
    # 两个页签
    assert 'data-anal="op"' in html and 'data-anal="ac"' in html


def test_app_calls_solver_analysis_endpoints() -> None:
    js = _read("app.ts")
    assert "/api/operating-point" in js
    assert "/api/ac-sweep" in js
    assert "function openAnalysis(" in js
    assert "function runOperatingPoint(" in js
    assert "function runAcSweep(" in js
    # 菜单入口
    assert "DC 工作点（.op）" in js
    assert "AC 扫频（Bode）" in js


def test_ac_probe_defaults_skip_ground() -> None:
    """ground 节点不能作为 AC 探针（后端会报「AC 探针不存在」）。"""
    js = _read("app.ts")
    start = js.index("const probeNames =")
    block = js[start : start + 400]
    assert "node.kind === 'node'" in block
    assert "ground" not in block
