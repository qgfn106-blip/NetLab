"""主题：一份 token → QSS。

token 与 ``static/style.css`` 的 CSS 变量一一对应（spec 约束 C9/C13）：
换框架不换外观，颜色、字号、间距都从同一份表里取。
"""

from __future__ import annotations

from typing import Mapping

#: 与 style.css 的 ``:root`` / ``html[data-theme="dark"]`` 对齐。
TOKENS: dict[str, dict[str, str]] = {
    "light": {
        "paper": "#eae5e1",
        "paper2": "#edebe4",
        "paper3": "#e2dccf",
        "ink": "#080a08",
        "ink2": "#2b2a24",
        "muted": "#77756d",
        "dim": "#9a9487",
        "line": "#d6d0c4",
        "line_strong": "#aaa59a",
        "accent": "#9b7247",
        "accent2": "#565c46",
        "accent_soft": "#e4d5c1",
        "green": "#565c46",
        "amber": "#a67d48",
        "red": "#a23b2c",
        "float_bg": "#f4f1ea",
        "panel_bg": "rgba(237, 235, 228, .97)",
        "topbar_bg": "rgba(234, 229, 225, .97)",
        "menu_bg": "rgba(244, 241, 234, .99)",
        "grid_dot": "#c9c2b4",
        "grid_axis": "#b5ad9d",
        "canvas_bg": "#f2efe8",
        "edge": "#a49a89",
        "edge_disabled": "#d3ccbc",
        "edge_delay": "#b0762a",
        "node_fill": "#f7f5ef",
        "node_stroke": "#6f6a5e",
    },
    "dark": {
        "paper": "#11181b",
        "paper2": "#202a2f",
        "paper3": "#2a363b",
        "ink": "#e0e3dc",
        "ink2": "#c6cbc3",
        "muted": "#a6b0b1",
        "dim": "#7f8c8e",
        "line": "#2e3b40",
        "line_strong": "#536166",
        "accent": "#c5a16b",
        "accent2": "#9aa88c",
        "accent_soft": "#2c3a33",
        "green": "#9aa88c",
        "amber": "#c5a16b",
        "red": "#c08a7d",
        "float_bg": "#1b2429",
        "panel_bg": "rgba(32, 42, 47, .97)",
        "topbar_bg": "rgba(17, 24, 27, .97)",
        "menu_bg": "rgba(23, 31, 35, .99)",
        "grid_dot": "#2b383d",
        "grid_axis": "#3a4a50",
        "canvas_bg": "#0d1417",
        "edge": "#8c9099",
        "edge_disabled": "#39454a",
        "edge_delay": "#c5a16b",
        "node_fill": "#1a2327",
        "node_stroke": "#7c878b",
    },
}

#: 与 style.css 一致的字号（px）。
FONT_SIZE = 13
FONT_SIZE_SMALL = 12
FONT_FAMILY = "Microsoft YaHei UI"


def tokens(name: str) -> dict[str, str]:
    return dict(TOKENS.get(name, TOKENS["light"]))


def qcolor(value: str, alpha: int | None = None):
    """把 token（支持 ``#rrggbb`` 与 ``rgba(r,g,b,a)``）转成 QColor。"""
    from PySide6.QtGui import QColor

    text = str(value).strip()
    if text.startswith("rgba(") or text.startswith("rgb("):
        body = text[text.index("(") + 1 : text.rindex(")")]
        parts = [part.strip() for part in body.split(",")]
        try:
            red = int(float(parts[0]))
            green = int(float(parts[1]))
            blue = int(float(parts[2]))
            a = float(parts[3]) if len(parts) > 3 else 1.0
        except (ValueError, IndexError):
            return QColor(0, 0, 0)
        color = QColor(red, green, blue)
        color.setAlpha(int(max(0.0, min(1.0, a)) * 255))
        if alpha is not None:
            color.setAlpha(alpha)
        return color
    color = QColor(text)
    if not color.isValid():
        color = QColor(0, 0, 0)
    if alpha is not None:
        color.setAlpha(alpha)
    return color


