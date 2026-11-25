"""D11 前端入口护栏：电路分析统一工作台，旧 Canvas 分析图已退役。"""
from pathlib import Path

from netlab.tests.frontend_sources import read_frontend_ts

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"


def _read(name: str) -> str:
    return (FRONTEND / name).read_text(encoding="utf-8")


def test_index_has_unified_analysis_window() -> None:
    html = _read("index.html")
    assert 'id="analWin"' in html
    assert 'id="analRunOp"' in html
    assert 'id="analWorkbench"' in html
    assert 'data-anal="op"' in html and 'data-anal="workbench"' in html
    for legacy in (
        "analRunAc",
        "analAcCanvas",
        "analRunBypass",
        "analRunBypassBode",
        "analBypassBode",
        "analBypassStep",
    ):
        assert f'id="{legacy}"' not in html, f"旧分析控件 {legacy} 应已退役"


def test_index_no_legacy_canvas_controls() -> None:
    html = _read("index.html")
    assert "DC 工作点" in html
    assert "分析工作台" in html
    assert "非录波后处理" not in html
    assert "基于 DC 工作点线性化" not in html


def test_app_calls_workbench_endpoints() -> None:
    js = read_frontend_ts()
    for endpoint in (
        "/api/operating-point",
        "/api/analysis/tf",
        "/api/analysis/loop",
        "/api/analysis/nyquist",
        "/api/analysis/workbench/sessions",
        "/api/analysis/workbench/run",
    ):
        assert endpoint in js, f"缺少分析端点 {endpoint}"
    for fn in (
        "function openAnalysis(",
        "function runOperatingPoint(",
        "function openAnalysisWorkbench(",
        "function createAnalysisChart(",
        "function niceAxisTicks(",
    ):
        assert fn in js, f"缺少入口函数 {fn}"
    for retired in (
        "function drawAcChart(",
        "function drawBypassBode(",
        "function drawBypassStep(",
        "function runCircuitBypass(",
    ):
        assert retired not in js, f"旧 Canvas 入口 {retired} 应已删除"
    assert "电路分析工作台" in js
    assert "DC 工作点（.op）" in js
    assert "PlotKit 渲染内核" in js
