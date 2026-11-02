"""Qt 控件层测试：模块库拖放、剪贴板、撤销栈与快捷键让位。

这些用例需要 QApplication；本机没有 pytest-qt，所以自己管一个单例。
"""

from __future__ import annotations

import json

import pytest

pytest.importorskip("PySide6")

from PySide6.QtCore import QMimeData  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402


@pytest.fixture(scope="module")
def qapp():
    app = QApplication.instance() or QApplication([])
    yield app


@pytest.fixture()
def window(qapp):
    from netlab.server import SERVICE
    from netlab.templates import build_template
    from netlab.ui.shell import MainWindow

    SERVICE.load_scene(build_template("rlc_series"))
    win = MainWindow(SERVICE)
    win._dirty = False
    yield win
    win._dirty = False
    win.stop_fem()
    win.bridge.stop_live()
    win.close()


def test_palette_entries_carry_kind_and_params(qapp):
    from netlab.ui.panels import ModulePalette

    palette = ModulePalette()
    palette.set_entries(
        [
            {"kind": "device", "params": {"element": "resistor"}, "label": "电阻", "group": "元件"},
            {"kind": "sum", "params": {}, "label": "求和", "group": "运算"},
        ]
    )
    assert palette.count() == 2
    payload = json.loads(str(palette.item(0).data(0x0100)))
    assert payload["kind"] == "device"
    assert payload["params"] == {"element": "resistor"}
    mime = palette.mimeData([palette.item(0)])
    assert isinstance(mime, QMimeData)
    assert json.loads(bytes(mime.data(ModulePalette.MIME)).decode("utf-8"))["kind"] == "device"


def test_canvas_drop_payload_parses_json(qapp):
    from netlab.ui.canvas.widget import CanvasWidget

    mime = QMimeData()
    mime.setData("application/x-netlab-kind", json.dumps({"kind": "device", "params": {"element": "diode"}}).encode())
    kind, params = CanvasWidget._drop_payload(mime)
    assert kind == "device"
    assert params == {"element": "diode"}

    mime2 = QMimeData()
    mime2.setText("netlab-kind:sum")
    assert CanvasWidget._drop_payload(mime2) == ("sum", {})


def test_drop_node_adds_circuit_device(window):
    from netlab.templates import build_template
    from netlab.server import SERVICE

    SERVICE.load_scene(build_template("blank_circuit"))
    window.bridge.refresh(immediate=True)
    before = len(window.canvas.scene().nodes)
    window._on_drop_node("device", {"element": "resistor"}, 60.0, 40.0)
    window.bridge.refresh(immediate=True)
    scene = window.canvas.scene()
    assert len(scene.nodes) == before + 1
    added = scene.nodes[-1]
    assert added.kind == "device"
    assert added.params.get("element") == "resistor"


def test_undo_stack_caps_at_limit(window):
    from netlab.ui.shell import MAX_UNDO

    assert MAX_UNDO >= 100
    for index in range(MAX_UNDO + 15):
        window._record()
        window._undo.append({"scene": {"nodes": [], "edges": []}, "index": index})
        if len(window._undo) > MAX_UNDO:
            window._undo.pop(0)
    assert len(window._undo) == MAX_UNDO


def test_shortcut_guard_skips_text_widgets(window, qapp):
    from PySide6.QtWidgets import QLineEdit

    calls: list[int] = []
    guarded = window._guard(lambda: calls.append(1))
    guarded()
    assert calls == [1]

    editor = QLineEdit(window)
    window.show()
    window.activateWindow()
    editor.show()
    editor.setFocus()
    qapp.processEvents()
    if QApplication.focusWidget() is not editor:  # 无桌面会话时焦点拿不到
        pytest.skip("当前平台无法聚焦控件")
    guarded()
    assert calls == [1], "输入框里不应触发全局快捷键"
    editor.close()


