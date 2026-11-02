"""命名数据集注册表（L1 数据层，D3 延迟绑定）。

规则：
- spec 里只出现数据集**名字**，数组只在这里；
- `role` 决定能绑到哪种 kind 的哪个参数（见 spec/validate.py）；
- `life="append"` 保留全部历史，`life="replace"` 只留最新并递增 version（前端据此防抖）。
"""

from __future__ import annotations

import csv
import os
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Iterator, Sequence

import numpy as np

from ..spec.model import ROLES

#: 数据锁：netlab 的同步线程在 push/trim，出图线程在整批读；两边不互斥时
#: 出图会读到"t 已加、某条曲线还没加"的中间态，直接抛 x/y 长度不一致。
DATA_LOCK = threading.RLock()

LIVES = ("append", "replace")


@dataclass
class DataSetMeta:
    name: str
    unit: str = ""
    role: str = "auto"
    tags: tuple[str, ...] = ()
    life: str = "append"
    length: int = 0
    dtype: str = "float64"
    shape: tuple[int, ...] = (0,)
    version: int = 0
    updated_at: float = field(default_factory=time.time)
    note: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "unit": self.unit,
            "role": self.role,
            "tags": list(self.tags),
            "life": self.life,
            "length": self.length,
            "dtype": self.dtype,
            "shape": list(self.shape),
            "version": self.version,
            "updated_at": self.updated_at,
            "note": self.note,
        }


class DataSet:
    """一份数据集：`values` 永远是"逻辑长度"的视图，背后是几何增长的缓冲区。

    追加时只在容量不够时扩容（1.5 倍），避免每次 `np.concatenate` 重拷全部历史。
    """

    __slots__ = ("meta", "_buf", "_len", "history", "_pyr", "_pyr_version")

    def __init__(self, meta: "DataSetMeta", values, history=None) -> None:
        self.meta = meta
        self._buf = values if isinstance(values, np.ndarray) else np.asarray(values)
        self._len = int(self._buf.shape[0])
        self.history = list(history) if history else []
        self._pyr = None          # 多级摘要（数据金字塔），懒建
        self._pyr_version = -1

    @property
    def values(self) -> np.ndarray:
        if self._len == self._buf.shape[0]:
            return self._buf
        return self._buf[: self._len]

    def __len__(self) -> int:
        return self._len

    def __getitem__(self, item):
        """`ds[-100:]` / `ds[0]` 直接取数据，省得每次都写 `.values`。"""
        return self.values[item]

    @values.setter
    def values(self, array) -> None:
        self._buf = array if isinstance(array, np.ndarray) else np.asarray(array)
        self._len = int(self._buf.shape[0])

    def append(self, array: np.ndarray) -> None:
        n = int(array.shape[0])
        need = self._len + n
        if need > int(self._buf.shape[0]):
            newcap = max(need, int(int(self._buf.shape[0]) * 1.5) + 16)
            grown = np.empty((newcap,) + self._buf.shape[1:], dtype=self._buf.dtype)
            if self._len:
                grown[: self._len] = self._buf[: self._len]
            self._buf = grown
        self._buf[self._len:need] = array
        self._len = need

    @property
    def capacity_bytes(self) -> int:
        """缓冲区实际占用（含预留容量），用于内存核算。"""
        return int(self._buf.nbytes)

    def snapshot(self) -> dict[str, Any]:
        return {
            "meta": self.meta.as_dict(),
            "history": [{"version": v, "length": n, "at": t} for v, n, t in self.history],
        }


def _as_array(values: Any, *, name: str) -> np.ndarray:
    if isinstance(values, np.ndarray):
        array = values
    else:
        try:
            array = np.asarray(values)
        except Exception as exc:  # pragma: no cover - numpy 自己会报
            raise TypeError(f"数据集 {name} 的值无法转成数组: {exc}") from exc
    if array.ndim == 0:
        array = array.reshape(1)
    # 允许到三维：3D 图层的网格（x/y/z/u/v/w）就是 (nz, ny, nx)
    if array.ndim > 3:
        raise ValueError(f"数据集 {name} 最多三维，收到 {array.ndim} 维")
    if array.dtype == object:
        raise TypeError(f"数据集 {name} 是 object 数组（不可序列化），请先转成数值或字符串列表")
    return np.array(array, copy=True)


