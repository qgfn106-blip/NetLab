"""A21 强杀恢复：验证「进程被强杀后，未保存的工作还能装回来」。

做法是三个独立进程，模拟真实崩溃路径：

1. 子进程 A 建场景、加一个节点、写自动保存，然后 ``os._exit(0)`` —— **不关窗、不清理**，
   等价于任务管理器结束进程；
2. 父进程检查自动保存文件确实落盘；
3. 子进程 B 重新起界面，调 ``recover_autosave()``，把恢复后的节点数打印出来。

用法::

    python -m netlab.ui.restore_check
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

WRITE_SCRIPT = r"""
import os
from PySide6.QtWidgets import QApplication
app = QApplication([])
from netlab.server import SERVICE
from netlab.ui.shell import MainWindow
SERVICE.ensure_thread()
w = MainWindow(SERVICE)
w.bridge.add_node("gain", 40.0, 40.0)
w.bridge.refresh(immediate=True)
w._set_dirty(True)
w._autosave()
print("nodes_before", len(SERVICE.snapshot()["scene"]["nodes"]), flush=True)
sys_autosave = w.has_autosave()
print("autosave", sys_autosave, flush=True)
os._exit(0)
"""

RECOVER_SCRIPT = r"""
import os
from PySide6.QtWidgets import QApplication
app = QApplication([])
from netlab.server import SERVICE
from netlab.ui.shell import MainWindow
SERVICE.ensure_thread()
w = MainWindow(SERVICE)
ok = w.recover_autosave()
print("recovered", ok, flush=True)
print("nodes_after", len(SERVICE.snapshot()["scene"]["nodes"]), flush=True)
print("dirty", w._dirty, flush=True)
os._exit(0)
"""


def _run(script: str, root: Path) -> tuple[int, str]:
    proc = subprocess.run(
        [sys.executable, "-c", script],
        cwd=str(root),
        capture_output=True,
        text=True,
        timeout=180,
    )
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def _value(text: str, key: str, cast=int) -> object:
    for line in text.splitlines():
        if line.startswith(key):
            raw = line.split()[-1]
            try:
                return cast(raw)
            except ValueError:
                return raw
    return None


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    from .shell import autosave_path

    target = autosave_path()
    target.unlink(missing_ok=True)

    code, out = _run(WRITE_SCRIPT, root)
    print("--- 崩溃前 ---")
    print(out.strip())
    if code != 0:
        print(f"子进程 A 异常退出：{code}")
        return 1
    if not target.is_file():
        print(f"自动保存没有落盘：{target}")
        return 1
    size = target.stat().st_size
    before = _value(out, "nodes_before")

    code, out = _run(RECOVER_SCRIPT, root)
    print("--- 重启后 ---")
    print(out.strip())
    if code != 0:
        print(f"子进程 B 异常退出：{code}")
        return 1

    after = _value(out, "nodes_after")
    recovered = "recovered True" in out
    ok = bool(recovered and isinstance(after, int) and after >= 1)
    print(f"\n自动保存 {size} 字节；崩溃前 {before} 个节点 → 恢复后 {after} 个；恢复{'成功' if recovered else '失败'}")
    print(f"结论：{'PASS' if ok else 'FAIL'}")
    target.unlink(missing_ok=True)
    return 0 if ok else 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
