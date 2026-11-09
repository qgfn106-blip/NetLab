#!/usr/bin/env python3
"""B-2：需求可验证性抽查。每条形如 用户场景/失败代价/外部可观察验收命令。"""
from __future__ import annotations
import argparse, subprocess, sys
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parent.parent
REQ = ROOT / "docs" / "canonical" / "requirements.yaml"

def select(ids: str | None, sample: int) -> list[dict]:
    requirements = yaml.safe_load(REQ.read_text(encoding="utf-8"))["requirements"]
    by_id = {r["id"]: r for r in requirements}
    if ids:
        chosen = [by_id[x.strip()] for x in ids.split(",") if x.strip()]
    else:
        # 固定覆盖首尾 + 中位，避免随机导致 CI 抖动
        picks = ["R01", "R43", requirements[len(requirements)//2]["id"]]
        chosen = [by_id[x] for x in picks[:sample]]
    return chosen

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", help="逗号分隔，如 R01,R43")
    ap.add_argument("--sample", type=int, default=3)
    args = ap.parse_args(argv)
    failures = []
    for req in select(args.ids, args.sample):
        for key in ("user_scenario", "failure_cost", "verify_command", "expected", "failure_condition"):
            if not req.get(key):
                failures.append(f"{req['id']}: 缺字段 {key}")
        if failures and failures[-1].startswith(req["id"]):
            continue
        proc = subprocess.run(req["verify_command"], cwd=ROOT, shell=True, capture_output=True, text=True, encoding="utf-8", errors="replace")
        ok = proc.returncode == 0 and "failed" not in proc.stdout.lower() and "error" not in proc.stdout.lower()
        print(f"{req['id']}: {'PASS' if ok else 'FAIL'} | {req['verify_command']}")
        if not ok:
            failures.append(f"{req['id']}: exit={proc.returncode} tail={proc.stdout[-400:]}{proc.stderr[-400:]}")
    if failures:
        print("FAIL: requirement verifiability")
        for f in failures:
            print(" -", f)
        return 1
    print("OK: requirement verifiability sample passed")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
