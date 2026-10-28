"""工作区目录约定（R01 / D2 / D3）。

一个 **工程 = 一个目录**：

```
<project>/
  project.netlab     工程正本（内容仍是单文件 JSON，格式由 project.py 负责）
  blocks/            本工程自带的模块副本（只读引用优先用 library/）
  extensions/        本工程扩展
  exports/           CSV / 报告等导出物（不覆盖，同名加序号）
  backups/           快照式自动保存（D16，只写这里，不动正本）
```

**共享库**在工程父目录的 ``library/``（``blocks/``、``templates/``），单份存放，
不随每个工程复制；删除工程不会影响库。

**全局设置**跟人走：``%APPDATA%/Netlab/settings.json``（非 Windows 或测试时可用
环境变量 ``NETLAB_SETTINGS_DIR`` 覆盖，目录本身不会被自动创建在工程里）。
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from .limits import LimitError, ValidationError
from .project import (
    PROJECT_SUFFIX,
    atomic_write,
    build_project,
    load_project,
    save_project,
)
from .simulation import Simulation

PROJECT_FILENAME = "project.netlab"
PROJECT_SUBDIRS: tuple[str, ...] = ("blocks", "extensions", "exports", "backups")
SNAPSHOT_RE = re.compile(r"^snapshot-(\d{8})-(\d{6})-([0-9a-f]{8})\.netlab$")
LIBRARY_DIRNAME = "library"
LIBRARY_SUBDIRS: tuple[str, ...] = ("blocks", "templates")
SETTINGS_DIRNAME = "Netlab"
SETTINGS_ENV = "NETLAB_SETTINGS_DIR"
SETTINGS_FILENAME = "settings.json"
MAX_SETTINGS_BYTES = 256_000

DEFAULT_SETTINGS: dict[str, Any] = {
    "autosave_enabled": True,
    "autosave_interval_seconds": 60,
    "autosave_keep_recent": 10,
    "autosave_keep_daily": 1,
    "default_project_dir": "",
    "library_root": "",
    "theme": "system",
}

#: 设置项 → 类型/范围校验；未知键一律拒绝，避免隐藏配置。
_SETTINGS_RULES: dict[str, tuple[type, Any]] = {
    "autosave_enabled": (bool, None),
    "autosave_interval_seconds": (int, (5, 86_400)),
    "autosave_keep_recent": (int, (1, 200)),
    "autosave_keep_daily": (int, (0, 30)),
    "default_project_dir": (str, 1024),
    "library_root": (str, 1024),
    "theme": (str, None),
}
_THEMES = ("system", "light", "dark")


@dataclass(frozen=True)
class Workspace:
    """一个工程目录的路径视图；不持有任何运行时状态。"""

    root: Path
    library: Path

    @property
    def project_file(self) -> Path:
        return self.root / PROJECT_FILENAME

    def subdir(self, name: str) -> Path:
        if name not in PROJECT_SUBDIRS:
            raise ValidationError(f"未知工程子目录：{name!r}")
        return self.root / name

    def as_dict(self) -> dict[str, Any]:
        return {
            "root": str(self.root),
            "project_file": str(self.project_file),
            "library": str(self.library),
            "subdirs": {name: str(self.subdir(name)) for name in PROJECT_SUBDIRS},
            "exists": self.project_file.is_file(),
        }


# ---- 设置 ------------------------------------------------------------------
def settings_dir() -> Path:
    override = os.environ.get(SETTINGS_ENV, "").strip()
    if override:
        return Path(override).expanduser()
    appdata = os.environ.get("APPDATA", "").strip()
    if appdata:
        return Path(appdata) / SETTINGS_DIRNAME
    return Path.home() / ".config" / "netlab"


def settings_file() -> Path:
    return settings_dir() / SETTINGS_FILENAME


def default_settings() -> dict[str, Any]:
    return dict(DEFAULT_SETTINGS)


def _coerce_setting(key: str, value: Any) -> Any:
    expected, bounds = _SETTINGS_RULES[key]
    if expected is bool:
        if not isinstance(value, bool):
            raise ValidationError(f"设置 {key} 必须是布尔值")
        return value
    if expected is int:
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValidationError(f"设置 {key} 必须是整数")
        low, high = bounds
        if not (low <= value <= high):
            raise ValidationError(f"设置 {key} 必须在 {low}..{high} 之间")
        return value
    if expected is str:
        if not isinstance(value, str):
            raise ValidationError(f"设置 {key} 必须是字符串")
        limit = bounds if isinstance(bounds, int) else 1024
        if len(value) > limit:
            raise ValidationError(f"设置 {key} 过长")
        if key == "theme" and value not in _THEMES:
            raise ValidationError(f"设置 theme 必须是 {', '.join(_THEMES)} 之一")
        return value
    raise ValidationError(f"未知设置项：{key}")


def load_settings() -> dict[str, Any]:
    """读取用户设置；文件缺失或损坏时返回默认值（不静默改写文件）。"""
    target = settings_file()
    if not target.is_file():
        return default_settings()
    try:
        size = target.stat().st_size
        if size > MAX_SETTINGS_BYTES:
            raise LimitError("设置文件过大")
        raw = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default_settings()
    if not isinstance(raw, dict):
        return default_settings()
    settings = default_settings()
    for key, value in raw.items():
        if key not in _SETTINGS_RULES:
            continue
        try:
            settings[key] = _coerce_setting(key, value)
        except ValidationError:
            continue
    return settings


def save_settings(patch: dict[str, Any]) -> dict[str, Any]:
    """合并写入设置；未知键/类型错误直接拒绝，不做部分写入。"""
    if not isinstance(patch, dict):
        raise ValidationError("设置必须是对象")
    unknown = set(patch) - set(_SETTINGS_RULES)
    if unknown:
        raise ValidationError(f"未知设置项：{', '.join(sorted(unknown))}")
    settings = load_settings()
    for key, value in patch.items():
        settings[key] = _coerce_setting(key, value)
    target = settings_file()
    target.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(target, json.dumps(settings, ensure_ascii=False, indent=2))
    return settings


# ---- 路径与工程 -------------------------------------------------------------
def project_file_for(target: str | os.PathLike[str]) -> Path:
    """把「工程目录」或「.netlab 文件」统一解析为工程正本路径。

    规则：以 ``.netlab`` 结尾视为文件；已存在的目录、或没有扩展名的新路径视为
    工程目录（新建时目录可以还不存在）；其余一律拒绝，避免把任意文件当工程。
    """
    path = Path(target).expanduser()
    suffix = path.suffix.lower()
    if suffix == PROJECT_SUFFIX:
        return path
    if path.is_dir():
        return path / PROJECT_FILENAME
    if suffix == "":
        return path / PROJECT_FILENAME
    raise ValidationError(f"不是 Netlab 工程路径：{path}")


def workspace_for(target: str | os.PathLike[str], *, library_root: str | None = None) -> Workspace:
    """由工程路径得到工作区视图；库默认在工程父目录的 ``library/``。"""
    project_file = project_file_for(target)
    root = project_file.parent
    if library_root:
        library = Path(library_root).expanduser()
    else:
        library = root.parent / LIBRARY_DIRNAME
    return Workspace(root=root.resolve(), library=library.resolve())


def ensure_library(library: str | os.PathLike[str]) -> Path:
    """建立/补全共享库目录树；已存在时保持原样（幂等）。"""
    target = Path(library).expanduser()
    target.mkdir(parents=True, exist_ok=True)
    for name in LIBRARY_SUBDIRS:
        (target / name).mkdir(exist_ok=True)
    return target.resolve()


def scan_library(workspace: Workspace) -> dict[str, Any]:
    """列出库里可见的模块与模板文件；只读，不加载内容。"""

    def files(subdir: str, suffixes: tuple[str, ...]) -> list[dict[str, Any]]:
        base = workspace.library / subdir
        if not base.is_dir():
            return []
        result = []
        for item in sorted(base.rglob("*")):
            if not item.is_file() or item.suffix.lower() not in suffixes:
                continue
            result.append(
                {
                    "name": item.name,
                    "path": str(item),
                    "size": item.stat().st_size,
                    "version": item.stem,
                }
            )
        return result

    return {
        "library": str(workspace.library),
        "exists": workspace.library.is_dir(),
        "blocks": files("blocks", (".block",)),
        "templates": files("templates", (".netlab", ".scene", ".json")),
    }


def create_project(
    target: str | os.PathLike[str],
    *,
    simulation: Simulation | None = None,
    payload: dict[str, Any] | None = None,
    name: str | None = None,
    library_root: str | None = None,
) -> tuple[Workspace, dict[str, Any]]:
    """按目录模板新建工程；已存在正本时拒绝，绝不覆盖。"""
    project_file = project_file_for(target)
    if project_file.exists():
        raise ValidationError(f"工程已存在，拒绝覆盖：{project_file}")
    root = project_file.parent
    root.mkdir(parents=True, exist_ok=True)
    for subdir in PROJECT_SUBDIRS:
        (root / subdir).mkdir(exist_ok=True)
    workspace = workspace_for(project_file, library_root=library_root)
    ensure_library(workspace.library)
    if payload is None:
        if simulation is None:
            raise ValidationError("新建工程需要 simulation 或 payload")
        project = build_project(simulation, name=name)
        atomic_write(project_file, project)
    else:
        project = dict(payload)
        if name:
            project["name"] = str(name)[:120]
        project = _write_payload(project_file, project)
    return workspace, project


def _write_payload(path: Path, payload: dict[str, Any]) -> dict[str, Any]:
    from .project import compute_checksum, migrate_project, verify_checksum

    project = migrate_project(payload)
    if not verify_checksum(project):
        project.pop("checksum", None)
        project["checksum"] = compute_checksum(project)
    atomic_write(path, project)
    return project


def load_workspace(
    target: str | os.PathLike[str], *, library_root: str | None = None
) -> tuple[Workspace, dict[str, Any]]:
    """打开工程目录（或单文件工程），返回工作区视图与已校验工程。

    引用式工程需要 library 才能解析块，因此这里把 workspace.library 传给校验。
    """
    project_file = project_file_for(target)
    workspace = workspace_for(project_file, library_root=library_root)
    project = load_project(project_file, library=str(workspace.library))
    return workspace, project


def scan_block_references(
    root: str | os.PathLike[str], block_id: str, *, version: int | None = None
) -> list[dict[str, str]]:
    """在目录树里找引用了该模块的工程文件（D6：删除前扫描所有工程）。

    只读 JSON，不做完整校验；跳过 ``*.bak``、``backups/`` 与快照文件。
    """
    base = Path(root).expanduser()
    if not base.is_dir():
        return []
    hits: list[dict[str, str]] = []
    for path in sorted(base.rglob("*.netlab")):
        if path.name.endswith(".bak") or "backups" in path.parts:
            continue
        if path.name.startswith("snapshot-"):
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        blocks = payload.get("blocks") if isinstance(payload, dict) else None
        if not isinstance(blocks, list):
            continue
        for item in blocks:
            if not isinstance(item, dict) or str(item.get("id")) != block_id:
                continue
            if version is not None and int(item.get("version") or 1) != version:
                continue
            hits.append(
                {
                    "path": str(path),
                    "name": str(payload.get("name") or path.stem),
                    "version": str(int(item.get("version") or 1)),
                }
            )
            break
    return hits


# ---- 快照（R16 / D16） -----------------------------------------------------
def _snapshot_dir(workspace: Workspace) -> Path:
    return workspace.subdir("backups")


def _parse_snapshot(path: Path) -> datetime | None:
    match = SNAPSHOT_RE.match(path.name)
    if match is None:
        return None
    try:
        return datetime.strptime(match.group(1) + match.group(2), "%Y%m%d%H%M%S")
    except ValueError:
        return None


def list_snapshots(workspace: Workspace) -> list[dict[str, Any]]:
    """列出快照（新→旧）；无法解析命名的文件不参与，也不被删除。"""
    base = _snapshot_dir(workspace)
    if not base.is_dir():
        return []
    items: list[tuple[datetime, Path]] = []
    for path in base.iterdir():
        if not path.is_file():
            continue
        created = _parse_snapshot(path)
        if created is None:
            continue
        items.append((created, path))
    items.sort(key=lambda pair: pair[0], reverse=True)
    return [
        {
            "name": path.name,
            "created": created.isoformat(),
            "day": created.strftime("%Y-%m-%d"),
            "size": path.stat().st_size,
        }
        for created, path in items
    ]


def write_snapshot(
    workspace: Workspace,
    project: dict[str, Any],
    *,
    now: datetime | None = None,
    tag: str = "",
) -> Path:
    """写一份快照到 backups/；文件名唯一，绝不覆盖正本或旧快照。"""
    base = _snapshot_dir(workspace)
    base.mkdir(parents=True, exist_ok=True)
    stamp = now or datetime.now()
    unique = (tag or os.urandom(4).hex())[:8]
    if not re.fullmatch(r"[0-9a-z]{8}", unique):
        unique = os.urandom(4).hex()
    target = base / f"snapshot-{stamp:%Y%m%d-%H%M%S}-{unique}.netlab"
    if target.exists():
        target = base / f"snapshot-{stamp:%Y%m%d-%H%M%S}-{os.urandom(4).hex()}.netlab"
    # 快照必须能独立打开：先迁移/补齐校验和，别把半成品写进备份区。
    from .project import compute_checksum, migrate_project, verify_checksum

    snapshot = migrate_project(project)
    if not verify_checksum(snapshot):
        snapshot.pop("checksum", None)
        snapshot["checksum"] = compute_checksum(snapshot)
    rendered = json.dumps(snapshot, ensure_ascii=False, indent=2, allow_nan=False)
    atomic_write(target, rendered)
    return target


def prune_snapshots(
    workspace: Workspace,
    *,
    keep_recent: int = 10,
    keep_daily: int = 1,
) -> list[str]:
    """保留最近 N 份 + 每天最多 1 份；返回被删除的文件名。"""
    items = list_snapshots(workspace)
    if not items:
        return []
    keep: set[str] = set()
    for item in items[: max(0, keep_recent)]:
        keep.add(item["name"])
    days: list[str] = []
    for item in items:
        if len(days) >= max(0, keep_daily):
            break
        if item["day"] not in days:
            days.append(item["day"])
            keep.add(item["name"])
    removed: list[str] = []
    base = _snapshot_dir(workspace)
    for item in items:
        if item["name"] in keep:
            continue
        try:
            (base / item["name"]).unlink()
            removed.append(item["name"])
        except OSError:
            continue
    return removed


def load_snapshot(workspace: Workspace, name: str) -> dict[str, Any]:
    """按快照文件名恢复；名字必须匹配快照命名，杜绝路径穿越。"""
    if not isinstance(name, str) or SNAPSHOT_RE.match(name) is None:
        raise ValidationError(f"不是合法的快照文件名：{name!r}")
    path = _snapshot_dir(workspace) / name
    if not path.is_file():
        raise ValidationError(f"快照不存在：{name}")
    return load_project(path)


def save_workspace(
    target: str | os.PathLike[str],
    simulation: Simulation,
    *,
    fem: Any | None = None,
    name: str | None = None,
    library_root: str | None = None,
    **kwargs: Any,
) -> tuple[Workspace, Path]:
    """把当前运行状态保存进工程目录（目录不存在则按模板补齐）。"""
    project_file = project_file_for(target)
    root = project_file.parent
    root.mkdir(parents=True, exist_ok=True)
    for subdir in PROJECT_SUBDIRS:
        (root / subdir).mkdir(exist_ok=True)
    workspace = workspace_for(project_file, library_root=library_root)
    ensure_library(workspace.library)
    # 先把工程用到的块同步进库，再按引用式保存（D4）。
    from . import blocklib

    with simulation.lock:
        payloads = simulation.scene.blocks.export_user()
    blocklib.ensure_blocks(workspace.library, payloads)
    path = save_project(
        project_file,
        simulation,
        fem,
        name=name,
        library=str(workspace.library),
        **kwargs,
    )
    return workspace, path


__all__ = [
    "PROJECT_FILENAME",
    "PROJECT_SUBDIRS",
    "LIBRARY_DIRNAME",
    "LIBRARY_SUBDIRS",
    "SETTINGS_ENV",
    "DEFAULT_SETTINGS",
    "Workspace",
    "settings_dir",
    "settings_file",
    "default_settings",
    "load_settings",
    "save_settings",
    "project_file_for",
    "workspace_for",
    "ensure_library",
    "scan_library",
    "scan_block_references",
    "create_project",
    "load_workspace",
    "save_workspace",
]
