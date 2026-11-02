"""core.common.fastcopy: 与 deepcopy 语义等价（含可变对象隔离）。"""
from __future__ import annotations

import copy

import numpy as np

from netlab.core.common.fastcopy import copy_state


def test_scalars_are_reused():
    state = {"a": 1, "b": 2.5, "c": True, "d": "x", "e": None, "f": 1 + 2j}
    assert copy_state(state) == state
    assert copy_state(state) is not state


def test_nested_containers_are_copied():
    state = {"list": [1, 2, [3]], "dict": {"inner": {"v": 1.0}}, "tuple": (1, (2, 3))}
    out = copy_state(state)
    assert out == state
    out["list"].append(9)
    out["dict"]["inner"]["v"] = 2.0
    assert state["list"] == [1, 2, [3]]
    assert state["dict"]["inner"]["v"] == 1.0


def test_numpy_arrays_are_copied():
    arr = np.arange(4.0)
    out = copy_state({"x": arr, "scale": np.float64(1.5)})
    assert out["scale"] == 1.5
    out["x"][0] = 99.0
    assert arr[0] == 0.0


def test_unknown_objects_fall_back_to_deepcopy():
    class Box:
        def __init__(self, v):
            self.v = v

    box = Box([1, 2])
    out = copy_state({"box": box})
    assert out["box"] is not box
    out["box"].v.append(3)
    assert box.v == [1, 2]


def test_matches_deepcopy_on_mixed_state():
    state = {"s": 1.0, "l": [1, {"k": np.array([1.0, 2.0])}], "t": ("a", 2)}
    out = copy_state(state)
    ref = copy.deepcopy(state)
    assert out["s"] == ref["s"] and out["t"] == ref["t"]
    assert out["l"][0] == 1
    assert np.array_equal(out["l"][1]["k"], ref["l"][1]["k"])
