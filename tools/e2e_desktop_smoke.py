#!/usr/bin/env python3
"""G3d L2 桌面壳烟测：调用 python -m netlab.desktop --selftest，断言 200 与 shim。"""
from __future__ import annotations

import ast
import json
import subprocess
import sys


def main() -> int:
    proc = subprocess.run(
        [sys.executable, "-m", "netlab.desktop", "--selftest"],
        capture_output=True,
        text=True,
        timeout=180,
    )
    out = (proc.stdout or "").strip().splitlines()
    payload = None
    for line in reversed(out):
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            try:
                payload = json.loads(line)
                break
            except json.JSONDecodeError:
                try:
                    payload = ast.literal_eval(line)
                    break
                except (ValueError, SyntaxError):
                    continue
    if proc.returncode != 0 or not payload:
        print("FAIL: desktop selftest exit=%s stdout=%s stderr=%s" % (proc.returncode, proc.stdout[-500:], proc.stderr[-500:]))
        return 1
    if payload.get("status") != 200 or payload.get("shim_injected") is not True:
        print("FAIL: desktop selftest payload=%s" % {k: payload.get(k) for k in ("status", "shim_injected", "shim_status")})
        return 1
    print("OK: desktop L2 smoke passed (status=200, shim_injected=true)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
