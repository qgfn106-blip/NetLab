#!/usr/bin/env python3
"""从 docs/canonical 生成易变文档段（严格审计 §6.1）。

用法:
    python tools/render_docs.py          # 写入生成段
    python tools/render_docs.py --check  # 只检查是否漂移（CI 用）

生成:
- netlab/docs/PROGRESS.md 顶部状态表（GENERATED: status）
- netlab/docs/BACKLOG.md 顶部状态表（GENERATED: status）
- netlab/docs/REQUIREMENTS_INDEX.md（R01–R43 索引）
- netlab/docs/DECISIONS_INDEX.md（D1–D 索引）
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs" / "canonical"
NL_DOCS = ROOT / "netlab" / "docs"
BEGIN = "<!-- BEGIN GENERATED: status -->"
END = "<!-- END GENERATED: status -->"


def _version() -> str:
    text = (ROOT / "netlab" / "__init__.py").read_text(encoding="utf-8")
    for line in text.splitlines():
        if line.startswith("__version__"):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return "unknown"


def _status_block() -> str:
    status = json.loads((NL_DOCS / "status.json").read_text(encoding="utf-8"))
    gate = status.get("coverage_gate", {})
    rows = [
        f"| 版本 | {_version()} |",
        "| 状态详情 | 见 [status.json](status.json)（由 `tools/gen_status.py` 生成，禁止手写） |",
        f"| 覆盖率门限 | core line ≥{gate.get('core_line_min', '?')}% / changed line ≥{gate.get('changed_line_min', '?')}% |",
        "| 当前阶段 | 见严格审计文档 §11 顺序与 [BACKLOG.md](BACKLOG.md) |",
    ]
    return "\n".join([BEGIN, "| 项 | 内容 |", "| --- | --- |", *rows, END])


def _read_doc(path: Path) -> tuple[str, str]:
    raw = path.read_bytes()
    newline = "\r\n" if b"\r\n" in raw else "\n"
    return raw.decode("utf-8").replace("\r\n", "\n"), newline


def _replace_block(text: str, block: str, anchor: str | None = None) -> str:
    if BEGIN in text and END in text:
        start = text.index(BEGIN)
        finish = text.index(END) + len(END)
        return text[:start] + block + text[finish:]
    lines = text.splitlines(keepends=True)
    for i, line in enumerate(lines):
        if line.strip() == "| 项 | 内容 |":
            j = i
            while j < len(lines) and lines[j].lstrip().startswith("|"):
                j += 1
            return "".join(lines[:i]) + block + "\n" + "".join(lines[j:])
    if anchor:
        for i, line in enumerate(lines):
            if line.strip() == anchor:
                return "".join(lines[: i + 1]) + "\n" + block + "\n" + "".join(lines[i + 1 :])
    raise SystemExit(f"未找到状态表插入位置: {text[:40]!r}")


def _index(requirements: list[dict], decisions: list[dict]) -> tuple[str, str]:
    r = ["# 需求索引（生成，勿手改）", "", "| ID | 名称 | 期次 | 现状摘要 |", "| --- | --- | --- | --- |"]
    for item in requirements:
        status = (item.get("status") or "").replace("|", "／")
        r.append(f"| {item['id']} | {item['title']} | {item.get('stage', '')} | {status[:80]} |")
    d = ["# 决策索引（生成，勿手改）", "", "| ID | 主题 | 决策摘要 |", "| --- | --- | --- |"]
    for item in decisions:
        decision = (item.get("decision") or "").replace("|", "／")
        d.append(f"| {item.get('canonical_id') or item['id']} | {item['title']} | {decision[:100]} |")
    return "\n".join(r) + "\n", "\n".join(d) + "\n"


def _outputs() -> dict[Path, tuple[str, str]]:
    requirements = yaml.safe_load((DOCS / "requirements.yaml").read_text(encoding="utf-8"))["requirements"]
    decisions = yaml.safe_load((DOCS / "decisions.yaml").read_text(encoding="utf-8"))["decisions"]
    r_index, d_index = _index(requirements, decisions)
    block = _status_block()
    progress, progress_nl = _read_doc(NL_DOCS / "PROGRESS.md")
    backlog, backlog_nl = _read_doc(NL_DOCS / "BACKLOG.md")
    return {
        NL_DOCS / "PROGRESS.md": (_replace_block(progress, block), progress_nl),
        NL_DOCS / "BACKLOG.md": (_replace_block(backlog, block, anchor="## 0. 一句话现状"), backlog_nl),
        NL_DOCS / "REQUIREMENTS_INDEX.md": (r_index, "\n"),
        NL_DOCS / "DECISIONS_INDEX.md": (d_index, "\n"),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    outputs = _outputs()
    if args.check:
        drift = []
        for path, (text, newline) in outputs.items():
            expected = text.replace("\n", newline) if newline != "\n" else text
            if not path.exists():
                drift.append(str(path.relative_to(ROOT)))
                continue
            actual = path.read_bytes().decode("utf-8").replace("\r\n", "\n")
            if actual != text:
                drift.append(str(path.relative_to(ROOT)))
        if drift:
            print("DOCS DRIFT: " + ", ".join(drift))
            return 1
        print("OK: docs render is up to date")
        return 0
    for path, (text, newline) in outputs.items():
        data = text.replace("\n", newline) if newline != "\n" else text
        path.write_bytes(data.encode("utf-8"))
    print(f"OK: rendered {len(outputs)} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