def test_duplicate_and_paste_roundtrip(window):
    from netlab.templates import build_template
    from netlab.server import SERVICE

    SERVICE.load_scene(build_template("rlc_series"))
    window.bridge.refresh(immediate=True)
    scene = window.canvas.scene()
    first = scene.nodes[0].id
    window.canvas.set_selection([first])
    before = len(scene.nodes)
    window.duplicate_selection()
    window.bridge.refresh(immediate=True)
    assert len(window.canvas.scene().nodes) == before + 1

    window.canvas.set_selection([first])
    window.copy_selection()
    window.paste_clipboard()
    window.bridge.refresh(immediate=True)
    assert len(window.canvas.scene().nodes) == before + 2


def test_motion_ramp_settles_without_animation(qapp):
    """关掉动效时 Ramp 直接落位，不依赖事件循环（无桌面会话也能测）。"""
    from netlab.ui import motion

    class Owner:
        def update(self):
            pass

    motion.set_enabled(False)
    try:
        ramp = motion.Ramp(Owner(), step_ms=16, speed=4.0)
        ramp.to(1.0)
        assert ramp.value == pytest.approx(1.0)
        ramp.to(0.0)
        assert ramp.value == pytest.approx(0.0)
    finally:
        motion.set_enabled(True)


def test_plotkit_bridge_theme_and_channels(qapp):
    """桥接层：改主题写进 figure.spec；通道过滤只留选中节点。"""
    from netlab.ui.plotkit_panel import ensure_plotkit_importable

    if not ensure_plotkit_importable():
        pytest.skip("plotkit 未安装")
    plotkit = pytest.importorskip("plotkit")
    from netlab import plotkit_bridge

    fig = plotkit.figure(size=(4, 3), theme="default")
    fig.add_data("t", [], role="coord", life="append")
    for key in ("n:a:v", "n:b:v"):
        fig.add_data(key, [], role="series", life="append")
        fig.add_plot(x="t", y=key, label=key)
    plotkit_bridge._STATE["figure"] = fig
    try:
        assert plotkit_bridge.set_theme(True) is True
        assert fig.spec["figure"]["theme"] == "netlab-dark"
        assert set(plotkit_bridge.channels()) == {"n:a:v", "n:b:v"}
        assert plotkit_bridge.set_channels(["n:a:v"]) is True
        plotted = [(layer.get("data") or {}).get("y") for layer in fig.spec.get("layers") or []]
        assert plotted == ["n:a:v"]
    finally:
        plotkit_bridge._STATE["figure"] = None
        plotkit_bridge._FORCED["theme"] = None
        plotkit_bridge._FORCED["keys"] = None


def test_catalog_entries_follow_mode(window):
    """模块库必须按模式过滤：circuit 才有 device/node，signal 只认 computes。"""
    circuit_kinds = {entry["kind"] for entry in window._catalog_entries()}
    assert "device" in circuit_kinds
    assert "node" in circuit_kinds

    window.bridge.set_mode("signal")
    signal_kinds = {entry["kind"] for entry in window._catalog_entries()}
    computes = {str(item.get("kind")) for item in window.service.scene.catalog()["computes"]}
    assert signal_kinds, "信号模式不能列出空目录"
    assert signal_kinds <= computes
    assert "device" not in signal_kinds


def test_autosave_write_and_recover(window, monkeypatch, tmp_path):
    """A21 的机制层：写自动保存 → 清空场景 → 能原样装回来。"""
    from netlab.ui.shell import autosave_path

    monkeypatch.setenv("APPDATA", str(tmp_path))
    window._autosave_enabled = True
    window.bridge.set_mode("signal")
    window.bridge.add_node("gain", 20.0, 20.0)
    window._set_dirty(True)
    window._autosave()

    path = autosave_path()
    assert path.is_file(), "自动保存没有写盘"
    assert path.stat().st_size > 0

    window.bridge.set_mode("signal")
    assert not window.service.snapshot()["scene"]["nodes"]

    assert window.recover_autosave() is True
    kinds = [node.kind for node in window.bridge.scene.nodes]
    assert "gain" in kinds
    assert window._dirty is True

    path.unlink(missing_ok=True)
    window._autosave_enabled = False
