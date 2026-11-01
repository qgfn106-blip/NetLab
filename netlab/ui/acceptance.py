"""验收脚本：原生壳起来后，确认没有 QtWebEngineProcess、没有监听端口。

    python -m netlab.ui.acceptance          # 默认 6 秒后自动退出
"""

from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path


def main() -> int:
    import psutil

    root = Path(__file__).resolve().parents[2]
    proc = subprocess.Popen(
        [sys.executable, "-m", "netlab.desktop", "--native", "--allow-multi"],
        cwd=str(root),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        time.sleep(6.0)
        if proc.poll() is not None:
            print(f"FAIL 进程提前退出 code={proc.returncode}")
            return 1
        parent = psutil.Process(proc.pid)
        children = parent.children(recursive=True)
        names = [child.name() for child in children]
        engine = [name for name in names if "QtWebEngine" in name]
        print(f"children={names}")
        print(f"webengine_processes={len(engine)}")
        listeners: list[str] = []
        for item in [parent, *children]:
            try:
                for conn in item.net_connections(kind="inet"):
                    if conn.status == psutil.CONN_LISTEN:
                        listeners.append(f"{item.name()}:{conn.laddr.port}")
            except Exception:
                continue
        print(f"listening={listeners}")
        rss = parent.memory_info().rss / (1024 * 1024)
        print(f"rss_mb={rss:.0f}")
        ok = not engine and not listeners
        print("PASS" if ok else "FAIL")
        return 0 if ok else 1
    finally:
        try:
            proc.terminate()
            proc.wait(timeout=10)
        except Exception:
            proc.kill()


if __name__ == "__main__":
    raise SystemExit(main())
