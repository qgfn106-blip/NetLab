"""GUI 级 e2e 冒烟（需真窗口）。

默认跳过；本机有 WebView2 且设 `NETLAB_GUI_SMOKE=1` 时启用：
    $env:NETLAB_GUI_SMOKE='1'; python -m pytest netlab/tests/test_gui_smoke.py -q
它会起 pywebview/WebView2 真窗口跑 `python -m netlab.desktop --probe`，断言桥接可用、
JS→Python 往返成功（has_autosave_roundtrip=true）。
"""

import os

import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("NETLAB_GUI_SMOKE") != "1",
    reason="GUI 冒烟需真窗口（pywebview/WebView2）；设 NETLAB_GUI_SMOKE=1 启用",
)


def test_gui_probe_smoke():
    from tools.gui_smoke import check_invariants, run_probe

    rc, data, out, err = run_probe(seconds=20)
    assert rc == 0, f"probe rc={rc}\n{out[-1500:]}\n{err[-1500:]}"
    assert data is not None, "probe 未输出 JSON"
    failed = [c for c in check_invariants(data) if not c[1]]
    assert not failed, f"GUI 冒烟不通过: {failed}"
