#!/usr/bin/env python3
"""B-2：需求可验证性抽查 / 全量门禁。

每条需求须含：user_scenario / failure_cost / verify_command / expected / failure_condition。
本工具在原「字段存在 + 命令退出码」基础上强化为语义门禁：
  1) 字段非空且非占位（TODO/TBD/待补/占位 等）；
  2) expected 必须描述可观察结果（退出码/passed/输出/状态 等关键词）；
  3) failure_condition 必须描述失败观察（非0/failed/error/失败/超时 等）；
  4) expected 与 failure_condition 不得雷同；
  5) 实际执行 verify_command，并按 expected 声明的退出码预期校验；
     同时扫描 stdout（及 stderr 的 Traceback）中的失败/崩溃信号。
支持 --ids 指定、--all 全量、--sample 抽样（默认 R01/R43/中位）。
"""
from __future__ import annotations
import argparse, subprocess
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parent.parent
REQ = ROOT / "docs" / "canonical" / "requirements.yaml"

FIELDS = ("user_scenario", "failure_cost", "verify_command", "expected", "failure_condition")
PLACEHOLDERS = {"todo", "tbd", "待补", "待定", "占位", "n/a", "xxx", "??", "待填写", "略"}
EXPECT_MARKERS = ("退出码", "返回码", "状态码", "exit", "passed", "通过", "失败", "输出", "包含", "打印")
FAIL_MARKERS = ("非0", "非 0", "failed", "error", "失败", "超时", "缺少", "不通过", "崩溃")


def load_requirements() -> list[dict]:
    return yaml.safe_load(REQ.read_text(encoding="utf-8"))["requirements"]


def select(requirements: list[dict], ids: str | None, sample: int, run_all: bool) -> list[dict]:
    by_id = {r["id"]: r for r in requirements}
    if ids:
        return [by_id[x.strip()] for x in ids.split(",") if x.strip()]
    if run_all:
        return list(requirements)
    picks = ["R01", "R43", requirements[len(requirements) // 2]["id"]]
    return [by_id[x] for x in picks[:sample]]


def quality_issues(req: dict) -> list[str]:
    issues: list[str] = []
    vals: dict[str, str] = {}
    for key in FIELDS:
        raw = req.get(key)
        text = str(raw).strip() if raw is not None else ""
        vals[key] = text
        if not text:
            issues.append("缺字段或为空 " + key)
            continue
        low = text.lower().strip(" .。:：")
        if low in PLACEHOLDERS or len(low) < 2:
            issues.append("字段 " + key + " 为占位/空壳值：" + text[:40])
    exp = vals.get("expected", "")
    fc = vals.get("failure_condition", "")
    if exp and not any(m in exp.lower() for m in EXPECT_MARKERS):
        issues.append("expected 未描述可观察结果（缺 退出码/passed/输出 等关键词）")
    if fc and not any(m in fc.lower() for m in FAIL_MARKERS):
        issues.append("failure_condition 未描述失败观察（缺 非0/failed/error/失败 等关键词）")
    if exp and fc and exp == fc:
        issues.append("expected 与 failure_condition 雷同，无法区分成功/失败判定")
    return issues


def evaluate(req: dict, proc: subprocess.CompletedProcess) -> list[str]:
    problems: list[str] = []
    expected = str(req.get("expected", ""))
    if "traceback (most recent call last)" in (proc.stderr or "").lower():
        problems.append("stderr 出现 Traceback（命令崩溃但未反映为失败）")
    expect_zero = ("退出码 0" in expected) or ("退出码0" in expected) or ("退出码为 0" in expected)
    expect_nonzero = ("非 0" in expected) or ("非0" in expected)
    if expect_zero and proc.returncode != 0:
        problems.append("expected 声明退出码 0，实际 exit=" + str(proc.returncode))
    if expect_nonzero and proc.returncode == 0:
        problems.append("expected 声明非 0 退出码，实际为 0")
    if proc.returncode != 0 and not expect_nonzero:
        problems.append("命令退出码非 0（exit=" + str(proc.returncode) + "）")
    low = (proc.stdout or "").lower()
    if proc.returncode == 0 and ("failed" in low or "error" in low):
        problems.append("退出码 0 但 stdout 含 failed/error 信号")
    return problems


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", help="逗号分隔，如 R01,R43")
    ap.add_argument("--sample", type=int, default=3)
    ap.add_argument("--all", action="store_true", help="校验全部需求")
    args = ap.parse_args(argv)
    requirements = load_requirements()
    chosen = select(requirements, args.ids, args.sample, args.all)
    failures: list[str] = []
    for req in chosen:
        issues = quality_issues(req)
        if issues:
            for it in issues:
                failures.append(req["id"] + ": " + it)
            print(req["id"] + ": FAIL(quality) | " + str(req.get("verify_command", "")))
            continue
        proc = subprocess.run(req["verify_command"], cwd=ROOT, shell=True, capture_output=True, text=True, encoding="utf-8", errors="replace")
        problems = evaluate(req, proc)
        ok = not problems
        print(req["id"] + ": " + ("PASS" if ok else "FAIL") + " | " + req["verify_command"])
        if not ok:
            failures.append(req["id"] + ": exit=" + str(proc.returncode) + " problems=" + repr(problems) + " tail=" + (proc.stdout or "")[-300:])
    if failures:
        print("FAIL: requirement verifiability (" + str(len(failures)) + " 项)")
        for f in failures:
            print(" -", f)
        return 1
    scope = "all" if args.all else ("ids" if args.ids else "sample")
    print("OK: requirement verifiability " + scope + " passed (" + str(len(chosen)) + " 条)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
