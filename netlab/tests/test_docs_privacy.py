"""D-3 / N-24、N-30：文档隐私边界。

文档只描述项目，不记录本机私有路径、私有代理端口或记忆库位置。
"""

from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUFFIXES = {".md", ".txt", ".rst"}
FORBIDDEN = (
    "127.0.0.1:7897",
    "127.0.0.1:7900",
    ".dsh-meow",
    "E:\\Python",
    "C:\\Users\\",
    "D:\\Program Files",
)


def tracked_docs() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "--", "*.md", "*.txt", "*.rst"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    paths = []
    for line in result.stdout.splitlines():
        if not line.strip():
            continue
        path = ROOT / line
        if path.is_file() and path.suffix.lower() in SUFFIXES:
            paths.append(path)
    return sorted(paths)


def test_docs_have_no_private_locations() -> None:
    problems: list[str] = []
    for path in tracked_docs():
        text = path.read_text(encoding="utf-8", errors="ignore")
        for needle in FORBIDDEN:
            if needle in text:
                problems.append(f"{path.relative_to(ROOT).as_posix()}: {needle}")
    assert not problems, "文档包含本机私有信息：\n" + "\n".join(problems)
