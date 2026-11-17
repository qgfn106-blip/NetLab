# -*- coding: utf-8 -*-
"""运行命令并按 netlab-evidence/1 契约保存结果。

CI 与本地共用：命令的真实退出码/耗时/环境/仓库 SHA/artifact hash 都由本工具记录，
避免在 YAML 或文档里手写“测试通过”。
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Sequence

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools import evidence


def _collect_artifacts(paths: Sequence[str]) -> list[dict]:
    records: list[dict] = []
    for raw in paths:
        path = Path(raw)
        if path.is_file():
            records.append(evidence.artifact_record(path, "artifact"))
        elif path.is_dir():
            for child in sorted(item for item in path.rglob("*") if item.is_file()):
                records.append(evidence.artifact_record(child, "artifact"))
    return records


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="运行命令并生成 netlab-evidence/1 JSON")
    parser.add_argument("--tool", required=True, help="证据工具名，例如 python-tests")
    parser.add_argument("--out", required=True, type=Path, help="输出的 evidence JSON 路径")
    parser.add_argument("--root", type=Path, default=Path.cwd(), help="仓库根（默认当前目录）")
    parser.add_argument("--junit", type=Path, help="pytest --junitxml 输出，用于提取 nodeids")
    parser.add_argument("--artifact", action="append", default=[], help="命令结束后登记的文件或目录，可重复")
    parser.add_argument("--timeout", type=float, default=None, help="命令超时秒数")
    parser.add_argument(
        "--status-on-failure",
        choices=("failed", "error", "inconclusive", "baseline_failed"),
        default="failed",
        help="命令非零退出时的状态（超时/启动失败始终为 error）",
    )
    parser.add_argument("command", nargs=argparse.REMAINDER, help="-- 之后的真实命令")
    args = parser.parse_args(argv)

    command = list(args.command)
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        parser.error("missing command after --")

    run = evidence.run_command(command, args.root, timeout=args.timeout)
    if run["timed_out"] or run["launch_error"]:
        status = "error"
    elif run["exit_code"] == 0:
        status = "passed"
    else:
        status = args.status_on_failure

    nodeids = evidence.nodeids_from_junit(args.junit) if args.junit else evidence.nodeids_from_text(
        (run.get("stdout") or "") + "\n" + (run.get("stderr") or "")
    )
    artifacts = _collect_artifacts(args.artifact)
    result = evidence.make_result(
        tool=args.tool,
        root=args.root,
        command=command,
        exit_code=run["exit_code"] if run["exit_code"] is not None else (124 if run["timed_out"] else 127),
        duration_ms=run["duration_ms"],
        status=status,
        nodeids=nodeids,
        artifacts=artifacts,
        details={
            "timed_out": run["timed_out"],
            "launch_error": run["launch_error"],
            "stdout_bytes": len((run.get("stdout") or "").encode("utf-8")),
            "stderr_bytes": len((run.get("stderr") or "").encode("utf-8")),
            "stderr_tail": (run.get("stderr") or "")[-2000:],
        },
    )
    evidence.write_result(args.out, result)

    if run.get("stdout"):
        sys.stdout.write(run["stdout"])
        if not run["stdout"].endswith("\n"):
            sys.stdout.write("\n")
    if run.get("stderr"):
        sys.stderr.write(run["stderr"])
        if not run["stderr"].endswith("\n"):
            sys.stderr.write("\n")
    print(
        "evidence: "
        f"out={args.out} status={status} exit_code={result['exit_code']} "
        f"duration_ms={result['duration_ms']} artifacts={len(artifacts)} nodeids={len(nodeids)}"
    )
    return 0 if status == "passed" else (result["exit_code"] or 1)


if __name__ == "__main__":
    raise SystemExit(main())
