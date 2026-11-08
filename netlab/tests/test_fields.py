"""R35：信号字段自动匹配与 value 默认口径。"""

from __future__ import annotations

import math
from types import MappingProxyType

import numpy as np
import pytest

from netlab.core.common.limits import ComputeError
from netlab.core.compute.fields import (
    read_node_numeric,
    read_numeric,
    resolve_field,
    resolve_output,
)
from netlab.core.compute.statespace import StateSpaceModel
from netlab.core.model.scene import Scene


# ---- 解析优先级 ---------------------------------------------------------


def test_explicit_field_wins_over_value():
    payload = {"value": 1.0, "current": 2.0}
    assert resolve_field(payload, "current") == "current"


def test_auto_prefers_value_over_voltage():
    assert resolve_field({"voltage": 1.0, "value": 2.0}) == "value"


def test_auto_falls_back_to_voltage():
    assert resolve_field({"voltage": 1.0}) == "voltage"


def test_auto_uses_only_numeric_field():
    assert resolve_field({"current": 1.0, "label": "x"}) == "current"


def test_auto_ignores_non_numeric_preferred_value():
    assert resolve_field({"value": "x", "voltage": 1.0}) == "voltage"


def test_auto_ambiguous_payload_raises_with_available_fields():
    with pytest.raises(ComputeError) as exc:
        resolve_field({"alpha": 1.0, "beta": 2.0}, source="e1")
    assert "e1" in str(exc.value)
    assert "alpha" in str(exc.value)
    assert "beta" in str(exc.value)


def test_missing_explicit_field_falls_back_to_value():
    # 旧保存文件里残留的自定义键可能已经不存在；能落到 value 就不该整链失败。
    assert resolve_field({"value": 3.0}, "old_key") == "value"


def test_missing_explicit_field_without_fallback_raises():
    with pytest.raises(ComputeError):
        resolve_field({"alpha": 1.0, "beta": 2.0}, "old_key")


def test_auto_keywords():
    for key in ("", "auto", "AUTO", "*", None):
        assert resolve_field({"value": 1.0}, key) == "value"


# ---- 数值读取 -----------------------------------------------------------


def test_read_numeric_returns_float():
    assert read_numeric({"value": 2}) == 2.0


def test_read_numeric_rejects_bool():
    with pytest.raises(ComputeError):
        read_numeric({"value": True})


def test_read_numeric_rejects_text():
    with pytest.raises(ComputeError):
        read_numeric({"value": "2.0"})


def test_read_numeric_rejects_non_finite():
    for bad in (math.inf, -math.inf, math.nan):
        with pytest.raises(ComputeError):
            read_numeric({"value": bad})


def test_read_node_numeric_accepts_mapping_proxy():
    class NodeView:
        name = "g"
        data = MappingProxyType({"value": 4.0})

    assert read_node_numeric(NodeView()) == 4.0


def test_read_node_numeric_reports_node_name():
    class NodeView:
        name = "g"
        data = MappingProxyType({"alpha": 1.0, "beta": 2.0})

    with pytest.raises(ComputeError) as exc:
        read_node_numeric(NodeView())
    assert "节点" in str(exc.value)
    assert "g" in str(exc.value)


# ---- 输出键 -------------------------------------------------------------


def test_resolve_output_defaults_to_value():
    for key in ("", "auto", "AUTO", "*", None):
        assert resolve_output(key) == "value"


def test_resolve_output_keeps_custom_key():
    assert resolve_output("current") == "current"


# ---- 节点集成 -----------------------------------------------------------


def test_gain_defaults_to_value_field_and_output():
    scene = Scene("signal")
    source = scene.add_node(name="u", kind="manual", data={"value": 2.0})
    gain = scene.add_node(name="g", kind="gain", params={"gain": 3.0})
    scene.add_edge(source=source.id, target=gain.id, kind="pass")
    scene.step(0.01)
    assert gain.data["value"] == pytest.approx(6.0)


def test_gain_legacy_voltage_params_still_work():
    scene = Scene("signal")
    source = scene.add_node(name="u", kind="manual", data={"voltage": 2.0})
    gain = scene.add_node(
        name="g",
        kind="gain",
        params={"gain": 3.0, "field": "voltage", "output": "voltage"},
    )
    scene.add_edge(source=source.id, target=gain.id, kind="pass")
    scene.step(0.01)
    assert gain.data["voltage"] == pytest.approx(6.0)


