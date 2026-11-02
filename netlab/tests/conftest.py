"""Make the ``netlab`` package importable when pytest runs inside the project."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


@pytest.fixture()
def client():
    """进程内 HTTP 客户端；每个测试都回到原始信号链场景。"""
    from fastapi.testclient import TestClient

    from netlab.server import app
    from netlab.core.model.templates import build_template

    with TestClient(app) as test_client:
        test_client.post("/api/control", json={"action": "pause"})
        payload = build_template("signal_chain")
        payload["blocks"] = []  # 块定义在场景间持久，测试间必须清掉
        test_client.post("/api/scene", json=payload)
        yield test_client
