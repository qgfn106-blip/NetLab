"""D-2 / N-21：版本号单一来源检查。

唯一允许定义版本的位置是 ``netlab/__init__.py``；``frontend/index.html``
只能出现 ``__NETLAB_VERSION__`` 占位符，由服务端在响应时注入。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION_FILE = ROOT / "netlab" / "__init__.py"
INDEX = ROOT / "frontend" / "index.html"
PLACEHOLDER = "__NETLAB_VERSION__"

RUNTIME_GLOBS = (
    "netlab/**/*.py",
    "frontend/index.html",
    "frontend/app.ts",
    "frontend/app.js",
    "frontend/package.json",
    "pyproject.toml",
)
SKIP_PARTS = {"tests", "__pycache__", "docs", "node_modules", ".venv", "venv"}


def read_version() -> str:
    text = VERSION_FILE.read_text(encoding="utf-8")
    match = re.search(r'^__version__\s*=\s*"([^"]+)"', text, re.MULTILINE)
    if not match:
        raise SystemExit("netlab/__init__.py 缺少 __version__")
    return match.group(1)


def runtime_files() -> list[Path]:
    files: set[Path] = set()
    for pattern in RUNTIME_GLOBS:
        for path in ROOT.glob(pattern):
            if not path.is_file():
                continue
            if SKIP_PARTS & set(path.parts):
                continue
            files.add(path)
    return sorted(files)


def main() -> int:
    version = read_version()
    problems: list[str] = []

    definitions = []
    for path in ROOT.glob("netlab/**/*.py"):
        if SKIP_PARTS & set(path.parts):
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if re.search(r"^__version__\s*=", text, re.MULTILINE):
            definitions.append(path.relative_to(ROOT).as_posix())
    if definitions != ["netlab/__init__.py"]:
        problems.append(f"__version__ 定义位置不是唯一: {definitions}")

    for path in runtime_files():
        text = path.read_text(encoding="utf-8", errors="ignore")
        if version in text and path != VERSION_FILE:
            problems.append(f"{path.relative_to(ROOT).as_posix()} 仍硬编码版本 {version}")

    index_text = INDEX.read_text(encoding="utf-8")
    if PLACEHOLDER not in index_text:
        problems.append("frontend/index.html 缺少 __NETLAB_VERSION__ 占位符")
    if f"?v={version}" in index_text:
        problems.append("frontend/index.html 仍硬编码 ?v= 版本")

    if problems:
        print("版本单一来源检查失败：", file=sys.stderr)
        for item in problems:
            print(f"  - {item}", file=sys.stderr)
        return 1
    print(f"OK: 版本单一来源 {version}（index.html 使用 {PLACEHOLDER}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
