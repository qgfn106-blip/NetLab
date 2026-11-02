"""主窗口：菜单、工具条、停靠面板、状态栏与全部快捷键。

外壳只做三件事：把动作翻译成 :class:`ServiceBridge` 调用、把快照分发给
控件、把用户手势落到撤销栈。业务逻辑一律不在这一层。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from PySide6.QtCore import QPoint, QRect, QSettings, QSize, QSizeF, Qt, QTimer
from PySide6.QtGui import QAction, QActionGroup, QKeySequence, QPageSize
from PySide6.QtWidgets import (
    QAbstractSpinBox,
    QApplication,
    QComboBox,
    QDockWidget,
    QFileDialog,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QMessageBox,
    QPlainTextEdit,
    QPushButton,
    QSlider,
    QTabWidget,
    QTextEdit,
    QToolBar,
    QVBoxLayout,
    QWidget,
)

from ..project import PROJECT_SUFFIX, atomic_write, compute_checksum, load_project_raw, validate_project
from . import motion
from .bridge import FemWorker, ServiceBridge

AUTOSAVE_INTERVAL_MS = 60_000


def autosave_path() -> Path:
    """与 web 壳一致：``%APPDATA%/Netlab/NetlabDesktop/autosave.netlab``。"""
    import os

    base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
    return Path(base) / "Netlab" / "NetlabDesktop" / "autosave.netlab"
from .canvas.widget import CanvasWidget
from .charts import FemPlot, LissajousPlot, PhasePlot, ScopePlot, TimeSeriesPlot
from .models import LiveVM, SceneVM
from .panels import Inspector, ModulePalette, ProjectTree
from .theme import build_qss, tokens

APP_ORG = "Netlab"
APP_NAME = "NetlabDesktop"
MAX_UNDO = 120

#: 这些控件拿到焦点时，全局单键/编辑快捷键让位给控件自身（spec 票 13）。
TEXT_WIDGETS = (QLineEdit, QTextEdit, QPlainTextEdit, QAbstractSpinBox)


class MainWindow(QMainWindow):
    def __init__(self, service: Any = None, *, theme: str = "light") -> None:
        super().__init__()
        from ..server import SERVICE

        self.service = service if service is not None else SERVICE
        self.bridge = ServiceBridge(self.service, self)
        self.bridge.reload_catalog()
        self.settings = QSettings(APP_ORG, APP_NAME)
        self.theme_name = str(self.settings.value("theme", theme) or theme)
        motion.set_enabled(bool(self.settings.value("motion", True, type=bool)))
        self._tokens = tokens(self.theme_name)
        self._undo: list[dict[str, Any]] = []
        self._redo: list[dict[str, Any]] = []
        self._dirty = False
        self._path = ""
        self._autosave_timer: QTimer | None = None
        self._live: LiveVM | None = None
        self._fem_worker: FemWorker | None = None
        self._selected: str | None = None

        self.setWindowTitle("Netlab")
        self.resize(1440, 900)
        self._build_central()
        self._build_docks()
        self._fill_palette()
        self._build_actions()
        self._build_menus()
        self._build_toolbar()
        self._build_status()
        self._connect()
        self.apply_theme(self.theme_name)
        try:
            from .. import plotkit_bridge

            plotkit_bridge.set_theme(self.theme_name == "dark")
        except Exception:
            pass
        self._restore_state()
        self.bridge.refresh(immediate=True)
        self.bridge.start_live()
        self._update_actions()

        # 自动保存：与 web 壳同一路径、同一节奏，强杀后能恢复（A21）。
        self._autosave_enabled = True
        self._autosave_timer = QTimer(self)
        self._autosave_timer.setInterval(AUTOSAVE_INTERVAL_MS)
        self._autosave_timer.timeout.connect(self._autosave)
        self._autosave_timer.start()

    # ------------------------------------------------------------------
    # 构建
    # ------------------------------------------------------------------
    def _build_central(self) -> None:
        self.canvas = CanvasWidget(self._tokens, self)
        self.setCentralWidget(self.canvas)

    def _build_docks(self) -> None:
        self.tree = ProjectTree(self)
        self.tree_dock = QDockWidget("工程", self)
        self.tree_dock.setObjectName("dock-tree")
        self.tree_dock.setWidget(self.tree)
        self.tree_dock.setAllowedAreas(Qt.LeftDockWidgetArea | Qt.RightDockWidgetArea)
        self.addDockWidget(Qt.LeftDockWidgetArea, self.tree_dock)

        self.palette = ModulePalette(self)
        self.palette_dock = QDockWidget("模块", self)
        self.palette_dock.setObjectName("dock-palette")
        self.palette_dock.setWidget(self.palette)
        self.palette_dock.setAllowedAreas(Qt.LeftDockWidgetArea | Qt.RightDockWidgetArea)
        self.addDockWidget(Qt.LeftDockWidgetArea, self.palette_dock)
        self.tabifyDockWidget(self.tree_dock, self.palette_dock)

        self.inspector = Inspector(self)
        self.inspector_dock = QDockWidget("属性", self)
        self.inspector_dock.setObjectName("dock-inspector")
        self.inspector_dock.setWidget(self.inspector)
        self.inspector_dock.setAllowedAreas(Qt.LeftDockWidgetArea | Qt.RightDockWidgetArea)
        self.addDockWidget(Qt.RightDockWidgetArea, self.inspector_dock)

        self.time_plot = TimeSeriesPlot("时域", self)
        self.phase_plot = PhasePlot("相图", self)
        self.scope_plot = ScopePlot("示波器", self)
        self.liss_plot = LissajousPlot("李萨如", self)
        self.fem_plot = FemPlot("有限元温度场", self)
        self.chart_tabs = QTabWidget(self)
        self.chart_tabs.addTab(self.time_plot, "时域")
        self.chart_tabs.addTab(self.phase_plot, "相图")
        self.chart_tabs.addTab(self.scope_plot, "示波器")
        self.chart_tabs.addTab(self.liss_plot, "李萨如")
        self.chart_tabs.addTab(self.fem_plot, "FEM")
        self.chart_tabs.currentChanged.connect(self._on_chart_tab)

        self.key_list = QListWidget(self)
        self.key_list.setMaximumWidth(190)
        self.key_list.setAlternatingRowColors(True)
        self.key_list.itemChanged.connect(self._on_keys_changed)
        chart_host = QWidget(self)
        chart_layout = QHBoxLayout(chart_host)
        chart_layout.setContentsMargins(0, 0, 0, 0)
        chart_layout.addWidget(self.key_list)
        chart_layout.addWidget(self.chart_tabs, 1)
        self.chart_dock = QDockWidget("图表", self)
        self.chart_dock.setObjectName("dock-charts")
        self.chart_dock.setWidget(chart_host)
        self.addDockWidget(Qt.BottomDockWidgetArea, self.chart_dock)

        self.log = QPlainTextEdit(self)
        self.log.setReadOnly(True)
        self.log.setMaximumBlockCount(400)
        self.log_dock = QDockWidget("日志", self)
        self.log_dock.setObjectName("dock-log")
        self.log_dock.setWidget(self.log)
        self.addDockWidget(Qt.BottomDockWidgetArea, self.log_dock)
        self.tabifyDockWidget(self.chart_dock, self.log_dock)
        self.chart_dock.raise_()

    def _build_actions(self) -> None:
        self.act_new = QAction("新建工程", self, shortcut=QKeySequence.New, triggered=self.new_project)
        self.act_open = QAction("打开工程…", self, shortcut=QKeySequence.Open, triggered=self.open_project)
        self.act_save = QAction("保存", self, shortcut=QKeySequence.Save, triggered=self.save_project)
        self.act_save_as = QAction("另存为…", self, shortcut="Ctrl+Shift+S", triggered=self.save_project_as)
        self.act_export = QAction("导出场景 JSON…", self, triggered=self.export_scene_json)
        self.act_import = QAction("导入场景 JSON…", self, triggered=self.import_scene_json)
        self.act_quit = QAction("退出", self, shortcut=QKeySequence.Quit, triggered=self.close)

        self.act_undo = QAction("撤销", self, shortcut=QKeySequence.Undo, triggered=self._guard(self.undo))
        self.act_redo = QAction("重做", self, shortcut=QKeySequence.Redo, triggered=self._guard(self.redo))
        self.act_delete = QAction("删除选中", self, shortcut=QKeySequence.Delete, triggered=self._guard(self.delete_selection))
        self.act_select_all = QAction("全选", self, shortcut=QKeySequence.SelectAll, triggered=self._guard(self.select_all))
        self.act_copy = QAction("复制", self, shortcut=QKeySequence.Copy, triggered=self._guard(self.copy_selection))
        self.act_paste = QAction("粘贴", self, shortcut=QKeySequence.Paste, triggered=self._guard(self.paste_clipboard))
        self.act_duplicate = QAction("复制一份", self, shortcut="Ctrl+D", triggered=self._guard(self.duplicate_selection))
        self.act_export_png = QAction("导出画布 PNG…", self, shortcut="Ctrl+E", triggered=self.export_png)
        self.act_export_pdf = QAction("导出画布 PDF…", self, triggered=lambda: self.export_vector("pdf"))
        self.act_export_svg = QAction("导出画布 SVG…", self, triggered=lambda: self.export_vector("svg"))

        self.act_grid = QAction("显示网格", self, checkable=True, checked=True)
        self.act_grid.toggled.connect(lambda v: self.canvas.set_grid(v))
        self.act_snap = QAction("吸附网格", self, checkable=True, checked=True)
        self.act_snap.toggled.connect(self.canvas.set_snap)
        self.act_motion = QAction("界面动效", self, checkable=True, checked=True)
        self.act_motion.setStatusTip("过渡动画：面板展开、主题切换、画布流动虚线")
        self.act_motion.toggled.connect(self._toggle_motion)
        self.act_fit = QAction("适配视图", self, shortcut="Ctrl+0", triggered=self.canvas.fit)
        self.act_zoom_in = QAction("放大", self, shortcut=QKeySequence.ZoomIn, triggered=lambda: self.canvas.zoom_to(1.15))
        self.act_zoom_out = QAction("缩小", self, shortcut=QKeySequence.ZoomOut, triggered=lambda: self.canvas.zoom_to(1 / 1.15))
        self.act_theme = QAction("切换主题", self, shortcut="Ctrl+Shift+T", triggered=self.toggle_theme)

        self.act_run = QAction("运行", self, shortcut="F5", triggered=lambda: self.control("run"))
        self.act_pause = QAction("暂停", self, shortcut="F6", triggered=lambda: self.control("pause"))
        self.act_toggle = QAction("运行/暂停", self, shortcut="F7", triggered=lambda: self.control("toggle"))
        self.act_step = QAction("单步", self, shortcut="F10", triggered=lambda: self.control("step"))
        self.act_zero = QAction("时间清零", self, triggered=lambda: self.control("zero"))
        self.act_reset = QAction("重置", self, triggered=lambda: self.control("reset"))

        self.act_docs = QAction("使用文档", self, shortcut="F1", triggered=self.open_docs)
        self.act_about = QAction("关于", self, triggered=self.show_about)
        self.act_plotkit = QAction("PlotKit 面板", self, shortcut="Ctrl+Shift+P", triggered=self.toggle_plotkit)

        for action in (self.act_new, self.act_open, self.act_save):
            self.addAction(action)

    def _guard(self, fn):
        """输入框里打字时，全局快捷键让位给控件自身。"""

        def wrapped(*args, **kwargs):
            widget = QApplication.focusWidget()
            if isinstance(widget, TEXT_WIDGETS):
                return None
            return fn(*args, **kwargs)

        return wrapped

    def _build_menus(self) -> None:
        bar = self.menuBar()
        file_menu = bar.addMenu("文件")
        file_menu.addAction(self.act_new)
        file_menu.addAction(self.act_open)
        file_menu.addSeparator()
        file_menu.addAction(self.act_save)
        file_menu.addAction(self.act_save_as)
        file_menu.addSeparator()
        file_menu.addAction(self.act_export)
        file_menu.addAction(self.act_import)
        file_menu.addSeparator()
        file_menu.addAction(self.act_export_png)
        file_menu.addAction(self.act_export_pdf)
        file_menu.addAction(self.act_export_svg)
        file_menu.addSeparator()
        file_menu.addAction(self.act_quit)

        edit_menu = bar.addMenu("编辑")
        edit_menu.addAction(self.act_undo)
        edit_menu.addAction(self.act_redo)
        edit_menu.addSeparator()
        edit_menu.addAction(self.act_copy)
        edit_menu.addAction(self.act_paste)
        edit_menu.addAction(self.act_duplicate)
        edit_menu.addSeparator()
        edit_menu.addAction(self.act_select_all)
        edit_menu.addAction(self.act_delete)

        view_menu = bar.addMenu("视图")
        view_menu.addAction(self.act_grid)
        view_menu.addAction(self.act_snap)
        view_menu.addAction(self.act_motion)
        view_menu.addSeparator()
        view_menu.addAction(self.act_fit)
        view_menu.addAction(self.act_zoom_in)
        view_menu.addAction(self.act_zoom_out)
        view_menu.addSeparator()
        view_menu.addAction(self.act_theme)
        view_menu.addAction(self.act_plotkit)
        view_menu.addSeparator()
        view_menu.addAction(self.tree_dock.toggleViewAction())
        view_menu.addAction(self.palette_dock.toggleViewAction())
        view_menu.addAction(self.inspector_dock.toggleViewAction())
        view_menu.addAction(self.chart_dock.toggleViewAction())
        view_menu.addAction(self.log_dock.toggleViewAction())

        sim_menu = bar.addMenu("仿真")
        sim_menu.addAction(self.act_run)
        sim_menu.addAction(self.act_pause)
        sim_menu.addAction(self.act_toggle)
        sim_menu.addAction(self.act_step)
        sim_menu.addSeparator()
        sim_menu.addAction(self.act_zero)
        sim_menu.addAction(self.act_reset)
        sim_menu.addSeparator()
        mode_menu = sim_menu.addMenu("切换模式")
        self.mode_group = QActionGroup(self)
        for value, label in (("signal", "信号流"), ("circuit", "电路"), ("vector", "矢量")):
            action = QAction(label, self, checkable=True)
            action.setData(value)
            action.triggered.connect(lambda _checked=False, v=value: self.set_mode(v))
            self.mode_group.addAction(action)
            mode_menu.addAction(action)

        help_menu = bar.addMenu("帮助")
        help_menu.addAction(self.act_docs)
        help_menu.addAction(self.act_about)

    def _build_toolbar(self) -> None:
        bar = QToolBar("主工具条", self)
        bar.setObjectName("toolbar-main")
        bar.setMovable(False)
        bar.setIconSize(QSize(16, 16))
        self.addToolBar(bar)
        bar.addAction(self.act_run)
        bar.addAction(self.act_pause)
        bar.addAction(self.act_step)
        bar.addAction(self.act_zero)
        bar.addSeparator()
        bar.addWidget(QLabel(" 网络 "))
        self.network_combo = QComboBox(self)
        self.network_combo.setMinimumWidth(150)
        self.network_combo.activated.connect(self._on_network_combo)
        bar.addWidget(self.network_combo)
        self.add_network_button = QPushButton("＋", self)
        self.add_network_button.setToolTip("新建网络")
        self.add_network_button.clicked.connect(self.add_network)
        bar.addWidget(self.add_network_button)
        bar.addSeparator()
        bar.addWidget(QLabel(" 时间轴 "))
        self.time_slider = QSlider(Qt.Horizontal, self)
        self.time_slider.setMinimumWidth(180)
        self.time_slider.setRange(0, 0)
        self.time_slider.setToolTip("回看历史帧（0 = 最新）")
        self.time_slider.valueChanged.connect(self._on_seek)
        bar.addWidget(self.time_slider)
        self.time_label = QLabel("实时")
        self.time_label.setMinimumWidth(56)
        bar.addWidget(self.time_label)
        bar.addSeparator()
        bar.addWidget(QLabel(" 缩放 "))
        self.zoom_label = QLabel("100%")
        self.zoom_label.setMinimumWidth(48)
        bar.addWidget(self.zoom_label)
        bar.addAction(self.act_fit)
        bar.addSeparator()
        bar.addAction(self.act_theme)
        self._toolbar = bar

    def _build_status(self) -> None:
        bar = self.statusBar()
        self.status_mode = QLabel("信号流")
        self.status_net = QLabel("网络 1")
        self.status_run = QLabel("已停止")
        self.status_fps = QLabel("0.0 fps")
        self.status_cursor = QLabel("帧 0")
        self.status_hint = QLabel("双击空白新建节点 · 从引脚拖出连线 · 滚轮缩放")
        for widget in (self.status_mode, self.status_net, self.status_run, self.status_fps, self.status_cursor):
            bar.addWidget(widget)
            bar.addWidget(_separator())
        bar.addWidget(self.status_hint, 1)

    # ------------------------------------------------------------------
    # 连接
    # ------------------------------------------------------------------
    def _connect(self) -> None:
        self.bridge.sceneChanged.connect(self._on_scene)
        self.bridge.treeChanged.connect(self._on_tree)
        self.bridge.liveChanged.connect(self._on_live)
        self.bridge.statusChanged.connect(self._on_status)
        self.bridge.errorRaised.connect(self._on_error)
        self.bridge.logRaised.connect(self._log)

        self.canvas.selectionChanged.connect(self._on_selection)
        self.canvas.moveRequested.connect(self._on_move)
        self.canvas.edgeRequested.connect(self._on_edge_requested)
        self.canvas.deleteRequested.connect(self._on_delete_ids)
        self.canvas.contextRequested.connect(self._on_context)
        self.canvas.addNodeRequested.connect(self._on_add_node_at)
        self.canvas.dropNodeRequested.connect(self._on_drop_node)
        self.canvas.openInspectorRequested.connect(self._on_open_inspector)
        self.canvas.statusMessage.connect(self._log)
        self.canvas.zoomChanged.connect(lambda k: self.zoom_label.setText(f"{int(k * 100)}%"))

        self.tree.nodeActivated.connect(self._select_node)
        self.tree.edgeActivated.connect(self._select_edge)
        self.tree.networkActivated.connect(self._on_network_combo_id)
        self.tree.networkRequested.connect(self._on_network_request)
        self.tree.deleteRequested.connect(lambda kind, ident: self._on_delete_ids([ident]))

        self.inspector.updateRequested.connect(self._on_inspector_update)
        self.inspector.deleteRequested.connect(lambda kind, ident: self._on_delete_ids([ident]))
        self.inspector.focusRequested.connect(self.canvas.center_on)

    # ------------------------------------------------------------------
    # 快照回调
    # ------------------------------------------------------------------
    def _on_scene(self, scene: SceneVM) -> None:
        first = not getattr(self, "_scene_seen", False)
        self.canvas.set_scene(scene)
        # 打开工程/切换网络后自动适配一次；之后保持用户的缩放（同旧前端）
        if first and scene.nodes:
            self.canvas.request_fit()
        self._scene_seen = True
        self._last_scene = scene
        self.tree.set_scene(scene, self.service.list_networks())
        self._fill_network_combo()
        self._refresh_inspector()
        self._refresh_key_list()
        self.status_mode.setText({"signal": "信号流", "circuit": "电路", "vector": "矢量"}.get(scene.mode, scene.mode))
        self._update_actions()

    def _on_tree(self, _tree) -> None:
        self._fill_network_combo()

    def _fill_network_combo(self) -> None:
        try:
            networks = self.service.list_networks()
        except Exception:
            return
        current = self.network_combo.currentData()
        self.network_combo.blockSignals(True)
        self.network_combo.clear()
        for item in networks:
            self.network_combo.addItem(str(item.get("name", "")), item.get("id"))
        index = self.network_combo.findData(current)
        if index >= 0:
            self.network_combo.setCurrentIndex(index)
        self.network_combo.blockSignals(False)
        if networks:
            name = next((n.get("name") for n in networks if n.get("id") == current), networks[0].get("name"))
            self.status_net.setText(str(name))

    def _on_live(self, live: LiveVM) -> None:
        self._live = live
        # 图表停靠窗被折叠时也要保持数据连续，否则展开后会缺一段曲线。
        self.time_plot.push(live)
        self.scope_plot.push(live)
        self.phase_plot.push(live)
        self.liss_plot.push(live)
        self.status_cursor.setText(f"帧 {live.cursor}")
        if hasattr(self, "time_slider"):
            span = min(600, max(1, self.time_plot._window))
            self.time_slider.blockSignals(True)
            self.time_slider.setRange(0, span)
            if self.time_slider.value() > span:
                self.time_slider.setValue(span)
            self.time_slider.blockSignals(False)
        if self.key_list.count() == 0 and live.keys:
            self._refresh_key_list()
        if live.error:
            self.status_run.setText("错误")
            self.status_run.setStyleSheet("color:#a23b2c;")

    def _on_seek(self, back: int) -> None:
        """时间轴回看：0 表示跟随最新帧。"""
        value = int(back) or None
        for plot in (self.time_plot, self.scope_plot):
            plot.set_seek(value)
        self.time_label.setText("实时" if not value else f"−{value} 帧")

    def _on_status(self, info: dict[str, Any]) -> None:
        if not info:
            return
        running = bool(info.get("running") or info.get("is_running"))
        self.canvas.set_running(running)
        self.status_run.setText("运行中" if running else "已停止")
        self.status_run.setStyleSheet("")
        fps = float(info.get("actual_fps") or 0.0)
        self.status_fps.setText(f"{fps:.1f} fps")
        network = info.get("network") or {}
        if network.get("name"):
            self.status_net.setText(str(network["name"]))
        self.act_run.setEnabled(not running)
        self.act_pause.setEnabled(running)

    def _on_error(self, message: str) -> None:
        self._log(f"[错误] {message}")
        self.status_hint.setText(message)

    # ------------------------------------------------------------------
    # 选择与属性
    # ------------------------------------------------------------------
    def _on_selection(self, ids: list[str]) -> None:
        self._selected = ids[0] if len(ids) == 1 else None
        self._refresh_inspector()
        self._sync_plotkit_channels()

    def _sync_plotkit_channels(self) -> None:
        """选中节点时，让 PlotKit 只画它的探针；没选中就恢复全部通道。"""
        panel = getattr(self, "_plotkit", None)
        if panel is None or not panel.isVisible():
            return
        try:
            from .. import plotkit_bridge

            node = self.canvas.scene().node(self._selected) if self._selected else None
            if node is None:
                plotkit_bridge.set_channels(None)
                return
            keys = [key for key in plotkit_bridge.channels() if key.startswith(f"n:{node.name}:")]
            if keys:
                plotkit_bridge.set_channels(keys)
        except Exception:
            pass

    def _refresh_inspector(self) -> None:
        scene = self.canvas.scene()
        self.inspector._scene = scene
        if self._selected is None:
            self.inspector.show_empty()
            return
        node = scene.node(self._selected)
        if node is not None:
            self.inspector.show_node(node)
            self.tree.select_node(node.id)
            return
        edge = scene.edge(self._selected)
        if edge is not None:
            self.inspector.show_edge(edge, scene)
            self.tree.select_edge(edge.id)
            return
        self.inspector.show_empty()

    def _select_node(self, node_id: str) -> None:
        self.canvas.set_selection([node_id])
        self.canvas.center_on(node_id)

    def _select_edge(self, edge_id: str) -> None:
        self.canvas.set_selection([edge_id])

    def _on_open_inspector(self, node_id: str) -> None:
        self.canvas.set_selection([node_id])
        self.inspector_dock.show()
        self.inspector_dock.raise_()

    def _on_inspector_update(self, kind: str, ident: str, payload: dict[str, Any]) -> None:
        if not payload:
            return
        self._record()
        if kind == "node":
            self.bridge.update_node(ident, payload)
        else:
            self.bridge.update_edge(ident, payload)
        self._log(f"更新 {kind} {ident}")
        self._mark_dirty()

    # ------------------------------------------------------------------
    # 画布手势 → 服务
    # ------------------------------------------------------------------
    def _on_move(self, items: list[dict[str, float]]) -> None:
        self._record()
        self.bridge.move_nodes(items)
        self._mark_dirty()

    def _on_edge_requested(self, source: str, target: str) -> None:
        self._record()
        self.bridge.add_edge(source, target)
        self._mark_dirty()

    def _on_delete_ids(self, ids: list[str]) -> None:
        if not ids:
            return
        scene = self.canvas.scene()
        self._record()
        for ident in ids:
            if scene.node(ident) is not None:
                self.bridge.delete_node(ident)
            elif scene.edge(ident) is not None:
                self.bridge.delete_edge(ident)
        self._selected = None
        self._mark_dirty()

    def delete_selection(self) -> None:
        self._on_delete_ids(self.canvas.selection())

    def select_all(self) -> None:
        scene = self.canvas.scene()
        self.canvas.set_selection([node.id for node in scene.nodes])

    # ---- 剪贴板 ---------------------------------------------------------
    def _clipboard_payload(self, ids: list[str]) -> dict[str, Any]:
        scene = self.canvas.scene()
        nodes = []
        for ident in ids:
            node = scene.node(ident)
            if node is None:
                continue
            nodes.append(
                {
                    "id": node.id,
                    "name": node.name,
                    "kind": node.kind,
                    "params": dict(node.params),
                    "x": node.x,
                    "y": node.y,
                }
            )
        keep = {item["id"] for item in nodes}
        edges = [
            {"source": edge.source, "target": edge.target, "kind": edge.kind}
            for edge in scene.edges
            if edge.source in keep and edge.target in keep
        ]
        return {"nodes": nodes, "edges": edges}

    def copy_selection(self) -> None:
        payload = self._clipboard_payload(self.canvas.selection())
        if not payload["nodes"]:
            return
        QApplication.clipboard().setText(json.dumps(payload, ensure_ascii=False))
        self.statusBar().showMessage(f"已复制 {len(payload['nodes'])} 个节点", 2000)

    def _insert_payload(self, payload: dict[str, Any], dx: float, dy: float) -> list[str]:
        mapping: dict[str, str] = {}
        created: list[str] = []
        for item in payload.get("nodes") or []:
            record = self.bridge.add_node(
                str(item.get("kind") or "manual"),
                float(item.get("x", 0.0)) + dx,
                float(item.get("y", 0.0)) + dy,
                "",
                dict(item.get("params") or {}),
            )
            new_id = getattr(record, "id", None)
            if new_id:
                mapping[str(item.get("id"))] = new_id
                created.append(new_id)
        for edge in payload.get("edges") or []:
            source = mapping.get(str(edge.get("source")))
            target = mapping.get(str(edge.get("target")))
            if source and target:
                self.bridge.add_edge(source, target, str(edge.get("kind") or "wire"))
        return created

    def paste_clipboard(self) -> None:
        text = QApplication.clipboard().text()
        if not text:
            return
        try:
            payload = json.loads(text)
        except ValueError:
            return
        if not isinstance(payload, dict) or not payload.get("nodes"):
            return
        self._record()
        created = self._insert_payload(payload, 28.0, 28.0)
        if created:
            self.canvas.set_selection(created)
            self._mark_dirty()
            self.statusBar().showMessage(f"已粘贴 {len(created)} 个节点", 2000)

    def duplicate_selection(self) -> None:
        payload = self._clipboard_payload(self.canvas.selection())
        if not payload["nodes"]:
            return
        self._record()
        created = self._insert_payload(payload, 32.0, 32.0)
        if created:
            self.canvas.set_selection(created)
            self._mark_dirty()
            self.statusBar().showMessage(f"已复制 {len(created)} 个节点", 2000)

    def export_png(self) -> None:
        path, _ = QFileDialog.getSaveFileName(self, "导出画布 PNG", "canvas.png", "PNG (*.png)")
        if not path:
            return
        image = self.canvas.grab().toImage()
        if image.save(path, "PNG"):
            self.statusBar().showMessage(f"已导出 {path}", 3000)
        else:
            self._on_error("导出失败")

    def export_vector(self, kind: str) -> None:
        """导出画布为 PDF/SVG；文字保留为文本，可选中（A20）。"""
        from PySide6.QtGui import QPainter, QPdfWriter
        from PySide6.QtSvg import QSvgGenerator

        suffix = ".pdf" if kind == "pdf" else ".svg"
        filters = "PDF (*.pdf)" if kind == "pdf" else "SVG (*.svg)"
        path, _ = QFileDialog.getSaveFileName(self, f"导出画布 {kind.upper()}", f"canvas{suffix}", filters)
        if not path:
            return
        if not path.lower().endswith(suffix):
            path += suffix
        size = self.canvas.size()
        painter: QPainter
        if kind == "pdf":
            writer = QPdfWriter(path)
            writer.setResolution(96)
            writer.setPageSize(QPageSize(QSizeF(size.width() / 96.0 * 25.4, size.height() / 96.0 * 25.4),
                                         QPageSize.Millimeter))
            painter = QPainter(writer)
        else:
            generator = QSvgGenerator()
            generator.setFileName(path)
            generator.setSize(size)
            generator.setViewBox(QRect(0, 0, size.width(), size.height()))
            generator.setTitle("netlab canvas")
            painter = QPainter(generator)
        try:
            self.canvas.render(painter, QPoint(0, 0))
        except Exception as exc:  # pragma: no cover - 依赖 Qt 后端
            self._on_error(f"导出失败：{exc}")
            return
        finally:
            painter.end()
        self.statusBar().showMessage(f"已导出 {path}", 3000)

    def _on_add_node_at(self, x: float, y: float) -> None:
        self.add_node_dialog(x, y)

    def add_node_dialog(self, x: float, y: float) -> None:
        from PySide6.QtWidgets import QDialog, QDialogButtonBox, QFormLayout

        entries = self._catalog_entries()
        if not entries:
            self._on_error("目录为空，无法添加节点")
            return
        dialog = QDialog(self)
        dialog.setWindowTitle("添加节点")
        form = QFormLayout(dialog)
        kind_combo = QComboBox(dialog)
        for index, entry in enumerate(entries):
            kind_combo.addItem(f"{entry['label']} · {entry['group']}", index)
        form.addRow("类型", kind_combo)
        name_edit = QComboBox(dialog)
        name_edit.setEditable(True)
        form.addRow("名称", name_edit)
        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel, dialog)
        buttons.accepted.connect(dialog.accept)
        buttons.rejected.connect(dialog.reject)
        form.addRow(buttons)
        if dialog.exec() != QDialog.Accepted:
            return
        index = kind_combo.currentData()
        entry = entries[int(index) if index is not None else 0]
        name = name_edit.currentText().strip()
        self._record()
        record = self.bridge.add_node(
            str(entry["kind"]), x, y, name, dict(entry.get("params") or {})
        )
        self._mark_dirty()
        if record is not None:
            node_id = getattr(record, "id", None)
            if node_id:
                self.canvas.set_selection([node_id])

    def _on_context(self, kind: str, ident: str | None, pos) -> None:
        from PySide6.QtWidgets import QMenu

        menu = QMenu(self)
        if kind == "node" and ident:
            menu.addAction("打开属性", lambda: self._on_open_inspector(ident))
            menu.addAction("在画布居中", lambda: self.canvas.center_on(ident))
            menu.addSeparator()
            menu.addAction("删除", lambda: self._on_delete_ids([ident]))
        elif kind == "edge" and ident:
            edge = self.canvas.scene().edge(ident)
            menu.addAction("清除拐点", lambda: self._edge_clear(ident))
            if edge is not None and not edge.enabled:
                menu.addAction("启用", lambda: self._edge_toggle(ident, True))
            elif edge is not None:
                menu.addAction("禁用", lambda: self._edge_toggle(ident, False))
            menu.addSeparator()
            menu.addAction("删除", lambda: self._on_delete_ids([ident]))
        else:
            menu.addAction("添加节点…", lambda: self.add_node_dialog(*self._canvas_center()))
            menu.addAction("适配视图", self.canvas.fit)
            menu.addAction("全选", self.select_all)
        menu.exec(pos)

    def _canvas_center(self) -> tuple[float, float]:
        return self.canvas._view.to_world(self.canvas.width() / 2, self.canvas.height() / 2)

    def _edge_clear(self, edge_id: str) -> None:
        self._record()
        self.bridge.clear_waypoints(edge_id)
        self._mark_dirty()

    def _edge_toggle(self, edge_id: str, enabled: bool) -> None:
        self._record()
        self.bridge.update_edge(edge_id, {"enabled": enabled})
        self._mark_dirty()

    # ------------------------------------------------------------------
    # 仿真
    # ------------------------------------------------------------------
    def control(self, action: str) -> None:
        self.bridge.control(action)
        if action in ("zero", "reset"):
            self.time_plot.clear()
            self.scope_plot.clear()
            self.phase_plot.clear_points()
            self.liss_plot.clear_points()

    def set_mode(self, mode: str) -> None:
        if mode == self.canvas.scene().mode:
            return
        if not self._confirm("切换模式会清空当前场景，继续？"):
            return
        self._record()
        self.bridge.set_mode(mode)
        self._fill_palette()
        self._mark_dirty()

    # ------------------------------------------------------------------
    # 模块库
    # ------------------------------------------------------------------
    def _catalog_entries(self) -> list[dict[str, Any]]:
        """把目录摊平成可添加的条目；电路元件统一成 ``device + element``。

        必须按当前模式过滤：signal/vector 模式只认 computes，circuit 模式只认
        circuit_nodes + elements。混在一起会让用户点到「未知的节点构造方式」。
        """
        catalog = self.service.scene.catalog()
        try:
            mode = str(self.service.scene.mode)
        except Exception:
            try:
                mode = str(self.bridge.scene.mode)
            except Exception:
                mode = ""
        if mode == "circuit":
            buckets: tuple[str, ...] = ("circuit_nodes", "elements")
        elif mode in ("signal", "vector"):
            buckets = ("computes",)
        else:
            buckets = ("computes", "circuit_nodes", "elements")
        entries: list[dict[str, Any]] = []
        for bucket in buckets:
            for entry in catalog.get(bucket) or []:
                if not entry.get("addable", True):
                    continue
                kind = str(entry.get("kind") or "")
                if not kind:
                    continue
                if bucket == "elements":
                    entries.append(
                        {
                            "kind": "device",
                            "params": {"element": kind},
                            "label": str(entry.get("label") or kind),
                            "group": str(entry.get("group") or ""),
                            "help": str(entry.get("help") or ""),
                        }
                    )
                else:
                    entries.append(
                        {
                            "kind": kind,
                            "params": {},
                            "label": str(entry.get("label") or kind),
                            "group": str(entry.get("group") or ""),
                            "help": str(entry.get("help") or ""),
                        }
                    )
        return entries

    def _fill_palette(self) -> None:
        self.palette.set_entries(self._catalog_entries())

    def _on_drop_node(self, kind: str, params: object, x: float, y: float) -> None:
        self._record()
        record = self.bridge.add_node(
            str(kind), float(x), float(y), "", dict(params) if isinstance(params, dict) else {}
        )
        if record is None:
            return
        node_id = getattr(record, "id", None)
        if node_id:
            self.canvas.set_selection([node_id])
        self._mark_dirty()

    # ------------------------------------------------------------------
    # 图表
    # ------------------------------------------------------------------
    def _refresh_key_list(self) -> None:
        keys = list(self._live.keys) if self._live else []
        if not keys:
            try:
                keys = list(self.service.info().get("probe_keys") or [])
            except Exception:
                keys = []
        if not keys:
            return
        current = {self.key_list.item(i).text() for i in range(self.key_list.count()) if self.key_list.item(i).checkState() == Qt.Checked}
        self.key_list.blockSignals(True)
        self.key_list.clear()
        selected = current or set(keys[:4])
        for key in keys:
            item = QListWidgetItem(key)
            item.setFlags(item.flags() | Qt.ItemIsUserCheckable)
            item.setCheckState(Qt.Checked if key in selected else Qt.Unchecked)
            self.key_list.addItem(item)
        self.key_list.blockSignals(False)
        self._apply_keys()

    def _on_keys_changed(self, _item) -> None:
        self._apply_keys()

    def _apply_keys(self) -> None:
        keys = [
            self.key_list.item(i).text()
            for i in range(self.key_list.count())
            if self.key_list.item(i).checkState() == Qt.Checked
        ]
        self.time_plot.set_keys(keys[:8])
        self.scope_plot.set_keys(keys[:8])
        if len(keys) >= 2:
            self.phase_plot.set_keys(keys[0], keys[1])
            self.liss_plot.set_keys(keys[0], keys[1])
        elif keys:
            self.phase_plot.set_keys(keys[0], keys[0])
            self.liss_plot.set_keys(keys[0], keys[0])

    def _on_chart_tab(self, index: int) -> None:
        if self.chart_tabs.widget(index) is self.fem_plot:
            self._start_fem()

    def _start_fem(self) -> None:
        if self._fem_worker is not None:
            return
        self._fem_worker = FemWorker(self)
        self._fem_worker.snapshotReady.connect(self.fem_plot.set_snapshot)
        self._fem_worker.failed.connect(self._log)
        self._fem_worker.start()

    def stop_fem(self) -> None:
        if self._fem_worker is not None:
            self._fem_worker.stop()
            self._fem_worker = None

    # ------------------------------------------------------------------
    # 工程
    # ------------------------------------------------------------------
    def new_project(self) -> None:
        if not self._confirm_dirty():
            return
        self._record()
        self.bridge.set_mode("signal")
        self._path = ""
        self._set_dirty(False)
        self._log("新建工程")

    def open_project(self) -> None:
        if not self._confirm_dirty():
            return
        path, _ = QFileDialog.getOpenFileName(self, "打开工程", "", f"Netlab 工程 (*{PROJECT_SUFFIX});;所有文件 (*.*)")
        if not path:
            return
        self.open_path(path)

    def open_path(self, path: str) -> None:
        try:
            raw = load_project_raw(Path(path))
            project = validate_project(raw)
            self.service.load_project(project)
            self.bridge.reset_live()
            self.bridge.refresh(immediate=True)
        except Exception as exc:
            QMessageBox.critical(self, "打开失败", str(exc))
            return
        self._path = path
        self._set_dirty(False)
        self._log(f"已打开 {path}")
        self.canvas.fit()

    def save_project(self) -> None:
        if not self._path:
            self.save_project_as()
            return
        self._write_project(self._path)

    def save_project_as(self) -> None:
        path, _ = QFileDialog.getSaveFileName(
            self, "保存工程", self._path or f"project{PROJECT_SUFFIX}", f"Netlab 工程 (*{PROJECT_SUFFIX})"
        )
        if not path:
            return
        if not path.endswith(PROJECT_SUFFIX):
            path += PROJECT_SUFFIX
        self._write_project(path)

    def _write_project(self, path: str) -> None:
        try:
            project = self.service.build_project(name=Path(path).stem)
            project = validate_project(project)
            text = json.dumps(project, ensure_ascii=False, indent=2)
            atomic_write(Path(path), text)
        except Exception as exc:
            QMessageBox.critical(self, "保存失败", str(exc))
            return
        self._path = path
        self._set_dirty(False)
        self._clear_autosave()
        self._log(f"已保存 {path}")

    # ------------------------------------------------------------------
    # 自动保存（A21：强杀后恢复未保存的工作）
    # ------------------------------------------------------------------
    def has_autosave(self) -> bool:
        return autosave_path().is_file()

    def _autosave(self) -> None:
        if not getattr(self, "_autosave_enabled", False) or not self._dirty:
            return
        try:
            project = validate_project(self.service.build_project(name="autosave"))
            target = autosave_path()
            target.parent.mkdir(parents=True, exist_ok=True)
            atomic_write(target, json.dumps(project, ensure_ascii=False, indent=2))
        except Exception as exc:  # 自动保存失败不能打断用户
            self._log(f"自动保存失败：{exc}")

    def _clear_autosave(self) -> None:
        try:
            autosave_path().unlink(missing_ok=True)
        except OSError:
            pass

    def recover_autosave(self) -> bool:
        """把自动保存装回场景；失败返回 False（不弹窗，由调用方决定提示）。"""
        path = autosave_path()
        if not path.is_file():
            return False
        try:
            project = validate_project(load_project_raw(path))
        except Exception as exc:
            self._log(f"恢复失败：{exc}")
            return False
        self.service.load_project(project)
        self.bridge.reset_live()
        self.bridge.refresh(immediate=True)
        self._set_dirty(True)
        self.canvas.fit()
        self._log("已恢复上次未保存的工作（自动保存）")
        return True

    def export_scene_json(self) -> None:
        path, _ = QFileDialog.getSaveFileName(self, "导出场景", "scene.json", "JSON (*.json)")
        if not path:
            return
        try:
            payload = self.service.export_scene(include_state=False)
            atomic_write(Path(path), json.dumps(payload, ensure_ascii=False, indent=2))
        except Exception as exc:
            QMessageBox.critical(self, "导出失败", str(exc))
            return
        self._log(f"已导出 {path}")

    def import_scene_json(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "导入场景", "", "JSON (*.json);;所有文件 (*.*)")
        if not path:
            return
        try:
            payload = json.loads(Path(path).read_text(encoding="utf-8"))
        except Exception as exc:
            QMessageBox.critical(self, "导入失败", str(exc))
            return
        self._record()
        self.bridge.import_scene(payload)
        self._mark_dirty()
        self.canvas.fit()

    def open_docs(self):
        from .docwin import DocWindow

        # 必须留引用：局部变量一旦回收，Qt 窗口会跟着被销毁。
        window = getattr(self, "_doc_window", None)
        if window is None:
            window = DocWindow(self, self._tokens)
            self._doc_window = window
        window.show()
        window.raise_()
        window.activateWindow()
        return window

    def show_about(self) -> None:
        QMessageBox.about(
            self,
            "关于 Netlab",
            "Netlab — 信号流 / 电路 / 矢量场仿真台\n\n原生 Qt 界面（netlab.ui）。",
        )

    def _toggle_motion(self, on: bool) -> None:
        motion.set_enabled(bool(on))
        self.settings.setValue("motion", bool(on))
        if on:
            motion.fade_in(self.canvas, 180, start=0.6, end=1.0)

    def toggle_plotkit(self) -> None:
        from .plotkit_panel import PlotKitPanel

        if getattr(self, "_plotkit", None) is None:
            self._plotkit = PlotKitPanel(self, theme=self.theme_name)
            self._plotkit.setObjectName("dock-plotkit")
            self._plotkit.setMinimumWidth(640)
            self._plotkit.setMinimumHeight(360)
            self.addDockWidget(Qt.RightDockWidgetArea, self._plotkit)
            self.resizeDocks([self._plotkit], [720], Qt.Horizontal)
            self.resizeDocks([self._plotkit], [max(420, self.height() - 260)], Qt.Vertical)
            # 编辑器需要面积：第一次打开时直接浮出来（1100×760），用户可随时点「浮动」收回停靠
            self._plotkit.setFloating(True)
            self._plotkit.resize(1100, 760)
            self._plotkit.move(
                self.x() + max(24, (self.width() - 1100) // 2),
                self.y() + max(24, (self.height() - 760) // 2),
            )
        visible = self._plotkit.isVisible()
        if visible:
            self._plotkit.setVisible(False)
        else:
            if not self._plotkit.isFloating():
                motion.slide_dock(self._plotkit, True)
            else:
                self._plotkit.show()
            self._plotkit.ensure_loaded()

    # ------------------------------------------------------------------
    # 撤销 / 脏标记
    # ------------------------------------------------------------------
    def _record(self) -> None:
        try:
            payload = self.service.export_scene(include_state=False)
        except Exception:
            return
        self._undo.append(payload)
        if len(self._undo) > MAX_UNDO:
            self._undo.pop(0)
        self._redo.clear()
        self._update_actions()

    def undo(self) -> None:
        if not self._undo:
            return
        try:
            current = self.service.export_scene(include_state=False)
        except Exception:
            current = None
        payload = self._undo.pop()
        if current is not None:
            self._redo.append(current)
        self.bridge.import_scene(payload)
        self._mark_dirty()
        self._update_actions()

    def redo(self) -> None:
        if not self._redo:
            return
        try:
            current = self.service.export_scene(include_state=False)
        except Exception:
            current = None
        payload = self._redo.pop()
        if current is not None:
            self._undo.append(current)
        self.bridge.import_scene(payload)
        self._mark_dirty()
        self._update_actions()

    def _update_actions(self) -> None:
        self.act_undo.setEnabled(bool(self._undo))
        self.act_redo.setEnabled(bool(self._redo))
        has_selection = bool(self.canvas.selection())
        self.act_delete.setEnabled(has_selection)

    def _mark_dirty(self) -> None:
        self._set_dirty(True)

    def _set_dirty(self, value: bool) -> None:
        self._dirty = value
        name = Path(self._path).name if self._path else "未命名工程"
        self.setWindowTitle(f"{'*' if value else ''}{name} — Netlab")

    def _confirm_dirty(self) -> bool:
        if not self._dirty:
            return True
        return self._confirm("当前工程未保存，继续将丢失修改。")

    def _confirm(self, text: str) -> bool:
        return (
            QMessageBox.question(self, "确认", text, QMessageBox.Yes | QMessageBox.No)
            == QMessageBox.Yes
        )

    # ------------------------------------------------------------------
    # 网络
    # ------------------------------------------------------------------
    def _on_network_combo(self, index: int) -> None:
        network_id = self.network_combo.itemData(index)
        if network_id:
            self._switch_network(str(network_id))

    def _on_network_combo_id(self, network_id: str) -> None:
        self._switch_network(network_id)

    def _switch_network(self, network_id: str) -> None:
        if network_id == getattr(self.service, "current_id", None):
            return
        self.bridge.switch_network(network_id)
        self._log(f"切换到网络 {network_id}")
        self.canvas.fit()

    def add_network(self) -> None:
        from PySide6.QtWidgets import QInputDialog

        name, ok = QInputDialog.getText(self, "新建网络", "名称", text="网络")
        if not ok or not name.strip():
            return
        self.bridge.add_network(name.strip())
        self._mark_dirty()

    def _on_network_request(self, command: str) -> None:
        action, _, ident = command.partition(":")
        if action == "rename":
            from PySide6.QtWidgets import QInputDialog

            name, ok = QInputDialog.getText(self, "重命名网络", "名称")
            if ok and name.strip():
                self.bridge.rename_network(ident, name.strip())
                self._mark_dirty()
        elif action == "remove":
            if self._confirm("删除该网络及其全部节点？"):
                self.bridge.remove_network(ident)
                self._mark_dirty()

    # ------------------------------------------------------------------
    # 主题与状态
    # ------------------------------------------------------------------
    def toggle_theme(self) -> None:
        self.apply_theme("dark" if self.theme_name == "light" else "light")

    def apply_theme(self, name: str) -> None:
        self.theme_name = name
        self._tokens = tokens(name)
        QApplication.instance().setStyleSheet(build_qss(self._tokens))
        for widget in (
            self.canvas, self.time_plot, self.phase_plot, self.scope_plot,
            self.liss_plot, self.fem_plot,
        ):
            widget.set_tokens(self._tokens)
        doc_window = getattr(self, "_doc_window", None)
        if doc_window is not None:
            doc_window._tokens = self._tokens
            doc_window._apply_theme()
        self.settings.setValue("theme", name)
        try:
            from .. import plotkit_bridge

            plotkit_bridge.set_theme(name == "dark")
        except Exception:
            pass
        panel = getattr(self, "_plotkit", None)
        if panel is not None:
            panel.set_theme(name)
        motion.fade_in(self.canvas, 190, start=0.55, end=1.0)

    def _restore_state(self) -> None:
        geometry = self.settings.value("geometry")
        if geometry:
            self.restoreGeometry(geometry)
        state = self.settings.value("state")
        if state:
            self.restoreState(state)
        self.act_grid.setChecked(bool(self.settings.value("show_grid", True, type=bool)))
        self.act_snap.setChecked(bool(self.settings.value("snap", True, type=bool)))
        self.act_motion.setChecked(bool(self.settings.value("motion", True, type=bool)))
        self.canvas.set_grid(self.act_grid.isChecked())
        self.canvas.set_snap(self.act_snap.isChecked())

    def _save_state(self) -> None:
        self.settings.setValue("geometry", self.saveGeometry())
        self.settings.setValue("state", self.saveState())
        self.settings.setValue("show_grid", self.act_grid.isChecked())
        self.settings.setValue("motion", self.act_motion.isChecked())
        self.settings.setValue("snap", self.act_snap.isChecked())

    def _log(self, message: str) -> None:
        self.log.appendPlainText(message)

    def closeEvent(self, event) -> None:  # noqa: N802
        if not self._confirm_dirty():
            event.ignore()
            return
        self._save_state()
        self.stop_fem()
        self.bridge.stop_live()
        timer = getattr(self, "_autosave_timer", None)
        if timer is not None:
            timer.stop()
        if getattr(self, "_autosave_enabled", False):
            self._clear_autosave()
        event.accept()


def _separator() -> QLabel:
    label = QLabel("·")
    label.setStyleSheet("color: palette(mid);")
    return label


__all__ = ["MainWindow"]
