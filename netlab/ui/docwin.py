"""文档窗：原生 Markdown 阅读器（对应旧前端 docWin 浮窗）。

只列**用户文档**（``netlab/docs/user/`` 的五篇，顺序与标题取自
``server.USER_DOC_ORDER``），不再把开发文档（PROGRESS/REQUIREMENTS 等）
混进列表——用户原话：「文档只收入用户相关文档，不收入开发文档」。
用 ``QTextDocument.setMarkdown`` 渲染，外链交给系统浏览器。
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

from .theme import FONT_FAMILY, tokens as theme_tokens

DOCS_DIR = Path(__file__).resolve().parent.parent / "docs" / "user"
DOC_TITLES: tuple[tuple[str, str], ...] = (
    ("quickstart", "欢迎 / 快速上手"),
    ("interface", "界面指南"),
    ("glossary", "术语表"),
    ("faq", "常见问题"),
    ("shortcuts", "快捷键"),
)


def doc_files() -> list[tuple[str, Path]]:
    """按用户文档顺序返回 ``(标题, 路径)``，缺失的条目自动跳过。"""
    out: list[tuple[str, Path]] = []
    for slug, title in DOC_TITLES:
        path = DOCS_DIR / f"{slug}.md"
        if path.is_file():
            out.append((title, path))
    return out


class DocWindow(QMainWindow):
    def __init__(self, parent: QWidget | None = None, tokens_map: dict | None = None) -> None:
        super().__init__(parent)
        self.setWindowTitle("Netlab 文档")
        self.resize(1000, 760)
        self._tokens = tokens_map or theme_tokens("light")
        host = QWidget(self)
        layout = QHBoxLayout(host)
        layout.setContentsMargins(0, 0, 0, 0)

        self.list = QListWidget(host)
        self.list.setMaximumWidth(240)
        for title, path in doc_files():
            item = QListWidgetItem(title)
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
        self._apply_theme()
        if self.list.count():
            self.list.setCurrentRow(0)

    def _apply_theme(self) -> None:
        paper = self._tokens.get("paper", "#eae5e1")
        panel = self._tokens.get("panel_bg", "#f7f4ec")
        ink = self._tokens.get("ink", "#080a08")
        muted = self._tokens.get("muted", "#6b6459")
        line = self._tokens.get("line", "#d5cec3")
        accent = self._tokens.get("accent", "#9b7247")
        self.setStyleSheet(
            f"""
            QMainWindow, QWidget {{ background: {paper}; }}
            QListWidget {{
                background: {panel}; color: {ink};
                border: none; border-right: 1px solid {line};
                padding: 6px 4px; outline: none;
            }}
            QListWidget::item {{ padding: 6px 10px; border-radius: 3px; }}
            QListWidget::item:selected {{ background: {accent}; color: {paper}; }}
            QListWidget::item:hover {{ background: {line}; }}
            QTextBrowser {{
                background: {paper}; color: {ink};
                border: none; padding: 18px 24px;
                selection-background-color: {accent};
            }}
            QScrollBar:vertical {{ background: transparent; width: 10px; }}
            QScrollBar::handle:vertical {{ background: {line}; border-radius: 5px; }}
            QScrollBar::add-line, QScrollBar::sub-line {{ height: 0; }}
            """
        )
        self.viewer.document().setDefaultStyleSheet(
            f"code {{ color: {muted}; }} th {{ background: {panel}; }}"
        )

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
