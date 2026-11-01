"""左侧工程树与右侧属性面板。

属性表单由 ``SERVICE.scene.catalog()`` 的 ParamSpec 生成（与旧前端同一份
元数据），所以新增元件不需要改界面代码。
"""

from __future__ import annotations

import json
from typing import Any, Mapping

from PySide6.QtCore import QMimeData, Qt, Signal
from PySide6.QtGui import QFont
from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QDoubleSpinBox,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QPlainTextEdit,
    QPushButton,
    QScrollArea,
    QSpinBox,
    QVBoxLayout,
    QWidget,
    QTreeWidget,
    QTreeWidgetItem,
)

from .models import EdgeVM, NodeVM, SceneVM
from .theme import FONT_FAMILY


class ProjectTree(QWidget):
    nodeActivated = Signal(str)
    edgeActivated = Signal(str)
    networkActivated = Signal(str)
    networkRequested = Signal(str)  # new/rename/remove + id 由外壳再问
    deleteRequested = Signal(str, str)

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        self.tree = QTreeWidget(self)
        self.tree.setHeaderLabels(["名称", "类型"])
        self.tree.setColumnWidth(0, 170)
        self.tree.setAlternatingRowColors(True)
        self.tree.setContextMenuPolicy(Qt.CustomContextMenu)
        self.tree.itemClicked.connect(self._on_click)
        self.tree.itemDoubleClicked.connect(self._on_double)
        self.tree.customContextMenuRequested.connect(self._on_menu)
        layout.addWidget(self.tree)
        self._nodes_root: QTreeWidgetItem | None = None
        self._edges_root: QTreeWidgetItem | None = None
        self._networks_root: QTreeWidgetItem | None = None
        self._current = ""

    def set_scene(self, scene: SceneVM, networks: list[dict[str, Any]] | None = None) -> None:
        self.tree.clear()
        self._current = scene.mode
        nets_root = QTreeWidgetItem(["网络", f"{len(networks or [])}"])
        self.tree.addTopLevelItem(nets_root)
        for item in networks or []:
            child = QTreeWidgetItem([str(item.get("name", "")), "当前" if item.get("current") else ""])
            child.setData(0, Qt.UserRole, ("network", str(item.get("id", ""))))
            if item.get("current"):
                font = child.font(0)
                font.setBold(True)
                child.setFont(0, font)
            nets_root.addChild(child)
        self._networks_root = nets_root

        nodes_root = QTreeWidgetItem(["节点", str(len(scene.nodes))])
        self.tree.addTopLevelItem(nodes_root)
        for node in scene.nodes:
            child = QTreeWidgetItem([node.name, node.kind])
            child.setData(0, Qt.UserRole, ("node", node.id))
            nodes_root.addChild(child)
        self._nodes_root = nodes_root

        edges_root = QTreeWidgetItem(["连接", str(len(scene.edges))])
        self.tree.addTopLevelItem(edges_root)
        for edge in scene.edges:
            label = f"{edge.name}" if edge.name else f"{edge.kind}"
            child = QTreeWidgetItem([label, edge.kind])
            child.setData(0, Qt.UserRole, ("edge", edge.id))
            edges_root.addChild(child)
        self._edges_root = edges_root
        nets_root.setExpanded(True)
        nodes_root.setExpanded(True)
        edges_root.setExpanded(True)

    def select_node(self, node_id: str) -> None:
        self._select(("node", node_id))

    def select_edge(self, edge_id: str) -> None:
        self._select(("edge", edge_id))

    def _select(self, target: tuple[str, str]) -> None:
        root = self.tree.invisibleRootItem()
        for index in range(root.childCount()):
            top = root.child(index)
            for child_index in range(top.childCount()):
                child = top.child(child_index)
                if child.data(0, Qt.UserRole) == target:
                    self.tree.setCurrentItem(child)
                    self.tree.scrollToItem(child)
                    return

    def _on_click(self, item: QTreeWidgetItem, _column: int) -> None:
        data = item.data(0, Qt.UserRole)
        if not data:
            return
        kind, ident = data
        if kind == "node":
            self.nodeActivated.emit(ident)
        elif kind == "edge":
            self.edgeActivated.emit(ident)
        elif kind == "network":
            self.networkActivated.emit(ident)

    def _on_double(self, item: QTreeWidgetItem, _column: int) -> None:
        self._on_click(item, 0)

    def _on_menu(self, pos) -> None:
        item = self.tree.itemAt(pos)
        if item is None:
            return
        data = item.data(0, Qt.UserRole)
        if not data:
            return
        kind, ident = data
        from PySide6.QtWidgets import QMenu

        menu = QMenu(self)
        if kind in ("node", "edge"):
            action = menu.addAction("删除")
            action.triggered.connect(lambda: self.deleteRequested.emit(kind, ident))
        elif kind == "network":
            action = menu.addAction("切换")
            action.triggered.connect(lambda: self.networkActivated.emit(ident))
            rename = menu.addAction("重命名")
            rename.triggered.connect(lambda: self.networkRequested.emit(f"rename:{ident}"))
            remove = menu.addAction("删除网络")
            remove.triggered.connect(lambda: self.networkRequested.emit(f"remove:{ident}"))
        if menu.actions():
            menu.exec(self.tree.viewport().mapToGlobal(pos))


