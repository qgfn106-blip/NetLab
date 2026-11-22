"""分析工作台会话：多状态快照、结果缓存与失效判定。

设计（规格 D1/D8/D9）：

* **会话**只保存“来源”：电路快照、端点/断环选择、分析参数与布局；
  分析结果是缓存，不是真相来源。
* 每个**状态**是命名快照，带 fingerprint；结果按
  (state_fingerprint, analysis_kind, params_fingerprint) 缓存。
* 电路发生修改 -> invalidate()：旧结果标记 stale，不删除，
  以便前端展示“结果已过期”。
* 会话进程内 LRU（默认 8 个 / 30 分钟），不写工程文件；布局由前端
  单独持久化到 ui.analysis_workbench。
"""

from __future__ import annotations

import copy
import hashlib
import json
import threading
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable

from ...common.limits import NotFoundError, ValidationError

SCHEMA = "netlab-analysis-session/1"
STATE_LIMIT = 24
RESULT_LIMIT = 64
DEFAULT_SESSION_TTL_S = 30.0 * 60.0
DEFAULT_SESSION_LIMIT = 8
ANALYSIS_KINDS = (
    "bode",
    "time",
    "nyquist",
    "loop",
    "metrics",
    "poles",
    "loop_closed",
    "loop_step",
    "step_open",
    "nyquist_closed",
)


def _canonical(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _hash(payload: Any) -> str:
    return hashlib.sha256(_canonical(payload).encode("utf-8")).hexdigest()


def _now() -> float:
    return time.time()


def _require_text(value: Any, label: str, *, limit: int = 120) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"{label}必须是非空字符串")
    text = value.strip()
    if len(text) > limit:
        raise ValidationError(f"{label}过长（>{limit} 字符）")
    return text


def _json_object(value: Any, label: str) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValidationError(f"{label}必须是对象")
    try:
        return copy.deepcopy(json.loads(_canonical(value)))
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"{label}必须可 JSON 序列化") from exc


@dataclass
class AnalysisState:
    """命名分析场景：电路快照 + 端口/断环选择 + 分析参数。"""

    state_id: str
    label: str
    circuit: dict[str, Any]
    fingerprint: str
    operating_point: dict[str, float] | None = None
    input_source: str | None = None
    output: str | None = None
    loop_element: str | None = None
    feedback_sign: float = 1.0
    ranges: dict[str, Any] = field(default_factory=dict)
    params: dict[str, Any] = field(default_factory=dict)
    composition: dict[str, Any] = field(default_factory=dict)
    created_at: float = field(default_factory=_now)
    updated_at: float = field(default_factory=_now)
    revision: int = 1

    def source_payload(self) -> dict[str, Any]:
        """参与指纹的“来源”字段（不含展示名与布局）。"""
        return {
            "circuit": self.circuit,
            "operating_point": self.operating_point,
            "input_source": self.input_source,
            "output": self.output,
            "loop_element": self.loop_element,
            "feedback_sign": float(self.feedback_sign),
            "ranges": self.ranges,
        }

    def to_dict(self) -> dict[str, Any]:
        return {
            "state_id": self.state_id,
            "label": self.label,
            "circuit": copy.deepcopy(self.circuit),
            "fingerprint": self.fingerprint,
            "operating_point": copy.deepcopy(self.operating_point),
            "input_source": self.input_source,
            "output": self.output,
            "loop_element": self.loop_element,
            "feedback_sign": float(self.feedback_sign),
            "ranges": copy.deepcopy(self.ranges),
            "params": copy.deepcopy(self.params),
            "composition": copy.deepcopy(self.composition),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "revision": self.revision,
        }

    @classmethod
    def from_payload(
        cls,
        payload: dict[str, Any],
        *,
        state_id: str | None = None,
        label: str | None = None,
    ) -> "AnalysisState":
        if not isinstance(payload, dict):
            raise ValidationError("状态必须是对象")
        circuit = payload.get("circuit")
        if circuit is None and isinstance(payload.get("scene"), dict):
            circuit = payload.get("scene")
        if not isinstance(circuit, dict):
            raise ValidationError("状态缺少 circuit 快照")
        state = cls(
            state_id=state_id or str(payload.get("state_id") or uuid.uuid4()),
            label=label or str(payload.get("label") or "状态"),
            circuit=_json_object(circuit, "circuit"),
            fingerprint="",
            operating_point=(
                _json_object(payload.get("operating_point"), "operating_point")
                if payload.get("operating_point") is not None
                else None
            ),
            input_source=payload.get("input_source"),
            output=payload.get("output"),
            loop_element=payload.get("loop_element"),
            feedback_sign=float(payload.get("feedback_sign", 1.0) or 1.0),
            ranges=_json_object(payload.get("ranges"), "ranges"),
            params=_json_object(payload.get("params"), "params"),
            composition=_json_object(payload.get("composition"), "composition"),
        )
        state.fingerprint = _hash(state.source_payload())
        return state

    def touch(self, **changes: Any) -> None:
        allowed = {
            "label",
            "circuit",
            "operating_point",
            "input_source",
            "output",
            "loop_element",
            "feedback_sign",
            "ranges",
            "params",
            "composition",
        }
        unknown = set(changes) - allowed
        if unknown:
            raise ValidationError(f"未知状态字段：{', '.join(sorted(unknown))}")
        for key, value in changes.items():
            if key in {"circuit", "ranges", "params", "composition"}:
                value = _json_object(value, key)
            if key == "operating_point":
                value = _json_object(value, key) if value is not None else None
            if key == "label":
                value = _require_text(value, "状态名")
            if key == "feedback_sign":
                value = float(value)
                if value not in (1.0, -1.0):
                    raise ValidationError("feedback_sign 只能是 +1 或 -1")
            setattr(self, key, value)
        self.fingerprint = _hash(self.source_payload())
        self.revision += 1
        self.updated_at = _now()


