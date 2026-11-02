"""`plotkit` 命令行：装完先跑 `plotkit doctor`。

子命令：
- `plotkit doctor [--json]`  体检：Python/依赖版本、可选功能是否可用、已知不兼容
- `plotkit version`          打印版本
- `plotkit where`            打印包路径（排查"装到哪个 Python 去了"）
- `plotkit demo [--port]`    起一个带示例图的本地服务
- `plotkit ns [--port]`      起 NS 涡旋可视化页面
- `plotkit uninstall [--yes]` 清理缓存目录并提示卸载命令
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from ._compat import MIN_VERSIONS, versions

__all__ = ["main", "doctor_report", "cache_dirs"]

#: 运行时写出来的目录（`pip uninstall` 不会动它们）
CACHE_SUBDIRS = (".plotkit-desktop", ".plotkit")


def cache_dirs() -> list[Path]:
    home = Path.home()
    return [home / name for name in CACHE_SUBDIRS]


def _version_tuple(text: str) -> tuple[int, ...]:
    parts: list[int] = []
    for chunk in str(text).replace("-", ".").split("."):
        digits = "".join(ch for ch in chunk if ch.isdigit())
        if not digits:
            break
        parts.append(int(digits))
    return tuple(parts)


def doctor_report() -> dict:
    """收集体检结果；纯函数，方便测试。"""
    env = versions()
    rows = {}
    problems: list[str] = []

    for name, minimum in MIN_VERSIONS.items():
        have = env.get(name, "missing")
        if name == "python":
            have = env["python"]
        ok = have != "missing" and _version_tuple(have)[: len(minimum)] >= minimum
        rows[name] = {
            "have": have,
            "need": ".".join(str(x) for x in minimum),
            "ok": bool(ok),
        }
        if not ok:
            problems.append(f"{name} {have} < 需要 {'.'.join(map(str, minimum))}")

    optional = {}
    for feature, deps in (
        ("web", ("fastapi", "uvicorn")),
        ("three", ("pyvista", "vtk")),
        ("desktop", ("pywebview",)),
    ):
        missing = [d for d in deps if env.get(d, "missing") == "missing"]
        optional[feature] = {"ok": not missing, "missing": missing}

    # 已知坑：matplotlib 3.9 删了 cm.get_cmap；本包已用 _compat 兜住，
    # 但用户自己写的脚本仍可能踩，所以体检里显式提示一句。
    try:
        import matplotlib

        if _version_tuple(matplotlib.__version__) >= (3, 9):
            notes = "matplotlib>=3.9 已删除 cm.get_cmap()，外部脚本请改用 matplotlib.colormaps[...]"
        else:
            notes = ""
    except Exception:  # noqa: BLE001
        notes = ""

    return {
        "ok": not problems,
        "versions": env,
        "requirements": rows,
        "optional": optional,
        "notes": notes,
        "problems": problems,
    }


def _print_report(report: dict) -> None:
    print(f"python   {report['versions']['python']}   ({report['versions']['executable']})")
    for name in ("numpy", "matplotlib", "pillow", "fastapi", "uvicorn", "pyvista", "vtk", "pywebview"):
        row = report["requirements"].get(name)
        have = report["versions"].get(name, "missing")
        if row is None:
            print(f"{name:<9}{have}")
        else:
            print(f"{name:<9}{have:<12}需要 >= {row['need']:<6}{'OK' if row['ok'] else '不满足'}")
    for feature, info in report["optional"].items():
        state = "可用" if info["ok"] else "缺少 " + ", ".join(info["missing"])
        print(f"[{feature:<7}] {state}")
    if report["notes"]:
        print("注意：" + report["notes"])
    print("结论：" + ("环境满足要求" if report["ok"] else "；".join(report["problems"])))


def _cmd_doctor(args: argparse.Namespace) -> int:
    report = doctor_report()
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        _print_report(report)
    return 0 if report["ok"] else 1


def _cmd_version(_: argparse.Namespace) -> int:
    from . import __version__

    print(f"plotkit {__version__}")
    return 0


def _cmd_where(_: argparse.Namespace) -> int:
    import plotkit

    print(plotkit.__file__)
    return 0


def _cmd_demo(args: argparse.Namespace) -> int:
    import numpy as np

    import plotkit as pk
    from plotkit.server import app as server_app

    t = np.linspace(0, 10, 2000)
    fig = pk.figure(size=(8, 4.5), dpi=110, title="PlotKit demo")
    fig.add_data("t", t, role="coord")
    for i in range(3):
        fig.add_data(f"y{i}", np.sin(t + i), role="series")
        fig.add_plot(x="t", y=f"y{i}")
    app = server_app.create_app(fig, title="PlotKit demo")
    print(f"[plotkit] demo on http://{args.host}:{args.port}/")
    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
    return 0


def _cmd_ns(args: argparse.Namespace) -> int:
    from plotkit.ns import app as ns_app

    argv = ["--port", str(args.port)]
    if args.shot:
        argv += ["--shot", args.shot, "--seconds", str(args.seconds)]
    return ns_app.main(argv)


def _cmd_uninstall(args: argparse.Namespace) -> int:
    existing = [p for p in cache_dirs() if p.exists()]
    for path in existing:
        print(f"缓存目录：{path}")
        if args.yes:
            shutil.rmtree(path, ignore_errors=True)
            print("  已删除")
        else:
            print("  保留（加 --yes 删除）")
    print("卸载包本体：")
    print(f"  {Path(sys.executable).name} -m pip uninstall -y plotkit")
    print("（可编辑安装 `pip install -e .` 则在同一环境下卸载即可）")
    return 0


def post_batch(client, payload: dict) -> bytes:
    """把批量渲染请求发给 `client`（httpx.Client 或 TestClient 都行），返回 zip 字节。"""
    res = client.post("/api/render3d/batch", json=payload)
    if res.status_code != 200:
        raise RuntimeError(f"批量渲染失败：HTTP {res.status_code} {res.text[:200]}")
    return res.content


def _cmd_render3d(args) -> int:
    """把一份 frames.json 发给正在运行的 PlotKit 服务，存成 zip。"""
    import json

    payload = json.loads(Path(args.payload).read_text(encoding="utf-8"))
    if args.width:
        payload["width"] = int(args.width)
    if args.height:
        payload["height"] = int(args.height)
    if args.workers:
        payload["workers"] = int(args.workers)

    import httpx

    with httpx.Client(base_url=args.url.rstrip("/"), timeout=900.0) as client:
        data = post_batch(client, payload)
    out = Path(args.out)
    out.write_bytes(data)
    print(json.dumps({"out": str(out), "bytes": len(data)}, ensure_ascii=True))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="plotkit", description="PlotKit 命令行")
    sub = parser.add_subparsers(dest="command")

    p_doctor = sub.add_parser("doctor", help="检查安装与依赖是否满足要求")
    p_doctor.add_argument("--json", action="store_true", help="输出 JSON")
    p_doctor.set_defaults(func=_cmd_doctor)

    sub.add_parser("version", help="打印版本").set_defaults(func=_cmd_version)
    sub.add_parser("where", help="打印包安装路径").set_defaults(func=_cmd_where)

    p_demo = sub.add_parser("demo", help="起一个示例服务")
    p_demo.add_argument("--host", default="127.0.0.1")
    p_demo.add_argument("--port", type=int, default=8750)
    p_demo.set_defaults(func=_cmd_demo)

    p_ns = sub.add_parser("ns", help="起 NS 涡旋可视化")
    p_ns.add_argument("--port", type=int, default=8760)
    p_ns.add_argument("--shot", default=None, help="截图到文件后退出")
    p_ns.add_argument("--seconds", type=float, default=8.0)
    p_ns.set_defaults(func=_cmd_ns)

    p_r3 = sub.add_parser("render3d", help="批量渲染三维帧（发给运行中的服务）")
    p_r3.add_argument("--payload", required=True, help="frames.json：{frames:[{spec:...}], data:{...}}")
    p_r3.add_argument("--out", default="frames.zip", help="输出 zip 路径")
    p_r3.add_argument("--url", default="http://127.0.0.1:8750", help="PlotKit 服务地址")
    p_r3.add_argument("--width", type=int, default=0)
    p_r3.add_argument("--height", type=int, default=0)
    p_r3.add_argument("--workers", type=int, default=0)
    p_r3.set_defaults(func=_cmd_render3d)

    p_un = sub.add_parser("uninstall", help="清理缓存目录并提示卸载命令")
    p_un.add_argument("--yes", action="store_true", help="真的删除缓存目录")
    p_un.set_defaults(func=_cmd_uninstall)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "func", None):
        parser.print_help()
        return 2
    return int(args.func(args))


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