class DataStore:
    """会话级数据集容器。线程安全靠调用方（FastAPI 单进程内串行推帧）。"""

    def __init__(self, *, namespace: str = "session", tmpdir: str | os.PathLike[str] | None = None) -> None:
        self.namespace = namespace
        self.tmpdir = Path(tmpdir) if tmpdir else None
        self._sets: dict[str, DataSet] = {}
        self._aliases: dict[str, str] = {}
        self._pyramids: dict[tuple[str, str], tuple[tuple[int, int], list]] = {}

    # ---------------- 多级摘要（数据金字塔） ----------------
    def pyramid(self, x_name: str, y_name: str):
        """取 (x, y) 这对数据的分级摘要；数据没变就复用上次建好的。

        只在总点数超过 `downsample.PYRAMID_MIN_POINTS` 时才建，小数据直接返回 None。
        """
        from .downsample import PYRAMID_MIN_POINTS, build_pyramid

        x_set, y_set = self.get(x_name), self.get(y_name)
        n = min(len(x_set), len(y_set))
        if n <= PYRAMID_MIN_POINTS:
            return None
        key = (x_name, y_name)
        stamp = (int(x_set.meta.version), int(y_set.meta.version))
        hit = self._pyramids.get(key)
        if hit and hit[0] == stamp:
            return hit[1]
        levels = build_pyramid(x_set.values[:n], y_set.values[:n])
        if len(self._pyramids) > 16:      # 只留最近若干对，避免长会话攒满
            self._pyramids.pop(next(iter(self._pyramids)))
        self._pyramids[key] = (stamp, levels)
        return levels

    # ---------------- 注册 ----------------
    def add(
        self,
        name: str,
        values: Any,
        *,
        unit: str = "",
        role: str = "auto",
        tags: Iterable[str] = (),
        life: str = "append",
        note: str = "",
        overwrite: bool = False,
    ) -> DataSetMeta:
        if not isinstance(name, str) or not name.strip():
            raise ValueError("数据集名字不能为空")
        if role not in ROLES:
            raise ValueError(f"role 必须是 {ROLES} 之一，收到 {role!r}")
        if life not in LIVES:
            raise ValueError(f"life 必须是 {LIVES} 之一，收到 {life!r}")
        key = self._resolve(name, create=True)
        if key in self._sets and not overwrite:
            raise KeyError(f"数据集已存在: {name}（改值请用 push()，或 overwrite=True）")
        array = _as_array(values, name=name)
        previous = self._sets.get(key)
        version = int(previous.meta.version) + 1 if previous is not None else 1
        history = list(previous.history) if previous is not None else []
        meta = DataSetMeta(
            name=key,
            unit=unit,
            role=role,
            tags=tuple(str(t) for t in tags),
            life=life,
            length=int(array.shape[0]) if array.ndim else 1,
            dtype=str(array.dtype),
            shape=tuple(int(s) for s in array.shape),
            version=version,
            note=note,
        )
        history.append((version, meta.length, meta.updated_at))
        self._sets[key] = DataSet(meta=meta, values=array, history=history)
        return meta

    def push(self, name: str, values: Any) -> DataSetMeta:
        """按 life 追加或替换。返回更新后的 meta（前端读 version 做防抖）。"""
        key = self._resolve(name)
        if key not in self._sets:
            return self.add(name, values)
        data = self._sets[key]
        array = _as_array(values, name=name)
        if data.meta.life == "append":
            if data.values.ndim != array.ndim:
                raise ValueError(f"数据集 {name} 维度不一致: {data.values.ndim} vs {array.ndim}")
            if array.ndim == 2 and data.values.shape[1:] != array.shape[1:]:
                raise ValueError(f"数据集 {name} 列数不一致: {data.values.shape[1:]} vs {array.shape[1:]}")
            data.append(array)
        else:
            data.values = array
        data.meta.length = int(data.values.shape[0])
        data.meta.dtype = str(data.values.dtype)
        data.meta.shape = tuple(int(s) for s in data.values.shape)
        data.meta.version += 1
        data.meta.updated_at = time.time()
        data.history.append((data.meta.version, data.meta.length, data.meta.updated_at))
        return data.meta

    def trim(self, name: str, keep: int) -> DataSetMeta:
        """原地裁掉旧数据、只留最近 ``keep`` 行，**不改数据集的 life**。

        环形窗口要用它，而不是 `add(..., life="replace")`：后者会把追加语义
        永久改成替换，下一次 `push()` 就把整条曲线换成最后一帧。
        """
        key = self._resolve(name)
        if key not in self._sets:
            raise KeyError(f"数据集不存在: {name}")
        keep = max(0, int(keep))
        data = self._sets[key]
        n = int(data.values.shape[0])
        if n <= keep:
            return data.meta
        data._buf = data._buf[n - keep: n].copy()
        data._len = keep
        data.meta.length = keep
        data.meta.shape = tuple(int(s) for s in data._buf.shape)
        data.meta.version += 1
        data.meta.updated_at = time.time()
        data.history.append((data.meta.version, keep, data.meta.updated_at))
        return data.meta

    def rename(self, old: str, new: str) -> DataSetMeta:
        key = self._resolve(old)
        if key not in self._sets:
            raise KeyError(f"数据集不存在: {old}")
        target = self._resolve(new, create=True)
        if target in self._sets:
            raise KeyError(f"目标名字已被占用: {new}")
        data = self._sets.pop(key)
        data.meta.name = target
        self._sets[target] = data
        for alias, real in list(self._aliases.items()):
            if real == key:
                self._aliases[alias] = target
        return data.meta

    def remove(self, name: str) -> DataSet:
        key = self._resolve(name)
        if key not in self._sets:
            raise KeyError(f"数据集不存在: {name}")
        return self._sets.pop(key)

    # ---------------- 查询 ----------------
    def _resolve(self, name: str, *, create: bool = False) -> str:
        if name in self._sets:
            return name
        if name in self._aliases:
            return self._aliases[name]
        return name if create else name

    def __contains__(self, name: object) -> bool:
        return isinstance(name, str) and name in self._sets

    def __len__(self) -> int:
        return len(self._sets)

    def names(self) -> list[str]:
        return list(self._sets)

    def meta(self, name: str) -> dict[str, Any]:
        key = self._resolve(name)
        if key not in self._sets:
            raise KeyError(f"数据集不存在: {name}")
        return self._sets[key].meta.as_dict()

    def get(self, name: str) -> DataSet:
        key = self._resolve(name)
        if key not in self._sets:
            raise KeyError(f"数据集不存在: {name}")
        return self._sets[key]

    def values(self, name: str) -> np.ndarray:
        return self.get(name).values

    def history(self, name: str) -> list[dict[str, Any]]:
        return self.get(name).snapshot()["history"]

    def catalog(self, *, only: Sequence[str] | None = None) -> dict[str, Any]:
        """给前端下拉列表用的目录：按 tags 分组，附单位/维度/长度。"""
        groups: dict[str, list[str]] = {}
        items = []
        for key, data in self._sets.items():
            if only is not None and key not in only:
                continue
            meta = data.meta.as_dict()
            items.append(meta)
            for tag in (meta["tags"] or ["未分组"]):
                groups.setdefault(tag, []).append(key)
        return {"namespace": self.namespace, "datasets": items, "groups": groups}

    def __iter__(self) -> Iterator[str]:
        return iter(self._sets)

    # ---------------- 导出 ----------------
    def export(self, name: str, path: str | os.PathLike[str]) -> Path:
        """把命名数据集导出成 CSV（列式：name, unit, role, version, values...）。"""
        data = self.get(name)
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerow(["name", "unit", "role", "version", "tags"])
            writer.writerow([data.meta.name, data.meta.unit, data.meta.role, data.meta.version, ";".join(data.meta.tags)])
            for row in data.values:
                writer.writerow(np.atleast_1d(row).tolist())
        return target

    def nbytes(self) -> int:
        return sum(int(d.capacity_bytes) for d in self._sets.values())
