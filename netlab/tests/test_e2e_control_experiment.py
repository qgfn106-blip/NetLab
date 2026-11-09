"""D-4 端到端验收：一条命令全链路 + 变异体必须变红。"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "tools" / "e2e_control_experiment.py"


def _run(out_dir: Path, *extra: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--steps", "1200", "--dt", "0.01", "--out", str(out_dir), *extra],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )


def test_e2e_control_experiment_green(tmp_path: Path) -> None:
    result = _run(tmp_path)
    assert result.returncode == 0, result.stdout + result.stderr
    table = json.loads((tmp_path / "error_table.json").read_text(encoding="utf-8"))
    assert table["pass"] is True
    assert table["head"]
    assert {row["metric"] for row in table["rows"]} == {"final", "overshoot_pct", "settling_2pct_s"}
    for name in ("underdamped_control.netlab", "step_response.csv", "step_response.svg", "plot_spec.json"):
        assert (tmp_path / name).is_file(), name
    spec = json.loads((tmp_path / "plot_spec.json").read_text(encoding="utf-8"))
    assert spec["spec_version"] == "0.1"
    assert spec["layers"]


def test_e2e_control_experiment_mutation_turns_red(tmp_path: Path) -> None:
    result = _run(tmp_path, "--plant-scale", "1.05")
    assert result.returncode != 0, result.stdout + result.stderr
    table = json.loads((tmp_path / "error_table.json").read_text(encoding="utf-8"))
    assert table["pass"] is False
    assert any(not row["pass"] for row in table["rows"])
