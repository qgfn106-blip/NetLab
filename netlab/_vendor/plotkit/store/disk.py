"""分块落盘：超出内存热窗的数据写到本地块文件，绘制时按需取回（§4.3 大数据）。"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator

import numpy as np

DEFAULT_CHUNK_SIZE = 1_000_000  # 1M 点/块，float32 ≈ 4 MB（docs/DESIGN_v0.md §4.3）


@dataclass
class Chunk:
    file: str
    start: int
    stop: int


@dataclass
class ChunkedSeries:
    """把一条长序列按块写到磁盘，内存里只保留尾部缓冲。

    `read(i0, i1)` 跨块拼装；索引写在同目录的 `.index.json`，进程重启可续。
    """

    root: Path
    name: str
    chunk_size: int = DEFAULT_CHUNK_SIZE
    dtype: str = "float32"
    chunks: list[Chunk] = field(default_factory=list)
    _buffer: list[np.ndarray] = field(default_factory=list)
    _buffered: int = 0
    _length: int = 0

    @classmethod
    def open(
        cls,
        root: str | os.PathLike[str],
        name: str,
        *,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
        dtype: str = "float32",
    ) -> "ChunkedSeries":
        root_path = Path(root)
        root_path.mkdir(parents=True, exist_ok=True)
        series = cls(root=root_path, name=name, chunk_size=int(chunk_size), dtype=dtype)
        index_path = series.index_path
        if index_path.exists():
            payload = json.loads(index_path.read_text(encoding="utf-8"))
            series.chunks = [Chunk(**c) for c in payload.get("chunks", [])]
            series._length = int(payload.get("length", 0))
        return series

    @property
    def index_path(self) -> Path:
        return self.root / f"{self.name}.index.json"

    def __len__(self) -> int:
        return self._length + self._buffered

    def append(self, values: np.ndarray) -> int:
        array = np.asarray(values, dtype=self.dtype).ravel()
        if array.size:
            self._buffer.append(array)
            self._buffered += int(array.size)
        while self._buffered >= self.chunk_size:
            merged = (
                np.concatenate(self._buffer)
                if len(self._buffer) > 1
                else self._buffer[0]
            )
            head, tail = merged[: self.chunk_size], merged[self.chunk_size :]
            self._write_chunk(head)
            self._buffer = [tail] if tail.size else []
            self._buffered = int(tail.size)
        return len(self)

    def flush(self) -> None:
        if self._buffered:
            merged = (
                np.concatenate(self._buffer)
                if len(self._buffer) > 1
                else self._buffer[0]
            )
            self._write_chunk(merged)
            self._buffer = []
            self._buffered = 0
        self._save_index()

    def _write_chunk(self, array: np.ndarray) -> None:
        start = self._length
        stop = start + int(array.size)
        file_name = f"{self.name}.{len(self.chunks):06d}.bin"
        target = self.root / file_name
        tmp = target.with_suffix(".tmp")
        array.astype(self.dtype, copy=False).tofile(tmp)
        os.replace(tmp, target)
        self.chunks.append(Chunk(file=file_name, start=start, stop=stop))
        self._length = stop
        self._save_index()

    def _save_index(self) -> None:
        payload = {
            "name": self.name,
            "dtype": self.dtype,
            "chunk_size": self.chunk_size,
            "length": self._length,
            "chunks": [c.__dict__ for c in self.chunks],
        }
        tmp = self.index_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, self.index_path)

    def read(self, i0: int = 0, i1: int | None = None) -> np.ndarray:
        total = len(self)
        i1 = total if i1 is None else min(int(i1), total)
        i0 = max(0, int(i0))
        if i1 <= i0:
            return np.empty(0, dtype=self.dtype)
        pieces: list[np.ndarray] = []
        for chunk in self.chunks:
            if chunk.stop <= i0 or chunk.start >= i1:
                continue
            data = np.fromfile(self.root / chunk.file, dtype=self.dtype)
            lo = max(i0, chunk.start) - chunk.start
            hi = min(i1, chunk.stop) - chunk.start
            pieces.append(data[lo:hi])
        if i1 > self._length:  # 尾部还在缓冲里
            buffered = (
                np.concatenate(self._buffer)
                if self._buffer
                else np.empty(0, dtype=self.dtype)
            )
            offset = self._length
            pieces.append(buffered[max(0, i0 - offset) : max(0, i1 - offset)])
        return np.concatenate(pieces) if pieces else np.empty(0, dtype=self.dtype)

    def nbytes(self) -> int:
        return len(self) * np.dtype(self.dtype).itemsize

    def chunk_files(self) -> Iterator[Path]:
        for chunk in self.chunks:
            yield self.root / chunk.file
