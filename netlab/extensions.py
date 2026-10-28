"""应用内 Python 扩展：节点、连接函数与参数声明。

安全边界（必须明确）
--------------------
这不是沙箱。扩展代码在**本进程**内执行，拥有 Python 进程的权限；AST 检查、
受限 builtins、禁止 import 与 dunder 属性只能降低误用风险，不能防御恶意代码。
因此：

* 扩展只在用户明确点击“启用”或打开工程时勾选“信任扩展”后执行；
* 项目文件中的代码默认不执行；
* 不加载远程代码，不自动下载；
* 代码大小、AST 节点数、参数数量都有上限；
* 没有硬超时（Python 线程无法安全强杀）；死循环仍可能卡住进程。

可访问对象
----------
扩展代码预置 ``math``、``np``/``numpy``、``Param``、``node``、``method``。
**不允许 import**。节点函数签名为 ``compute(ctx) -> dict``；连接函数签名为
``transfer(source, target, params, state, dt) -> dict``。返回值必须是 JSON
原生标量/数组/字典，数值必须是有限数。

示例::

    @node(kind="user.my_gain", label="自定义增益", params=[
        Param("gain", "增益", "float", 1.0, help="y = gain · Σu"),
    ], outputs=("voltage",))
    def compute(ctx):
        total = 0.0
        for payload in ctx.inputs.values():
            total += float(payload.get("voltage", 0.0))
        return {"voltage": float(ctx.params["gain"] * total)}
"""

from __future__ import annotations

import ast
import hashlib
import json
import math
import re
import threading
from dataclasses import replace
from pathlib import Path
from typing import Any, Callable

import numpy as np

from .computes import COMPUTE_SPECS, ComputeSpec
from .limits import (
    ComputeError,
    LimitError,
    ValidationError,
    json_safe,
)
from .methods import METHOD_SPECS, MethodSpec
from .params import ParamSpec

MAX_CODE_BYTES = 200_000
MAX_AST_NODES = 20_000
MAX_PARAMS = 48
EXTENSION_ROOT = Path(__file__).resolve().parent.parent / "extensions"
NODE_DIR = EXTENSION_ROOT / "nodes"
METHOD_DIR = EXTENSION_ROOT / "methods"
USER_PREFIX = "user."
_LOCK = threading.RLock()
_REGISTRY: dict[str, dict[str, Any]] = {}

_FORBIDDEN_NAMES = {
    "eval",
    "exec",
    "compile",
    "open",
    "__import__",
    "input",
    "breakpoint",
    "globals",
    "locals",
    "vars",
    "getattr",
    "setattr",
    "delattr",
    "__build_class__",
    "help",
    "exit",
    "quit",
    "memoryview",
}
_FORBIDDEN_NODES = (
    ast.Import,
    ast.ImportFrom,
    ast.ClassDef,
    ast.AsyncFunctionDef,
    ast.AsyncFor,
    ast.AsyncWith,
    ast.Await,
    ast.Yield,
    ast.YieldFrom,
    ast.While,
    ast.With,
    ast.Global,
    ast.Nonlocal,
    ast.Delete,
)
_SAFE_BUILTINS: dict[str, Any] = {
    "abs": abs,
    "bool": bool,
    "dict": dict,
    "enumerate": enumerate,
    "float": float,
    "int": int,
    "isinstance": isinstance,
    "len": len,
    "list": list,
    "max": max,
    "min": min,
    "print": print,
    "range": range,
    "round": round,
    "str": str,
    "sum": sum,
    "tuple": tuple,
    "zip": zip,
    "Exception": Exception,
    "RuntimeError": RuntimeError,
    "ValueError": ValueError,
    "ZeroDivisionError": ZeroDivisionError,
    "True": True,
    "False": False,
    "None": None,
}


class Param:
    """扩展作者使用的参数声明；最终转成与内置类型相同的 ``ParamSpec``。"""

    def __init__(
        self,
        key: str,
        label: str,
        type: str = "float",
        default: Any = 0.0,
        *,
        unit: str = "",
        min: float | None = None,
        max: float | None = None,
        step: float | None = None,
        positive: bool = False,
        choices: tuple[tuple[str, str], ...] = (),
        help: str = "",
        group: str = "",
        example: str = "",
        required: bool = False,
        placeholder: str = "",
    ) -> None:
        self.spec = ParamSpec(
            key=str(key),
            label=str(label),
            type=str(type),
            default=default,
            unit=str(unit),
            minimum=min,
            maximum=max,
            step=step,
            positive=bool(positive),
            choices=tuple(tuple(item) for item in choices),
            help=str(help),
            group=str(group),
            example=str(example),
            required=bool(required),
            placeholder=str(placeholder),
        )


