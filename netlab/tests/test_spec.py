"""规格自省（V2-2）回归：catalog 必须能直接喂给前端「规格」页。

覆盖三件事：

1. 四个注册表（节点计算 / 连接传递 / 电路节点 / 电路元件）的每一项都带
   公式、真实源码、源码路径与完整参数字段——前端不做二次推断；
2. 用户扩展注册后，catalog 里能拿到它的源码、公式、参数，并标记为非内置；
3. 扩展节点在真实场景里跑起来，数值与装饰器里登记的公式一致。
"""

from __future__ import annotations

import pytest

from netlab.core.model import extensions
from netlab.core.compute.computes import compute_catalog
from netlab.core.compute.methods import method_catalog
from netlab.core.compute.nodal import (
    ELEMENT_GROUP_ORDER,
    ELEMENT_GROUPS,
    element_catalog,
    node_catalog,
)
from netlab.core.model.ports import PINS
from netlab.core.model.scene import Scene

SPEC_KEYS = {
    "kind",
    "label",
    "group",
    "description",
    "mode",
    "outputs",
    "notes",
    "formula",
    "source",
    "source_path",
    "editable",
    "builtin",
    "addable",
    "params",
}

PARAM_KEYS = {
    "key",
    "label",
    "type",
    "default",
    "unit",
    "help",
    "group",
    "example",
    "required",
}


def test_element_groups_cover_all_kinds():
    """R22/D46：全部元件落组；R15 第四批新增「功率电子与电机」，组数允许扩展。"""
    catalog = {entry["kind"]: entry for entry in element_catalog()}
    assert set(catalog) == set(PINS)
    assert len(ELEMENT_GROUP_ORDER) >= 10
    for kind, entry in catalog.items():
        assert entry["group"] in ELEMENT_GROUP_ORDER, f"{kind} 未分类：{entry['group']}"
        assert entry["group"] == ELEMENT_GROUPS[kind]
    used = {entry["group"] for entry in catalog.values()}
    assert used == set(ELEMENT_GROUP_ORDER)


RATE_LIMITER_CODE = """
@node(
    kind="user.rate_limiter",
    label="速率限制",
    group="自定义",
    description="限制每步输出变化量",
    outputs=("y",),
    formula="y[k] = y[k-1] + clamp(Σu − y[k-1], ±rate)",
    params=(Param("rate", "每步最大变化", "float", 1.0, unit="V", min=0.0),),
)
def rate_limiter(ctx):
    rate = float(ctx.params.get("rate", 1.0))
    total = 0.0
    for payload in ctx.inputs.values():
        total += float(payload.get("voltage", 0.0))
    previous = float(ctx.data.get("y", 0.0))
    delta = total - previous
    if delta > rate:
        delta = rate
    elif delta < -rate:
        delta = -rate
    return {"y": previous + delta}
"""


@pytest.fixture(autouse=True)
def clean_registry():
    extensions.reset()
    yield
    extensions.reset()


def all_catalogs():
    return {
        "computes": compute_catalog(),
        "methods": method_catalog(),
        "circuit_nodes": node_catalog(),
        "elements": element_catalog(),
    }


def assert_entry_is_complete(where: str, spec: dict) -> None:
    missing = SPEC_KEYS - set(spec)
    assert not missing, f"{where}/{spec.get('kind')} 缺少字段 {sorted(missing)}"
    assert str(spec["formula"]).strip(), f"{where}/{spec['kind']} 没有登记公式"
    assert isinstance(spec["params"], list)
    for param in spec["params"]:
        lack = PARAM_KEYS - set(param)
        assert (
            not lack
        ), f"{where}/{spec['kind']}/{param.get('key')} 参数缺少 {sorted(lack)}"


def test_every_catalog_entry_is_complete():
    for where, items in all_catalogs().items():
        assert items, f"{where} 为空"
        for spec in items:
            assert_entry_is_complete(where, spec)


def test_builtin_source_points_at_real_files():
    for where, items in all_catalogs().items():
        for spec in items:
            if not spec["builtin"]:
                continue
            assert str(spec["source"]).strip(), f"{where}/{spec['kind']} 没有源码"
            assert str(spec["source_path"]).endswith(
                ".py"
            ), f"{where}/{spec['kind']} 源码路径异常：{spec['source_path']!r}"


