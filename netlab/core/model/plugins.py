"""R40 插件包加载器（plugin_api v1）。

边界：插件是受信任的进程内 Python 代码，不是沙箱。这里负责 manifest 校验、
依赖拓扑、入口执行、能力校验、注册表安装/卸载与状态展示；不自动下载插件，
也不替换内置 signal/circuit/vector 引擎。
"""

from __future__ import annotations

import importlib.util
import json
import logging
import os
import re
import sys
import threading
from dataclasses import dataclass, field
from pathlib import Path
from types import ModuleType
from typing import Any

from ... import __version__ as HOST_VERSION
from ...plugin_api.v1 import (
    AnalysisSpec,
    ComputeSpec as V1ComputeSpec,
    DataFormatSpec,
    ElementSpec as V1ElementSpec,
    EngineSpec,
    MethodSpec as V1MethodSpec,
    PanelSpec,
    PluginContext,
    TemplateSpec,
    VisualSpec,
)
from ..compute.computes import COMPUTE_SPECS, ComputeSpec
from ..compute.methods import METHOD_SPECS, MethodSpec
from ..compute.nodal import ELEMENT_SPECS, ElementSpec
from ..compute.analysis_plugins import (
    register_analysis,
    unregister_analysis,
)
from .engine_registry import (
    register_engine,
    unregister_engine,
)
from ..common.limits import ValidationError

logger = logging.getLogger("netlab.plugins")
PLUGIN_ROOT = Path(__file__).resolve().parents[2] / "extensions" / "plugins"
PLUGIN_DATA_ROOT = Path(__file__).resolve().parents[2] / "extensions" / "plugin_data"
LOCKFILE_NAME = "plugins_state.json"
MAX_MANIFEST_BYTES = 200_000
ID_RE = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$")
SEMVER_RE = re.compile(r"^(\d+)\.(\d+)(?:\.(\d+))?(?:[-+][0-9A-Za-z.-]+)?$")
CAPABILITIES = {
    "compute",
    "method",
    "element",
    "analysis",
    "data_io",
    "panel",
    "template",
    "engine",
    "visual",
}
_PLUGIN_LOCK = threading.RLock()


def _parse_semver(value: str) -> tuple[int, int, int]:
    match = SEMVER_RE.match(str(value or ""))
    if not match:
        raise ValueError(f"非法语义化版本：{value!r}")
    major, minor, patch = match.groups()
    return int(major), int(minor), int(patch or 0)


def _compare(left: tuple[int, int, int], right: tuple[int, int, int]) -> int:
    return (left > right) - (left < right)


def version_satisfies(version: str, expression: str) -> bool:
    """支持 >= > <= < = 与逗号组合；足够覆盖 manifest 的 netlab 范围。"""
    current = _parse_semver(version)
    expression = str(expression or "").strip()
    if not expression:
        return True
    clauses = re.findall(r"(>=|<=|>|<|=)?\s*v?(\d+\.\d+(?:\.\d+)?)", expression)
    if not clauses:
        raise ValueError(f"非法版本范围：{expression!r}")
    for raw_op, raw_version in clauses:
        op = raw_op or "="
        target = _parse_semver(raw_version)
        relation = _compare(current, target)
        if op == ">=" and relation < 0:
            return False
        if op == ">" and relation <= 0:
            return False
        if op == "<=" and relation > 0:
            return False
        if op == "<" and relation >= 0:
            return False
        if op == "=" and relation != 0:
            return False
    return True


