"""R36/P5：节点内部状态通道与相平面指标回归。"""

import math

import pytest

from netlab.core.compute import analysis
from netlab.core.model.scene import Scene


def test_state_space_exposes_state_probes() -> None:
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
    probes = scene.probes()

    assert "state:g:0" in probes
    assert "state:g:1" in probes
    assert all(math.isfinite(value) for value in probes.values())


def test_probe_channels_use_stable_ids_across_rename() -> None:
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

    before = scene.probes(by_id=True)
    before_states = {key for key in before if key.startswith(f"state:{plant.id}:")}
    assert f"state:{plant.id}:0" in before_states
    scene.update_node(plant.id, {"name": "plant_renamed"})
    after = scene.probes(by_id=True)
    after_states = {key for key in after if key.startswith(f"state:{plant.id}:")}

    assert after_states == before_states
    assert scene.channel_display_name(f"state:{plant.id}:0") == "state:plant_renamed:0"


def test_phase_metrics_circle() -> None:
    count = 100
    xs = [math.cos(2.0 * math.pi * index / count) for index in range(count + 1)]
    ys = [math.sin(2.0 * math.pi * index / count) for index in range(count + 1)]

    result = analysis.phase_metrics(xs, ys)

    assert result["ok"] is True
    assert result["points"] == count + 1
    assert result["path_length"] == pytest.approx(2.0 * math.pi, rel=1e-2)
    assert result["enclosed_area"] == pytest.approx(math.pi, rel=1e-2)
    assert result["x_final"] == pytest.approx(1.0)
    assert result["y_final"] == pytest.approx(0.0, abs=1e-12)


def test_phase_metrics_rejects_length_mismatch() -> None:
    with pytest.raises(analysis.AnalysisError, match="长度不一致"):
        analysis.phase_metrics([0.0, 1.0], [0.0])