def _coerce_param(item: Any) -> ParamSpec:
    if isinstance(item, Param):
        return item.spec
    if isinstance(item, ParamSpec):
        return item
    raise ValidationError("params 中的每一项必须是 Param(...) 或 ParamSpec(...)")


def _normalize_params(items: Any) -> tuple[ParamSpec, ...]:
    if items is None:
        return ()
    if not isinstance(items, (list, tuple)):
        raise ValidationError("params 必须是 Param 列表")
    if len(items) > MAX_PARAMS:
        raise LimitError(f"扩展最多声明 {MAX_PARAMS} 个参数")
    specs = tuple(_coerce_param(item) for item in items)
    keys = [spec.key for spec in specs]
    if len(set(keys)) != len(keys):
        raise ValidationError("扩展参数 key 不能重复")
    return specs


def _check_kind(kind: str) -> str:
    text = str(kind).strip()
    if not text.startswith(USER_PREFIX):
        raise ValidationError(f"自定义扩展的 kind 必须以 {USER_PREFIX!r} 开头")
    if not re.fullmatch(r"user\.[A-Za-z0-9_.-]{1,80}", text):
        raise ValidationError("扩展 kind 只能包含字母、数字、下划线、点和连字符")
    return text


def _activate_compute_spec(spec: ComputeSpec) -> None:
    existing = COMPUTE_SPECS.get(spec.kind)
    if existing is not None and existing.builtin:
        raise ValidationError(f"{spec.kind!r} 与内置节点冲突")
    COMPUTE_SPECS[spec.kind] = replace(
        spec, editable=True, builtin=False, source=spec.source
    )


def _activate_method_spec(spec: MethodSpec) -> None:
    existing = METHOD_SPECS.get(spec.kind)
    if existing is not None and existing.builtin:
        raise ValidationError(f"{spec.kind!r} 与内置连接函数冲突")
    METHOD_SPECS[spec.kind] = replace(
        spec, editable=True, builtin=False, source=spec.source
    )


def node(
    *,
    kind: str,
    label: str,
    params: Any = (),
    group: str = "自定义",
    description: str = "",
    outputs: tuple[str, ...] = (),
    notes: str = "",
    formula: str = "",
    validate: Callable[[dict[str, Any]], None] | None = None,
) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """注册一个自定义节点计算函数。"""

    def decorator(function: Callable[..., Any]) -> Callable[..., Any]:
        clean_kind = _check_kind(kind)
        param_specs = _normalize_params(params)

        def factory(values: dict[str, Any], _fn=function, _validate=validate):
            if _validate is not None:
                _validate(values)
            return _fn

        spec = ComputeSpec(
            kind=clean_kind,
            label=str(label),
            group=str(group) or "自定义",
            description=str(description),
            params=param_specs,
            factory=factory,
            outputs=tuple(str(item) for item in outputs),
            notes=str(notes),
            formula=str(formula),
            editable=True,
            builtin=False,
        )
        _activate_compute_spec(spec)
        _REGISTRY[clean_kind] = {"type": "node", "spec": spec}
        return function

    return decorator


def method(
    *,
    kind: str,
    label: str,
    params: Any = (),
    group: str = "自定义",
    description: str = "",
    outputs: tuple[str, ...] = (),
    notes: str = "",
    formula: str = "",
) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """注册一个自定义连接函数。"""

    def decorator(function: Callable[..., Any]) -> Callable[..., Any]:
        clean_kind = _check_kind(kind)
        param_specs = _normalize_params(params)

        def factory(values: dict[str, Any], _fn=function):
            del values
            return _fn

        spec = MethodSpec(
            kind=clean_kind,
            label=str(label),
            group=str(group) or "自定义",
            description=str(description),
            params=param_specs,
            factory=factory,
            outputs=tuple(str(item) for item in outputs),
            notes=str(notes),
            formula=str(formula),
            editable=True,
            builtin=False,
        )
        _activate_method_spec(spec)
        _REGISTRY[clean_kind] = {"type": "method", "spec": spec}
        return function

    return decorator