@dataclass
class CachedResult:
    key: str
    state_id: str
    kind: str
    params_fingerprint: str
    result: dict[str, Any]
    generated_at: float = field(default_factory=_now)
    stale: bool = False
    stale_reason: str | None = None


class AnalysisSession:
    """一个工作台会话；线程安全（HTTP 层可能并发访问）。"""

    def __init__(self, name: str = "分析会话", *, session_id: str | None = None) -> None:
        self.session_id = session_id or uuid.uuid4().hex
        self.name = _require_text(name, "会话名")
        self.created_at = _now()
        self.updated_at = self.created_at
        self.revision = 1
        self.states: "OrderedDict[str, AnalysisState]" = OrderedDict()
        self.active_state_id: str | None = None
        self._results: "OrderedDict[str, CachedResult]" = OrderedDict()
        self._lock = threading.RLock()

    # ---- states ---------------------------------------------------------
    def add_state(self, payload: dict[str, Any], *, select: bool = True) -> AnalysisState:
        with self._lock:
            if len(self.states) >= STATE_LIMIT:
                raise ValidationError(f"会话状态数已达上限 {STATE_LIMIT}")
            state = AnalysisState.from_payload(payload)
            self.states[state.state_id] = state
            if select or self.active_state_id is None:
                self.active_state_id = state.state_id
            self._touch()
            return state

    def get_state(self, state_id: str | None = None) -> AnalysisState:
        with self._lock:
            key = state_id or self.active_state_id
            state = self.states.get(key or "")
            if state is None:
                raise NotFoundError("分析状态不存在")
            return state

    def update_state(self, state_id: str, changes: dict[str, Any]) -> AnalysisState:
        with self._lock:
            state = self.get_state(state_id)
            state.touch(**changes)
            self._mark_stale(state.state_id, "状态来源已修改")
            self._touch()
            return state

    def remove_state(self, state_id: str) -> None:
        with self._lock:
            if state_id not in self.states:
                raise NotFoundError("分析状态不存在")
            del self.states[state_id]
            for key in [k for k, v in self._results.items() if v.state_id == state_id]:
                del self._results[key]
            if self.active_state_id == state_id:
                self.active_state_id = next(iter(self.states), None)
            self._touch()

    def select_state(self, state_id: str) -> AnalysisState:
        with self._lock:
            state = self.get_state(state_id)
            self.active_state_id = state.state_id
            self._touch()
            return state

    def invalidate(self, reason: str = "电路已修改") -> int:
        """电路修改后把所有缓存结果标记为过期，返回标记数量。"""
        with self._lock:
            count = 0
            for result in self._results.values():
                if not result.stale:
                    result.stale = True
                    result.stale_reason = reason
                    count += 1
            if count:
                self._touch()
            return count

    def _mark_stale(self, state_id: str, reason: str) -> None:
        for result in self._results.values():
            if result.state_id == state_id and not result.stale:
                result.stale = True
                result.stale_reason = reason

    # ---- results --------------------------------------------------------
    @staticmethod
    def result_key(state: AnalysisState, kind: str, params: dict[str, Any] | None = None) -> str:
        if kind not in ANALYSIS_KINDS:
            raise ValidationError(f"未知分析类型：{kind}")
        return _hash(
            {
                "state": state.fingerprint,
                "kind": kind,
                "params": _json_object(params, "params"),
            }
        )

    def cached(
        self, state_id: str, kind: str, params: dict[str, Any] | None = None
    ) -> CachedResult | None:
        with self._lock:
            state = self.get_state(state_id)
            return self._results.get(self.result_key(state, kind, params))

    def compute(
        self,
        state_id: str,
        kind: str,
        runner: Callable[[AnalysisState], dict[str, Any]],
        *,
        params: dict[str, Any] | None = None,
        force: bool = False,
    ) -> dict[str, Any]:
        """执行或复用缓存；返回带 cache 元数据的结果。"""
        with self._lock:
            state = self.get_state(state_id)
            key = self.result_key(state, kind, params)
            hit = self._results.get(key)
            if hit is not None and not force and not hit.stale:
                return self._decorate(hit, cached=True)
        result = runner(state)
        if not isinstance(result, dict):
            raise ValidationError("分析结果必须是对象")
        envelope_payload = result.get("envelope")
        if envelope_payload is not None and not isinstance(envelope_payload, dict):
            raise ValidationError("分析结果 envelope 必须是对象")
        with self._lock:
            entry = CachedResult(
                key=key,
                state_id=state.state_id,
                kind=kind,
                params_fingerprint=_hash(_json_object(params, "params")),
                result=copy.deepcopy(result),
            )
            self._results[key] = entry
            while len(self._results) > RESULT_LIMIT:
                self._results.popitem(last=False)
            self._touch()
            return self._decorate(entry, cached=False)

    def _decorate(self, entry: CachedResult, *, cached: bool) -> dict[str, Any]:
        payload = copy.deepcopy(entry.result)
        payload["cache"] = {
            "key": entry.key,
            "cached": bool(cached),
            "stale": bool(entry.stale),
            "stale_reason": entry.stale_reason,
            "generated_at": entry.generated_at,
        }
        return payload

    def results(self) -> list[dict[str, Any]]:
        with self._lock:
            return [
                {
                    "key": item.key,
                    "state_id": item.state_id,
                    "kind": item.kind,
                    "stale": item.stale,
                    "stale_reason": item.stale_reason,
                    "generated_at": item.generated_at,
                }
                for item in self._results.values()
            ]

    def cached_results(
        self,
        *,
        state_ids: Iterable[str] | None = None,
        kinds: Iterable[str] | None = None,
    ) -> list[CachedResult]:
        """导出用：按状态/类型过滤缓存结果。"""
        wanted_states = set(state_ids) if state_ids is not None else None
        wanted_kinds = set(kinds) if kinds is not None else None
        with self._lock:
            return [
                item
                for item in self._results.values()
                if (wanted_states is None or item.state_id in wanted_states)
                and (wanted_kinds is None or item.kind in wanted_kinds)
            ]

    def compare(
        self,
        state_ids: Iterable[str],
        kind: str,
        *,
        include_stale: bool = True,
    ) -> dict[str, Any]:
        """多状态对比：返回每状态的缓存结果 + 指标差异表。"""
        ids = list(state_ids)
        if len(ids) < 2:
            raise ValidationError("对比至少需要两个状态")
        with self._lock:
            states = [self.get_state(state_id) for state_id in ids]
            rows: list[dict[str, Any]] = []
            metrics: dict[str, dict[str, Any]] = {}
            for state in states:
                keys = [
                    key
                    for key, value in self._results.items()
                    if value.state_id == state.state_id and value.kind == kind
                ]
                if not keys:
                    rows.append(
                        {
                            "state_id": state.state_id,
                            "label": state.label,
                            "fingerprint": state.fingerprint,
                            "available": False,
                            "stale": False,
                            "metrics": {},
                        }
                    )
                    continue
                entry = self._results[keys[-1]]
                if entry.stale and not include_stale:
                    continue
                metrics[state.state_id] = copy.deepcopy(
                    (entry.result.get("envelope") or {}).get("metrics") or {}
                )
                rows.append(
                    {
                        "state_id": state.state_id,
                        "label": state.label,
                        "fingerprint": state.fingerprint,
                        "available": True,
                        "stale": entry.stale,
                        "stale_reason": entry.stale_reason,
                        "metrics": metrics[state.state_id],
                    }
                )
        table: dict[str, list[dict[str, Any]]] = {}
        for metric_key in sorted({key for row in rows for key in row["metrics"]}):
            cells = []
            for row in rows:
                value = row["metrics"].get(metric_key)
                cells.append(
                    {
                        "state_id": row["state_id"],
                        "label": row["label"],
                        "value": value,
                    }
                )
            table[metric_key] = cells
        return {
            "schema": SCHEMA,
            "kind": kind,
            "states": rows,
            "metrics": table,
        }

    # ---- serialization --------------------------------------------------
    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "schema": SCHEMA,
                "session_id": self.session_id,
                "name": self.name,
                "active_state_id": self.active_state_id,
                "states": [state.to_dict() for state in self.states.values()],
                "results": self.results(),
                "revision": self.revision,
                "created_at": self.created_at,
                "updated_at": self.updated_at,
            }

    def _touch(self) -> None:
        self.revision += 1
        self.updated_at = _now()


