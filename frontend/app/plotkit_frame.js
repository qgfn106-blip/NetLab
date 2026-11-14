import { api, plotkitFrameUrl } from "./net.js";
import { clampFloatWindow, placeFloatWindow, raiseFloatWindow } from "./float.js";
import { $ } from "./dom.js";
import { state } from "./state.js";
import { toast } from "./desktop.js";
let frameActions = { setStatusHint: (_text, _tone) => {
} };
function setPlotkitFrameActions(actions) {
  frameActions = actions;
}
let plotkitReady = false;
function layoutPlotkitWindow() {
  const win = $("#plotkitWin");
  if (!win) return;
  win.classList.toggle("docked", Boolean(state.plotkitDock));
  const dock = $("#plotkitDock");
  if (dock) dock.classList.toggle("on", Boolean(state.plotkitDock));
  if (!state.plotkitDock) {
    if (!win.hidden) placeFloatWindow(win, "plotkitGeo");
    return;
  }
  const stage2 = $("#graph")?.closest(".stage") || $("#graph")?.parentElement;
  const rect = stage2?.getBoundingClientRect();
  if (!rect || rect.width < 240) return;
  const width = Math.max(560, Math.round(rect.width * 0.72));
  const height = Math.max(320, Math.round(rect.height * 0.78));
  win.style.left = `${Math.round(rect.left + rect.width - width - 16)}px`;
  win.style.top = `${Math.round(rect.top + 16)}px`;
  win.style.width = `${width}px`;
  win.style.height = `${height}px`;
}
function togglePlotkitDock() {
  const win = $("#plotkitWin");
  if (!win || win.hidden) return;
  state.plotkitDock = !state.plotkitDock;
  if (!state.plotkitDock) {
    win.style.left = "";
    win.style.top = "";
    win.style.width = "";
    win.style.height = "";
  }
  layoutPlotkitWindow();
}
function ensurePlotkitFrame() {
  const frame = $("#plotkitFrame");
  if (frame && !plotkitReady) {
    frame.src = plotkitFrameUrl({ embed: "1" });
    plotkitReady = true;
  }
  return frame;
}
function placePlotkit(mode) {
  const frame = ensurePlotkitFrame();
  const win = $("#plotkitWin");
  const host = $("#plotkitInlineHost");
  const floatBody = $("#plotkitWin .plotkit-body");
  state.plotkitMode = mode;
  if (!frame) {
    if (mode === "popup") toast("\u7ED8\u56FE iframe \u4E0D\u5B58\u5728\uFF0C\u5DF2\u6539\u4E3A\u72EC\u7ACB\u7A97\u53E3", "warn", 2400);
    return;
  }
  if (mode === "inline") {
    if (win) win.hidden = true;
    if (host) {
      host.hidden = false;
      host.appendChild(frame);
    }
    document.querySelector('[data-sub="plotkit"]')?.click();
    if (typeof frameActions.setStatusHint === "function") frameActions.setStatusHint("\u7ED8\u56FE\u5DF2\u5D4C\u5728\u53F3\u4FA7\u9762\u677F \xB7 \u70B9\u300C\u6D6E\u51FA\u7A97\u53E3\u300D\u53EF\u62D6\u5230\u753B\u5E03\u4E0A");
  } else if (mode === "float") {
    if (host) host.hidden = true;
    if (floatBody) floatBody.appendChild(frame);
    openPlotkit();
  } else if (mode === "popup") {
    const url = plotkitFrameUrl({ embed: "1" });
    const popup = window.open(url, "netlab-plotkit", "width=1180,height=820");
    if (popup) {
      toast("\u5DF2\u5728\u72EC\u7ACB\u7A97\u53E3\u6253\u5F00\u7ED8\u56FE", "ok", 2400);
      if (typeof frameActions.setStatusHint === "function") frameActions.setStatusHint("\u72EC\u7ACB\u7ED8\u56FE\u7A97\u53E3 \xB7 \u6570\u636E\u4E0E\u4E3B\u754C\u9762\u540C\u6E90");
    } else {
      toast("\u6D4F\u89C8\u5668\u62E6\u622A\u4E86\u5F39\u51FA\u7A97\u53E3\uFF0C\u8BF7\u5141\u8BB8\u540E\u91CD\u8BD5", "warn", 3200);
    }
  }
}
function openPlotkit() {
  const win = $("#plotkitWin");
  if (!win) return;
  ensurePlotkitFrame();
  win.hidden = false;
  win.classList.remove("minimized");
  layoutPlotkitWindow();
  if (typeof raiseFloatWindow === "function") raiseFloatWindow(win);
  clampFloatWindow(win);
}
function closePlotkit() {
  const win = $("#plotkitWin");
  if (!win) return;
  win.hidden = true;
  win.classList.remove("minimized", "maximized");
  state.plotkitGeo = null;
}
let vscodeStarting = null;
async function ensureVscodeFrame() {
  const frame = $("#vscodeFrame");
  if (!frame) return null;
  if (frame.dataset.ready === "1") return frame;
  if (vscodeStarting) return vscodeStarting;
  const status = $("#vscodeStatus");
  if (status) {
    status.hidden = false;
    status.textContent = "\u6B63\u5728\u542F\u52A8 VS Code Server\u2026";
  }
  vscodeStarting = (async () => {
    try {
      const info = await api("/api/vscode/status?start=1", { timeoutMs: 6e4 });
      if (!info || !info.url) {
        throw new Error(info && info.error || "VS Code Server \u4E0D\u53EF\u7528");
      }
      frame.src = info.url;
      frame.dataset.ready = "1";
      if (status) status.hidden = true;
      try {
        localStorage.setItem("netlab.vscode.used", "1");
      } catch (e) {
      }
      return frame;
    } catch (error) {
      if (status) {
        status.hidden = false;
        status.textContent = `VS Code \u542F\u52A8\u5931\u8D25\uFF1A${error.message}`;
      }
      toast(`VS Code \u542F\u52A8\u5931\u8D25\uFF1A${error.message}`, "warn", 5e3);
      return null;
    } finally {
      vscodeStarting = null;
    }
  })();
  return vscodeStarting;
}
async function openVscode() {
  const win = $("#vscodeWin");
  if (!win) return;
  win.hidden = false;
  win.classList.remove("minimized");
  placeFloatWindow(win, "vscodeGeo");
  raiseFloatWindow(win);
  await ensureVscodeFrame();
}
function closeVscode() {
  const win = $("#vscodeWin");
  if (!win) return;
  win.hidden = true;
  win.classList.remove("minimized", "maximized");
  state.vscodeGeo = null;
}
function vscodeWasUsed() {
  try {
    return localStorage.getItem("netlab.vscode.used") === "1";
  } catch (e) {
    return false;
  }
}
function maybePrewarmVscode() {
  if (!vscodeWasUsed()) return;
  setTimeout(() => {
    void ensureVscodeFrame();
  }, 2500);
}
export {
  closePlotkit,
  closeVscode,
  ensurePlotkitFrame,
  ensureVscodeFrame,
  layoutPlotkitWindow,
  maybePrewarmVscode,
  openPlotkit,
  openVscode,
  placePlotkit,
  plotkitReady,
  setPlotkitFrameActions,
  togglePlotkitDock,
  vscodeStarting,
  vscodeWasUsed
};
