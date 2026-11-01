"""像素对比工具（spec S3 / 票 04）：给"换框架不改外观"一把尺子。

用法::

    python -m netlab.ui.pixeldiff capture out.png --template signal_chain
    python -m netlab.ui.pixeldiff compare a.png b.png --tolerance 6

``capture`` 用离屏方式渲染一个固定场景并 ``QWidget.grab()``；``compare``
返回不一致像素占比与 RMS，超过阈值时退出码为 1，方便挂进 CI。
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass


@dataclass(frozen=True)
class DiffResult:
    width: int
    height: int
    mismatched: int
    total: int
    ratio: float
    rms: float

    @property
    def ok(self) -> bool:
        return self.ratio <= 0.0 and self.rms <= 0.0


def compare_images(a, b, *, tolerance: int = 0) -> DiffResult:
    """逐像素比较两张 QImage；``tolerance`` 为单通道允许误差（0–255）。"""
    if a.width() != b.width() or a.height() != b.height():
        return DiffResult(a.width(), a.height(), a.width() * a.height(), a.width() * a.height(), 1.0, 255.0)
    a = a.convertToFormat(a.format())
    b = b.convertToFormat(a.format())
    width, height = a.width(), a.height()
    mismatched = 0
    total = width * height
    square = 0
    for y in range(height):
        for x in range(width):
            ca = a.pixelColor(x, y)
            cb = b.pixelColor(x, y)
            delta = max(
                abs(ca.red() - cb.red()),
                abs(ca.green() - cb.green()),
                abs(ca.blue() - cb.blue()),
                abs(ca.alpha() - cb.alpha()),
            )
            square += delta * delta
            if delta > tolerance:
                mismatched += 1
    rms = (square / max(1, total)) ** 0.5
    return DiffResult(width, height, mismatched, total, mismatched / max(1, total), rms)


def capture(path: str, *, template: str = "signal_chain", theme: str = "light", size=(1400, 900)) -> int:
    from PySide6.QtWidgets import QApplication

    from ..server import SERVICE
    from ..templates import build_template
    from .shell import MainWindow

    app = QApplication.instance() or QApplication([])
    if template:
        SERVICE.load_scene(build_template(template))
    window = MainWindow(SERVICE, theme=theme)
    window.resize(*size)
    window.show()
    app.processEvents()
    window.canvas.fit()
    for _ in range(6):
        app.processEvents()
    image = window.grab()
    ok = image.save(path)
    window.bridge.stop_live()
    window.close()
    app.processEvents()
    return 0 if ok else 2


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="netlab-pixeldiff")
    sub = parser.add_subparsers(dest="command", required=True)

    cap = sub.add_parser("capture", help="渲染固定场景并保存 PNG")
    cap.add_argument("out")
    cap.add_argument("--template", default="signal_chain")
    cap.add_argument("--theme", default="light", choices=["light", "dark"])

    cmp_parser = sub.add_parser("compare", help="比较两张 PNG")
    cmp_parser.add_argument("a")
    cmp_parser.add_argument("b")
    cmp_parser.add_argument("--tolerance", type=int, default=0)
    cmp_parser.add_argument("--max-ratio", type=float, default=0.0)

    args = parser.parse_args(argv)
    if args.command == "capture":
        return capture(args.out, template=args.template, theme=args.theme)

    from PySide6.QtGui import QImage

    image_a = QImage(args.a)
    image_b = QImage(args.b)
    if image_a.isNull() or image_b.isNull():
        print("无法读取图片", file=sys.stderr)
        return 2
    result = compare_images(image_a, image_b, tolerance=args.tolerance)
    print(
        f"{result.width}x{result.height} 不一致 {result.mismatched}/{result.total} "
        f"({result.ratio * 100:.3f}%) RMS {result.rms:.3f}"
    )
    return 0 if result.ratio <= args.max_ratio else 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