def validate_code(code: str) -> dict[str, Any]:
    """只做语法与 AST 检查，不执行代码；返回发现的声明摘要。"""
    if not isinstance(code, str) or not code.strip():
        raise ValidationError("扩展代码不能为空")
    data = code.encode("utf-8")
    if len(data) > MAX_CODE_BYTES:
        raise LimitError(f"扩展代码不能超过 {MAX_CODE_BYTES // 1000} KB")
    try:
        tree = ast.parse(code, filename="<netlab-extension>", mode="exec")
    except SyntaxError as exc:
        line = exc.lineno or 0
        raise ValidationError(f"语法错误（第 {line} 行）：{exc.msg}") from exc
    nodes = list(ast.walk(tree))
    if len(nodes) > MAX_AST_NODES:
        raise LimitError("扩展代码 AST 节点过多")
    for item in nodes:
        if isinstance(item, _FORBIDDEN_NODES):
            raise ValidationError(f"扩展不允许使用 {type(item).__name__}")
        if isinstance(item, ast.Name) and item.id in _FORBIDDEN_NAMES:
            raise ValidationError(f"扩展不允许访问 {item.id!r}")
        if isinstance(item, ast.Attribute) and item.attr.startswith("__"):
            raise ValidationError("扩展不允许访问双下划线属性")
        if isinstance(item, ast.Constant) and isinstance(item.value, str) and "__" in item.value:
            # 字符串本身不危险，但可以用来拼 dunder 名称；我们只做提示性拒绝。
            if item.value.startswith("__") and item.value.endswith("__"):
                raise ValidationError("扩展不允许使用双下划线字符串")
    declared: list[dict[str, Any]] = []
    for item in tree.body:
        if not isinstance(item, ast.FunctionDef):
            continue
        for decorator in item.decorator_list:
            if not isinstance(decorator, ast.Call):
                continue
            name = decorator.func.id if isinstance(decorator.func, ast.Name) else ""
            if name not in ("node", "method"):
                continue
            meta: dict[str, Any] = {"function": item.name, "type": "node" if name == "node" else "method"}
            for keyword in decorator.keywords:
                if keyword.arg in ("kind", "label", "group", "outputs") and isinstance(
                    keyword.value, ast.Constant
                ):
                    meta[keyword.arg] = keyword.value.value
            declared.append(meta)
    if not declared:
        raise ValidationError("扩展代码没有用 @node(...) 或 @method(...) 声明任何扩展")
    return {"ok": True, "declared": declared, "nodes": len(nodes), "bytes": len(data)}