class Inspector(QWidget):
    updateRequested = Signal(str, str, object)   # kind, id, payload
    deleteRequested = Signal(str, str)
    focusRequested = Signal(str)                 # 在画布中居中

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._catalog: dict[str, dict[str, Any]] = {}
        self._scene: SceneVM | None = None
        self._target: tuple[str, str] | None = None

        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        scroll = QScrollArea(self)
        scroll.setWidgetResizable(True)
        self.body = QWidget(scroll)
        self.body_layout = QVBoxLayout(self.body)
        self.body_layout.setContentsMargins(10, 10, 10, 10)
        self.body_layout.setSpacing(8)
        scroll.setWidget(self.body)
        outer.addWidget(scroll)

        self.title = QLabel("未选择")
        font = QFont(FONT_FAMILY, 11)
        font.setBold(True)
        self.title.setFont(font)
        self.body_layout.addWidget(self.title)

        self.subtitle = QLabel("在画布或工程树中选择节点/连接")
        self.subtitle.setWordWrap(True)
        self.subtitle.setStyleSheet("color: palette(mid);")
        self.body_layout.addWidget(self.subtitle)

        self.form_box = QGroupBox("属性")
        self.form = QFormLayout(self.form_box)
        self.form.setLabelAlignment(Qt.AlignLeft)
        self.form.setFieldGrowthPolicy(QFormLayout.AllNonFixedFieldsGrow)
        self.body_layout.addWidget(self.form_box)

        self.state_box = QGroupBox("状态")
        state_layout = QVBoxLayout(self.state_box)
        self.state_view = QPlainTextEdit()
        self.state_view.setReadOnly(True)
        self.state_view.setMaximumHeight(150)
        state_layout.addWidget(self.state_view)
        self.body_layout.addWidget(self.state_box)

        buttons = QHBoxLayout()
        self.apply_button = QPushButton("应用修改")
        self.apply_button.clicked.connect(self._apply)
        self.delete_button = QPushButton("删除")
        self.delete_button.clicked.connect(self._delete)
        self.focus_button = QPushButton("在画布居中")
        self.focus_button.clicked.connect(self._focus)
        buttons.addWidget(self.apply_button)
        buttons.addWidget(self.focus_button)
        buttons.addWidget(self.delete_button)
        self.body_layout.addLayout(buttons)
        self.body_layout.addStretch(1)
        self._fields: dict[str, QWidget] = {}
        self._clear_form()

    # ---- 外部 -------------------------------------------------------------
    def set_catalog(self, catalog: Mapping[str, Any]) -> None:
        self._catalog.clear()
        for key in ("elements", "computes", "circuit_nodes", "methods"):
            for entry in catalog.get(key) or []:
                if isinstance(entry, Mapping) and entry.get("kind"):
                    self._catalog.setdefault(str(entry["kind"]), dict(entry))

    def show_node(self, node: NodeVM) -> None:
        self._target = ("node", node.id)
        self.title.setText(node.name)
        self.subtitle.setText(f"节点 · {node.kind} · {node.id}")
        self._clear_form()
        name_edit = QLineEdit(node.name)
        self.form.addRow("名称", name_edit)
        self._fields["name"] = name_edit
        x_spin = QDoubleSpinBox()
        x_spin.setRange(-100000, 100000)
        x_spin.setDecimals(1)
        x_spin.setValue(node.x)
        y_spin = QDoubleSpinBox()
        y_spin.setRange(-100000, 100000)
        y_spin.setDecimals(1)
        y_spin.setValue(node.y)
        position_row = QWidget()
        row_layout = QHBoxLayout(position_row)
        row_layout.setContentsMargins(0, 0, 0, 0)
        row_layout.addWidget(x_spin)
        row_layout.addWidget(y_spin)
        self.form.addRow("位置 x / y", position_row)
        self._fields["x"] = x_spin
        self._fields["y"] = y_spin

        entry = self._catalog.get(node.kind) or {}
        for spec in entry.get("params") or []:
            widget = self._make_widget(spec, node.params.get(spec["key"], spec.get("default")))
            if widget is None:
                continue
            label = str(spec.get("label") or spec.get("key"))
            if spec.get("unit"):
                label = f"{label} ({spec['unit']})"
            if spec.get("help"):
                widget.setToolTip(str(spec["help"]))
            self.form.addRow(label, widget)
            self._fields[str(spec["key"])] = widget
        self._set_state(node.state)
        self.delete_button.setEnabled(True)
        self.focus_button.setEnabled(True)
        self.apply_button.setEnabled(True)

    def show_edge(self, edge: EdgeVM, scene: SceneVM) -> None:
        self._target = ("edge", edge.id)
        self.title.setText(edge.name or edge.kind)
        source = scene.node(edge.source)
        target = scene.node(edge.target)
        self.subtitle.setText(
            f"连接 · {edge.kind} · {source.name if source else '?'} → {target.name if target else '?'}"
        )
        self._clear_form()
        name_edit = QLineEdit(edge.name)
        self.form.addRow("名称", name_edit)
        self._fields["name"] = name_edit

        route = QComboBox()
        route.addItems(["auto", "orthogonal", "straight"])
        route.setCurrentText(edge.route if edge.route in ("auto", "orthogonal", "straight") else "auto")
        self.form.addRow("路由", route)
        self._fields["route"] = route

        delay = QCheckBox("延迟边")
        delay.setChecked(edge.delay)
        self.form.addRow("", delay)
        self._fields["delay"] = delay

        enabled = QCheckBox("启用")
        enabled.setChecked(edge.enabled)
        self.form.addRow("", enabled)
        self._fields["enabled"] = enabled

        waypoints = QLabel(f"{len(edge.waypoints)} 个拐点")
        self.form.addRow("拐点", waypoints)
        self._set_state({"length": round(edge.length, 2)})
        self.delete_button.setEnabled(True)
        self.focus_button.setEnabled(False)
        self.apply_button.setEnabled(True)

    def show_empty(self) -> None:
        self._target = None
        self.title.setText("未选择")
        self.subtitle.setText("在画布或工程树中选择节点/连接")
        self._clear_form()
        self.state_view.clear()
        self.apply_button.setEnabled(False)
        self.delete_button.setEnabled(False)
        self.focus_button.setEnabled(False)

    # ---- 内部 -------------------------------------------------------------
    def _clear_form(self) -> None:
        self._fields.clear()
        while self.form.rowCount():
            self.form.removeRow(0)

    def _set_state(self, state: Mapping[str, Any]) -> None:
        try:
            text = json.dumps(dict(state or {}), ensure_ascii=False, indent=2, default=str)
        except (TypeError, ValueError):
            text = str(state)
        self.state_view.setPlainText(text)

    def _make_widget(self, spec: Mapping[str, Any], value: Any) -> QWidget | None:
        kind = str(spec.get("type") or "float")
        if kind == "float":
            widget = QDoubleSpinBox()
            widget.setDecimals(6)
            widget.setRange(
                float(spec.get("min", -1e9)) if spec.get("min") is not None else -1e9,
                float(spec.get("max", 1e9)) if spec.get("max") is not None else 1e9,
            )
            widget.setSingleStep(float(spec.get("step") or 0.1))
            widget.setValue(float(value if value is not None else 0.0))
            return widget
        if kind == "int":
            widget = QSpinBox()
            widget.setRange(
                int(spec.get("min", -10**9)) if spec.get("min") is not None else -10**9,
                int(spec.get("max", 10**9)) if spec.get("max") is not None else 10**9,
            )
            widget.setValue(int(value or 0))
            return widget
        if kind == "bool":
            widget = QCheckBox()
            widget.setChecked(bool(value))
            return widget
        if kind == "choice":
            widget = QComboBox()
            for choice in spec.get("choices") or []:
                widget.addItem(str(choice.get("label") or choice.get("value")), choice.get("value"))
            index = widget.findData(value)
            if index >= 0:
                widget.setCurrentIndex(index)
            return widget
        if kind in ("text", "node"):
            widget = QLineEdit(str(value if value is not None else ""))
            if spec.get("placeholder"):
                widget.setPlaceholderText(str(spec["placeholder"]))
            return widget
        widget = QLineEdit(json.dumps(value, ensure_ascii=False) if not isinstance(value, str) else value)
        widget.setProperty("paramType", kind)
        return widget

    def _apply(self) -> None:
        if self._target is None:
            return
        kind, ident = self._target
        payload: dict[str, Any] = {}
        specs = {}
        if kind == "node":
            node = self._scene.node(ident) if self._scene else None
            entry = self._catalog.get(node.kind if node else "") or {}
            specs = {str(spec["key"]): spec for spec in entry.get("params") or []}
        for key, widget in self._fields.items():
            if isinstance(widget, QLineEdit):
                if key == "name":
                    payload["name"] = widget.text()
                elif widget.property("paramType"):
                    try:
                        payload[key] = json.loads(widget.text())
                    except (TypeError, ValueError):
                        payload[key] = widget.text()
                else:
                    spec = specs.get(key) or {}
                    text = widget.text()
                    if spec.get("type") in ("list", "mapping", "matrix", "json"):
                        try:
                            payload[key] = json.loads(text)
                        except (TypeError, ValueError):
                            payload[key] = text
                    else:
                        payload[key] = text
            elif isinstance(widget, QDoubleSpinBox):
                if key in ("x", "y"):
                    payload.setdefault("position", {})[key] = float(widget.value())
                else:
                    payload.setdefault("params", {})[key] = float(widget.value())
            elif isinstance(widget, QSpinBox):
                payload.setdefault("params", {})[key] = int(widget.value())
            elif isinstance(widget, QCheckBox):
                if key in ("delay", "enabled"):
                    payload[key] = bool(widget.isChecked())
                else:
                    payload.setdefault("params", {})[key] = bool(widget.isChecked())
            elif isinstance(widget, QComboBox):
                if key == "route":
                    payload["route"] = widget.currentText()
                else:
                    payload.setdefault("params", {})[key] = widget.currentData()
        self.updateRequested.emit(kind, ident, payload)

    def _delete(self) -> None:
        if self._target is not None:
            self.deleteRequested.emit(*self._target)

    def _focus(self) -> None:
        if self._target is not None and self._target[0] == "node":
            self.focusRequested.emit(self._target[1])


