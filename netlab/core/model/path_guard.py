"""统一路径白名单（C-5 / N-22）。

工程、工作区和桌面桥只能读写显式允许根目录下的路径。默认允许：

- 当前用户主目录（覆盖 ``%APPDATA%`` 与桌面工程）；
- 当前工作目录及其子目录；
- 系统临时目录（测试与临时导出）。

部署方可用 ``NETLAB_ALLOWED_ROOTS``（``os.pathsep`` 分隔）追加受信根目录。
任何相对路径先按进程当前目录解析，再检查解析后的真实路径；``..`` 和符号链接
不能逃逸白名单。本模块只做路径边界检查，不负责创建目录。
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from ..common.limits import ValidationError


def allowed_roots() -> tuple[Path, ...]:
    """返回当前进程允许的根目录（已解析为绝对路径）。"""
    raw = os.environ.get("NETLAB_ALLOWED_ROOTS", "")
    if raw.strip():
        candidates = [item for item in raw.split(os.pathsep) if item.strip()]
    else:
        candidates = [str(Path.home()), str(Path.cwd()), str(Path(tempfile.gettempdir()))]
    roots: list[Path] = []
    for item in candidates:
        try:
            root = Path(item).expanduser().resolve()
        except OSError:
            continue
        if root not in roots:
            roots.append(root)
    return tuple(roots)


def _is_under(path: Path, root: Path) -> bool:
    try:
        resolved = path.resolve(strict=False)
    except OSError:
        return False
    return os.path.commonpath(
        (os.path.normcase(str(resolved)), os.path.normcase(str(root)))
    ) == os.path.normcase(str(root))


def ensure_allowed_path(target: str | os.PathLike[str], *, purpose: str = "路径") -> Path:
    """校验 ``target`` 位于允许根目录内，返回原始（未 resolve）Path。

    保持返回未解析路径是为了不改变既有调用方对相对路径/符号链接的写法；
    边界判定用解析后的真实路径。拒绝时抛 ``ValidationError``。
    """
    if target is None or not str(target).strip():
        raise ValidationError(f"{purpose}不能为空")
    path = Path(target).expanduser()
    roots = allowed_roots()
    if not any(_is_under(path, root) for root in roots):
        raise ValidationError(f"{purpose}不在允许的根目录内：{path}")
    return path
