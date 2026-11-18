"""工程导入事务：FEM 配置在提交失败时必须恢复。"""

from __future__ import annotations

import pytest

from netlab.server_project import apply_project
from netlab.server_project import _fem, _service  # noqa: F401 - 仅为类型提示


class _FakeFem:
    def __init__(self) -> None:
        self.config = {"nx": 32, "ny": 16, "dt": 0.01}
        self.calls: list[dict] = []

    def snapshot(self, include_mesh: bool = True) -> dict:
        return {"config": dict(self.config), "mesh": None}

    def apply_config(self, payload: dict) -> dict:
        self.calls.append(dict(payload))
        self.config.update(payload)
        return dict(self.config)


class _FailingService:
    def load_project(self, *args, **kwargs):
        raise RuntimeError("commit boom")


def test_project_import_restores_fem_config_when_commit_fails(monkeypatch):
    """S7：FEM 先于网络提交，网络提交失败不能留下新 FEM 配置。"""
    fake_fem = _FakeFem()
    monkeypatch.setattr("netlab.server_project._fem", fake_fem)
    monkeypatch.setattr("netlab.server_project._service", _FailingService())
    monkeypatch.setattr(
        "netlab.server_project.validate_project", lambda project, **kwargs: project
    )

    with pytest.raises(RuntimeError, match="commit boom"):
        apply_project({"fem": {"nx": 64}}, trust_extensions=False)

    assert fake_fem.config == {"nx": 32, "ny": 16, "dt": 0.01}
    assert fake_fem.calls == [
        {"nx": 64},
        {"nx": 32, "ny": 16, "dt": 0.01},
    ]
