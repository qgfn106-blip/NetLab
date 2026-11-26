import { clamp } from "../app.utils.js";
import { $$ } from "./dom.js";
import { state, ui } from "./state.js";
import { toast } from "./desktop.js";
let deps;
function initReplay(d) {
  deps = d;
}
function nearestFrame(time) {
  const frames = state.frames;
  if (!frames.length) return null;
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (frames[mid].t < time) low = mid + 1;
    else high = mid;
  }
  const after = frames[low];
  const before = frames[Math.max(0, low - 1)];
  return Math.abs(before.t - time) <= Math.abs(after.t - time) ? before : after;
}
function recordingStale() {
  const revision = state.scene?.revision;
  return Boolean(
    state.frames.length && state.replay.recordingRevision !== null && revision !== void 0 && revision !== state.replay.recordingRevision
  );
}
function stopReplayTimer() {
  if (state.replay.timer) {
    clearInterval(state.replay.timer);
    state.replay.timer = 0;
  }
  state.replay.playing = false;
  state.replay.lastTick = 0;
  state.replay.carry = 0;
}
function updateReplayUI() {
  const max = Math.max(0, state.frames.length - 1);
  if (!state.replay.active) state.replay.index = max;
  state.replay.index = clamp(state.replay.index, 0, max);
  const frame = state.frames[state.replay.index];
  if (ui.chartTimeline) {
    ui.chartTimeline.max = String(max);
    ui.chartTimeline.value = String(state.replay.index);
    ui.chartTimeline.disabled = !state.frames.length;
  }
  if (ui.chartReplayTime) {
    ui.chartReplayTime.textContent = frame ? `t ${frame.t.toFixed(3)} s` : "\u2014";
  }
  if (ui.topTimeline) {
    ui.topTimeline.max = String(max);
    ui.topTimeline.value = String(state.replay.index);
    ui.topTimeline.disabled = !state.frames.length;
  }
  if (ui.topTimelineTime) {
    const total = state.frames.length ? Number(state.frames[state.frames.length - 1].t || 0) : 0;
    ui.topTimelineTime.textContent = frame ? `t ${frame.t.toFixed(3)} / ${total.toFixed(3)} s` : "\u2014";
  }
  if (ui.btnReplay) {
    ui.btnReplay.textContent = state.replay.playing ? "\u23F8 \u6682\u505C" : "\u25B6 \u56DE\u653E";
    ui.btnReplay.disabled = !state.frames.length;
  }
  if (ui.replaySpeed) {
    ui.replaySpeed.value = String(state.replay.speed);
    ui.replaySpeed.disabled = !state.frames.length;
  }
  if (ui.replaySpeedVal) {
    ui.replaySpeedVal.textContent = `${Math.round(state.replay.speed)}/s`;
  }
  if (ui.btnLive) ui.btnLive.disabled = !state.replay.active;
  if (ui.btnResolve) ui.btnResolve.disabled = !recordingStale();
  if (ui.chartLoop) ui.chartLoop.checked = Boolean(state.chart.loop);
  const status = ui.chartStatus;
  if (!status) return;
  status.classList.remove("stale", "replay");
  if (recordingStale()) {
    status.textContent = "\u8BB0\u5F55\u5DF2\u8FC7\u671F \xB7 \u573A\u666F\u5DF2\u4FEE\u6539\uFF0C\u8BF7\u91CD\u65B0\u6C42\u89E3";
    status.classList.add("stale");
  } else if (state.replay.active) {
    status.textContent = `\u56DE\u653E\u4E2D \xB7 ${state.replay.index + 1}/${state.frames.length}`;
    status.classList.add("replay");
  } else {
    status.textContent = "";
  }
}
function enterReplay(index = state.replay.index) {
  if (!state.frames.length) return;
  state.replay.active = true;
  state.replay.index = clamp(Number(index) || 0, 0, state.frames.length - 1);
  stopReplayTimer();
  updateReplayUI();
  deps.scheduleChartDraw();
}
function leaveReplay() {
  state.replay.active = false;
  state.replay.index = Math.max(0, state.frames.length - 1);
  stopReplayTimer();
  updateReplayUI();
  deps.scheduleChartDraw();
}
const REPLAY_TICK_MS = 16;
function toggleReplayPlayback() {
  if (!state.frames.length) {
    toast("\u8FD8\u6CA1\u6709\u53EF\u56DE\u653E\u7684\u5F55\u5236\u5E27", "info", 2200);
    return;
  }
  if (state.replay.playing) {
    stopReplayTimer();
    updateReplayUI();
    return;
  }
  if (!state.replay.active) {
    state.replay.active = true;
    state.replay.index = 0;
  }
  if (state.replay.index >= state.frames.length - 1) state.replay.index = 0;
  state.replay.playing = true;
  state.replay.lastTick = performance.now();
  state.replay.carry = 0;
  state.replay.timer = setInterval(replayTick, REPLAY_TICK_MS);
  updateReplayUI();
}
function replayTick() {
  const now = performance.now();
  const elapsed = Math.min(400, Math.max(0, now - (state.replay.lastTick || now)));
  state.replay.lastTick = now;
  if (!state.frames.length) {
    stopReplayTimer();
    updateReplayUI();
    deps.scheduleChartDraw();
    return;
  }
  const speed = clamp(Number(state.replay.speed) || 60, 5, 240);
  state.replay.carry = (state.replay.carry || 0) + elapsed * speed / 1e3;
  const advance = Math.floor(state.replay.carry);
  if (advance <= 0) return;
  state.replay.carry -= advance;
  const max = state.frames.length - 1;
  let next = state.replay.index + advance;
  if (next > max) {
    if (!state.chart.loop) {
      state.replay.index = max;
      stopReplayTimer();
      updateReplayUI();
      deps.scheduleChartDraw();
      return;
    }
    next = max > 0 ? next % (max + 1) : 0;
  }
  state.replay.index = next;
  updateReplayUI();
  deps.scheduleChartDraw();
}
function setWorkspaceButtons() {
  if (!ui.workspaceSwitch) return;
  $$("button[data-workspace]", ui.workspaceSwitch).forEach((item) => {
    item.classList.toggle("active", item.dataset.workspace === state.workspace);
  });
}
export {
  REPLAY_TICK_MS,
  enterReplay,
  initReplay,
  leaveReplay,
  nearestFrame,
  recordingStale,
  replayTick,
  setWorkspaceButtons,
  stopReplayTimer,
  toggleReplayPlayback,
  updateReplayUI
};
