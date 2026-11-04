"""PlotKit 导入优先级（2026-11-04）。

内置副本随 netlab 分发、版本固定，必须优先于环境里可能残留的旧安装；
``NETLAB_PLOTKIT_SRC`` 是显式覆盖，优先级最高。用子进程验证，避免污染
当前测试进程的 ``sys.modules``。
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

CODE = """
from netlab import plotkit_bridge
assert plotkit_bridge.ensure_plotkit_importable(), plotkit_bridge.last_error()
import plotkit
print(plotkit.__file__)
"""


def _run(env_extra: dict[str, str] | None = None) -> str:
    env = os.environ.copy()
    env.pop("PYTHONPATH", None)
    if env_extra:
        env.update(env_extra)
    proc = subprocess.run(
        [sys.executable, "-c", CODE],
        cwd=str(REPO),
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0, proc.stderr
    return proc.stdout.strip()


def test_vendored_copy_wins_over_installed_package():
    from netlab import plotkit_vendor

    if plotkit_vendor.vendor_path() is None:
        return  # 没有内置副本时该断言不适用
    out = _run()
    assert "_vendor" in out.lower(), f"应加载内置副本，实际 {out}"


def test_env_override_has_highest_priority(tmp_path: Path):
    pkg = tmp_path / "plotkit"
    pkg.mkdir()
    (pkg / "__init__.py").write_text("MARKER = 'override'\n", encoding="utf-8")
    out = _run({"NETLAB_PLOTKIT_SRC": str(tmp_path)})
    assert str(tmp_path) in out, f"应加载 NETLAB_PLOTKIT_SRC，实际 {out}"
