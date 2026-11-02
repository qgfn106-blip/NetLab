"""启动引导（R30-1）：与退役前 web 版 ``#guide`` 同构的开始界面。

三张工作模式卡 + 使用指南 + 文档与示例 + 「不再显示」。
只负责选择与请求，不直接改场景：调用方读 :attr:`GuideDialog.result_payload`。
"""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QButtonGroup,
    QCheckBox,
    QDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)

from .theme import qcolor

MODES = [
    (
        "signal",
        "01 / SIGNAL FLOW",
        "信号流",
        "按拓扑顺序逐段传播字典数据，适合控制系统框图、滤波器与非线性动态的方波 / 阶跃观察。",
        ["字典信号 · 拓扑传播", "传递函数 / 频域分析", "时域曲线与相图"],
    ),
    (
        "circuit",
        "02 / CIRCUIT",
        "电路",
        "节点电压法（MNA）求解，配合 GB 符号、器件引脚与导线工具，绘制正规电气原理图。",
        ["MNA · 牛顿迭代", "GB/T 4728 风格符号", "工作点 / AC 扫描"],
    ),
    (
        "vector",
        "03 / VECTOR",
        "矢量",
        "非线性动态源、二维矢量连接与相图；适合振子、场与连续状态的可视化实验。",
        ["二维矢量状态", "相图与轨迹", "非线性动态源"],
    ),
]

DOCS = [
    ("quickstart", "快速上手"),
    ("interface", "界面指南"),
    ("glossary", "术语表"),
    ("faq", "常见问题"),
    ("shortcuts", "快捷键"),
]

STEPS = [
    ("搭网络", "工具栏「节点」添加节点，从节点端口拖出连接；双击节点编辑参数。"),
    ("看曲线", "右侧「分析 · 信号」选择变量，点「运行」开始采集；「回放」可在历史帧间拖动。"),
    ("改外观", "菜单「设置」打开设置窗，可切主题、强调色、动效与性能；外观偏好全局保存。"),
    ("查文档", "任意参数旁的 ? 给出说明与公式；「帮助」打开非模态文档窗口（可拖动、可搜索）。"),
]


def _label(text: str, cls: str = "", size: int | None = None, bold: bool = False) -> QLabel:
    lab = QLabel(text)
    if cls:
        lab.setObjectName(cls)
    if size:
        font = lab.font()
        font.setPixelSize(size)
        font.setBold(bold)
        lab.setFont(font)
    lab.setWordWrap(True)
    return lab


class _ModeCard(QFrame):
    """一张工作模式卡：编号 / 标题 / 说明 / 三个要点。"""

    def __init__(self, mode: str, idx: str, title: str, desc: str, bullets: list[str]) -> None:
        super().__init__()
        self.mode = mode
        self.setObjectName("modeCard")
        self.setCursor(Qt.PointingHandCursor)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(18, 16, 18, 16)
        lay.setSpacing(6)
        lay.addWidget(_label(idx, "modeIdx", 11, True))
        lay.addWidget(_label(title, "modeTitle", 19, True))
        body = _label(desc, "modeDesc", 12)
        body.setMinimumHeight(46)
        lay.addWidget(body)
        for item in bullets:
            bullet = _label("·  " + item, "modeBullet", 12)
            lay.addWidget(bullet)
        lay.addStretch(1)

    def set_selected(self, on: bool) -> None:
        self.setProperty("selected", "true" if on else "false")
        self.style().unpolish(self)
        self.style().polish(self)

    def mousePressEvent(self, event) -> None:  # noqa: D102
        super().mousePressEvent(event)
        parent = self.parent()
        while parent is not None and not isinstance(parent, GuideDialog):
            parent = parent.parent()
        if isinstance(parent, GuideDialog):
            parent.select_mode(self.mode)


