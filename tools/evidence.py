# -*- coding: utf-8 -*-
"""统一证据结果契约（本地与 CI 共用）。

所有验收脚本（benchmark、mutation、e2e、数值实验）都通过本模块生成同一种 JSON：
environment / repository / command / exit_code / duration_ms / nodeids / artifacts / status。
序列化使用稳定键序与稳定分隔符，因此同一输入重跑得到逐字节相同的 JSON。

CI 绑定：存在 GITHUB_RUN_ID 时为 CI_VERIFIED；本地运行或缺 run id 时为
CI_NOT_VERIFIED——调用方不得把本地结果当成 CI 证据。

CLI:
    python tools/evidence.py --self-test
    python tools/evidence.py --check reports/some-result.json
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import platform
import re
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

SCHEMA = "netlab-evidence/1"
SCHEMA_VERSION = SCHEMA
REQUIRED_FIELDS = (
    "schema",
    "tool",
    "environment",
    "repository",
    "command",
    "exit_code",
    "duration_ms",
    "nodeids",
    "artifacts",
    "status",
    "ci",
)
VALID_STATUSES = {
    "passed",
    "failed",
    "error",
    "skipped",
    "inconclusive",
    "baseline_failed",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def canonical_json(value: Any) -> str:
    """稳定、可复现的 JSON 序列化（键排序、无多余空白、保留中文）。"""
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _package_version(name: str) -> str | None:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def environment() -> dict[str, Any]:
    """本机/CI 运行环境指纹；字段稳定，新增字段只增不删。"""
    return {
        "os": platform.system(),
        "os_release": platform.release(),
        "platform": platform.platform(),
        "machine": platform.machine(),
        "processor": platform.processor(),
        "cpu_count": os.cpu_count(),
        "python": platform.python_version(),
        "python_implementation": platform.python_implementation(),
        "python_executable": sys.executable,
        "packages": {
            name: _package_version(name)
            for name in ("numpy", "scipy", "matplotlib", "pytest", "plotkit", "netlab")
        },
        "threads": {
            key: os.environ.get(key)
            for key in (
                "OMP_NUM_THREADS",
                "MKL_NUM_THREADS",
                "OPENBLAS_NUM_THREADS",
                "NUMEXPR_NUM_THREADS",
            )
        },
    }


def _git(root: Path, *args: str) -> str:
    try:
        completed = subprocess.run(
            ["git", *args],
            cwd=root,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
    except OSError:
        return ""
    return completed.stdout.strip() if completed.returncode == 0 else ""


def repository(root: str | Path) -> dict[str, Any]:
    """仓库身份与工作树状态快照；dirty 为 True 时结果必须标注。"""
    root_path = Path(root).resolve()
    sha = _git(root_path, "rev-parse", "HEAD")
    branch = _git(root_path, "rev-parse", "--abbrev-ref", "HEAD")
    status_text = _git(root_path, "status", "--porcelain")
    return {
        "root": str(root_path),
        "sha": sha,
        "short_sha": sha[:12],
        "branch": branch,
        "dirty": bool(status_text.strip()),
        "status_porcelain": status_text.splitlines(),
        "status_sha256": sha256_bytes(status_text.encode("utf-8")),
    }


def ci_context() -> dict[str, Any]:
    """GitHub Actions 绑定信息；缺 run id 明确为 CI_NOT_VERIFIED。"""
    run_id = os.environ.get("GITHUB_RUN_ID")
    return {
        "provider": "github-actions" if run_id else None,
        "status": "CI_VERIFIED" if run_id else "CI_NOT_VERIFIED",
        "run_id": run_id,
        "run_attempt": os.environ.get("GITHUB_RUN_ATTEMPT"),
        "workflow": os.environ.get("GITHUB_WORKFLOW"),
        "job": os.environ.get("GITHUB_JOB"),
        "sha": os.environ.get("GITHUB_SHA"),
        "repository": os.environ.get("GITHUB_REPOSITORY"),
        "server_url": os.environ.get("GITHUB_SERVER_URL"),
    }


def ci_binding_status(result: dict[str, Any]) -> str:
    ci = result.get("ci") or {}
    return "CI_VERIFIED" if ci.get("status") == "CI_VERIFIED" and ci.get("run_id") else "CI_NOT_VERIFIED"


def artifact_record(path: str | Path, role: str | None = None) -> dict[str, Any]:
    file_path = Path(path)
    record: dict[str, Any] = {
        "path": str(file_path.as_posix()),
        "bytes": file_path.stat().st_size,
        "sha256": sha256_file(file_path),
    }
    if role:
        record["role"] = role
    return record


def make_result(
    tool: str,
    root: str | Path,
    command: Sequence[str] | str,
    exit_code: int,
    duration_ms: int,
    status: str,
    *,
    nodeids: Iterable[str] | None = None,
    artifacts: Iterable[dict[str, Any]] | None = None,
    details: dict[str, Any] | None = None,
    started_at: str | None = None,
) -> dict[str, Any]:
    if status not in VALID_STATUSES:
        raise ValueError(f"unknown evidence status: {status}")
    command_list = [command] if isinstance(command, str) else [str(part) for part in command]
    return {
        "schema": SCHEMA,
        "tool": tool,
        "environment": environment(),
        "repository": repository(root),
        "command": command_list,
        "exit_code": int(exit_code),
        "duration_ms": int(duration_ms),
        "nodeids": sorted({str(nodeid) for nodeid in (nodeids or [])}),
        "artifacts": list(artifacts or []),
        "status": status,
        "ci": ci_context(),
        "started_at": started_at or utc_now(),
        "finished_at": utc_now(),
        "details": details or {},
    }


def validate_result(result: dict[str, Any]) -> list[str]:
    """返回契约缺口列表；空列表表示通过。"""
    problems: list[str] = []
    if not isinstance(result, dict):
        return ["result must be a JSON object"]
    for field in REQUIRED_FIELDS:
        if field not in result:
            problems.append(f"missing field: {field}")
    if result.get("schema") != SCHEMA:
        problems.append(f"schema mismatch: {result.get('schema')!r} != {SCHEMA!r}")
    if result.get("status") not in VALID_STATUSES:
        problems.append(f"invalid status: {result.get('status')!r}")
    if not isinstance(result.get("command"), list) or not result.get("command"):
        problems.append("command must be a non-empty list")
    if not isinstance(result.get("artifacts"), list):
        problems.append("artifacts must be a list")
    if not isinstance(result.get("nodeids"), list):
        problems.append("nodeids must be a list")
    if not isinstance(result.get("exit_code"), int):
        problems.append("exit_code must be an int")
    if not isinstance(result.get("duration_ms"), int):
        problems.append("duration_ms must be an int")
    environment_value = result.get("environment")
    if not isinstance(environment_value, dict) or "python" not in environment_value:
        problems.append("environment must include python")
    repository_value = result.get("repository")
    if not isinstance(repository_value, dict) or "sha" not in repository_value:
        problems.append("repository must include sha")
    return problems


def write_result(path: str | Path, result: dict[str, Any]) -> str:
    problems = validate_result(result)
    if problems:
        raise ValueError("invalid evidence result: " + "; ".join(problems))
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = canonical_json(result) + "\n"
    target.write_text(payload, encoding="utf-8")
    return sha256_bytes(payload.encode("utf-8"))


def run_command(
    command: Sequence[str],
    cwd: str | Path,
    *,
    timeout: float | None = None,
    env: dict[str, str] | None = None,
) -> dict[str, Any]:
    """执行命令并捕获结果；超时/启动失败作为结构化结果返回，不抛出。"""
    started = time.perf_counter()
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    try:
        completed = subprocess.run(
            [str(part) for part in command],
            cwd=str(cwd),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            env=merged_env,
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
            "stdout": (exc.stdout or "") if isinstance(exc.stdout, str) else "",
            "stderr": (exc.stderr or "") if isinstance(exc.stderr, str) else "",
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


_NODEID_RE = re.compile(r"([A-Za-z0-9_./\\-]+\.py)::([A-Za-z0-9_:.\\/\\[\\]\\-]+)")


def nodeids_from_text(text: str) -> list[str]:
    return sorted({f"{match.group(1)}::{match.group(2)}" for match in _NODEID_RE.finditer(text)})


def nodeids_from_junit(path: str | Path) -> list[str]:
    """从 pytest --junitxml 结果提取 nodeid（file::name 或 classname::name）。"""
    import xml.etree.ElementTree as ET

    try:
        root = ET.parse(path).getroot()
    except (OSError, ET.ParseError):
        return []
    nodeids: list[str] = []
    for case in root.iter("testcase"):
        file_name = case.get("file")
        name = case.get("name") or ""
        classname = case.get("classname") or ""
        if file_name:
            nodeids.append(f"{file_name}::{name}")
        elif classname:
            nodeids.append(f"{classname}::{name}")
    return sorted(set(nodeids))


def _self_test() -> int:
    with tempfile.TemporaryDirectory(prefix="evidence-selftest-") as tmp:
        sample = Path(tmp) / "artifact.txt"
        sample.write_text("evidence\n", encoding="utf-8")
        result = make_result(
            tool="evidence-selftest",
            root=Path(__file__).resolve().parents[1],
            command=[sys.executable, "-c", "print('ok')"],
            exit_code=0,
            duration_ms=1,
            status="passed",
            artifacts=[artifact_record(sample, "sample")],
            details={"self_test": True},
        )
        problems = validate_result(result)
        if problems:
            print("evidence: self-test=FAILED " + "; ".join(problems))
            return 1
        first = canonical_json(result)
        second = canonical_json(json.loads(first))
        if first != second:
            print("evidence: self-test=FAILED canonical serialization not stable")
            return 1
        if ci_binding_status(result) not in {"CI_VERIFIED", "CI_NOT_VERIFIED"}:
            print("evidence: self-test=FAILED invalid ci binding")
            return 1
    print(f"evidence: self-test=ok schema={SCHEMA}")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="统一证据结果契约")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--check", type=Path)
    args = parser.parse_args(argv)
    if args.check:
        try:
            result = json.loads(args.check.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"evidence: check=error {exc}")
            return 1
        problems = validate_result(result)
        if problems:
            print("evidence: check=failed " + "; ".join(problems))
            return 1
        print(f"evidence: check=ok sha256={sha256_file(args.check)}")
        return 0
    if args.self_test:
        return _self_test()
    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
