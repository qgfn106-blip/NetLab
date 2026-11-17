"""扩展导入事务：失败回滚、成功单次提交、重复导入幂等。"""

from __future__ import annotations

import hashlib
import logging

import pytest

from netlab.core.compute.computes import COMPUTE_SPECS
from netlab.core.compute.methods import METHOD_SPECS
from netlab.core.model import extensions
from netlab.core.model.project import compute_checksum, migrate_project

NODE_CODE = """
@node(
    kind="user.tx_gain",
    label="事务增益",
    params=[Param("gain", "增益", "float", 2.0)],
    outputs=("voltage",),
)
def compute(ctx):
    return {"voltage": float(ctx.params["gain"])}
"""


@pytest.fixture(autouse=True)
def _clean_extensions():
    extensions.reset()
    yield
    extensions.reset()


def _extension_project(client, *, code: str = NODE_CODE) -> dict:
    project = client.post("/api/project/export", json={}).json()["project"]
    project = migrate_project(project)
    project["extensions"] = [
        {
            "kind": "user.tx_gain",
            "type": "node",
            "code": code,
            "sha256": hashlib.sha256(code.encode("utf-8")).hexdigest(),
        }
    ]
    project["checksum"] = compute_checksum(project)
    return project


def _spec_meta(spec) -> tuple:
    return (
        spec.kind,
        spec.label,
        spec.group,
        spec.description,
        spec.params,
        spec.outputs,
        spec.notes,
        getattr(spec, "formula", ""),
        spec.editable,
        spec.builtin,
        getattr(spec, "addable", None),
    )


def _registry_snapshot() -> tuple[dict, dict, set[str]]:
    return (
        {kind: _spec_meta(spec) for kind, spec in COMPUTE_SPECS.items()},
        {kind: _spec_meta(spec) for kind, spec in METHOD_SPECS.items()},
        set(extensions.used_kinds()),
    )


def test_extension_import_success_commits_once(client, caplog):
    caplog.set_level(logging.INFO, logger="netlab.server_project")
    project = _extension_project(client)
    before = _registry_snapshot()
    response = client.post(
        "/api/project/import",
        json={"project": project, "trust_extensions": True},
    )
    assert response.status_code == 200, response.text
    assert "user.tx_gain" in COMPUTE_SPECS
    assert "user.tx_gain" in extensions.used_kinds()
    assert before[2] == set()
    commits = [
        record
        for record in caplog.records
        if "project import committed" in record.getMessage()
    ]
    assert len(commits) == 1


def test_extension_import_validate_failure_rolls_back_registry(client, caplog):
    caplog.set_level(logging.WARNING, logger="netlab.server_project")
    project = _extension_project(client)
    project["checksum"] = "0" * 64
    before = _registry_snapshot()
    response = client.post(
        "/api/project/import",
        json={"project": project, "trust_extensions": True},
    )
    assert response.status_code in (400, 422), response.text
    assert _registry_snapshot() == before
    assert "user.tx_gain" not in extensions.used_kinds()
    assert any(
        "stage=validate" in record.getMessage() for record in caplog.records
    )


def test_extension_import_activation_failure_rolls_back_registry(client, caplog):
    caplog.set_level(logging.WARNING, logger="netlab.server_project")
    project = _extension_project(client, code="x = 1\n")
    before = _registry_snapshot()
    response = client.post(
        "/api/project/import",
        json={"project": project, "trust_extensions": True},
    )
    assert response.status_code in (400, 422), response.text
    assert _registry_snapshot() == before
    assert any(
        "stage=activate" in record.getMessage() for record in caplog.records
    )


def test_extension_import_is_idempotent(client):
    project = _extension_project(client)
    first = client.post(
        "/api/project/import",
        json={"project": project, "trust_extensions": True},
    )
    assert first.status_code == 200, first.text
    after_first = _registry_snapshot()
    second = client.post(
        "/api/project/import",
        json={"project": project, "trust_extensions": True},
    )
    assert second.status_code == 200, second.text
    assert _registry_snapshot() == after_first
    assert extensions.used_kinds() == {"user.tx_gain"}


def test_registry_transaction_restores_on_nested_error():
    extensions.activate_code(NODE_CODE, filename="<before>")
    before = _registry_snapshot()
    try:
        with extensions.registry_transaction():
            extensions.activate_code(
                NODE_CODE.replace("user.tx_gain", "user.tx_gain2"),
                filename="<inside>",
            )
            raise RuntimeError("boom")
    except RuntimeError:
        pass
    else:  # pragma: no cover
        raise AssertionError("expected RuntimeError")
    assert _registry_snapshot() == before
    assert "user.tx_gain2" not in extensions.used_kinds()
