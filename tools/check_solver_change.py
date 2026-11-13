"""N4 D-5：求解器改动必须携带 off/shadow/on 三态影子报告。

用法：
    python tools/check_solver_change.py --base HEAD^        # CI 子集检查
    python tools/check_solver_change.py --generate          # 生成当前代码指纹报告
    python tools/check_solver_change.py --self-test         # 脚本自测

报告按「所测代码指纹」命名（reports/shadow/<fingerprint>.json），因为要求
`<HEAD>.json` 在提交前生成、提交后 HEAD 变化，会形成自指矛盾；指纹直接绑定
被验证的数值代码内容，可在任意后续提交复核。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SHADOW_DIR = ROOT / "reports" / "shadow"
COMPUTE_PREFIX = "netlab/core/compute/"
RTOL = 1.0e-10


def _git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


class GateError(RuntimeError):
    """D-5 门禁失败（fail-closed）：无法确定是否改动计算代码时，必须显式失败而非放行。"""


def changed_compute_files(base: str) -> list[str]:
    if not base:
        # 未提供基线（本地 --generate / 无 DIFF_BASE）：不比较，合法返回空。
        return []
    if set(base) == {"0"}:
        # 全零哨兵（首提交 / 新分支 push 的 github.event.before）：无基线可比，合法返回空。
        return []
    try:
        out = _git("diff", "--name-only", f"{base}..HEAD")
    except subprocess.CalledProcessError as exc:
        # fail-closed：无效 base / diff 执行失败时绝不能当成“无计算改动”而放行。
        raise GateError(
            f"D-5: git diff against base '{base}' failed ({exc}); "
            "refusing to treat as 'no compute changes' (fail-closed)."
        ) from exc
    files = [line.strip() for line in out.splitlines() if line.strip()]
    return [p for p in files if p.startswith(COMPUTE_PREFIX) and p.endswith(".py")]


def code_fingerprint(files: list[str] | None = None) -> str:
    if files is None:
        files = sorted(
            str(p.relative_to(ROOT)).replace("\\", "/")
            for p in (ROOT / COMPUTE_PREFIX).rglob("*.py")
            if "__pycache__" not in p.parts
        )
    digest = hashlib.sha256()
    for path in sorted(files):
        digest.update(path.encode("utf-8"))
        digest.update(b"\0")
        # 指纹必须跨平台稳定：Windows 工作树可能是 CRLF，CI checkout 是 LF。
        digest.update((ROOT / path).read_bytes().replace(b"\r\n", b"\n"))
        digest.update(b"\0")
    return digest.hexdigest()


def _voltages(mode: str, count: int) -> np.ndarray:
    from netlab.core.compute.nodal import SolverOptions
    from netlab.core.model.scene import Scene

    scene = None
    # 复用 _ladder 的建图，但显式指定后端。
    from netlab.core.compute.nodal import SolverOptions as _SO

    scene = Scene("circuit")
    gnd = scene.add_node(name="gnd", kind="ground")
    nodes = [scene.add_node(name=f"n{i}", kind="node") for i in range(count)]
    scene.add_edge(
        name="V1", source=nodes[0].id, target=gnd.id, kind="vsource",
        params={"wave": "dc", "offset": 3.0, "amplitude": 0.0},
    )
    for index in range(count - 1):
        scene.add_edge(name=f"Rs{index}", source=nodes[index].id, target=nodes[index + 1].id,
                       kind="resistor", params={"R": 1000.0})
    for node in nodes:
        scene.add_edge(name=f"Rp{node.id}", source=node.id, target=gnd.id,
                       kind="resistor", params={"R": 1000.0})
    scene.set_solver_options(_SO(sparse=mode))
    scene.step(1.0e-4)
    return np.array([float(nodes[i].data.get("voltage", 0.0)) for i in range(count)])


def _analytic_reference(count: int, *, source: float = 3.0) -> np.ndarray:
    """独立参考解：手工装配电阻梯 G·v = b，用 numpy 直接求解（不调用 netlab 求解器）。"""
    r = 1000.0
    n = count
    a = np.zeros((n - 1, n - 1))
    b = np.zeros(n - 1)
    for i in range(1, n):
        row = i - 1
        a[row, row] += 1.0 / r  # left resistor
        if i < n - 1:
            a[row, row] += 1.0 / r
            a[row, row + 1] -= 1.0 / r
            a[row, row - 1] -= 1.0 / r
        a[row, row] += 1.0 / r  # shunt
        b[row] = source / r if i == 1 else 0.0
    tail = np.linalg.solve(a, b)
    return np.concatenate(([source], tail))


def build_report(files: list[str] | None = None) -> dict[str, Any]:
    from netlab.core.compute.shadow import shadow_gate

    count = 390
    off = _voltages("off", count)
    on = _voltages("on", count)
    shadow_cmp = shadow_gate(off, on, mode="shadow", rtol=RTOL)
    on_cmp = shadow_gate(off, on, mode="on", rtol=RTOL)
    reference = _analytic_reference(count)
    ref_cmp = shadow_gate(reference, on, mode="shadow", rtol=1e-6, atol=1e-8)

    modes = {
        "off": {"backend": "dense", "sample": off[:8].round(9).tolist(), "max": float(np.max(off))},
        "shadow": {
            "compared": "off vs on",
            "max_abs_error": shadow_cmp.max_abs_error,
            "max_rel_error": shadow_cmp.max_rel_error,
            "rtol": RTOL,
            "passed": shadow_cmp.passed,
        },
        "on": {
            "backend": "sparse",
            "sample": on[:8].round(9).tolist(),
            "max": float(np.max(on)),
            "max_abs_error": on_cmp.max_abs_error,
            "max_rel_error": on_cmp.max_rel_error,
            "rtol": RTOL,
            "passed": on_cmp.passed,
        },
    }
    report = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "code_fingerprint": code_fingerprint(None),
        "files": files or [],
        "modes": modes,
        "reference": {
            "kind": "numpy_dense_ladder_solve",
            "max_abs_error": ref_cmp.max_abs_error,
            "max_rel_error": ref_cmp.max_rel_error,
            "passed": ref_cmp.passed,
        },
        "pass": bool(shadow_cmp.passed and on_cmp.passed and ref_cmp.passed),
    }
    return report


def validate_report(report: dict[str, Any], *, files: list[str] | None = None) -> list[str]:
    errors: list[str] = []
    for key in ("version", "code_fingerprint", "modes", "reference", "pass"):
        if key not in report:
            errors.append(f"missing {key}")
    modes = report.get("modes") or {}
    for mode in ("off", "shadow", "on"):
        if mode not in modes:
            errors.append(f"missing modes.{mode}")
    shadow = modes.get("shadow") or {}
    on = modes.get("on") or {}
    for label, item in (("shadow", shadow), ("on", on)):
        rel = item.get("max_rel_error")
        if rel is None:
            errors.append(f"{label}.max_rel_error missing")
        elif float(rel) >= RTOL:
            errors.append(f"{label}.max_rel_error {rel} >= {RTOL}")
        if item.get("passed") is not True:
            errors.append(f"{label}.passed not true")
    ref = report.get("reference") or {}
    if ref.get("kind") not in ("analytic", "convergence", "numpy_dense_ladder_solve"):
        errors.append("reference.kind missing/unsupported")
    if ref.get("passed") is not True:
        errors.append("reference.passed not true")
    if report.get("pass") is not True:
        errors.append("report.pass not true")
    if files is not None:
        expected = code_fingerprint(None)
        if report.get("code_fingerprint") != expected:
            errors.append("code_fingerprint does not match current code")
    return errors


def _self_test() -> int:
    report = build_report(files=None)
    errs = validate_report(report, files=None)
    if errs:
        print("self-test baseline invalid:", errs)
        return 1
    for patch, name in (
        (lambda r: r["modes"].pop("shadow"), "delete modes.shadow"),
        (lambda r: r["modes"]["shadow"].__setitem__("max_rel_error", 1.0), "inflate shadow rel error"),
        (lambda r: r.pop("reference"), "delete reference"),
    ):
        import copy

        bad = copy.deepcopy(report)
        patch(bad)
        if not validate_report(bad):
            print(f"self-test FAILED: {name} did not turn red")
            return 1
    # fail-closed：git diff 失败 / 无效 base 时 changed_compute_files 必须抛 GateError，
    # 绝不能静默 return []（否则 D-5 闸门形同虚设）。
    original_git = globals()["_git"]

    def _raising_git(*_a: Any, **_k: Any) -> str:
        raise subprocess.CalledProcessError(128, ["git", "diff"])

    globals()["_git"] = _raising_git
    try:
        try:
            changed_compute_files("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef")
        except GateError:
            blocked = True
        else:
            blocked = False
    finally:
        globals()["_git"] = original_git
    if not blocked:
        print("self-test FAILED: fail-closed not enforced (invalid base did not raise GateError)")
        return 1
    # 合法空基线（全零哨兵 / 空串）应返回 []，不得报错。
    if changed_compute_files("0" * 40) != [] or changed_compute_files("") != []:
        print("self-test FAILED: legal empty/zero base should return []")
        return 1
    print("OK: D-5 self-test passed (baseline green; delete/inflate modes turn red; fail-closed on bad base)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=os.environ.get("DIFF_BASE", ""), help="git base revision")
    parser.add_argument("--generate", action="store_true", help="write report for current code")
    parser.add_argument("--self-test", action="store_true", help="run tool self-test")
    parser.add_argument("--file", type=Path, default=None, help="validate a specific report")
    args = parser.parse_args()

    if args.self_test:
        return _self_test()

    try:
        files = changed_compute_files(args.base)
    except GateError as exc:
        print(f"D-5 FAIL-CLOSED: {exc}", file=sys.stderr)
        return 2
    if args.generate:
        report = build_report(files=files)
        SHADOW_DIR.mkdir(parents=True, exist_ok=True)
        target = SHADOW_DIR / f"{report['code_fingerprint']}.json"
        target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"wrote {target.relative_to(ROOT)}")
        return 0 if report["pass"] else 1

    if args.file is not None:
        report = json.loads(args.file.read_text(encoding="utf-8"))
        errs = validate_report(report, files=None)
    elif files:
        expected = code_fingerprint(None)
        target = SHADOW_DIR / f"{expected}.json"
        if not target.is_file():
            print(f"D-5: changed compute files require shadow report {target.relative_to(ROOT)}; run --generate and commit it")
            return 1
        report = json.loads(target.read_text(encoding="utf-8"))
        errs = validate_report(report, files=files)
        if errs == []:
            tracked = subprocess.run(["git", "ls-files", "--error-unmatch", str(target.relative_to(ROOT))], cwd=ROOT,
                                     capture_output=True, text=True)
            if tracked.returncode != 0:
                errs.append(f"{target.relative_to(ROOT)} is not tracked by git")
    else:
        print("D-5: no numeric changes under netlab/core/compute/; shadow report not required")
        return 0

    if errs:
        print("D-5 shadow report INVALID:")
        for error in errs:
            print(" -", error)
        return 1
    print("OK: D-5 shadow report valid (off/shadow/on + independent reference)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
