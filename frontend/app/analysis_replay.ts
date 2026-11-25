import { clamp } from '../app.utils.js';
import { $$ } from './dom.js';
import { state, ui } from './state.js';
import { toast } from './desktop.js';

interface ReplayDeps { scheduleChartDraw(): void; }
let deps: ReplayDeps;
export function initReplay(d: ReplayDeps): void { deps = d; }

  export function nearestFrame(time: number) {
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

  /* ---- 回放（R23/D48）：只读录制帧，不改电路状态 ---------------------- */
  export function recordingStale() {
    const revision = state.scene?.revision;
    return Boolean(
      state.frames.length
      && state.replay.recordingRevision !== null
      && revision !== undefined
      && revision !== state.replay.recordingRevision,
    );
  }

  export function stopReplayTimer() {
    if (state.replay.timer) {
      clearInterval(state.replay.timer);
      state.replay.timer = 0;
    }
    state.replay.playing = false;
    state.replay.lastTick = 0;
    state.replay.carry = 0;
  }

  export function updateReplayUI() {
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
      ui.chartReplayTime.textContent = frame ? `t ${frame.t.toFixed(3)} s` : '—';
    }
    if (ui.topTimeline) {
      ui.topTimeline.max = String(max);
      ui.topTimeline.value = String(state.replay.index);
      ui.topTimeline.disabled = !state.frames.length;
    }
    if (ui.topTimelineTime) {
      const total = state.frames.length
        ? Number(state.frames[state.frames.length - 1].t || 0)
        : 0;
      ui.topTimelineTime.textContent = frame
        ? `t ${frame.t.toFixed(3)} / ${total.toFixed(3)} s`
        : '—';
    }
    if (ui.btnReplay) {
      ui.btnReplay.textContent = state.replay.playing ? '⏸ 暂停' : '▶ 回放';
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
    status.classList.remove('stale', 'replay');
    if (recordingStale()) {
      status.textContent = '记录已过期 · 场景已修改，请重新求解';
      status.classList.add('stale');
    } else if (state.replay.active) {
      status.textContent = `回放中 · ${state.replay.index + 1}/${state.frames.length}`;
      status.classList.add('replay');
    } else {
      status.textContent = '';
    }
  }

  export function enterReplay(index: number = state.replay.index) {
    if (!state.frames.length) return;
    state.replay.active = true;
    state.replay.index = clamp(Number(index) || 0, 0, state.frames.length - 1);
    stopReplayTimer();
    updateReplayUI();
    deps.scheduleChartDraw();
  }

  export function leaveReplay() {
    state.replay.active = false;
    state.replay.index = Math.max(0, state.frames.length - 1);
    stopReplayTimer();
    updateReplayUI();
    deps.scheduleChartDraw();
  }

  // 回放定时器固定 16 ms 一跳；速度只影响每次推进的帧数。
  export const REPLAY_TICK_MS = 16;

  export function toggleReplayPlayback() {
    if (!state.frames.length) {
      toast('还没有可回放的录制帧', 'info', 2200);
      return;
    }    if (state.replay.playing) {
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

  // 按真实时间累积“要播放的帧数”，速度用 帧/秒 表示；
  // 这样调速度只改推进量，不改定时器频率，快放不会把主线程刷爆。
  export function replayTick() {
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
    state.replay.carry = (state.replay.carry || 0) + (elapsed * speed) / 1000;
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

  /* ---- 相图 ------------------------------------------------------------ */
  // ---------------- 仪器面板（R23 / D47，P7-04） ----------------
  // 全部只读 state.frames：仪表/示波器/李萨如都是旁路观察，绝不写回电路状态。

  /* ======================================================================
   * 工作区切换
   * ==================================================================== */
  export function setWorkspaceButtons() {
    if (!ui.workspaceSwitch) return;
    $$('button[data-workspace]', ui.workspaceSwitch).forEach((item) => {
      item.classList.toggle('active', item.dataset.workspace === state.workspace);
    });
  }

