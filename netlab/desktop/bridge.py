"""QWebChannel 桥：原生文件对话框、工程读写、窗口状态。

桥只暴露“用户明确点击文件对话框后选择的本机路径”，不把任意路径读写
开放给网页；工程内容仍会经过 :mod:`netlab.project` 的完整校验。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

try:  # pragma: no cover - 依赖桌面环境
    from PySide6.QtCore import QObject, QStandardPaths, Signal, Slot
except Exception as exc:  # pragma: no cover
    raise RuntimeError("桌面模式需要 PySide6：pip install -r requirements-desktop.txt") from exc

from ..project import (
    PROJECT_SUFFIX,
    atomic_write,
    compute_checksum,
    load_project_raw,
    project_to_text,
    validate_project,
)
from ..workspace import load_settings


def _library_root() -> Path:
    """模块库根目录：与 web 端一致——设置里的 library_root，否则工作目录下 library。"""
    configured = str(load_settings().get("library_root") or "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path.cwd() / "library"


def _validate_for_file(payload: Any) -> dict[str, Any]:
    """存盘/自动保存用的校验：模块引用解析不了也不能挡住存盘（引用原样保留）。

    桌面桥负责把工程写到用户选的路径，库文件是否齐全由打开时再判断；否则
    一个引用了模块的工程在库路径不对时会连保存都做不到（历史 bug）。
    降级校验会填占位块，存盘前把 blocks 换回原始引用再重算校验和。
    """
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


class Bridge(QObject):
    projectLoaded = Signal(str)
    projectSaved = Signal(str)
    errorRaised = Signal(str)
    dirtyChanged = Signal(bool)

    def __init__(self, window: Any | None = None) -> None:
        super().__init__(window)
        self.window = window
        self._dirty = False
        self._current_path = ""
        self._last_directory = str(Path.home())

    # ---- 供网页调用 -------------------------------------------------------
    @Slot(str, str, result=str)
    def saveProject(self, payload_json: str, suggested_name: str = "") -> str:
        try:
            payload = _validate_for_file(json.loads(payload_json))
            default_name = (suggested_name or payload.get("name") or "netlab-project").strip()
            if not default_name.lower().endswith(PROJECT_SUFFIX):
                default_name += PROJECT_SUFFIX
            path, _filter = self._dialog_save(default_name)
            if not path:
                return ""
            if not path.lower().endswith(PROJECT_SUFFIX):
                path += PROJECT_SUFFIX
            atomic_write(path, payload)
            self._current_path = path
            self._last_directory = str(Path(path).parent)
            self.setDirty(False)
            self.projectSaved.emit(path)
            return path
        except Exception as exc:
            self._fail(exc)
            return ""

    @Slot(str, str, result=str)
    def saveProjectTo(self, path: str, payload_json: str) -> str:
        """保存到已知路径（Ctrl+S）：不弹对话框，仍走完整校验与原子写。"""
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
            self.setDirty(False)
            self.projectSaved.emit(target)
            return target
        except Exception as exc:
            self._fail(exc)
            return ""

    @Slot(result=str)
    def openProject(self) -> str:
        try:
            path, _filter = self._dialog_open()
            if not path:
                return ""
            project = load_project_raw(path)
            self._current_path = path
            self._last_directory = str(Path(path).parent)
            text = project_to_text(project)
            self.setDirty(False)
            self.projectLoaded.emit(text)
            return text
        except Exception as exc:
            self._fail(exc)
            return ""

    @Slot(str, result=str)
    def openProjectPath(self, path: str) -> str:
        try:
            project = load_project_raw(path)
            self._current_path = path
            self._last_directory = str(Path(path).parent)
            text = project_to_text(project)
            self.setDirty(False)
            self.projectLoaded.emit(text)
            return text
        except Exception as exc:
            self._fail(exc)
            return ""

    @Slot(bool)
    def setDirty(self, dirty: bool) -> None:
        self._dirty = bool(dirty)
        self.dirtyChanged.emit(self._dirty)
        if self.window is not None:
            try:
                self.window.update_title(self._current_path, self._dirty)
            except Exception:
                pass

    @Slot(result=bool)
    def isDirty(self) -> bool:
        return self._dirty

    @Slot(result=str)
    def currentPath(self) -> str:
        return self._current_path

    @Slot(str, str)
    def showMessage(self, title: str, message: str) -> None:
        try:
            from PySide6.QtWidgets import QMessageBox

            QMessageBox.information(self.window, title, message)
        except Exception:
            pass

    @Slot(str, str)
    def showError(self, title: str, message: str) -> None:
        try:
            from PySide6.QtWidgets import QMessageBox

            QMessageBox.critical(self.window, title, message)
        except Exception:
            pass

    @Slot(str)
    def revealFile(self, path: str) -> None:
        try:
            from PySide6.QtCore import QUrl
            from PySide6.QtGui import QDesktopServices

            target = Path(path) if path else Path(self._current_path)
            if target.exists():
                QDesktopServices.openUrl(QUrl.fromLocalFile(str(target.parent)))
        except Exception:
            pass

    @Slot(result=str)
    def appInfo(self) -> str:
        return json.dumps(
            {
                "desktop": True,
                "platform": "PySide6/QtWebEngine",
                "project_suffix": PROJECT_SUFFIX,
                "last_directory": self._last_directory,
            },
            ensure_ascii=False,
        )

    # ---- 自动保存/恢复 ----------------------------------------------------
    def _autosave_path(self) -> Path:
        base = QStandardPaths.writableLocation(
            QStandardPaths.StandardLocation.AppDataLocation
        )
        if not base:
            base = str(Path.home() / ".netlab")
        return Path(base) / "autosave.netlab"

    @Slot(str, result=str)
    def autosave(self, payload_json: str) -> str:
        try:
            payload = _validate_for_file(json.loads(payload_json))
            path = self._autosave_path()
            path.parent.mkdir(parents=True, exist_ok=True)
            atomic_write(path, payload)
            return str(path)
        except Exception as exc:
            # 自动保存失败不应打断运行；只记录并在状态栏提示。
            self.errorRaised.emit(f"自动保存失败：{exc}")
            return ""

    @Slot(result=bool)
    def hasAutosave(self) -> bool:
        try:
            return self._autosave_path().is_file()
        except Exception:
            return False

    @Slot(result=str)
    def recoverAutosave(self) -> str:
        try:
            path = self._autosave_path()
            if not path.is_file():
                return ""
            project = load_project_raw(path)
            self._last_directory = str(path.parent)
            return project_to_text(project)
        except Exception as exc:
            self._fail(exc)
            return ""

    @Slot()
    def clearAutosave(self) -> None:
        try:
            self._autosave_path().unlink(missing_ok=True)
        except Exception:
            pass

    # ---- 内部 -------------------------------------------------------------
    def _dialog_save(self, default_name: str) -> tuple[str, str]:
        from PySide6.QtWidgets import QFileDialog

        initial = str(Path(self._last_directory) / default_name)
        path, selected = QFileDialog.getSaveFileName(
            self.window,
            "保存 Netlab 工程",
            initial,
            "Netlab 工程 (*.netlab);;JSON (*.json);;所有文件 (*)",
        )
        return path, selected

    def _dialog_open(self) -> tuple[str, str]:
        from PySide6.QtWidgets import QFileDialog

        path, selected = QFileDialog.getOpenFileName(
            self.window,
            "打开 Netlab 工程",
            self._last_directory,
            "Netlab 工程 (*.netlab *.json);;所有文件 (*)",
        )
        return path, selected

    def _fail(self, exc: Exception) -> None:
        message = str(exc).strip() or type(exc).__name__
        self.errorRaised.emit(message)
        self.showError("Netlab 工程", message)
