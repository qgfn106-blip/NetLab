#!/usr/bin/env python3
"""把真实 pytest JUnit 与 coverage JSON 汇总为 reports/test_status.json。"""
from __future__ import annotations
import argparse, json, subprocess
from datetime import datetime, timezone
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent

def _git_head() -> str:
    return subprocess.run(["git","rev-parse","HEAD"],cwd=ROOT,capture_output=True,text=True).stdout.strip()

def _parse_junit(path: Path) -> dict:
    root = ET.parse(path).getroot()
    suites = [root] if root.tag == "testsuite" else list(root.iter("testsuite"))
    passed = skipped = failed = 0
    duration = 0.0
    for s in suites:
        tests = int(s.get("tests", 0)); sk = int(s.get("skipped", 0))
        fa = int(s.get("failures", 0)); er = int(s.get("errors", 0))
        skipped += sk; failed += fa + er
        passed += max(0, tests - sk - fa - er)
        duration += float(s.get("time", 0.0))
    return {"passed": passed, "skipped": skipped, "failed": failed, "duration_s": round(duration, 2)}

def _coverage(path: Path) -> float | None:
    if not path.is_file():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    totals = data.get("totals", {})
    percent = totals.get("percent_covered")
    return round(float(percent), 2) if percent is not None else None

def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--junit", required=True)
    p.add_argument("--coverage", default="coverage.json")
    p.add_argument("--command", required=True)
    p.add_argument("--out", default="reports/test_status.json")
    args = p.parse_args(argv)
    stats = _parse_junit(ROOT / args.junit)
    payload = {
        "created_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "head": _git_head(),
        "command": args.command,
        "source": "pytest junit + coverage.py json",
        "coverage_core_line": _coverage(ROOT / args.coverage),
        **stats,
    }
    out = ROOT / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True))
    return 0 if payload["failed"] == 0 else 1

if __name__ == "__main__":
    raise SystemExit(main())
