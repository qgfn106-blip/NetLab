"""缓存体检与"安全清理"。

设计原则（数据安全优先）：
1. 只清理**可再生成**的目录，绝不碰用户数据（工程 *.netlab、自动保存、导出的图、文档、内置副本）。
2. 三档分类：safe（随便清）、caution（清掉会丢界面偏好，必须显式 opt-in）、protected（永不清理）。
3. `clean()` 默认 dry_run，只有显式 `dry_run=False` 才真删；每条路径删前做根目录校验与保护名单校验。
4. 清不掉的（被占用）逐条报告，不中断其它条目。
"""

from __future__ import annotations

import os
import shutil
import tempfile
import time
from dataclasses import dataclass, asdict
from pathlib import Path

#: 受保护的文件/目录名（出现即跳过）
PROTECTED_SUFFIXES = (".netlab", ".json.bak")
PROTECTED_NAMES = ("autosave.netlab", "settings.json", "window.json", "_vendor")
PROTECTED_DIR_NAMES = ("docs", "exports", "projects", "samples", "tests")

#: 安全档：纯缓存，删了只会"下次重新生成"
SAFE_DIRS = (".plotkit",)
CAUTION_DIRS = (".plotkit-desktop",)


@dataclass
class Entry:
    key: str
    label: str
    tier: str  # safe / caution / protected
    path: str
    exists: bool
    files: int = 0
    bytes: int = 0
    mtime: float = 0.0
    note: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


def _stats(path: Path) -> tuple[int, int, float]:
    files = 0
    total = 0
    newest = 0.0
    for root, _dirs, names in os.walk(path):
        for name in names:
            fp = Path(root) / name
            try:
                st = fp.stat()
            except OSError:
                continue
            files += 1
            total += st.st_size
            newest = max(newest, st.st_mtime)
    return files, total, newest


def _is_protected(path: Path) -> bool:
    parts = {p.lower() for p in path.parts}
    if parts & {n.lower() for n in PROTECTED_DIR_NAMES}:
        return True
    if parts & {n.lower() for n in PROTECTED_NAMES}:
        return True
    if path.name.lower() in {n.lower() for n in PROTECTED_NAMES}:
        return True
    return path.suffix.lower() in PROTECTED_SUFFIXES


def _too_shallow(path: Path) -> bool:
    """拒绝删根目录或用户主目录这类过于宽泛的路径。"""
    try:
        resolved = path.resolve()
    except OSError:
        return True
    return len(resolved.parts) <= 3 or resolved == Path.home().resolve()


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _pycache_dirs(limit: int = 400) -> list[Path]:
    root = _repo_root()
    found: list[Path] = []
    for dirpath, dirnames, _names in os.walk(root):
        if ".git" in dirpath or "node_modules" in dirpath:
            dirnames[:] = []
            continue
        if "__pycache__" in dirnames:
            found.append(Path(dirpath) / "__pycache__")
            dirnames.remove("__pycache__")
        if len(found) >= limit:
            break
    return found


def compare_roots(home: Path | None = None, temp: Path | None = None) -> dict:
    home = Path(home) if home else Path.home()
    temp = Path(temp) if temp else Path(tempfile.gettempdir())
    return {"home": home, "temp": temp}


def scan(home: Path | None = None, temp: Path | None = None, include_pycache: bool = True) -> dict:
    """体检，返回分档条目与合计。不修改磁盘。"""
    roots = compare_roots(home, temp)
    entries: list[Entry] = []

    labels = {
        ".plotkit": ("plotkit-cache", "PlotKit 临时/渲染缓存", "safe", "可再生成，删除无副作用"),
        ".plotkit-desktop": (
            "plotkit-desktop",
            "PlotKit 桌面端 WebView2 用户数据",
            "caution",
            "含 localStorage 界面偏好（面板宽度等）；清理会重置偏好，需显式确认",
        ),
    }
    for name in SAFE_DIRS + CAUTION_DIRS:
        path = roots["home"] / name
        key, label, tier, note = labels[name]
        if path.exists():
            files, size, mtime = _stats(path)
            entries.append(Entry(key, label, tier, str(path), True, files, size, mtime, note))
        else:
            entries.append(Entry(key, label, tier, str(path), False, 0, 0, 0.0, note))

    for pattern in ("plotkit-*", "netlab-*"):
        for path in sorted(roots["temp"].glob(pattern))[:20]:
            if not path.is_dir():
                continue
            files, size, mtime = _stats(path)
            entries.append(
                Entry(f"temp:{path.name}", f"临时目录 {path.name}", "safe", str(path), True,
                      files, size, mtime, "进程临时目录，可再生成")
            )

    if include_pycache:
        dirs = _pycache_dirs()
        if dirs:
            files = size = 0
            newest = 0.0
            for d in dirs:
                f, s, m = _stats(d)
                files += f
                size += s
                newest = max(newest, m)
            entries.append(
                Entry("pycache", "Python 字节码缓存（整个仓库 __pycache__）", "safe",
                      str(_repo_root()), True, files, size, newest,
                      f"{len(dirs)} 个 __pycache__ 目录，删后自动重建")
            )
        pytest_cache = _repo_root() / ".pytest_cache"
        if pytest_cache.exists():
            files, size, mtime = _stats(pytest_cache)
            entries.append(Entry("pytest_cache", "pytest 缓存", "safe", str(pytest_cache), True,
                                 files, size, mtime, "测试元数据，可再生成"))

    totals = {"safe": 0, "caution": 0}
    for e in entries:
        if e.exists and e.tier in totals:
            totals[e.tier] += e.bytes
    return {
        "entries": [e.to_dict() for e in entries],
        "totals": totals,
        "total_bytes": sum(totals.values()),
        "threshold_mb": 0,
    }


