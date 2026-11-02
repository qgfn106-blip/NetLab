"""函数页：节点计算与连接传递的真实公式、参数表与实现源码。

对应退役前 web 版右栏「函数」页（``#tab-spec``）：数据来自 ``scene.catalog()``
里 introspection 补全过的条目（kind/label/description/formula/params/outputs/
source/source_path/builtin/editable），不重新推导任何东西。
"""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QFont
from PySide6.QtWidgets import (
    QComboBox,
    QFrame,
    QHBoxLayout,
    QLabel,
    QPlainTextEdit,
    QScrollArea,
    QSizePolicy,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from .theme import qcolor


def _spec_lists(catalog: dict, mode: str) -> tuple[list[dict], list[dict]]:
    """(节点规格, 连接规格)：电路模式看 circuit_nodes/elements，其余看 computes/methods。"""
    if mode == "circuit":
        return list(catalog.get("circuit_nodes") or []), list(catalog.get("elements") or [])
    return list(catalog.get("computes") or []), list(catalog.get("methods") or [])


def _range_text(param: dict) -> str:
    parts = []
    if param.get("min") is not None:
        parts.append(f"≥ {param['min']}")
    if param.get("max") is not None:
        parts.append(f"≤ {param['max']}")
    if param.get("positive"):
        parts.append("> 0")
    if param.get("step") is not None:
        parts.append(f"步长 {param['step']}")
    return " · ".join(parts)


def _default_text(value) -> str:
    if isinstance(value, (dict, list)):
        import json

        return json.dumps(value, ensure_ascii=False)
    return "" if value is None else str(value)


class FunctionPane(QWidget):
    """一个可滚动页面：角色切换 + kind 选择 + 公式 / 参数 / 输出 / 源码。"""

    def __init__(self, tokens: dict[str, str], parent=None) -> None:
        super().__init__(parent)
        self.tokens_map = dict(tokens)
        self.catalog: dict = {}
        self.mode = "signal"
        self.role = "node"
        self.kind = ""
        self._target = ""
        self._build()
        self._apply_style()

    # ------------------------------------------------------------------ build
    def _build(self) -> None:
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        bar = QWidget()
        bar.setObjectName("fnBar")
        bar_lay = QHBoxLayout(bar)
        bar_lay.setContentsMargins(12, 8, 12, 8)
        bar_lay.setSpacing(8)
        from PySide6.QtWidgets import QPushButton

        self.node_btn = QPushButton("节点函数")
        self.edge_btn = QPushButton("连接函数")
        for btn, role in ((self.node_btn, "node"), (self.edge_btn, "edge")):
            btn.setObjectName("fnRole")
            btn.setCheckable(True)
            btn.setCursor(Qt.PointingHandCursor)
            btn.clicked.connect(lambda _=False, r=role: self.set_role(r))
            bar_lay.addWidget(btn)
        self.picker = QComboBox()
        self.picker.setObjectName("fnPicker")
        self.picker.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        self.picker.currentIndexChanged.connect(self._on_pick)
        bar_lay.addWidget(self.picker, 1)
        root.addWidget(bar)

        area = QScrollArea()
        area.setWidgetResizable(True)
        area.setFrameShape(QFrame.NoFrame)
        body = QWidget()
        body.setObjectName("fnBody")
        self.body_lay = QVBoxLayout(body)
        self.body_lay.setContentsMargins(14, 10, 14, 16)
        self.body_lay.setSpacing(8)
        area.setWidget(body)
        root.addWidget(area, 1)

        self.intro = QLabel()
        self.intro.setObjectName("fnIntro")
        self.intro.setWordWrap(True)
        self.body_lay.addWidget(self.intro)

        self.title = QLabel()
        self.title.setObjectName("fnTitle")
        self.title.setWordWrap(True)
        self.body_lay.addWidget(self.title)
        self.subtitle = QLabel()
        self.subtitle.setObjectName("fnSub")
        self.subtitle.setWordWrap(True)
        self.body_lay.addWidget(self.subtitle)
        self.badges = QLabel()
        self.badges.setObjectName("fnBadges")
        self.body_lay.addWidget(self.badges)

        self.formula_cap = self._caption("公式", "注册表中登记的计算式")
        self.formula = QLabel()
        self.formula.setObjectName("fnFormula")
        self.formula.setWordWrap(True)
        self.formula.setTextInteractionFlags(Qt.TextSelectableByMouse)
        self.body_lay.addWidget(self.formula_cap)
        self.body_lay.addWidget(self.formula)

        self.param_cap = self._caption("参数", "")
        self.table = QTableWidget(0, 7)
        self.table.setObjectName("fnTable")
        self.table.setHorizontalHeaderLabels(["参数", "类型", "默认", "单位", "范围", "必填", "说明"])
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.table.setWordWrap(True)
        self.table.setMinimumHeight(120)
        self.body_lay.addWidget(self.param_cap)
        self.body_lay.addWidget(self.table)

        self.outputs_cap = self._caption("输出字段", "")
        self.outputs = QLabel()
        self.outputs.setObjectName("fnOutputs")
        self.outputs.setWordWrap(True)
        self.body_lay.addWidget(self.outputs_cap)
        self.body_lay.addWidget(self.outputs)

        self.src_cap = self._caption("源码", "inspect 读取的真实实现")
        self.src_meta = QLabel()
        self.src_meta.setObjectName("fnSrcMeta")
        self.src_meta.setWordWrap(True)
        self.body_lay.addWidget(self.src_cap)
        self.body_lay.addWidget(self.src_meta)
        self.source = QPlainTextEdit()
        self.source.setObjectName("fnSource")
        self.source.setReadOnly(True)
        self.source.setMinimumHeight(220)
        mono = QFont("Consolas")
        mono.setStyleHint(QFont.Monospace)
        mono.setPixelSize(12)
        self.source.setFont(mono)
        self.body_lay.addWidget(self.source)

        self.note = QLabel()
        self.note.setObjectName("fnNote")
        self.note.setWordWrap(True)
        self.note.hide()
        self.body_lay.addWidget(self.note)
        self.body_lay.addStretch(1)
        self.set_role("node")

    def _caption(self, title: str, hint: str) -> QLabel:
        lab = QLabel(f"{title}   <span style='color:inherit;opacity:.6'>{hint}</span>" if hint else title)
        lab.setObjectName("fnCaption")
        lab.setTextFormat(Qt.RichText)
        return lab

    # ----------------------------------------------------------------- events
    def set_catalog(self, catalog: dict, mode: str) -> None:
        self.catalog = dict(catalog or {})
        changed_mode = mode != self.mode
        self.mode = mode or "signal"
        if changed_mode:
            self.kind = ""
        self._fill_picker()

    def set_role(self, role: str) -> None:
        self.role = "edge" if role == "edge" else "node"
        self.node_btn.setChecked(self.role == "node")
        self.edge_btn.setChecked(self.role == "edge")
        self.kind = ""
        self._fill_picker()

    def focus_node(self, kind: str, name: str = "") -> None:
        self._target = name
        if kind:
            self.kind = kind
            self.set_role("node")
            self.kind = kind
            self._fill_picker()

    def focus_edge(self, kind: str, name: str = "") -> None:
        self._target = name
        self.set_role("edge")
        if kind:
            self.kind = kind
            self._fill_picker()

    def _specs(self) -> list[dict]:
        nodes, edges = _spec_lists(self.catalog, self.mode)
        return edges if self.role == "edge" else nodes

    def _fill_picker(self) -> None:
        specs = self._specs()
        self.picker.blockSignals(True)
        self.picker.clear()
        for spec in specs:
            self.picker.addItem(f"{spec.get('label') or spec.get('kind')} · {spec.get('kind')}", spec.get("kind"))
        if self.kind:
            index = self.picker.findData(self.kind)
            if index >= 0:
                self.picker.setCurrentIndex(index)
        self.picker.blockSignals(False)
        current = self.picker.currentData() or (specs[0].get("kind") if specs else "")
        self._render(current)

    def _on_pick(self, _index: int) -> None:
        self._target = ""
        self._render(self.picker.currentData())

    def _render(self, kind: str | None) -> None:
        specs = self._specs()
        spec = next((s for s in specs if s.get("kind") == kind), specs[0] if specs else None)
        if spec is None:
            self.intro.setText("当前模式还没有可用的规格定义。")
            for widget in (self.title, self.subtitle, self.badges, self.formula, self.outputs, self.src_meta):
                widget.setText("")
            self.table.setRowCount(0)
            self.source.setPlainText("")
            return
        self.kind = spec.get("kind", "")
        if self._target:
            self.intro.setText(
                f"当前选中{'节点' if self.role == 'node' else '连接'}「{self._target}」，"
                "下面展示它实际使用的计算函数与参数定义。"
            )
        else:
            self.intro.setText(
                "节点函数：当前模式下所有节点类型的真实公式、源码与参数。"
                if self.role == "node"
                else "连接函数：当前模式下所有连接类型的真实公式、源码与参数。"
            )
        self.title.setText(str(spec.get("label") or spec.get("kind") or ""))
        self.subtitle.setText(f"{spec.get('kind')} · {spec.get('description') or '无说明'}")
        badges = [str(spec.get("mode") or self.mode)]
        badges.append("内置" if spec.get("builtin") else "扩展")
        if spec.get("editable"):
            badges.append("可自定义")
        self.badges.setText("   ".join(badges))

        formula = str(spec.get("formula") or "").strip() or "（该规格没有登记公式）"
        self.formula.setText(formula)

        params = list(spec.get("params") or [])
        self.param_cap.setText(f"参数   {len(params)} 个可调项")
        self.table.setRowCount(len(params))
        for row, param in enumerate(params):
            name = QTableWidgetItem(f"{param.get('label') or param.get('key')}\n{param.get('key')}")
            self.table.setItem(row, 0, name)
            self.table.setItem(row, 1, QTableWidgetItem(str(param.get("type") or "")))
            self.table.setItem(row, 2, QTableWidgetItem(_default_text(param.get("default"))))
            self.table.setItem(row, 3, QTableWidgetItem(str(param.get("unit") or "—")))
            self.table.setItem(row, 4, QTableWidgetItem(_range_text(param) or "—"))
            self.table.setItem(row, 5, QTableWidgetItem("是" if param.get("required") else ""))
            self.table.setItem(row, 6, QTableWidgetItem(str(param.get("help") or "")))
        self.table.resizeColumnsToContents()
        header = self.table.horizontalHeader()
        header.setStretchLastSection(True)
        self.table.setColumnWidth(6, max(160, self.width() // 3))

        outputs = list(spec.get("outputs") or [])
        self.outputs_cap.setVisible(bool(outputs))
        self.outputs.setVisible(bool(outputs))
        self.outputs.setText(" / ".join(str(o) for o in outputs))

        source = str(spec.get("source") or "")
        path = str(spec.get("source_path") or "源码路径不可用")
        lines = len(source.splitlines())
        self.src_meta.setText(f"{path}" + (f"    {lines} 行" if source else ""))
        if source.strip():
            self.source.setPlainText(source)
            self.source.setVisible(True)
        else:
            self.source.setPlainText("源码不可用：该实现没有可直接读取的 Python 源码（可能由内置 C 扩展或动态生成）。")
        if not spec.get("builtin"):
            self.note.setText("这是用户扩展提供的实现：代码在服务端本进程执行，不是沙箱。")
            self.note.show()
        else:
            self.note.hide()

    # ------------------------------------------------------------------ style
    def _apply_style(self) -> None:
        t = self.tokens_map
        self.setStyleSheet(
            f"""
            QWidget#fnBar {{ background: {t['paper2']}; border-bottom: 1px solid {t['line']}; }}
            QWidget#fnBody {{ background: {t['paper']}; }}
            QPushButton#fnRole {{
                border: 1px solid {t['line']}; border-radius: 4px; padding: 4px 10px;
                background: transparent; color: {t['ink2']}; font-size: 12px;
            }}
            QPushButton#fnRole:checked {{ background: {t['accent']}; color: {t['paper']}; border-color: {t['accent']}; }}
            QComboBox#fnPicker {{
                border: 1px solid {t['line']}; border-radius: 4px; padding: 3px 8px;
                background: {t['paper']}; color: {t['ink']};
            }}
            QLabel#fnIntro {{ color: {t['muted']}; font-size: 11px; }}
            QLabel#fnTitle {{ color: {t['ink']}; font-size: 17px; font-weight: bold; }}
            QLabel#fnSub {{ color: {t['muted']}; font-size: 12px; }}
            QLabel#fnBadges {{ color: {t['accent']}; font-size: 11px; }}
            QLabel#fnCaption {{ color: {t['accent']}; font-size: 11px; letter-spacing: 1px; padding-top: 6px; }}
            QLabel#fnFormula {{
                background: {t['paper2']}; border: 1px solid {t['line']}; border-radius: 5px;
                padding: 8px 10px; color: {t['ink']}; font-family: Consolas, monospace; font-size: 12px;
            }}
            QLabel#fnOutputs {{ color: {t['ink2']}; font-family: Consolas, monospace; font-size: 12px; }}
            QLabel#fnSrcMeta {{ color: {t['muted']}; font-size: 11px; }}
            QLabel#fnNote {{ color: {t['amber']}; font-size: 11px; }}
            QPlainTextEdit#fnSource {{
                background: {t['paper2']}; border: 1px solid {t['line']}; border-radius: 5px;
                color: {t['ink']};
            }}
            QTableWidget#fnTable {{
                background: {t['paper']}; border: 1px solid {t['line']}; gridline-color: {t['line']};
                color: {t['ink']}; font-size: 11px;
            }}
            QHeaderView::section {{
                background: {t['paper2']}; color: {t['muted']}; border: 0;
                border-bottom: 1px solid {t['line']}; padding: 3px 6px;
            }}
            QScrollArea {{ background: {t['paper']}; border: 0; }}
            """
        )
        _ = qcolor


__all__ = ["FunctionPane"]
