"""N-08：通道键结构化（ChannelKey）回归。"""

from netlab.core.model.channels import ChannelKey
from netlab.core.model.scene import Scene


def test_roundtrip_and_helpers() -> None:
    key = ChannelKey.node("n1", "voltage")
    assert str(key) == "n:n1:voltage"
    assert ChannelKey.parse(str(key)) == key
    assert key.label() == "n1·voltage"
    assert str(key.with_ident("n2")) == "n:n2:voltage"


def test_parse_rejects_unknown_shapes() -> None:
    for text in ("", "n1:voltage", "x:n1:voltage", "n::voltage", "n:n1:"):
        assert ChannelKey.parse(text) is None
    assert ChannelKey.parse(123) is None  # type: ignore[arg-type]


def test_engine_probe_keys_are_structured() -> None:
    scene = Scene("signal")
    source = scene.add_node(name="u", kind="manual", data={"value": 1.0})
    plant = scene.add_node(
        name="g",
        kind="transfer_function",
        params={
            "form": "coeff",
            "numerator": [4.0],
            "denominator": [1.0, 1.2, 4.0],
            "method": "zoh",
        },
    )
    scene.add_edge(name="u-g", source=source.id, target=plant.id, kind="pass")
    scene.step(0.1)

    for key in scene.probes(by_id=True):
        assert ChannelKey.parse(key) is not None, key


def test_display_name_accepts_object_and_legacy_string() -> None:
    scene = Scene("signal")
    node = scene.add_node(name="plant", kind="manual", data={"value": 0.0})
    key = ChannelKey.state(node.id, "0")

    assert scene.channel_display_name(key) == f"state:plant:0"
    assert scene.channel_display_name(str(key)) == f"state:plant:0"
    assert scene.channel_display_name("unknown:key") == "unknown:key"


def test_bridge_labels_use_channel_key() -> None:
    from netlab import plotkit_bridge

    assert plotkit_bridge._label("n:n1:voltage") == "n1·voltage"
    assert plotkit_bridge._label("analysis:ac:mag") == "analysis:ac:mag"
    assert plotkit_bridge._kind_tag("state:n1:0") == "state"
    assert plotkit_bridge._kind_tag("free-text") == ""
