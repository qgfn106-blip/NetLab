"""G1 架构契约：A1 依赖方向、A2 无新增环、A3 可变全局、A6 冷启动。"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _run_checker(tmp_path: Path) -> dict:
    out = tmp_path / "architecture.json"
    proc = subprocess.run(
        [sys.executable, "tools/check_architecture.py", "--json", str(out)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=180,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    return json.loads(out.read_text(encoding="utf-8"))


def test_architecture_contracts_pass(tmp_path: Path) -> None:
    report = _run_checker(tmp_path)
    assert report["a1_violations"] == []
    assert report["a2_new_cycles"] == []
    assert report["a3_unlisted"] == []
    assert report["a6"]["loaded"] == []


def test_a2_baseline_is_documented() -> None:
    import yaml

    contract = yaml.safe_load((ROOT / "docs" / "contracts" / "layers.yaml").read_text(encoding="utf-8"))
    for item in contract.get("a2_cycle_baseline", []):
        assert item.get("reason")
        assert item.get("remove_by")
