#!/usr/bin/env python3
"""维护 README 顶部的「最近更新」：始终保留最近 20 次 GitHub 推送记录。

用法：
  python tools/update_readme_changelog.py --write          # 从 git log 重写最近 20 条
  python tools/update_readme_changelog.py --check          # 校验表格结构
  python tools/update_readme_changelog.py --check --strict # 同时校验内容与 git log 一致

--check 默认只校验结构：BEGIN/END 标记、标题、表头、20 条日期+内容、日期格式与降序。
--check --strict 额外比对 git log；用于 PR 门禁，提交前请先运行 --write 并提交 README。
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
README = ROOT / "README.md"
BEGIN = "<!-- BEGIN LAST 20 UPDATES -->"
END = "<!-- END LAST 20 UPDATES -->"


def commits(limit: int = 80) -> list[tuple[str, str, str]]:
    out = subprocess.check_output(
        ["git", "log", f"-{limit}", "--pretty=format:%h\t%ad\t%s", "--date=short"],
        cwd=ROOT,
        text=True,
        encoding="utf-8",
    )
    rows = []
    for line in out.splitlines():
        sha, date, subject = line.split("\t", 2)
        if subject.startswith("docs(readme):") or subject.startswith("fix(docs): README"):
            continue
        # 过滤噪音：merge 提交、纯 status-only / chore(status) / chore(ci) 不进入「最近更新」
        if subject.startswith("Merge ") or subject.startswith("chore(status)") or subject.startswith("chore(ci)"):
            continue
        # 有些历史提交把多行说明塞进了 subject，表格里必须压成单行。
        subject = subject.replace("\r", " ").replace("\n", " ").replace("\\n", " ").strip()
        # 历史提交可能把正文误写进 subject（字面 \n + 列表项），只保留标题部分。
        subject = subject.split("  - ", 1)[0].strip()
        rows.append((sha, date, subject))
        if len(rows) == 20:
            break
    return rows

def block(rows: list[tuple[str, str, str]]) -> str:
    lines = [BEGIN, "", "## 最近更新（自动记录最近 20 次）", "", "| 日期 | 更新内容 |", "|---|---|"]
    for _sha, date, subject in rows:
        lines.append(f"| {date} | {subject.replace('|', '\\|')} |")
    lines += ["", END]
    return "\n".join(lines)


def validate_block(text: str) -> list[str]:
    """只校验表格结构，不比对 git log。"""
    errors: list[str] = []
    if text.count(BEGIN) != 1 or text.count(END) != 1:
        return ["必须有且仅有一组 LAST 20 UPDATES 标记"]
    head, rest = text.split(BEGIN, 1)
    body, tail = rest.split(END, 1)
    lines = [line.strip() for line in body.strip().splitlines() if line.strip()]
    if lines[:1] != ["## 最近更新（自动记录最近 20 次）"]:
        errors.append("缺少「## 最近更新（自动记录最近 20 次）」标题")
    expected_header = ["|", "日期", "更新内容", "|"]
    if len(lines) < 2 or lines[1] != "| 日期 | 更新内容 |":
        errors.append("表头必须是「| 日期 | 更新内容 |」")
    if len(lines) < 3 or lines[2] != "|---|---|":
        errors.append("表头分隔行必须是「|---|---|」")
    rows = lines[3:]
    if len(rows) != 20:
        errors.append(f"最近更新必须恰好 20 行，实际 {len(rows)} 行")
    previous: str | None = None
    import datetime as _dt
    for index, row in enumerate(rows, start=1):
        if not row.startswith("|") or not row.endswith("|"):
            errors.append(f"第 {index} 行不是 Markdown 表格行")
            continue
        import re as _re
        _inner = row.strip()
        if _inner.startswith("|"):
            _inner = _inner[1:]
        if _inner.endswith("|") and not _inner.endswith("\\|"):
            _inner = _inner[:-1]
        cells = [cell.strip().replace("\\|", "|") for cell in _re.split(r"(?<!\\)\|", _inner)]
        if len(cells) != 2 or not cells[0] or not cells[1]:
            errors.append(f"第 {index} 行必须有日期和内容两列")
            continue
        try:
            _dt.date.fromisoformat(cells[0])
        except ValueError:
            errors.append(f"第 {index} 行日期不是 YYYY-MM-DD：{cells[0]!r}")
            continue
        if previous is not None and cells[0] > previous:
            errors.append(f"第 {index} 行日期未按降序排列")
        previous = cells[0]
    return errors


def validate_content(text: str) -> list[str]:
    """严格校验表格内容与当前 git log 最近 20 条一致。"""
    errors = validate_block(text)
    if errors:
        return errors
    expected = block(commits())
    start = text.index(BEGIN)
    end = text.index(END) + len(END)
    if text[start:end] != expected:
        return ["README 最近更新内容与 git log 最近 20 条不一致；请运行 --write 并提交 README"]
    return []


def main() -> int:
    mode = "--check" if "--check" in sys.argv else "--write"
    strict = "--strict" in sys.argv
    text = README.read_text(encoding="utf-8")
    if mode == "--check":
        errors = validate_content(text) if strict else validate_block(text)
        if errors:
            for error in errors:
                print(f"README changelog 校验失败：{error}")
            return 1
        if strict:
            print("OK: README 最近更新内容与 git log 一致（20 条）")
        else:
            print("OK: README 最近更新结构有效（20 条）")
        return 0
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
    README.write_text(updated, encoding="utf-8", newline="\n")
    print(f"updated README with {len(commits())} entries")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
