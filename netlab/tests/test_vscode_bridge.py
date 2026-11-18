"""VS Code Server 桥接：连接 token、不复用外部服务器、URL 与命令构造。"""

from __future__ import annotations

from pathlib import Path
from urllib.error import HTTPError

import pytest

from netlab import vscode_bridge as bridge


class _FakeProc:
    returncode = None

    def __init__(self) -> None:
        self.terminated = False
        self.waited = False

    def poll(self):
        return self.returncode

    def terminate(self) -> None:
        self.terminated = True

    def wait(self, timeout=None) -> int:
        self.waited = True
        return 0


@pytest.fixture(autouse=True)
def _reset_bridge(monkeypatch):
    bridge._cleanup_token_file()
    bridge._proc = None
    bridge._port = None
    bridge._error = None
    bridge._log_path = None
    yield
    bridge._proc = None
    bridge._port = None
    bridge._cleanup_token_file()


def _prepare_start(monkeypatch, tmp_path: Path):
    server = tmp_path / "server"
    (server / "out").mkdir(parents=True)
    (server / "out" / "server-main.js").write_text("// fake", encoding="utf-8")
    monkeypatch.setattr(bridge, "find_server_dir", lambda: server)
    monkeypatch.setattr(bridge, "_node_exec", lambda _dir: "node")
    monkeypatch.setattr(bridge, "_install_bundled_extensions", lambda *_a: None)
    monkeypatch.setattr(bridge, "_bindable", lambda _port: True)
    monkeypatch.setattr(bridge, "_default_folder", lambda: tmp_path)
    monkeypatch.setattr(bridge, "_serves", lambda _port, _token=None: True)
    fake = _FakeProc()
    captured: dict[str, object] = {}

    def fake_popen(cmd, **kwargs):
        captured["cmd"] = list(cmd)
        captured["kwargs"] = kwargs
        return fake

    monkeypatch.setattr(bridge.subprocess, "Popen", fake_popen)
    return server, fake, captured


def test_start_uses_random_connection_token(monkeypatch, tmp_path):
    _server, fake, captured = _prepare_start(monkeypatch, tmp_path)

    info = bridge.start()

    try:
        assert info["running"] is True
        assert info["port"] == bridge._DEFAULT_PORT
        token = bridge._token
        assert token and len(token) >= 32
        assert info["url"] == f"http://127.0.0.1:{bridge._DEFAULT_PORT}/code/?tkn={token}"
        cmd = captured["cmd"]
        assert "--without-connection-token" not in cmd
        index = cmd.index("--connection-token-file")
        token_file = Path(cmd[index + 1])
        assert token_file == bridge._token_file
        assert token_file.read_text(encoding="utf-8") == token
        assert cmd[cmd.index("--host") + 1] == "127.0.0.1"
    finally:
        bridge.shutdown()

    assert fake.terminated and fake.waited
    assert bridge._token is None
    assert bridge._token_file is None


def test_start_does_not_reuse_server_already_on_preferred_port(monkeypatch, tmp_path):
    _server, _fake, captured = _prepare_start(monkeypatch, tmp_path)
    monkeypatch.setattr(bridge, "_bindable", lambda _port: False)
    monkeypatch.setattr(bridge, "_free_port", lambda: 8791)
    probes: list[tuple[int, str | None]] = []

    def fake_serves(port, token=None):
        probes.append((port, token))
        return True

    monkeypatch.setattr(bridge, "_serves", fake_serves)

    info = bridge.start()
    try:
        assert info["port"] == 8791
        assert captured["cmd"][captured["cmd"].index("--port") + 1] == "8791"
        # 只允许拉起后的就绪探测；拉起前不得探测/复用已有服务器。
        assert probes == [(8791, bridge._token)]
    finally:
        bridge.shutdown()


def test_serves_probe_uses_query_token(monkeypatch):
    urls: list[str] = []

    class _Response:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    def fake_urlopen(url, timeout=None):
        urls.append(url)
        return _Response()

    monkeypatch.setattr(bridge, "urlopen", fake_urlopen)
    assert bridge._serves(8790) is True
    assert bridge._serves(8790, "abc-_123") is True
    assert urls == [
        "http://127.0.0.1:8790/code/",
        "http://127.0.0.1:8790/code/?tkn=abc-_123",
    ]


def test_serves_rejects_unauthorized_probe(monkeypatch):
    def fake_urlopen(url, timeout=None):
        raise HTTPError(url, 403, "Forbidden", {}, None)

    monkeypatch.setattr(bridge, "urlopen", fake_urlopen)
    assert bridge._serves(8790) is False
    assert bridge._serves(8790, "token") is False
