"""Task3 数值精度设置（exact/standard + 显示位数）后端契约与设置往返。"""

from __future__ import annotations

import sympy as sp
import pytest

from netlab.core.compute import analysis
from netlab.core.compute.simulation import Simulation
from netlab.core.model.scene import Scene
from netlab.core.model.workspace import DEFAULT_SETTINGS, load_settings, save_settings


def _scene(gain: float = 0.1) -> Scene:
    scene = Scene("signal")
    u = scene.add_node(name="u", kind="manual", data={"value": 1.0})
    g = scene.add_node(name="g", kind="gain", params={"gain": gain})
    p = scene.add_node(name="p", kind="transfer_function", params={"form": "expr", "expr": "1/(s+1)"})
    scene.add_edge(source=u.id, target=g.id, kind="pass")
    scene.add_edge(source=g.id, target=p.id, kind="pass")
    return scene


def test_defaults_include_numeric_precision():
    assert DEFAULT_SETTINGS["numeric_precision"] == "exact"
    assert DEFAULT_SETTINGS["numeric_display_digits"] == 6


def test_mode_toggle_changes_symbolic_float_atoms():
    try:
        analysis.set_numeric_precision_mode("standard")
        assert analysis.numeric_precision_mode() == "standard"
        r = analysis.transfer_function(Simulation(_scene(0.1)), "u", "p")
        assert r["ok"] is True, r
        assert sp.sympify(r["expression"]).atoms(sp.Float) != set(), "standard 模式应允许二进制浮点"
    finally:
        analysis.set_numeric_precision_mode("exact")
    assert analysis.numeric_precision_mode() == "exact"
    r2 = analysis.transfer_function(Simulation(_scene(0.1)), "u", "p")
    assert sp.sympify(r2["expression"]).atoms(sp.Float) == set(), "exact 模式不得残留浮点"


def test_digits_bounds_and_settings_roundtrip(monkeypatch, tmp_path):
    monkeypatch.setenv("NETLAB_SETTINGS_DIR", str(tmp_path))
    saved = save_settings({"numeric_display_digits": 12, "numeric_precision": "standard"})
    assert saved["numeric_display_digits"] == 12 and saved["numeric_precision"] == "standard"
    assert load_settings()["numeric_display_digits"] == 12
    for bad in (2, 18):
        with pytest.raises(Exception):
            save_settings({"numeric_display_digits": bad})
    with pytest.raises(Exception):
        save_settings({"numeric_precision": "weird"})