def test_sum_mixes_value_and_voltage_inputs():
    scene = Scene("signal")
    a = scene.add_node(name="a", kind="manual", data={"value": 2.0})
    b = scene.add_node(name="b", kind="manual", data={"voltage": 5.0})
    total = scene.add_node(
        name="s", kind="sum", params={"weights": {"e1": 1.0, "e2": 1.0}}
    )
    scene.add_edge(name="e1", source=a.id, target=total.id, kind="pass")
    scene.add_edge(name="e2", source=b.id, target=total.id, kind="pass")
    scene.step(0.01)
    assert total.data["value"] == pytest.approx(7.0)


def test_transfer_function_defaults_to_value():
    scene = Scene("signal")
    source = scene.add_node(name="u", kind="manual", data={"value": 3.0})
    tf = scene.add_node(
        name="g", kind="transfer_function", params={"form": "expr", "expr": "2"}
    )
    scene.add_edge(source=source.id, target=tf.id, kind="pass")
    scene.step(0.01)
    assert tf.data["value"] == pytest.approx(6.0)


def test_delayed_edge_uses_zero_before_source_is_computed():
    scene = Scene("signal")
    source = scene.add_node(name="u", kind="manual", data={"value": 1.0})
    total = scene.add_node(name="s", kind="sum", params={"weights": {}})
    tf = scene.add_node(
        name="g", kind="transfer_function", params={"form": "expr", "expr": "1/(s+1)"}
    )
    scene.add_edge(name="e1", source=source.id, target=total.id, kind="pass")
    scene.add_edge(name="e2", source=total.id, target=tf.id, kind="pass")
    feedback = scene.add_edge(
        name="e3", source=tf.id, target=total.id, kind="pass", auto_delay=True
    )

    assert feedback.delay is True
    scene.step(0.1)
    scene.step(0.1)
    assert math.isfinite(tf.data["value"])
    assert tf.data["value"] > 0.0


def test_state_space_input_map_auto_matches():
    model = StateSpaceModel(
        a=np.asarray([[0.0]]),
        b=np.asarray([[1.0]]),
        c=np.asarray([[1.0]]),
        d=np.asarray([[0.0]]),
        input_map=["in"],
        output_map=["y"],
    )
    assert model.resolve_inputs({"in": {"value": 3.0}}).tolist() == [3.0]
    assert model.resolve_inputs({"in": {"voltage": 4.0}}).tolist() == [4.0]
    assert model.resolve_inputs({}).tolist() == [0.0]


def test_output_auto_normalizes_to_value():
    scene = Scene("signal")
    source = scene.add_node(name="u", kind="manual", data={"value": 2.0})
    gain = scene.add_node(name="g", kind="gain", params={"gain": 3.0, "output": "auto"})
    scene.add_edge(name="u_g", source=source.id, target=gain.id, kind="pass")
    scene.step(0.01)
    assert gain.data["value"] == pytest.approx(6.0)
    assert "auto" not in gain.data


def test_discrete_tf_preserves_unit_delay():
    scene = Scene("signal")
    source = scene.add_node(name="u", kind="manual", data={"value": 1.0})
    sink = scene.add_node(name="y", kind="sum", params={"weights": {"u": 1.0}})
    scene.add_edge(
        name="u",
        source=source.id,
        target=sink.id,
        kind="tf",
        params={
            "domain": "discrete",
            "numerator": [1.0],
            "denominator": [1.0, 0.0],
            "input_key": "value",
            "output_key": "value",
        },
    )
    scene.step(0.1)
    assert sink.data["value"] == pytest.approx(0.0)
    scene.step(0.1)
    assert sink.data["value"] == pytest.approx(1.0)


def test_reset_restores_computed_node_data():
    scene = Scene("signal")
    source = scene.add_node(
        name="src",
        kind="signal",
        params={"wave": "step", "offset": 0.0, "amplitude": 1.0, "delay": 0.0},
    )
    total = scene.add_node(
        name="sum", kind="sum", params={"weights": {"u": 1.0, "fb": 1.0}}
    )
    scene.add_edge(name="u", source=source.id, target=total.id, kind="pass")
    scene.add_edge(
        name="fb",
        source=total.id,
        target=total.id,
        kind="scale",
        params={"gain": -1.0},
        delay=True,
    )
    scene.step(0.1)
    first = total.data["value"]
    for _ in range(3):
        scene.step(0.1)
    assert total.data["value"] != pytest.approx(first)
    scene.reset()
    scene.step(0.1)
    assert total.data["value"] == pytest.approx(first)
