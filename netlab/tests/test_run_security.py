"""独立启动入口的 host/token 安全策略。"""

from __future__ import annotations

import socket
import sys
import types

import pytest

from netlab import run


@pytest.mark.parametrize(
    "host",
    ["127.0.0.1", "localhost", "::1", "127.1.2.3"],
)
def test_loopback_hosts_are_recognized(host):
    assert run.is_loopback_host(host)
    assert run.validate_security(host, None, False) is None


@pytest.mark.parametrize("host", ["0.0.0.0", "::", "192.168.1.10", "example.test"])
def test_non_loopback_requires_token_or_explicit_unsafe(host):
    assert not run.is_loopback_host(host)
    assert run.validate_security(host, None, False)
    assert run.validate_security(host, "s3cret-token", False) is None
    assert run.validate_security(host, None, True) is None


def test_cli_rejects_non_loopback_without_token(capsys, monkeypatch):
    monkeypatch.setattr(sys, "argv", ["netlab.run", "--host", "0.0.0.0", "--port", "1"])
    assert run.main() == 2
    err = capsys.readouterr().err
    assert "拒绝启动" in err
    assert "--unsafe-no-auth" in err


def test_cli_unsafe_warns_and_starts_without_binding(capsys, monkeypatch):
    class _DummyServer:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    fake_uvicorn = types.SimpleNamespace(run=lambda *args, **kwargs: None)
    monkeypatch.setattr(socket, "create_server", lambda *args, **kwargs: _DummyServer())
    monkeypatch.setitem(sys.modules, "uvicorn", fake_uvicorn)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "netlab.run",
            "--host",
            "0.0.0.0",
            "--port",
            "1",
            "--no-browser",
            "--unsafe-no-auth",
        ],
    )
    assert run.main() == 0
    err = capsys.readouterr().err
    assert "警告" in err
    assert "--unsafe-no-auth" in err