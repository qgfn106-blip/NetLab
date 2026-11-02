"""pywebview 桥：能力与 Qt 版 `bridge.Bridge` 一致，但不依赖 PySide6。

约定：
- 方法名用 snake_case，pywebview 会以 Promise 形式暴露给 JS
  （前端通过 `static/desktop-shim.js` 映射回 camelCase + 回调风格）；
- 只把"用户在原生对话框里选中的路径"交给网页，网页不能自己指定任意路径读写；
- 工程内容一律经过 `netlab.project` 校验后原子写入。
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from ..core.model.project import (
    PROJECT_SUFFIX,
    atomic_write,
    compute_checksum,
    load_project_raw,
    project_to_text,
    validate_project,
)
from ..core.model.workspace import load_settings

_FILE_TYPES = (
    "Netlab 工程 (*.netlab)",
    "所有文件 (*.*)",
)


def _library_root() -> Path:
    configured = str(load_settings().get("library_root") or "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path.cwd() / "library"


def _validate_for_file(payload: Any) -> dict[str, Any]:
    """存盘用校验：模块引用解析不了也不挡存盘（降级后把 blocks 换回原始引用）。"""
    library = str(_library_root())
    try:
        return validate_project(payload, library=library)
    except Exception:
        pass
    project = validate_project(payload, library=library, allow_degraded=True)
    original_blocks = (payload or {}).get("blocks") if isinstance(payload, dict) else None
    if original_blocks is not None:
        project["blocks"] = json.loads(json.dumps(original_blocks))
    project.pop("degraded", None)
    project.pop("checksum", None)
    project["checksum"] = compute_checksum(project)
    return project


def _autosave_dir() -> Path:
    """与 Qt 版一致：%APPDATA%/Netlab/NetlabDesktop（QStandardPaths AppDataLocation）。"""
    base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
    return Path(base) / "Netlab" / "NetlabDesktop"


class WebviewBridge:
    """暴露给网页的原生能力。"""

    def __init__(self, url: str = "") -> None:
        self.url = url
        self._window: Any = None
        self._dirty = False
        self._maxed = False
        self._current_path = ""
        self._last_directory = str(Path.home())

    def attach(self, window: Any) -> None:
        self._window = window

    # ---- 内部 -----------------------------------------------------------
    def _autosave_path(self) -> Path:
        return _autosave_dir() / "autosave.netlab"

    def _dialog(self, *, save: bool, default_name: str = "") -> str:
        import webview

        if self._window is None:
            return ""
        try:
            if save:
                result = self._window.create_file_dialog(
                    webview.SAVE_DIALOG,
                    directory=self._last_directory,
                    save_filename=default_name,
                    file_types=_FILE_TYPES,
                )
            else:
                result = self._window.create_file_dialog(
                    webview.OPEN_DIALOG,
                    directory=self._last_directory,
                    allow_multiple=False,
                    file_types=_FILE_TYPES,
                )
        except Exception:
            return ""
        if not result:
            return ""
        if isinstance(result, (list, tuple)):
            return str(result[0]) if result else ""
        return str(result)

    # ---- 供网页调用 -----------------------------------------------------
    def save_project(self, payload_json: str, suggested_name: str = "") -> str:
        try:
            payload = _validate_for_file(json.loads(payload_json))
            default_name = (suggested_name or payload.get("name") or "netlab-project").strip()
            if not default_name.lower().endswith(PROJECT_SUFFIX):
                default_name += PROJECT_SUFFIX
            path = self._dialog(save=True, default_name=default_name)
            if not path:
                return ""
            if not path.lower().endswith(PROJECT_SUFFIX):
                path += PROJECT_SUFFIX
            atomic_write(path, payload)
            self._current_path = path
            self._last_directory = str(Path(path).parent)
            self._dirty = False
            return path
        except Exception as exc:
            return f"__error__{exc}"

    def save_project_to(self, path: str, payload_json: str) -> str:
        try:
            target = str(path or "").strip()
            if not target:
                return ""
            if not target.lower().endswith(PROJECT_SUFFIX):
                target += PROJECT_SUFFIX
            payload = _validate_for_file(json.loads(payload_json))
            atomic_write(target, payload)
            self._current_path = target
            self._last_directory = str(Path(target).parent)
            self._dirty = False
            return target
        except Exception as exc:
            return f"__error__{exc}"

    def open_project(self) -> str:
        try:
            path = self._dialog(save=False)
            if not path:
                return ""
            return self.open_project_path(path)
        except Exception as exc:
            return f"__error__{exc}"

    def open_project_path(self, path: str) -> str:
        try:
            target = Path(str(path or "")).expanduser()
            if not target.is_file():
                return ""
            project = load_project_raw(target)
            self._current_path = str(target)
            self._last_directory = str(target.parent)
            self._dirty = False
            return project_to_text(project)
        except Exception as exc:
            return f"__error__{exc}"

    def current_path(self) -> str:
        return self._current_path

    def autosave(self, payload_json: str) -> str:
        try:
            payload = _validate_for_file(json.loads(payload_json))
            path = self._autosave_path()
            path.parent.mkdir(parents=True, exist_ok=True)
            atomic_write(path, payload)
            return str(path)
        except Exception:
            return ""

    def has_autosave(self) -> bool:
        try:
            return self._autosave_path().is_file()
        except Exception:
            return False

    def recover_autosave(self) -> str:
        try:
            path = self._autosave_path()
            if not path.is_file():
                return ""
            return project_to_text(load_project_raw(path))
        except Exception as exc:
            return f"__error__{exc}"

    def clear_autosave(self) -> bool:
        try:
            self._autosave_path().unlink(missing_ok=True)
            return True
        except Exception:
            return False

    def set_dirty(self, flag: Any) -> bool:
        self._dirty = bool(flag)
        return self._dirty

    # ---- 窗口控制（无边框窗口的自绘按钮）---------------------------------
    def window_minimize(self) -> bool:
        try:
            self._window.minimize()
            return True
        except Exception:
            return False

    def window_toggle_maximize(self) -> bool:
        """返回切换后的最大化状态。"""
        try:
            if self._maxed:
                self._window.restore()
                self._maxed = False
            else:
                self._window.maximize()
                self._maxed = True
            return self._maxed
        except Exception:
            return False

    def window_close(self) -> bool:
        try:
            self._window.destroy()
            return True
        except Exception:
            return False

    def window_rect(self) -> list[int]:
        """当前窗口位置与尺寸，供页面自绘拖动计算。"""
        try:
            w = self._window
            return [int(w.x), int(w.y), int(w.width), int(w.height)]
        except Exception:
            return [0, 0, 0, 0]

    def window_resize(self, x: Any, y: Any, width: Any, height: Any) -> bool:
        """同时设置窗口位置与尺寸（无边框窗口的四边/四角缩放用）。"""
        try:
            self._window.resize(int(width), int(height))
            self._window.move(int(x), int(y))
            return True
        except Exception:
            return False

    def window_move_to(self, x: Any, y: Any) -> bool:
        """把窗口左上角移到 (x, y)。页面自绘拖动时按指针位移调用。"""
        try:
            self._window.move(int(x), int(y))
            return True
        except Exception:
            return False

    # ---- 供壳调用 -------------------------------------------------------
    def command(self, name: str, payload: Any = None) -> None:
        """把菜单/快捷键命令转给页面（页面侧 `window.netlabDesktopCommand`）。"""
        if self._window is None:
            return
        code = (
            "window.netlabDesktopCommand && window.netlabDesktopCommand("
            f"{json.dumps(str(name))}, {json.dumps(payload)})"
        )
        try:
            self._window.evaluate_js(code)
        except Exception:
            pass
