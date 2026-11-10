"""R26 前端入口护栏：DC 工作点 / AC 扫频 / 小信号旁路必须能从界面发起。"""

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
    # 三个页签
    assert 'data-anal="op"' in html and 'data-anal="ac"' in html
    assert 'data-anal="bypass"' in html


def test_index_has_circuit_bypass_controls() -> None:
    html = _read("index.html")
    for element_id in (
        "analBypassInput",
        "analBypassOutput",
        "analBypassDt",
        "analBypassDuration",
        "analRunBypass",
        "analRunBypassBode",
        "analBypassBode",
        "analBypassStep",
        "analBypassPoles",
        "analBypassZeros",
    ):
        assert f'id="{element_id}"' in html
    assert "非录波后处理" in html


def test_app_calls_solver_analysis_endpoints() -> None:
    js = _read("app.ts") + "\n" + _read("app/ac_analysis.ts")
    assert "/api/operating-point" in js
    assert "/api/ac-sweep" in js
    assert "/api/analysis/tf" in js
    assert "function openAnalysis(" in js
    assert "function runOperatingPoint(" in js
    assert "function runAcSweep(" in js
    assert "function fillBypassSources(" in js
    assert "function drawBypassBode(" in js
    assert "function drawBypassStep(" in js
    assert "function runCircuitBypass(" in js
    # 菜单入口
    assert "DC 工作点（.op）" in js
    assert "AC 扫频（Bode）" in js
    assert "小信号分析（旁路）" in js
