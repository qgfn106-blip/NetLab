"""原生主窗口：菜单、最近文件、快捷键、关闭确认与 WebChannel 注入。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

try:  # pragma: no cover - 依赖桌面环境
    from PySide6.QtCore import QFile, QIODevice, QSettings, Qt, QUrl
    from PySide6.QtGui import QAction, QCloseEvent, QKeySequence
    from PySide6.QtWebChannel import QWebChannel
    from PySide6.QtWebEngineCore import QWebEngineScript
    from PySide6.QtWebEngineWidgets import QWebEngineView
    from PySide6.QtWidgets import (
        QFileDialog,
        QMainWindow,
        QMessageBox,
        QStatusBar,
    )
except Exception as exc:  # pragma: no cover
    raise RuntimeError("桌面模式需要 PySide6：pip install -r requirements-desktop.txt") from exc

from ..project import PROJECT_SUFFIX, atomic_write, project_to_text, validate_project
from .bridge import Bridge

WEBCHANNEL_JS = ""


def _qwebchannel_source() -> str:
    global WEBCHANNEL_JS
    if WEBCHANNEL_JS:
        return WEBCHANNEL_JS
    file = QFile(":/qtwebchannel/qwebchannel.js")
    if file.open(QIODevice.OpenModeFlag.ReadOnly):
        try:
            data = bytes(file.readAll())
            WEBCHANNEL_JS = data.decode("utf-8")
        finally:
            file.close()
    return WEBCHANNEL_JS


class MainWindow(QMainWindow):
    def __init__(self, url: str, *, debug: bool = False) -> None:
        super().__init__()
        self.url = url
        self.debug = debug
        self.settings = QSettings("Netlab", "NetlabDesktop")
        self.bridge = Bridge(self)
        self.view = QWebEngineView(self)
        self.setCentralWidget(self.view)
        self.setWindowTitle("Netlab · 拓扑网络仿真台")
        self.resize(1500, 940)
        self._build_menus()
        self._restore_geometry()
        self._install_webchannel()

        self.bridge.projectSaved.connect(self._on_project_saved)
        self.bridge.errorRaised.connect(self._on_bridge_error)
        self.bridge.dirtyChanged.connect(self._on_dirty_changed)
        self.bridge.projectLoaded.connect(lambda _text: self._on_project_loaded())
        self.view.loadFinished.connect(self._on_load_finished)
        self.view.setUrl(QUrl(url))

        status = QStatusBar(self)
        status.showMessage("桌面模式 · 本地服务已就绪")
        self.setStatusBar(status)

    # ---- 菜单 -------------------------------------------------------------
    def _build_menus(self) -> None:
        bar = self.menuBar()
        file_menu = bar.addMenu("文件(&F)")
        self._action(file_menu, "新建工程", "Ctrl+N", lambda: self.command("new"))
        self._action(file_menu, "打开工程…", "Ctrl+O", lambda: self.command("open"))
        self.recent_menu = file_menu.addMenu("最近工程")
        self._refresh_recent_menu()
        file_menu.addSeparator()
        self._action(file_menu, "保存", "Ctrl+S", lambda: self.command("save"))
        self._action(file_menu, "另存为…", "Ctrl+Shift+S", lambda: self.command("saveAs"))
        file_menu.addSeparator()
        self._action(file_menu, "恢复自动保存…", "", lambda: self.command("recover"))
        file_menu.addSeparator()
        self._action(file_menu, "退出", "Ctrl+Q", self.close)

        view_menu = bar.addMenu("视图(&V)")
        self._action(view_menu, "重新载入", "Ctrl+R", self.view.reload)
        self._action(view_menu, "放大", "Ctrl+=", lambda: self._zoom(1.15))
        self._action(view_menu, "缩小", "Ctrl+-", lambda: self._zoom(1 / 1.15))
        self._action(view_menu, "重置缩放", "Ctrl+0", lambda: self.view.setZoomFactor(1.0))
        view_menu.addSeparator()
        self._action(view_menu, "开发者工具", "F12", self._toggle_devtools)
        view_menu.addSeparator()
        self._action(view_menu, "适配网络视图", "Ctrl+F", lambda: self.command("fit"))

        help_menu = bar.addMenu("帮助(&H)")
        self._action(help_menu, "快捷键与操作", "F1", lambda: self.command("help"))
        self._action(help_menu, "关于 Netlab", "", self._about)

    def _action(self, menu: Any, text: str, shortcut: str, callback: Any) -> QAction:
        action = QAction(text, self)
        if shortcut:
            action.setShortcut(QKeySequence(shortcut))
        action.triggered.connect(callback)
        menu.addAction(action)
        return action

    def _zoom(self, factor: float) -> None:
        self.view.setZoomFactor(max(0.4, min(3.0, self.view.zoomFactor() * factor)))

    def _toggle_devtools(self) -> None:
        if not hasattr(self, "dev_page"):
            from PySide6.QtWebEngineWidgets import QWebEngineView as _View

            self.dev_page = _View()
            self.dev_page.setWindowTitle("Netlab DevTools")
            self.dev_page.resize(1000, 700)
            self.dev_page.page().setInspectedPage(self.view.page())
            self.view.page().setDevToolsPage(self.dev_page.page())
        self.dev_page.show()
        self.dev_page.raise_()

    # ---- WebChannel --------------------------------------------------------
    def _install_webchannel(self) -> None:
        channel = QWebChannel(self.view.page())
        channel.registerObject("bridge", self.bridge)
        self.view.page().setWebChannel(channel)
        source = _qwebchannel_source()
        init = """
        (function () {
          if (typeof QWebChannel === 'undefined' || !window.qt || !window.qt.webChannelTransport) {
            return;
          }
          new QWebChannel(window.qt.webChannelTransport, function (channel) {
            window.netlabDesktop = channel.objects.bridge;
            window.dispatchEvent(new Event('netlab-desktop-ready'));
          });
        })();
        """
        script = QWebEngineScript()
        script.setName("netlab-webchannel")
        script.setSourceCode(source + "\n" + init)
        script.setInjectionPoint(QWebEngineScript.InjectionPoint.DocumentReady)
        script.setWorldId(QWebEngineScript.ScriptWorldId.MainWorld)
        script.setRunsOnSubFrames(False)
        self.view.page().scripts().insert(script)

    def command(self, name: str, payload: Any = None) -> None:
        if payload is None:
            code = f"window.netlabDesktopCommand && window.netlabDesktopCommand({json.dumps(name)})"
        else:
            code = (
                "window.netlabDesktopCommand && window.netlabDesktopCommand("
                f"{json.dumps(name)}, {json.dumps(payload, ensure_ascii=False)})"
            )
        self.view.page().runJavaScript(code)

    def _on_load_finished(self, ok: bool) -> None:
        if not ok:
            self.statusBar().showMessage("页面加载失败，请检查本地服务")
            return
        self.statusBar().showMessage(f"本地服务：{self.url}")

    # ---- 最近工程/标题 -----------------------------------------------------
    def _recent_paths(self) -> list[str]:
        raw = self.settings.value("recent", [])
        if isinstance(raw, str):
            raw = [raw]
        return [str(item) for item in (raw or []) if Path(str(item)).is_file()]

    def _refresh_recent_menu(self) -> None:
        self.recent_menu.clear()
        paths = self._recent_paths()
        if not paths:
            empty = self.recent_menu.addAction("（暂无）")
            empty.setEnabled(False)
            return
        for path in paths[:10]:
            action = self.recent_menu.addAction(Path(path).name)
            action.setToolTip(path)
            action.triggered.connect(lambda _checked=False, p=path: self.command("open-path", p))
        self.recent_menu.addSeparator()
        clear = self.recent_menu.addAction("清空最近列表")
        clear.triggered.connect(self._clear_recent)

    def _remember_recent(self, path: str) -> None:
        paths = [item for item in self._recent_paths() if item != path]
        paths.insert(0, path)
        self.settings.setValue("recent", paths[:10])
        self._refresh_recent_menu()

    def _clear_recent(self) -> None:
        self.settings.setValue("recent", [])
        self._refresh_recent_menu()

    def _on_project_saved(self, path: str) -> None:
        self._remember_recent(path)
        self.statusBar().showMessage(f"已保存：{path}", 6000)

    def _on_project_loaded(self) -> None:
        path = self.bridge.currentPath()
        if path:
            self._remember_recent(path)
            self.statusBar().showMessage(f"已打开：{path}", 6000)

    def _on_bridge_error(self, message: str) -> None:
        self.statusBar().showMessage(message, 10000)

    def _on_dirty_changed(self, dirty: bool) -> None:
        self._dirty = dirty
        self.update_title(self.bridge.currentPath(), dirty)

    def update_title(self, path: str, dirty: bool) -> None:
        name = Path(path).name if path else "未命名工程"
        mark = " •" if dirty else ""
        self.setWindowTitle(f"Netlab · {name}{mark}")

    # ---- 关闭 -------------------------------------------------------------
    def closeEvent(self, event: QCloseEvent) -> None:  # noqa: N802
        if getattr(self, "_dirty", False):
            box = QMessageBox(self)
            box.setWindowTitle("退出 Netlab")
            box.setText("工程有未保存的修改。")
            box.setInformativeText("保存操作可以在主界面的「工程」面板完成；现在仍要退出吗？")
            box.setStandardButtons(
                QMessageBox.StandardButton.Discard | QMessageBox.StandardButton.Cancel
            )
            box.setDefaultButton(QMessageBox.StandardButton.Cancel)
            if box.exec() != QMessageBox.StandardButton.Discard:
                event.ignore()
                return
        self._save_geometry()
        event.accept()

    def _restore_geometry(self) -> None:
        geometry = self.settings.value("geometry")
        if geometry is not None:
            try:
                self.restoreGeometry(geometry)
            except Exception:
                pass

    def _save_geometry(self) -> None:
        try:
            self.settings.setValue("geometry", self.saveGeometry())
            self.settings.sync()
        except Exception:
            pass

    def _about(self) -> None:
        QMessageBox.about(
            self,
            "关于 Netlab",
            "Netlab 拓扑网络仿真台\n\n"
            "PySide6 + QtWebEngine 桌面外壳，复用现有 Canvas 前端与 Python 计算内核。\n"
            "本地服务仅监听 127.0.0.1；工程文件为版本化 JSON，保存使用原子替换。\n\n"
            "计算：NumPy / SciPy / 可选 CuPy；仿真顺序与 CPU 路径保持一致。",
        )


__all__ = ["MainWindow", "PROJECT_SUFFIX", "atomic_write", "validate_project", "project_to_text"]
