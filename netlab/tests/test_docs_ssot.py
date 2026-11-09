"""G4 文档单一真源（docs/canonical → 生成段）的门禁测试。"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_canonical_counts() -> None:
    import yaml

    req = yaml.safe_load((ROOT / "docs" / "canonical" / "requirements.yaml").read_text(encoding="utf-8"))
    dec = yaml.safe_load((ROOT / "docs" / "canonical" / "decisions.yaml").read_text(encoding="utf-8"))
    assert len(req["requirements"]) == 43
    assert len(dec["decisions"]) >= 150


def test_render_docs_no_drift() -> None:
    result = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "render_docs.py"), "--check"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    assert result.returncode == 0, result.stdout + result.stderr
