import { fmt, intText, clamp, hashString } from "../app.utils.js";
import { NODE_W, NODE_H } from "./constants.js";
import { $, $$, stage, canvas, chartCanvas } from "./dom.js";
import { state, ui } from "./state.js";
import { updateScenePanelValues } from "./scene_panel.js";
import { updateReplayUI } from "./analysis_replay.js";
import { renderSignalList } from "./signal_list.js";
import { toast, showBanner, hideBanner } from "./desktop.js";
import { chartPalette } from "./theme.js";
import { C } from "./colors.js";
import { modeLabel } from "./model.js";
import { requestDraw } from "./canvas_render.js";
import { schedulePhaseDraw } from "./phase.js";
import { fillInstrumentSelects } from "./instruments.js";
import { circuitCrossingMap, edgeAnchorTowards, pinScreenPoint } from "./canvas_base.js";
import { devicePins } from "./device_pins.js";
import { markProjectDirty } from "./project.js";
import { nodeRect, devicePinScreen, portOut, edgePathPoints, distanceToPath } from "./geometry.js";
import { elementPins, elementRot } from "./circuit_symbols.js";
import { pushUndoSnapshot } from "./commands.js";
import { scheduleChartDraw } from "./editor_services.js";
function setStatusHint(hint) {
  const node = document.getElementById("statusHint");
  if (node) node.textContent = hint;
}
function colorForKey(key) {
  const palette = chartPalette();
  const raw = palette[hashString(key) % palette.length];
  const mode = String(state.prefs && state.prefs.chartPalette || "theme");
  return mode === "theme" ? C(raw) : raw;
}
async function runTask(run, options = {}) {
  if (state.busy) {
    toast("\u4E0A\u4E00\u6761\u64CD\u4F5C\u8FD8\u5728\u5904\u7406\u4E2D\uFF0C\u8BF7\u7A0D\u5019\u2026", "info", 1500);
    return null;
  }
  state.busy = true;
  try {
    if (options.dirty !== false && options.history !== false) await pushUndoSnapshot();
    const result = await run();
    if (options.dirty !== false) markProjectDirty();
    return result;
  } catch (error) {
    const message = error?.message || String(error);
    if (!options.silent) toast(message, "error", 7e3);
    if (/电路|代数环|接地|引擎|求逆|奇异|发散|未收敛|有限元/.test(message)) showBanner(message);
    return null;
  } finally {
    state.busy = false;
  }
}
function syncUI() {
  const sim = state.sim;
  if (!sim) return;
  updateRunButton(sim.running);
  updateReplayUI();
  ui.simTime.textContent = fmt(sim.time ?? 0, 3);
  ui.simFps.textContent = String(Math.round(sim.actual_fps ?? 0));
  ui.simSteps.textContent = intText(sim.steps ?? 0);
  ui.simFps.title = `\u76EE\u6807 ${sim.config?.fps ?? "\u2014"} fps \xB7 \u5B9E\u9645 ${(sim.actual_fps ?? 0).toFixed(1)}`;
  const nodes = state.scene?.nodes?.length ?? 0;
  const edges = state.scene?.edges?.length ?? 0;
  const maxNodes = state.catalog?.limits?.nodes ?? state.limits?.nodes ?? 400;
  const maxEdges = state.catalog?.limits?.edges ?? state.limits?.edges ?? 1200;
  ui.statusLimits.textContent = `\u8282\u70B9 ${nodes}/${maxNodes} \xB7 \u8FDE\u63A5 ${edges}/${maxEdges}`;
  ui.statusMode.textContent = modeLabel(state.mode);
  const stats = sim.scene || {};
  const revision = state.scene?.revision ?? 0;
  if (stats.kind === "circuit") {
    ui.statusEngine.textContent = `MNA ${stats.matrix_size || 0}\xD7${stats.matrix_size || 0}`;
  } else if (stats.kind === "vector") {
    ui.statusEngine.textContent = `\u77E2\u91CF\u6D41 \xB7 rev ${revision}`;
  } else if (stats.kind === "signal") {
    ui.statusEngine.textContent = `\u5B57\u5178\u6D41 \xB7 rev ${revision}`;
  } else {
    ui.statusEngine.textContent = "\u2014";
  }
  let hint = sim.running ? "\u8FD0\u884C\u4E2D" : "\u5DF2\u6682\u505C";
  if (sim.config) {
    hint += ` \xB7 ${sim.config.fps} fps \xD7 ${sim.config.steps_per_frame} \u6B65 \xB7 dt ${fmt(sim.config.dt, 3)}`;
  }
  ui.statusHint.textContent = hint;
  const engineError = state.scene?.engine_error || null;
  const simError = sim.error || null;
  const message = simError || engineError;
  if (message) {
    if (state.dismissedError !== message) showBanner(message);
  } else {
    state.dismissedError = null;
    hideBanner();
  }
  ui.zoomBadge.textContent = `${Math.round(state.view.k * 100)}%`;
  ui.modePill.classList.toggle("circuit", state.mode === "circuit");
  ui.modePill.classList.toggle("vector", state.mode === "vector");
  ui.modePill.textContent = modeLabel(state.mode);
  updateScenePanelValues();
  schedulePhaseDraw();
}
function updateModeUI() {
  ui.modePill.classList.toggle("circuit", state.mode === "circuit");
  ui.modePill.classList.toggle("vector", state.mode === "vector");
  ui.modePill.textContent = modeLabel(state.mode);
  ui.statusMode.textContent = modeLabel(state.mode);
  ui.main.dataset.mode = state.mode;
  const modeHost = $('[data-role="mode"]');
  if (modeHost) {
    $$("button[data-mode]", modeHost).forEach((item) => {
      item.classList.toggle("active", item.dataset.mode === state.mode);
    });
  }
  const integration = $('[data-role="integration"]');
  if (integration) {
    integration.disabled = state.mode !== "circuit";
    if (state.scene) integration.value = state.scene.integration || "trapezoidal";
  }
  const integrationNote = $('[data-role="integration-note"]');
  if (integrationNote) {
    integrationNote.textContent = state.mode === "circuit" ? "\u68AF\u5F62\u6CD5\u7CBE\u5EA6\u9AD8\uFF1B\u540E\u5411\u6B27\u62C9\u66F4\u7A33\u5B9A\uFF0C\u9002\u5408\u521A\u6027\u7535\u8DEF\u3002" : "\u4EC5\u7535\u8DEF\u6A21\u5F0F\u4F7F\u7528\uFF1B\u4FE1\u53F7 / \u77E2\u91CF\u5C42\u7531\u6BCF\u6761\u8FDE\u63A5\u7684\u79BB\u6563\u5316\u53C2\u6570\u51B3\u5B9A\u3002";
  }
}
function updateRunButton(running) {
  ui.runBtn.classList.toggle("running", Boolean(running));
  ui.runBtn.setAttribute("aria-pressed", running ? "true" : "false");
  ui.runIcon.textContent = running ? "\u23F8" : "\u25B6";
  ui.runLabel.textContent = running ? "\u6682\u505C" : "\u8FD0\u884C";
  ui.runBtn.title = running ? "\u6682\u505C\uFF08\u7A7A\u683C\uFF09" : "\u8FD0\u884C\uFF08\u7A7A\u683C\uFF09";
}
function updateSignalKeyCache() {
  const keys = Array.isArray(state.sim?.probe_keys) ? state.sim.probe_keys : [];
  const rawLabels = state.sim?.probe_labels;
  const labels = rawLabels && typeof rawLabels === "object" ? rawLabels : {};
  const signature = keys.join("") + "" + JSON.stringify(labels);
  if (signature === state.probeSignature) return;
  state.probeSignature = signature;
  state.probeKeys = keys.map((key) => labels[key] || key);
  state.probeLabels = labels;
  if (!keys.length) {
    renderSignalList();
    fillInstrumentSelects();
    scheduleChartDraw();
    return;
  }
  const available = new Set(state.probeKeys);
  for (const key of Array.from(state.chart.selected)) {
    if (!available.has(key)) state.chart.selected.delete(key);
  }
  if (state.chart.selected.size === 0) {
    state.probeKeys.slice(0, 2).forEach((key) => state.chart.selected.add(key));
  }
  renderSignalList();
  fillInstrumentSelects();
  scheduleChartDraw();
}
function ingestFrame(frame) {
  if (!frame || !frame.v) return;
  for (const [key, raw] of Object.entries(frame.v)) {
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    state.values.set(key, raw);
    if (key.startsWith("n:")) {
      const rest = key.slice(2);
      const cut = rest.lastIndexOf(":");
      if (cut > 0) {
        const name = rest.slice(0, cut);
        const field = rest.slice(cut + 1);
        let bucket = state.nodeValues.get(name);
        if (!bucket) {
          bucket = {};
          state.nodeValues.set(name, bucket);
        }
        bucket[field] = raw;
      }
    } else if (key.startsWith("e:")) {
      const rest = key.slice(2);
      const cut = rest.lastIndexOf(":");
      if (cut > 0) {
        const name = rest.slice(0, cut);
        const field = rest.slice(cut + 1);
        let bucket = state.edgeValues.get(name);
        if (!bucket) {
          bucket = {};
          state.edgeValues.set(name, bucket);
        }
        bucket[field] = raw;
      }
    }
  }
}
function resizeGraph() {
  const rect = stage.getBoundingClientRect();
  const dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  state.canvasSize = { w: width, h: height, dpr };
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  requestDraw();
}
function resizeChart() {
  const wrap = $(".chart-wrap");
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  const dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  state.chartSize = { w: width, h: height, dpr };
  chartCanvas.width = Math.max(1, Math.round(width * dpr));
  chartCanvas.height = Math.max(1, Math.round(height * dpr));
  scheduleChartDraw();
}
function circuitPinSegments(edge, source, target) {
  if (state.scene?.mode !== "circuit" || state.ui?.symbol !== "gb" || !edge.layout) return null;
  const pins = elementPins(edge);
  if (pins.length !== 2) return null;
  const start = edgeAnchorTowards(source, target);
  const end = edgeAnchorTowards(target, source);
  const pin1 = pinScreenPoint(edge, pins[0], [start, end]);
  const pin2 = pinScreenPoint(edge, pins[1], [start, end]);
  const horizontal = Math.abs(Math.cos(elementRot(edge))) > 0.5;
  const before = horizontal ? [start, { x: pin1.x, y: start.y }, { x: pin1.x, y: pin1.y }, pin1] : [start, { x: start.x, y: pin1.y }, { x: pin1.x, y: pin1.y }, pin1];
  const after = horizontal ? [pin2, { x: pin2.x, y: end.y }, { x: end.x, y: end.y }, end] : [pin2, { x: pin2.x, y: end.y }, { x: end.x, y: end.y }, end];
  return { before, after };
}
function fitView(announce = false) {
  const nodes = state.scene?.nodes || [];
  const { w, h } = state.canvasSize;
  if (!nodes.length) {
    state.view = { x: w / 2, y: h / 2, k: 1 };
    requestDraw();
    return;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.position.x - NODE_W / 2);
    maxX = Math.max(maxX, node.position.x + NODE_W / 2);
    minY = Math.min(minY, node.position.y - NODE_H / 2);
    maxY = Math.max(maxY, node.position.y + NODE_H / 2);
  }
  const margin = 90;
  const boxW = Math.max(1, maxX - minX + margin * 2);
  const boxH = Math.max(1, maxY - minY + margin * 2);
  const k = clamp(Math.min(w / boxW, h / boxH), 0.12, 1.5);
  state.view = {
    k,
    x: w / 2 - (minX + maxX) / 2 * k,
    y: h / 2 - (minY + maxY) / 2 * k
  };
  requestDraw();
  ui.zoomBadge.textContent = `${Math.round(k * 100)}%`;
  if (announce) toast("\u5DF2\u9002\u914D\u89C6\u56FE", "info", 1200);
}
function zoomAt(factor, screenX, screenY) {
  const next = clamp(state.view.k * factor, 0.12, 3.2);
  const ratio = next / state.view.k;
  state.view.x = screenX - (screenX - state.view.x) * ratio;
  state.view.y = screenY - (screenY - state.view.y) * ratio;
  state.view.k = next;
  ui.zoomBadge.textContent = `${Math.round(next * 100)}%`;
  requestDraw();
}
function zoomCenter(factor) {
  zoomAt(factor, state.canvasSize.w / 2, state.canvasSize.h / 2);
}
function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}
function hitTest(x, y) {
  const nodes = state.scene?.nodes || [];
  if (!nodes.length) return null;
  if (state.scene?.mode === "circuit" && state.view.k > 0.25) {
    const radius = Math.max(7, 7 * state.view.k);
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index];
      if (node.kind !== "device") continue;
      for (const pin of devicePins(node)) {
        const point = devicePinScreen(node, pin.name);
        if (distance(x, y, point.x, point.y) <= radius) {
          return { type: "pin", id: node.id, node, pin: pin.name };
        }
      }
    }
  }
  if (state.view.k > 0.25) {
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index];
      const out = portOut(node);
      if (distance(x, y, out.x, out.y) <= Math.max(9, 8 * state.view.k)) {
        return { type: "port", id: node.id, node };
      }
    }
  }
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    const rect = nodeRect(node);
    if (rect.shape === "rect" ? x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h : distance(x, y, rect.cx, rect.cy) <= rect.r + 1) {
      return { type: "node", id: node.id, node };
    }
  }
  const edges = (state.scene?.edges || []).slice().reverse();
  const crossingMap = circuitCrossingMap(edges);
  const occupiedLabels = [];
  for (const edge of edges) {
    const points = edgePathPoints(edge);
    if (!points) continue;
    const minX = Math.min(...points.map((p) => p.x)) - 9;
    const maxX = Math.max(...points.map((p) => p.x)) + 9;
    const minY = Math.min(...points.map((p) => p.y)) - 9;
    const maxY = Math.max(...points.map((p) => p.y)) + 9;
    if (x < minX || x > maxX || y < minY || y > maxY) continue;
    if (distanceToPath(x, y, points) <= 7) {
      return { type: "edge", id: edge.id, edge };
    }
  }
  return null;
}
function nearestNodeWithin(x, y, margin = 24) {
  const nodes = state.scene?.nodes || [];
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    const rect = nodeRect(node);
    if (rect.shape === "rect" ? x >= rect.x - margin && x <= rect.x + rect.w + margin && y >= rect.y - margin && y <= rect.y + rect.h + margin : distance(x, y, rect.cx, rect.cy) <= rect.r + margin) {
      return node;
    }
  }
  return null;
}
export {
  circuitPinSegments,
  colorForKey,
  distance,
  fitView,
  hitTest,
  ingestFrame,
  nearestNodeWithin,
  resizeChart,
  resizeGraph,
  runTask,
  setStatusHint,
  syncUI,
  updateModeUI,
  updateRunButton,
  updateSignalKeyCache,
  zoomAt,
  zoomCenter
};
