"""M-02 复现：工程快照不应把运行时 `data`（节点输出）持久化为初值。

现状（缺陷）：`NodeRecord.snapshot(include_state=False)` 仍序列化 `data`，
而 `build_project` 用 `to_payload(include_state=False)` 保存工程；重载后
`Scene.load_payload` 把该 `data` 当作节点初始数据，`Node.__post_init__`
又把它固化为 `_initial_data`，导致「运行时输出 → 工程初值」污染。

本文件按审批口径只写**复现测试**、不改生产代码；当前用 xfail(strict=True)
登记已知缺陷，修复落地后应转绿（届时删除 xfail 标记，否则 XPASS 判失败）。
"""

import pytest

from netlab.core.model.scene import Scene


@pytest.mark.xfail(
    strict=True,
    reason="M-02 复现：to_payload(include_state=False) 仍写入运行时 data，重载后成为初值（待修复）",
)
def test_persisted_snapshot_must_not_carry_runtime_output() -> None:
    scene = Scene("signal")
    u = scene.add_node(name="u", kind="manual", data={"value": 3.0})
    g = scene.add_node(name="g", kind="gain", params={"gain": 2.0})
    scene.add_edge(name="e", source=u.id, target=g.id, kind="pass")

    gid = g.id
    # 建模后计算节点初始 data 为空
    assert scene.nodes[gid].data == {}

    scene.step(0.1)
    # 一拍后 gain 输出写入运行时 data
    assert scene.nodes[gid].data.get("value") == pytest.approx(6.0)

    payload = scene.to_payload(include_state=False)
    g_payload = next(n for n in payload["nodes"] if n["id"] == gid)

    # 期望：工程持久化不应把运行时输出写进 data（当前缺陷：含 value=6）
    assert "value" not in g_payload.get("data", {}), (
        f"工程快照不应把运行时 data 写入，实际={g_payload.get('data')!r}"
    )

    # 重载后不应把运行时输出当作初值
    reloaded = Scene("signal")
    reloaded.load_payload(payload)
    assert reloaded.nodes[gid].data.get("value") is None, (
        f"重载后初值被运行时输出污染：{reloaded.nodes[gid].data!r}"
    )
