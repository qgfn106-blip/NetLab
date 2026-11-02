"""用离屏 QtWebEngine 截图验证前端（含 PlotKit 三形态）。

用法：python tools/shot_ui.py <url> <out.png> [--click btnPlotkitInline] [--wait 6000]
"""
import os, sys, json
os.environ.setdefault("QTWEBENGINE_CHROMIUM_FLAGS", "--disable-gpu --no-proxy-server --no-sandbox")
os.environ.setdefault("QTWEBENGINE_DISABLE_SANDBOX", "1")

from PySide6.QtCore import QTimer, QUrl, QSize
from PySide6.QtWidgets import QApplication
from PySide6.QtWebEngineWidgets import QWebEngineView

def main():
    url = sys.argv[1]; out = sys.argv[2]
    click = None; wait = 6000
    if "--click" in sys.argv: click = sys.argv[sys.argv.index("--click")+1]
    if "--wait" in sys.argv: wait = int(sys.argv[sys.argv.index("--wait")+1])
    app = QApplication(sys.argv[:1])
    view = QWebEngineView(); view.resize(QSize(1600, 950)); view.show()
    state = {"ok": False}

    def shot():
        view.grab().save(out)
        print("saved", out)

    def after_click():
        QTimer.singleShot(3500, shot)

    def loaded(ok):
        state["ok"] = ok
        print("loadFinished", ok)
        if not ok:
            QTimer.singleShot(2000, shot); return
        if click:
            view.page().runJavaScript(
                f"document.getElementById('{click}')?.click(); 'clicked'",
                lambda r: (print("click", r), QTimer.singleShot(5000, shot)))
        else:
            QTimer.singleShot(wait, shot)

    view.loadFinished.connect(loaded)
    view.load(QUrl(url))
    QTimer.singleShot(wait + (12000 if click else 4000), app.quit)
    app.exec()

if __name__ == "__main__":
    main()
