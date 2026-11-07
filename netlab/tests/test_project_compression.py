"""W4：工程压缩容器（魔数 + zlib）读写、旧纯文本兼容、checksum 与 MAX 判定。"""

from __future__ import annotations

import zlib

import pytest

from netlab.core.common.limits import LimitError
from netlab.core.compute.simulation import Simulation
from netlab.core.model.project import (
    MAX_PROJECT_BYTES,
    PROJECT_MAGIC,
    atomic_write,
    build_project,
    compute_checksum,
    decode_project_bytes,
    encode_project_bytes,
    load_project_raw,
    project_from_text,
    project_to_text,
    verify_checksum,
)
from netlab.core.model.scene import Scene


def _project() -> dict:
    scene = Scene("signal")
    a = scene.add_node(name="a", kind="manual", data={"voltage": 1.0})
    b = scene.add_node(name="b", kind="sum")
    scene.add_edge(source=a.id, target=b.id, kind="scale", params={"gain": 2.0})
    simulation = Simulation(scene)
    try:
        simulation.apply_config({"fps": 30, "dt": 0.01, "steps_per_frame": 1})
        return build_project(simulation, name="compress-demo")
    finally:
        simulation.shutdown()


def test_magic_prefix_is_exact_bytes():
    data = encode_project_bytes(_project())
    assert data[: len(PROJECT_MAGIC)] == PROJECT_MAGIC
    assert data[:6] == bytes([0x1F, 0x4E, 0x4C, 0x41, 0x42, 0x01])


def test_compressed_roundtrip_equals_original():
    project = _project()
    data = encode_project_bytes(project)
    assert decode_project_bytes(data) == project


def test_plain_text_fallback_still_parses():
    project = _project()
    raw = project_to_text(project).encode("utf-8")
    assert not raw.startswith(PROJECT_MAGIC)
    assert decode_project_bytes(raw) == project
    # project_from_text 同时接受 str 与 bytes
    assert project_from_text(raw) == project
    assert project_from_text(project_to_text(project)) == project


def test_atomic_write_dict_is_compressed_and_smaller(tmp_path):
    project = _project()
    target = tmp_path / "demo.netlab"
    atomic_write(target, project)
    raw = target.read_bytes()
    assert raw[:6] == bytes([0x1F, 0x4E, 0x4C, 0x41, 0x42, 0x01])
    assert raw.startswith(PROJECT_MAGIC)
    plain = project_to_text(project).encode("utf-8")
    assert len(raw) < len(plain), "压缩后应比纯文本小"
    assert project_from_text(raw) == project


def test_atomic_write_str_stays_plain(tmp_path):
    """非工程（str/bytes）仍按原样写入，不压缩（设置、.block、CSV 等共用 atomic_write）。"""
    target = tmp_path / "notes.json"
    atomic_write(target, '{"a": 1}')
    assert target.read_text(encoding="utf-8") == '{"a": 1}'


def test_load_project_raw_reads_compressed(tmp_path):
    project = _project()
    target = tmp_path / "comp.netlab"
    atomic_write(target, project)
    loaded = load_project_raw(target)
    assert loaded["name"] == "compress-demo"
    assert loaded["checksum"] == project["checksum"]


def test_load_project_raw_reads_legacy_plain_text(tmp_path):
    """旧纯文本 .netlab 无需迁移即可直接加载。"""
    project = _project()
    target = tmp_path / "legacy.netlab"
    target.write_bytes(project_to_text(project).encode("utf-8"))
    assert not target.read_bytes().startswith(PROJECT_MAGIC)
    loaded = load_project_raw(target)
    assert loaded["name"] == "compress-demo"


def test_checksum_stable_across_compression():
    project = _project()
    checksum = compute_checksum(project)
    assert project["checksum"] == checksum
    decoded = decode_project_bytes(encode_project_bytes(project))
    assert decoded["checksum"] == checksum
    assert verify_checksum(decoded)


def test_max_uncompressed_body_enforced_on_decode():
    body = b"0" * (MAX_PROJECT_BYTES + 10)
    compressed = PROJECT_MAGIC + zlib.compress(body)
    with pytest.raises(LimitError):
        decode_project_bytes(compressed)
    with pytest.raises(LimitError):
        decode_project_bytes(body)


def test_atomic_write_rejects_oversized_project(tmp_path):
    project = _project()
    project["blob"] = "x" * (MAX_PROJECT_BYTES + 10)
    with pytest.raises(LimitError):
        atomic_write(tmp_path / "too-big.netlab", project)
    assert not (tmp_path / "too-big.netlab").exists()
