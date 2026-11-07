"""P-B 元素级外观（Appearance Engine 二期）最小自证 demo。

演示：
1. 默认无覆盖：节点/连线快照里根本没有 ``appearance`` 字段（视觉零变化）。
2. 只对某一元素设置 color/opacity/lineWidth/fontSize：仅该元素快照出现覆盖，
   其它元素完全不受影响。
3. 保存（to_payload）→ 重载（load_payload）后覆盖仍在。
4. 传空字典清除覆盖后，字段重新消失。

运行（在 NetlabHome/ 下）：
    python tools/pb_appearance_demo.py
"""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from netlab.core.model.scene import Scene  # noqa: E402


def snapshot_by_id(records) -> dict[str, dict]:
    return {item["id"]: item for item in records}


def main() -> int:
    scene = Scene(mode="signal")
    n1 = scene.add_node(name="输入源", kind="manual")
    n2 = scene.add_node(name="观察点", kind="manual")
    edge = scene.add_edge(source=n1.id, target=n2.id, kind="scale", name="w1")

    payload = scene.to_payload(include_state=False)
    nodes = snapshot_by_id(payload["nodes"])
    edges = snapshot_by_id(payload["edges"])

    # 1) 默认无覆盖：三个元素都没有 appearance 键。
    assert "appearance" not in nodes[n1.id], "默认不应写 appearance（节点）"
    assert "appearance" not in nodes[n2.id], "默认不应写 appearance（节点）"
    assert "appearance" not in edges[edge.id], "默认不应写 appearance（连线）"
    print("[1] 默认零覆盖：三个元素均无 appearance 字段 ✓")

    # 2) 只给 n1 设置 4 项覆盖。
    override = {"color": "#123456", "opacity": 0.5, "lineWidth": 3.0, "fontSize": 16.0}
    scene.update_node(n1.id, {"appearance": override})
    payload = scene.to_payload(include_state=False)
    nodes = snapshot_by_id(payload["nodes"])
    edges = snapshot_by_id(payload["edges"])
    assert nodes[n1.id]["appearance"] == override, nodes[n1.id].get("appearance")
    assert "appearance" not in nodes[n2.id], "其它节点不应被波及"
    assert "appearance" not in edges[edge.id], "连线不应被波及"
    print(f"[2] 仅 n1 变动：{nodes[n1.id]['appearance']} ✓（n2 / edge 无变化）")

    # 3) 保存 → 重载：覆盖仍在。
    saved = scene.to_payload(include_state=False)
    restored = Scene(mode="signal")
    restored.load_payload(saved)
    again = snapshot_by_id(restored.to_payload(include_state=False)["nodes"])
    assert again[n1.id]["appearance"] == override, again[n1.id].get("appearance")
    print("[3] 保存→重载后覆盖仍在 ✓")

    # 3b) 连线覆盖也走同一条通道（含非法值拒绝）。
    scene.update_edge(edge.id, {"appearance": {"color": "#abcdef", "lineWidth": 2.5}})
    e = snapshot_by_id(scene.to_payload(include_state=False)["edges"])[edge.id]
    assert e["appearance"] == {"color": "#abcdef", "lineWidth": 2.5}, e.get("appearance")
    print(f"[3b] 连线覆盖：{e['appearance']} ✓")

    for bad in ({"opacity": 2.0}, {"lineWidth": 99}, {"color": "red"}, {"bogus": 1}):
        try:
            scene.update_edge(edge.id, {"appearance": bad})
        except Exception as exc:  # noqa: BLE001 - demo 只需展示拒绝行为
            print(f"[3c] 拒绝非法覆盖 {bad}：{type(exc).__name__} ✓")
        else:  # pragma: no cover
            raise AssertionError(f"非法覆盖未被拒绝：{bad}")

    # 4) 清空覆盖 → 字段消失，回到默认。
    scene.update_node(n1.id, {"appearance": {}})
    cleared = snapshot_by_id(scene.to_payload(include_state=False)["nodes"])
    assert "appearance" not in cleared[n1.id], "清除后不应残留 appearance"
    print("[4] 清除覆盖后字段消失、回到默认 ✓")

    print("\n全部断言通过：P-B 元素级外观最小闭环成立。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
