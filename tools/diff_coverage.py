#!/usr/bin/env python
"""D-1 changed-line coverage gate.

Reads a coverage.py JSON report and a git diff, then requires the added lines
inside the measured source tree to be covered at or above a threshold.
Non-executable added lines (blank/comment/import-only lines that coverage does
not track) are ignored.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True, encoding="utf-8")


def resolve_base(base: str) -> str:
    if not base or set(base) == {"0"}:
        return "HEAD^"
    try:
        git("rev-parse", "--verify", f"{base}^{{commit}}")
        return git("merge-base", base, "HEAD").strip()
    except subprocess.CalledProcessError:
        return "HEAD^"


def added_lines(base: str, paths: list[str]) -> dict[str, set[int]]:
    out = git("diff", "--unified=0", base, "HEAD", "--", *paths)
    result: dict[str, set[int]] = {}
    current: str | None = None
    for line in out.splitlines():
        if line.startswith("+++ b/"):
            current = line[6:]
            result.setdefault(current, set())
            continue
        if current is None:
            continue
        match = HUNK.match(line)
        if not match:
            continue
        start = int(match.group(1))
        count = int(match.group(2) or "1")
        result[current].update(range(start, start + count))
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--coverage", default="coverage.json")
    parser.add_argument("--base", default="HEAD^")
    parser.add_argument("--threshold", type=float, default=80.0)
    parser.add_argument("--paths", nargs="+", default=["netlab/core"])
    args = parser.parse_args()

    coverage_path = Path(args.coverage)
    if not coverage_path.exists():
        print(f"ERROR: coverage json not found: {coverage_path}")
        return 2

    data = json.loads(coverage_path.read_text(encoding="utf-8"))
    files = {k.replace("\\", "/"): v for k, v in data.get("files", {}).items()}
    base = resolve_base(args.base)
    changed = added_lines(base, args.paths)

    rows = []
    covered_total = 0
    missed_total = 0
    for path, lines in sorted(changed.items()):
        entry = files.get(path)
        if entry is None or not lines:
            continue
        executed = set(entry.get("executed_lines", []))
        missing = set(entry.get("missing_lines", []))
        measurable = lines & (executed | missing)
        if not measurable:
            continue
        covered = len(measurable & executed)
        missed = len(measurable) - covered
        covered_total += covered
        missed_total += missed
        rows.append((path, covered, missed, 100.0 * covered / len(measurable)))

    print(f"diff base: {base}")
    print(f"threshold: {args.threshold:.1f}%  changed executable lines: {covered_total + missed_total}")
    for path, covered, missed, pct in rows:
        print(f"  {path}: {covered}/{covered + missed} = {pct:.1f}%")

    total = covered_total + missed_total
    if total == 0:
        print("OK: no changed executable lines in measured paths")
        return 0
    pct = 100.0 * covered_total / total
    print(f"TOTAL changed-line coverage: {covered_total}/{total} = {pct:.2f}%")
    if pct + 1e-9 < args.threshold:
        print(f"FAIL: {pct:.2f}% < {args.threshold:.1f}%")
        return 1
    print("OK: changed-line coverage passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
