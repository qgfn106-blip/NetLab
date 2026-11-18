"""桌面壳 save_text 桥：导出必须落到用户选的路径，且不许假成功。"""

from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

from netlab.desktop.webview_bridge import WebviewBridge


class _FakeWindow:
    """记录对话框参数，并返回预设路径（None 表示用户取消）。"""

    def __init__(self, target: Path | None) -> None:
        self.target = target
        self.calls: list[dict] = []

    def create_file_dialog(self, *args, **kwargs):
        self.calls.append({"args": args, "kwargs": dict(kwargs)})
        return None if self.target is None else str(self.target)


@pytest.fixture(autouse=True)
def _fake_webview(monkeypatch):
    """pywebview 在纯后端测试环境里可能没装，塞一个只含对话框常量的桩。"""
    module = sys.modules.get("webview")
    if module is None:
        monkeypatch.setitem(
            sys.modules,
            "webview",
            types.SimpleNamespace(SAVE_DIALOG="save", OPEN_DIALOG="open"),
        )
    yield


def _bridge(target: Path | None) -> tuple[WebviewBridge, _FakeWindow]:
    bridge = WebviewBridge("http://127.0.0.1:9/")
    window = _FakeWindow(target)
    bridge.attach(window)
    return bridge, window


def test_save_text_writes_user_chosen_path_and_reports_it(tmp_path):
    target = tmp_path / "diagram.svg"
    bridge, window = _bridge(target)

    path = bridge.save_text("diagram.svg", "<svg xmlns=\"http://www.w3.org/2000/svg\"/>")

    assert path == str(target)
    assert target.read_text(encoding="utf-8") == '<svg xmlns="http://www.w3.org/2000/svg"/>'
    assert bridge._last_directory == str(tmp_path)
    kwargs = window.calls[0]["kwargs"]
    assert kwargs["save_filename"] == "diagram.svg"
    assert any("*.svg" in item for item in kwargs["file_types"])


def test_save_text_cancel_returns_empty_and_writes_nothing(tmp_path):
    bridge, window = _bridge(None)

    assert bridge.save_text("diagram.svg", "<svg/>") == ""
    assert not list(tmp_path.iterdir())
    assert len(window.calls) == 1


def test_save_text_appends_suffix_when_user_omits_it(tmp_path):
    bridge, _ = _bridge(tmp_path / "diagram")

    path = bridge.save_text("diagram.svg", "<svg/>")

    assert path == str(tmp_path / "diagram.svg")
    assert (tmp_path / "diagram.svg").exists()


def test_save_text_writes_lf_newlines_so_content_stays_stable(tmp_path):
    target = tmp_path / "scene.json"
    bridge, _ = _bridge(target)

    bridge.save_text("scene.json", "{\n  \"a\": 1\n}\n")

    assert target.read_bytes() == b'{\n  "a": 1\n}\n'


def test_save_text_reports_failure_instead_of_pretending_success(tmp_path):
    bridge, _ = _bridge(tmp_path / "missing-dir" / "scene.json")

    result = bridge.save_text("scene.json", "{}")

    assert result.startswith("__error__")


def test_save_text_is_exposed_to_the_desktop_shim():
    """前端垫片必须真的映射 save_text，否则桌面导出会退回假成功的浏览器下载。"""
    shim = (Path(__file__).resolve().parents[2] / "frontend" / "desktop-shim.ts").read_text(
        encoding="utf-8"
    )
    assert "saveText: wrap('save_text')" in shim
    assert "saveText: DesktopMethod;" in shim


def test_desktop_export_prefers_the_bridge_over_blob_download():
    """app.ts 的导出必须先尝试原生保存，浏览器才退回 blob。"""
    app = (Path(__file__).resolve().parents[2] / "frontend" / "app.ts").read_text(encoding="utf-8")
    assert "callBridge('saveText', [defaultName, text])" in app
    assert app.count("if (await saveTextViaDesktop(") == 2
    assert "原理图 SVG 已导出" not in app
    assert "场景已导出" not in app
