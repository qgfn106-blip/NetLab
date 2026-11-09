#!/usr/bin/env python3
"""维护 README 顶部的「最近更新」：始终保留最近 10 次 GitHub 推送记录。

用法：
  python tools/update_readme_changelog.py --write   # 更新 README
  python tools/update_readme_changelog.py --check   # CI 校验无漂移
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
README = ROOT / "README.md"
BEGIN = "<!-- BEGIN LAST 10 UPDATES -->"
END = "<!-- END LAST 10 UPDATES -->"


def commits(limit: int = 12) -> list[tuple[str, str, str]]:
    out = subprocess.check_output(
        [
            "git",
            "log",
            "--invert-grep",
            "--grep=^(docs\\(readme\\):|fix\\(docs\\): README)",
            "-10",
            "--pretty=format:%h\t%ad\t%s",
            "--date=short",
        ],
        cwd=ROOT,
        text=True,
        encoding="utf-8",
    )
    rows = []
    for line in out.splitlines():
        sha, date, subject = line.split("\t", 2)
        rows.append((sha, date, subject))
    return rows


def block(rows: list[tuple[str, str, str]]) -> str:
    lines = [BEGIN, "", "## 最近更新（自动记录最近 10 次）", "", "| 日期 | 更新内容 |", "|---|---|"]
    for _sha, date, subject in rows:
        lines.append(f"| {date} | {subject.replace('|', '\\|')} |")
    lines += ["", END]
    return "\n".join(lines)


def main() -> int:
    mode = "--check" if "--check" in sys.argv else "--write"
    text = README.read_text(encoding="utf-8")
    new_block = block(commits())
    if BEGIN in text and END in text:
        head, rest = text.split(BEGIN, 1)
        _, tail = rest.split(END, 1)
        updated = head + new_block + tail
    else:
        # 插到「## 文档」之前
        marker = "## 文档"
        if marker not in text:
            raise SystemExit("README 缺少「## 文档」锚点")
        updated = text.replace(marker, new_block + "\n\n" + marker, 1)
    if mode == "--check":
        if updated != text:
            print("README 最近更新与 git log 不一致，请运行 python tools/update_readme_changelog.py --write")
            return 1
        print("OK: README 最近更新无漂移")
        return 0
    README.write_text(updated, encoding="utf-8", newline="\n")
    print(f"updated README with {len(commits())} entries")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
