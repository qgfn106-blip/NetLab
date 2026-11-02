"""R06：跨模式拒绝与 signal↔vector 显式接口块。"""

from __future__ import annotations

import pytest

from netlab.core.model import blocklib
from netlab.core.model.blocks import BlockDef, PortDef
from netlab.core.common.limits import ValidationError
from netlab.core.model.scene import Scene


def make_block(mode: str = "signal") -> BlockDef:
    return BlockDef(
        id="aaaaaaaaaaaa" if mode == "signal" else "bbbbbbbbbbbb",
        name=f"{mode}-block",
        mode=mode,
        description="",
        nodes=[
            {
                "id": "ccccccccccc1",
                "name": "inner",
                "kind": "sum",
                "params": {},
                "data": {},
                "position": {"x": 0.0, "y": 0.0},
            }
        ],
        edges=[],
        ports=[PortDef(name="in", direction="input", fields=["voltage"])],
    )


def test_cross_mode_block_is_rejected_in_scene(tmp_path):
    library = tmp_path / "library"
    signal_block = make_block("signal")
    blocklib.write_block(library, signal_block)

    circuit = Scene("circuit")
    circuit.blocks.add(blocklib.load_block(library, signal_block.id))
    with pytest.raises(ValidationError, match="模式"):
        circuit.add_node(
            name="blk", kind="block", params={"block_id": signal_block.id}
        )

    signal = Scene("signal")
    signal.blocks.add(make_block("vector"))
    with pytest.raises(ValidationError, match="模式"):
        signal.add_node(name="blk", kind="block", params={"block_id": "bbbbbbbbbbbb"})


def test_cross_mode_project_payload_is_rejected():
    signal_scene = Scene("signal")
    circuit_block = make_block("circuit").to_payload()
    payload = {
        "mode": "signal",
        "nodes": [
            {
                "id": "ddddddddddd1",
                "name": "blk",
                "kind": "block",
                "params": {"block_id": circuit_block["id"], "block_name": "circuit-block"},
                "data": {},
                "position": {"x": 0.0, "y": 0.0},
            }
        ],
        "edges": [],
        "blocks": [circuit_block],
    }
    with pytest.raises(ValidationError, match="模式"):
        signal_scene.load_payload(payload)


def test_cross_mode_instantiate_api_rejects(client, tmp_path):
    library = tmp_path / "library"
    signal_block = make_block("signal")
    blocklib.write_block(library, signal_block)
    client.post("/api/mode", json={"mode": "circuit"})
    response = client.post(
        "/api/blocks/instantiate",
        json={"block_id": signal_block.id, "library": str(library)},
    )
    assert response.status_code == 422, response.text
    assert "模式" in response.json()["detail"]


def test_signal_to_vector_interface_maps_angle():
    scene = Scene("signal")
    source = scene.add_node(name="u", kind="manual", data={"voltage": 3.0})
    interface = scene.add_node(
        name="s2v",
        kind="if_signal_to_vector",
        params={"angle": 90.0},
    )
    scene.add_edge(source=source.id, target=interface.id, kind="pass")
    scene.step(0.01)
    data = scene.nodes[interface.id].data
    assert data["x"] == pytest.approx(0.0, abs=1e-9)
    assert data["y"] == pytest.approx(3.0)
    assert data["magnitude"] == pytest.approx(3.0)


def test_vector_to_signal_interface_component_and_magnitude():
    scene = Scene("vector")
    source = scene.add_node(name="v", kind="manual", data={"x": 3.0, "y": 4.0})
    magnitude = scene.add_node(
        name="v2s",
        kind="if_vector_to_signal",
        params={"component": "magnitude"},
    )
    component_x = scene.add_node(
        name="v2sx",
        kind="if_vector_to_signal",
        params={"component": "x", "output_field": "u"},
    )
    scene.add_edge(source=source.id, target=magnitude.id, kind="pass")
    scene.add_edge(source=source.id, target=component_x.id, kind="pass")
    scene.step(0.01)
    assert scene.nodes[magnitude.id].data["voltage"] == pytest.approx(5.0)
    assert scene.nodes[component_x.id].data["u"] == pytest.approx(3.0)
