"""引用计数 + 待回收区（D6）。

要点：**不要**在 `close()` 时直接 `os.remove`——进程被杀、误关窗口都会丢数据。
这里只把"没人引用"的数据集移进待回收区，显式 purge 才真删，且可 restore。
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Iterable

from .registry import DataSet, DataStore

DEFAULT_QUOTA_BYTES = 2 * 1024**3  # 2 GB（docs/DESIGN_v0.md §4.3）


@dataclass
class TrashEntry:
    name: str
    dataset: DataSet
    dropped_at: float = field(default_factory=time.time)
    reason: str = ""

    @property
    def nbytes(self) -> int:
        return int(self.dataset.capacity_bytes)


class Reclaimer:
    def __init__(self, store: DataStore, *, quota_bytes: int = DEFAULT_QUOTA_BYTES) -> None:
        self.store = store
        self.quota_bytes = int(quota_bytes)
        self._owners: dict[str, set[str]] = {}
        self._trash: dict[str, TrashEntry] = {}

    # ---------------- 引用计数 ----------------
    def retain(self, name: str, owner: str) -> int:
        bucket = self._owners.setdefault(name, set())
        bucket.add(owner)
        return len(bucket)

    def release(self, name: str, owner: str) -> bool:
        """释放一个引用；若归零则移入待回收区。返回是否已进入待回收区。"""
        bucket = self._owners.get(name)
        if not bucket:
            return False
        bucket.discard(owner)
        if bucket:
            return False
        self._owners.pop(name, None)
        return self._drop(name, reason=f"最后一个引用 {owner} 释放")

    def refcount(self, name: str) -> int:
        return len(self._owners.get(name, ()))

    # ---------------- 待回收区 ----------------
    def _drop(self, name: str, *, reason: str = "") -> bool:
        if name not in self.store:
            return False
        dataset = self.store.remove(name)
        self._trash[name] = TrashEntry(name=name, dataset=dataset, reason=reason)
        return True

    def list(self) -> list[dict[str, Any]]:
        return [
            {"name": e.name, "dropped_at": e.dropped_at, "nbytes": e.nbytes, "reason": e.reason}
            for e in self._trash.values()
        ]

    def restore(self, name: str) -> bool:
        entry = self._trash.pop(name, None)
        if entry is None:
            return False
        if name in self.store:  # 名字被新数据占用：改用带后缀的名字，绝不覆盖
            name = f"{name}~restored"
            entry.dataset.meta.name = name
        # 直接塞回 store 的内部表：restore 不走 add()，避免覆盖已有同名数据
        self.store._sets[name] = entry.dataset  # noqa: SLF001 - 同包内部协作
        return True

    def purge(self, name: str) -> bool:
        return self._trash.pop(name, None) is not None

    def empty(self) -> int:
        count = len(self._trash)
        self._trash.clear()
        return count

    # ---------------- 配额 ----------------
    def used_bytes(self) -> int:
        trash_bytes = sum(e.nbytes for e in self._trash.values())
        return self.store.nbytes() + trash_bytes

    def over_quota(self) -> bool:
        return self.used_bytes() > self.quota_bytes

    def trim(self, keep: Iterable[str] = ()) -> list[str]:
        """配额超限时按"最久未更新"回收待回收区，返回被真删的名字。"""
        keep_set = set(keep)
        purged: list[str] = []
        for entry in sorted(self._trash.values(), key=lambda e: e.dropped_at):
            if entry.name in keep_set:
                continue
            if not self.over_quota():
                break
            if self.purge(entry.name):
                purged.append(entry.name)
        return purged
