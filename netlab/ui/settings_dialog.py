"""设置窗：与退役前 web 版 ``#setWin`` 同构，读写的是同一份 settings.json。

只使用 :data:`netlab.workspace.DEFAULT_SETTINGS` 里已有的键（未知键会被后端拒绝）。
"""

from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QButtonGroup,
    QCheckBox,
    QDialog,
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QScrollArea,
    QSpinBox,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
)

from ..workspace import load_settings, save_settings

ACCENTS = ["", "#9b7247", "#7a8b5a", "#4f7f95", "#8b5a7a", "#a2663f"]


def _seg(options: list[tuple[str, str]], current: str) -> tuple[QWidget, QButtonGroup]:
    box = QWidget()
    box.setObjectName("seg")
    lay = QHBoxLayout(box)
    lay.setContentsMargins(0, 0, 0, 0)
    lay.setSpacing(0)
    group = QButtonGroup(box)
    group.setExclusive(True)
    for value, label in options:
        btn = QPushButton(label)
        btn.setCheckable(True)
        btn.setObjectName("segBtn")
        btn.setProperty("value", value)
        btn.setCursor(Qt.PointingHandCursor)
        if value == current:
            btn.setChecked(True)
        group.addButton(btn)
        lay.addWidget(btn)
    box.setFixedHeight(30)
    return box, group


def _row(label: str, hint: str, control: QWidget) -> QWidget:
    row = QWidget()
    lay = QHBoxLayout(row)
    lay.setContentsMargins(0, 8, 0, 8)
    left = QVBoxLayout()
    left.setSpacing(2)
    name = QLabel(label)
    name.setObjectName("setName")
    left.addWidget(name)
    if hint:
        em = QLabel(hint)
        em.setObjectName("setHint")
        em.setWordWrap(True)
        left.addWidget(em)
    lay.addLayout(left, 1)
    lay.addWidget(control, 0, Qt.AlignVCenter)
    return row


def _section(title: str) -> QLabel:
    lab = QLabel(title)
    lab.setObjectName("setSection")
    return lab


