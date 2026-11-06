"""GUI 级 e2e 冒烟：用 pywebview/WebView2 起真窗口，跑 `python -m netlab.desktop --probe`
检查桥接与 JS→Python 往返是否真的可用。

用法：
  python tools/gui_smoke.py                  # 跑一次并与基线比对（无基线则先写基线）
  python tools/gui_smoke.py --write-baseline # 跑一次并（重）写基线
退出码 0=通过，1=失败。

基线（对照“一期 P16 类型化后前端仍可正常运行”的 GUI 快照）：
  netlab/docs/ts-migration/baseline/2026-11-06/gui-probe.json
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
BASELINE = (
    REPO / "netlab" / "docs" / "ts-migration" / "baseline" / "2026-11-06" / "gui-probe.json"
)
# 稳定字段（不含 elapsed_ms / rss_tree_mb 等每次变化的量）
STATIC_KEYS = ["has_bridge", "has_win_ctl", "drag_region", "has_command", "has_autosave_roundtrip"]


def run_probe(seconds: int = 20) -> tuple[int, dict | None, str, str]:
    """起真窗口跑 --probe，返回 (exitcode, 解析后的 JSON, stdout, stderr)。"""
    env = dict(os.environ)
    env.update({"PYTHONIOENCODING": "utf-8", "NO_PROXY": "*", "no_proxy": "*"})
    proc = subprocess.run(
        [sys.executable, "-m", "netlab.desktop", "--probe", "--seconds", str(seconds)],
        cwd=str(REPO),
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=180,
        env=env,
    )
    data = None
    for line in (proc.stdout or "").splitlines():
        s = line.strip()
        if s.startswith("{") and s.endswith("}"):
            try:
                data = json.loads(s)
            except json.JSONDecodeError:
                pass
    return proc.returncode, data, proc.stdout or "", proc.stderr or ""


def normalize(data: dict) -> dict:
    out = {k: data.get(k) for k in STATIC_KEYS}
    out["title"] = data.get("title", "")
    return out


def check_invariants(data: dict) -> list[tuple[str, bool, object]]:
    res: list[tuple[str, bool, object]] = []
    res.append(("has_bridge", data.get("has_bridge") is True, data.get("has_bridge")))
    res.append(("has_win_ctl", data.get("has_win_ctl") is True, data.get("has_win_ctl")))
    res.append(("has_command", data.get("has_command") is True, data.get("has_command")))
    rt = data.get("has_autosave_roundtrip")
    res.append(("autosave_roundtrip", rt in ("true", True), rt))
    dr = data.get("drag_region")
    res.append(("drag_region", isinstance(dr, int) and dr > 0, dr))
    return res


def main(argv: list[str]) -> int:
    write = "--write-baseline" in argv
    rc, data, out, err = run_probe()
    if rc != 0 or data is None:
        print(f"[FAIL] probe rc={rc} data={data}")
        print(out[-2000:])
        print(err[-2000:])
        return 1

    checks = check_invariants(data)
    ok = all(c[1] for c in checks)
    for name, good, val in checks:
        print(("[OK]  " if good else "[FAIL]") + f" {name}={val!r}")
    print(f"[INFO] elapsed_ms={data.get('elapsed_ms')} rss_tree_mb={data.get('rss_tree_mb')}")

    norm = normalize(data)
    if write or not BASELINE.exists():
        BASELINE.parent.mkdir(parents=True, exist_ok=True)
        BASELINE.write_text(
            json.dumps(norm, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        print(f"[OK] baseline written: {BASELINE.relative_to(REPO)}")
        return 0 if ok else 1

    base = json.loads(BASELINE.read_text(encoding="utf-8"))
    drift = [k for k in STATIC_KEYS if base.get(k) != norm.get(k)]
    if drift:
        for k in drift:
            print(f"[FAIL] drift {k}: baseline={base.get(k)!r} now={norm.get(k)!r}")
        return 1
    print("[OK] GUI smoke matches baseline" if ok else "[FAIL] invariants failed")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
