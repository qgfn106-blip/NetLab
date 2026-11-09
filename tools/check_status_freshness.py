#!/usr/bin/env python3
"""B-3：status.json 新鲜度门（生成物绿、事实源腐烂的防线）。"""
from __future__ import annotations
import argparse, json, subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATUS = ROOT / "netlab" / "docs" / "status.json"
TEST_REPORT = ROOT / "reports" / "test_status.json"

def _git(*a: str) -> str:
    return subprocess.run(["git", *a], cwd=ROOT, capture_output=True, text=True).stdout.strip()

def _dt(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--status", default=str(STATUS))
    ap.add_argument("--test-report", default=str(TEST_REPORT))
    args = ap.parse_args(argv)
    errors: list[str] = []
    status = json.loads(Path(args.status).read_text(encoding="utf-8"))
    head = _git("rev-parse", "HEAD")
    if status.get("git", {}).get("head") != head:
        errors.append(f"status.git.head={status.get('git',{}).get('head')} != HEAD={head}")
    generated = status.get("generated_at")
    last_commit = _git("log", "-1", "--format=%cI")
    if not generated:
        errors.append("status.generated_at missing")
    elif last_commit and _dt(generated) < _dt(last_commit):
        errors.append(f"status.generated_at={generated} < last commit {last_commit}")
    tests = status.get("tests", {})
    for key in ("passed", "skipped", "failed", "duration_s"):
        if tests.get(key) is None:
            errors.append(f"status.tests.{key} is null")
    if tests.get("source") != "reports/test_status.json":
        errors.append(f"status.tests.source={tests.get('source')!r} not reports/test_status.json")
    report_path = Path(args.test_report)
    if not report_path.is_file():
        errors.append(f"missing {report_path}")
    else:
        report = json.loads(report_path.read_text(encoding="utf-8"))
        if report.get("head") != head:
            errors.append(f"test_status.head={report.get('head')} != HEAD={head}")
        if report.get("failed") not in (0, None):
            errors.append(f"test_status.failed={report.get('failed')}")
    if errors:
        print("FAIL: status freshness")
        for e in errors:
            print(" -", e)
        return 1
    print(f"OK: status fresh at {head}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