def test_module_kinds_are_not_addable_from_menu():
    """P0-0：模块实例/端口节点只能由模块库生成，菜单必须按 addable 过滤。"""
    entries = {item["kind"]: item for item in compute_catalog()}
    for kind in ("block", "module_input", "module_output"):
        assert entries[kind]["addable"] is False, f"{kind} 不应出现在添加节点菜单"
    for kind in ("manual", "sum", "gain"):
        assert entries[kind]["addable"] is True


def test_pass_method_has_formula():
    """V2-0 补的 pass 连接当时的公式表漏登记，V2-2 已补上。"""
    entries = {item["kind"]: item for item in method_catalog()}
    assert "pass" in entries
    assert entries["pass"]["formula"].strip()


def test_extension_spec_is_marked_custom_and_carries_source():
    extensions.activate_code(RATE_LIMITER_CODE, persist=False)
    entries = {item["kind"]: item for item in compute_catalog()}

    spec = entries["user.rate_limiter"]
    assert spec["builtin"] is False
    assert spec["editable"] is True
    assert "@node(" in spec["source"], "catalog 应返回用户提交的真实源码"
    assert "rate" in [param["key"] for param in spec["params"]]
    assert spec["outputs"] == ["y"]
    assert "clamp" in spec["formula"]


def test_rate_limiter_node_follows_registered_formula():
    """端到端：真实 Scene 里跑三步，输出必须符合登记的公式。"""
    extensions.activate_code(RATE_LIMITER_CODE, persist=False)

    scene = Scene("signal")
    source = scene.add_node(name="src", kind="manual", data={"voltage": 10.0})
    limiter = scene.add_node(name="lim", kind="user.rate_limiter", params={"rate": 1.0})
    scene.add_edge(source=source.id, target=limiter.id, kind="pass")

    values = []
    for _ in range(3):
        scene.step(0.01)
        values.append(float(scene.nodes[limiter.id].data["y"]))
    # y[k] = y[k-1] + clamp(10 − y[k-1], ±1) → 1, 2, 3
    assert values == [1.0, 2.0, 3.0]

    # 再走足够多步后必须收敛到输入 10，而不是越过它。
    for _ in range(12):
        scene.step(0.01)
    assert float(scene.nodes[limiter.id].data["y"]) == pytest.approx(10.0)


def test_extension_api_validate_activate_deactivate(client):
    validated = client.post(
        "/api/extensions/validate", json={"code": RATE_LIMITER_CODE}
    )
    assert validated.status_code == 200, validated.text
    assert validated.json()["declared"][0]["kind"] == "user.rate_limiter"

    activated = client.post(
        "/api/extensions/activate", json={"code": RATE_LIMITER_CODE}
    )
    assert activated.status_code == 200, activated.text
    body = activated.json()
    assert body["kinds"] == ["user.rate_limiter"]
    kinds = [item["kind"] for item in body["catalog"]["computes"]]
    assert "user.rate_limiter" in kinds

    listed = client.get("/api/extensions").json()
    assert [item["kind"] for item in listed["extensions"]] == ["user.rate_limiter"]
    assert listed["extensions"][0]["sha256"]
    assert "沙箱" in listed["notice"]

    deactivated = client.post(
        "/api/extensions/deactivate", json={"kind": "user.rate_limiter"}
    )
    assert deactivated.status_code == 200, deactivated.text
    kinds_after = [item["kind"] for item in deactivated.json()["catalog"]["computes"]]
    assert "user.rate_limiter" not in kinds_after


def test_extension_deactivate_in_use_is_rejected(client):
    client.post("/api/extensions/activate", json={"code": RATE_LIMITER_CODE})
    created = client.post(
        "/api/nodes",
        json={
            "name": "lim",
            "kind": "user.rate_limiter",
            "params": {"rate": 1.0},
            "position": {"x": 0.0, "y": 0.0},
        },
    )
    assert created.status_code == 200, created.text
    blocked = client.post(
        "/api/extensions/deactivate", json={"kind": "user.rate_limiter"}
    )
    assert blocked.status_code == 422
    assert "使用" in blocked.json()["detail"]
