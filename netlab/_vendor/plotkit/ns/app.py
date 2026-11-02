"""NS 涡旋可视化应用入口：`python -m plotkit.ns.app [--port 8760] [--shot out.png]`。

页面是纯静态的 `static/ns.html` + `static/nsview.js`，数据全部走 `/api/ns/*`
（二进制帧，见 `plotkit.server.ns_app`）。`--shot` 会开一个 pywebview 窗口，
等页面渲染完成后截一张 PNG 再退出——用于自动核对渲染结果。
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse

from ..server.ns_app import router

STATIC = Path(__file__).resolve().parent.parent / "static"

__all__ = ["create_app", "main"]


def create_app() -> FastAPI:
    app = FastAPI(title="PlotKit · NS vortex", docs_url=None, redoc_url=None)
    app.include_router(router)

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(STATIC / "ns.html", media_type="text/html")

    @app.get("/nsview.js")
    def nsview() -> FileResponse:
        return FileResponse(STATIC / "nsview.js", media_type="application/javascript")

    return app


def _serve(port: int, app=None) -> tuple[object, threading.Thread, int]:
    import uvicorn

    app = app if app is not None else create_app()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 20
    while time.time() < deadline and not server.started:
        time.sleep(0.05)
    return server, thread, config.port


def _shoot_figure(url: str, args) -> int:
    """主查看器截图：点「3D」→ 等渲染 → 抓 #plot3d。"""
    import base64

    import webview

    win = webview.create_window("NS vortex (figure)", url, width=args.width,
                                height=args.height, background_color="#0f1216")
    result: dict = {}

    def work() -> None:
        time.sleep(max(2.0, args.seconds * 0.4))
        try:
            win.evaluate_js("document.getElementById('btn-3d').click()")
        except Exception as exc:  # noqa: BLE001
            result["click_error"] = str(exc)[:120]
        time.sleep(max(2.0, args.seconds * 0.6))
        try:
            data = win.evaluate_js("document.getElementById('plot3d').toDataURL('image/png')")
            if data and "," in data:
                blob = base64.b64decode(data.split(",", 1)[1])
                Path(args.shot).write_bytes(blob)
                result["bytes"] = len(blob)
            result["err"] = win.evaluate_js("window.__err || null")
            result["hud"] = win.evaluate_js(
                "(document.getElementById('plot3d-hud')||{}).textContent || ''")
        except Exception as exc:  # noqa: BLE001
            result["error"] = str(exc)[:200]
        win.destroy()

    threading.Thread(target=work, daemon=True).start()
    webview.start(gui="edgechromium", private_mode=True,
                  storage_path=str(Path.home() / f".pk-nsfig-{int(time.time())}"))
    print(json.dumps(result, ensure_ascii=True), flush=True)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="NS 涡旋三维可视化")
    parser.add_argument("--port", type=int, default=8760)
    parser.add_argument("--shot", type=str, default="", help="截图到该 PNG 后退出")
    parser.add_argument("--seconds", type=float, default=6.0, help="截图前等待秒数")
    parser.add_argument("--t", type=float, default=None, help="打开时停在某个物理时间 t（0..1）")
    parser.add_argument("--source", choices=("analytic", "solver"), default="analytic",
                        help="analytic=解析场 A′；solver=数值解 B（首次约 15 s）")
    parser.add_argument("--particles", type=int, default=0, help="粒子数（0 = 用页面默认值）")
    parser.add_argument("--gpu", action="store_true", help="启用 GPU 粒子推进（实验）")
    parser.add_argument("--phys", type=str, default="", help="物理量旋钮 Γ,a,r_core")
    parser.add_argument("--gf", action="store_true", help="冻结 GPU advect（只渲染初始位置，诊断用）")
    parser.add_argument("--figure", action="store_true",
                        help="用主查看器打开（Figure/spec 路径，三维图层直绘）")
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=820)
    args = parser.parse_args(argv)

    if args.figure:
        from ..server.app import create_app as main_app

        from . import scene

        physical = None
        if args.phys:
            from .field import PhysicalParams

            g, a, rc = (float(v) for v in args.phys.split(","))
            physical = PhysicalParams(gamma=g, a=a, r_core=rc)
        fig = scene.figure(t=(args.t if args.t is not None else 0.05),
                           physical=physical, particles=args.particles or 12000)
        server, _, port = _serve(args.port, main_app(fig, title="NS vortex · PlotKit"))
        url = f"http://127.0.0.1:{port}/"
        print(f"[ns] figure mode serving {url}", flush=True)
        if not args.shot:
            try:
                while True:
                    time.sleep(1.0)
            except KeyboardInterrupt:
                pass
            return 0
        return _shoot_figure(url, args)

    server, _, port = _serve(args.port)
    query = []
    if args.t is not None:
        query.append(f"t={args.t}")
    if args.particles:
        query.append(f"particles={args.particles}")
    if args.gpu:
        query.append("gpu=1")
    if args.gf:
        query.append("gf=1")
    if args.phys:
        query.append("phys=" + args.phys)
    if args.source != "analytic":
        query.append(f"source={args.source}")
    url = f"http://127.0.0.1:{port}/" + (("?" + "&".join(query)) if query else "")
    print(f"[ns] serving {url}", flush=True)

    if not args.shot:
        try:
            while True:
                time.sleep(1.0)
        except KeyboardInterrupt:
            pass
        return 0

    import base64

    import webview

    result: dict = {}
    window = webview.create_window("NS vortex", url, width=args.width, height=args.height,
                                   hidden=False, background_color="#05070b")

    def shoot() -> None:
        time.sleep(args.seconds)
        try:
            info = window.evaluate_js(
                "JSON.stringify({err: window.__nsErr || null,"
                " fps: (window.__ns && window.__ns.view.stats.fps) || 0,"
                " t: (window.__ns && window.__ns.S.t) || 0})")
            result["info"] = json.loads(info) if info else None
            data = window.evaluate_js("document.getElementById('gl').toDataURL('image/png')")
            if data and "," in data:
                blob = base64.b64decode(data.split(",", 1)[1])
                Path(args.shot).write_bytes(blob)
                result["bytes"] = len(blob)
            result["probe"] = json.loads(window.evaluate_js(
                "(() => { const v = window.__ns.view; const gl = v.gl;"
                " const px = new Uint8Array(4 * 4 * 4);"
                " gl.readPixels(Math.floor(gl.drawingBufferWidth*0.48), Math.floor(gl.drawingBufferHeight*0.5), 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, px);"
                " const ext = gl.getExtension('EXT_color_buffer_float');"
                " let fb = 'none';"
                " if (v.gpu) { gl.bindFramebuffer(gl.FRAMEBUFFER, v.gpu.fbo[v.gpu.cur]);"
                "   fb = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE ? 'complete' : 'INCOMPLETE';"
                "   gl.bindFramebuffer(gl.FRAMEBUFFER, null); }"
                " return JSON.stringify({particles: v.particles ? v.particles.count : 0,"
                " vel: !!v.vel, tex: !!v.tex, center: Array.from(px.slice(0,8)),"
                " gpu: !!v.gpu, gpuErr: v.gpuError || '', floatFBO: !!ext, fb: fb, glErr: gl.getError(),"
                " pt: {ok: v.pointsGpuOk === true, log: (v.pointsGpuLog||'').slice(0,120), err: v._ptErr, drawn: v._ptDrawn, loc: v._ptLoc},"
                " g: v.gpu ? {count: v.gpu.count, rows: v.gpu.rows, W: v.gpu.W, K: v.gpu.K, pcount: v.particles ? v.particles.count : null, posLen: v.particles ? v.particles.pos.length : null, tail: v.particles ? Array.from(v.particles.pos.slice(-3)).map(x => +(+x).toFixed(3)) : null} : null,"
                " tailPos: (function(){ if (!v.gpu) return null; const g = v.gpu; const a = new Float32Array(4); gl.readPixels(0, g.rows - 2, 1, 1, gl.RGBA, gl.FLOAT, a); return Array.from(a).map(x => (+x).toFixed(4)); })(),"
                " firstPos: (function(){ if (!v.gpu) return null; const a = new Float32Array(4);"
                "   gl.bindFramebuffer(gl.FRAMEBUFFER, v.gpu.fbo[v.gpu.cur]);"
                "   gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, a);"
                "   gl.bindFramebuffer(gl.FRAMEBUFFER, null); return Array.from(a); })(),"
                " extent: v.extent, vmin: v.vmin, vmax: v.vmax}); })()"))
            result["overlay"] = json.loads(window.evaluate_js(
                "JSON.stringify({tau: document.getElementById('tau').textContent,"
                " diag: document.getElementById('diag').innerText.replace(/\s+/g,' ').slice(0,200),"
                " formulas: document.querySelectorAll('#fsvg').length,"
                " legend: !!document.getElementById('legend')})"))
        except Exception as exc:  # pragma: no cover
            result["error"] = f"{type(exc).__name__}: {exc}"
        finally:
            try:
                window.destroy()
            except Exception:
                pass

    threading.Thread(target=shoot, daemon=True).start()
    webview.start(gui="edgechromium")
    try:
        server.should_exit = True
    except Exception:
        pass
    print(json.dumps(result, ensure_ascii=True), flush=True)
    return 0 if result.get("bytes") else 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main(sys.argv[1:]))