class AnalysisSessionStore:
    """进程内会话表：LRU + TTL。"""

    def __init__(
        self,
        *,
        limit: int = DEFAULT_SESSION_LIMIT,
        ttl_s: float = DEFAULT_SESSION_TTL_S,
    ) -> None:
        self.limit = max(1, int(limit))
        self.ttl_s = max(1.0, float(ttl_s))
        self._sessions: "OrderedDict[str, AnalysisSession]" = OrderedDict()
        self._lock = threading.RLock()

    def _prune(self) -> None:
        now = _now()
        expired = [
            key
            for key, session in self._sessions.items()
            if now - session.updated_at > self.ttl_s
        ]
        for key in expired:
            del self._sessions[key]
        while len(self._sessions) > self.limit:
            self._sessions.popitem(last=False)

    def create(self, name: str = "分析会话") -> AnalysisSession:
        with self._lock:
            self._prune()
            session = AnalysisSession(name)
            self._sessions[session.session_id] = session
            return session

    def get(self, session_id: str) -> AnalysisSession:
        with self._lock:
            self._prune()
            session = self._sessions.get(session_id)
            if session is None:
                raise NotFoundError("分析会话不存在或已过期")
            self._sessions.move_to_end(session_id)
            return session

    def drop(self, session_id: str) -> None:
        with self._lock:
            if self._sessions.pop(session_id, None) is None:
                raise NotFoundError("分析会话不存在")

    def list(self) -> list[dict[str, Any]]:
        with self._lock:
            self._prune()
            return [
                {
                    "session_id": session.session_id,
                    "name": session.name,
                    "states": len(session.states),
                    "active_state_id": session.active_state_id,
                    "updated_at": session.updated_at,
                }
                for session in self._sessions.values()
            ]

    def clear(self) -> None:
        with self._lock:
            self._sessions.clear()