@dataclass
class PluginManifest:
    schema: str
    id: str
    name: str
    version: str
    plugin_api: str
    netlab: str
    entry: str
    author: str = ""
    description: str = ""
    capabilities: tuple[str, ...] = ()
    permissions: tuple[str, ...] = ()
    dependencies: dict[str, str] = field(default_factory=dict)

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "PluginManifest":
        if not isinstance(payload, dict):
            raise ValidationError("plugin.json 必须是对象")
        if payload.get("schema") != "netlab-plugin/1":
            raise ValidationError("plugin.json schema 必须是 netlab-plugin/1")
        plugin_id = str(payload.get("id") or "").strip()
        if not ID_RE.match(plugin_id):
            raise ValidationError("插件 id 必须是反向域名风格，例如 com.example.power")
        version = str(payload.get("version") or "").strip()
        _parse_semver(version)
        api = str(payload.get("plugin_api") or "").strip()
        if not api.startswith("1."):
            raise ValidationError("plugin_api 主版本必须为 1")
        capabilities = payload.get("capabilities") or []
        if not isinstance(capabilities, list) or not capabilities:
            raise ValidationError("capabilities 必须是非空数组")
        unknown = set(map(str, capabilities)) - CAPABILITIES
        if unknown:
            raise ValidationError(f"未知插件能力：{', '.join(sorted(unknown))}")
        deps = payload.get("dependencies") or {}
        if not isinstance(deps, dict):
            raise ValidationError("dependencies 必须是对象")
        entry = str(payload.get("entry") or "").strip()
        if ":" not in entry:
            raise ValidationError("entry 必须是 module:function")
        return cls(
            schema="netlab-plugin/1",
            id=plugin_id,
            name=str(payload.get("name") or plugin_id),
            version=version,
            plugin_api=api,
            netlab=str(payload.get("netlab") or ""),
            entry=entry,
            author=str(payload.get("author") or ""),
            description=str(payload.get("description") or ""),
            capabilities=tuple(map(str, capabilities)),
            permissions=tuple(map(str, payload.get("permissions") or [])),
            dependencies={str(key): str(value) for key, value in deps.items()},
        )

    def to_payload(self) -> dict[str, Any]:
        return {
            "schema": self.schema,
            "id": self.id,
            "name": self.name,
            "version": self.version,
            "plugin_api": self.plugin_api,
            "netlab": self.netlab,
            "entry": self.entry,
            "author": self.author,
            "description": self.description,
            "capabilities": list(self.capabilities),
            "permissions": list(self.permissions),
            "dependencies": dict(self.dependencies),
        }


@dataclass
class PluginRecord:
    manifest: PluginManifest
    path: Path
    status: str = "discovered"
    error: str = ""
    registered: dict[str, list[str]] = field(default_factory=dict)
    loaded_at: str = ""

    def summary(self) -> dict[str, Any]:
        return {
            **self.manifest.to_payload(),
            "path": str(self.path),
            "status": self.status,
            "error": self.error,
            "registered": {key: list(value) for key, value in self.registered.items()},
            "loaded_at": self.loaded_at,
        }


