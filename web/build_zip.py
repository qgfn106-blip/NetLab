"""把 netlab 的核心 Python 模块打包成 web/netlab.zip，供 Pyodide 在浏览器里加载。

只打包顶层 ``netlab/*.py``（不含 desktop/docs/tests/tools/static）。
用法：python web/build_zip.py
"""

from __future__ import annotations

import pathlib
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
SRC = ROOT / "netlab"
OUT = HERE / "netlab.zip"


def main() -> None:
    modules = sorted(SRC.glob("*.py"))
    if not modules:
        raise SystemExit(f"没有找到模块：{SRC}")
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as bundle:
        for path in modules:
            bundle.write(path, f"netlab/{path.name}")
    size = OUT.stat().st_size
    print(f"已写入 {OUT}（{len(modules)} 个模块，{size / 1024:.1f} KB）")


if __name__ == "__main__":
    main()
