#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""G2 层 F 变异烟雾测试：在临时 worktree 中制造源码变异体，并分类结果。

与旧版差异（WP-3）：
- 先跑 baseline；baseline 不绿直接 BASELINE_FAILED，不计算 score；
- 变异发生在临时 git worktree（或副本）中，源工作树前后 status 必须完全一致；
- 每个 mutant 分类为 killed / survived / invalid / infra-error；
- 每个 mutant 保存 diff、pytest.log、result.json；汇总为统一证据 JSON。

退出码：0=通过；1=score 低于阈值或控制组分类不符；2=baseline 失败；3=基础设施错误/源树被改动。

用法：
    python tools/mutation_smoke.py
    python tools/mutation_smoke.py --only resistor-gain-5pct --keep-worktree
    python tools/mutation_smoke.py --list
"""
from __future__ import annotations

import argparse
import difflib
import json
import os
import py_compile
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent
ROOT = TOOLS_DIR.parent
sys.path.insert(0, str(TOOLS_DIR))

import evidence  # noqa: E402

ELEMENTS = "netlab/core/compute/circuit/elements.py"

# (name, relative_path, old, new, expected, counts_toward_score)
MUTANTS = [
    ("resistor-gain-5pct", ELEMENTS, 'self.conductance = 1.0 / float(self.params["R"])', 'self.conductance = 1.05 / float(self.params["R"])', "killed", True),
    ("capacitor-trap-coeff", ELEMENTS, "self.conductance = 2.0 * cache / dt", "self.conductance = 1.8 * cache / dt", None, True),
    ("inductor-trap-coeff", ELEMENTS, "self.conductance = dt / (2.0 * self.inductance)", "self.conductance = dt / (1.8 * self.inductance)", None, True),
    ("source-gain-2pct", ELEMENTS, 'ctx.rhs[row] = self.value * getattr(self, "source_scale", 1.0)', 'ctx.rhs[row] = 1.02 * self.value * getattr(self, "source_scale", 1.0)', None, True),
    ("capacitor-value-5pct", ELEMENTS, "cache = self.capacitance", "cache = 1.05 * self.capacitance", None, True),
    ("inductor-history-sign", ELEMENTS, "self.source_current = previous_i + self.conductance * previous_v", "self.source_current = previous_i - self.conductance * previous_v", None, True),
    # F11：梯形积分源值必须取步末值；回退成半步平均会让正弦收敛阶掉到 ~1.0。
    ("source-trapezoid-halving", ELEMENTS, "    return waveform_value(params, time)", "    return 0.5 * (waveform_value(params, time - dt) + waveform_value(params, time))", None, True),
    # F12：电感梯形首步必须用后向欧拉启动，否则阶跃响应从半步起跳。
    ("inductor-first-step-trapezoid", ELEMENTS, "        elif not self._trapezoidal_started:", "        elif False:", None, True),
    # 正控制：语义等价的注释变异必须存活，用来证明“survived”分类不是把所有变异都报成 killed。
    ("control-comment-only", ELEMENTS, "from __future__ import annotations", "from __future__ import annotations  # mutation positive control", "survived", False),
]

# 除层 D 的解析/收敛用例外，还跑数值基准里的 RLC 收敛阶用例：
# F11（源值半步平均）与 F12（电感首步）只会在这些用例上变红。
PYTEST_ARGS = [
    "-m", "pytest",
    "netlab/tests/evals",
    "netlab/tests/benchmarks/test_numerical_benchmarks.py",
    "-q", "--tb=short", "-p", "no:cacheprovider",
]


def classify_outcome(
    *,
    pattern_found: bool,
    compile_error: str | None,
    exit_code: int | None,
    timed_out: bool = False,
    launch_error: str | None = None,
    output: str = "",
) -> str:
    """把单个 mutant 的执行结果映射为四类之一。"""
    if not pattern_found or compile_error:
        return "invalid"
    if timed_out or launch_error:
        return "infra-error"
    if exit_code == 0:
        return "survived"
    if exit_code == 1:
        return "killed"
    if exit_code == 3 or "INTERNALERROR" in output:
        return "infra-error"
    if exit_code in (2, 4, 5):
        return "invalid"
    if exit_code is None:
        return "infra-error"
    return "infra-error"


def build_diff(relative_path: str, original: str, mutated: str) -> str:
    return "".join(
        difflib.unified_diff(
            original.splitlines(keepends=True),
            mutated.splitlines(keepends=True),
            fromfile=f"a/{relative_path}",
            tofile=f"b/{relative_path}",
            n=3,
        )
    )


def _run(command, cwd: Path, timeout: float | None = None) -> dict:
    started = time.perf_counter()
    env = os.environ.copy()
    env["PYTHONPATH"] = "."
    try:
        completed = subprocess.run(
            [str(part) for part in command],
            cwd=cwd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            env=env,
            check=False,
        )
        return {
            "exit_code": completed.returncode,
            "stdout": completed.stdout,
            "stderr": completed.stderr,
            "duration_ms": int((time.perf_counter() - started) * 1000),
            "timed_out": False,
            "launch_error": None,
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "exit_code": None,
            "stdout": exc.stdout if isinstance(exc.stdout, str) else "",
            "stderr": exc.stderr if isinstance(exc.stderr, str) else "",
            "duration_ms": int((time.perf_counter() - started) * 1000),
            "timed_out": True,
            "launch_error": None,
        }
    except OSError as exc:
        return {
            "exit_code": None,
            "stdout": "",
            "stderr": "",
            "duration_ms": int((time.perf_counter() - started) * 1000),
            "timed_out": False,
            "launch_error": str(exc),
        }


def _create_worktree() -> tuple[Path, Path, str]:
    """返回 (holder, tree, mode)。holder 需要整体清理。"""
    holder = Path(tempfile.mkdtemp(prefix="netlab-mutation-"))
    tree = holder / "tree"
    result = _run(["git", "worktree", "add", "--detach", "--force", str(tree), "HEAD"], ROOT, timeout=120)
    if result["exit_code"] == 0 and tree.exists():
        return holder, tree, "git-worktree"
    # 退化路径：复制当前目录（不含 .git 与可再生产物），保证仍然不污染源树。
    if tree.exists():
        shutil.rmtree(tree, ignore_errors=True)
    shutil.copytree(
        ROOT,
        tree,
        ignore=shutil.ignore_patterns(
            ".git", "__pycache__", ".pytest_cache", ".ruff_cache", "build", "dist", "node_modules", "NetlabExtras"
        ),
    )
    return holder, tree, "copy"


def _cleanup_worktree(holder: Path, tree: Path, mode: str) -> None:
    if mode == "git-worktree":
        _run(["git", "worktree", "remove", "--force", str(tree)], ROOT, timeout=120)
    shutil.rmtree(holder, ignore_errors=True)


def _select_mutants(only: str | None):
    if not only:
        return list(MUTANTS)
    wanted = {name.strip() for name in only.split(",") if name.strip()}
    selected = [mutant for mutant in MUTANTS if mutant[0] in wanted]
    missing = wanted - {mutant[0] for mutant in selected}
    if missing:
        raise SystemExit(f"unknown mutants: {', '.join(sorted(missing))}")
    return selected


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--threshold", type=float, default=0.6)
    parser.add_argument("--timeout", type=float, default=600.0, help="每个 mutant 的测试超时秒数")
    parser.add_argument("--only", help="逗号分隔的 mutant 名称")
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--keep-worktree", action="store_true")
    parser.add_argument("--artifacts-dir", type=Path, default=ROOT / "reports" / "mutation")
    parser.add_argument("--json", type=Path, help="额外写出汇总 JSON")
    args = parser.parse_args(argv)

    if args.list:
        for name, path, _old, _new, expected, counts in MUTANTS:
            print(f"{name}\t{path}\texpected={expected or '-'}\tscore={counts}")
        return 0

    started_at = evidence.utc_now()
    started = time.perf_counter()
    repository_before = evidence.repository(ROOT)
    run_id = time.strftime("%Y%m%dT%H%M%S", time.localtime()) + f"-{os.getpid()}"
    run_dir = args.artifacts_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    holder, tree, mode = _create_worktree()
    baseline_result = None
    mutant_results = []
    try:
        baseline = _run([sys.executable, *PYTEST_ARGS], tree, timeout=args.timeout)
        (run_dir / "baseline.log").write_text(
            f"COMMAND: {sys.executable} {' '.join(PYTEST_ARGS)}\nEXIT: {baseline['exit_code']}\n\n"
            + baseline["stdout"]
            + "\n--- STDERR ---\n"
            + baseline["stderr"],
            encoding="utf-8",
        )
        baseline_result = {
            "exit_code": baseline["exit_code"],
            "duration_ms": baseline["duration_ms"],
            "timed_out": baseline["timed_out"],
            "launch_error": baseline["launch_error"],
            "log": str((run_dir / "baseline.log").as_posix()),
        }
        if baseline["exit_code"] != 0:
            duration_ms = int((time.perf_counter() - started) * 1000)
            status = "baseline_failed"
            result = evidence.make_result(
                tool="mutation_smoke",
                root=ROOT,
                command=[sys.executable, "tools/mutation_smoke.py", *sys.argv[1:]],
                exit_code=2,
                duration_ms=duration_ms,
                status=status,
                artifacts=[evidence.artifact_record(run_dir / "baseline.log", "baseline-log")],
                details={"baseline": baseline_result, "mode": mode, "run_dir": str(run_dir.as_posix())},
                started_at=started_at,
            )
            evidence.write_result(run_dir / "summary.json", result)
            print("mutation_smoke: baseline=FAILED (BASELINE_FAILED)")
            return 2

        selected = _select_mutants(args.only)
        for name, relative_path, old, new, expected, counts in selected:
            mutant_dir = run_dir / name
            mutant_dir.mkdir(parents=True, exist_ok=True)
            target = tree / relative_path
            original = target.read_text(encoding="utf-8") if target.exists() else ""
            occurrences = original.count(old)
            pattern_found = occurrences == 1
            compile_error = None
            run = {
                "exit_code": None,
                "stdout": "",
                "stderr": "",
                "duration_ms": 0,
                "timed_out": False,
                "launch_error": None,
            }
            mutated = original
            if not pattern_found:
                reason = "pattern-not-found" if occurrences == 0 else f"pattern-ambiguous({occurrences})"
                (mutant_dir / "pytest.log").write_text(f"SKIPPED: {reason}\n", encoding="utf-8")
            else:
                mutated = original.replace(old, new, 1)
                target.write_text(mutated, encoding="utf-8")
                (mutant_dir / "mutant.diff").write_text(build_diff(relative_path, original, mutated), encoding="utf-8")
                try:
                    py_compile.compile(str(target), doraise=True)
                except py_compile.PyCompileError as exc:
                    compile_error = str(exc)
                if compile_error is None:
                    run = _run([sys.executable, *PYTEST_ARGS], tree, timeout=args.timeout)
                (mutant_dir / "pytest.log").write_text(
                    f"COMMAND: {sys.executable} {' '.join(PYTEST_ARGS)}\n"
                    f"EXIT: {run['exit_code']}\nTIMEOUT: {run['timed_out']}\n\n"
                    + run["stdout"]
                    + "\n--- STDERR ---\n"
                    + run["stderr"],
                    encoding="utf-8",
                )
                # 无论结果如何都恢复变异，避免影响下一个 mutant。
                target.write_text(original, encoding="utf-8")
            status = classify_outcome(
                pattern_found=pattern_found,
                compile_error=compile_error,
                exit_code=run["exit_code"],
                timed_out=run["timed_out"],
                launch_error=run["launch_error"],
                output=run["stdout"] + run["stderr"],
            )
            record = {
                "mutant": name,
                "status": status,
                "expected": expected,
                "counts_toward_score": counts,
                "path": relative_path,
                "occurrences": occurrences,
                "compile_error": compile_error,
                "exit_code": run["exit_code"],
                "duration_ms": run["duration_ms"],
                "timed_out": run["timed_out"],
                "launch_error": run["launch_error"],
                "classification_mismatch": bool(expected and status != expected),
                "artifacts": [
                    evidence.artifact_record(item)
                    for item in sorted(mutant_dir.glob("*"))
                    if item.is_file()
                ],
            }
            evidence.write_result(mutant_dir / "result.json", evidence.make_result(
                tool="mutation_mutant",
                root=ROOT,
                command=[sys.executable, *PYTEST_ARGS],
                exit_code=run["exit_code"] if run["exit_code"] is not None else -1,
                duration_ms=run["duration_ms"],
                status="passed" if status == "killed" else ("failed" if status == "survived" else "error"),
                nodeids=(),
                artifacts=record["artifacts"],
                details=record,
                started_at=started_at,
            ))
            record["result_json"] = str((mutant_dir / "result.json").as_posix())
            mutant_results.append(record)
            print(f"{status.upper()} {name}" + (f" (expected {expected})" if expected else ""))

        repository_after = evidence.repository(ROOT)
        source_unchanged = repository_before["status_sha256"] == repository_after["status_sha256"]
        scored = [item for item in mutant_results if item["counts_toward_score"] and item["status"] in {"killed", "survived"}]
        killed = sum(1 for item in scored if item["status"] == "killed")
        survived = sum(1 for item in scored if item["status"] == "survived")
        invalid = sum(1 for item in mutant_results if item["status"] == "invalid")
        infra = sum(1 for item in mutant_results if item["status"] == "infra-error")
        score = killed / len(scored) if scored else 0.0
        controls = [item for item in mutant_results if item["expected"]]
        controls_ok = bool(controls) and all(not item["classification_mismatch"] for item in controls)
        has_killed_control = any(item["status"] == "killed" for item in mutant_results)
        has_survived_control = any(item["status"] == "survived" for item in controls)
        known_controls_verified = controls_ok and has_killed_control and has_survived_control
        status = "passed" if score >= args.threshold and source_unchanged and infra == 0 and controls_ok else "failed"
        if not source_unchanged or infra:
            exit_code = 3
        elif score < args.threshold or not controls_ok:
            exit_code = 1
        else:
            exit_code = 0
        duration_ms = int((time.perf_counter() - started) * 1000)
        summary_details = {
            "mode": mode,
            "run_dir": str(run_dir.as_posix()),
            "baseline": baseline_result,
            "mutants": mutant_results,
            "killed": killed,
            "survived": survived,
            "invalid": invalid,
            "infra_error": infra,
            "score": round(score, 3),
            "threshold": args.threshold,
            "source_unchanged": source_unchanged,
            "repository_after_status_sha256": repository_after["status_sha256"],
            "known_controls_verified": known_controls_verified,
            "ci_exit_code_map": {"0": "pass", "1": "score-or-control-failure", "2": "baseline-failed", "3": "infra-or-source-dirty"},
        }
        artifacts = [evidence.artifact_record(run_dir / "baseline.log", "baseline-log")]
        for item in mutant_results:
            if item.get("result_json"):
                artifacts.append(evidence.artifact_record(item["result_json"], f"mutant:{item['mutant']}"))
        result = evidence.make_result(
            tool="mutation_smoke",
            root=ROOT,
            command=[sys.executable, "tools/mutation_smoke.py", *sys.argv[1:]],
            exit_code=exit_code,
            duration_ms=duration_ms,
            status=status,
            artifacts=artifacts,
            details=summary_details,
            started_at=started_at,
        )
        summary_path = run_dir / "summary.json"
        evidence.write_result(summary_path, result)
        if args.json:
            args.json.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(summary_path, args.json)
        print(json.dumps({
            "killed": killed,
            "survived": survived,
            "invalid": invalid,
            "infra_error": infra,
            "score": round(score, 3),
            "threshold": args.threshold,
            "status": status,
            "source_unchanged": source_unchanged,
            "known_controls_verified": known_controls_verified,
            "summary": str(summary_path.as_posix()),
        }, ensure_ascii=False))
        return exit_code
    finally:
        if not args.keep_worktree:
            _cleanup_worktree(holder, tree, mode)
        # 安全兜底：即使工具异常退出，源工作树也不得被改写。
        repository_final = evidence.repository(ROOT)
        if repository_final["status_sha256"] != repository_before["status_sha256"]:
            print("mutation_smoke: source tree changed during run", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
