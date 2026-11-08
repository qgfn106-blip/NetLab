"""PlotKit 面板在桌面 token 守卫开启时的请求契约。"""

from pathlib import Path

from fastapi.testclient import TestClient

from netlab import server
from netlab.core.model.templates import build_template
from netlab.server import SERVICE, app

ROOT = Path(__file__).resolve().parents[1]
APP_JS = ROOT.parent / "frontend" / "app.ts"
APP_PLOTKIT_DATA = ROOT.parent / "frontend" / "app" / "plotkit_data.ts"


def test_run_warning_precompute_uses_token_aware_helper():
    source = APP_JS.read_text(encoding="utf-8")
    start = source.index("(card!.querySelector('#runWarnPre') as HTMLElement).onclick")
    handler = source[start : start + 2600]
    assert "api('/api/plotkit/precompute'" in handler
    assert "catch (error)" in handler
    assert ".message" in handler


def test_retry_does_not_report_ready_when_channel_refresh_fails():
    source = APP_PLOTKIT_DATA.read_text(encoding="utf-8")
    refresh_start = source.index(
        "async function refreshPkChannels(keepSelection?: boolean)"
    )
    retry_start = source.index("async function retryPlotkit()", refresh_start)
    frame_start = source.index("function reloadPlotkitFrame()", retry_start)
    refresh = source[refresh_start:retry_start]
    retry = source[retry_start:frame_start]

    assert "return false;" in refresh
    assert "const refreshed = await refreshPkChannels(true);" in retry
    assert "if (!refreshed)" in retry
    assert retry.index("if (!refreshed)") < retry.index("toast('PlotKit 已就绪'")


def test_plotkit_channels_endpoint_requires_and_accepts_desktop_token(monkeypatch):
    SERVICE.load_scene(build_template("rlc_series"))
    monkeypatch.setattr(server, "_DESKTOP_TOKEN", "plotkit-regression-token")
    client = TestClient(app)

    denied = client.get("/api/plotkit/channels")
    allowed = client.get(
        "/api/plotkit/channels",
        headers={"X-Netlab-Token": "plotkit-regression-token"},
    )

    assert denied.status_code == 403
    assert allowed.status_code == 200
    assert allowed.json()["mounted"] is True
    assert allowed.json()["available"]


def test_precompute_degradation_is_surfaced_in_both_call_sites():
    """精度降级必须让用户看见，否则又变成「提高精度没反应」。

    2026-11-03：预计算曾经把任何 dt 抬成 seconds/2000，前端也只显示帧数；
    现在后端会回 requested_dt / dt_used / degraded，两个调用点都要显示它。
    """
    source = APP_PLOTKIT_DATA.read_text(encoding="utf-8")
    assert source.count("pre.degraded") >= 2
    assert "20 万步上限" in source
    assert "预计算已降级步长" in source


def test_plotkit_child_api_requires_desktop_token(monkeypatch):
    """桌面 token 守卫必须覆盖挂载进来的 PlotKit 子应用（/plotkit/api/*）。

    审计发现：守卫只看 ``/api/`` 前缀，子应用的 PUT /api/spec、POST /api/clear
    等写操作在桌面模式下完全不需要 token。
    """
    monkeypatch.setattr(server, "_DESKTOP_TOKEN", "audit-child-token")
    client = TestClient(app)

    assert client.get("/plotkit/api/spec").status_code == 403
    assert (
        client.get("/plotkit/api/spec", headers={"X-Netlab-Token": "wrong"}).status_code
        == 403
    )
    assert client.get("/plotkit/api").status_code == 403
    assert client.post("/plotkit/api/clear").status_code == 403
    # token 放查询串不算数：只认请求头，避免写进日志 / Referer
    assert client.get("/plotkit/api/spec?token=audit-child-token").status_code == 403
    assert client.get("/api/health").status_code == 200
    assert (
        client.get(
            "/plotkit/api/spec", headers={"X-Netlab-Token": "audit-child-token"}
        ).status_code
        == 200
    )


def test_plotkit_child_index_is_served_unmodified(monkeypatch):
    """S3：宿主不再向第三方首页注入任何脚本，子应用自带首页原样提供。

    旧机制在 PlotKit 首页第一个 <script> 前插宿主 shim，由 shim 从 URL 片段读
    token 再包 fetch/window.open；S3 改用宿主同源 cookie 后，这层注入必须消失。
    """
    monkeypatch.setattr(server, "_DESKTOP_TOKEN", "audit-child-token")
    client = TestClient(app)

    html = client.get("/plotkit/").text

    assert "netlab 宿主 shim" not in html
    assert "audit-child-token" not in html
    assert 'src="static/app.js"' in html
    assert html == client.get("/plotkit").text


def test_plotkit_child_api_accepts_same_origin_session_cookie(monkeypatch):
    """S3：桌面 token 改用宿主同源 cookie，子应用前端不再依赖注入的 shim。

    桌面外壳打开 ``/?token=...`` 时宿主种下 HttpOnly + SameSite=Strict 会话 cookie；
    之后 iframe 内 PlotKit 自己发的同源 ``/plotkit/api/*`` 请求会自动带上 cookie。
    """
    monkeypatch.setattr(server, "_DESKTOP_TOKEN", "audit-child-token")
    client = TestClient(app)

    page = client.get("/?token=audit-child-token")
    assert page.status_code == 200
    set_cookie = page.headers.get("set-cookie", "")
    assert "netlab_desktop_token=audit-child-token" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "SameSite=strict" in set_cookie
    # 有 cookie、无请求头：子应用 API 可用
    assert client.get("/plotkit/api/spec").status_code == 200
    # cookie 不能靠请求头以外的路径绕过：伪造 cookie 值仍然 403
    forged = TestClient(app)
    forged.cookies.set("netlab_desktop_token", "wrong")
    assert forged.get("/plotkit/api/spec").status_code == 403


def test_plotkit_child_api_stays_open_in_browser_mode(monkeypatch):
    """浏览器模式（没有桌面 token）保持原来的公开行为。"""
    monkeypatch.setattr(server, "_DESKTOP_TOKEN", None)
    client = TestClient(app)

    assert client.get("/plotkit/api/spec").status_code == 200


def test_precompute_surfaces_partial_solver_failure(monkeypatch):
    """求解中途失败会返回带 error 的部分结果，接口不能再报 ok=True。"""
    monkeypatch.setattr(
        SERVICE,
        "precompute",
        lambda seconds, dt=None: {
            "frames": 2,
            "error": "solver failed after two frames",
        },
    )
    client = TestClient(app)

    body = client.post("/api/plotkit/precompute", json={"seconds": 1.0}).json()

    assert body["ok"] is False
    assert body["error"] == "solver failed after two frames"
