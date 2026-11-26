import { ENDPOINTS } from "./endpoints.js";
import { applySnapshot } from "./store.js";
import { frameCap } from "./canvas_geometry.js";
import { state, ui } from "./state.js";
import { stopReplayTimer, updateReplayUI, leaveReplay, setWorkspaceButtons } from "./analysis_replay.js";
import { updateSignalListValues, updateLegendValues } from "./signal_list.js";
import { el, div } from "./ui.js";
import { toast } from "./desktop.js";
import { api, jsonRequest } from "./net.js";
import { activeTab } from "./model.js";
import { requestDraw } from "./canvas_render.js";
import { updateInspectorLive } from "./inspector.js";
import { runPrecomputeWithProgress, syncAfterPrecompute } from "./plotkit_data.js";
import { openConfirmModal as confirmModal } from "./dialogs_build.js";
import { refreshWbAnalysis, getWbCompareStateIds, getWbCacheStatus } from "./analysis_workbench_panel.js";
import { switchTab } from "./editor_runtime.js";
import { ingestFrame, resizeChart, resizeGraph, syncUI, task, updateSignalKeyCache, scheduleChartDraw } from "./editor_services.js";
async function switchWorkspace(name) {
  if (name === state.workspace) return;
  state.workspace = "network";
  setWorkspaceButtons();
  switchTab("inspect");
  resizeGraph();
  resizeChart();
  syncUI();
  requestDraw();
}
async function pollLive() {
  if (state.liveBusy) return;
  const sim = state.sim;
  if (!sim) return;
  if (!sim.running && state.cursor >= Number(sim.cursor || 0)) return;
  state.liveBusy = true;
  try {
    const previousCursor = state.cursor;
    const previousSteps = Number(sim.steps || 0);
    const data = await api(ENDPOINTS.live(state.cursor, 600));
    const resetDetected = Boolean(
      data.sim && (Number(data.cursor || 0) < previousCursor || Number(data.sim.steps || 0) < previousSteps)
    );
    if (resetDetected) {
      state.frames = [];
      state.values.clear();
      state.nodeValues.clear();
      state.edgeValues.clear();
    }
    if (Array.isArray(data.frames) && data.frames.length) {
      if (!state.frames.length) {
        state.replay.recordingRevision = state.scene?.revision ?? null;
      }
      for (const frame of data.frames) {
        state.frames.push(frame);
        ingestFrame(frame);
      }
      const cap = frameCap();
      if (state.frames.length > cap) {
        state.frames.splice(0, state.frames.length - cap);
      }
    }
    const gotFrames = Boolean(Array.isArray(data.frames) && data.frames.length);
    if (typeof data.cursor === "number") state.cursor = data.cursor;
    if (data.sim) state.sim = data.sim;
    if (gotFrames || resetDetected) {
      updateSignalKeyCache();
      syncUI();
      updateReplayUI();
      if (ui.inspector?.offsetParent !== null) updateInspectorLive();
      if (ui.signalList?.offsetParent !== null) updateSignalListValues();
      if (activeTab() === "chart") updateLegendValues();
      scheduleChartDraw();
    } else {
      syncUI();
    }
    if (resetDetected) void refreshState(true);
  } catch (error) {
    const now = performance.now();
    if (now - (state.lastLiveError || 0) > 8e3) {
      state.lastLiveError = now;
      toast(`\u5B9E\u65F6\u6570\u636E\u83B7\u53D6\u5931\u8D25\uFF1A${error.message}`, "error", 5e3);
    }
  } finally {
    state.liveBusy = false;
  }
}
async function refreshState(quiet = true) {
  if (state.stateBusy) return;
  if (state.drag) return;
  state.stateBusy = true;
  try {
    const snapshot = await api(ENDPOINTS.state);
    state.lastStateFetch = performance.now();
    applySnapshot(snapshot);
  } catch (error) {
    if (!quiet) toast(`\u72B6\u6001\u5237\u65B0\u5931\u8D25\uFF1A${error.message}`, "error", 5e3);
  } finally {
    state.stateBusy = false;
  }
}
async function pollLoop() {
  clearTimeout(state.pollTimer);
  try {
    const sim = state.sim;
    if (sim && (sim.running || state.cursor < Number(sim.cursor || 0))) {
      await pollLive();
    }
  } finally {
    if (!state.shuttingDown) {
      const activeRunning = state.sim?.running;
      const delay = document.hidden ? 1e3 : activeRunning ? 110 : 500;
      state.pollTimer = setTimeout(pollLoop, delay);
    }
  }
}
function resetLocalFrames() {
  state.frames = [];
  state.values.clear();
  state.nodeValues.clear();
  state.edgeValues.clear();
  state.cursor = 0;
  stopReplayTimer();
  state.replay.active = false;
  state.replay.index = 0;
  state.replay.recordingRevision = null;
  updateSignalListValues();
  updateLegendValues();
  updateReplayUI();
  scheduleChartDraw();
}
async function networkControl(action, steps) {
  const body = { action };
  if (steps !== void 0) body.steps = steps;
  const response = await task(() => jsonRequest(ENDPOINTS.control, "POST", body), { dirty: false });
  if (!response) return;
  state.sim = response.sim;
  if (action === "reset") {
    resetLocalFrames();
  } else if (action === "run" || action === "step") {
    if (state.replay.active) leaveReplay();
  }
  syncUI();
  updateSignalKeyCache();
  updateInspectorLive();
  if (action === "step" || action === "reset") await pollLive();
  if (action === "reset") toast("\u4EFF\u771F\u5DF2\u91CD\u7F6E\uFF1B\u63A2\u9488\u4E0E\u4EEA\u5668\u8BBE\u7F6E\u4FDD\u7559", "ok", 2200);
}
async function control(action, steps, opts) {
  const running = !!(state.sim && state.sim.running);
  if ((action === "toggle" || action === "run") && !running && !(opts && opts.skipWarn) && state.prefs.runWarn !== false && !hasPrecomputed()) {
    openPrecomputeDialog("plotkit", () => void networkControl(action, steps));
    return;
  }
  await networkControl(action, steps);
}
function hasPrecomputed() {
  if (state.precomputedSeconds != null) return true;
  const frames = state.frames || [];
  if (frames.length < 2) return false;
  const span = frames[frames.length - 1].t - frames[0].t;
  const need = Number(state.chart && state.chart.window || 5);
  return span >= need * 0.9;
}
async function runSolveWindowPrecompute(seconds, dt = null, interp = null) {
  const response = await runPrecomputeWithProgress(
    () => api(ENDPOINTS.solveWindow, {
      method: "POST",
      body: JSON.stringify({ duration: seconds, ...dt ? { dt } : {}, ...interp || {} }),
      timeoutMs: 18e4
    }),
    `\u6B63\u5728\u8BA1\u7B97 0\u2192${seconds}s`
  );
  if (!response || response.ok === false) {
    toast(`\u9884\u8BA1\u7B97\u5931\u8D25\uFF1A${response && response.error || "\u672A\u77E5\u9519\u8BEF"}`, "error", 6e3);
    return;
  }
  if (response.result && response.result.cancelled) {
    toast("\u5DF2\u505C\u6B62\uFF08\u9884\u8BA1\u7B97\u672A\u5B8C\u6210\uFF09", "warn", 3e3);
    return;
  }
  leaveReplay();
  state.frames = [];
  state.cursor = 0;
  state.values.clear();
  state.nodeValues.clear();
  state.edgeValues.clear();
  state.sim = response.sim;
  state.replay.recordingRevision = state.scene?.revision ?? null;
  const ip = response.result && response.result.interpolation || null;
  if (ip && Array.isArray(ip.frames) && ip.frames.length) {
    const frames = ip.frames.length > frameCap() ? ip.frames.slice(-frameCap()) : ip.frames;
    for (const f of frames) {
      state.frames.push(f);
      ingestFrame(f);
    }
    state.cursor = Number(response.sim?.cursor || 0);
    state.replay.interpolated = true;
    state.replay.interpMeta = { method: ip.method, rounds: ip.rounds, window: ip.window, count: frames.length };
  } else {
    state.replay.interpolated = false;
    await pollLive();
  }
  updateReplayUI();
  scheduleChartDraw();
  const result = response.result || {};
  if (result.error) toast(`\u9884\u8BA1\u7B97\u4E2D\u65AD\uFF1A${result.error}`, "error", 6e3);
  else toast(`\u9884\u8BA1\u7B97\u5B8C\u6210\uFF1A${result.steps} \u6B65 / ${result.frames} \u5E27`, "ok", 3e3);
}
async function runPlotkitPrecompute(seconds, dt = null) {
  const pre = await runPrecomputeWithProgress(
    () => api(ENDPOINTS.plotkitPrecompute, {
      method: "POST",
      body: JSON.stringify(dt ? { seconds, dt } : { seconds }),
      timeoutMs: 18e4
    }),
    `\u6B63\u5728\u8BA1\u7B97 0\u2192${seconds}s`
  );
  if (!pre || pre.ok === false) {
    toast(`\u9884\u8BA1\u7B97\u5931\u8D25\uFF1A${pre && pre.error || "\u672A\u77E5\u9519\u8BEF"}`, "error", 6e3);
    return;
  }
  if (pre.cancelled) {
    toast(`\u5DF2\u505C\u6B62\uFF1A\u4FDD\u7559\u524D ${pre.frames ?? "?"} \u5E27`, "warn", 4200);
    return;
  }
  state.precomputedSeconds = seconds;
  state.precomputedRevision = state.scene?.revision ?? null;
  await syncAfterPrecompute(pre);
  toast(`\u9884\u8BA1\u7B97\u5B8C\u6210\uFF1A${pre.frames ?? 0} \u5E27`, "ok", 3e3);
}
async function runStatesPrecompute(seconds, dt = null) {
  if (!getWbCompareStateIds().length) {
    toast("\u8BF7\u5148\u5728\u4FE1\u53F7\u7A97\u52FE\u9009\u8981\u9884\u8BA1\u7B97\u7684\u72B6\u6001", "error");
    return;
  }
  for (const id of getWbCompareStateIds().slice()) {
    const row = (getWbCacheStatus()?.states || []).find((item) => String(item.state_id) === id);
    const label = `\u9884\u8BA1\u7B97 ${row?.name || id}\u2026`;
    try {
      const result = await runPrecomputeWithProgress(
        () => api(ENDPOINTS.networkStatePrecompute, {
          method: "POST",
          body: JSON.stringify(dt ? { state_id: id, seconds, dt } : { state_id: id, seconds }),
          timeoutMs: 6e5
        }),
        label
      );
      if (result && result.cancelled) {
        toast(`${label}\u5DF2\u505C\u6B62\uFF08\u672A\u5B8C\u6210\uFF09`, "warn", 3e3);
        continue;
      }
      if (result && result.ok === false) toast(`${label}\u5931\u8D25\uFF1A${result.error || "\u672A\u77E5\u9519\u8BEF"}`, "error", 7e3);
    } catch (error) {
      toast(`${label}\u5931\u8D25\uFF1A${error?.message || error}`, "error", 7e3);
    }
  }
  toast("\u9884\u8BA1\u7B97\u5B8C\u6210", "ok", 2600);
  await refreshWbAnalysis();
}
function openPrecomputeDialog(initial = "solve", onRun) {
  if (document.getElementById("precomputeDialog")) return;
  const overlay = document.createElement("div");
  overlay.id = "precomputeDialog";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(16,20,18,.45);display:flex;align-items:center;justify-content:center;z-index:10000;";
  const card = document.createElement("div");
  card.style.cssText = 'width:460px;max-width:92vw;background:var(--paper,#faf8f2);color:var(--text-primary,#080a08);border:1px solid var(--line,#cfc6b5);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.28);padding:20px 22px 16px;font:13px/1.7 "Microsoft YaHei UI",sans-serif;';
  card.innerHTML = `
    <div style="font-size:16px;font-weight:700;margin-bottom:6px;">\u8FD0\u884C\u9884\u8BA1\u7B97</div>
    <div style="color:var(--text-secondary,#7b7266);margin-bottom:14px;">\u7EDF\u4E00\u5165\u53E3\uFF1A\u628A 0\u2192T \u6574\u6BB5\u7B97\u5B8C\u540E\u518D\u56DE\u653E\u6216\u63A5\u5165\u6570\u636E\u6E90\u3002</div>
    <label style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">\u76EE\u6807
      <select id="precomputeTarget" style="flex:1;padding:5px 8px;border:1px solid var(--line,#cfc6b5);border-radius:7px;background:var(--paper,#faf8f2);color:inherit;">
        <option value="solve">\u5F53\u524D\u7F51\u7EDC\uFF080\u2192T \u5F55\u5236\uFF09</option>
        <option value="plotkit">PlotKit \u6570\u636E\u6E90</option>
        <option value="states">\u5DE5\u4F5C\u53F0\u5BF9\u6BD4\u72B6\u6001</option>
      </select>
    </label>
    <label style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">\u65F6\u957F\uFF08\u79D2\uFF09
      <input id="precomputeSeconds" type="number" min="1" max="120" step="1" value="5" style="width:110px;padding:5px 8px;border:1px solid var(--line,#cfc6b5);border-radius:7px;background:var(--paper,#faf8f2);color:inherit;">
    </label>
    <label style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">\u7CBE\u5EA6\uFF08\u6B65\u957F dt\uFF0C\u79D2\uFF1B\u7A7A=\u81EA\u52A8\uFF09
      <input id="precomputeDt" type="number" min="0" step="0.001" placeholder="\u81EA\u52A8" style="width:110px;padding:5px 8px;border:1px solid var(--line,#cfc6b5);border-radius:7px;background:var(--paper,#faf8f2);color:inherit;">
    </label>
    <label style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">\u63D2\u503C <select id="precomputeInterpMethod" style="flex:1;padding:5px 8px;border:1px solid var(--line,#cfc6b5);border-radius:7px;background:var(--paper,#faf8f2);color:inherit;"><option value="">\u4E0D\u63D2\u503C</option><option value="average">\u76F4\u63A5\u5E73\u5747\u4E2D\u70B9</option><option value="gaussian">\u9AD8\u65AF\u6838\u52A0\u6743\u4E2D\u70B9</option></select></label>
    <label style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">\u63D2\u503C\u6B21\u6570 <input id="precomputeInterpRounds" type="number" min="0" max="6" step="1" value="1" style="width:70px;padding:5px 8px;border:1px solid var(--line,#cfc6b5);border-radius:7px;background:var(--paper,#faf8f2);color:inherit;"> \u7A97\u53E3 <input id="precomputeInterpWindow" type="number" min="0" step="0.001" placeholder="\u81EA\u52A8" style="width:80px;padding:5px 8px;border:1px solid var(--line,#cfc6b5);border-radius:7px;background:var(--paper,#faf8f2);color:inherit;"></label>
    <div style="display:flex;justify-content:flex-end;gap:8px;">
      <button id="precomputeSkip" type="button" style="display:none">\u76F4\u63A5\u8FD0\u884C\uFF08\u4E0D\u9884\u8BA1\u7B97\uFF09</button>
      <button id="precomputeCancel" type="button">\u53D6\u6D88</button>
      <button id="precomputeRun" type="button" class="primary">\u5F00\u59CB\u9884\u8BA1\u7B97</button>
    </div>`;
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  const target = card.querySelector("#precomputeTarget");
  const secondsInput = card.querySelector("#precomputeSeconds");
  if (target) target.value = initial;
  const close = () => overlay.remove();
  card.querySelector("#precomputeCancel").onclick = close;
  const skip = card.querySelector("#precomputeSkip");
  if (onRun) {
    skip.style.display = "inline-block";
    skip.onclick = () => {
      close();
      onRun();
    };
  } else {
    skip.remove();
  }
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  card.querySelector("#precomputeRun").onclick = async () => {
    const seconds = Number(secondsInput.value);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 120) {
      toast("\u9884\u8BA1\u7B97\u65F6\u957F\u5FC5\u987B\u5728 (0, 120] s \u5185", "error", 3e3);
      return;
    }
    const dtInput = card.querySelector("#precomputeDt");
    const dtRaw = dtInput ? Number(dtInput.value) : NaN;
    const dtOpt = Number.isFinite(dtRaw) && dtRaw > 0 ? dtRaw : null;
    const interpSel = card.querySelector("#precomputeInterpMethod");
    const interpMethod = interpSel ? interpSel.value : "";
    const roundsRaw = Number(card.querySelector("#precomputeInterpRounds")?.value);
    const windowRaw = Number(card.querySelector("#precomputeInterpWindow")?.value);
    const interpOpts = interpMethod ? {
      interpolation_method: interpMethod,
      interpolation_rounds: Number.isFinite(roundsRaw) ? Math.max(0, Math.min(6, roundsRaw)) : 1,
      interpolation_window: Number.isFinite(windowRaw) && windowRaw > 0 ? windowRaw : null
    } : null;
    const kind = target.value;
    close();
    try {
      if (kind === "solve") await runSolveWindowPrecompute(seconds, dtOpt, interpOpts);
      else if (kind === "plotkit") await runPlotkitPrecompute(seconds, dtOpt);
      else await runStatesPrecompute(seconds, dtOpt);
    } catch (error) {
      toast(`\u9884\u8BA1\u7B97\u5931\u8D25\uFF1A${error.message}`, "error", 6e3);
    }
  };
}
function openRunWarn() {
  openPrecomputeDialog("plotkit");
}
function showShutdownScreen() {
  ui.modalCard.replaceChildren();
  ui.modalCard.appendChild(el("h3", null, "\u670D\u52A1\u5DF2\u5173\u95ED"));
  const body = el("p", null, "\u540E\u53F0\u4EFF\u771F\u7EBF\u7A0B\u5DF2\u505C\u6B62\uFF0C\u76D1\u542C\u7AEF\u53E3\u5DF2\u91CA\u653E\u3002\u73B0\u5728\u53EF\u4EE5\u5173\u95ED\u6B64\u6807\u7B7E\u9875\u3002");
  const note = div("shutdown-note");
  note.textContent = "\u5982\u9700\u518D\u6B21\u4F7F\u7528\uFF0C\u8BF7\u91CD\u65B0\u8FD0\u884C run.py \u6216\u53CC\u51FB start.bat\uFF1B\u7AEF\u53E3\u901A\u5E38\u4F1A\u5728 1 \u79D2\u5185\u91CD\u65B0\u53EF\u7528\u3002";
  ui.modalCard.append(body, note);
  ui.modal.classList.remove("hidden");
  ui.modal.onclick = null;
}
async function shutdownApp() {
  if (state.shuttingDown) return;
  const confirmed = await confirmModal(
    "\u9000\u51FA Netlab\uFF1F",
    "\u5C06\u505C\u6B62\u4EFF\u771F\u7EBF\u7A0B\uFF0C\u7EC8\u6B62\u540E\u7AEF\u8FDB\u7A0B\u5E76\u91CA\u653E\u76D1\u542C\u7AEF\u53E3\u3002\u6240\u6709\u672A\u5BFC\u51FA\u7684\u5185\u5B58\u573A\u666F\u90FD\u4F1A\u4E22\u5931\u3002",
    "\u9000\u51FA\u5E76\u5173\u95ED",
    true
  );
  if (!confirmed) return;
  state.shuttingDown = true;
  clearTimeout(state.pollTimer);
  clearTimeout(state.chartTimer);
  clearTimeout(state.phaseTimer);
  clearTimeout(state.positionTimer);
  clearInterval(state.stateTimer);
  const pywebviewApi = window.pywebview?.api;
  if (pywebviewApi && typeof pywebviewApi.window_close === "function") {
    try {
      pywebviewApi.window_close();
    } catch (error) {
    }
    return;
  }
  try {
    await api(ENDPOINTS.shutdown, {
      method: "POST",
      body: JSON.stringify({ confirm: true }),
      timeoutMs: 2500
    });
  } catch (error) {
  }
  await new Promise((resolve) => setTimeout(resolve, 550));
  showShutdownScreen();
}
export {
  control,
  hasPrecomputed,
  networkControl,
  openPrecomputeDialog,
  openRunWarn,
  pollLive,
  pollLoop,
  refreshState,
  resetLocalFrames,
  runPlotkitPrecompute,
  runSolveWindowPrecompute,
  runStatesPrecompute,
  showShutdownScreen,
  shutdownApp,
  switchWorkspace
};
