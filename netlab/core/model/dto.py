"""阶段7 P1-S1：Project / Scene 的类型化 DTO 层（恒等映射接缝）。

设计约束（见 `NetlabExtras/scratch/STAGE7_P1S1_DTO_DESIGN.md`）：
- **不改变外部 JSON**，也不替换既有 `dict[str, Any]` 管线；本模块只是并行接缝，
  为后续「静态校验与 runtime 构造分离」提供类型入口。
- `from_payload()` / `to_payload()` 对当前 v7 payload **严格恒等**：保留键顺序、
  数值归一交给 `project.canonical_json`，从而保证 `encode_project_bytes()` 字节级
  round-trip 与原始工程文件一致。
- 不触碰 `graph.py` / `scene.py` / FEM。
"""
from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any

REQUIRED_TOP_KEYS = ("format", "version", "networks")


def _require_dict(payload: Any, what: str) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise TypeError(f"{what} payload must be a dict, got {type(payload).__name__}")
    return payload


@dataclass
class SceneDoc:
    """场景文档的类型化视图（对 v7 scene payload 恒等包装）。"""

    payload: dict[str, Any]

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "SceneDoc":
        return cls(payload=copy.deepcopy(_require_dict(payload, "scene")))

    @property
    def mode(self) -> str | None:
        value = self.payload.get("mode")
        return value if isinstance(value, str) else None

    def to_payload(self) -> dict[str, Any]:
        return copy.deepcopy(self.payload)


@dataclass
class NetworkDoc:
    """单网络文档的类型化视图。"""

    payload: dict[str, Any]

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "NetworkDoc":
        return cls(payload=copy.deepcopy(_require_dict(payload, "network")))

    @property
    def id(self) -> str | None:
        value = self.payload.get("id")
        return value if isinstance(value, str) else None

    @property
    def name(self) -> str | None:
        value = self.payload.get("name")
        return value if isinstance(value, str) else None

    @property
    def scene(self) -> SceneDoc | None:
        scene = self.payload.get("scene")
        if isinstance(scene, dict):
            return SceneDoc.from_payload(scene)
        return None

    def to_payload(self) -> dict[str, Any]:
        return copy.deepcopy(self.payload)


@dataclass
class ProjectDTO:
    """整个工程的类型化视图（对 v7 project payload 恒等包装）。"""

    payload: dict[str, Any]

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "ProjectDTO":
        data = _require_dict(payload, "project")
        missing = [k for k in REQUIRED_TOP_KEYS if k not in data]
        if missing:
            raise ValueError(f"project payload missing keys: {missing}")
        if not isinstance(data["networks"], list):
            raise ValueError("project 'networks' must be a list")
        return cls(payload=copy.deepcopy(data))

    @property
    def format(self) -> Any:
        return self.payload.get("format")

    @property
    def version(self) -> Any:
        return self.payload.get("version")

    @property
    def app(self) -> Any:
        return self.payload.get("app")

    @property
    def name(self) -> Any:
        return self.payload.get("name")

    @property
    def current(self) -> Any:
        return self.payload.get("current")

    @property
    def networks(self) -> list[NetworkDoc]:
        return [NetworkDoc.from_payload(item) for item in self.payload["networks"]]

    def to_payload(self) -> dict[str, Any]:
        # 恒等映射：deepcopy 保留键顺序，保证与原始 payload 字节级一致。
        return copy.deepcopy(self.payload)