def build_qss(t: Mapping[str, str]) -> str:
    """把 token 渲染成 QSS。只覆盖必要的控件，其余靠 palette 继承。"""
    return f"""
    QWidget {{
        background: {t['paper']};
        color: {t['ink']};
        font-family: "{FONT_FAMILY}";
        font-size: {FONT_SIZE}px;
    }}
    QMainWindow::separator {{
        background: {t['line']};
        width: 1px;
        height: 1px;
    }}
    QMenuBar {{
        background: {t['topbar_bg']};
        border-bottom: 1px solid {t['line']};
        padding: 2px 6px;
    }}
    QMenuBar::item {{
        padding: 5px 10px;
        background: transparent;
    }}
    QMenuBar::item:selected {{ background: {t['paper3']}; }}
    QMenu {{
        background: {t['menu_bg']};
        border: 1px solid {t['line_strong']};
        padding: 4px;
    }}
    QMenu::item {{ padding: 6px 26px 6px 22px; }}
    QMenu::item:selected {{ background: {t['accent_soft']}; color: {t['ink']}; }}
    QMenu::separator {{ height: 1px; background: {t['line']}; margin: 4px 8px; }}
    QToolBar {{
        background: {t['paper2']};
        border-bottom: 1px solid {t['line']};
        spacing: 4px;
        padding: 4px 8px;
    }}
    QToolButton {{
        background: transparent;
        border: 1px solid transparent;
        border-radius: 3px;
        padding: 4px 9px;
    }}
    QToolButton:hover {{ background: {t['paper3']}; border-color: {t['line']}; }}
    QToolButton:checked {{ background: {t['accent_soft']}; border-color: {t['accent']}; }}
    QStatusBar {{
        background: {t['paper2']};
        border-top: 1px solid {t['line']};
        color: {t['muted']};
    }}
    QDockWidget {{
        titlebar-close-icon: none;
        titlebar-normal-icon: none;
        font-size: {FONT_SIZE_SMALL}px;
    }}
    QDockWidget::title {{
        background: {t['paper3']};
        padding: 5px 8px;
        border-bottom: 1px solid {t['line']};
        text-align: left;
    }}
    QTreeView, QTableView, QListView {{
        background: {t['paper2']};
        alternate-background-color: {t['paper']};
        border: 1px solid {t['line']};
        selection-background-color: {t['accent_soft']};
        selection-color: {t['ink']};
        outline: 0;
    }}
    QTreeView::item {{ padding: 3px 2px; }}
    QTreeView::item:hover {{ background: {t['paper3']}; }}
    QHeaderView::section {{
        background: {t['paper3']};
        color: {t['muted']};
        border: 0;
        border-right: 1px solid {t['line']};
        border-bottom: 1px solid {t['line']};
        padding: 4px 6px;
    }}
    QLineEdit, QSpinBox, QDoubleSpinBox, QComboBox, QPlainTextEdit, QTextEdit {{
        background: {t['paper']};
        border: 1px solid {t['line_strong']};
        border-radius: 3px;
        padding: 3px 6px;
        selection-background-color: {t['accent']};
        selection-color: {t['paper']};
    }}
    QLineEdit:focus, QSpinBox:focus, QDoubleSpinBox:focus,
    QComboBox:focus, QPlainTextEdit:focus, QTextEdit:focus {{
        border-color: {t['accent']};
    }}
    QComboBox::drop-down {{ border: 0; width: 18px; }}
    QPushButton {{
        background: {t['paper2']};
        border: 1px solid {t['line_strong']};
        border-radius: 3px;
        padding: 4px 12px;
    }}
    QPushButton:hover {{ background: {t['paper3']}; }}
    QPushButton:pressed {{ background: {t['accent_soft']}; }}
    QPushButton:disabled {{ color: {t['dim']}; border-color: {t['line']}; }}
    QScrollBar:vertical {{
        background: transparent; width: 10px; margin: 0;
    }}
    QScrollBar::handle:vertical {{
        background: {t['line_strong']}; border-radius: 5px; min-height: 24px;
    }}
    QScrollBar::add-line, QScrollBar::sub-line {{ height: 0; width: 0; }}
    QScrollBar:horizontal {{ background: transparent; height: 10px; margin: 0; }}
    QScrollBar::handle:horizontal {{
        background: {t['line_strong']}; border-radius: 5px; min-width: 24px;
    }}
    QTabWidget::pane {{ border: 1px solid {t['line']}; top: -1px; }}
    QTabBar::tab {{
        background: {t['paper2']};
        border: 1px solid {t['line']};
        padding: 5px 14px;
        margin-right: 2px;
    }}
    QTabBar::tab:selected {{
        background: {t['paper']};
        border-bottom-color: {t['paper']};
        color: {t['ink']};
    }}
    QGroupBox {{
        border: 1px solid {t['line']};
        border-radius: 3px;
        margin-top: 10px;
        padding-top: 6px;
    }}
    QGroupBox::title {{
        subcontrol-origin: margin;
        left: 8px;
        padding: 0 4px;
        color: {t['muted']};
    }}
    QSplitter::handle {{ background: {t['line']}; }}
    QToolTip {{
        background: {t['menu_bg']};
        color: {t['ink']};
        border: 1px solid {t['line_strong']};
        padding: 4px 6px;
    }}
    """


__all__ = ["FONT_FAMILY", "FONT_SIZE", "FONT_SIZE_SMALL", "TOKENS", "build_qss", "tokens"]
