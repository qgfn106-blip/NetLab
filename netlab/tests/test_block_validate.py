"""R04 模块导入前校验：阻断/警告两级 + 干跑报告。"""

from __future__ import annotations

from netlab.block_validate import report_as_text, validate_block_payload
from netlab.blocks import BlockDef, PortDef


def _node(node_id: str, name: str, kind: str, params=None) -> dict:
    return {
        "id": node_id,
        "name": name,
        "kind": kind,
        "params": params or {},
        "data": {},
        "position": {"x": 0.0, "y": 0.0},
    }


def good_block() -> BlockDef:
    return BlockDef(
        id="aaaaaaaaaaaa",
        name="放大器",
        mode="signal",
        description="把输入乘 2",
        nodes=[
            _node("ccccccccccc1", "__in", "module_input", {"role": "interface", "port_name": "in", "fields": ["voltage"]}),
            _node("ccccccccccc2", "amp", "gain", {"field": "voltage", "output": "voltage", "gain": 2.0, "offset": 0.0}),
            _node("ccccccccccc3", "__out", "module_output", {"role": "interface", "port_name": "out", "fields": ["voltage"]}),
        ],
        edges=[
            {"id": "ddddddddddd1", "name": "e1", "source": "ccccccccccc1", "target": "ccccccccccc2", "kind": "pass", "params": {}},
            {"id": "ddddddddddd2", "name": "e2", "source": "ccccccccccc2", "target": "ccccccccccc3", "kind": "pass", "params": {}},
        ],
        ports=[
            PortDef(name="in", direction="input", fields=["voltage"]),
            PortDef(name="out", direction="output", fields=["voltage"]),
        ],
    )


def test_valid_block_passes_dry_run():
    report = validate_block_payload(good_block().to_payload())
    assert report["ok"] is True
    assert report["summary"]["dry_run"] == "passed"
    assert report["summary"]["blocking"] == 0
    assert "通过" in report_as_text(report)


def test_port_without_interface_is_blocking():
    payload = good_block().to_payload()
    # 声明一个没有内部接口节点的端口（结构仍然自洽）
    payload["ports"].append(
        {"name": "extra", "direction": "input", "fields": ["voltage"], "dtype": "signal", "default": 0.0}
    )
    report = validate_block_payload(payload)
    codes = {item["code"] for item in report["blocking"]}
    assert "port_without_interface" in codes
    assert report["ok"] is False


def test_warnings_do_not_block():
    payload = good_block().to_payload()
    payload["description"] = ""
    report = validate_block_payload(payload)
    codes = {item["code"] for item in report["warnings"]}
    assert "missing_description" in codes
    assert report["ok"] is True


def test_broken_internal_compute_fails_dry_run():
    payload = good_block().to_payload()
    for node in payload["nodes"]:
        if node["kind"] == "gain":
            node["params"]["field"] = "nope"
    report = validate_block_payload(payload)
    assert report["ok"] is False
    codes = {item["code"] for item in report["blocking"]}
    assert "dry_run" in codes
    assert "干跑失败" in next(item["message"] for item in report["blocking"] if item["code"] == "dry_run")


def test_self_reference_and_structure_errors():
    payload = good_block().to_payload()
    payload["nodes"].append(_node("eeeeeeeeeee1", "self", "block", {"block_id": "aaaaaaaaaaaa"}))
    report = validate_block_payload(payload)
    codes = {item["code"] for item in report["blocking"]}
    assert codes & {"self_reference", "structure"}
    assert report["ok"] is False

    broken = good_block().to_payload()
    broken["edges"][0]["target"] = "ffffffffffff"
    report = validate_block_payload(broken)
    assert report["ok"] is False
    assert report["blocking"][0]["code"] == "structure"


def test_validate_api(client, tmp_path):
    library = tmp_path / "library"
    response = client.post(
        "/api/blocks/validate",
        json={"payload": good_block().to_payload(), "library": str(library)},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True
    assert body["summary"]["dry_run"] == "passed"
    assert "text" in body and "通过" in body["text"]

    bad = client.post(
        "/api/blocks/validate",
        json={"payload": {"id": "not-a-block"}, "library": str(library)},
    )
    assert bad.status_code == 200
    assert bad.json()["ok"] is False
    assert bad.json()["blocking"][0]["code"] == "structure"
