"""工程压缩容器解码必须有界且校验压缩流完整性。

缺陷（修复前）：decode_project_bytes 先 zlib.decompress 全量展开再判 8MB，
zip-bomb 可致 MemoryError；且不校验 eof/unused_data/尾随/拼接/截断。
修复后：decompressobj + max_length 有界；超限抛 LimitError；缺 eof/尾随/拼接/
损坏/截断抛 ValidationError。
"""

from __future__ import annotations

import json
import zlib

import pytest

from netlab.core.common.limits import LimitError, ValidationError
from netlab.core.model.project import MAX_PROJECT_BYTES, PROJECT_MAGIC, decode_project_bytes


def _json_of_size(n: int) -> bytes:
    body = b'{"pad":"' + b"a" * (n - 10) + b'"}'
    assert len(body) == n
    json.loads(body)
    return body


def test_roundtrip_compressed():
    payload = json.dumps({"name": "demo", "values": [1, 2, 3]}).encode("utf-8")
    raw = PROJECT_MAGIC + zlib.compress(payload, 9)
    assert decode_project_bytes(raw) == {"name": "demo", "values": [1, 2, 3]}


def test_plain_text_fallback():
    assert decode_project_bytes(b'{"mode":"signal"}') == {"mode": "signal"}


def test_exactly_max_ok():
    body = _json_of_size(MAX_PROJECT_BYTES)
    raw = PROJECT_MAGIC + zlib.compress(body, 9)
    assert isinstance(decode_project_bytes(raw), dict)


def test_over_max_rejected():
    body = _json_of_size(MAX_PROJECT_BYTES + 1)
    raw = PROJECT_MAGIC + zlib.compress(body, 9)
    with pytest.raises(LimitError):
        decode_project_bytes(raw)


def test_zip_bomb_bounded_memory():
    import tracemalloc

    body = b"\x00" * (MAX_PROJECT_BYTES * 6)  # ~48MB 展开，压缩后几十 KB
    raw = PROJECT_MAGIC + zlib.compress(body, 9)
    del body
    assert len(raw) < MAX_PROJECT_BYTES
    tracemalloc.start()
    try:
        with pytest.raises(LimitError):
            decode_project_bytes(raw)
        peak = tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()
    assert peak < MAX_PROJECT_BYTES * 3, f"峰值 {peak} 超有界阈值"


@pytest.mark.parametrize("cut", [1, 2, 4])
def test_truncated_stream_rejected(cut: int):
    raw = PROJECT_MAGIC + zlib.compress(b'{"a":1}', 9)
    with pytest.raises(ValidationError):
        decode_project_bytes(raw[: len(raw) - cut])


def test_corrupt_stream_rejected():
    payload = bytearray(zlib.compress(b'{"a":1}', 9))
    payload[2] ^= 0xFF
    with pytest.raises(ValidationError):
        decode_project_bytes(PROJECT_MAGIC + bytes(payload))


def test_trailing_bytes_rejected():
    raw = PROJECT_MAGIC + zlib.compress(b'{"a":1}', 9) + b"EXTRA"
    with pytest.raises(ValidationError):
        decode_project_bytes(raw)


def test_concatenated_streams_rejected():
    raw = PROJECT_MAGIC + zlib.compress(b'{"a":1}', 9) + zlib.compress(b'{"b":2}', 9)
    with pytest.raises(ValidationError):
        decode_project_bytes(raw)