def _safe_filename(kind: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", kind) + ".py"


def _snapshot_registry() -> tuple[dict[str, ComputeSpec], dict[str, MethodSpec], dict[str, Any]]:
    return dict(COMPUTE_SPECS), dict(METHOD_SPECS), dict(_REGISTRY)


def _restore_registry(snapshot: tuple[dict[str, ComputeSpec], dict[str, MethodSpec], dict[str, Any]]) -> None:
    computes, methods, registry = snapshot
    COMPUTE_SPECS.clear()
    COMPUTE_SPECS.update(computes)
    METHOD_SPECS.clear()
    METHOD_SPECS.update(methods)
    _REGISTRY.clear()
    _REGISTRY.update(registry)


def execute_code(
    code: str,
    *,
    filename: str = "<netlab-extension>",
    replace_all_of_code: bool = True,
) -> dict[str, Any]:
    """校验并执行扩展代码；失败时回滚注册表。"""
    info = validate_code(code)
    with _LOCK:
        before = _snapshot_registry()
        try:
            namespace: dict[str, Any] = {
                "__builtins__": dict(_SAFE_BUILTINS),
                "__name__": "netlab_user_extension",
                "math": math,
                "np": np,
                "numpy": np,
                "Param": Param,
                "node": node,
                "method": method,
            }
            compiled = compile(code, filename, "exec")
            exec(compiled, namespace, namespace)  # noqa: S102 - 本地可信扩展，非沙箱
            before_items = before[2]
            changed = [
                kind
                for kind, item in _REGISTRY.items()
                if before_items.get(kind) is not item
            ]
            # 只把源码挂到本次执行新注册/替换的 spec 上，避免覆盖其他扩展。
            for kind in changed:
                item = _REGISTRY[kind]
                spec = item.get("spec")
                if spec is not None:
                    updated = replace(spec, source=code)
                    item["spec"] = updated
                    item["source_hash"] = _hash(code)
                    item["code"] = code
                    item["filename"] = filename
                    if item["type"] == "node":
                        COMPUTE_SPECS[kind] = updated
                    else:
                        METHOD_SPECS[kind] = updated
            return {
                "ok": True,
                "kinds": changed,
                "declared": info["declared"],
            }
        except Exception:
            _restore_registry(before)
            raise


def _hash(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def _activate_code_locked(code: str, *, filename: str = "<netlab-extension>") -> dict[str, Any]:
    """在锁内执行；调用方负责重建引擎。"""
    return execute_code(code, filename=filename)


def activate_code(
    code: str,
    *,
    filename: str = "<netlab-extension>",
    persist: bool = False,
    kind_type: str = "node",
) -> dict[str, Any]:
    with _LOCK:
        result = _activate_code_locked(code, filename=filename)
        if persist:
            target_dir = NODE_DIR if kind_type == "node" else METHOD_DIR
            target_dir.mkdir(parents=True, exist_ok=True)
            declared = result.get("declared") or []
            kind = str(declared[0].get("kind") or "user.extension")
            path = target_dir / _safe_filename(kind)
            path.write_text(code, encoding="utf-8")
            result["path"] = str(path)
        return result


def deactivate(kind: str, *, remove_file: bool = False) -> dict[str, Any]:
    clean = _check_kind(kind)
    with _LOCK:
        item = _REGISTRY.pop(clean, None)
        COMPUTE_SPECS.pop(clean, None)
        METHOD_SPECS.pop(clean, None)
        if item is not None and remove_file:
            path = Path(str(item.get("filename") or ""))
            if path.is_file() and EXTENSION_ROOT in path.parents:
                path.unlink(missing_ok=True)
        return {"ok": True, "kind": clean, "removed": item is not None}


def list_extensions() -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for kind, item in sorted(_REGISTRY.items()):
        spec = item.get("spec")
        entries.append(
            {
                "kind": kind,
                "type": item.get("type"),
                "label": getattr(spec, "label", kind),
                "description": getattr(spec, "description", ""),
                "source": item.get("code", getattr(spec, "source", "")),
                "sha256": item.get("source_hash", ""),
                "filename": item.get("filename", ""),
                "params": [param.to_dict() for param in getattr(spec, "params", ())],
                "outputs": list(getattr(spec, "outputs", ())),
            }
        )
    return entries


def get_extension(kind: str) -> dict[str, Any] | None:
    item = _REGISTRY.get(kind)
    if item is None:
        return None
    spec = item.get("spec")
    return {
        "kind": kind,
        "type": item.get("type"),
        "label": getattr(spec, "label", kind),
        "source": item.get("code", ""),
        "sha256": item.get("source_hash", ""),
        "params": [param.to_dict() for param in getattr(spec, "params", ())],
    }


def scan_directory() -> dict[str, Any]:
    """只读取文件与元数据，不执行；返回可用于界面列表的条目。"""
    result: dict[str, Any] = {"directory": str(EXTENSION_ROOT), "files": []}
    for folder, kind_type in ((NODE_DIR, "node"), (METHOD_DIR, "method")):
        if not folder.is_dir():
            continue
        for path in sorted(folder.glob("*.py")):
            try:
                code = path.read_text(encoding="utf-8")
                info = validate_code(code)
                declared = info.get("declared") or []
                result["files"].append(
                    {
                        "path": str(path),
                        "filename": path.name,
                        "type": kind_type,
                        "sha256": _hash(code),
                        "kinds": [item.get("kind") for item in declared],
                        "labels": [item.get("label") for item in declared],
                        "code": code,
                    }
                )
            except Exception as exc:
                result["files"].append(
                    {
                        "path": str(path),
                        "filename": path.name,
                        "type": kind_type,
                        "error": str(exc),
                    }
                )
    return result


def activate_project_extensions(
    items: list[dict[str, Any]], *, persist: bool = False
) -> dict[str, Any]:
    """原子加载工程内嵌扩展：全部先校验，再逐个执行；失败全部回滚。"""
    if not isinstance(items, list):
        raise ValidationError("extensions 必须是数组")
    if len(items) > 64:
        raise LimitError("单个工程最多加载 64 个扩展")
    validates = []
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            raise ValidationError(f"第 {index + 1} 个扩展必须是对象")
        code = item.get("code")
        if not isinstance(code, str):
            raise ValidationError(f"第 {index + 1} 个扩展缺少 code")
        info = validate_code(code)
        expected = item.get("sha256")
        if expected and expected != _hash(code):
            raise ValidationError(f"第 {index + 1} 个扩展的代码哈希不匹配")
        validates.append((code, str(item.get("filename") or f"<project-{index + 1}>"), info))
    with _LOCK:
        snapshot = _snapshot_registry()
        loaded: list[str] = []
        try:
            for code, filename, _info in validates:
                result = _activate_code_locked(code, filename=filename)
                loaded.extend(result.get("kinds") or [])
                if persist:
                    target = NODE_DIR
                    target.mkdir(parents=True, exist_ok=True)
                    target.joinpath(_safe_filename(loaded[-1] if loaded else "user.extension")).write_text(
                        code, encoding="utf-8"
                    )
        except Exception:
            _restore_registry(snapshot)
            raise
        return {"ok": True, "kinds": loaded}


def reset() -> None:
    with _LOCK:
        for kind in list(_REGISTRY):
            COMPUTE_SPECS.pop(kind, None)
            METHOD_SPECS.pop(kind, None)
        _REGISTRY.clear()


def used_kinds() -> set[str]:
    return set(_REGISTRY)


__all__ = [
    "Param",
    "node",
    "method",
    "validate_code",
    "execute_code",
    "activate_code",
    "deactivate",
    "list_extensions",
    "get_extension",
    "scan_directory",
    "activate_project_extensions",
    "reset",
    "EXTENSION_ROOT",
]