def clean(
    tiers: tuple[str, ...] = ("safe",),
    dry_run: bool = True,
    include_pycache: bool = True,
    min_age_seconds: int = 0,
    home: Path | None = None,
    temp: Path | None = None,
) -> dict:
    """按档清理。默认 dry-run（只报告将要删什么）。"""
    report = scan(home=home, temp=temp, include_pycache=include_pycache)
    now = time.time()
    removed: list[dict] = []
    skipped: list[dict] = []
    freed = 0

    for item in report["entries"]:
        entry = Entry(**item)
        if not entry.exists:
            continue
        if entry.tier not in tiers:
            skipped.append({"path": entry.path, "reason": "档位未选中"})
            continue
        path = Path(entry.path)
        if _is_protected(path):
            skipped.append({"path": entry.path, "reason": "受保护（可能是用户数据）"})
            continue
        if _too_shallow(path):
            skipped.append({"path": entry.path, "reason": "路径过于宽泛，拒绝删除"})
            continue
        if min_age_seconds and entry.mtime and now - entry.mtime < min_age_seconds:
            skipped.append({"path": entry.path, "reason": "最近仍在写入，稍后再清"})
            continue

        if dry_run:
            removed.append({"path": entry.path, "bytes": entry.bytes, "files": entry.files,
                            "dry_run": True})
            freed += entry.bytes
            continue

        try:
            if entry.key == "pycache":
                targets = _pycache_dirs()
                for d in targets:
                    shutil.rmtree(d, ignore_errors=True)
            else:
                shutil.rmtree(path)
        except OSError as exc:  # 被占用等：逐条报告，不中断
            skipped.append({"path": entry.path, "reason": f"删除失败：{exc}"})
            continue
        removed.append({"path": entry.path, "bytes": entry.bytes, "files": entry.files,
                        "dry_run": False})
        freed += entry.bytes

    return {"dry_run": dry_run, "tiers": list(tiers), "removed": removed,
            "skipped": skipped, "freed_bytes": freed}


def human(n: int | float) -> str:
    n = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024
    return f"{n:.1f} GB"


def format_report(report: dict) -> str:
    lines = ["缓存体检："]
    for item in report["entries"]:
        mark = "[ok]" if item["exists"] else "[--]"
        tier = {"safe": "安全", "caution": "谨慎", "protected": "保护"}[item["tier"]]
        size = human(item["bytes"]) if item["exists"] else "-"
        lines.append(f"  {mark} [{tier}] {item['label']}: {size}  ({item['path']})")
        if item["exists"] and item["note"]:
            lines.append(f"        {item['note']}")
    lines.append(f"合计：安全 {human(report['totals']['safe'])}，"
                 f"谨慎 {human(report['totals']['caution'])}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    import argparse
    import json
    import sys

    try:  # Windows 控制台默认 GBK，中文/符号容易炸；统一成 UTF-8 输出
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    parser = argparse.ArgumentParser(prog="python -m netlab.cache_guard", description="缓存体检与安全清理")
    sub = parser.add_subparsers(dest="cmd")

    p_status = sub.add_parser("status", help="查看缓存占用（只读）")
    p_status.add_argument("--json", action="store_true")
    p_status.add_argument("--no-pycache", action="store_true")

    p_clean = sub.add_parser("clean", help="清理缓存（默认 dry-run）")
    p_clean.add_argument("--yes", action="store_true", help="真删（不加则只演练）")
    p_clean.add_argument("--caution", action="store_true", help="连谨慎档一起清（会重置界面偏好）")
    p_clean.add_argument("--json", action="store_true")
    p_clean.add_argument("--no-pycache", action="store_true")
    p_clean.add_argument("--min-age", type=int, default=0, help="只清 N 秒内没被写过的")

    args = parser.parse_args(argv)
    if args.cmd == "clean":
        tiers = ("safe", "caution") if args.caution else ("safe",)
        result = clean(tiers=tiers, dry_run=not args.yes,
                       include_pycache=not args.no_pycache, min_age_seconds=args.min_age)
        if args.json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            for item in result["removed"]:
                print(f"{'将删除' if item['dry_run'] else '已删除'} {item['path']} "
                      f"({human(item['bytes'])})")
            for item in result["skipped"]:
                print(f"跳过 {item['path']}：{item['reason']}")
            print(f"合计释放 {human(result['freed_bytes'])}"
                  + ("（演练，未真删；加 --yes 执行）" if result["dry_run"] else ""))
        return 0

    report = scan(include_pycache=not getattr(args, "no_pycache", False))
    print(json.dumps(report, ensure_ascii=False, indent=2) if getattr(args, "json", False)
          else format_report(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
