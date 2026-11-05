"""把 PlotKit 内置进 netlab，或把内置副本卸载掉。

netlab 的「绘图」页签内嵌 PlotKit。为了不再要求用户单独下载 PlotKit，
这里提供一个内置副本：``netlab/_vendor/plotkit``。内置之后，导入
``plotkit`` 时优先用这份副本，外部安装（pip install plotkit）可以卸掉。

用法::

    python -m netlab.plotkit_vendor status      # 看有没有内置、版本、大小
    python -m netlab.plotkit_vendor install     # 从 ../PlotKit/src 复制进来
    python -m netlab.plotkit_vendor install --src D:/code/PlotKit/src
    python -m netlab.plotkit_vendor uninstall   # 删除内置副本

内置副本随 netlab 一起分发（打包时把 ``netlab/_vendor`` 带上即可），
卸载它不影响 netlab 其它功能，只是绘图页签会退回「需要外部 PlotKit」。
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

VENDOR_DIR = Path(__file__).resolve().parent / "_vendor"
TARGET = VENDOR_DIR / "plotkit"
IGNORE = shutil.ignore_patterns(
    "__pycache__", "*.pyc", "*.pyo", ".pytest_cache", "*.egg-info",
    # 开发期 TypeScript 源不进运行期内置副本（R41/P16：packages 内 .ts + 编译产物 .js 并存，
    # 只有 .js 供 <script> 运行，vendor 只需 .js）
    "*.ts", "*.tsbuildinfo",
)


def candidate_sources() -> list[Path]:
    """可能藏着 PlotKit 源码的位置（按优先级）。"""
    out: list[Path] = []
    env = os.environ.get("NETLAB_PLOTKIT_SRC", "").strip()
    if env:
        out.append(Path(env).expanduser())
    here = Path(__file__).resolve()
    for base in (here.parents[1], here.parents[2], here.parents[3]):
        out.append(base / "PlotKit" / "src")
        out.append(base / "PlotKit")
    seen: list[Path] = []
    for path in out:
        if path not in seen:
            seen.append(path)
    return seen


def _find_package_source(src: Path | None = None) -> Path | None:
    """返回包含 plotkit/__init__.py 的目录。"""
    searches = [src] if src is not None else candidate_sources()
    for base in searches:
        if base is None:
            continue
        base = Path(base)
        for candidate in (base, base / "plotkit", base / "src" / "plotkit"):
            if (candidate / "__init__.py").is_file() and (candidate / "server").is_dir():
                return candidate
    return None


def _read_version(pkg: Path) -> str:
    for name in ("__init__.py", "version.py", "_version.py"):
        path = pkg / name
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for key in ("__version__", "VERSION"):
            marker = key + " = "
            idx = text.find(marker)
            if idx >= 0:
                tail = text[idx + len(marker):].lstrip()
                quote = tail[:1]
                if quote in ("'", '"'):
                    end = tail.find(quote, 1)
                    if end > 0:
                        return tail[1:end]
    return "?"


def status() -> dict:
    """报告内置副本状态。"""
    info: dict = {
        "vendored": TARGET.is_dir(),
        "path": str(TARGET),
        "version": None,
        "files": 0,
        "bytes": 0,
    }
    if TARGET.is_dir():
        info["version"] = _read_version(TARGET)
        total = 0
        count = 0
        for root, _dirs, files in os.walk(TARGET):
            for name in files:
                try:
                    total += (Path(root) / name).stat().st_size
                except OSError:
                    continue
                count += 1
        info["files"] = count
        info["bytes"] = total
    return info


def install(src: Path | str | None = None, force: bool = False) -> dict:
    """把 PlotKit 源码复制成 netlab 内置副本。"""
    source = _find_package_source(Path(src) if src else None)
    if source is None:
        return {"ok": False, "error": "找不到 PlotKit 源码（可设 NETLAB_PLOTKIT_SRC 或传 --src）"}
    if TARGET.exists():
        if not force:
            return {"ok": False, "error": f"{TARGET} 已存在；要覆盖请加 --force", **status()}
        shutil.rmtree(TARGET)
    VENDOR_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, TARGET, ignore=IGNORE)
    return {"ok": True, "from": str(source), **status()}


def uninstall() -> dict:
    """删除内置副本（回到「外部安装 PlotKit」状态）。"""
    if not TARGET.is_dir():
        return {"ok": True, "note": "没有内置副本，无需卸载", **status()}
    shutil.rmtree(TARGET)
    try:
        VENDOR_DIR.rmdir()
    except OSError:
        pass
    return {"ok": True, "removed": str(TARGET), **status()}


def vendor_path() -> Path | None:
    """如有内置副本，返回可加入 ``sys.path`` 的目录（其下含 plotkit/）。"""
    return VENDOR_DIR if (TARGET / "__init__.py").is_file() else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="netlab.plotkit_vendor", description="内置/卸载 netlab 的 PlotKit 副本")
    parser.add_argument("action", choices=("status", "install", "uninstall"))
    parser.add_argument("--src", default=None, help="PlotKit 源码目录（默认自动查找 ../PlotKit/src）")
    parser.add_argument("--force", action="store_true", help="install 时覆盖已有副本")
    args = parser.parse_args(argv)

    if args.action == "status":
        result = status()
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result["vendored"] else 1
    if args.action == "install":
        result = install(args.src, force=args.force)
    else:
        result = uninstall()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("ok") else 2


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
