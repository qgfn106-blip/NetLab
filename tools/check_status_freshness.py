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

_STATUS_ONLY_PATHS = {
    "netlab/docs/status.json",
    "reports/test_status.json",
    "tools/check_status_freshness.py",
}

def _status_artifact(path: str) -> bool:
    return path in _STATUS_ONLY_PATHS or path.startswith("reports/shadow/")

def _effective_head() -> str:
    """HEAD, walking back over trailing status-only commits.

    A committed status.json cannot name the commit that contains it (self-reference),
    so status.head/test_status.head refer to the last code commit covered by the test
    run. Only commits touching the status artifacts may trail that commit.
    """
    head = _git("rev-parse", "HEAD")
    while True:
        parent = _git("rev-parse", "--verify", f"{head}^")
        if not parent:
            return head
        changed = {line for line in _git("diff", "--name-only", parent, head).splitlines() if line}
        if changed and all(_status_artifact(p) for p in changed):
            head = parent
            continue
        return head

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--status", default=str(STATUS))
    ap.add_argument("--test-report", default=str(TEST_REPORT))
    args = ap.parse_args(argv)
    errors: list[str] = []
    status = json.loads(Path(args.status).read_text(encoding="utf-8"))
    head = _git("rev-parse", "HEAD")
    tested_head = _effective_head()
    if status.get("git", {}).get("head") != tested_head:
        errors.append(f"status.git.head={status.get('git',{}).get('head')} != tested HEAD={tested_head}")
    generated = status.get("generated_at")
    last_commit = _git("log", "-1", "--format=%cI", tested_head)
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
        if report.get("head") != tested_head:
            errors.append(f"test_status.head={report.get('head')} != tested HEAD={tested_head}")
        if report.get("failed") not in (0, None):
            errors.append(f"test_status.failed={report.get('failed')}")
    if errors:
        print("FAIL: status freshness")
        for e in errors:
            print(" -", e)
        return 1
    print(f"OK: status fresh at {tested_head}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
