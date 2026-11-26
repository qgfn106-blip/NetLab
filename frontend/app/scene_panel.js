import { state, ui } from "./state.js";
import { el } from "./ui.js";
import { fmt } from "../app.utils.js";
import { toast } from "./desktop.js";
import { $$, $ } from "./dom.js";
import { jsonRequest } from "./net.js";
let deps;
function initScenePanel(d) {
  deps = d;
}
function setStat(key, value) {
  const node = $(`[data-stat="${key}"]`, ui.scenePane);
  if (node) node.textContent = value;
}
function updateScenePanelValues() {
  const pane = ui.scenePane;
  if (!pane || !pane.dataset.ready) return;
  const sim = state.sim;
  const config = sim?.config;
  if (config) {
    const setValue = (name, value) => {
      const input = $(`[data-sim="${name}"]`, pane);
      if (!input) return;
      if (document.activeElement === input) return;
      input.value = String(value);
    };
    setValue("fps", config.fps);
    setValue("steps", config.steps_per_frame);
    setValue("dt", config.dt);
    setValue("sample", config.sample_every);
    for (const key of ["reltol", "vntol", "abstol", "max_iter", "gmin_steps", "src_steps", "residual_tol"]) {
      if (config[key] !== void 0) setValue(key, config[key]);
    }
    const lock = $('[data-sim="lock"]', pane);
    if (lock) lock.checked = Boolean(config.lock_dt);
    const realtime = $('[data-sim="realtime"]', pane);
    if (realtime) realtime.checked = Boolean(config.realtime);
    const algebraic = $('[data-role="algebraic"]', pane);
    if (algebraic) algebraic.checked = Boolean(state.scene?.solve_algebraic);
    const dtInput = $('[data-sim="dt"]', pane);
    if (dtInput) dtInput.disabled = Boolean(config.lock_dt);
    const note2 = $('[data-role="sim-note"]', pane);
    if (note2) {
      const perFrame = Number(config.dt) * Number(config.steps_per_frame);
      const perSecond = perFrame * Number(config.fps);
      let text = `\u6BCF\u5E27 ${fmt(perFrame, 4)} s \xB7 \u6BCF\u79D2\u63A8\u8FDB ${fmt(perSecond, 4)} s`;
      if (config.realtime) {
        text += perSecond > 1.0001 ? ` \xB7 \u52A0\u901F ${perSecond.toFixed(2)}\xD7` : " \xB7 \u5B9E\u65F6";
      } else {
        text += " \xB7 \u6781\u901F\u6A21\u5F0F\uFF08\u4E0D\u7B49\u5F85\u5899\u949F\uFF09";
      }
      text += config.lock_dt ? " \xB7 dt \u5DF2\u9501\u5B9A\uFF08\u6BCF\u5E27\u56FA\u5B9A 1/fps\uFF0C\u66F2\u7EBF\u91C7\u6837\u4E5F\u53D7\u6B64\u9650\u5236\uFF09" : "";
      note2.textContent = text;
    }
  }
  const scene = state.scene;
  const stats = sim?.scene || {};
  setStat("nodes", String(scene?.nodes?.length ?? 0));
  setStat("edges", String(scene?.edges?.length ?? 0));
  const stepMs = Number(scene?.stats?.step_ms ?? stats.step_ms ?? 0);
  const stepEl = $('[data-stat="step"]', pane);
  if (stepEl) {
    stepEl.replaceChildren(
      document.createTextNode(fmt(stepMs, 3)),
      el("small", null, "ms")
    );
  }
  setStat("fps", String(Math.round(sim?.actual_fps ?? 0)));
  setStat("matrix", stats.kind === "circuit" ? `${stats.matrix_size || 0}\xD7${stats.matrix_size || 0}` : "\u2014");
  setStat("iterations", stats.iterations !== void 0 ? String(stats.iterations) : "\u2014");
  setStat("frames", String(sim?.frames_recorded ?? state.frames.length));
  setStat("revision", String(scene?.revision ?? 0));
  const integration = $('[data-role="integration"]', pane);
  if (integration && scene) {
    integration.value = scene.integration || "trapezoidal";
    integration.disabled = state.mode !== "circuit";
  }
  const note = $('[data-role="integration-note"]', pane);
  if (note) {
    note.textContent = state.mode === "circuit" ? "\u68AF\u5F62\u6CD5\u7CBE\u5EA6\u9AD8\uFF1B\u540E\u5411\u6B27\u62C9\u66F4\u7A33\u5B9A\uFF0C\u9002\u5408\u521A\u6027\u7535\u8DEF\u3002" : "\u4EC5\u7535\u8DEF\u6A21\u5F0F\u4F7F\u7528\uFF1B\u4FE1\u53F7\u6D41\u7531\u6BCF\u6761\u8FDE\u63A5\u7684\u79BB\u6563\u5316\u53C2\u6570\u51B3\u5B9A\u3002";
  }
  const modeHost = $('[data-role="mode"]', pane);
  if (modeHost) {
    $$("button[data-mode]", modeHost).forEach((item) => {
      item.classList.toggle("active", item.dataset.mode === state.mode);
    });
  }
}
function readSimConfig() {
  const pane = ui.scenePane;
  const fpsInput = $('[data-sim="fps"]', pane);
  const stepsInput = $('[data-sim="steps"]', pane);
  const dtInput = $('[data-sim="dt"]', pane);
  const sampleInput = $('[data-sim="sample"]', pane);
  const lockInput = $('[data-sim="lock"]', pane);
  const realtimeInput = $('[data-sim="realtime"]', pane);
  if (!fpsInput || !stepsInput || !dtInput || !sampleInput) return null;
  const fps = Number(fpsInput.value);
  const steps = Number(stepsInput.value);
  const sample = Number(sampleInput.value);
  const lock = Boolean(lockInput?.checked);
  let dt = Number(dtInput.value);
  if (!Number.isInteger(fps) || fps < 1 || fps > 240) throw new Error("\u5E27\u7387\u5FC5\u987B\u662F 1\u2013240 \u7684\u6574\u6570");
  if (!Number.isInteger(steps) || steps < 1 || steps > 200) throw new Error("\u6BCF\u5E27\u6B65\u6570\u5FC5\u987B\u662F 1\u2013200 \u7684\u6574\u6570");
  if (!Number.isInteger(sample) || sample < 1 || sample > 100) throw new Error("\u91C7\u6837\u95F4\u9694\u5FC5\u987B\u662F 1\u2013100 \u7684\u6574\u6570");
  if (lock) dt = 1 / (fps * steps);
  if (!Number.isFinite(dt) || dt < 1e-9 || dt > 10) throw new Error("dt \u5FC5\u987B\u5728 1e-9 \u5230 10 s \u4E4B\u95F4");
  if (dt * steps > 10) throw new Error("\u6BCF\u5E27\u63A8\u8FDB\u7684\u4EFF\u771F\u65F6\u95F4\u8FC7\u5927\uFF0C\u8BF7\u51CF\u5C0F dt \u6216\u6B65\u6570");
  const readSolver = (name, label, lo, hi, integer = false) => {
    const input = $(`[data-solver="${name}"]`, pane);
    if (!input) return void 0;
    const value = Number(input.value);
    if (!Number.isFinite(value) || value < lo || value > hi) {
      throw new Error(`${label}\u5FC5\u987B\u5728 ${lo}\u2013${hi} \u4E4B\u95F4`);
    }
    if (integer && !Number.isInteger(value)) throw new Error(`${label}\u5FC5\u987B\u662F\u6574\u6570`);
    return value;
  };
  const payload = {
    fps,
    steps_per_frame: steps,
    dt,
    sample_every: sample,
    lock_dt: lock,
    realtime: Boolean(realtimeInput?.checked)
  };
  const solverFields = [
    ["reltol", "\u76F8\u5BF9\u5BB9\u5DEE reltol", 1e-15, 0.1, false],
    ["vntol", "\u7535\u538B\u5BB9\u5DEE vntol", 1e-15, 1, false],
    ["abstol", "\u7535\u6D41\u5BB9\u5DEE abstol", 1e-15, 1, false],
    ["max_iter", "Newton \u8FED\u4EE3\u4E0A\u9650", 1, 500, true],
    ["gmin_steps", "gmin \u6B65\u6570", 0, 100, true],
    ["src_steps", "source \u6B65\u6570", 0, 100, true],
    ["residual_tol", "\u6B8B\u5DEE\u5BB9\u5DEE", 0, 1, false]
  ];
  for (const [key, label, lo, hi, integer] of solverFields) {
    const value = readSolver(key, label, lo, hi, integer);
    if (value !== void 0) payload[key] = value;
  }
  return payload;
}
async function applySimConfig() {
  let payload;
  try {
    payload = readSimConfig();
  } catch (error) {
    toast(error.message, "error", 6e3);
    updateScenePanelValues();
    return;
  }
  if (!payload) return;
  const response = await deps.task(() => jsonRequest("/api/config", "PATCH", payload));
  if (!response) {
    updateScenePanelValues();
    return;
  }
  state.sim = response.sim;
  deps.syncUI();
  updateScenePanelValues();
  deps.updateRunButton(Boolean(state.sim?.running));
  const solverKeys = ["reltol", "vntol", "abstol", "max_iter", "gmin_steps", "src_steps", "residual_tol"];
  toast("\u4EFF\u771F\u8BBE\u7F6E\u5DF2\u66F4\u65B0", "ok", 1600);
}
export {
  applySimConfig,
  initScenePanel,
  updateScenePanelValues
};
