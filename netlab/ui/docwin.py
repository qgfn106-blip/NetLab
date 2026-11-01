"""文档窗：原生 Markdown 阅读器（对应旧前端 docWin 浮窗）。

用 ``QTextDocument.setMarkdown`` 直接渲染仓库里的 docs/*.md，
不再需要 WebEngine；外链交给系统浏览器。
"""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import QUrl, Qt
from PySide6.QtGui import QDesktopServices, QFont, QTextDocument
from PySide6.QtWidgets import (
    QHBoxLayout,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QTextBrowser,
    QWidget,
)

from .theme import FONT_FAMILY

DOCS_DIR = Path(__file__).resolve().parent.parent / "docs"


def doc_files() -> list[Path]:
    if not DOCS_DIR.is_dir():
        return []
    return sorted(path for path in DOCS_DIR.glob("*.md") if path.is_file())


class DocWindow(QMainWindow):
    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setWindowTitle("Netlab 文档")
        self.resize(1000, 760)
        host = QWidget(self)
        layout = QHBoxLayout(host)
        layout.setContentsMargins(0, 0, 0, 0)

        self.list = QListWidget(host)
        self.list.setMaximumWidth(240)
        for path in doc_files():
            item = QListWidgetItem(path.stem)
            item.setData(Qt.UserRole, str(path))
            self.list.addItem(item)
        self.list.currentItemChanged.connect(self._on_select)
        layout.addWidget(self.list)

        self.viewer = QTextBrowser(host)
        self.viewer.setOpenExternalLinks(False)
        self.viewer.anchorClicked.connect(lambda url: QDesktopServices.openUrl(url))
        self.viewer.setFont(QFont(FONT_FAMILY, 10))
        layout.addWidget(self.viewer, 1)
        self.setCentralWidget(host)
        if self.list.count():
            self.list.setCurrentRow(0)

    def _on_select(self, item: QListWidgetItem | None, _previous) -> None:
        if item is None:
            return
        path = Path(str(item.data(Qt.UserRole)))
        try:
            text = path.read_text(encoding="utf-8")
        except OSError as exc:
            self.viewer.setPlainText(f"无法读取 {path}：{exc}")
            return
        document = QTextDocument(self)
        document.setBaseUrl(QUrl.fromLocalFile(str(path.parent) + "/"))
        document.setMarkdown(text)
        self.viewer.setDocument(document)


__all__ = ["DOCS_DIR", "DocWindow", "doc_files"]
