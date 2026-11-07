#!/usr/bin/env python3
"""把存量纯文本 ``.netlab`` 工程就地迁移为压缩容器（魔数 + zlib）。

用法（在 ``NetlabHome/`` 目录下）::

    python tools/migrate_projects_compressed.py            # 实跑 repo 内文件；%APPDATA% 仅报告
    python tools/migrate_projects_compressed.py --dry-run  # 全部只报告，不改文件、不备份
    python tools/migrate_projects_compressed.py --include-appdata  # 连 %APPDATA% 也实跑

单个文件的流程（与 W4 规格一致）：
   1. 若文件首字节已是魔数 -> 跳过（已迁移）。
   2. 备份 ``<file>.bak-<时间戳>``（不覆盖已有备份，冲突时追加序号）。
   3. 读旧 -> ``migrate_project`` 规范化 dict。
   4. 写压缩容器（魔数 + zlib）。
   5. 回读解压 -> 与写前 normalized dict 逐字段相等断言；不等则从备份回滚并报错。

退出码：0 全部成功；1 有任一文件迁移失败（已回滚）。
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
import time
import zlib
from pathlib import Path
from typing import Any

# 让脚本无论从哪个 cwd 启动都能 import 到 netlab 包（tools/ 的父目录 = NetlabHome）。
_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from netlab.core.model.project import (  # noqa: E402
    PROJECT_MAGIC,
    compute_checksum,
    decode_project_bytes,
    encode_project_bytes,
    migrate_project,
    verify_checksum,
)


def _is_compressed(path: Path) -> bool:
    with path.open("rb") as handle:
        head = handle.read(len(PROJECT_MAGIC))
    return head == PROJECT_MAGIC


def _backup(path: Path) -> Path:
    """生成不覆盖已有备份的 ``<name>.bak-<时间戳>``。"""
    stamp = time.strftime("%Y%m%d-%H%M%S")
    candidate = path.with_name(f"{path.name}.bak-{stamp}")
    index = 2
    while candidate.exists():
        candidate = path.with_name(f"{path.name}.bak-{stamp}-{index}")
        index += 1
    shutil.copy2(path, candidate)
    return candidate


def _normalize(payload: dict[str, Any]) -> dict[str, Any]:
    project = migrate_project(payload)
    if not verify_checksum(project):
        project.pop("checksum", None)
        project["checksum"] = compute_checksum(project)
    return project


def _collect_repo_targets() -> list[Path]:
    targets: list[Path] = []
    my_project = _REPO_ROOT / "MyProject"
    if my_project.is_dir():
        targets.extend(sorted(my_project.glob("*.netlab")))
    demo = _REPO_ROOT / "examples" / "demo.netlab"
    if demo.is_file():
        targets.append(demo)
    return targets


def _collect_appdata_targets() -> list[Path]:
    appdata = os.environ.get("APPDATA", "").strip()
    if not appdata:
        return []
    base = Path(appdata)
    roots = [
        base / "Netlab",
        base / "Netlab(Desktop)",
        base / "NetlabDesktop",
    ]
    seen: dict[Path, None] = {}
    for root in roots:
        if not root.is_dir():
            continue
        for path in root.rglob("*.netlab"):
            seen.setdefault(path.resolve(), None)
    return sorted(seen)


def migrate_file(path: Path, *, dry_run: bool) -> dict[str, Any]:
    """迁移单个文件，返回结果字典（ok / status / detail）。"""
    result: dict[str, Any] = {"path": str(path), "ok": True, "status": "", "detail": ""}
    if not path.is_file():
        result.update(ok=False, status="missing", detail="文件不存在")
        return result
    if _is_compressed(path):
        result.update(status="already", detail="已是压缩容器，跳过")
        return result

    old_size = path.stat().st_size
    try:
        payload = decode_project_bytes(path.read_bytes())
        normalized = _normalize(payload)
    except Exception as exc:  # noqa: BLE001 - 需要给用户可读原因
        result.update(ok=False, status="read-failed", detail=str(exc))
        return result

    if dry_run:
        result.update(
            status="would-migrate",
            detail=f"旧 {old_size} B -> 压缩约 {len(encode_project_bytes(normalized))} B",
        )
        return result

    backup = _backup(path)
    try:
        data = encode_project_bytes(normalized)
        path.write_bytes(data)
        # 回读 + 解压 + 逐字段相等断言
        readback = decode_project_bytes(path.read_bytes())
        if readback != normalized:
            raise AssertionError("回读解压后与写前 normalized dict 不一致")
        new_size = path.stat().st_size
        if new_size >= old_size:
            result["detail"] = f"注意：压缩后未变小（{old_size} -> {new_size} B）"
        else:
            result["detail"] = f"{old_size} -> {new_size} B（省 {old_size - new_size} B）"
        result.update(status="migrated", detail=result["detail"], backup=str(backup))
    except Exception as exc:  # noqa: BLE001 - 失败必须回滚
        shutil.copy2(backup, path)  # 从备份回滚
        result.update(
            ok=False,
            status="rolled-back",
            detail=f"{exc}（已从备份回滚）",
            backup=str(backup),
        )
    return result


def _print(results: list[dict[str, Any]], title: str) -> None:
    print(f"\n== {title} ==")
    if not results:
        print("  （无文件）")
        return
    for item in results:
        flag = "OK " if item["ok"] else "FAIL"
        print(f"  [{flag}] {item['status']:<14} {item['path']}")
        if item["detail"]:
            print(f"          {item['detail']}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="迁移 .netlab 为压缩容器")
    parser.add_argument("--dry-run", action="store_true", help="只报告，不改文件、不备份")
    parser.add_argument(
        "--include-appdata",
        action="store_true",
        help="连 %APPDATA% 下的工程也实跑（默认仅 dry-run 报告）",
    )
    args = parser.parse_args(argv)

    repo_targets = _collect_repo_targets()
    appdata_targets = _collect_appdata_targets()

    # repo 内文件：默认实跑（--dry-run 时只报告）
    repo_results = [migrate_file(p, dry_run=args.dry_run) for p in repo_targets]
    _print(repo_results, "repo 内工程" + ("（dry-run）" if args.dry_run else "（实跑）"))

    # %APPDATA%：默认只 dry-run 报告；--include-appdata 且非 --dry-run 才实跑
    appdata_dry = args.dry_run or not args.include_appdata
    appdata_results = [
        migrate_file(p, dry_run=appdata_dry) for p in appdata_targets
    ]
    appdata_title = (
        "%APPDATA% 工程（仅报告，需用户确认后加 --include-appdata 实跑）"
        if appdata_dry
        else "%APPDATA% 工程（实跑）"
    )
    _print(appdata_results, appdata_title)

    all_results = repo_results + appdata_results
    migrated = [r for r in all_results if r["status"] == "migrated"]
    failed = [r for r in all_results if not r["ok"]]
    print("\n== 汇总 ==")
    print(f"  处理 {len(all_results)} 个文件，实迁移 {len(migrated)} 个，失败 {len(failed)} 个")
    if migrated:
        print("  备份清单：")
        for r in migrated:
            print(f"    {r['backup']}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