class ModulePalette(QListWidget):
    """模块库：把元件/模块从列表拖进画布（spec 票 13）。

    mime 里只放 ``kind`` 字符串，落点由画布按当前视图换算成世界坐标。
    """

    MIME = "application/x-netlab-kind"

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setDragEnabled(True)
        self.setDragDropMode(QListWidget.DragOnly)
        self.setSelectionMode(QListWidget.SingleSelection)
        self.setUniformItemSizes(True)
        self.setAlternatingRowColors(False)

    def set_entries(self, entries: list[Mapping[str, Any]]) -> None:
        self.clear()
        for entry in entries:
            label = str(entry.get("label") or entry.get("kind") or "")
            group = str(entry.get("group") or "")
            item = QListWidgetItem(f"{label}  ·  {group}" if group else label)
            payload = {
                "kind": str(entry.get("kind") or ""),
                "params": dict(entry.get("params") or {}),
            }
            item.setData(Qt.UserRole, json.dumps(payload, ensure_ascii=False))
            item.setToolTip(str(entry.get("help") or entry.get("kind") or ""))
            self.addItem(item)

    def mimeData(self, items) -> QMimeData:  # noqa: N802 - Qt 命名
        data = QMimeData()
        if items:
            raw = str(items[0].data(Qt.UserRole) or "")
            if raw:
                data.setData(self.MIME, raw.encode("utf-8"))
                data.setText(f"netlab-kind:{raw}")
        return data


__all__ = ["Inspector", "ModulePalette", "ProjectTree"]
