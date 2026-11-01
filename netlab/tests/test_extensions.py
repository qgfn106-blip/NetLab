"""应用内 Python 扩展的最小回归：AST 拒绝、注册、执行、回滚与停用。

注意：这只是"本地可信扩展"的测试，不代表沙箱安全性。
"""

from __future__ import annotations

import pytest

from netlab import extensions
from netlab.computes import COMPUTE_SPECS, prepare_compute
from netlab.graph import ComputeContext
from netlab.limits import ValidationError

NODE_CODE = """
@node(
    kind="user.gain2",
    label="自定义增益2",
    params=[Param("gain", "增益", "float", 2.0)],
    outputs=("voltage",),
)
def compute(ctx):
    total = 0.0
    for payload in ctx.inputs.values():
        total += float(payload.get("voltage", 0.0))
    return {"voltage": float(ctx.params["gain"] * total)}
"""

METHOD_CODE = """
@method(
    kind="user.dead_zone2",
    label="死区2",
    params=[Param("deadband", "死区", "float", 0.5)],
    outputs=("voltage",),
)
def transfer(source, target, params, state, dt):
    value = float(source.data.get("voltage", 0.0))
    limit = float(params["deadband"])
    if abs(value) <= limit:
        return {"voltage": 0.0}
    return {"voltage": float(value - (limit if value > 0 else -limit))}
"""


@pytest.fixture(autouse=True)
def clean_registry():
    extensions.reset()
    yield
    extensions.reset()


def test_validate_code_reports_declarations():
    info = extensions.validate_code(NODE_CODE)
    assert info["ok"] is True
    assert info["declared"][0]["kind"] == "user.gain2"
    assert info["declared"][0]["type"] == "node"


def test_import_and_while_are_rejected():
    with pytest.raises(ValidationError, match="Import"):
        extensions.validate_code("import os\n" + NODE_CODE)
    with pytest.raises(ValidationError, match="While"):
        extensions.validate_code(
            "while True:\n    pass\n"
            + NODE_CODE.replace("def compute", "def compute2")
        )
    with pytest.raises(ValidationError, match="双下划线"):
        extensions.validate_code(NODE_CODE + "\nx = obj.__class__\n")


def test_activate_executes_and_runs():
    result = extensions.activate_code(NODE_CODE, persist=False)
    assert result["ok"] is True
    assert "user.gain2" in COMPUTE_SPECS
    _spec, params, handler = prepare_compute("user.gain2", {"gain": 3.0})
    assert handler is not None
    ctx = ComputeContext(
        name="n",
        inputs={"e1": {"voltage": 2.0}},
        data={},
        state={},
        params=params,
        dt=0.01,
        time=0.0,
    )
    assert handler(ctx) == {"voltage": 6.0}

    listed = extensions.list_extensions()
    assert [item["kind"] for item in listed] == ["user.gain2"]
    assert listed[0]["sha256"]
    assert "user.gain2" in extensions.used_kinds()


def test_method_extension_is_registered_as_method():
    extensions.activate_code(METHOD_CODE, persist=False, kind_type="method")
    from netlab.methods import METHOD_SPECS

    assert "user.dead_zone2" in METHOD_SPECS
    extensions.deactivate("user.dead_zone2")
    assert "user.dead_zone2" not in METHOD_SPECS


def test_failed_execution_rolls_back_registry():
    broken = NODE_CODE + '\nraise RuntimeError("boom")\n'
    with pytest.raises(RuntimeError):
        extensions.activate_code(broken, persist=False)
    assert "user.gain2" not in COMPUTE_SPECS
    assert extensions.list_extensions() == []


def test_deactivate_removes_kind():
    extensions.activate_code(NODE_CODE, persist=False)
    removed = extensions.deactivate("user.gain2")
    assert removed["removed"] is True
    assert "user.gain2" not in COMPUTE_SPECS
