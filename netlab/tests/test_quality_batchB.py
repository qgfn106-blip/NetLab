"""批次B：P1-05 registry_restore 原子恢复 owners、P2-04 RuntimeSnapshot 结构指纹防护。"""

from __future__ import annotations

import pytest

from netlab.core.common.limits import ValidationError
from netlab.core.model.engine_registry import (
    ENGINE_OWNERS,
    ENGINE_SPECS,
    register_engine,
    registry_restore,
    registry_snapshot,
    unregister_engine,
)
from netlab.core.model.scene import Scene
from netlab.plugin_api.v1 import EngineSpec


def _scene(mode="signal", nodes=("a", "b")):
    s = Scene(mode)
    for name in nodes:
        s.add_node(name=name, kind="manual")
    return s


def test_registry_restore_restores_owners_atomically():
    register_engine(
        EngineSpec(mode="pa", label="A", description="", factory=lambda sc: None, node_kinds=("k",)),
        plugin_id="ownA",
    )
    try:
        snap = registry_snapshot()
        register_engine(
            EngineSpec(mode="pb", label="B", description="", factory=lambda sc: None, node_kinds=("k",)),
            plugin_id="ownB",
        )
        assert ENGINE_OWNERS.get("pb") == "ownB"
        registry_restore(snap)
        assert set(ENGINE_SPECS) == set(snap)
        assert ENGINE_OWNERS.get("pa") == "ownA", "owner 应随快照恢复"
        assert "pb" not in ENGINE_OWNERS, "快照外的 owner 不应残留"
    finally:
        unregister_engine("pa")
        unregister_engine("pb")


def test_runtime_snapshot_rejects_cross_topology_restore():
    from netlab.core.model.scene_engines import SignalEngine

    e1 = SignalEngine(_scene("signal", nodes=("a", "b")))
    snap = e1.snapshot()
    assert snap.scene_fingerprint, "快照应携带场景结构指纹"

    # 同模式、不同拓扑（多一个节点）→ 指纹不同，拒绝就地恢复
    e2 = SignalEngine(_scene("signal", nodes=("a", "b", "c")))
    with pytest.raises(ValidationError):
        e2.restore(snap)

    # 同一引擎自身恢复应通过
    e1.restore(snap)