class GuideDialog(QDialog):
    """启动引导。exec() 后读 :attr:`result_payload`。"""

    def __init__(self, tokens: dict[str, str], current_mode: str = "signal", parent=None) -> None:
        super().__init__(parent)
        self.setObjectName("guideDialog")
        self._tokens = dict(tokens)
        self.selected_mode = current_mode
        self.never = False
        self.requested = ""  # '' | 'project' | 'settings' | 'docs' | 'demo'
        self._cards: dict[str, _ModeCard] = {}
        self.setWindowTitle("Netlab · 开始")
        self.setWindowFlag(Qt.FramelessWindowHint, True)
        self.setModal(True)
        self.resize(1120, 780)
        self._build()
        self._apply_style()
        self.select_mode(current_mode)

    # ------------------------------------------------------------------ build
    def _build(self) -> None:
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.NoFrame)
        body = QWidget()
        body.setObjectName("guideBody")
        scroll.setWidget(body)
        outer.addWidget(scroll, 1)

        root = QVBoxLayout(body)
        root.setContentsMargins(44, 34, 44, 22)
        root.setSpacing(18)

        # header ---------------------------------------------------------
        head = QHBoxLayout()
        left = QVBoxLayout()
        left.setSpacing(4)
        left.addWidget(_label("LOCAL SESSION · 2026 · 单机运行", "guideEyebrow", 11, True))
        title = _label("NETLAB", "guideMark", 44, True)
        left.addWidget(title)
        left.addWidget(_label("信号流 · 电路 · 矢量场仿真", "guideSub", 19, True))
        left.addWidget(_label("ANALYSIS OS", "guideOs", 13, True))
        head.addLayout(left, 1)
        close_btn = QPushButton("关闭 ✕")
        close_btn.setObjectName("guideClose")
        close_btn.setCursor(Qt.PointingHandCursor)
        close_btn.clicked.connect(self.reject)
        head.addWidget(close_btn, 0, Qt.AlignTop)
        root.addLayout(head)

        root.addWidget(
            _label(
                "网络用节点与连接描述，运行时按拓扑或节点电压法求解；所有曲线都能追溯到公式与源码。"
                "选一个工作模式开始，随时可从「设置 → 工程」切换。",
                "guideLead",
                13,
            )
        )

        # modes ----------------------------------------------------------
        sec = QHBoxLayout()
        sec.addWidget(_label("工作模式", "secTitle", 15, True))
        sec.addStretch(1)
        sec.addWidget(_label("选中后进入该模式的空白场景 · 随时可从菜单重新选择", "secHint", 11))
        root.addLayout(sec)

        row = QHBoxLayout()
        row.setSpacing(14)
        for mode, idx, title, desc, bullets in MODES:
            card = _ModeCard(mode, idx, title, desc, bullets)
            self._cards[mode] = card
            row.addWidget(card, 1)
        root.addLayout(row, 3)

        # guide + docs ---------------------------------------------------
        info = QHBoxLayout()
        info.setSpacing(32)
        guide_box = QVBoxLayout()
        guide_box.setSpacing(8)
        guide_box.addWidget(_label("使用指南", "secTitle", 15, True))
        guide_box.addWidget(
            _label("左侧是网络列表，中间是画布，右侧是检查器与函数面板；顶部菜单管理工程、视图与设置。", "guideText", 12)
        )
        for i, (name, text) in enumerate(STEPS, 1):
            guide_box.addWidget(_label(f"{i}. {name}：{text}", "guideText", 12))
        guide_box.addStretch(1)
        info.addLayout(guide_box, 3)

        docs_box = QVBoxLayout()
        docs_box.setSpacing(6)
        docs_box.addWidget(_label("文档与示例", "secTitle", 15, True))
        for key, title in DOCS:
            btn = QPushButton(f"{title}    DOC")
            btn.setObjectName("docLink")
            btn.setCursor(Qt.PointingHandCursor)
            btn.clicked.connect(lambda _=False, k=key: self._request(f"doc:{k}"))
            docs_box.addWidget(btn)
        demo = QPushButton("打开示例工程（信号链）    DEMO")
        demo.setObjectName("docLink")
        demo.setCursor(Qt.PointingHandCursor)
        demo.clicked.connect(lambda: self._request("demo"))
        docs_box.addWidget(demo)
        docs_box.addStretch(1)
        info.addLayout(docs_box, 2)
        root.addLayout(info, 2)

        # footer ---------------------------------------------------------
        foot = QHBoxLayout()
        self.never_box = QCheckBox("不再显示（下次直接进入上次的场景）")
        self.never_box.setObjectName("guideNever")
        foot.addWidget(self.never_box)
        foot.addStretch(1)
        for text, action, ghost in (
            ("打开工程", "project", True),
            ("设置视图", "settings", True),
            ("先看文档", "docs", True),
            ("进入场景  Enter", "enter", False),
        ):
            btn = QPushButton(text)
            btn.setObjectName("guideGhost" if ghost else "guideGo")
            btn.setCursor(Qt.PointingHandCursor)
            btn.setDefault(action == "enter")
            btn.clicked.connect(lambda _=False, a=action: self._finish(a))
            foot.addWidget(btn)
        root.addLayout(foot)

    # ---------------------------------------------------------------- events
    def select_mode(self, mode: str) -> None:
        self.selected_mode = mode
        for key, card in self._cards.items():
            card.set_selected(key == mode)

    def _request(self, action: str) -> None:
        self.requested = action
        self.never = self.never_box.isChecked()
        if action.startswith("doc:"):
            self.accept()
            return
        self.accept()

    def _finish(self, action: str) -> None:
        self.requested = action
        self.never = self.never_box.isChecked()
        self.accept()

    @property
    def result_payload(self) -> dict:
        return {"mode": self.selected_mode, "never": self.never, "requested": self.requested}

    def keyPressEvent(self, event) -> None:  # noqa: D102
        if event.key() in (Qt.Key_Return, Qt.Key_Enter):
            self._finish("enter")
            return
        if event.key() == Qt.Key_Escape:
            self._finish("enter")
            return
        super().keyPressEvent(event)

    # ------------------------------------------------------------------ style
    def _apply_style(self) -> None:
        t = self._tokens
        paper = t["paper"]
        self.setStyleSheet(
            f"""
            QDialog#guideDialog {{ background: {paper}; }}
            QWidget#guideBody {{ background: {paper}; }}
            QLabel#guideEyebrow {{ color: {t['accent']}; letter-spacing: 2px; }}
            QLabel#guideMark {{ color: {t['ink']}; letter-spacing: 6px; }}
            QLabel#guideSub {{ color: {t['ink2']}; }}
            QLabel#guideOs {{ color: {t['muted']}; letter-spacing: 4px; }}
            QLabel#guideLead {{ color: {t['muted']}; }}
            QLabel#secTitle {{ color: {t['ink']}; }}
            QLabel#secHint {{ color: {t['dim']}; }}
            QLabel#guideText {{ color: {t['ink2']}; }}
            QLabel#modeIdx {{ color: {t['accent']}; letter-spacing: 1px; }}
            QLabel#modeTitle {{ color: {t['ink']}; }}
            QLabel#modeDesc {{ color: {t['muted']}; }}
            QLabel#modeBullet {{ color: {t['ink2']}; }}
            QFrame#modeCard {{
                background: {t['paper2']};
                border: 1px solid {t['line']};
                border-radius: 8px;
            }}
            QFrame#modeCard:hover {{ border-color: {t['line_strong']}; }}
            QFrame#modeCard[selected="true"] {{
                background: {t['accent_soft']};
                border: 2px solid {t['accent']};
            }}
            QPushButton#guideClose {{
                background: transparent; border: 1px solid {t['line']};
                border-radius: 4px; padding: 5px 12px; color: {t['muted']};
            }}
            QPushButton#guideClose:hover {{ color: {t['ink']}; border-color: {t['line_strong']}; }}
            QPushButton#docLink {{
                text-align: left; background: {t['paper2']}; color: {t['ink2']};
                border: 1px solid {t['line']}; border-radius: 5px; padding: 7px 12px;
            }}
            QPushButton#docLink:hover {{ border-color: {t['accent']}; color: {t['ink']}; }}
            QPushButton#guideGo {{
                background: {t['accent']}; color: {t['paper']};
                border: 1px solid {t['accent']}; border-radius: 5px;
                padding: 8px 18px; font-weight: bold;
            }}
            QPushButton#guideGo:hover {{ background: {t['accent2']}; border-color: {t['accent2']}; }}
            QPushButton#guideGhost {{
                background: transparent; color: {t['ink2']};
                border: 1px solid {t['line_strong']}; border-radius: 5px; padding: 8px 14px;
            }}
            QPushButton#guideGhost:hover {{ background: {t['paper2']}; }}
            QCheckBox#guideNever {{ color: {t['muted']}; }}
            QScrollArea {{ background: {paper}; border: 0; }}
            """
        )
        _ = qcolor  # keep import used for themed widgets created later


def show_guide(tokens: dict[str, str], current_mode: str = "signal", parent=None) -> dict | None:
    dlg = GuideDialog(tokens, current_mode, parent)
    if dlg.exec() == QDialog.Accepted:
        return dlg.result_payload
    return None


__all__ = ["GuideDialog", "MODES", "DOCS", "STEPS", "show_guide"]