def _import_plugin_module(manifest: PluginManifest, plugin_dir: Path) -> ModuleType:
    module_name, _, function_name = manifest.entry.partition(":")
    if not module_name or not function_name:
        raise ValidationError("entry 必须是 module:function")
    relative = module_name.replace(".", "/")
    candidates = [plugin_dir / f"{relative}.py", plugin_dir / relative / "__init__.py"]
    path = next((candidate for candidate in candidates if candidate.is_file()), None)
    if path is None:
        raise ValidationError(f"找不到插件入口模块：{module_name}")
    full_name = f"netlab_plugin_{manifest.id.replace('.', '_')}_{abs(hash(str(path))) & 0xFFFF:x}"
    spec = importlib.util.spec_from_file_location(full_name, path)
    if spec is None or spec.loader is None:
        raise ValidationError(f"无法加载插件模块：{path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[full_name] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(full_name, None)
        raise
    function = getattr(module, function_name, None)
    if not callable(function):
        raise ValidationError(f"插件入口不是函数：{manifest.entry}")
    return module


def _qualify(plugin_id: str, kind: str) -> str:
    kind = str(kind or "").strip()
    if not kind:
        raise ValidationError("插件注册项 kind 不能为空")
    prefix = f"{plugin_id}."
    if kind.startswith(prefix):
        return kind
    if "." in kind and not kind.startswith("plugin."):
        return kind
    return prefix + kind.lstrip(".")


class PluginManager:
    def __init__(
        self,
        root: str | Path | None = None,
        *,
        data_root: str | Path | None = None,
        host_version: str | None = None,
    ):
        self.root = Path(root or os.environ.get("NETLAB_PLUGIN_ROOT") or PLUGIN_ROOT)
        self.data_root = Path(
            data_root or os.environ.get("NETLAB_PLUGIN_DATA_ROOT") or PLUGIN_DATA_ROOT
        )
        self.host_version = host_version or HOST_VERSION
        self._records: dict[str, PluginRecord] = {}
        self._disabled: set[str] = set()
        self._modules: dict[str, ModuleType] = {}
        self.data_formats: dict[str, DataFormatSpec] = {}
        self.panels: dict[str, PanelSpec] = {}
        self.templates: dict[str, TemplateSpec] = {}
        self.visuals: dict[str, VisualSpec] = {}
        self._lock_path = self.root / LOCKFILE_NAME
        self._load_state()

    def capability_catalog(self) -> dict[str, Any]:
        """给前端 catalog 的插件面板/视觉/数据格式摘要。"""
        return {
            "panels": [
                {
                    "id": key,
                    "title": getattr(spec, "title", key),
                    "slot": getattr(spec, "slot", ""),
                }
                for key, spec in self.panels.items()
            ],
            "visuals": [
                {
                    "kind": key,
                    "label": getattr(spec, "label", key),
                    "icon": getattr(spec, "icon", ""),
                }
                for key, spec in self.visuals.items()
            ],
            "data_formats": [
                {"kind": key, "label": getattr(spec, "label", key)}
                for key, spec in self.data_formats.items()
            ],
        }

    def _load_state(self) -> None:
        try:
            payload = json.loads(self._lock_path.read_text(encoding="utf-8"))
            self._disabled = set(map(str, payload.get("disabled") or []))
        except (OSError, ValueError, TypeError):
            self._disabled = set()

    def _save_state(self) -> None:
        try:
            self.root.mkdir(parents=True, exist_ok=True)
            self._lock_path.write_text(
                json.dumps(
                    {"disabled": sorted(self._disabled)}, ensure_ascii=False, indent=2
                )
                + "\n",
                encoding="utf-8",
            )
        except OSError:
            logger.exception("无法保存插件状态")

    def _read_manifest(self, path: Path) -> PluginManifest:
        if path.stat().st_size > MAX_MANIFEST_BYTES:
            raise ValidationError("plugin.json 超过 200 KB")
        return PluginManifest.from_payload(json.loads(path.read_text(encoding="utf-8")))

    def scan(self, *, load: bool = True) -> list[dict[str, Any]]:
        """扫描插件目录；load=True 时按依赖顺序加载所有未禁用插件。"""
        with _PLUGIN_LOCK:
            discovered: dict[str, PluginRecord] = {}
            if self.root.is_dir():
                for directory in sorted(self.root.iterdir()):
                    if not directory.is_dir() or directory.name.startswith("."):
                        continue
                    manifest_path = directory / "plugin.json"
                    if not manifest_path.is_file():
                        continue
                    try:
                        manifest = self._read_manifest(manifest_path)
                        if manifest.id != directory.name:
                            raise ValidationError("插件目录名必须等于 manifest id")
                        record = PluginRecord(manifest=manifest, path=directory)
                        if not version_satisfies(self.host_version, manifest.netlab):
                            record.status = "incompatible"
                            record.error = f"需要 netlab {manifest.netlab}，当前 {self.host_version}"
                        elif manifest.id in self._disabled:
                            record.status = "disabled"
                        discovered[manifest.id] = record
                    except Exception as exc:
                        record = PluginRecord(
                            manifest=PluginManifest(
                                schema="netlab-plugin/1",
                                id=directory.name,
                                name=directory.name,
                                version="0.0.0",
                                plugin_api="1.0",
                                netlab="",
                                entry="",
                            ),
                            path=directory,
                            status="error",
                            error=str(exc),
                        )
                        discovered[directory.name] = record
            self._records = discovered
            if load:
                self._load_available()
            return [record.summary() for record in self._records.values()]

    def _topological(self) -> list[PluginRecord]:
        ordered: list[PluginRecord] = []
        visiting: set[str] = set()
        done: set[str] = set()

        def visit(plugin_id: str) -> None:
            if plugin_id in done:
                return
            if plugin_id in visiting:
                raise ValidationError(f"插件依赖存在环：{plugin_id}")
            record = self._records.get(plugin_id)
            if record is None:
                raise ValidationError(f"缺少依赖插件：{plugin_id}")
            visiting.add(plugin_id)
            for dep in record.manifest.dependencies:
                visit(dep)
            visiting.remove(plugin_id)
            done.add(plugin_id)
            ordered.append(record)

        for plugin_id in sorted(self._records):
            visit(plugin_id)
        return ordered

    def _load_available(self) -> None:
        try:
            ordered = self._topological()
        except Exception as exc:
            for record in self._records.values():
                if record.status == "discovered":
                    record.status = "error"
                    record.error = str(exc)
            return
        for record in ordered:
            if record.status in ("error", "incompatible", "disabled"):
                continue
            if record.status == "loaded":
                continue
            try:
                self._load_record(record)
            except Exception as exc:
                record.status = "error"
                record.error = str(exc)
                logger.exception("插件加载失败：%s", record.manifest.id)

    def _load_record(self, record: PluginRecord) -> None:
        manifest = record.manifest
        for dep_id, dep_range in manifest.dependencies.items():
            dependency = self._records.get(dep_id)
            if dependency is None or dependency.status != "loaded":
                raise ValidationError(f"依赖插件未加载：{dep_id}")
            if not version_satisfies(dependency.manifest.version, dep_range):
                raise ValidationError(f"依赖版本不满足：{dep_id} {dep_range}")
        module = _import_plugin_module(manifest, record.path)
        context = PluginContext(
            manifest.id,
            record.path,
            self.data_root / manifest.id,
            manifest=manifest,
            logger=logging.getLogger(f"netlab.plugin.{manifest.id}"),
        )
        function_name = manifest.entry.split(":", 1)[1]
        function = getattr(module, function_name)
        function(context)
        for capability, spec in context.registrations:
            if capability not in manifest.capabilities:
                raise ValidationError(f"插件未声明能力 {capability}")
            self._install(record, capability, spec)
        self._modules[manifest.id] = module
        record.status = "loaded"
        record.error = ""
        import time

        record.loaded_at = time.strftime("%Y-%m-%dT%H:%M:%S%z")

    def _install(self, record: PluginRecord, capability: str, spec: Any) -> None:
        plugin_id = record.manifest.id
        raw_kind = getattr(spec, "kind", None) or getattr(spec, "id", "")
        kind = _qualify(plugin_id, raw_kind)
        if capability == "compute":
            if not isinstance(spec, V1ComputeSpec):
                raise ValidationError("compute 注册项必须是 ComputeSpec")
            if kind in COMPUTE_SPECS:
                raise ValidationError(f"节点类型已存在：{kind}")
            COMPUTE_SPECS[kind] = ComputeSpec(
                kind=kind,
                label=spec.label,
                group=spec.group,
                description=spec.description,
                params=tuple(spec.params),
                factory=spec.factory,
                outputs=tuple(spec.outputs),
                notes=spec.notes,
                formula=spec.formula,
                source=plugin_id,
                editable=True,
                builtin=False,
            )
        elif capability == "method":
            if not isinstance(spec, V1MethodSpec):
                raise ValidationError("method 注册项必须是 MethodSpec")
            if kind in METHOD_SPECS:
                raise ValidationError(f"连接函数已存在：{kind}")
            METHOD_SPECS[kind] = MethodSpec(
                kind=kind,
                label=spec.label,
                group=spec.group,
                description=spec.description,
                params=tuple(spec.params),
                factory=spec.factory,
                outputs=tuple(spec.outputs),
                notes=spec.notes,
                formula=spec.formula,
                source=plugin_id,
                editable=True,
                builtin=False,
            )
        elif capability == "element":
            if not isinstance(spec, V1ElementSpec):
                raise ValidationError("element 注册项必须是 ElementSpec")
            if kind in ELEMENT_SPECS:
                raise ValidationError(f"元件类型已存在：{kind}")
            ELEMENT_SPECS[kind] = ElementSpec(
                kind=kind,
                label=spec.label,
                description=spec.description,
                params=tuple(spec.params),
                cls=spec.element_cls,
                notes=spec.notes,
                group=spec.group,
                formula=spec.formula,
                source=plugin_id,
                editable=True,
                builtin=False,
                pins=tuple(spec.pins),
            )
        elif capability == "analysis":
            if not isinstance(spec, AnalysisSpec):
                raise ValidationError("analysis 注册项必须是 AnalysisSpec")
            spec = AnalysisSpec(
                kind=kind,
                label=spec.label,
                description=spec.description,
                params=tuple(spec.params),
                modes=tuple(spec.modes),
                run=spec.run,
            )
            register_analysis(spec, plugin_id=plugin_id)
        elif capability == "data_io":
            if not isinstance(spec, DataFormatSpec):
                raise ValidationError("data_io 注册项必须是 DataFormatSpec")
            self.data_formats[kind] = spec
        elif capability == "panel":
            if not isinstance(spec, PanelSpec):
                raise ValidationError("panel 注册项必须是 PanelSpec")
            self.panels[kind] = spec
        elif capability == "template":
            if not isinstance(spec, TemplateSpec):
                raise ValidationError("template 注册项必须是 TemplateSpec")
            self.templates[kind] = spec
        elif capability == "visual":
            if not isinstance(spec, VisualSpec):
                raise ValidationError("visual 注册项必须是 VisualSpec")
            self.visuals[kind] = spec
        elif capability == "engine":
            if not isinstance(spec, EngineSpec):
                raise ValidationError("engine 注册项必须是 EngineSpec")
            if spec.mode in ("signal", "circuit", "vector"):
                raise ValidationError("插件不能替换内置引擎")
            register_engine(spec, plugin_id=plugin_id)
        else:
            raise ValidationError(f"未实现的能力：{capability}")
        record.registered.setdefault(capability, []).append(kind)

    def _unload_record(self, record: PluginRecord) -> None:
        plugin_id = record.manifest.id
        for capability, kinds in list(record.registered.items()):
            for kind in kinds:
                if capability == "compute":
                    COMPUTE_SPECS.pop(kind, None)
                elif capability == "method":
                    METHOD_SPECS.pop(kind, None)
                elif capability == "element":
                    ELEMENT_SPECS.pop(kind, None)
                elif capability == "analysis":
                    unregister_analysis(kind)
                elif capability == "data_io":
                    self.data_formats.pop(kind, None)
                elif capability == "panel":
                    self.panels.pop(kind, None)
                elif capability == "template":
                    self.templates.pop(kind, None)
                elif capability == "visual":
                    self.visuals.pop(kind, None)
                elif capability == "engine":
                    unregister_engine(kind)
        module = self._modules.pop(plugin_id, None)
        if module is not None:
            for name in [
                name
                for name in sys.modules
                if name.startswith("netlab_plugin_")
                and plugin_id.replace(".", "_") in name
            ]:
                sys.modules.pop(name, None)
        record.registered.clear()
        record.status = "disabled" if plugin_id in self._disabled else "discovered"

    def unload_all(self) -> None:
        with _PLUGIN_LOCK:
            for record in list(self._records.values()):
                if record.status == "loaded":
                    self._unload_record(record)

    def reload(self, plugin_id: str) -> dict[str, Any]:
        with _PLUGIN_LOCK:
            record = self._records.get(plugin_id)
            if record is None:
                raise KeyError(plugin_id)
            if record.status == "loaded":
                self._unload_record(record)
            self._load_record(record)
            return record.summary()

    def set_enabled(self, plugin_id: str, enabled: bool) -> dict[str, Any]:
        with _PLUGIN_LOCK:
            record = self._records.get(plugin_id)
            if record is None:
                raise KeyError(plugin_id)
            if enabled:
                self._disabled.discard(plugin_id)
            else:
                self._disabled.add(plugin_id)
                if record.status == "loaded":
                    self._unload_record(record)
            self._save_state()
            if enabled:
                self._load_record(record)
            return record.summary()

    def summaries(self) -> list[dict[str, Any]]:
        return [record.summary() for record in self._records.values()]

    def detail(self, plugin_id: str) -> dict[str, Any]:
        record = self._records.get(plugin_id)
        if record is None:
            raise KeyError(plugin_id)
        payload = record.summary()
        payload["data_formats"] = [
            key for key in self.data_formats if key.startswith(plugin_id + ".")
        ]
        payload["panels"] = [
            key
            for key in self.panels
            if key.startswith(plugin_id + ".") or key == plugin_id
        ]
        payload["visuals"] = [
            key for key in self.visuals if key.startswith(plugin_id + ".")
        ]
        payload["templates"] = [
            key for key in self.templates if key.startswith(plugin_id + ".")
        ]
        return payload


_MANAGER: PluginManager | None = None
_MANAGER_LOCK = threading.Lock()


def get_plugin_manager() -> PluginManager:
    global _MANAGER
    if _MANAGER is None:
        with _MANAGER_LOCK:
            if _MANAGER is None:
                _MANAGER = PluginManager()
    return _MANAGER


__all__ = [
    "PluginManager",
    "PluginManifest",
    "PluginRecord",
    "get_plugin_manager",
    "version_satisfies",
]
