#!/usr/bin/env python3
"""生成 Netlab 的易变状态快照（严格审计 X4：文档不得手写会变的事实）。

用法：
    python tools/gen_status.py            # 写 netlab/docs/status.json
    python tools/gen_status.py --print    # 只打印，不落盘

数据来源：
- git：HEAD / 分支 / 工作树是否干净 / 领先落后 origin
- netlab/__init__.py：__version__
- reports/test_status.json（可选，由测试脚本写入）：
  {"passed": 748, "skipped": 1, "failed": 0, "duration_s": 212.4,
   "coverage_core_line": 81.19, "command": "..."}

本脚本不运行测试、不联网；它只汇总已有事实。
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATUS_PATH = ROOT / "netlab" / "docs" / "status.json"
REPORTS_PATH = ROOT / "reports" / "test_status.json"


def _git(*args: str) -> str:
    try:
        return subprocess.run(
            ["git", *args],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return ""


def _version() -> str:
    text = (ROOT / "netlab" / "__init__.py").read_text(encoding="utf-8")
    match = re.search(r'^__version__\s*=\s*"([^"]+)"', text, re.MULTILINE)
    return match.group(1) if match else ""


def _ahead_behind() -> tuple[int | None, int | None]:
    raw = _git("rev-list", "--left-right", "--count", "origin/main...HEAD")
    if not raw:
        return None, None
    parts = raw.split()
    if len(parts) != 2:
        return None, None
    behind, ahead = parts
    return int(ahead), int(behind)


def _tests() -> dict:
    if not REPORTS_PATH.is_file():
        return {
            "passed": None,
            "skipped": None,
            "failed": None,
            "duration_s": None,
            "coverage_core_line": None,
            "command": "",
            "source": "reports/test_status.json 缺失",
        }
    data = json.loads(REPORTS_PATH.read_text(encoding="utf-8"))
    return {
        "passed": data.get("passed"),
        "skipped": data.get("skipped"),
        "failed": data.get("failed"),
        "duration_s": data.get("duration_s"),
        "coverage_core_line": data.get("coverage_core_line"),
        "command": data.get("command", ""),
        "source": "reports/test_status.json",
    }


_STATUS_ONLY_PATHS = {
    "netlab/docs/status.json",
    "reports/test_status.json",
    "tools/check_status_freshness.py",
}


def _status_artifact(path: str) -> bool:
    return path in _STATUS_ONLY_PATHS or path.startswith("reports/shadow/")


def _effective_head() -> str:
    """HEAD，跳过尾随的纯状态提交。

    status.json 无法在自身提交内引用自身 SHA；若最后一个提交只改状态产物，
    status.git.head 应指向它覆盖的最后一个非状态提交，与 freshness 检查一致。
    """
    head = _git("rev-parse", "HEAD")
    while True:
        parent = _git("rev-parse", "--verify", f"{head}^")
        if not parent:
            return head
        changed = {line for line in _git("diff", "--name-only", parent, head).splitlines() if line}
        if changed and all(_status_artifact(path) for path in changed):
            head = parent
            continue
        return head


def _dirty() -> bool:
    """工作树脏状态，忽略 status 自身及其直接输入产物（生成物不应把自己算脏）。"""
    out = _git("status", "--porcelain", "--", ".", ":(exclude)netlab/docs/status.json", ":(exclude)reports/test_status.json", ":(exclude)reports/pytest.xml", ":(exclude)coverage.json")
    return bool(out)

def build() -> dict:
    ahead, behind = _ahead_behind()
    return {
        "schema_version": 1,
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "version": _version(),
        "git": {
            "branch": _git("branch", "--show-current"),
            "head": _effective_head(),
            "dirty": _dirty(),
            "ahead_origin": ahead,
            "behind_origin": behind,
        },
        "tests": _tests(),
        "coverage_gate": {"core_line_min": 81, "changed_line_min": 80},
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--print", action="store_true", help="只打印，不写文件")
    args = parser.parse_args(argv)
    payload = build()
    text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    if args.print:
        sys.stdout.write(text)
        return 0
    STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATUS_PATH.write_text(text, encoding="utf-8")
    print(f"wrote {STATUS_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