class SettingsDialog(QDialog):
    """三个分组：工程设置 / 视图与外观 / 交互与文档。改动即时写盘并广播。"""

    settingsChanged = Signal(dict)
    docsRequested = Signal(str)

    def __init__(self, tokens: dict[str, str], parent=None) -> None:
        super().__init__(parent)
        self.tokens_map = dict(tokens)
        self.settings = dict(load_settings())
        self.setWindowTitle("设置")
        self.resize(900, 620)
        self._nav_buttons: list[QPushButton] = []
        self._build()
        self._apply_style()
        self._sync_nav(0)

    # ------------------------------------------------------------------ build
    def _build(self) -> None:
        outer = QHBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        nav = QWidget()
        nav.setObjectName("setNav")
        nav.setFixedWidth(230)
        nav_lay = QVBoxLayout(nav)
        nav_lay.setContentsMargins(18, 22, 18, 18)
        nav_lay.setSpacing(6)
        cap = QLabel("SETTINGS")
        cap.setObjectName("setCap")
        nav_lay.addWidget(cap)
        for i, (title, sub) in enumerate(
            [("工程设置", "工作模式 / 模板 / 文件"), ("视图与外观", "主题 / 强调色 / 动效"), ("交互与文档", "启动引导 / 自动保存")]
        ):
            btn = QPushButton(f"{title}\n{sub}")
            btn.setObjectName("setNavBtn")
            btn.setCheckable(True)
            btn.setCursor(Qt.PointingHandCursor)
            btn.clicked.connect(lambda _=False, idx=i: self._sync_nav(idx))
            nav_lay.addWidget(btn)
            self._nav_buttons.append(btn)
        nav_lay.addStretch(1)
        outer.addWidget(nav)

        self.stack = QStackedWidget()
        outer.addWidget(self.stack, 1)
        self.stack.addWidget(self._pane_project())
        self.stack.addWidget(self._pane_view())
        self.stack.addWidget(self._pane_interact())

    def _page(self) -> tuple[QScrollArea, QVBoxLayout]:
        area = QScrollArea()
        area.setWidgetResizable(True)
        area.setFrameShape(QFrame.NoFrame)
        body = QWidget()
        body.setObjectName("setBody")
        lay = QVBoxLayout(body)
        lay.setContentsMargins(28, 24, 28, 24)
        lay.setSpacing(4)
        area.setWidget(body)
        return area, lay

    def _pane_project(self) -> QWidget:
        area, lay = self._page()
        lay.addWidget(_section("工程"))
        self.dir_edit = QLineEdit(str(self.settings.get("default_project_dir") or ""))
        self.dir_edit.setPlaceholderText("默认保存工程的位置（留空 = 上次使用的目录）")
        self.dir_edit.editingFinished.connect(self._save_all)
        browse = QPushButton("浏览…")
        browse.setObjectName("tinyBtn")
        browse.clicked.connect(self._browse_dir)
        wrap = QWidget()
        wl = QHBoxLayout(wrap)
        wl.setContentsMargins(0, 0, 0, 0)
        wl.addWidget(self.dir_edit, 1)
        wl.addWidget(browse)
        lay.addWidget(_row("默认工程目录", "新建工程与「保存」默认落在这里", wrap))

        self.library_edit = QLineEdit(str(self.settings.get("library_root") or ""))
        self.library_edit.setPlaceholderText("共享元件库根目录（可留空）")
        self.library_edit.editingFinished.connect(self._save_all)
        lb = QPushButton("浏览…")
        lb.setObjectName("tinyBtn")
        lb.clicked.connect(self._browse_library)
        wrap2 = QWidget()
        wl2 = QHBoxLayout(wrap2)
        wl2.setContentsMargins(0, 0, 0, 0)
        wl2.addWidget(self.library_edit, 1)
        wl2.addWidget(lb)
        lay.addWidget(_row("共享库目录", "library_root：工程目录兄弟目录里的共享库", wrap2))

        self.keep_spin = QSpinBox()
        self.keep_spin.setRange(1, 50)
        self.keep_spin.setValue(int(self.settings.get("autosave_keep_recent") or 10))
        self.keep_spin.valueChanged.connect(self._save_all)
        lay.addWidget(_row("自动保存保留份数", "最近 N 份自动快照", self.keep_spin))
        lay.addStretch(1)
        return area

    def _pane_view(self) -> QWidget:
        area, lay = self._page()
        lay.addWidget(_section("视图与外观"))
        theme = str(self.settings.get("theme") or "system")
        w, self.theme_group = _seg([("system", "跟随系统"), ("light", "浅色"), ("dark", "深色")], theme)
        self.theme_group.buttonClicked.connect(self._save_all)
        lay.addWidget(_row("外观主题", "跟随系统会随系统深浅色切换", w))

        swatches = QWidget()
        sl = QHBoxLayout(swatches)
        sl.setContentsMargins(0, 0, 0, 0)
        sl.setSpacing(8)
        self._accent_group = QButtonGroup(swatches)
        self._accent_group.setExclusive(True)
        current_accent = str(self.settings.get("ui_accent") or "")
        for color in ACCENTS:
            dot = QPushButton()
            dot.setObjectName("swatch")
            dot.setCheckable(True)
            dot.setFixedSize(24, 24)
            dot.setProperty("color", color or "auto")
            dot.setStyleSheet(
                f"QPushButton#swatch {{ border-radius: 12px; border: 2px solid {'#9b7247' if color else '#aaa59a'};"
                f" background: {color or 'transparent'}; }}"
                f"QPushButton#swatch:checked {{ border: 3px solid {self.tokens_map['ink']}; }}"
            )
            if (color or "") == current_accent:
                dot.setChecked(True)
            self._accent_group.addButton(dot)
            sl.addWidget(dot)
        self._accent_group.buttonClicked.connect(self._save_all)
        lay.addWidget(_row("强调色", "仅影响界面主色，不改图纸符号", swatches))

        motion = str(self.settings.get("ui_motion") or "low")
        w2, self.motion_group = _seg([("off", "关"), ("low", "低"), ("med", "中"), ("high", "高")], motion)
        self.motion_group.buttonClicked.connect(self._save_all)
        lay.addWidget(_row("动效程度", "面板滑入、页签切换的时长与位移", w2))

        perf = str(self.settings.get("ui_perf") or "perf")
        w3, self.perf_group = _seg([("perf", "性能优先"), ("balanced", "均衡"), ("quality", "画质优先")], perf)
        self.perf_group.buttonClicked.connect(self._save_all)
        lay.addWidget(_row("UI 性能", "图表抗锯齿与曲线抽稀强度", w3))
        lay.addStretch(1)
        return area

    def _pane_interact(self) -> QWidget:
        area, lay = self._page()
        lay.addWidget(_section("交互与文档"))
        guide = str(self.settings.get("ui_guide") or "always")
        w, self.guide_group = _seg([("always", "每次显示"), ("never", "不再显示")], guide)
        self.guide_group.buttonClicked.connect(self._save_all)
        lay.addWidget(_row("启动引导", "开启时每次启动显示开始界面", w))

        self.autosave_box = QCheckBox("启用自动保存")
        self.autosave_box.setChecked(bool(self.settings.get("autosave_enabled", True)))
        self.autosave_box.toggled.connect(self._save_all)
        lay.addWidget(_row("自动保存", "关闭后只在手动保存时写盘", self.autosave_box))

        interval = int(self.settings.get("autosave_interval_seconds") or 60)
        w2, self.interval_group = _seg([("30", "30 秒"), ("60", "60 秒"), ("120", "120 秒"), ("300", "300 秒")], str(interval))
        self.interval_group.buttonClicked.connect(self._save_all)
        lay.addWidget(_row("快照间隔", "自动保存的写盘间隔", w2))

        docs = QWidget()
        dl = QHBoxLayout(docs)
        dl.setContentsMargins(0, 0, 0, 0)
        dl.setSpacing(8)
        for label, key in (("打开快捷键", "shortcuts"), ("快速上手", "quickstart")):
            btn = QPushButton(label)
            btn.setObjectName("tinyBtn")
            btn.clicked.connect(lambda _=False, k=key: self.docsRequested.emit(k))
            dl.addWidget(btn)
        dl.addStretch(1)
        lay.addWidget(_row("操作说明", "快捷键、画布手势与常用工作流", docs))

        tip = QLabel("启动后仿真始终是停止状态；运行播放需要手动点击「运行」（空格）。")
        tip.setObjectName("setTip")
        tip.setWordWrap(True)
        lay.addSpacing(10)
        lay.addWidget(tip)
        lay.addStretch(1)
        return area

    # ----------------------------------------------------------------- events
    def _sync_nav(self, index: int) -> None:
        for i, btn in enumerate(self._nav_buttons):
            btn.setChecked(i == index)
        self.stack.setCurrentIndex(index)

    def _browse_dir(self) -> None:
        path = QFileDialog.getExistingDirectory(self, "选择默认工程目录", self.dir_edit.text() or "")
        if path:
            self.dir_edit.setText(path)
            self._save_all()

    def _browse_library(self) -> None:
        path = QFileDialog.getExistingDirectory(self, "选择共享库目录", self.library_edit.text() or "")
        if path:
            self.library_edit.setText(path)
            self._save_all()

    def _save_all(self) -> None:
        patch = {
            "default_project_dir": self.dir_edit.text().strip(),
            "library_root": self.library_edit.text().strip(),
            "autosave_keep_recent": int(self.keep_spin.value()),
            "theme": self._checked(self.theme_group, "system"),
            "ui_accent": self._accent_value(),
            "ui_motion": self._checked(self.motion_group, "low"),
            "ui_perf": self._checked(self.perf_group, "perf"),
            "ui_guide": self._checked(self.guide_group, "always"),
            "autosave_enabled": bool(self.autosave_box.isChecked()),
            "autosave_interval_seconds": int(self._checked(self.interval_group, "60")),
        }
        try:
            self.settings = dict(save_settings(patch))
        except Exception:  # noqa: BLE001 - 校验失败时不打断 UI
            return
        self.settingsChanged.emit(self.settings)

    @staticmethod
    def _checked(group: QButtonGroup, default: str) -> str:
        btn = group.checkedButton()
        return str(btn.property("value")) if btn is not None else default

    def _accent_value(self) -> str:
        btn = self._accent_group.checkedButton()
        if btn is None:
            return ""
        color = str(btn.property("color"))
        return "" if color == "auto" else color

    # ------------------------------------------------------------------ style
    def _apply_style(self) -> None:
        t = self.tokens_map
        self.setStyleSheet(
            f"""
            QDialog {{ background: {t['paper']}; }}
            QWidget#setBody {{ background: {t['paper']}; }}
            QLabel {{ color: {t['ink']}; background: transparent; }}
            QCheckBox {{ color: {t['ink2']}; }}
            QWidget#setNav {{ background: {t['paper2']}; border-right: 1px solid {t['line']}; }}
            QLabel#setCap {{ color: {t['dim']}; letter-spacing: 2px; font-size: 11px; }}
            QPushButton#setNavBtn {{
                text-align: left; padding: 10px 12px; border: 0; border-radius: 5px;
                color: {t['ink2']}; background: transparent; font-size: 13px;
            }}
            QPushButton#setNavBtn:hover {{ background: {t['paper3']}; }}
            QPushButton#setNavBtn:checked {{ background: {t['accent_soft']}; color: {t['ink']}; font-weight: bold; }}
            QLabel#setSection {{ color: {t['accent']}; font-size: 12px; letter-spacing: 1px; padding-bottom: 4px; }}
            QLabel#setName {{ color: {t['ink']}; font-size: 13px; }}
            QLabel#setHint {{ color: {t['muted']}; font-size: 11px; }}
            QLabel#setTip {{ color: {t['muted']}; font-size: 11px; padding-top: 6px; }}
            QWidget#seg {{ border: 1px solid {t['line']}; border-radius: 5px; }}
            QPushButton#segBtn {{
                border: 0; padding: 4px 14px; background: transparent; color: {t['ink2']}; font-size: 12px;
            }}
            QPushButton#segBtn:hover {{ background: {t['paper3']}; }}
            QPushButton#segBtn:checked {{ background: {t['accent']}; color: {t['paper']}; font-weight: bold; }}
            QPushButton#tinyBtn {{
                border: 1px solid {t['line_strong']}; border-radius: 4px; padding: 4px 12px;
                background: transparent; color: {t['ink2']}; font-size: 12px;
            }}
            QPushButton#tinyBtn:hover {{ border-color: {t['accent']}; color: {t['ink']}; }}
            QLineEdit {{ border: 1px solid {t['line']}; border-radius: 4px; padding: 5px 8px; background: {t['paper']}; color: {t['ink']}; }}
            QSpinBox {{ border: 1px solid {t['line']}; border-radius: 4px; padding: 3px 6px; background: {t['paper']}; color: {t['ink']}; }}
            QScrollArea {{ background: {t['paper']}; border: 0; }}
            QScrollArea > QWidget > QWidget {{ background: {t['paper']}; }}
            """
        )


__all__ = ["SettingsDialog", "ACCENTS"]
