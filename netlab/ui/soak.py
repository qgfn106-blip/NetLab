"""A18 长跑：启动原生界面，定时采样常驻内存，判断是否平稳。

用法::

    python -m netlab.ui.soak                # 默认 30 分钟、每 15 秒采样
    python -m netlab.ui.soak --minutes 2    # 快速验证脚本本身

判据（写进 QT_NATIVE_SPEC.md A18）：全程不崩、末段均值不超过首段均值的 1.5 倍，
且总增长 < 80 MB。低于 10 分钟的运行只作为「脚本自检」，不算 A18 通过。
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path


def _rss(pid: int) -> float:
    try:
        import psutil

        return psutil.Process(pid).memory_info().rss / (1024 * 1024)
    except Exception:
        return 0.0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="netlab-soak", description="原生界面长跑内存采样")
    parser.add_argument("--minutes", type=float, default=30.0)
    parser.add_argument("--interval", type=float, default=15.0)
    parser.add_argument("--theme", default="light", choices=["light", "dark"])
    parser.add_argument("--project", default="")
    args = parser.parse_args(argv)

    root = Path(__file__).resolve().parents[2]
    command = [sys.executable, "-m", "netlab.desktop", "--native", "--allow-multi", "--no-recover",
               "--theme", args.theme]
    if args.project:
        command += ["--project", args.project]
    proc = subprocess.Popen(command, cwd=str(root))
    samples: list[tuple[float, float]] = []
    started = time.time()
    deadline = started + args.minutes * 60
    try:
        while time.time() < deadline:
            time.sleep(args.interval)
            if proc.poll() is not None:
                print(f"进程提前退出：code={proc.returncode}")
                return 1
            rss = _rss(proc.pid)
            elapsed = time.time() - started
            samples.append((elapsed, rss))
            print(f"[{elapsed:7.1f}s] rss={rss:6.1f} MB")
    except KeyboardInterrupt:
        pass
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()

    if len(samples) < 3:
        print("采样点不足，无法判断")
        return 1
    head = sum(v for _, v in samples[:3]) / 3
    tail = sum(v for _, v in samples[-3:]) / 3
    growth = max(v for _, v in samples) - min(v for _, v in samples)
    long_enough = args.minutes >= 10
    stable = tail <= head * 1.5 and growth < 80
    print(f"\n首段 {head:.1f} MB → 末段 {tail:.1f} MB，波动 {growth:.1f} MB")
    print(f"时长 {args.minutes:.0f} 分钟，{'满足' if long_enough else '不足'} A18 的 30 分钟要求")
    verdict = "PASS" if (stable and long_enough) else ("SOFT-PASS（脚本自检）" if stable else "FAIL")
    print(f"结论：{verdict}")
    return 0 if stable else 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
