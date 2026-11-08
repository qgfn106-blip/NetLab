import { fmt, intText, clamp, hashString } from "./app.utils.js";
import {
  CANVAS_LIGHT,
  CANVAS_DARK
} from "./theme.tokens.js";
import { UI_BUILD, PALETTE, NODE_W, NODE_H, CHART_KEYS, MAX_IMPORT_BYTES, MAX_FRAMES } from "./app/constants.js";
import { $, $$, stage, canvas, ctx, chartCanvas, chartCtx } from "./app/dom.js";
import { state, ui } from "./app/state.js";
import { el, div, button, clone, isFormTarget } from "./app/ui.js";
import { toast, showBanner, hideBanner } from "./app/desktop.js";
import { api, jsonRequest, plotkitFrameUrl } from "./app/net.js";
import { openCacheDialog, checkCacheQuietly } from "./app/cache.js";
import { placeFloatWindow, placeDocWindow, raiseFloatWindow, initFloatWindow } from "./app/float.js";
import { chartPalette, themeKey } from "./app/theme.js";
import { hexToRgbString, mixHex } from "./app/color.js";
import { THEME_TOKENS, C, tokens, setRuntimeOverride } from "./app/colors.js";
import { kindListFor, numberedField, trimNumber } from "./app/fields.js";
import { buildParamField, collectParamValues, setTypeLabelHelp } from "./app/param_fields.js";
import { hideHelpCard, showHelpCard, typeLabelHelp, paramRangeText, setSwitchTab } from "./app/help_card.js";
import { activeTab, modeLabel, selectedNode, selectedEdge, nodeById, edgeById, getNodeSpec, getEdgeSpec, specDefaults, uniqueNodeName } from "./app/model.js";
import { drawEdges } from "./app/canvas_edges.js";
import { drawPhase, phaseFrameCount, phaseStateKeys, renderVectorNodeList, resizePhase, schedulePhaseDraw, setPhaseIndex, stopPhasePlay, togglePhasePlay } from "./app/phase.js";
import { setInstrumentActions, fillInstrumentSelects, drawInstruments, resizeInstrument, initInstruments } from "./app/instruments.js";
import { circuitCrossingMap, circuitPinPath, drawGrid, edgeAnchorTowards, pinScreenPoint, wirePathPoints } from "./app/canvas_base.js";
import { drawNodes } from "./app/canvas_nodes.js";
import { section, renderEmptyInspector, setEmptyInspectorActions } from "./app/inspector_shell.js";
import { isPinNode, devicePins } from "./app/device_pins.js";
import { renderNodeInspector, renderEdgeInspector, applyInspector, updateInspectorLive, setInspectorActions } from "./app/inspector.js";
import { renderSpecPane, scheduleSpecRender, renderExtensionPanel, setSpecPanelActions } from "./app/spec_panel.js";
import { AUTOSAVE_ENABLED_KEY, setProjectActions, setProjectFileInput, markProjectDirty, updateProjectPanel, projectDownloadText as downloadText, saveProject, importProjectText, openProject, newProject, recoverAutosave, maybeOfferRecovery, initProject } from "./app/project.js";
import { setGeometryActions, worldToScreen, screenToWorld, nodeDiameter, nodeRect, devicePinScreen, snapWorld, portOut, portIn, edgeEndpointHit, waypointHitAt, anchorSideFor, edgePathPoints, pathMidpoint, distanceToPath } from "./app/geometry.js";
import { analysisSignalKey, runAnalysisMetrics, runAnalysisSpectrum, runAnalysisPeriod, runAnalysisMath, runAnalysisTransfer, analysisTFSummary, runAnalysisTF, drawAnalysisTF, exportTFStateSpace, sendTFToPlotKit, sendPhaseToPlotKit, exportAnalysisCsv, drawAnalysisSpectrum, setAnalysisActions } from "./app/analysis.js";
import { elementPins, elementRot } from "./app/circuit_symbols.js";
(() => {
  "use strict";
  let projectFileInput = null;
  function colorForKey(key) {
    const palette = chartPalette();
    const raw = palette[hashString(key) % palette.length];
    const mode = String(state.prefs && state.prefs.chartPalette || "theme");
    return mode === "theme" ? C(raw) : raw;
  }
  async function task(run, options = {}) {
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
  function applySnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object" || !snapshot.scene) return;
    const sim = snapshot.sim || state.sim;
    const previousCursor = state.cursor;
    const resetFrames = !state.sim || sim && sim.steps === 0 && sim.time === 0;
    state.scene = snapshot.scene;
    state.sim = sim;
    const nextRevision = snapshot.scene.revision ?? null;
    if (state.acResult && state.acRevision !== null && nextRevision !== state.acRevision) {
      state.acResult = null;
      const acMeta = $("#analAcMeta");
      if (acMeta) acMeta.textContent = "\u7535\u8DEF\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u626B\u9891";
      if (ui.analWin && !ui.analWin.hidden) requestAnimationFrame(() => drawAcChart());
    }
    state.acRevision = nextRevision;
    if (resetFrames || state.precomputedRevision != null && nextRevision !== state.precomputedRevision) {
      state.precomputedSeconds = null;
      state.precomputedRevision = null;
    }
    if (snapshot.limits) state.limits = snapshot.limits;
    state.mode = state.scene.mode || state.mode;
    if (resetFrames || sim && Number(sim.cursor) < previousCursor) {
      state.frames = [];
      state.values.clear();
      state.nodeValues.clear();
      state.edgeValues.clear();
      state.cursor = Number(sim?.cursor) || 0;
      scheduleChartDraw();
    }
    if (state.selection.type && !lookupSelection()) {
      clearSelection();
    }
    const liveNodes = new Set((state.scene?.nodes || []).map((node) => node.id));
    const liveEdges = new Set((state.scene?.edges || []).map((edge) => edge.id));
    let staleSelection = false;
    for (const id of [...state.multi?.nodes || []]) {
      if (!liveNodes.has(id)) {
        state.multi.nodes.delete(id);
        staleSelection = true;
      }
    }
    for (const id of [...state.multi?.edges || []]) {
      if (!liveEdges.has(id)) {
        state.multi.edges.delete(id);
        staleSelection = true;
      }
    }
    if (staleSelection) requestDraw();
    updateModeUI();
    syncUI();
    updateInfoBar();
    const degraded = sim && sim.degraded;
    if (degraded && degraded.read_only) {
      const missing = (degraded.missing || []).map((item) => `${item.id}@v${item.version}`).join("\u3001");
      showBanner(`\u964D\u7EA7\u53EA\u8BFB\uFF1A${degraded.message}${missing ? `\uFF08\u7F3A\u5931\uFF1A${missing}\uFF09` : ""}`);
      state.degradedBanner = true;
    } else if (state.degradedBanner) {
      state.degradedBanner = false;
      hideBanner();
    }
    updateScenePanelValues();
    updateSignalKeyCache();
    requestDraw();
    updateInspectorLive();
    renderVectorNodeList();
    schedulePhaseDraw();
  }
  function lookupSelection() {
    if (state.selection.type === "node") return nodeById(state.selection.id);
    if (state.selection.type === "edge") return edgeById(state.selection.id);
    return null;
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
  function frameCap() {
    const keys = Math.max(1, Number(state.sim?.probe_keys?.length) || state.values.size || 1);
    return Math.min(MAX_FRAMES, Math.max(600, Math.floor(25e4 / keys)));
  }
  function updateSignalKeyCache() {
    const keys = Array.isArray(state.sim?.probe_keys) ? state.sim.probe_keys : [];
    const signature = keys.join("");
    if (signature === state.probeSignature) return;
    state.probeSignature = signature;
    state.probeKeys = keys;
    if (!keys.length) {
      renderSignalList();
      fillInstrumentSelects();
      scheduleChartDraw();
      return;
    }
    const available = new Set(keys);
    for (const key of Array.from(state.chart.selected)) {
      if (!available.has(key)) state.chart.selected.delete(key);
    }
    if (state.chart.selected.size === 0) {
      keys.slice(0, 2).forEach((key) => state.chart.selected.add(key));
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
  function roundRectPath(context, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    context.beginPath();
    context.moveTo(x + radius, y);
    context.lineTo(x + w - radius, y);
    context.quadraticCurveTo(x + w, y, x + w, y + radius);
    context.lineTo(x + w, y + h - radius);
    context.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    context.lineTo(x + radius, y + h);
    context.quadraticCurveTo(x, y + h, x, y + h - radius);
    context.lineTo(x, y + radius);
    context.quadraticCurveTo(x, y, x + radius, y);
    context.closePath();
  }
  const SHEET_SIZES = {
    A4: { w: 297, h: 210, label: "A4" },
    A3: { w: 420, h: 297, label: "A3" },
    A2: { w: 594, h: 420, label: "A2" },
    A1: { w: 841, h: 594, label: "A1" }
  };
  function drawDrawingFrame(width, height) {
    if (state.scene?.mode !== "circuit") return;
    const sheet = SHEET_SIZES[String(state.ui?.drawingSheet || "A3")] || SHEET_SIZES.A3;
    const page = Math.max(1, Math.min(9, Number(state.ui?.drawingPage) || 1));
    const margin = 12;
    const scale = Math.min((width - margin * 2) / sheet.w, (height - margin * 2) / sheet.h);
    const pw = sheet.w * scale;
    const ph = sheet.h * scale;
    const x = (width - pw) / 2;
    const y = (height - ph) / 2;
    ctx.save();
    ctx.fillStyle = C("#fffdf8");
    ctx.fillRect(x, y, pw, ph);
    ctx.strokeStyle = C("#3b352c");
    ctx.lineWidth = 2.2;
    ctx.strokeRect(x, y, pw, ph);
    ctx.lineWidth = 0.9;
    ctx.strokeRect(x + 4, y + 4, pw - 8, ph - 8);
    const cols = 8;
    const rows = 6;
    ctx.font = '9px "Cascadia Code", Consolas, monospace';
    ctx.fillStyle = C("#5b554b");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 1; i < cols; i += 1) {
      const gx = x + pw * i / cols;
      ctx.beginPath();
      ctx.moveTo(gx, y + 4);
      ctx.lineTo(gx, y + 12);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(gx, y + ph - 4);
      ctx.lineTo(gx, y + ph - 12);
      ctx.stroke();
      ctx.fillText(String(i), gx, y + 16);
      ctx.fillText(String(i), gx, y + ph - 16);
    }
    for (let i = 1; i < rows; i += 1) {
      const gy = y + ph * i / rows;
      ctx.beginPath();
      ctx.moveTo(x + 4, gy);
      ctx.lineTo(x + 12, gy);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + pw - 4, gy);
      ctx.lineTo(x + pw - 12, gy);
      ctx.stroke();
      ctx.fillText(String.fromCharCode(64 + i), x + 16, gy);
      ctx.fillText(String.fromCharCode(64 + i), x + pw - 16, gy);
    }
    const boxW = Math.min(pw * 0.58, 180 * scale);
    const boxH = Math.min(ph * 0.22, 56 * scale);
    const bx = x + pw - 4 - boxW;
    const by = y + ph - 4 - boxH;
    ctx.fillStyle = C("#fffdf8");
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = C("#3b352c");
    ctx.lineWidth = 1.1;
    ctx.strokeRect(bx, by, boxW, boxH);
    ctx.beginPath();
    ctx.moveTo(bx, by + boxH * 0.52);
    ctx.lineTo(bx + boxW, by + boxH * 0.52);
    ctx.moveTo(bx + boxW * 0.62, by);
    ctx.lineTo(bx + boxW * 0.62, by + boxH);
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillStyle = C("#11100e");
    ctx.font = '600 11px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.fillText(state.project?.name || "\u672A\u547D\u540D\u5DE5\u7A0B", bx + 8, by + 14);
    ctx.font = '9px "Cascadia Code", Consolas, monospace';
    ctx.fillStyle = C("#6f695f");
    ctx.fillText(`${state.currentNetwork?.name || "\u7F51\u7EDC"} \xB7 ${sheet.label} \xB7 \u7B2C ${page} \u9875`, bx + 8, by + 30);
    ctx.fillText(`\u6BD4\u4F8B 1:1 \xB7 ${pipeModeLabel(state.scene?.mode || "")}`, bx + 8, by + boxH - 12);
    ctx.textAlign = "right";
    ctx.fillText("NetLab / GB", bx + boxW - 8, by + 14);
    ctx.fillText((/* @__PURE__ */ new Date()).toISOString().slice(0, 10), bx + boxW - 8, by + boxH - 12);
    ctx.restore();
  }
  function pipeModeLabel(mode) {
    if (mode === "circuit") return "\u7535\u8DEF";
    if (mode === "vector") return "\u77E2\u91CF\u573A";
    if (mode === "signal") return "\u4FE1\u53F7\u6D41";
    return mode;
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
  function drawLinkPreview() {
    const tool = state.wireTool;
    if (tool?.first) {
      const first = tool.first;
      const node = nodeById(first.nodeId);
      if (!node) return;
      const start2 = first.kind === "pin" ? devicePinScreen(node, first.pin) : worldToScreen(node.position || { x: 0, y: 0 });
      const end2 = state.pointer ? { x: state.pointer.x, y: state.pointer.y } : start2;
      ctx.save();
      ctx.strokeStyle = C("rgba(168, 84, 31, .55)");
      ctx.lineWidth = 1.7;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(start2.x, start2.y);
      ctx.lineTo(end2.x, end2.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(start2.x, start2.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = C("rgba(168, 84, 31, .25)");
      ctx.fill();
      ctx.strokeStyle = C("#a8541f");
      ctx.stroke();
      ctx.restore();
      return;
    }
    const drag = state.drag;
    if (!drag || drag.type !== "link" && drag.type !== "pin") return;
    const source = nodeById(drag.sourceId);
    if (!source) return;
    const start = drag.type === "pin" ? devicePinScreen(source, drag.pin) : portOut(source);
    const target = drag.targetId ? nodeById(drag.targetId) : null;
    const end = target ? portIn(target) : { x: state.pointer.x, y: state.pointer.y };
    const bend = Math.max(34, Math.abs(end.x - start.x) * 0.35);
    ctx.save();
    ctx.strokeStyle = target ? C("#a8541f") : C("rgba(168, 84, 31, .45)");
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.bezierCurveTo(start.x + bend, start.y, end.x - bend, end.y, end.x, end.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(end.x, end.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = C("#a8541f");
    ctx.fill();
    ctx.restore();
  }
  function drawGraph() {
    const { w, h, dpr } = state.canvasSize;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawGrid(w, h);
    if (!state.scene || !(state.scene.nodes || []).length) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = C("#8e8477");
      ctx.font = '13px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillText("\u753B\u5E03\u4E3A\u7A7A \xB7 \u70B9\u51FB\u5DE6\u4FA7\u300C\u8282\u70B9\u300D\u6216\u4ECE\u300C\u573A\u666F\u300D\u8F7D\u5165\u6A21\u677F", w / 2, h / 2);
      ctx.font = '10px "Cascadia Code", Consolas, monospace';
      ctx.fillStyle = C("#a49a89");
      ctx.fillText("\u62D6\u62FD\u79FB\u52A8 \xB7 \u4ECE\u53F3\u4FA7\u7AEF\u53E3\u62D6\u51FA\u8FDE\u63A5 \xB7 \u6EDA\u8F6E\u7F29\u653E \xB7 \u53CC\u51FB\u7F16\u8F91", w / 2, h / 2 + 24);
      ctx.restore();
      return;
    }
    drawEdges(performance.now());
    drawLinkPreview();
    drawNodes();
    drawSelectionBox();
    drawDragHud();
    if (state.ui?.drawingMode) drawDrawingFrame(w, h);
  }
  function drawSelectionBox() {
    const drag = state.drag;
    if (!drag || drag.type !== "box") return;
    const x = Math.min(drag.startX, drag.x);
    const y = Math.min(drag.startY, drag.y);
    const w = Math.abs(drag.x - drag.startX);
    const h = Math.abs(drag.y - drag.startY);
    ctx.save();
    const dark = themeKey() === "dark";
    ctx.fillStyle = dark ? "rgba(197, 161, 107, .16)" : "rgba(168, 84, 31, .10)";
    ctx.strokeStyle = dark ? "rgba(197, 161, 107, .70)" : "rgba(168, 84, 31, .65)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.restore();
  }
  function drawDragHud() {
    const { w, h } = state.canvasSize;
    const drag = state.drag;
    let target = null;
    let label = "";
    if (drag && drag.type === "waypoint") {
      const edge = edgeById(drag.id);
      const point = edge?.waypoints?.[drag.index];
      if (point) {
        target = worldToScreen(point);
        label = `\u62D0\u70B9 ${drag.index + 1}`;
      }
    } else if (drag && drag.type === "node") {
      const node = nodeById(drag.id);
      if (node?.position) {
        target = worldToScreen(node.position);
        label = "\u8282\u70B9";
      }
    } else if (drag && drag.type === "endpoint") {
      const pointer = state.pointer;
      if (pointer) {
        target = { x: pointer.x, y: pointer.y };
        label = "\u7AEF\u70B9";
      }
    } else if (state.hoverWaypoint) {
      const edge = edgeById(state.hoverWaypoint.edgeId);
      const point = edge?.waypoints?.[state.hoverWaypoint.index];
      if (point) {
        target = worldToScreen(point);
        label = `\u62D0\u70B9 ${state.hoverWaypoint.index + 1}`;
      }
    }
    if (!target) return;
    const world = screenToWorld(target.x, target.y);
    ctx.save();
    ctx.strokeStyle = C("rgba(168, 84, 31, .28)");
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(0, target.y);
    ctx.lineTo(w, target.y);
    ctx.moveTo(target.x, 0);
    ctx.lineTo(target.x, h);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(target.x, target.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = C("rgba(168, 84, 31, .18)");
    ctx.fill();
    ctx.strokeStyle = C("#a8541f");
    ctx.lineWidth = 1.6;
    ctx.stroke();
    const text = `${label}  x ${world.x.toFixed(1)}  y ${world.y.toFixed(1)}`;
    ctx.font = '11px "Cascadia Code", Consolas, monospace';
    const padding = 7;
    const textWidth = ctx.measureText(text).width;
    const boxW = textWidth + padding * 2;
    const boxH = 22;
    let bx = target.x + 16;
    let by = target.y + 16;
    if (bx + boxW > w - 8) bx = target.x - 16 - boxW;
    if (by + boxH > h - 8) by = target.y - 16 - boxH;
    ctx.fillStyle = tokens().hudBg;
    ctx.strokeStyle = C("rgba(168, 84, 31, .75)");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(bx, by, boxW, boxH, 4) : ctx.rect(bx, by, boxW, boxH);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C("#5a3a24");
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, bx + padding, by + boxH / 2 + 0.5);
    ctx.restore();
  }
  function requestDraw() {
    state.needsDraw = true;
  }
  const __graphMs = [];
  function __dbgGraph(ms) {
    __graphMs.push(Math.round(ms * 10) / 10);
    if (__graphMs.length > 300) __graphMs.splice(0, 150);
    window.__graphMs = __graphMs;
  }
  function animationLoop(timestamp) {
    if (state.shuttingDown) return;
    if (state.workspace === "network") {
      if (state.sim?.running && timestamp - (state.lastPaint || 0) >= 33) {
        state.lastPaint = timestamp;
        state.needsDraw = false;
        const __g0 = performance.now();
        drawGraph();
        __dbgGraph(performance.now() - __g0);
      } else if (state.needsDraw) {
        state.needsDraw = false;
        const __g0 = performance.now();
        drawGraph();
        __dbgGraph(performance.now() - __g0);
      }
    }
    requestAnimationFrame(animationLoop);
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
  function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
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
  function bindCanvas() {
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("pointerleave", () => {
      if (state.drag) return;
      if (state.hoverWaypoint) {
        state.hoverWaypoint = null;
        requestDraw();
      }
      if (ui.statusCursor) ui.statusCursor.textContent = "x \u2014  y \u2014";
      if (state.hover) {
        state.hover = null;
        requestDraw();
        canvas.style.cursor = "default";
      }
    });
    canvas.addEventListener("dblclick", onDoubleClick);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button === 1) {
        event.preventDefault();
      }
    });
  }
  function onPointerDown(event) {
    if (event.button === 2) return;
    closePopups();
    const point = pointerPosition(event);
    state.pointer = { ...point, ...screenToWorld(point.x, point.y) };
    if (event.button === 1) {
      state.drag = {
        type: "pan",
        startX: point.x,
        startY: point.y,
        viewX: state.view.x,
        viewY: state.view.y
      };
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = "grabbing";
      event.preventDefault();
      return;
    }
    const primaryNode = selectedNode();
    if (state.wireTool && event.button === 0) {
      const endpoint = wireToolEndpointAt(point);
      if (!endpoint) {
        toast("\u8BF7\u70B9\u51FB\u7F51\u7EDC\u8282\u70B9\u6216\u5668\u4EF6\u5F15\u811A\uFF08Esc \u53D6\u6D88\u5BFC\u7EBF\u5DE5\u5177\uFF09", "info", 2400);
        return;
      }
      if (!state.wireTool.first) {
        state.wireTool.first = endpoint;
        if (ui.statusHint) ui.statusHint.textContent = "\u5BFC\u7EBF\u5DE5\u5177\uFF1A\u8D77\u70B9\u5DF2\u9009\uFF0C\u70B9\u51FB\u7B2C\u4E8C\u4E2A\u7AEF\u70B9\uFF08Esc \u53D6\u6D88\uFF09";
        requestDraw();
      } else {
        void completeWireTool(endpoint);
      }
      event.preventDefault();
      return;
    }
    if (primaryNode && !event.ctrlKey && !event.metaKey) {
      const rect = nodeRect(primaryNode);
      const hx = rect.cx + rect.r - 2;
      const hy = rect.cy + rect.r - 2;
      if (Math.abs(point.x - hx) <= 8 && Math.abs(point.y - hy) <= 8) {
        state.drag = {
          type: "resize",
          id: primaryNode.id,
          startDiameter: nodeDiameter(primaryNode),
          startX: point.x,
          startY: point.y
        };
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = "nwse-resize";
        event.preventDefault();
        return;
      }
    }
    const primaryEdge = selectedEdge();
    if (primaryEdge && !event.ctrlKey && !event.metaKey) {
      const endpoint = edgeEndpointHit(point);
      if (endpoint) {
        const edgeRecord = edgeById(endpoint.id);
        state.drag = {
          type: "endpoint",
          id: endpoint.id,
          end: endpoint.end,
          anchor: edgeRecord?.anchors && edgeRecord.anchors[endpoint.end] || "auto",
          moved: false
        };
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = "crosshair";
        requestDraw();
        event.preventDefault();
        return;
      }
    }
    if (!event.ctrlKey && !event.metaKey) {
      const waypoint = waypointHitAt(point, true);
      if (waypoint) {
        if (state.selection.type !== "edge" || state.selection.id !== waypoint.edge.id) {
          state.selection = { type: "edge", id: waypoint.edge.id };
          state.inspectorDirty = false;
          renderInspector();
        }
        state.drag = { type: "waypoint", id: waypoint.edge.id, index: waypoint.index, moved: false };
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = "grabbing";
        requestDraw();
        event.preventDefault();
        return;
      }
    }
    if (primaryEdge && event.altKey) {
      const world = screenToWorld(point.x, point.y);
      const snapped = snapWorld(world.x, world.y, event.altKey);
      const waypoints = [...primaryEdge.waypoints || [], { x: snapped.x, y: snapped.y }];
      void patchEdgeGeometry(primaryEdge.id, { route: "manual", waypoints });
      return;
    }
    const hit = hitTest(point.x, point.y);
    if ((event.ctrlKey || event.metaKey) && hit && (hit.type === "node" || hit.type === "edge")) {
      toggleMultiSelection(hit.type, hit.id);
      event.preventDefault();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !hit) {
      state.drag = {
        type: "box",
        startX: point.x,
        startY: point.y,
        x: point.x,
        y: point.y
      };
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    if (hit && hit.type === "pin") {
      state.drag = {
        type: "pin",
        sourceId: hit.id,
        pin: hit.pin,
        startX: point.x,
        startY: point.y
      };
      canvas.setPointerCapture(event.pointerId);
      requestDraw();
      event.preventDefault();
      return;
    }
    if (hit && hit.type === "port") {
      state.drag = {
        type: "link",
        sourceId: hit.id,
        targetId: null,
        startX: point.x,
        startY: point.y
      };
      canvas.setPointerCapture(event.pointerId);
      requestDraw();
      event.preventDefault();
      return;
    }
    if (hit && hit.type === "node") {
      const node = hit.node;
      void selectEntity("node", node.id);
      state.drag = {
        type: "node",
        id: node.id,
        startX: point.x,
        startY: point.y,
        originX: node.position.x,
        originY: node.position.y,
        moved: false
      };
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = "grabbing";
      event.preventDefault();
      return;
    }
    if (hit && hit.type === "edge") {
      void selectEntity("edge", hit.id);
      drawGraph();
      return;
    }
    void selectEntity(null, null);
    state.drag = {
      type: "pan",
      startX: point.x,
      startY: point.y,
      viewX: state.view.x,
      viewY: state.view.y,
      moved: false
    };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grab";
  }
  function onPointerMove(event) {
    const point = pointerPosition(event);
    const world = screenToWorld(point.x, point.y);
    state.pointer = { ...point, ...world };
    const cursorText = `x ${world.x.toFixed(1)}  y ${world.y.toFixed(1)}`;
    if (ui.statusCursor && ui.statusCursor.textContent !== cursorText) {
      ui.statusCursor.textContent = cursorText;
    }
    if (!state.drag) {
      const waypoint = waypointHitAt(point, true);
      if (waypoint) {
        state.hoverWaypoint = { edgeId: waypoint.edge.id, index: waypoint.index };
        canvas.style.cursor = "grab";
        requestDraw();
        return;
      }
      if (state.hoverWaypoint) {
        state.hoverWaypoint = null;
        requestDraw();
      }
      if (edgeEndpointHit(point)) {
        canvas.style.cursor = "crosshair";
        return;
      }
      const hit = hitTest(point.x, point.y);
      const nextHover = hit ? { type: hit.type, id: hit.id } : null;
      const changed = (nextHover?.type || null) !== (state.hover?.type || null) || (nextHover?.id || null) !== (state.hover?.id || null);
      if (changed) {
        state.hover = nextHover;
        requestDraw();
      }
      if (!hit) canvas.style.cursor = "default";
      else if (hit.type === "port" || hit.type === "pin") canvas.style.cursor = "crosshair";
      else if (hit.type === "node") canvas.style.cursor = "grab";
      else canvas.style.cursor = "pointer";
      return;
    }
    const drag = state.drag;
    if (drag.type === "box") {
      drag.x = point.x;
      drag.y = point.y;
      requestDraw();
      return;
    }
    if (drag.type === "pan") {
      state.view.x = drag.viewX + (point.x - drag.startX);
      state.view.y = drag.viewY + (point.y - drag.startY);
      drag.moved = true;
      requestDraw();
      return;
    }
    if (drag.type === "resize") {
      const node = nodeById(drag.id);
      if (!node) return;
      const rect = nodeRect(node);
      const world2 = screenToWorld(point.x, point.y);
      const center = { x: node.position.x, y: node.position.y };
      const raw = Math.hypot(world2.x - center.x, world2.y - center.y) * 2;
      const snapped = state.ui?.snap && !event.altKey ? Math.round(raw / (Number(state.ui.grid) || 20)) * (Number(state.ui.grid) || 20) : raw;
      const diameter = clamp(snapped, 24, 200);
      state.drag.diameter = diameter;
      drag.diameter = diameter;
      node.size = { w: diameter };
      rect.r = diameter / 2 * state.view.k;
      drag.moved = true;
      requestDraw();
      return;
    }
    if (drag.type === "endpoint") {
      const edge = edgeById(drag.id);
      if (!edge) return;
      const node = nodeById(drag.end === "source" ? edge.source : edge.target);
      if (!node) return;
      const side = anchorSideFor(node, point);
      drag.anchor = side;
      edge.anchors = Object.assign({}, edge.anchors || {}, { [drag.end]: side });
      drag.moved = true;
      requestDraw();
      return;
    }
    if (drag.type === "waypoint") {
      const edge = edgeById(drag.id);
      if (!edge) return;
      const world2 = screenToWorld(point.x, point.y);
      const snapped = snapWorld(world2.x, world2.y, event.altKey);
      edge.waypoints[drag.index] = { x: snapped.x, y: snapped.y };
      drag.moved = true;
      requestDraw();
      return;
    }
    if (drag.type === "node") {
      const k = state.view.k;
      const node = nodeById(drag.id);
      if (!node) return;
      const rawX = clamp(drag.originX + (point.x - drag.startX) / k, -1e4, 1e4);
      const rawY = clamp(drag.originY + (point.y - drag.startY) / k, -1e4, 1e4);
      const snapped = snapWorld(rawX, rawY, event.altKey);
      node.position.x = snapped.x;
      node.position.y = snapped.y;
      drag.moved = true;
      requestDraw();
      return;
    }
    if (drag.type === "link") {
      const target = nearestNodeWithin(point.x, point.y, 18);
      drag.targetId = target && target.id !== drag.sourceId ? target.id : target ? target.id : null;
      requestDraw();
    }
  }
  function onPointerUp(event) {
    const drag = state.drag;
    state.drag = null;
    state.hoverWaypoint = null;
    canvas.style.cursor = "default";
    if (!drag) return;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch (error) {
    }
    if (drag.type === "box") {
      const x1 = Math.min(drag.startX, drag.x);
      const x2 = Math.max(drag.startX, drag.x);
      const y1 = Math.min(drag.startY, drag.y);
      const y2 = Math.max(drag.startY, drag.y);
      if (x2 - x1 > 3 && y2 - y1 > 3) {
        const nodes = (state.scene?.nodes || []).filter((node) => {
          const rect = nodeRect(node);
          return rect.cx >= x1 && rect.cx <= x2 && rect.cy >= y1 && rect.cy <= y2;
        });
        const nodeIds = new Set(nodes.map((node) => node.id));
        const edges = (state.scene?.edges || []).filter((edge) => {
          const points = edgePathPoints(edge);
          const middle = points ? pathMidpoint(points) : null;
          if (middle) return middle.x >= x1 && middle.x <= x2 && middle.y >= y1 && middle.y <= y2;
          return nodeIds.has(edge.source) && nodeIds.has(edge.target);
        });
        state.multi.nodes = new Set(nodes.map((node) => node.id));
        state.multi.edges = new Set(edges.map((edge) => edge.id));
        requestDraw();
        toast(`\u6846\u9009 ${nodes.length} \u8282\u70B9 / ${edges.length} \u8FDE\u63A5`, "info", 1800);
      }
      return;
    }
    if (drag.type === "node" && drag.moved) {
      queuePositionSave(drag.id);
    }
    if (drag.type === "resize" && drag.moved) {
      const node = nodeById(drag.id);
      if (node) void patchNodeGeometry(node.id, { size: { w: node.size?.w || nodeDiameter(node) } });
    }
    if (drag.type === "waypoint" && drag.moved) {
      const edge = edgeById(drag.id);
      if (edge) void patchEdgeGeometry(edge.id, { waypoints: edge.waypoints });
    }
    if (drag.type === "endpoint" && drag.moved) {
      const edge = edgeById(drag.id);
      if (edge) void patchEdgeGeometry(edge.id, { anchors: edge.anchors });
    }
    if (drag.type === "link") {
      const point = pointerPosition(event);
      const target = nearestNodeWithin(point.x, point.y, 18);
      if (target) {
        openLinkMenu(target.id, point.x, point.y, drag.sourceId);
      }
      requestDraw();
    }
    if (drag.type === "pin") {
      const point = pointerPosition(event);
      const target = nearestNodeWithin(point.x, point.y, 18);
      if (target && (target.kind === "node" || target.kind === "ground")) {
        void createWire(drag.sourceId, target.id, drag.pin);
      } else {
        toast("\u8BF7\u628A\u5F15\u811A\u62D6\u5230\u7F51\u7EDC\u8282\u70B9\uFF08\u7535\u5B66\u8282\u70B9/\u63A5\u5730\uFF09", "error", 3500);
      }
      requestDraw();
    }
  }
  function onDoubleClick(event) {
    const point = pointerPosition(event);
    const hit = hitTest(point.x, point.y);
    if (hit && hit.type === "node") {
      void selectEntity("node", hit.id, true);
      switchTab("inspect");
    } else if (hit && hit.type === "edge") {
      void selectEntity("edge", hit.id, true);
      switchTab("inspect");
    } else {
      openAddMenu(point.x, point.y);
    }
  }
  function onWheel(event) {
    event.preventDefault();
    const point = pointerPosition(event);
    const factor = Math.exp(-event.deltaY * 15e-4);
    zoomAt(factor, point.x, point.y);
  }
  async function deleteDeviceWires(nodeId) {
    const wires = (state.scene?.edges || []).filter(
      (edge) => edge.kind === "wire" && (edge.source === nodeId || edge.target === nodeId)
    );
    if (!wires.length) {
      toast("\u8BE5\u5668\u4EF6\u6CA1\u6709\u5BFC\u7EBF", "info", 2e3);
      return;
    }
    for (const wire of wires) await deleteEdge(wire.id);
    toast(`\u5DF2\u65AD\u5F00 ${wires.length} \u6761\u5BFC\u7EBF`, "ok", 2200);
  }
  async function convertNodeToGround(nodeId) {
    try {
      await jsonRequest(`/api/nodes/${encodeURIComponent(nodeId)}`, "PATCH", {
        kind: "ground",
        params: {},
        data: {},
        size: {}
      });
      await refreshState(true);
      toast("\u5DF2\u8BBE\u4E3A\u63A5\u5730\uFF08\u591A\u63A5\u5730\u81EA\u52A8\u5408\u5E76\u4E3A 0V\uFF09", "ok", 2600);
    } catch (error) {
      toast(`\u8BBE\u4E3A\u63A5\u5730\u5931\u8D25\uFF1A${error.message}`, "error", 4e3);
    }
  }
  function pinWires(nodeId, pinName) {
    return (state.scene?.edges || []).filter(
      (edge) => edge.kind === "wire" && (edge.source === nodeId && edge.source_pin === pinName || edge.target === nodeId && edge.target_pin === pinName)
    );
  }
  function wireToolEndpointAt(point) {
    const hit = hitTest(point.x, point.y);
    if (!hit) return null;
    if (hit.type === "pin") return { kind: "pin", nodeId: hit.id, pin: hit.pin };
    if (hit.type === "node" && (hit.node.kind === "node" || hit.node.kind === "ground")) {
      return { kind: "net", nodeId: hit.id };
    }
    return null;
  }
  function startWireTool(first = null) {
    state.wireTool = { first };
    const hint = first ? `\u5BFC\u7EBF\u5DE5\u5177\uFF1A\u8D77\u70B9\u5DF2\u9009\uFF0C\u70B9\u51FB\u7B2C\u4E8C\u4E2A\u7AEF\u70B9\uFF08\u7F51\u7EDC\u8282\u70B9\u6216\u5668\u4EF6\u5F15\u811A\uFF09` : "\u5BFC\u7EBF\u5DE5\u5177\uFF1A\u4F9D\u6B21\u70B9\u51FB\u4E24\u4E2A\u7AEF\u70B9\uFF08\u7F51\u7EDC\u8282\u70B9 / \u5668\u4EF6\u5F15\u811A\uFF09";
    if (ui.statusHint) ui.statusHint.textContent = hint;
    toast(hint, "info", 2600);
    requestDraw();
  }
  function cancelWireTool() {
    if (!state.wireTool) return;
    state.wireTool = null;
    if (ui.statusHint) ui.statusHint.textContent = "\u5C31\u7EEA";
    requestDraw();
  }
  async function completeWireTool(second) {
    const first = state.wireTool?.first;
    if (!first) return;
    let sourceId = "";
    let targetId = "";
    let sourcePin = "";
    if (first.kind === "pin" && second.kind === "net") {
      sourceId = first.nodeId;
      targetId = second.nodeId;
      sourcePin = first.pin;
    } else if (first.kind === "net" && second.kind === "pin") {
      sourceId = second.nodeId;
      targetId = first.nodeId;
      sourcePin = second.pin;
    } else if (first.kind === "net" && second.kind === "net") {
      sourceId = first.nodeId;
      targetId = second.nodeId;
    } else {
      toast("\u5BFC\u7EBF\u53EA\u5141\u8BB8\u300C\u5668\u4EF6\u5F15\u811A \u2194 \u7F51\u7EDC\u8282\u70B9\u300D\u6216\u300C\u7F51\u7EDC \u2194 \u7F51\u7EDC\u300D", "error", 3600);
      return;
    }
    cancelWireTool();
    await createWireBetween(sourceId, targetId, sourcePin, "");
  }
  function alignmentMenuItems() {
    return [
      { label: "\u5DE6\u5BF9\u9F50", action: () => void alignSelection("left") },
      { label: "\u53F3\u5BF9\u9F50", action: () => void alignSelection("right") },
      { label: "\u6C34\u5E73\u5C45\u4E2D", action: () => void alignSelection("centerX") },
      { label: "\u9876\u5BF9\u9F50", action: () => void alignSelection("top") },
      { label: "\u5E95\u5BF9\u9F50", action: () => void alignSelection("bottom") },
      { label: "\u5782\u76F4\u5C45\u4E2D", action: () => void alignSelection("centerY") },
      { sep: true },
      { label: "\u6A2A\u5411\u7B49\u8DDD\u5206\u5E03", action: () => void distributeSelection("x") },
      { label: "\u7EB5\u5411\u7B49\u8DDD\u5206\u5E03", action: () => void distributeSelection("y") }
    ];
  }
  function displayMenuItems() {
    return [
      { label: "\u6805\u683C", hint: state.ui?.showGrid !== false ? "\u5F53\u524D\uFF1A\u5F00" : "\u5F53\u524D\uFF1A\u5173", action: () => $("#stGrid")?.click() },
      { label: "\u5438\u9644", hint: state.ui?.snap !== false ? "\u5F53\u524D\uFF1A\u5F00" : "\u5F53\u524D\uFF1A\u5173", action: () => $("#stSnap")?.click() },
      { label: "\u6355\u6349\u70B9", hint: state.ui?.snapMarkers !== false ? "\u5F53\u524D\uFF1A\u5F00" : "\u5F53\u524D\uFF1A\u5173", action: () => $("#stSnapMark")?.click() },
      { label: "\u6B63\u4EA4\u5E03\u7EBF", hint: state.ui?.circuitOrthogonal !== false ? "\u5F53\u524D\uFF1A\u5F00" : "\u5F53\u524D\uFF1A\u5173", action: () => $("#stOrtho")?.click() }
    ];
  }
  function onContextMenu(event) {
    event.preventDefault();
    const point = pointerPosition(event);
    const hit = hitTest(point.x, point.y);
    const items = [];
    if (hit && hit.type === "pin") {
      const node = hit.node;
      const wires = pinWires(hit.id, hit.pin);
      items.push({
        label: "\u5F15\u811A\u4FE1\u606F",
        hint: `${node.name}.${hit.pin}${wires.length ? ` \xB7 ${wires.length} \u6761\u5BFC\u7EBF` : " \xB7 \u672A\u63A5\u7EBF"}`,
        action: () => toast(`${node.name}.${hit.pin}\uFF1A${wires.length ? `\u5DF2\u63A5 ${wires.length} \u6761\u5BFC\u7EBF` : "\u672A\u63A5\u7EBF"}`, "info", 3e3)
      });
      items.push({
        label: "\u4ECE\u6B64\u5F15\u811A\u5EFA\u7EBF\u2026",
        hint: "\u70B9\u51FB\u540E\u9009\u53E6\u4E00\u4E2A\u7F51\u7EDC\u8282\u70B9",
        action: () => startWireTool({ kind: "pin", nodeId: node.id, pin: hit.pin })
      });
      if (wires.length) {
        items.push({
          label: "\u65AD\u5F00\u8BE5\u5F15\u811A\u5BFC\u7EBF",
          hint: `${wires.length} \u6761`,
          danger: true,
          action: async () => {
            for (const wire of wires) await deleteEdge(wire.id);
            toast(`\u5DF2\u65AD\u5F00 ${node.name}.${hit.pin} \u7684 ${wires.length} \u6761\u5BFC\u7EBF`, "ok", 2400);
          }
        });
      }
      openGenericMenu(ui.linkMenu, point.x, point.y, `\u5F15\u811A \xB7 ${node.name}.${hit.pin}`, items);
      return;
    }
    if (hit && hit.type === "node") {
      const node = hit.node;
      const isDevice = node.kind === "device";
      items.push({
        label: isDevice ? "\u5668\u4EF6\u5C5E\u6027" : "\u8282\u70B9\u5C5E\u6027",
        hint: node.name,
        action: () => {
          void selectEntity("node", hit.id, true);
          switchTab("inspect");
        }
      });
      if (!isDevice && node.kind !== "ground" && state.mode === "circuit") {
        items.push({
          label: "\u8BBE\u4E3A\u63A5\u5730",
          hint: "\u591A\u63A5\u5730\u4F1A\u81EA\u52A8\u5408\u5E76\u4E3A 0V",
          action: () => void convertNodeToGround(hit.id)
        });
      }
      if (node.kind === "node" && state.mode === "circuit") {
        const marked = Boolean(node.params?.port_name);
        const current = node.params?.port_direction || "inout";
        const portName = marked ? String(node.params.port_name) : node.name;
        items.push({
          label: marked ? "\u6539\u7AEF\u53E3\u65B9\u5411" : "\u8BBE\u4E3A\u6A21\u5757\u7AEF\u53E3",
          hint: marked ? `\u5F53\u524D\u300C${portName}\u300D\xB7 ${MODULE_DIR_LABEL[current] || "\u53CC\u5411"}` : "\u5148\u9009\u65B9\u5411\uFF0C\u5C01\u88C5\u65F6\u6309\u65B9\u5411\u753B\u5F15\u811A",
          children: PORT_DIRECTION_CHOICES.map(([value, label, hint]) => ({
            label: `${label}${marked && value === current ? " \xB7 \u5F53\u524D" : ""}`,
            hint,
            action: () => void setNetPort(node.id, portName, value)
          }))
        });
        if (marked) {
          items.push({
            label: "\u53D6\u6D88\u6A21\u5757\u7AEF\u53E3",
            hint: `\u5F53\u524D\u7AEF\u53E3 ${portName}`,
            action: () => void setNetPort(node.id, "", "inout")
          });
        }
      }
      items.push({ label: "\u590D\u5236", hint: "Ctrl+C", action: () => copySelection(false) });
      if (isDevice) {
        items.push({
          label: "\u65AD\u5F00\u5168\u90E8\u5BFC\u7EBF",
          hint: "\u5668\u4EF6\u4FDD\u7559\uFF0C\u53EA\u5220\u5BFC\u7EBF",
          action: () => void deleteDeviceWires(hit.id)
        });
      }
      if ((state.multi?.nodes?.size || 0) > 1) {
        items.push({
          label: "\u5BF9\u9F50 / \u5206\u5E03",
          hint: `\u5F53\u524D\u591A\u9009 ${state.multi.nodes.size} \u4E2A`,
          children: [
            { label: "\u5DE6\u5BF9\u9F50", action: () => void alignSelection("left") },
            { label: "\u53F3\u5BF9\u9F50", action: () => void alignSelection("right") },
            { label: "\u6C34\u5E73\u5C45\u4E2D", action: () => void alignSelection("centerX") },
            { label: "\u9876\u5BF9\u9F50", action: () => void alignSelection("top") },
            { label: "\u5E95\u5BF9\u9F50", action: () => void alignSelection("bottom") },
            { label: "\u5782\u76F4\u5C45\u4E2D", action: () => void alignSelection("centerY") },
            { sep: true },
            { label: "\u6A2A\u5411\u7B49\u8DDD\u5206\u5E03", action: () => void distributeSelection("x") },
            { label: "\u7EB5\u5411\u7B49\u8DDD\u5206\u5E03", action: () => void distributeSelection("y") }
          ]
        });
      }
      items.push({ sep: true });
      items.push({
        label: isDevice ? "\u5220\u9664\u5668\u4EF6" : "\u5220\u9664\u8282\u70B9",
        hint: "\u540C\u65F6\u5220\u9664\u76F8\u8FDE\u8FDE\u63A5",
        danger: true,
        action: () => deleteNode(hit.id)
      });
      openGenericMenu(ui.linkMenu, point.x, point.y, `${isDevice ? "\u5668\u4EF6" : "\u8282\u70B9"} \xB7 ${node.name}`, items);
      return;
    }
    if (hit && hit.type === "edge") {
      items.push({
        label: "\u8FDE\u63A5\u5C5E\u6027",
        hint: hit.edge.name,
        action: () => {
          void selectEntity("edge", hit.id, true);
          switchTab("inspect");
        }
      });
      items.push({ label: "\u590D\u5236", hint: "Ctrl+C", action: () => copySelection(false) });
      if (hit.edge.kind === "wire") {
        items.push({
          label: "\u6DFB\u52A0\u62D0\u70B9\uFF08\u4E2D\u70B9\uFF09",
          action: () => void addWireWaypoint(hit.edge)
        });
        if ((hit.edge.waypoints || []).length) {
          items.push({
            label: "\u6E05\u9664\u62D0\u70B9",
            hint: "\u6062\u590D\u81EA\u52A8\u5E03\u7EBF",
            action: () => void clearWireWaypoints(hit.id)
          });
        }
        items.push({
          label: "\u9009\u4E2D\u6574\u6761\u7F51\u7EDC",
          hint: "\u540C\u7AEF\u70B9\u7684\u5BFC\u7EBF\u4E00\u8D77\u9009\u4E2D",
          action: () => selectWireNetwork(hit.edge)
        });
      }
      if (state.mode !== "circuit") {
        items.push({
          label: hit.edge.delay ? "\u53D6\u6D88\u5355\u6B65\u5EF6\u8FDF" : "\u8BBE\u4E3A\u5355\u6B65\u5EF6\u8FDF",
          hint: "\u7528\u4E8E\u5207\u65AD\u4EE3\u6570\u73AF",
          action: () => toggleEdgeDelay(hit.id)
        });
      }
      items.push({ sep: true });
      items.push({
        label: "\u5220\u9664\u8FDE\u63A5",
        hint: hit.edge.name,
        danger: true,
        action: () => deleteEdge(hit.id)
      });
      openGenericMenu(ui.linkMenu, point.x, point.y, `\u8FDE\u63A5 \xB7 ${hit.edge.name}`, items);
      return;
    }
    items.push({
      label: "\u6DFB\u52A0",
      hint: state.mode === "circuit" ? "\u8282\u70B9 / \u5668\u4EF6\uFF08\u6309\u5206\u7C7B\uFF09/ \u5BFC\u7EBF" : "\u8282\u70B9",
      children: buildAddMenuItems(point.x, point.y)
    });
    const modeChoices = state.catalog?.modes || [
      { value: "signal", label: "\u4FE1\u53F7\u6D41" },
      { value: "circuit", label: "\u7535\u8DEF" },
      { value: "vector", label: "\u77E2\u91CF\u573A" }
    ];
    items.push({
      label: `\u5207\u6362\u672C\u7F51\u7EDC\u6A21\u5F0F\uFF08\u5F53\u524D\uFF1A${modeLabel(state.mode)}\uFF09`,
      hint: "\u53EA\u5F71\u54CD\u5F53\u524D\u7F51\u7EDC",
      children: modeChoices.map((entry) => ({
        label: entry.value === state.mode ? `${entry.label}\uFF08\u5F53\u524D\uFF09` : entry.label,
        hint: entry.value === state.mode ? "\u5DF2\u662F\u5F53\u524D\u6A21\u5F0F" : "\u4F1A\u91CD\u5EFA\u672C\u7F51\u7EDC\u7684\u7A7A\u767D\u573A\u666F",
        action: entry.value === state.mode ? null : () => void switchMode(entry.value)
      }))
    });
    if (state.mode === "circuit") {
      items.push({
        label: "\u5BFC\u7EBF\u5DE5\u5177\uFF08\u70B9\u4E24\u7AEF\uFF09\u2026",
        hint: "\u4F9D\u6B21\u70B9\u51FB\u7F51\u7EDC\u8282\u70B9 / \u5668\u4EF6\u5F15\u811A\uFF1BEsc \u53D6\u6D88",
        action: () => startWireTool()
      });
    }
    items.push({ label: "\u663E\u793A", children: displayMenuItems() });
    const multiNodes = state.multi?.nodes?.size || 0;
    const multiEdges = state.multi?.edges?.size || 0;
    if (multiNodes > 1 || multiEdges > 0) {
      const multiItems = [];
      if (multiNodes > 1) {
        multiItems.push({
          label: "\u5BF9\u9F50 / \u5206\u5E03",
          hint: `${multiNodes} \u4E2A\u8282\u70B9`,
          children: alignmentMenuItems()
        });
        multiItems.push({
          label: "\u6279\u91CF\u8BBE\u7F6E\u5C3A\u5BF8\u2026",
          hint: "\u7EDF\u4E00\u5BBD / \u76F4\u5F84",
          action: () => void batchResizeSelection()
        });
        multiItems.push({ sep: true });
      }
      multiItems.push({
        label: "\u5220\u9664\u9009\u4E2D",
        hint: `\u8282\u70B9 ${multiNodes} / \u8FDE\u63A5 ${multiEdges}`,
        danger: true,
        action: () => void deleteSelection()
      });
      items.push({ label: `\u591A\u9009\uFF08${multiNodes} \u8282\u70B9 / ${multiEdges} \u8FDE\u63A5\uFF09`, children: multiItems });
    }
    items.push({ label: "\u7C98\u8D34", hint: "Ctrl+V", action: () => void pasteClipboard() });
    items.push({ label: "\u5168\u9009", hint: "Ctrl+A", action: () => selectAll() });
    items.push({ sep: true });
    items.push({ label: "\u64A4\u9500", hint: "Ctrl+Z", action: () => void undo() });
    items.push({ label: "\u91CD\u505A", hint: "Ctrl+Shift+Z", action: () => void redo() });
    items.push({ sep: true });
    items.push({
      label: state.sim?.running ? "\u6682\u505C" : "\u8FD0\u884C",
      hint: "\u7A7A\u683C",
      action: () => void control("toggle")
    });
    items.push({ label: "\u5355\u6B65", hint: "S", action: () => void control("step") });
    items.push({ sep: true });
    items.push({ label: "\u9002\u914D\u89C6\u56FE", action: () => fitView(true) });
    items.push({ label: "\u81EA\u52A8\u5E03\u5C40", action: () => void autoLayout() });
    openGenericMenu(ui.linkMenu, point.x, point.y, "\u753B\u5E03", items);
  }
  function queuePositionSave(nodeId) {
    const node = nodeById(nodeId);
    if (!node) return;
    state.dirtyPositions.set(nodeId, { x: node.position.x, y: node.position.y });
    clearTimeout(state.positionTimer);
    state.positionTimer = setTimeout(flushPositions, 180);
  }
  async function flushPositions() {
    if (!state.dirtyPositions.size) return;
    const items = Array.from(state.dirtyPositions.entries()).filter(([id]) => Boolean(nodeById(id))).map(([id, position]) => ({
      id,
      position: { x: Number(position.x.toFixed(3)), y: Number(position.y.toFixed(3)) }
    }));
    state.dirtyPositions.clear();
    if (!items.length) return;
    try {
      await jsonRequest("/api/positions", "POST", { positions: items });
    } catch (error) {
      toast(`\u4FDD\u5B58\u5750\u6807\u5931\u8D25\uFF1A${error.message}`, "error", 6e3);
      await refreshState(true);
    }
  }
  async function patchNodeGeometry(nodeId, payload) {
    const response = await task(
      () => jsonRequest(`/api/nodes/${encodeURIComponent(nodeId)}`, "PATCH", payload)
    );
    if (!response) return;
    await refreshState(true);
    renderInspector();
  }
  async function setNetPort(nodeId, portName, direction = "inout") {
    const node = nodeById(nodeId);
    if (!node) return;
    const params = portName ? { port_name: String(portName).slice(0, 24), port_direction: direction || "inout" } : {};
    const response = await task(
      () => jsonRequest(`/api/nodes/${encodeURIComponent(nodeId)}`, "PATCH", {
        name: node.name,
        kind: node.kind,
        params
      })
    );
    if (!response) return;
    await refreshState(true);
    renderInspector();
    toast(params.port_name ? `\u5DF2\u6807\u8BB0\u7AEF\u53E3\u300C${params.port_name}\u300D` : "\u5DF2\u53D6\u6D88\u7AEF\u53E3\u6807\u8BB0", "ok", 2200);
  }
  async function patchEdgeGeometry(edgeId, payload) {
    const response = await task(
      () => jsonRequest(`/api/edges/${encodeURIComponent(edgeId)}`, "PATCH", payload)
    );
    if (!response) return;
    await refreshState(true);
    renderInspector();
  }
  function scheduleChartDraw() {
    if (state.chartTimer) return;
    state.chartTimer = setTimeout(() => {
      state.chartTimer = 0;
      const tab = activeTab();
      if (tab === "chart") drawChart();
      else if (tab === "inst") drawInstruments();
    }, 70);
  }
  const PANEL_GROUPS = {
    inspect: { group: "inspect" },
    "node-fn": { group: "fn", role: "node" },
    "edge-fn": { group: "fn", role: "edge" },
    spec: { group: "fn" },
    blocks: { group: "modules", sub: "blocks" },
    ext: { group: "modules", sub: "ext" },
    chart: { group: "analysis", sub: "chart" },
    inst: { group: "analysis", sub: "inst" },
    vector: { group: "analysis", sub: "vector" },
    analysis: { group: "analysis", sub: "analysis" },
    plotkit: { group: "analysis", sub: "plotkit" },
    "wb-analysis": { group: "workbench", sub: "wb-analysis" },
    "wb-state": { group: "workbench", sub: "wb-state" }
  };
  function defaultTabForGroup(group) {
    if (group === "fn") return state.fnRole === "edge" ? "edge-fn" : "node-fn";
    if (group === "modules") {
      const sub = $('.panel-group[data-group="modules"] .group-subnav [data-sub].active');
      return sub ? sub.dataset.sub : "blocks";
    }
    if (group === "analysis") {
      const sub = $('.panel-group[data-group="analysis"] .group-subnav [data-sub].active');
      return sub ? sub.dataset.sub : "chart";
    }
    if (group === "workbench") {
      const sub = $('.panel-group[data-group="workbench"] .group-subnav [data-sub].active');
      return sub ? sub.dataset.sub : "wb-analysis";
    }
    return "inspect";
  }
  function setPanelGroup(group) {
    $$(".panel-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.group === group));
    $$(".panel-group").forEach((node) => node.classList.toggle("active", node.dataset.group === group));
  }
  function setGroupSub(group, sub) {
    const host = $(`.panel-group[data-group="${group}"]`);
    if (!host) return;
    const attr = group === "fn" ? "fnrole" : "sub";
    $$(`[data-${attr}]`, host).forEach((node) => {
      node.classList.toggle("active", node.dataset[attr] === sub);
    });
    if (group === "modules" || group === "analysis" || group === "workbench") {
      $$(".tab-pane", host).forEach((pane) => {
        pane.classList.toggle("hidden", pane.id !== `tab-${sub}`);
      });
    }
  }
  function switchTab(name) {
    if (name === "scene") {
      openSettings("project");
      return;
    }
    const conf = PANEL_GROUPS[name] || PANEL_GROUPS.inspect;
    if (conf.role) {
      state.fnRole = conf.role;
      state.specKind = "";
      setGroupSub("fn", conf.role);
    }
    setPanelGroup(conf.group);
    if (conf.sub) setGroupSub(conf.group, conf.sub);
    if (conf.group === "fn") {
      const note = $("#fnNote");
      if (note) note.textContent = state.fnRole === "edge" ? "\u8FDE\u63A5\u51FD\u6570" : "\u8282\u70B9\u51FD\u6570";
      renderSpecPane();
      requestDraw();
    }
    if (conf.sub === "chart") {
      resizeChart();
      scheduleChartDraw();
    }
    if (conf.sub === "vector") {
      resizePhase();
      renderVectorNodeList();
      drawPhase();
    }
    if (conf.sub === "plotkit") {
      $("#btnOpenPlotkit")?.focus({ preventScroll: true });
    }
    notifyPlotkit(conf.sub === "plotkit");
    if (conf.sub === "analysis") {
      renderAnalysisPanel();
    }
    if (conf.sub === "wb-analysis") {
      renderWorkbenchAnalysis();
    }
    if (conf.sub === "wb-state") {
      void renderWorkbenchState();
    }
    if (conf.sub === "blocks") {
      renderBlocksPanel();
    }
    if (conf.sub === "ext") {
      renderExtensionPanel();
    }
  }
  function plotkitFrames() {
    return [$("#plotkitFrame"), $("#plotkitInlineHost iframe")].filter(Boolean);
  }
  function notifyPlotkit(visible) {
    for (const frame of plotkitFrames()) {
      try {
        frame.contentWindow?.postMessage({ type: "plotkit-visibility", visible: Boolean(visible) }, "*");
      } catch (err) {
      }
    }
    const want = Boolean(visible);
    if (want !== state.plotkitActive) {
      state.plotkitActive = want;
      api("/api/plotkit/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: want })
      }).catch(() => {
      });
    }
  }
  function positionPopup(popup, x, y) {
    popup.classList.remove("hidden");
    popup.style.left = "0px";
    popup.style.top = "0px";
    const stageRect = stage.getBoundingClientRect();
    const width = popup.offsetWidth;
    const height = popup.offsetHeight;
    const left = clamp(x, 8, Math.max(8, stageRect.width - width - 8));
    const top = clamp(y, 8, Math.max(8, stageRect.height - height - 8));
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  }
  function closePopups() {
    ui.addMenu.classList.add("hidden");
    ui.linkMenu.classList.add("hidden");
  }
  function openGenericMenu(popup, x, y, title, items) {
    popup.replaceChildren();
    popup.appendChild(div("popup-title", title));
    for (const item of items) {
      if (item.sep) {
        popup.appendChild(div("popup-sep"));
        continue;
      }
      if (Array.isArray(item.children)) {
        const node2 = el("button", "popup-item");
        node2.type = "button";
        node2.appendChild(el("strong", null, `${item.label}  \u25B8`));
        if (item.hint) node2.appendChild(el("small", null, item.hint));
        node2.addEventListener("click", (event) => {
          event.stopPropagation();
          const children = [
            ...item.children,
            { sep: true },
            {
              label: "\u2039 \u8FD4\u56DE",
              action: () => openGenericMenu(popup, x, y, title, items)
            }
          ];
          openGenericMenu(popup, x, y, `${title} \u203A ${item.label}`, children);
        });
        popup.appendChild(node2);
        continue;
      }
      const node = el("button", "popup-item");
      node.type = "button";
      const strong = el("strong", null, item.label);
      if (item.danger) strong.style.color = "var(--text-button-danger)";
      node.appendChild(strong);
      if (item.hint) node.appendChild(el("small", null, item.hint));
      node.addEventListener("click", () => {
        closePopups();
        item.action();
      });
      popup.appendChild(node);
    }
    positionPopup(popup, x, y);
  }
  const ELEMENT_GROUP_ORDER = [
    "\u57FA\u7840\u65E0\u6E90",
    "\u7535\u6E90",
    "\u53D7\u63A7\u6E90",
    "\u4E8C\u6781\u7BA1",
    "\u5F00\u5173",
    "\u653E\u5927\u4E0E\u6BD4\u8F83",
    "\u6676\u4F53\u7BA1",
    "\u6570\u5B57\u4E0E\u903B\u8F91",
    "\u8BA1\u65F6\u4E0E\u7535\u6E90\u7BA1\u7406",
    "\u78C1\u6027"
  ];
  const COMPUTE_GROUP_ORDER = ["\u57FA\u7840", "\u52A8\u6001", "\u9AD8\u7EA7", "\u77E2\u91CF", "\u6A21\u5757", "\u63A5\u53E3"];
  function buildAddMenuItems(placeX, placeY) {
    const list = kindListFor("node");
    const items = [];
    if (state.mode !== "circuit") {
      const byGroup = /* @__PURE__ */ new Map();
      for (const spec of list) {
        if (spec.addable === false) continue;
        const group = String(spec.group || "\u672A\u5206\u7C7B");
        if (!byGroup.has(group)) byGroup.set(group, []);
        byGroup.get(group).push(spec);
      }
      const order = state.mode === "vector" ? ["\u77E2\u91CF", ...COMPUTE_GROUP_ORDER.filter((group) => group !== "\u77E2\u91CF")] : COMPUTE_GROUP_ORDER;
      const emitted = /* @__PURE__ */ new Set();
      for (const group of [...order, ...byGroup.keys()]) {
        if (emitted.has(group)) continue;
        const specs = byGroup.get(group);
        if (!specs || !specs.length) continue;
        emitted.add(group);
        items.push({
          label: `\u8282\u70B9 \xB7 ${group}`,
          hint: `${specs.length} \u79CD`,
          children: specs.map((spec) => ({
            label: spec.label,
            hint: spec.description,
            action: () => addNodeAt(spec.kind, placeX, placeY)
          }))
        });
      }
      return items;
    }
    for (const spec of list) {
      if (spec.addable === false) continue;
      items.push({
        label: spec.label,
        hint: state.mode === "circuit" && spec.kind === "ground" ? "\u53C2\u8003\u8282\u70B9\uFF08R21\uFF1A\u53EF\u653E\u591A\u4E2A\uFF0C\u81EA\u52A8\u5408\u5E76\u4E3A 0V\uFF09" : spec.description,
        action: () => addNodeAt(spec.kind, placeX, placeY)
      });
    }
    if (state.mode === "circuit") {
      const byGroup = /* @__PURE__ */ new Map();
      for (const spec of state.catalog?.elements || []) {
        const group = String(spec.group || "\u672A\u5206\u7C7B");
        if (!byGroup.has(group)) byGroup.set(group, []);
        byGroup.get(group).push(spec);
      }
      for (const group of ELEMENT_GROUP_ORDER) {
        const specs = byGroup.get(group);
        if (!specs || !specs.length) continue;
        items.push({
          label: `\u5668\u4EF6 \xB7 ${group}`,
          hint: `${specs.length} \u79CD`,
          children: specs.map((spec) => ({
            label: spec.label,
            hint: spec.description,
            action: () => addDeviceAt(spec.kind, placeX, placeY)
          }))
        });
      }
      items.push({ sep: true });
      items.push({
        label: "\u5BFC\u7EBF\u5DE5\u5177\uFF08\u70B9\u4E24\u7AEF\uFF09\u2026",
        hint: "\u4F9D\u6B21\u70B9\u51FB\u4E24\u4E2A\u7AEF\u70B9\uFF1BEsc \u53D6\u6D88",
        action: () => startWireTool()
      });
      items.push({
        label: "\u5BFC\u7EBF\uFF08\u9009\u62E9\u7AEF\u70B9\uFF09\u2026",
        hint: "\u70B9\u4E24\u4E2A\u7AEF\u70B9\u5EFA\u7EBF\uFF1B\u4E5F\u53EF\u4ECE\u5F15\u811A\u62D6\u62FD\uFF08R22\uFF09",
        action: () => openWireDialog()
      });
    }
    return items;
  }
  function openAddMenu(x, y, placeX = x, placeY = y) {
    if (!state.catalog) return;
    const items = buildAddMenuItems(placeX, placeY);
    const menuLabel = state.mode === "circuit" ? "\u7535\u5B66\u8282\u70B9/\u5668\u4EF6" : state.mode === "vector" ? "\u77E2\u91CF\u8282\u70B9" : "\u8BA1\u7B97\u8282\u70B9";
    openGenericMenu(ui.addMenu, x, y, `\u6DFB\u52A0${menuLabel}`, items);
  }
  function centerPlacement() {
    const count = state.scene?.nodes?.length || 0;
    const offset = (count % 3 - 1) * 46;
    return {
      x: state.canvasSize.w / 2 + offset,
      y: state.canvasSize.h / 2 + offset
    };
  }
  function openLinkMenu(targetId, x, y, forcedSourceId) {
    const sourceId = forcedSourceId || state.drag?.sourceId;
    const target = nodeById(targetId);
    const source = nodeById(sourceId);
    if (!source || !target) return;
    if (state.mode === "circuit" && source.id === target.id) {
      toast("\u7535\u8DEF\u5143\u4EF6\u4E24\u7AEF\u4E0D\u80FD\u662F\u540C\u4E00\u4E2A\u8282\u70B9", "error");
      state.drag = null;
      return;
    }
    if (state.mode === "circuit" && (isPinNode(source) || isPinNode(target))) {
      if (isPinNode(source) && isPinNode(target)) {
        toast("\u5BFC\u7EBF\u53EA\u5141\u8BB8\u300C\u5668\u4EF6/\u6A21\u5757\u5F15\u811A \u2194 \u7F51\u7EDC\u8282\u70B9\u300D", "error", 4e3);
        state.drag = null;
        return;
      }
      const deviceNode = isPinNode(source) ? source : target;
      const netNode = isPinNode(source) ? target : source;
      const used = new Set((state.scene?.edges || []).filter((edge) => edge.kind === "wire").map((edge) => edge.source === deviceNode.id ? edge.source_pin : edge.target === deviceNode.id ? edge.target_pin : ""));
      const items2 = devicePins(deviceNode).filter((pin) => !used.has(pin.name)).map((pin) => ({
        label: `${deviceNode.name}.${pin.name}`,
        hint: `${pin.role}${pin.required ? " \xB7 \u5FC5\u63A5" : ""} \u2192 ${netNode.name}`,
        action: () => createWire(deviceNode.id, netNode.id, pin.name)
      }));
      if (!items2.length) {
        toast(`${deviceNode.name} \u7684\u5F15\u811A\u90FD\u5DF2\u8FDE\u63A5`, "info", 3e3);
        state.drag = null;
        return;
      }
      openGenericMenu(ui.linkMenu, x, y, `${deviceNode.name} \u5F15\u811A \u2192 ${netNode.name}`, items2);
      state.drag = null;
      return;
    }
    const netKind = (node) => node.kind === "node" || node.kind === "ground";
    const items = [];
    if (state.mode === "circuit" && netKind(source) && netKind(target)) {
      items.push({
        label: "\u7EAF\u5BFC\u7EBF\uFF08\u5408\u5E76\u4E24\u4E2A\u7F51\u7EDC\u8282\u70B9\uFF09",
        hint: "\u7535\u6C14\u4E0A\u89C6\u4E3A\u540C\u4E00\u4E2A\u7F51\u7EDC\uFF1B\u53EF\u4EE5\u8FDE\u7EED\u753B\u591A\u6BB5",
        action: () => createWireBetween(source.id, target.id, "", "")
      });
    }
    const list = kindListFor("edge");
    items.push(...list.map((spec) => ({
      label: spec.label,
      hint: spec.description,
      action: () => createEdge(source.id, target.id, spec.kind)
    })));
    openGenericMenu(ui.linkMenu, x, y, `${source.name} \u2192 ${target.name}`, items);
    state.drag = null;
  }
  let modalResolver = null;
  function closeModal() {
    ui.modal.classList.add("hidden");
    ui.modalCard.replaceChildren();
    const resolver = modalResolver;
    modalResolver = null;
    if (resolver) resolver(false);
  }
  function confirmModal(title, message, confirmLabel = "\u786E\u5B9A", danger = false) {
    return new Promise((resolve) => {
      if (modalResolver) modalResolver(false);
      modalResolver = resolve;
      ui.modalCard.replaceChildren();
      const heading = el("h3", null, title);
      const body = message instanceof Node ? message : el("p", null, message);
      const actions = div("modal-actions");
      const cancel = button("\u53D6\u6D88", "btn", () => {
        ui.modal.classList.add("hidden");
        const inner = modalResolver;
        modalResolver = null;
        if (inner) inner(false);
      });
      const okay = button(confirmLabel, danger ? "btn danger" : "btn primary", () => {
        ui.modal.classList.add("hidden");
        const inner = modalResolver;
        modalResolver = null;
        if (inner) inner(true);
      });
      actions.append(cancel, okay);
      ui.modalCard.append(heading, body, actions);
      ui.modal.classList.remove("hidden");
      setTimeout(() => okay.focus(), 30);
      ui.modal.onclick = (event) => {
        if (event.target === ui.modal) cancel.click();
      };
      const onKey = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          document.removeEventListener("keydown", onKey, true);
          cancel.click();
        }
      };
      document.addEventListener("keydown", onKey, true);
    });
  }
  let modeResolver = null;
  function chooseModeModal() {
    return new Promise((resolve) => {
      if (modeResolver) modeResolver(null);
      modeResolver = resolve;
      ui.modalCard.replaceChildren();
      const finish = (value) => {
        ui.modal.classList.add("hidden");
        ui.modalCard.replaceChildren();
        const inner = modeResolver;
        modeResolver = null;
        if (inner) inner(value);
      };
      const heading = el("h3", null, "\u65B0\u5EFA\u5DE5\u7A0B\uFF1A\u9009\u62E9\u573A\u666F\u6A21\u5F0F");
      const body = el("p", null, "\u6A21\u5F0F\u51B3\u5B9A\u53EF\u7528\u5143\u4EF6\u4E0E\u6C42\u89E3\u5668\uFF1B\u521B\u5EFA\u540E\u4ECD\u53EF\u901A\u8FC7\u6253\u5F00\u5DE5\u7A0B\u5207\u6362\u3002");
      const list = div("modal-actions");
      const make = (mode, label, hint) => {
        const item = button(`${label} \xB7 ${hint}`, "btn", () => finish(mode));
        item.style.flex = "1";
        return item;
      };
      const cancel = button("\u53D6\u6D88", "btn", () => finish(null));
      list.append(
        make("signal", "\u4FE1\u53F7\u6D41", "\u589E\u76CA/\u6C42\u548C/\u6EE4\u6CE2"),
        make("circuit", "\u7535\u8DEF", "\u5668\u4EF6\u8282\u70B9\u4E0E MNA"),
        make("vector", "\u77E2\u91CF\u573A", "\u6709\u9650\u5143/\u573A\u6C42\u89E3")
      );
      const actions = div("modal-actions");
      actions.append(cancel);
      ui.modalCard.append(heading, body, list, actions);
      ui.modal.classList.remove("hidden");
      ui.modal.onclick = (event) => {
        if (event.target === ui.modal) finish(null);
      };
    });
  }
  function showHelp() {
    openDoc("shortcuts");
  }
  let networkModalResolver = null;
  function newNetworkModal(defaultMode = state.mode) {
    return new Promise((resolve) => {
      if (networkModalResolver) networkModalResolver(null);
      networkModalResolver = resolve;
      ui.modalCard.replaceChildren();
      let chosen = defaultMode;
      const finish = (value) => {
        ui.modal.classList.add("hidden");
        ui.modalCard.replaceChildren();
        const inner = networkModalResolver;
        networkModalResolver = null;
        if (inner) inner(value);
      };
      const heading = el("h3", null, "\u65B0\u5EFA\u7F51\u7EDC");
      const body = el("p", null, "\u6BCF\u6761\u7F51\u7EDC\u72EC\u7ACB\u4FDD\u5B58\u81EA\u5DF1\u7684\u5DE5\u4F5C\u6A21\u5F0F\uFF0C\u5207\u6362\u6D3B\u52A8\u7F51\u7EDC\u65F6\u4F1A\u81EA\u52A8\u8F7D\u5165\u3002");
      const nameField = div("field");
      nameField.appendChild(el("span", null, "\u7F51\u7EDC\u540D\u79F0\uFF08\u53EF\u7559\u7A7A\u81EA\u52A8\u547D\u540D\uFF0C\u6700\u957F 60 \u5B57\uFF09"));
      const nameInput = el("input", "input");
      nameInput.type = "text";
      nameInput.maxLength = 60;
      nameInput.placeholder = `\u7F51\u7EDC ${(state.networks?.length || 0) + 1}`;
      nameField.appendChild(nameInput);
      const modeSection = section("\u5DE5\u4F5C\u6A21\u5F0F", "\u53EA\u5728\u65B0\u5EFA\u65F6\u5E94\u7528\uFF0C\u4E4B\u540E\u968F\u8BE5\u7F51\u7EDC\u72EC\u7ACB\u4FDD\u5B58");
      const segmented = div("segmented");
      const modes = state.catalog?.modes || [
        { value: "signal", label: "\u4FE1\u53F7\u6D41" },
        { value: "circuit", label: "\u7535\u8DEF" },
        { value: "vector", label: "\u77E2\u91CF\u573A" }
      ];
      const modeButtons = [];
      for (const item of modes) {
        const btn = button(item.label, "", () => {
          chosen = item.value;
          for (const other of modeButtons) other.classList.toggle("active", other === btn);
        });
        btn.dataset.mode = item.value;
        btn.classList.toggle("active", item.value === chosen);
        btn.title = item.description || "";
        modeButtons.push(btn);
        segmented.appendChild(btn);
      }
      modeSection.appendChild(segmented);
      const actions = div("modal-actions");
      const cancel = button("\u53D6\u6D88", "btn", () => finish(null));
      const okay = button(
        "\u521B\u5EFA\u7F51\u7EDC",
        "btn primary",
        () => finish({ name: nameInput.value.trim(), mode: chosen })
      );
      actions.append(cancel, okay);
      ui.modalCard.append(heading, body, nameField, modeSection, actions);
      ui.modal.classList.remove("hidden");
      setTimeout(() => nameInput.focus(), 30);
      nameInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          okay.click();
        }
      });
      ui.modal.onclick = (event) => {
        if (event.target === ui.modal) finish(null);
      };
    });
  }
  async function selectEntity(type, id, force = false) {
    if (!type || !id) {
      clearSelection();
      return;
    }
    if (state.selection.type === type && state.selection.id === id) {
      if (force) renderInspector();
      requestDraw();
      return;
    }
    if (state.selectionBusy) return;
    state.selectionBusy = true;
    try {
      if (state.inspectorDirty && state.selection.type) {
        const applied = await applyInspector({ quiet: true });
        if (!applied) {
          toast("\u5F53\u524D\u4FEE\u6539\u65E0\u6CD5\u4FDD\u5B58\uFF0C\u8BF7\u5148\u4FEE\u6B63\u68C0\u67E5\u5668\u4E2D\u7684\u53C2\u6570", "error", 5e3);
          return;
        }
      }
      state.selection = { type, id };
      state.inspectorDirty = false;
      renderInspector();
      requestDraw();
    } finally {
      state.selectionBusy = false;
    }
  }
  function clearSelection() {
    state.selection = { type: null, id: null };
    state.inspectorId = null;
    state.inspectorDirty = false;
    state.multi.nodes.clear();
    state.multi.edges.clear();
    renderInspector();
    requestDraw();
  }
  function multiSelection() {
    const nodes = new Set(state.multi?.nodes || []);
    const edges = new Set(state.multi?.edges || []);
    if (state.selection.type === "node" && state.selection.id) nodes.add(state.selection.id);
    if (state.selection.type === "edge" && state.selection.id) edges.add(state.selection.id);
    return { nodes, edges };
  }
  function toggleMultiSelection(type, id) {
    if (type === "node") {
      if (state.multi.nodes.has(id)) state.multi.nodes.delete(id);
      else state.multi.nodes.add(id);
    } else if (type === "edge") {
      if (state.multi.edges.has(id)) state.multi.edges.delete(id);
      else state.multi.edges.add(id);
    }
    if (state.multi.nodes.size + state.multi.edges.size === 1) {
      const onlyNode = state.multi.nodes.values().next().value;
      const onlyEdge = state.multi.edges.values().next().value;
      if (onlyNode) void selectEntity("node", onlyNode);
      else if (onlyEdge) void selectEntity("edge", onlyEdge);
    } else {
      requestDraw();
    }
    toast(`\u5DF2\u9009 ${state.multi.nodes.size} \u8282\u70B9 / ${state.multi.edges.size} \u8FDE\u63A5`, "info", 1600);
  }
  function selectAll() {
    state.multi.nodes = new Set((state.scene?.nodes || []).map((node) => node.id));
    state.multi.edges = new Set((state.scene?.edges || []).map((edge) => edge.id));
    requestDraw();
    toast(`\u5DF2\u5168\u9009 ${state.multi.nodes.size} \u8282\u70B9 / ${state.multi.edges.size} \u8FDE\u63A5`, "info", 1800);
  }
  function clipboardPayload() {
    const { nodes, edges } = multiSelection();
    if (!nodes.size && !edges.size) return null;
    const nodeSet = new Set(nodes);
    const edgeList = (state.scene?.edges || []).filter(
      (edge) => edges.has(edge.id) || nodeSet.has(edge.source) && nodeSet.has(edge.target)
    );
    return {
      networkId: state.currentNetwork?.id || "",
      nodes: (state.scene?.nodes || []).filter((node) => nodeSet.has(node.id)).map((node) => JSON.parse(JSON.stringify(node))),
      edges: edgeList.map((edge) => JSON.parse(JSON.stringify(edge)))
    };
  }
  function copySelection(cut = false) {
    const payload = clipboardPayload();
    if (!payload) {
      toast("\u5148\u5728\u753B\u5E03\u4E0A\u9009\u62E9\u8282\u70B9\u6216\u8FDE\u7EBF\uFF08Ctrl+\u5355\u51FB / Ctrl+\u62D6\u6846\uFF09", "info", 2600);
      return;
    }
    state.clipboard = payload;
    if (cut) {
      void deleteSelection();
      toast(`\u5DF2\u526A\u5207 ${payload.nodes.length} \u8282\u70B9 / ${payload.edges.length} \u8FDE\u63A5`, "ok", 2200);
    } else {
      toast(`\u5DF2\u590D\u5236 ${payload.nodes.length} \u8282\u70B9 / ${payload.edges.length} \u8FDE\u63A5`, "ok", 2200);
    }
  }
  function uniquePasteName(base, reserved) {
    const existing = new Set((state.scene?.nodes || []).map((node) => node.name));
    let candidate = `${String(base || "node").slice(0, 24)}_copy`;
    let index = 2;
    while (existing.has(candidate) || reserved.has(candidate)) {
      candidate = `${String(base || "node").slice(0, 22)}_c${index++}`;
    }
    reserved.add(candidate);
    return candidate.slice(0, 32);
  }
  async function pasteClipboard() {
    const clipboard = state.clipboard;
    if (!clipboard || !clipboard.nodes.length && !clipboard.edges.length) {
      toast("\u526A\u8D34\u677F\u4E3A\u7A7A\uFF1A\u5148 Ctrl+C \u590D\u5236\u9009\u4E2D\u5BF9\u8C61", "info", 2400);
      return;
    }
    if (clipboard.networkId && clipboard.networkId !== (state.currentNetwork?.id || "")) {
      const confirmed = await confirmModal(
        "\u8DE8\u7F51\u7EDC\u7C98\u8D34\uFF1F",
        "\u526A\u8D34\u677F\u6765\u81EA\u53E6\u4E00\u4E2A\u7F51\u7EDC\u3002\u8FDE\u63A5\u4E0E\u53C2\u6570\u4F1A\u4FDD\u7559\u7ED1\u5B9A\uFF0C\u4F46\u8DE8\u5C42\u8BED\u4E49\u8BF7\u81EA\u884C\u786E\u8BA4\u3002",
        "\u7C98\u8D34",
        false
      );
      if (!confirmed) return;
    }
    const offset = 28;
    await pushUndoSnapshot();
    const reserved = /* @__PURE__ */ new Set();
    const idMap = /* @__PURE__ */ new Map();
    let nodesCreated = 0;
    let edgesCreated = 0;
    for (const node of clipboard.nodes) {
      const payload = {
        name: uniquePasteName(node.name, reserved),
        kind: node.kind,
        params: node.params || {},
        data: node.data || {},
        position: {
          x: (Number(node.position?.x) || 0) + offset,
          y: (Number(node.position?.y) || 0) + offset
        },
        size: node.size || {}
      };
      const response = await task(() => jsonRequest("/api/nodes", "POST", payload), { history: false });
      if (!response?.node) continue;
      idMap.set(node.id, response.node.id);
      nodesCreated += 1;
    }
    for (const edge of clipboard.edges) {
      const source = idMap.get(edge.source);
      const target = idMap.get(edge.target);
      if (!source || !target) continue;
      const response = await task(
        () => jsonRequest("/api/edges", "POST", {
          source,
          target,
          kind: edge.kind,
          params: edge.params || {},
          delay: Boolean(edge.delay),
          enabled: edge.enabled !== false,
          auto_delay: false,
          route: edge.route || "auto",
          waypoints: edge.waypoints || [],
          anchors: edge.anchors || {}
        }),
        { history: false }
      );
      if (response) edgesCreated += 1;
    }
    await refreshState(true);
    toast(`\u5DF2\u7C98\u8D34 ${nodesCreated} \u8282\u70B9 / ${edgesCreated} \u8FDE\u63A5`, "ok", 2600);
  }
  async function captureSceneSnapshot() {
    try {
      return await jsonRequest("/api/scene/export", "GET");
    } catch (error) {
      return null;
    }
  }
  async function pushUndoSnapshot() {
    const snapshot = await captureSceneSnapshot();
    if (!snapshot) return;
    state.undoStack.push(snapshot);
    if (state.undoStack.length > 100) state.undoStack.shift();
    state.redoStack.length = 0;
  }
  async function restoreSceneSnapshot(payload) {
    const current = await captureSceneSnapshot();
    const merged = { ...payload, blocks: current?.blocks || [] };
    await jsonRequest("/api/control", "POST", { action: "pause" });
    const response = await jsonRequest("/api/scene", "POST", merged);
    if (!response?.scene) return;
    clearSelection();
    applySnapshot(response);
    renderInspector();
    markProjectDirty();
  }
  async function undo() {
    const snapshot = state.undoStack.pop();
    if (!snapshot) {
      toast("\u6CA1\u6709\u53EF\u64A4\u9500\u7684\u64CD\u4F5C", "info", 2e3);
      return;
    }
    const current = await captureSceneSnapshot();
    if (current) state.redoStack.push(current);
    await task(() => restoreSceneSnapshot(snapshot), { dirty: true, history: false });
    toast("\u5DF2\u64A4\u9500", "ok", 1600);
  }
  async function redo() {
    const snapshot = state.redoStack.pop();
    if (!snapshot) {
      toast("\u6CA1\u6709\u53EF\u91CD\u505A\u7684\u64CD\u4F5C", "info", 2e3);
      return;
    }
    const current = await captureSceneSnapshot();
    if (current) state.undoStack.push(current);
    await task(() => restoreSceneSnapshot(snapshot), { dirty: true, history: false });
    toast("\u5DF2\u91CD\u505A", "ok", 1600);
  }
  function renderInspector() {
    syncFnRoleToSelection();
    scheduleSpecRender();
    if (!state.selection.type) {
      renderEmptyInspector();
      return;
    }
    if (state.selection.type === "node") {
      const node = selectedNode();
      if (!node) {
        clearSelection();
        return;
      }
      renderNodeInspector(node);
    } else {
      const edge = selectedEdge();
      if (!edge) {
        clearSelection();
        return;
      }
      renderEdgeInspector(edge);
    }
  }
  async function alignSelection(mode) {
    const targets = [...multiSelection().nodes].map((id) => nodeById(id)).filter(Boolean);
    if (targets.length < 2) {
      toast("\u81F3\u5C11\u9009\u4E2D\u4E24\u4E2A\u8282\u70B9/\u5668\u4EF6\u624D\u80FD\u5BF9\u9F50", "info", 2400);
      return;
    }
    const xs = targets.map((node) => node.position.x);
    const ys = targets.map((node) => node.position.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const positions = targets.map((node) => {
      let x = node.position.x;
      let y = node.position.y;
      if (mode === "left") x = minX;
      else if (mode === "right") x = maxX;
      else if (mode === "centerX") x = (minX + maxX) / 2;
      else if (mode === "top") y = minY;
      else if (mode === "bottom") y = maxY;
      else if (mode === "centerY") y = (minY + maxY) / 2;
      return { id: node.id, position: { x: Math.round(x * 1e3) / 1e3, y: Math.round(y * 1e3) / 1e3 } };
    });
    try {
      await jsonRequest("/api/positions", "POST", { positions });
      await refreshState(true);
      toast(`\u5DF2\u5BF9\u9F50 ${targets.length} \u4E2A\u8282\u70B9\uFF08${mode}\uFF09`, "ok", 2200);
    } catch (error) {
      toast(`\u5BF9\u9F50\u5931\u8D25\uFF1A${error.message}`, "error", 4e3);
    }
  }
  async function distributeSelection(axis) {
    const targets = [...multiSelection().nodes].map((id) => nodeById(id)).filter(Boolean);
    if (targets.length < 3) {
      toast("\u7B49\u8DDD\u5206\u5E03\u81F3\u5C11\u9700\u8981\u4E09\u4E2A\u8282\u70B9/\u5668\u4EF6", "info", 2400);
      return;
    }
    const key = axis === "y" ? "y" : "x";
    const sorted = [...targets].sort((a, b) => a.position[key] - b.position[key]);
    const first = sorted[0].position[key];
    const last = sorted[sorted.length - 1].position[key];
    const step = (last - first) / (sorted.length - 1);
    const positions = sorted.map((node, index) => {
      const value = index === 0 || index === sorted.length - 1 ? node.position[key] : first + step * index;
      const x = key === "x" ? value : node.position.x;
      const y = key === "y" ? value : node.position.y;
      return { id: node.id, position: { x: Math.round(x * 1e3) / 1e3, y: Math.round(y * 1e3) / 1e3 } };
    });
    try {
      await jsonRequest("/api/positions", "POST", { positions });
      await refreshState(true);
      toast(`\u5DF2\u7B49\u8DDD\u5206\u5E03 ${targets.length} \u4E2A\u8282\u70B9\uFF08${axis === "y" ? "\u7EB5\u5411" : "\u6A2A\u5411"}\uFF09`, "ok", 2200);
    } catch (error) {
      toast(`\u5206\u5E03\u5931\u8D25\uFF1A${error.message}`, "error", 4e3);
    }
  }
  function selectWireNetwork(edge) {
    const ends = /* @__PURE__ */ new Set([edge.source, edge.target]);
    const wires = (state.scene?.edges || []).filter(
      (item) => item.kind === "wire" && (ends.has(item.source) || ends.has(item.target))
    );
    state.multi.nodes = new Set(ends);
    state.multi.edges = new Set(wires.map((item) => item.id));
    state.selection = { type: null, id: null };
    requestDraw();
    toast(`\u5DF2\u9009\u4E2D ${wires.length} \u6761\u5BFC\u7EBF / ${ends.size} \u4E2A\u7AEF\u70B9`, "info", 2200);
  }
  async function addWireWaypoint(edge) {
    const source = nodeById(edge.source);
    const target = nodeById(edge.target);
    if (!source || !target) return;
    const x = (source.position.x + target.position.x) / 2;
    const y = (source.position.y + target.position.y) / 2;
    const waypoints = [...edge.waypoints || [], { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }];
    try {
      await jsonRequest(`/api/edges/${encodeURIComponent(edge.id)}`, "PATCH", {
        route: "manual",
        waypoints
      });
      await refreshState(true);
      state.selection = { type: "edge", id: edge.id };
      renderInspector();
      requestDraw();
      toast(`\u5DF2\u6DFB\u52A0\u62D0\u70B9\uFF08\u5171 ${waypoints.length} \u4E2A\uFF09\uFF1B\u53EF\u76F4\u63A5\u62D6\u52A8\u62D0\u70B9\uFF0C\u753B\u5E03\u4F1A\u663E\u793A\u5750\u6807`, "ok", 2800);
    } catch (error) {
      toast(`\u6DFB\u52A0\u62D0\u70B9\u5931\u8D25\uFF1A${error.message}`, "error", 4e3);
    }
  }
  async function clearWireWaypoints(edgeId) {
    try {
      await jsonRequest(`/api/edges/${encodeURIComponent(edgeId)}`, "PATCH", {
        route: "auto",
        waypoints: []
      });
      await refreshState(true);
      toast("\u5DF2\u6E05\u9664\u62D0\u70B9\uFF0C\u6062\u590D\u81EA\u52A8\u5E03\u7EBF", "ok", 2200);
    } catch (error) {
      toast(`\u6E05\u9664\u62D0\u70B9\u5931\u8D25\uFF1A${error.message}`, "error", 4e3);
    }
  }
  async function batchResizeSelection() {
    const { nodes } = multiSelection();
    const targets = [...nodes].map((id) => nodeById(id)).filter(Boolean);
    if (!targets.length) {
      toast("\u5148\u591A\u9009\u8282\u70B9/\u5668\u4EF6\uFF08Ctrl+\u5355\u51FB\uFF09\uFF0C\u518D\u6267\u884C\u6279\u91CF\u5C3A\u5BF8", "info", 2800);
      return;
    }
    const raw = window.prompt(
      `\u7EDF\u4E00\u5C3A\u5BF8\uFF0824\u2013200\uFF0C\u5BBD/\u76F4\u5F84\uFF09\uFF1B\u5C06\u5E94\u7528\u5230 ${targets.length} \u4E2A\u8282\u70B9/\u5668\u4EF6`,
      "60"
    );
    if (raw === null) return;
    const width = Number(raw);
    if (!Number.isFinite(width) || width < 24 || width > 200) {
      toast("\u5C3A\u5BF8\u9700\u5728 24\u2013200 \u4E4B\u95F4", "error", 3e3);
      return;
    }
    let done = 0;
    for (const node of targets) {
      if (node.kind === "ground") continue;
      try {
        await jsonRequest(`/api/nodes/${encodeURIComponent(node.id)}`, "PATCH", {
          size: { w: Math.round(width) }
        });
        done += 1;
      } catch (error) {
        toast(`\u8BBE\u7F6E ${node.name} \u5931\u8D25\uFF1A${error.message}`, "error", 4e3);
      }
    }
    if (done) {
      await refreshState(true);
      toast(`\u5DF2\u7EDF\u4E00 ${done} \u4E2A\u8282\u70B9/\u5668\u4EF6\u5C3A\u5BF8\u4E3A ${Math.round(width)}`, "ok", 2600);
    }
  }
  async function addNodeAt(kind, screenX, screenY) {
    const spec = getNodeSpec(kind);
    if (!spec) {
      toast(`\u5F53\u524D\u6A21\u5F0F\u6CA1\u6709\u8282\u70B9\u7C7B\u578B ${kind}`, "error");
      return;
    }
    const world = screenToWorld(screenX, screenY);
    const snapped = snapWorld(world.x, world.y);
    const base = kind === "ground" ? "gnd" : kind === "node" ? "n" : kind.replace(/[^a-z0-9_]/gi, "") || "node";
    const name = uniqueNodeName(base);
    const payload = {
      name,
      kind,
      params: specDefaults(spec),
      data: kind === "manual" ? state.mode === "vector" ? { x: 1, y: 0 } : { voltage: 1 } : {},
      position: {
        x: clamp(Math.round(snapped.x), -1e4, 1e4),
        y: clamp(Math.round(snapped.y), -1e4, 1e4)
      }
    };
    const response = await task(() => jsonRequest("/api/nodes", "POST", payload));
    if (!response) return;
    applySnapshot(response);
    await selectEntity("node", response.node.id, true);
    switchTab("inspect");
    if (kind === "ground") {
      const count = (state.scene?.nodes || []).filter((node) => node.kind === "ground").length;
      toast(`\u5DF2\u6DFB\u52A0\u63A5\u5730\uFF1A\u5171 ${count} \u4E2A\uFF0C\u81EA\u52A8\u5408\u5E76\u4E3A 0V`, "ok", 2600);
    } else {
      toast(`\u5DF2\u6DFB\u52A0\u8282\u70B9 ${response.node.name}`, "ok", 2e3);
    }
  }
  async function addDeviceAt(element, screenX, screenY) {
    const spec = getEdgeSpec(element);
    if (!spec) {
      toast(`\u5F53\u524D\u6A21\u5F0F\u6CA1\u6709\u5668\u4EF6\u7C7B\u578B ${element}`, "error");
      return;
    }
    const world = screenToWorld(screenX, screenY);
    const snapped = snapWorld(world.x, world.y);
    const name = uniqueNodeName(element.replace(/[^a-z0-9]/gi, "") || "dev");
    const payload = {
      name,
      kind: "device",
      params: { element, ...specDefaults(spec) },
      data: {},
      position: {
        x: clamp(Math.round(snapped.x), -1e4, 1e4),
        y: clamp(Math.round(snapped.y), -1e4, 1e4)
      }
    };
    const response = await task(() => jsonRequest("/api/nodes", "POST", payload));
    if (!response) return;
    applySnapshot(response);
    await selectEntity("node", response.node.id, true);
    switchTab("inspect");
    toast(`\u5DF2\u6DFB\u52A0\u5668\u4EF6 ${response.node.name}`, "ok", 2e3);
  }
  async function createWire(deviceId, netId, pinName) {
    return createWireBetween(deviceId, netId, pinName, "");
  }
  async function createWireBetween(sourceId, targetId, sourcePin, targetPin) {
    const source = nodeById(sourceId);
    const target = nodeById(targetId);
    if (!source || !target) {
      toast("\u8FDE\u7EBF\u7684\u7AEF\u70B9\u4E0D\u5B58\u5728", "error", 3e3);
      return;
    }
    if (source.id === target.id) {
      toast("\u8FDE\u7EBF\u7684\u4E24\u4E2A\u7AEF\u70B9\u4E0D\u80FD\u662F\u540C\u4E00\u4E2A\u8282\u70B9", "error", 3e3);
      return;
    }
    if (isPinNode(source) && isPinNode(target)) {
      toast("\u5BFC\u7EBF\u4E0D\u5141\u8BB8\u76F4\u63A5\u8FDE\u63A5\u4E24\u4E2A\u5668\u4EF6\uFF08\u8BF7\u7ECF\u7F51\u7EDC\u8282\u70B9\uFF09", "error", 3500);
      return;
    }
    const body = {
      source: source.id,
      target: target.id,
      kind: "wire",
      params: {},
      enabled: true,
      route: state.ui?.circuitOrthogonal !== false ? "orthogonal" : "straight"
    };
    const pinFor = (node, pin) => {
      if (pin) return pin;
      const pins = devicePins(node);
      return pins.length === 1 ? String(pins[0].name || "") : "";
    };
    if (isPinNode(source)) body.source_pin = pinFor(source, sourcePin);
    if (isPinNode(target)) body.target_pin = pinFor(target, targetPin);
    const response = await task(() => jsonRequest("/api/edges", "POST", body));
    if (!response) return;
    applySnapshot(response);
    if (response.edge) {
      await selectEntity("edge", response.edge.id, true);
      switchTab("inspect");
    }
    toast("\u5DF2\u521B\u5EFA\u5BFC\u7EBF", "ok", 1800);
  }
  function openWireDialog() {
    if (state.mode !== "circuit") {
      toast("\u8FDE\u7EBF\u5BF9\u8BDD\u6846\u53EA\u7528\u4E8E\u7535\u8DEF\u573A\u666F", "error", 3e3);
      return;
    }
    const nodes = state.scene?.nodes || [];
    if (nodes.length < 2) {
      toast("\u81F3\u5C11\u9700\u8981\u4E24\u4E2A\u8282\u70B9\u624D\u80FD\u8FDE\u7EBF", "error", 3e3);
      return;
    }
    ui.modalCard.replaceChildren();
    const heading = el("h3", null, "\u65B0\u5EFA\u8FDE\u7EBF\uFF08\u9009\u62E9\u7AEF\u70B9\uFF09");
    const note = el("p", null, "\u7AEF\u70B9\u53EF\u4EE5\u662F\u300C\u7F51\u7EDC\u8282\u70B9 \u2194 \u7F51\u7EDC\u8282\u70B9\u300D\uFF08\u7EAF\u5BFC\u7EBF\uFF0C\u7535\u6C14\u5408\u5E76\uFF09\u6216\u300C\u5668\u4EF6\u5F15\u811A \u2194 \u7F51\u7EDC\u8282\u70B9\u300D\u3002");
    const form = el("form");
    form.autocomplete = "off";
    const rows = div("inline-fields");
    const makeSelect = (roleLabel) => {
      const wrap = div("field");
      wrap.appendChild(numberedField(roleLabel, ""));
      const select = el("select");
      select.dataset.role = roleLabel.includes("A") ? "wire-a" : "wire-b";
      for (const node of nodes) {
        const option = el("option", null, `${node.name} \xB7 ${node.kind === "module" ? `\u6A21\u5757 ${node.params?.block_name || ""}`.trim() : node.kind === "device" ? node.params?.element || "device" : node.kind}`);
        option.value = node.id;
        select.appendChild(option);
      }
      wrap.appendChild(select);
      const pinWrap = div("field");
      pinWrap.appendChild(numberedField("\u5F15\u811A", "\u5668\u4EF6\u8282\u70B9\u5FC5\u586B"));
      const pinSelect = el("select");
      pinSelect.dataset.role = roleLabel.includes("A") ? "wire-a-pin" : "wire-b-pin";
      pinWrap.appendChild(pinSelect);
      return { wrap, select, pinWrap, pinSelect };
    };
    const first = makeSelect("\u7AEF\u70B9 A");
    const second = makeSelect("\u7AEF\u70B9 B");
    const refreshPins = () => {
      for (const item of [first, second]) {
        const node = nodeById(item.select.value);
        item.pinSelect.replaceChildren();
        const blank = el("option", null, isPinNode(node) ? "\uFF08\u8BF7\u9009\u62E9\u5F15\u811A\uFF09" : "\u2014");
        blank.value = "";
        item.pinSelect.appendChild(blank);
        if (isPinNode(node)) {
          for (const pin of devicePins(node)) {
            const option = el("option", null, `${pin.name}\uFF08${pin.role}${pin.required ? " \xB7 \u5FC5\u63A5" : ""}\uFF09`);
            option.value = pin.name;
            item.pinSelect.appendChild(option);
          }
        }
        item.pinSelect.disabled = !isPinNode(node);
      }
    };
    first.select.addEventListener("change", refreshPins);
    second.select.addEventListener("change", refreshPins);
    if (nodes[1]) second.select.value = nodes[1].id;
    refreshPins();
    rows.append(first.wrap, first.pinWrap, second.wrap, second.pinWrap);
    form.appendChild(rows);
    const actions = div("modal-actions");
    const cancel = button("\u53D6\u6D88", "btn", closeModal);
    const create = button("\u521B\u5EFA\u8FDE\u7EBF", "btn primary", null);
    create.type = "button";
    create.addEventListener("click", () => {
      const a = nodeById(first.select.value);
      const b = nodeById(second.select.value);
      const aPin = isPinNode(a) ? first.pinSelect.value : "";
      const bPin = isPinNode(b) ? second.pinSelect.value : "";
      if (isPinNode(a) && !aPin) {
        toast("\u7AEF\u70B9 A \u662F\u5668\u4EF6\uFF0C\u8BF7\u9009\u62E9\u5F15\u811A", "error", 3e3);
        return;
      }
      if (isPinNode(b) && !bPin) {
        toast("\u7AEF\u70B9 B \u662F\u5668\u4EF6\uFF0C\u8BF7\u9009\u62E9\u5F15\u811A", "error", 3e3);
        return;
      }
      closeModal();
      void createWireBetween(first.select.value, second.select.value, aPin, bPin);
    });
    actions.append(cancel, create);
    form.append(actions);
    ui.modalCard.append(heading, note, form);
    ui.modal.classList.remove("hidden");
  }
  async function createEdge(source, target, kind) {
    const spec = getEdgeSpec(kind);
    if (!spec) {
      toast(`\u5F53\u524D\u6A21\u5F0F\u6CA1\u6709\u8FDE\u63A5\u7C7B\u578B ${kind}`, "error");
      return;
    }
    const body = {
      source,
      target,
      kind,
      params: specDefaults(spec),
      delay: false,
      enabled: true,
      auto_delay: false
    };
    if (state.mode === "circuit" && state.ui?.circuitOrthogonal !== false) body.route = "orthogonal";
    const response = await task(() => jsonRequest("/api/edges", "POST", body));
    if (!response) return;
    applySnapshot(response);
    if (response.edge) {
      await selectEntity("edge", response.edge.id, true);
      switchTab("inspect");
    }
    if (response.notice) toast(response.notice, "info", 5e3);
    else toast(`\u5DF2\u521B\u5EFA\u8FDE\u63A5 ${response.edge?.name || ""}`, "ok", 1800);
  }
  async function toggleEdgeDelay(edgeId) {
    const edge = edgeById(edgeId);
    if (!edge) return;
    const response = await task(() => jsonRequest(`/api/edges/${encodeURIComponent(edgeId)}`, "PATCH", { delay: !edge.delay }));
    if (!response) return;
    const index = state.scene.edges.findIndex((item) => item.id === edgeId);
    if (index >= 0) state.scene.edges[index] = response.edge;
    if (response.sim) state.sim = response.sim;
    syncUI();
    requestDraw();
    toast(response.edge.delay ? "\u5DF2\u8BBE\u4E3A\u5355\u6B65\u5EF6\u8FDF" : "\u5DF2\u53D6\u6D88\u5355\u6B65\u5EF6\u8FDF", "ok", 2e3);
    void refreshState(true);
  }
  async function deleteNode(nodeId) {
    const node = nodeById(nodeId);
    if (!node) return;
    const connected = (state.scene?.edges || []).filter((edge) => edge.source === nodeId || edge.target === nodeId).length;
    const confirmed = await confirmModal(
      `\u5220\u9664\u8282\u70B9\u300C${node.name}\u300D\uFF1F`,
      connected ? `\u5C06\u540C\u65F6\u5220\u9664 ${connected} \u6761\u76F8\u8FDE\u7684\u8FDE\u63A5\u3002\u8BE5\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002` : "\u8BE5\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002",
      "\u5220\u9664",
      true
    );
    if (!confirmed) return;
    const response = await task(() => jsonRequest(`/api/nodes/${encodeURIComponent(nodeId)}`, "DELETE"));
    if (!response) return;
    if (state.selection.type === "node" && state.selection.id === nodeId) {
      state.selection = { type: null, id: null };
      state.inspectorId = null;
    }
    applySnapshot(response);
    renderInspector();
    toast("\u8282\u70B9\u5DF2\u5220\u9664", "ok", 1800);
  }
  async function deleteEdge(edgeId) {
    const edge = edgeById(edgeId);
    if (!edge) return;
    const confirmed = await confirmModal(
      `\u5220\u9664\u8FDE\u63A5\u300C${edge.name}\u300D\uFF1F`,
      "\u53EA\u5220\u9664\u8FD9\u6761\u4F20\u9012\u5173\u7CFB\uFF0C\u8282\u70B9\u4E0E\u5176\u5B83\u8FDE\u63A5\u4FDD\u6301\u4E0D\u53D8\u3002",
      "\u5220\u9664",
      true
    );
    if (!confirmed) return;
    const response = await task(() => jsonRequest(`/api/edges/${encodeURIComponent(edgeId)}`, "DELETE"));
    if (!response) return;
    if (state.selection.type === "edge" && state.selection.id === edgeId) {
      state.selection = { type: null, id: null };
      state.inspectorId = null;
    }
    applySnapshot(response);
    renderInspector();
    toast("\u8FDE\u63A5\u5DF2\u5220\u9664", "ok", 1800);
  }
  async function deleteSelection() {
    const { nodes, edges } = multiSelection();
    if (!nodes.size && !edges.size) return;
    await pushUndoSnapshot();
    let removed = 0;
    for (const edgeId of edges) {
      if (!edgeById(edgeId)) continue;
      const response = await task(
        () => jsonRequest(`/api/edges/${encodeURIComponent(edgeId)}`, "DELETE"),
        { history: false }
      );
      if (response) {
        removed += 1;
        applySnapshot(response);
      }
    }
    for (const nodeId of nodes) {
      if (!nodeById(nodeId)) continue;
      const response = await task(
        () => jsonRequest(`/api/nodes/${encodeURIComponent(nodeId)}`, "DELETE"),
        { history: false }
      );
      if (response) {
        removed += 1;
        applySnapshot(response);
      }
    }
    clearSelection();
    await refreshState(true);
    toast(`\u5DF2\u5220\u9664 ${removed} \u4E2A\u5BF9\u8C61`, "ok", 2200);
  }
  async function autoLayout() {
    const nodes = state.scene?.nodes || [];
    if (!nodes.length) {
      toast("\u753B\u5E03\u4E2D\u8FD8\u6CA1\u6709\u8282\u70B9", "info", 1800);
      return;
    }
    const edges = (state.scene?.edges || []).filter((edge) => edge.enabled);
    const ids = new Set(nodes.map((node) => node.id));
    const layer = new Map(nodes.map((node) => [node.id, 0]));
    if (state.mode === "circuit") {
      const ground = nodes.find((node) => node.kind === "ground");
      if (ground) layer.set(ground.id, 0);
    }
    const limit = Math.min(48, nodes.length + 4);
    for (let iteration = 0; iteration < limit; iteration += 1) {
      let changed = false;
      for (const edge of edges) {
        if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
        const candidate = (layer.get(edge.source) || 0) + 1;
        if (candidate > (layer.get(edge.target) || 0) && candidate < nodes.length + 2) {
          layer.set(edge.target, candidate);
          changed = true;
        }
      }
      if (!changed) break;
    }
    const groups = /* @__PURE__ */ new Map();
    for (const node of nodes) {
      const level = layer.get(node.id) || 0;
      if (!groups.has(level)) groups.set(level, []);
      groups.get(level).push(node);
    }
    const levels = Array.from(groups.keys()).sort((a, b) => a - b);
    const mid = (levels[0] + levels[levels.length - 1]) / 2;
    const old = new Map(nodes.map((node) => [node.id, { x: node.position.x, y: node.position.y }]));
    for (const level of levels) {
      const members = groups.get(level).sort((a, b) => {
        if (a.position.y !== b.position.y) return a.position.y - b.position.y;
        return a.name.localeCompare(b.name);
      });
      members.forEach((node, index) => {
        node.position.x = (level - mid) * 276;
        node.position.y = (index - (members.length - 1) / 2) * 128;
      });
    }
    requestDraw();
    try {
      const items = nodes.map((node) => ({
        id: node.id,
        position: { x: Number(node.position.x.toFixed(3)), y: Number(node.position.y.toFixed(3)) }
      }));
      await jsonRequest("/api/positions", "POST", { positions: items });
      fitView();
      toast("\u5DF2\u6309\u4FE1\u53F7\u6D41\u5411\u91CD\u65B0\u5E03\u5C40", "ok", 1800);
    } catch (error) {
      for (const node of nodes) {
        const previous = old.get(node.id);
        if (previous) {
          node.position.x = previous.x;
          node.position.y = previous.y;
        }
      }
      requestDraw();
      toast(`\u81EA\u52A8\u5E03\u5C40\u5931\u8D25\uFF1A${error.message}`, "error", 6e3);
    }
  }
  function fieldFor(labelText, unitText, input) {
    const wrapper = div("field");
    wrapper.appendChild(numberedField(labelText, unitText));
    wrapper.appendChild(input);
    return wrapper;
  }
  function numberInput(value, options = {}) {
    const input = el("input");
    input.type = "number";
    if (options.min !== void 0) input.min = String(options.min);
    if (options.max !== void 0) input.max = String(options.max);
    if (options.step !== void 0) input.step = String(options.step);
    input.value = String(value);
    return input;
  }
  function renderScenePanel() {
    const pane = ui.scenePane;
    if (!pane) return;
    pane.replaceChildren();
    pane.dataset.ready = "1";
    const modes = state.catalog?.modes || [
      { value: "signal", label: "\u4FE1\u53F7\u6D41" },
      { value: "circuit", label: "\u7535\u8DEF" }
    ];
    const modeSection = section("\u5DE5\u4F5C\u6A21\u5F0F", "\u5207\u6362\u4F1A\u91CD\u5EFA\u7A7A\u767D\u573A\u666F");
    const segmented = div("segmented");
    segmented.dataset.role = "mode";
    for (const item of modes) {
      const btn = button(item.label, "", () => void switchMode(item.value));
      btn.dataset.mode = item.value;
      btn.classList.toggle("active", item.value === state.mode);
      btn.title = item.description || "";
      segmented.appendChild(btn);
    }
    modeSection.appendChild(segmented);
    modeSection.appendChild(div("help", "\u4FE1\u53F7\u6D41\u6309\u62D3\u6251\u987A\u5E8F\u4F20\u64AD\u5B57\u5178\u6570\u636E\uFF1B\u7535\u8DEF\u7528\u8282\u70B9\u7535\u538B\u6CD5\u6C42\u89E3\uFF1B\u77E2\u91CF\u6A21\u5F0F\u63D0\u4F9B\u975E\u7EBF\u6027\u52A8\u6001\u6E90\u3001\u4E8C\u7EF4\u77E2\u91CF\u8FDE\u63A5\u4E0E\u76F8\u56FE\u3002"));
    pane.appendChild(modeSection);
    const simSection = section("\u4EFF\u771F\u8282\u594F", "\u4FEE\u6539\u540E\u81EA\u52A8\u5E94\u7528");
    const simGrid = div("inline-fields");
    const fpsInput = numberInput(30, { min: 1, max: 240, step: 1 });
    fpsInput.dataset.sim = "fps";
    const stepsInput = numberInput(1, { min: 1, max: 200, step: 1 });
    stepsInput.dataset.sim = "steps";
    const dtInput = numberInput(0.01, { min: 1e-9, max: 10, step: "any" });
    dtInput.dataset.sim = "dt";
    const sampleInput = numberInput(1, { min: 1, max: 100, step: 1 });
    sampleInput.dataset.sim = "sample";
    simGrid.append(
      fieldFor("\u5E27\u7387", "fps", fpsInput),
      fieldFor("\u6BCF\u5E27\u6B65\u6570", "steps", stepsInput),
      (() => {
        const field = fieldFor("\u65F6\u95F4\u6B65\u957F", "s", dtInput);
        const tools = div("inline-fields");
        const stepDown = button("\xF710", "btn tiny", () => {
          dtInput.value = trimNumber(Math.max(1e-9, Number(dtInput.value) / 10));
          dtInput.dispatchEvent(new Event("change", { bubbles: true }));
        });
        const stepUp = button("\xD710", "btn tiny", () => {
          dtInput.value = trimNumber(Math.min(10, Number(dtInput.value) * 10));
          dtInput.dispatchEvent(new Event("change", { bubbles: true }));
        });
        stepDown.title = "\u65F6\u95F4\u6B65\u957F \xF710\uFF08\u66F4\u7EC6\uFF09";
        stepUp.title = "\u65F6\u95F4\u6B65\u957F \xD710\uFF08\u66F4\u7C97\uFF09";
        tools.append(stepDown, stepUp);
        field.appendChild(tools);
        return field;
      })(),
      fieldFor("\u91C7\u6837\u95F4\u9694", "\u5E27", sampleInput)
    );
    simSection.appendChild(simGrid);
    const lockRow = div("switch-row");
    lockRow.appendChild(el("span", null, "\u9501\u5B9A dt = 1 / (fps \xD7 \u6B65\u6570)"));
    const lockInput = el("input");
    lockInput.type = "checkbox";
    lockInput.dataset.sim = "lock";
    lockRow.appendChild(lockInput);
    simSection.appendChild(lockRow);
    const realtimeRow = div("switch-row");
    realtimeRow.appendChild(el("span", null, "\u5B9E\u65F6\u8282\u62CD\uFF08\u5173\u95ED\u5219\u6781\u901F\u8FED\u4EE3\uFF09"));
    const realtimeInput = el("input");
    realtimeInput.type = "checkbox";
    realtimeInput.dataset.sim = "realtime";
    realtimeRow.appendChild(realtimeInput);
    simSection.appendChild(realtimeRow);
    const precisionRow = div("inline-fields");
    precisionRow.appendChild(el("span", null, "\u65F6\u95F4\u6B65\u957F\u9884\u8BBE"));
    for (const [label, value] of [["\u5FEB\u901F 1e-4", 1e-4], ["\u6807\u51C6 1e-5", 1e-5], ["\u9AD8\u7CBE\u5EA6 1e-6", 1e-6], ["\u8D85\u9AD8 1e-7", 1e-7]]) {
      const preset = button(label, "btn tiny", () => {
        dtInput.value = String(value);
        if (lockInput.checked) {
          lockInput.checked = false;
          dtInput.disabled = false;
        }
        void applySimConfig();
      });
      preset.dataset.dtPreset = String(value);
      preset.title = `\u65F6\u95F4\u6B65\u957F\u8BBE\u4E3A ${value} s`;
      precisionRow.appendChild(preset);
    }
    simSection.appendChild(precisionRow);
    simSection.appendChild(div("help", "\u65F6\u95F4\u6B65\u957F\u8D8A\u5C0F\u6C42\u89E3\u8D8A\u7EC6\uFF0C\u4F46\u6BCF\u5E27\u8BA1\u7B97\u91CF\u8D8A\u5927\uFF1B\u66F2\u7EBF\u5206\u8FA8\u7387\u8FD8\u53D7\u300C\u91C7\u6837\u95F4\u9694\u300D\u5F71\u54CD\u3002"));
    const simNote = div("help");
    simNote.dataset.role = "sim-note";
    simSection.appendChild(simNote);
    pane.appendChild(simSection);
    const solverSection = section("\u6C42\u89E3\u5668\u8BBE\u7F6E", "\u7535\u8DEF\u6A21\u5F0F\uFF1ANewton \u6536\u655B\u4E0E\u5931\u8D25\u6551\u6025");
    const solverGrid = div("inline-fields");
    const solverInput = (label, unit, name, value, min, max, step) => {
      const input = numberInput(value, { min, max, step });
      input.dataset.solver = name;
      return fieldFor(label, unit, input);
    };
    solverGrid.append(
      solverInput("\u76F8\u5BF9\u5BB9\u5DEE reltol", "", "reltol", 1e-9, 1e-15, 0.1, "any"),
      solverInput("\u7535\u538B\u5BB9\u5DEE vntol", "V", "vntol", 1e-6, 1e-15, 1, "any"),
      solverInput("\u7535\u6D41\u5BB9\u5DEE abstol", "A", "abstol", 1e-6, 1e-15, 1, "any"),
      solverInput("Newton \u4E0A\u9650", "\u6B21", "max_iter", 60, 1, 500, 1),
      solverInput("gmin \u6B65\u6570", "\u6B65", "gmin_steps", 10, 0, 100, 1),
      solverInput("source \u6B65\u6570", "\u6B65", "src_steps", 10, 0, 100, 1),
      solverInput("\u6B8B\u5DEE\u5BB9\u5DEE", "", "residual_tol", 0, 0, 1, "any")
    );
    solverSection.appendChild(solverGrid);
    solverSection.appendChild(div("help", "\u6B8B\u5DEE\u5BB9\u5DEE 0 = \u53EA\u8BB0\u5F55\u4E0D\u5F3A\u5236\uFF1B\u5931\u8D25\u65F6\u81EA\u52A8 gmin/source stepping\uFF0C\u4ECD\u5931\u8D25\u4F1A\u62A5\u6700\u5927\u8282\u70B9\u3002\u4FEE\u6539\u540E\u7ACB\u5373\u751F\u6548\uFF08\u91CD\u5EFA\u7535\u8DEF\u5F15\u64CE\uFF09\u3002"));
    pane.appendChild(solverSection);
    if (state.mode !== "circuit") {
      const algebraicSection = section("\u4FE1\u53F7\u6D41\u4EE3\u6570\u73AF", "\u663E\u5F0F\u9009\u62E9\uFF1B\u4E0D\u518D\u9759\u9ED8\u6539\u5199\u62D3\u6251");
      const algebraicRow = div("set-row");
      const algebraicLabel = el("label", null, "\u76F4\u63A5\u9988\u901A\u6C42\u89E3");
      algebraicLabel.appendChild(el("em", null, "\u5F00\u542F\u540E\u73AF\u8DEF\u7531 solver_plan/SCC \u6C42\u7EBF\u6027\u89E3\uFF1B\u5173\u95ED\u65F6\u542B\u73AF\u8FDE\u63A5\u62A5\u9519\uFF0C\u9664\u975E\u663E\u5F0F\u8BBE\u7F6E\u5355\u6B65\u5EF6\u8FDF"));
      const algebraicControl = div("set-control");
      const algebraicInput = el("input");
      algebraicInput.type = "checkbox";
      algebraicInput.dataset.role = "algebraic";
      algebraicInput.checked = Boolean(state.scene?.solve_algebraic);
      algebraicInput.addEventListener("change", () => void changeAlgebraicSolver(algebraicInput.checked));
      algebraicControl.appendChild(algebraicInput);
      algebraicRow.append(algebraicLabel, algebraicControl);
      algebraicSection.appendChild(algebraicRow);
      pane.appendChild(algebraicSection);
    }
    const statsSection = section("\u7F51\u7EDC\u7EDF\u8BA1", "\u8FD0\u884C\u65F6\u66F4\u65B0");
    const statsGrid = div("stat-grid");
    const statSpecs = [
      ["\u8282\u70B9", "nodes"],
      ["\u8FDE\u63A5", "edges"],
      ["\u6B65\u8017\u65F6", "step"],
      ["\u5B9E\u9645\u5E27\u7387", "fps"],
      ["\u77E9\u9635", "matrix"],
      ["Newton", "iterations"],
      ["\u5F55\u5236\u5E27", "frames"],
      ["\u4FEE\u8BA2", "revision"]
    ];
    for (const [labelText, key] of statSpecs) {
      const stat = div("stat");
      stat.appendChild(el("span", null, labelText));
      const value = el("b", null, "\u2014");
      value.dataset.stat = key;
      stat.appendChild(value);
      statsGrid.appendChild(stat);
    }
    statsSection.appendChild(statsGrid);
    pane.appendChild(statsSection);
    const integrationSection = section("\u79EF\u5206\u65B9\u6CD5", "\u4EC5\u7535\u8DEF\u6A21\u5F0F");
    const integration = el("select");
    integration.dataset.role = "integration";
    for (const item of state.catalog?.integration || []) {
      const option = el("option", null, item.label || item.value);
      option.value = item.value;
      integration.appendChild(option);
    }
    integration.addEventListener("change", () => void changeIntegration(integration.value));
    integrationSection.appendChild(integration);
    const integrationNote = div("help");
    integrationNote.dataset.role = "integration-note";
    integrationSection.appendChild(integrationNote);
    pane.appendChild(integrationSection);
    const templateSection = section("\u573A\u666F\u6A21\u677F", "\u4E00\u952E\u66FF\u6362");
    const templateList = div("template-list");
    templateList.dataset.role = "templates";
    for (const template of state.templates) {
      const item = el("button", "template");
      item.type = "button";
      const title = el("strong");
      title.append(el("span", null, template.label));
      title.append(document.createTextNode("  "));
      const modeBadge = el("span", "tpl-mode", modeLabel(template.mode));
      title.appendChild(modeBadge);
      item.appendChild(title);
      item.appendChild(el("small", null, template.description));
      if (template.sim && Object.keys(template.sim).length) {
        const bits = [];
        if (template.sim.fps) bits.push(`${template.sim.fps} fps`);
        if (template.sim.dt) bits.push(`dt ${fmt(template.sim.dt, 3)}`);
        if (template.sim.steps_per_frame) bits.push(`${template.sim.steps_per_frame} \u6B65/\u5E27`);
        item.appendChild(el("small", null, bits.join(" \xB7 ")));
      }
      item.addEventListener("click", () => void loadTemplate(template.name, template.label));
      templateList.appendChild(item);
    }
    if (!state.templates.length) templateList.appendChild(div("help", "\u6A21\u677F\u76EE\u5F55\u4E0D\u53EF\u7528\u3002"));
    templateSection.appendChild(templateList);
    pane.appendChild(templateSection);
    const projectSection = section("\u5DE5\u7A0B\u6587\u4EF6", "\u7248\u672C\u5316 .netlab \xB7 \u539F\u5B50\u5199\u5165");
    const projectName = el("input");
    projectName.type = "text";
    projectName.maxLength = 120;
    projectName.dataset.role = "project-name";
    projectName.value = state.project.name || "";
    projectName.addEventListener("change", () => {
      const value = projectName.value.trim() || "\u672A\u547D\u540D\u5DE5\u7A0B";
      if (value !== state.project.name) {
        state.project.name = value.slice(0, 120);
        markProjectDirty();
      }
      updateProjectPanel();
    });
    projectSection.appendChild(fieldFor("\u5DE5\u7A0B\u540D\u79F0", "", projectName));
    const projectPath = div("project-path");
    projectPath.dataset.role = "project-path";
    projectSection.appendChild(projectPath);
    const projectRow = div("file-row");
    projectRow.append(
      button("\u4FDD\u5B58", "btn", () => void saveProject(false)),
      button("\u53E6\u5B58\u4E3A\u2026", "btn", () => void saveProject(true)),
      button("\u6253\u5F00\u2026", "btn", () => void openProject()),
      button("\u6062\u590D\u81EA\u52A8\u4FDD\u5B58", "btn", () => void recoverAutosave())
    );
    projectSection.appendChild(projectRow);
    const autosaveRow = div("switch-row");
    autosaveRow.appendChild(
      el("span", null, `\u6BCF ${Math.round(state.project.autosaveInterval / 1e3)} \u79D2\u5199\u5DE5\u7A0B\u5FEB\u7167\uFF08\u53EA\u5199 backups/\uFF0C\u4E0D\u52A8\u6B63\u672C\uFF09`)
    );
    const autosaveToggle = el("input");
    autosaveToggle.type = "checkbox";
    autosaveToggle.dataset.role = "project-autosave";
    autosaveToggle.checked = Boolean(state.project.autosave);
    autosaveToggle.addEventListener("change", () => {
      state.project.autosave = Boolean(autosaveToggle.checked);
      try {
        localStorage.setItem(AUTOSAVE_ENABLED_KEY, state.project.autosave ? "1" : "0");
      } catch (error) {
      }
      toast(state.project.autosave ? "\u5DF2\u5F00\u542F\u81EA\u52A8\u4FDD\u5B58" : "\u5DF2\u5173\u95ED\u81EA\u52A8\u4FDD\u5B58", "info", 2e3);
    });
    autosaveRow.appendChild(autosaveToggle);
    projectSection.appendChild(autosaveRow);
    const recentBox = div("recent-projects");
    recentBox.dataset.role = "project-recent";
    projectSection.appendChild(recentBox);
    const fileInput = el("input");
    setProjectFileInput(fileInput);
    fileInput.type = "file";
    fileInput.accept = ".netlab,application/json,.json";
    fileInput.className = "hidden-input";
    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = "";
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) {
        toast("\u5DE5\u7A0B\u6587\u4EF6\u8D85\u8FC7 8 MB\uFF0C\u5DF2\u62D2\u7EDD", "error", 6e3);
        return;
      }
      void file.text().then((text) => importProjectText(text, ""));
    });
    projectSection.appendChild(fileInput);
    projectSection.appendChild(div("help", "\u5DE5\u7A0B\u53EA\u4FDD\u5B58\u62D3\u6251\u3001\u53C2\u6570\u3001\u6A21\u5757\u5B9A\u4E49\u4E0E\u754C\u9762\u504F\u597D\uFF0C\u4E0D\u4FDD\u5B58\u8FD0\u884C\u72B6\u6001\u4E0E\u5F55\u5236\u5E27\u3002\u6D4F\u89C8\u5668\u6A21\u5F0F\u901A\u8FC7\u4E0B\u8F7D/\u4E0A\u4F20\u6587\u4EF6\u4FDD\u5B58\u3002"));
    pane.appendChild(projectSection);
    const gridSection = section("\u753B\u5E03\u4E0E\u6807\u51C6\u7F51\u683C", "\u5438\u9644 \xB7 \u6B63\u4EA4\u5E03\u7EBF \xB7 \u6574\u7406");
    const gridRow = div("field-row");
    const snapBox = el("input");
    snapBox.type = "checkbox";
    snapBox.checked = Boolean(state.ui.snap);
    snapBox.addEventListener("change", () => {
      state.ui.snap = Boolean(snapBox.checked);
      markProjectDirty();
      toast(state.ui.snap ? "\u7F51\u683C\u5438\u9644\u5DF2\u5F00\u542F" : "\u7F51\u683C\u5438\u9644\u5DF2\u5173\u95ED", "info", 1800);
    });
    const gridSelect = el("select", "input");
    for (const size of [10, 20, 50]) {
      const option = el("option", null, `${size} \u5355\u4F4D`);
      option.value = String(size);
      gridSelect.appendChild(option);
    }
    gridSelect.value = String(Number(state.ui.grid) || 20);
    gridSelect.addEventListener("change", () => {
      state.ui.grid = Number(gridSelect.value) || 20;
      markProjectDirty();
      requestDraw();
    });
    gridRow.append(el("label", null, "\u5438\u9644"), snapBox, el("label", null, "\u6807\u51C6\u7F51\u683C"), gridSelect);
    gridSection.appendChild(gridRow);
    const styleRow = div("field-row");
    const nodeStyleSelect = el("select", "input");
    for (const [value, label] of [["circle", "\u7A7A\u5FC3\u5706"], ["dot", "\u5B9E\u5FC3\u70B9"], ["box", "\u5C0F\u65B9\u6846"]]) {
      const option = el("option", null, label);
      option.value = value;
      nodeStyleSelect.appendChild(option);
    }
    nodeStyleSelect.value = state.ui.nodeStyle || "circle";
    nodeStyleSelect.addEventListener("change", () => {
      state.ui.nodeStyle = nodeStyleSelect.value;
      markProjectDirty();
      requestDraw();
    });
    const scaleSelect = el("select", "input");
    for (const size of [0.8, 1, 1.2, 1.6]) {
      const option = el("option", null, `${size}\xD7`);
      option.value = String(size);
      scaleSelect.appendChild(option);
    }
    scaleSelect.value = String(Number(state.ui.symbolScale) || 1.2);
    scaleSelect.addEventListener("change", () => {
      state.ui.symbolScale = Number(scaleSelect.value) || 1.2;
      markProjectDirty();
      requestDraw();
    });
    const colorSelect = el("select", "input");
    for (const [value, label] of [["#1f5f5b", "\u9752\u7EFF"], [C("#a8541f"), "\u6696\u6A59"], ["#2563a8", "\u975B\u84DD"]]) {
      const option = el("option", null, label);
      option.value = value;
      colorSelect.appendChild(option);
    }
    colorSelect.value = state.ui.glyphColor || "#1f5f5b";
    colorSelect.addEventListener("change", () => {
      state.ui.glyphColor = colorSelect.value;
      markProjectDirty();
      requestDraw();
    });
    styleRow.append(
      el("label", null, "\u8282\u70B9\u6837\u5F0F"),
      nodeStyleSelect,
      el("label", null, "\u7B26\u53F7\u5927\u5C0F"),
      scaleSelect,
      el("label", null, "\u7B26\u53F7\u989C\u8272"),
      colorSelect
    );
    gridSection.appendChild(styleRow);
    gridSection.appendChild(
      button("\u6574\u7406\u5230\u7F51\u683C", "btn", () => void snapSceneToGrid())
    );
    gridSection.appendChild(div("help", "\u5143\u4EF6\u4F4D\u7F6E\u7531\u5143\u4EF6\u81EA\u8EAB layout \u51B3\u5B9A\uFF08\u53EF\u5728\u68C0\u67E5\u5668\u5FAE\u8C03\uFF09\uFF1B\u4E0D\u518D\u81EA\u52A8\u91CD\u6392\uFF0C\u907F\u514D\u6253\u4E71\u624B\u5DE5\u56FE\u3002"));
    gridSection.appendChild(
      div("help", "\u7535\u8DEF\u6A21\u5F0F\u65B0\u5EFA\u8FDE\u7EBF\u9ED8\u8BA4\u6B63\u4EA4\u8DEF\u7531\uFF1B\u62D6\u52A8/\u65B0\u5EFA\u8282\u70B9\u5438\u9644\u5230\u7F51\u683C\uFF1B\u6309\u4F4F Alt \u4E34\u65F6\u6682\u505C\u5438\u9644\u3002\u6574\u7406\u4F1A\u6309\u5F53\u524D\u7F51\u683C\u5BF9\u9F50\u5168\u90E8\u8282\u70B9\u4E0E\u624B\u52A8\u62D0\u70B9\uFF08\u53EF\u64A4\u9500\uFF09\u3002")
    );
    pane.appendChild(gridSection);
    updateProjectPanel();
    const dataSection = section("\u573A\u666F\u6570\u636E", "JSON");
    const fileRow = div("file-row");
    fileRow.appendChild(button("\u5BFC\u51FA JSON", "btn", () => void exportScene()));
    fileRow.appendChild(button("\u5BFC\u51FA\u539F\u7406\u56FE SVG", "btn", () => void exportSchematic()));
    fileRow.appendChild(button("\u5BFC\u5165 JSON", "btn", () => importInput.click()));
    dataSection.appendChild(fileRow);
    const importInput = el("input");
    importInput.type = "file";
    importInput.accept = "application/json,.json";
    importInput.className = "hidden-input";
    importInput.addEventListener("change", () => {
      const file = importInput.files && importInput.files[0];
      importInput.value = "";
      if (file) void importSceneFile(file);
    });
    dataSection.appendChild(importInput);
    dataSection.appendChild(div("help", "\u5BFC\u51FA\u4E0D\u542B\u8FD0\u884C\u65F6\u72B6\u6001\uFF1B\u5BFC\u5165\u4E0A\u9650 2 MB\uFF0C\u5BFC\u5165\u524D\u4F1A\u518D\u6B21\u786E\u8BA4\u3002\u670D\u52A1\u7AEF\u4F1A\u6821\u9A8C\u8282\u70B9\u3001\u8FDE\u63A5\u3001\u53C2\u6570\u4E0E\u62D3\u6251\u3002"));
    pane.appendChild(dataSection);
    for (const input of [fpsInput, stepsInput, dtInput, sampleInput, lockInput, realtimeInput]) {
      input.addEventListener("change", () => void applySimConfig());
    }
    for (const input of $$("[data-solver]", pane)) {
      input.addEventListener("change", () => void applySimConfig());
    }
    lockInput.addEventListener("change", () => {
      dtInput.disabled = lockInput.checked;
    });
    updateModeUI();
    updateScenePanelValues();
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
    const response = await task(() => jsonRequest("/api/config", "PATCH", payload));
    if (!response) {
      updateScenePanelValues();
      return;
    }
    state.sim = response.sim;
    syncUI();
    updateScenePanelValues();
    updateRunButton(Boolean(state.sim?.running));
    const solverKeys = ["reltol", "vntol", "abstol", "max_iter", "gmin_steps", "src_steps", "residual_tol"];
    toast("\u4EFF\u771F\u8BBE\u7F6E\u5DF2\u66F4\u65B0", "ok", 1600);
  }
  async function changeIntegration(value) {
    if (state.mode !== "circuit") {
      toast("\u79EF\u5206\u65B9\u6CD5\u53EA\u7528\u4E8E\u7535\u8DEF\u6A21\u5F0F", "info", 1800);
      updateScenePanelValues();
      return;
    }
    const response = await task(() => jsonRequest("/api/scene", "PATCH", { integration: value }));
    if (!response) {
      updateScenePanelValues();
      return;
    }
    applySnapshot(response);
    renderScenePanel();
    toast(`\u79EF\u5206\u65B9\u6CD5\u5DF2\u5207\u6362\u4E3A ${value === "trapezoidal" ? "\u68AF\u5F62\u6CD5" : "\u540E\u5411\u6B27\u62C9"}`, "ok", 2e3);
  }
  async function changeAlgebraicSolver(enabled) {
    const response = await task(() => jsonRequest("/api/scene/algebraic", "PUT", { enabled }));
    if (!response) {
      updateScenePanelValues();
      return;
    }
    applySnapshot(response);
    renderScenePanel();
    toast(enabled ? "\u5DF2\u5F00\u542F\u4FE1\u53F7\u6D41\u4EE3\u6570\u73AF\u76F4\u63A5\u6C42\u89E3" : "\u5DF2\u5173\u95ED\u4EE3\u6570\u73AF\u76F4\u63A5\u6C42\u89E3", "ok", 2e3);
  }
  async function switchMode(mode, options = {}) {
    if (mode === state.mode) return;
    if (!options.skipConfirm) {
      const confirmed = await confirmModal(
        `\u5207\u6362\u5230${modeLabel(mode)}\u6A21\u5F0F\uFF1F`,
        "\u5207\u6362\u4F1A\u628A\u5F53\u524D\u573A\u666F\u66FF\u6362\u4E3A\u8BE5\u6A21\u5F0F\u7684\u7A7A\u767D\u6A21\u677F\uFF0C\u8282\u70B9\u3001\u8FDE\u63A5\u3001\u53C2\u6570\u4E0E\u5F55\u5236\u6570\u636E\u90FD\u4F1A\u6E05\u7A7A\u3002\u8BF7\u5148\u5BFC\u51FA\u9700\u8981\u4FDD\u7559\u7684\u573A\u666F\u3002",
        "\u5207\u6362",
        true
      );
      if (!confirmed) return;
    }
    const response = await task(() => jsonRequest("/api/mode", "POST", { mode }));
    if (!response) return;
    state.selection = { type: null, id: null };
    state.inspectorId = null;
    state.frames = [];
    state.values.clear();
    state.nodeValues.clear();
    state.edgeValues.clear();
    applySnapshot(response);
    state.cursor = Number(response.sim?.cursor) || 0;
    renderInspector();
    renderScenePanel();
    renderSignalList();
    await fetchNetworks();
    fitView();
    toast(`\u5DF2\u5207\u6362\u5230${modeLabel(mode)}\u6A21\u5F0F`, "ok", 2200);
  }
  async function loadTemplate(name, label) {
    const nodeCount = state.scene?.nodes?.length || 0;
    if (nodeCount > 0) {
      const confirmed = await confirmModal(
        `\u8F7D\u5165\u6A21\u677F\u300C${label}\u300D\uFF1F`,
        `\u5F53\u524D\u573A\u666F\u6709 ${nodeCount} \u4E2A\u8282\u70B9\uFF0C\u5C06\u88AB\u6A21\u677F\u5B8C\u5168\u66FF\u6362\u3002\u8BF7\u5148\u5BFC\u51FA\u9700\u8981\u4FDD\u7559\u7684\u573A\u666F\u3002`,
        "\u8F7D\u5165",
        true
      );
      if (!confirmed) return;
    }
    const response = await task(() => jsonRequest(`/api/templates/${encodeURIComponent(name)}`, "POST"));
    if (!response) return;
    state.selection = { type: null, id: null };
    state.inspectorId = null;
    applySnapshot(response);
    state.cursor = Number(response.sim?.cursor) || 0;
    renderInspector();
    renderScenePanel();
    renderSignalList();
    fitView();
    toast(`\u5DF2\u8F7D\u5165\u6A21\u677F\uFF1A${label}`, "ok", 2200);
  }
  async function migrateSceneToDevices() {
    if (state.mode !== "circuit") {
      toast("\u53EA\u6709\u7535\u8DEF\u573A\u666F\u53EF\u4EE5\u8FC1\u79FB\u4E3A\u5668\u4EF6\u6A21\u578B", "error", 3500);
      return;
    }
    const confirmed = await confirmModal(
      "\u8FC1\u79FB\u4E3A\u5668\u4EF6\u6A21\u578B\uFF08R20\uFF09",
      "\u5C06\u628A\u5F53\u524D\u573A\u666F\u7684\u5143\u4EF6\u8FB9\u8F6C\u6362\u4E3A\u300C\u5668\u4EF6\u8282\u70B9 + \u5F15\u811A\u5BFC\u7EBF\u300D\uFF0C\u7F51\u7EDC\u8282\u70B9\u4FDD\u7559\uFF1B\u4E4B\u540E\u5DE5\u7A0B\u6309 v4 \u4FDD\u5B58\u3002\u8BE5\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002",
      "\u8FC1\u79FB",
      false
    );
    if (!confirmed) return;
    const response = await task(() => jsonRequest("/api/scene/migrate-devices", "POST", {}));
    if (!response) return;
    applySnapshot(response);
    const converted = Number(response.migration?.converted || 0);
    toast(`\u5DF2\u8FC1\u79FB ${converted} \u4E2A\u5143\u4EF6\u4E3A\u5668\u4EF6\u8282\u70B9`, "ok", 3e3);
    fitView(true);
  }
  async function clearScene() {
    const confirmed = await confirmModal(
      "\u6E05\u7A7A\u5F53\u524D\u573A\u666F\uFF1F",
      "\u5C06\u5220\u9664\u6240\u6709\u8282\u70B9\u4E0E\u8FDE\u63A5\uFF0C\u5E76\u91CD\u5EFA\u4E3A\u7A7A\u767D\u6A21\u677F\u3002\u8BE5\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002",
      "\u6E05\u7A7A",
      true
    );
    if (!confirmed) return;
    const response = await task(() => jsonRequest("/api/scene/clear", "POST"));
    if (!response) return;
    state.selection = { type: null, id: null };
    state.inspectorId = null;
    applySnapshot(response);
    state.cursor = Number(response.sim?.cursor) || 0;
    renderInspector();
    renderScenePanel();
    renderSignalList();
    fitView();
    toast("\u573A\u666F\u5DF2\u6E05\u7A7A", "ok", 2e3);
  }
  async function exportScene() {
    const payload = await task(() => api("/api/scene/export?include_state=false"), { dirty: false });
    if (!payload) return;
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const text = JSON.stringify(payload, null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = el("a");
    link.href = url;
    link.download = `netlab-${state.mode}-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2e3);
    toast("\u573A\u666F\u5DF2\u5BFC\u51FA", "ok", 1800);
  }
  async function exportSchematic() {
    if (state.scene?.mode !== "circuit") {
      toast("\u539F\u7406\u56FE\u5BFC\u51FA\u4EC5\u652F\u6301\u7535\u8DEF\u6A21\u5F0F", "info", 2600);
      return;
    }
    const params = new URLSearchParams({
      name: state.project?.name || "",
      network: state.currentNetwork?.name || ""
    });
    const payload = await task(
      () => jsonRequest(`/api/export/schematic?${params.toString()}`, "GET"),
      { dirty: false }
    );
    if (!payload?.svg) return;
    const blob = new Blob([String(payload.svg)], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = el("a");
    link.href = url;
    link.download = String(payload.filename || "schematic.svg");
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2e3);
    toast("\u539F\u7406\u56FE SVG \u5DF2\u5BFC\u51FA", "ok", 1800);
  }
  async function importSceneFile(file) {
    if (file.size > MAX_IMPORT_BYTES) {
      toast("\u573A\u666F\u6587\u4EF6\u8D85\u8FC7 2 MB\uFF0C\u5DF2\u62D2\u7EDD", "error", 6e3);
      return;
    }
    let payload;
    try {
      const text = await file.text();
      payload = JSON.parse(text);
    } catch (error) {
      toast(`JSON \u89E3\u6790\u5931\u8D25\uFF1A${error.message}`, "error", 6e3);
      return;
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      toast("\u573A\u666F\u5FC5\u987B\u662F JSON \u5BF9\u8C61", "error", 5e3);
      return;
    }
    if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) {
      toast("\u573A\u666F\u5FC5\u987B\u5305\u542B nodes \u4E0E edges \u6570\u7EC4", "error", 5e3);
      return;
    }
    const confirmed = await confirmModal(
      "\u5BFC\u5165\u5E76\u66FF\u6362\u5F53\u524D\u573A\u666F\uFF1F",
      `\u6587\u4EF6\u5305\u542B ${payload.nodes.length} \u4E2A\u8282\u70B9\u3001${payload.edges.length} \u6761\u8FDE\u63A5\u3002\u5BFC\u5165\u4F1A\u6E05\u7A7A\u5F53\u524D\u573A\u666F\u7684\u8282\u70B9\u3001\u8FDE\u63A5\u4E0E\u5F55\u5236\u6570\u636E\u3002`,
      "\u5BFC\u5165",
      true
    );
    if (!confirmed) return;
    const response = await task(() => jsonRequest("/api/scene", "POST", payload));
    if (!response) return;
    state.selection = { type: null, id: null };
    state.inspectorId = null;
    state.frames = [];
    state.values.clear();
    state.nodeValues.clear();
    state.edgeValues.clear();
    applySnapshot(response);
    state.cursor = Number(response.sim?.cursor) || 0;
    renderInspector();
    renderScenePanel();
    renderSignalList();
    fitView();
    toast("\u573A\u666F\u5DF2\u5BFC\u5165", "ok", 2200);
  }
  function decodeProbeKey(key) {
    if (key.startsWith("n:")) {
      const rest = key.slice(2);
      const cut = rest.lastIndexOf(":");
      return {
        group: "\u8282\u70B9",
        label: cut > 0 ? `${rest.slice(0, cut)} \xB7 ${rest.slice(cut + 1)}` : rest,
        target: "\u8282\u70B9"
      };
    }
    if (key.startsWith("e:")) {
      const rest = key.slice(2);
      const cut = rest.lastIndexOf(":");
      return {
        group: "\u8FDE\u63A5",
        label: cut > 0 ? `${rest.slice(0, cut)} \xB7 ${rest.slice(cut + 1)}` : rest,
        target: "\u8FDE\u63A5"
      };
    }
    return { group: "\u4FE1\u53F7", label: key };
  }
  function renderSignalList() {
    if (!ui.signalList) return;
    ui.signalList.replaceChildren();
    if (!state.probeKeys.length) {
      ui.signalList.appendChild(div("help", "\u8FD0\u884C\u4EFF\u771F\u540E\u81EA\u52A8\u5217\u51FA\u53EF\u7ED8\u5236\u4FE1\u53F7\u3002"));
      renderLegend();
      return;
    }
    const filter = state.chart.filter.trim().toLowerCase();
    const keys = state.probeKeys.filter((key) => key.toLowerCase().includes(filter));
    if (!keys.length) {
      ui.signalList.appendChild(div("help", "\u6CA1\u6709\u5339\u914D\u7684\u4FE1\u53F7\u3002"));
      renderLegend();
      return;
    }
    const groups = /* @__PURE__ */ new Map();
    for (const key of keys) {
      const info = decodeProbeKey(key);
      if (!groups.has(info.group)) groups.set(info.group, []);
      groups.get(info.group).push({ key, info });
    }
    for (const [group, entries] of groups) {
      ui.signalList.appendChild(div("signal-group", group));
      for (const { key, info } of entries) {
        const item = el("label", "signal-item");
        item.dataset.key = key;
        item.title = key;
        const dot = el("span", "legend-dot");
        dot.style.background = colorForKey(key);
        const checkbox = el("input");
        checkbox.type = "checkbox";
        checkbox.checked = state.chart.selected.has(key);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) {
            if (state.chart.selected.size >= CHART_KEYS) {
              checkbox.checked = false;
              toast(`\u6700\u591A\u540C\u65F6\u7ED8\u5236 ${CHART_KEYS} \u6761\u4FE1\u53F7`, "info", 2200);
              return;
            }
            state.chart.selected.add(key);
          } else {
            state.chart.selected.delete(key);
          }
          renderLegend();
          scheduleChartDraw();
        });
        const name = el("span", null, info.label);
        const value = el("em", null, state.values.has(key) ? fmt(state.values.get(key), 3) : "\u2014");
        value.dataset.signalValue = key;
        item.append(dot, checkbox, name, value);
        ui.signalList.appendChild(item);
      }
    }
    updateSignalListValues();
    renderLegend();
  }
  function updateSignalListValues() {
    for (const node of $$("[data-signal-value]", ui.signalList)) {
      const key = node.dataset.signalValue;
      node.textContent = state.values.has(key) ? fmt(state.values.get(key), 3) : "\u2014";
    }
  }
  function renderLegend() {
    if (!ui.legend) return;
    ui.legend.replaceChildren();
    const keys = Array.from(state.chart.selected);
    if (!keys.length) {
      ui.legend.appendChild(div("help", "\u52FE\u9009\u4E0A\u65B9\u4FE1\u53F7\u4EE5\u7ED8\u5236\u66F2\u7EBF\u3002"));
      return;
    }
    for (const key of keys) {
      const item = div("legend-item");
      const dot = el("span", "legend-dot");
      dot.style.background = colorForKey(key);
      const name = el("span", "legend-name", decodeProbeKey(key).label);
      name.title = key;
      const value = el("span", "legend-value", state.values.has(key) ? fmt(state.values.get(key), 4) : "\u2014");
      value.dataset.legendValue = key;
      item.append(dot, name, value);
      ui.legend.appendChild(item);
    }
  }
  function updateLegendValues() {
    for (const node of $$("[data-legend-value]", ui.legend)) {
      const key = node.dataset.legendValue;
      node.textContent = state.values.has(key) ? fmt(state.values.get(key), 4) : "\u2014";
    }
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
    scheduleChartDraw();
  }
  function leaveReplay() {
    state.replay.active = false;
    state.replay.index = Math.max(0, state.frames.length - 1);
    stopReplayTimer();
    updateReplayUI();
    scheduleChartDraw();
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
      scheduleChartDraw();
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
        scheduleChartDraw();
        return;
      }
      next = max > 0 ? next % (max + 1) : 0;
    }
    state.replay.index = next;
    updateReplayUI();
    scheduleChartDraw();
  }
  function drawChart() {
    if (activeTab() !== "chart") return;
    const { w, h, dpr } = state.chartSize;
    if (w < 20 || h < 20) return;
    chartCanvas.dataset.renderSize = `${w}x${h}@${dpr}`;
    chartCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    chartCtx.clearRect(0, 0, w, h);
    chartCtx.fillStyle = C("#faf8f2");
    chartCtx.fillRect(0, 0, w, h);
    const keys = Array.from(state.chart.selected);
    const frames = state.replay.active ? state.frames.slice(0, state.replay.index + 1) : state.frames;
    if (!keys.length || !frames.length) {
      chartCtx.fillStyle = C("#969083");
      chartCtx.font = '12px "Segoe UI", "Microsoft YaHei", sans-serif';
      chartCtx.textAlign = "center";
      chartCtx.textBaseline = "middle";
      chartCtx.fillText(frames.length ? "\u5728\u4FE1\u53F7\u5217\u8868\u91CC\u52FE\u9009\u8981\u7ED8\u5236\u7684\u4FE1\u53F7" : "\u8FD0\u884C\u4EFF\u771F\u540E\u81EA\u52A8\u91C7\u96C6\u8F68\u8FF9", w / 2, h / 2);
      return;
    }
    const left = 54;
    const right = 14;
    const top = 14;
    const bottom = 24;
    const plotW = Math.max(10, w - left - right);
    const plotH = Math.max(10, h - top - bottom);
    const window2 = Math.max(0.1, Number(state.chart.window) || 5);
    const tMax = frames[frames.length - 1].t;
    const tMin = Math.max(0, tMax - window2);
    const spanT = Math.max(1e-9, tMax - tMin);
    let startAt = 0;
    {
      let lo = 0;
      let hi = frames.length;
      while (lo < hi) {
        const mid = lo + hi >> 1;
        if (frames[mid].t < tMin) lo = mid + 1;
        else hi = mid;
      }
      startAt = lo;
    }
    const visibleCount = frames.length - startAt;
    const stride = visibleCount > plotW * 4 ? Math.ceil(visibleCount / (plotW * 4)) : 1;
    const lastFrame = frames[frames.length - 1];
    const series = [];
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const key of keys) {
      const color = colorForKey(key);
      const points = [];
      for (let i = startAt; i < frames.length; i += stride) {
        const frame = frames[i];
        const value = frame.v[key];
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        points.push({ t: frame.t, v: value });
        if (value < yMin) yMin = value;
        if (value > yMax) yMax = value;
      }
      if (lastFrame && lastFrame.t >= tMin && lastFrame.v && typeof lastFrame.v[key] === "number" && Number.isFinite(lastFrame.v[key]) && (!points.length || points[points.length - 1].t !== lastFrame.t)) {
        const lastV = lastFrame.v[key];
        points.push({ t: lastFrame.t, v: lastV });
        if (lastV < yMin) yMin = lastV;
        if (lastV > yMax) yMax = lastV;
      }
      series.push({ key, color, points });
    }
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
      chartCtx.fillStyle = C("#969083");
      chartCtx.font = '12px "Segoe UI", "Microsoft YaHei", sans-serif';
      chartCtx.textAlign = "center";
      chartCtx.fillText("\u6240\u9009\u4FE1\u53F7\u5728\u65F6\u95F4\u7A97\u5185\u6CA1\u6709\u6570\u503C", w / 2, h / 2);
      return;
    }
    let spanY = yMax - yMin;
    if (spanY < 1e-9) {
      const pad = Math.max(1, Math.abs(yMax) * 0.2);
      yMin -= pad;
      yMax += pad;
      spanY = yMax - yMin;
    } else {
      const pad = spanY * 0.12;
      yMin -= pad;
      yMax += pad;
      spanY = yMax - yMin;
    }
    const xOf = (t) => left + (t - tMin) / spanT * plotW;
    const yOf = (v) => top + (1 - (v - yMin) / spanY) * plotH;
    chartCtx.font = '10px "Cascadia Code", Consolas, monospace';
    chartCtx.lineWidth = 1;
    chartCtx.textBaseline = "middle";
    for (let index = 0; index <= 4; index += 1) {
      const y = top + plotH * index / 4;
      chartCtx.strokeStyle = index === 4 ? tokens().axisLine : tokens().gridLine;
      chartCtx.beginPath();
      chartCtx.moveTo(left, Math.round(y) + 0.5);
      chartCtx.lineTo(left + plotW, Math.round(y) + 0.5);
      chartCtx.stroke();
      chartCtx.fillStyle = C("#8b8376");
      chartCtx.textAlign = "right";
      chartCtx.fillText(fmt(yMax - spanY * index / 4, 3), left - 8, y);
    }
    for (let index = 0; index <= 4; index += 1) {
      const x = left + plotW * index / 4;
      chartCtx.strokeStyle = index === 0 ? tokens().axisLine : tokens().gridLine;
      chartCtx.beginPath();
      chartCtx.moveTo(Math.round(x) + 0.5, top);
      chartCtx.lineTo(Math.round(x) + 0.5, top + plotH);
      chartCtx.stroke();
      chartCtx.fillStyle = C("#8b8376");
      chartCtx.textAlign = index === 0 ? "left" : index === 4 ? "right" : "center";
      const tick = tMin + spanT * index / 4;
      const decimals = spanT >= 10 ? 1 : spanT >= 1 ? 2 : spanT >= 0.1 ? 3 : spanT >= 0.01 ? 4 : 5;
      chartCtx.fillText(`${tick.toFixed(decimals)}s`, x, top + plotH + 12);
    }
    chartCtx.save();
    chartCtx.beginPath();
    chartCtx.rect(left, top, plotW, plotH);
    chartCtx.clip();
    chartCtx.lineJoin = "round";
    chartCtx.lineCap = "round";
    for (const item of series) {
      if (!item.points.length) continue;
      chartCtx.strokeStyle = item.color;
      chartCtx.lineWidth = 1.6;
      chartCtx.beginPath();
      item.points.forEach((point, index) => {
        const x = xOf(point.t);
        const y = yOf(point.v);
        if (index === 0) chartCtx.moveTo(x, y);
        else chartCtx.lineTo(x, y);
      });
      chartCtx.stroke();
      const last = item.points[item.points.length - 1];
      chartCtx.fillStyle = item.color;
      chartCtx.beginPath();
      chartCtx.arc(xOf(last.t), yOf(last.v), 2.4, 0, Math.PI * 2);
      chartCtx.fill();
    }
    const hover = state.chart.hover;
    if (hover && hover.x >= left && hover.x <= left + plotW && hover.y >= top && hover.y <= top + plotH) {
      const t = tMin + (hover.x - left) / plotW * spanT;
      const frame = nearestFrame(t);
      if (frame) {
        const hx = xOf(frame.t);
        chartCtx.strokeStyle = C("rgba(168, 84, 31, .45)");
        chartCtx.lineWidth = 1;
        chartCtx.setLineDash([3, 3]);
        chartCtx.beginPath();
        chartCtx.moveTo(hx, top);
        chartCtx.lineTo(hx, top + plotH);
        chartCtx.stroke();
        chartCtx.setLineDash([]);
        for (const item of series) {
          const value = frame.v[item.key];
          if (typeof value !== "number" || !Number.isFinite(value)) continue;
          chartCtx.beginPath();
          chartCtx.arc(hx, yOf(value), 2.8, 0, Math.PI * 2);
          chartCtx.fillStyle = item.color;
          chartCtx.fill();
        }
        const rows = series.filter((item) => typeof frame.v[item.key] === "number" && Number.isFinite(frame.v[item.key])).slice(0, 5).map((item) => `${decodeProbeKey(item.key).label}  ${fmt(frame.v[item.key], 4)}`);
        const lines = [`t = ${fmt(frame.t, 4)} s`, ...rows];
        chartCtx.font = '10px "Cascadia Code", Consolas, monospace';
        let boxW = 0;
        for (const line of lines) boxW = Math.max(boxW, chartCtx.measureText(line).width);
        boxW += 16;
        const boxH = lines.length * 15 + 10;
        const boxX = clamp(hx + 12, left + 4, left + plotW - boxW - 4);
        const boxY = clamp(top + 6, top + 4, top + plotH - boxH - 4);
        chartCtx.fillStyle = tokens().hudBg;
        chartCtx.strokeStyle = C("#bcb3a1");
        chartCtx.lineWidth = 1;
        roundRectPath(chartCtx, boxX, boxY, boxW, boxH, 6);
        chartCtx.fill();
        chartCtx.stroke();
        chartCtx.textAlign = "left";
        chartCtx.textBaseline = "top";
        lines.forEach((line, index) => {
          chartCtx.fillStyle = index === 0 ? C("#a8541f") : tokens().edgeHover;
          chartCtx.fillText(line, boxX + 8, boxY + 6 + index * 15);
        });
      }
    }
    chartCtx.restore();
  }
  function setWorkspaceButtons() {
    if (!ui.workspaceSwitch) return;
    $$("button[data-workspace]", ui.workspaceSwitch).forEach((item) => {
      item.classList.toggle("active", item.dataset.workspace === state.workspace);
    });
  }
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
      const data = await api(`/api/live?cursor=${state.cursor}&limit=600`);
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
      const snapshot = await api("/api/state");
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
    const response = await task(() => jsonRequest("/api/control", "POST", body), { dirty: false });
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
      openRunWarn();
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
  function openRunWarn() {
    if (document.getElementById("runWarnWin")) return;
    const overlay = document.createElement("div");
    overlay.id = "runWarnWin";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(16,20,18,.45);display:flex;align-items:center;justify-content:center;z-index:9999;";
    const card = document.createElement("div");
    card.style.cssText = 'width:520px;max-width:92vw;background:var(--paper,#faf8f2);color:var(--text-primary,#080a08);border:1px solid var(--line,#cfc6b5);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.28);padding:22px 24px 18px;font:13px/1.7 "Microsoft YaHei UI",sans-serif;';
    card.innerHTML = `
      <div style="font-size:16px;font-weight:700;margin-bottom:6px;">\u8FD0\u884C\u524D\u5EFA\u8BAE\u5148\u9884\u8BA1\u7B97</div>
      <div style="color:var(--text-secondary,#7b7266);margin-bottom:14px;">
        \u5B9E\u65F6\u8FD0\u884C\u53EA\u767B\u8BB0\u63A2\u9488\uFF0C\u7ED8\u56FE\u9762\u677F\u4E0D\u4F1A\u8FB9\u7B97\u8FB9\u753B\u3002\u5148\u7528\u4E0B\u9762\u7684\u65F6\u95F4\u7A97\u628A 0\u2192T \u6574\u6BB5\u7B97\u5B8C\uFF0C
        \u4E4B\u540E\u5728\u300C\u7ED8\u56FE\u300D\u9875\u53EF\u4EE5\u6BEB\u79D2\u7EA7\u56DE\u653E\u3001\u5E76\u76F4\u63A5\u63A5\u5165\u4E3A\u6570\u636E\u6E90\u3002
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <span>\u9884\u8BA1\u7B97\u65F6\u95F4\u7A97</span>
        <input id="runWarnSec" type="number" min="1" max="120" step="1" value="${Math.max(1, Math.min(120, Math.round(Number(state.chart && state.chart.window || 5))))}"
          style="width:84px;padding:5px 8px;border:1px solid var(--line,#cfc6b5);border-radius:8px;background:var(--field-bg,#ffffff);color:var(--text-input,#111814);-webkit-text-fill-color:var(--text-input,#111814);font:600 14px/1.4 'Microsoft YaHei UI',sans-serif;" />
        <span>s</span>
        <span id="runWarnChips" style="display:flex;gap:6px;margin-left:6px;"></span>
      </div>
      <div id="runWarnInfo" style="color:var(--text-secondary,#7b7266);min-height:20px;margin-bottom:6px;"></div>
      <label style="display:flex;align-items:center;gap:8px;margin:10px 0 16px;color:var(--text-secondary,#7b7266);">
        <input id="runWarnNever" type="checkbox" /> \u4EE5\u540E\u4E0D\u518D\u63D0\u793A
      </label>
      <div style="display:flex;justify-content:flex-end;gap:10px;">
        <button id="runWarnCancel" class="ghost" style="padding:7px 14px;border:1px solid var(--line,#cfc6b5);border-radius:9px;background:transparent;color:inherit;cursor:pointer;">\u53D6\u6D88</button>
        <button id="runWarnRun" class="ghost" style="padding:7px 14px;border:1px solid var(--line,#cfc6b5);border-radius:9px;background:transparent;color:inherit;cursor:pointer;">\u76F4\u63A5\u8FD0\u884C</button>
        <button id="runWarnStop" class="ghost" style="display:none;padding:7px 14px;border:1px solid var(--red,#b75555);border-radius:9px;background:transparent;color:var(--text-button-danger,#b75555);cursor:pointer;">\u505C\u6B62\u8BA1\u7B97</button>
        <button id="runWarnPre" class="primary" style="padding:7px 16px;border:1px solid var(--accent,#9b7247);border-radius:9px;background:var(--accent,#9b7247);color:var(--text-on-accent,#f7f4ee);cursor:pointer;">\u9884\u8BA1\u7B97\u5E76\u63A5\u5165</button>
      </div>`;
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    const sec = card.querySelector("#runWarnSec");
    const info = card.querySelector("#runWarnInfo");
    const chips = card.querySelector("#runWarnChips");
    [1, 5, 10, 30].forEach((v) => {
      const b = document.createElement("button");
      b.textContent = v + "s";
      b.style.cssText = "padding:3px 9px;border:1px solid var(--line,#cfc6b5);border-radius:999px;background:transparent;color:inherit;cursor:pointer;font:inherit;";
      b.onclick = () => {
        sec.value = String(v);
      };
      chips.appendChild(b);
    });
    const close = () => overlay.remove();
    overlay.onclick = (ev) => {
      if (ev.target === overlay) close();
    };
    card.querySelector("#runWarnCancel").onclick = close;
    card.querySelector("#runWarnRun").onclick = () => {
      if (card.querySelector("#runWarnNever").checked) void setPref("runWarn", false);
      close();
      void control("toggle", void 0, { skipWarn: true });
    };
    card.querySelector("#runWarnPre").onclick = async () => {
      const seconds = Math.max(1, Math.min(120, Math.round(Number(sec.value) || 5)));
      if (card.querySelector("#runWarnNever").checked) void setPref("runWarn", false);
      const btn = card.querySelector("#runWarnPre");
      const stopBtn = card.querySelector("#runWarnStop");
      btn.disabled = true;
      btn.textContent = "\u9884\u8BA1\u7B97\u4E2D\u2026";
      info.textContent = `\u6B63\u5728\u8BA1\u7B97 0\u2192${seconds}s\u2026`;
      stopBtn.style.display = "inline-block";
      stopBtn.disabled = false;
      stopBtn.textContent = "\u505C\u6B62\u8BA1\u7B97";
      stopBtn.onclick = async () => {
        stopBtn.disabled = true;
        stopBtn.textContent = "\u6B63\u5728\u505C\u6B62\u2026";
        try {
          await api("/api/control", { method: "POST", body: JSON.stringify({ action: "cancel_precompute" }) });
        } catch (error) {
          info.textContent = `\u53D6\u6D88\u5931\u8D25\uFF1A${error.message || "\u8BF7\u6C42\u5931\u8D25"}`;
        }
      };
      try {
        const pre = await runPrecomputeWithProgress(
          () => api("/api/plotkit/precompute", {
            method: "POST",
            body: JSON.stringify({ seconds }),
            timeoutMs: 18e4
          }),
          `\u6B63\u5728\u8BA1\u7B97 0\u2192${seconds}s`
        );
        if (!pre || pre.ok === false) {
          info.textContent = "\u9884\u8BA1\u7B97\u5931\u8D25\uFF1A" + (pre && pre.error || "\u672A\u77E5\u9519\u8BEF") + "\uFF0C\u53EF\u76F4\u63A5\u8FD0\u884C\u6216\u7F29\u5C0F\u65F6\u95F4\u7A97\u91CD\u8BD5\u3002";
          return;
        }
        if (pre.cancelled) {
          info.textContent = `\u5DF2\u505C\u6B62\uFF1A\u4FDD\u7559\u524D ${pre.frames ?? "?"} \u5E27\uFF08${Number(pre.last_time || 0).toFixed(3)}s\uFF09\u3002`;
          return;
        }
        state.precomputedSeconds = seconds;
        state.precomputedRevision = state.scene?.revision ?? null;
        await syncAfterPrecompute(pre);
        const preNote = pre.degraded ? `\uFF08\u6B65\u957F\u53D7 20 \u4E07\u6B65\u4E0A\u9650\u9650\u5236\uFF1A\u8BF7\u6C42 ${Number(pre.requested_dt).toExponential(1)}s\uFF0C\u5B9E\u9645 ${Number(pre.dt_used).toExponential(1)}s\uFF09` : "";
        info.textContent = `\u5B8C\u6210\uFF1A${seconds}s / ${pre.frames ?? "?"} \u5E27 / ${Math.round(pre.elapsed_ms || 0)} ms${preNote}`;
        toast(
          pre.degraded ? `\u9884\u8BA1\u7B97\u5B8C\u6210\u4F46\u5DF2\u964D\u7EA7\u6B65\u957F\uFF08${Number(pre.dt_used).toExponential(1)}s\uFF09\uFF1A${pre.frames ?? "?"} \u5E27\uFF0C\u7F29\u5C0F\u65F6\u95F4\u7A97\u53EF\u63D0\u9AD8\u7CBE\u5EA6` : `\u9884\u8BA1\u7B97\u5B8C\u6210\uFF1A${pre.frames ?? "?"} \u5E27\uFF0C\u53BB\u300C\u7ED8\u56FE\u300D\u9875\u52FE\u9009\u63A2\u9488\u540E\u70B9\u300C\u63A5\u5165\u300D`,
          pre.degraded ? "warn" : "ok",
          pre.degraded ? 5200 : 4200
        );
        close();
        const tab = document.querySelector('[data-sub="plotkit"]');
        if (tab) tab.click();
        setTimeout(() => refreshPkChannels(true), 400);
      } catch (error) {
        info.textContent = `\u9884\u8BA1\u7B97\u5931\u8D25\uFF1A${error.message || "\u8BF7\u6C42\u5931\u8D25"}\uFF1B\u53EF\u76F4\u63A5\u8FD0\u884C\u6216\u68C0\u67E5\u684C\u9762\u4F1A\u8BDD\u3002`;
      } finally {
        stopBtn.style.display = "none";
        btn.disabled = false;
        btn.textContent = "\u9884\u8BA1\u7B97\u5E76\u63A5\u5165";
      }
    };
    sec.focus();
  }
  async function maybeAutostart() {
    return;
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      await fetch("/api/shutdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
        signal: controller.signal
      });
    } catch (error) {
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, 550));
    showShutdownScreen();
  }
  const SHELL_KEYS = {
    netWidth: "netlab.networks.width",
    netCollapsed: "netlab.networks.collapsed",
    panelCollapsed: "netlab.panel.collapsed",
    panelWidth: "netlab.panel.width"
  };
  function menuDefinition() {
    return [
      {
        label: "\u6587\u4EF6",
        items: [
          { label: "\u65B0\u5EFA\u5DE5\u7A0B", hint: "\u66FF\u6362\u5F53\u524D\u573A\u666F\uFF08\u672A\u4FDD\u5B58\u4F1A\u63D0\u793A\uFF09", action: () => void newProject() },
          { label: "\u6253\u5F00\u5DE5\u7A0B\u2026", action: () => void openProject() },
          { label: "\u4FDD\u5B58\u5DE5\u7A0B", action: () => void saveProject(false) },
          { label: "\u53E6\u5B58\u4E3A\u2026", action: () => void saveProject(true) },
          { sep: true },
          { label: "\u6062\u590D\u81EA\u52A8\u4FDD\u5B58", action: () => void recoverAutosave() },
          { label: "\u5BFC\u51FA\u573A\u666F JSON", hint: "Ctrl+Shift+E\uFF08\u4E0B\u4E00\u7968\uFF09", action: () => void exportScene() },
          { sep: true },
          { label: "\u9000\u51FA\u670D\u52A1", action: () => void shutdownApp() }
        ]
      },
      {
        label: "\u7F16\u8F91",
        items: [
          { label: "\u64A4\u9500", hint: "Ctrl+Z\uFF08100 \u6B65\uFF09", action: () => void undo() },
          { label: "\u91CD\u505A", hint: "Ctrl+Shift+Z", action: () => void redo() },
          { sep: true },
          { label: "\u590D\u5236", hint: "Ctrl+C", action: () => copySelection(false) },
          { label: "\u526A\u5207", hint: "Ctrl+X", action: () => copySelection(true) },
          { label: "\u7C98\u8D34", hint: "Ctrl+V\uFF08\u8DE8\u7F51\u7EDC\u9700\u786E\u8BA4\uFF09", action: () => void pasteClipboard() },
          { label: "\u5168\u9009", hint: "Ctrl+A", action: () => selectAll() },
          { sep: true },
          { label: "\u5220\u9664\u9009\u4E2D", hint: "Delete", action: () => void deleteSelection() },
          { label: "\u6279\u91CF\u8BBE\u7F6E\u5C3A\u5BF8\u2026", hint: "\u591A\u9009\u8282\u70B9/\u5668\u4EF6\u540E\u7EDF\u4E00\u5BBD\u6216\u76F4\u5F84", action: () => void batchResizeSelection() },
          { label: "\u6E05\u7A7A\u573A\u666F", action: () => void clearScene() }
        ]
      },
      {
        label: "\u89C6\u56FE",
        items: [
          { label: "\u9002\u914D\u89C6\u56FE", action: () => fitView(true) },
          { label: "\u653E\u5927", action: () => zoomCenter(1.2) },
          { label: "\u7F29\u5C0F", action: () => zoomCenter(1 / 1.2) },
          { label: "\u81EA\u52A8\u5E03\u5C40", action: () => void autoLayout() },
          { label: "\u5207\u6362\u7F51\u683C\u5438\u9644", hint: "Alt \u62D6\u52A8\u53EF\u4E34\u65F6\u6682\u505C", action: () => toggleSnap() },
          { label: "\u5207\u6362\u7B26\u53F7\u98CE\u683C", hint: "\u7ECF\u5178\u5706\u5F62 / GB \u77E9\u5F62\uFF08\u5DE5\u7A0B\u7EA7\uFF09", action: () => toggleSymbol() },
          { label: "\u663E\u793A / \u9690\u85CF\u5F15\u811A\u540D", hint: "\u5668\u4EF6\u6846\u5F15\u811A\u6807\u6CE8", action: () => {
            state.ui.showPins = state.ui.showPins === false;
            requestDraw();
          } },
          { sep: true },
          { label: "\u6536\u8D77 / \u5C55\u5F00\u5DE6\u4FA7\u7F51\u7EDC\u680F", action: () => toggleNetworks() },
          { label: "\u6536\u8D77 / \u5C55\u5F00\u53F3\u4FA7\u9762\u677F", action: () => togglePanel() }
        ]
      },
      {
        label: "\u5DE5\u7A0B \xB7 \u7F51\u7EDC",
        items: [
          { label: "\u65B0\u5EFA\u7F51\u7EDC", action: () => void addNetwork() },
          { label: "\u91CD\u547D\u540D\u5F53\u524D\u7F51\u7EDC\u2026", action: () => void renameNetwork() },
          { label: "\u5220\u9664\u5F53\u524D\u7F51\u7EDC\u2026", action: () => void deleteNetwork() },
          { sep: true },
          { label: "\u5237\u65B0\u7F51\u7EDC\u5217\u8868", action: () => void fetchNetworks(false) },
          { label: "\u5DE5\u7A0B\u6587\u4EF6\u4F4D\u7F6E", hint: "\u5F53\u524D\u4FDD\u5B58\u8DEF\u5F84", action: () => {
            const path = state.project.path || "\u5C1A\u672A\u4FDD\u5B58\uFF1A\u6587\u4EF6\u83DC\u5355\u53EF\u7528\u300C\u4FDD\u5B58\u5DE5\u7A0B\u300D\u843D\u76D8";
            toast(path, "info", 5e3);
          } }
        ]
      },
      {
        label: "\u4EFF\u771F",
        items: [
          { label: "\u8FD0\u884C / \u6682\u505C", hint: "\u7A7A\u683C", action: () => void control("toggle") },
          { label: "\u9884\u8BA1\u7B97\u6570\u636E\u2026", hint: "\u5148\u7B97 0\u2192T\uFF0C\u518D\u5728\u7ED8\u56FE\u9875\u56DE\u653E/\u63A5\u5165", action: () => openRunWarn() },
          { label: "\u5355\u6B65", hint: "S", action: () => void control("step") },
          { label: "\u65F6\u95F4\u5F52\u96F6", hint: "\u53EA\u5F52\u96F6\u8BA1\u65F6\u4E0E\u5F55\u5236\uFF0C\u4E0D\u6E05\u72B6\u6001", action: () => void control("zero") },
          { label: "\u91CD\u7F6E", hint: "\u6E05\u9664\u72B6\u6001\u4E0E\u65F6\u95F4", action: () => void control("reset") }
        ]
      },
      {
        label: "\u5206\u6790",
        items: [
          { label: "\u5206\u6790\u9762\u677F", action: () => switchTab("analysis") },
          { label: "\u5BFC\u51FA CSV", action: () => void exportAnalysisCsv() }
        ]
      },
      {
        label: "\u5DE5\u5177",
        items: [
          { label: "\u5168\u5C40\u641C\u7D22\u2026", hint: "Ctrl+K / R14", action: () => openDocSearch() },
          { sep: true },
          { label: "\u8282\u70B9\u51FD\u6570", action: () => switchTab("node-fn") },
          { label: "\u8FDE\u63A5\u51FD\u6570", action: () => switchTab("edge-fn") },
          { label: "\u6A21\u5757\u4E0E\u6269\u5C55", action: () => switchTab("blocks") },
          { sep: true },
          { label: "\u4EE3\u7801\u5DE5\u4F5C\u533A\uFF08VS Code\uFF09", hint: "\u672C\u5730 IDE \xB7 \u7EC8\u7AEF / \u6269\u5C55 / \u8C03\u8BD5", action: () => void openVscode() },
          { sep: true },
          { label: "\u6027\u80FD\u9762\u677F", action: () => switchTab("analysis") },
          { label: "\u7F13\u5B58\u4F53\u68C0\u4E0E\u6E05\u7406\u2026", hint: "\u53EA\u6E05\u53EF\u518D\u751F\u6210\u7684\u7F13\u5B58\uFF0C\u4E0D\u78B0\u5DE5\u7A0B\u4E0E\u81EA\u52A8\u4FDD\u5B58", action: () => openCacheDialog() },
          { label: "DC \u5DE5\u4F5C\u70B9\uFF08.op\uFF09", hint: "\u4E0D\u63A8\u8FDB\u4EFF\u771F\uFF0C\u9759\u9ED8\u89E3\u4E00\u6B21\u9759\u6001\u7535\u8DEF", action: () => openAnalysis("op") },
          { label: "AC \u626B\u9891\uFF08Bode\uFF09\u2026", hint: "\u5148\u6C42\u5DE5\u4F5C\u70B9\u518D\u9010\u9891\u70B9\u6C42\u89E3", action: () => openAnalysis("ac") },
          { label: "\u8FC1\u79FB\u573A\u666F\u4E3A\u5668\u4EF6\u6A21\u578B\uFF08R20\uFF09", hint: "\u5143\u4EF6\u8FB9 \u2192 \u5668\u4EF6\u8282\u70B9 + \u5F15\u811A\u5BFC\u7EBF", action: () => void migrateSceneToDevices() },
          { label: "\u65B0\u5EFA\u8FDE\u7EBF\uFF08\u9009\u62E9\u7AEF\u70B9\uFF09\u2026", hint: "\u7F51\u7EDC\u2194\u7F51\u7EDC\u7EAF\u5BFC\u7EBF / \u5668\u4EF6\u5F15\u811A\u2194\u7F51\u7EDC", action: () => openWireDialog() }
        ]
      },
      {
        label: "\u8BBE\u7F6E",
        items: [
          { label: "\u5DE5\u7A0B\u8BBE\u7F6E\u2026", hint: "\u5DE5\u4F5C\u6A21\u5F0F / \u6A21\u677F / \u6587\u4EF6 / \u753B\u5E03\u7F51\u683C", action: () => openSettings("project") },
          { label: "\u89C6\u56FE\u4E0E\u5916\u89C2\u2026", hint: "\u4E3B\u9898 / \u5F3A\u8C03\u8272 / \u52A8\u6548 / \u6027\u80FD", action: () => openSettings("view") },
          { label: "\u4EA4\u4E92\u4E0E\u6587\u6863\u2026", hint: "\u542F\u52A8\u5F15\u5BFC / \u81EA\u52A8\u4FDD\u5B58 / \u5FEB\u6377\u952E", action: () => openSettings("interact") },
          { sep: true },
          { label: "\u91CD\u65B0\u6253\u5F00\u5F15\u5BFC\u9875", action: () => showGuide(true) },
          { label: "\u81EA\u52A8\u4FDD\u5B58", hint: state.project.autosave ? "\u5F53\u524D\uFF1A\u5F00" : "\u5F53\u524D\uFF1A\u5173", action: () => void saveAutosaveSetting({ autosave_enabled: !state.project.autosave }) }
        ]
      },
      {
        label: "\u5E2E\u52A9",
        items: [
          { label: "\u5FEB\u901F\u4E0A\u624B", action: () => openDoc("quickstart") },
          { label: "\u754C\u9762\u6307\u5357", action: () => openDoc("interface") },
          { label: "\u672F\u8BED\u8868", action: () => openDoc("glossary") },
          { label: "\u5E38\u89C1\u95EE\u9898", action: () => openDoc("faq") },
          { label: "\u5FEB\u6377\u952E", hint: "?", action: () => openDoc("shortcuts") },
          { sep: true },
          { label: "\u6587\u6863\u4E2D\u5FC3\uFF08\u641C\u7D22\uFF09", hint: "Ctrl+K", action: () => openDocSearch() },
          { label: "\u5173\u4E8E Netlab", action: () => toast("Netlab \xB7 \u62D3\u6251\u7F51\u7EDC / \u7535\u8DEF / \u70ED\u573A\u4EFF\u771F\uFF08\u672C\u5730\u8FD0\u884C\uFF09", "info", 4e3) }
        ]
      }
    ];
  }
  function closeMenus() {
    $$(".menu.open").forEach((node) => node.classList.remove("open"));
  }
  function initMenus() {
    const host = ui.menuItems;
    if (!host) return;
    host.replaceChildren();
    for (const menu of menuDefinition()) {
      const wrap = div("menu");
      const button2 = el("button", null, menu.label);
      button2.type = "button";
      button2.setAttribute("role", "menuitem");
      button2.setAttribute("aria-haspopup", "true");
      const panel = div("menu-panel");
      panel.setAttribute("role", "menu");
      for (const item of menu.items) {
        if (item.sep) {
          panel.appendChild(div("menu-sep"));
          continue;
        }
        const entry = el("button", "menu-item");
        entry.type = "button";
        entry.disabled = Boolean(item.disabled);
        entry.appendChild(el("strong", null, item.label));
        if (item.hint) entry.appendChild(el("small", null, item.hint));
        entry.addEventListener("click", () => {
          closeMenus();
          if (!item.disabled) item.action();
        });
        panel.appendChild(entry);
      }
      button2.addEventListener("click", (event) => {
        event.stopPropagation();
        const open = wrap.classList.contains("open");
        closeMenus();
        if (!open) wrap.classList.add("open");
      });
      wrap.append(button2, panel);
      host.appendChild(wrap);
    }
    document.addEventListener("pointerdown", (event) => {
      if (!event.target.closest(".menu")) closeMenus();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenus();
    });
  }
  function setInfo(key, value) {
    if (!ui.infoBar) return;
    const node = ui.infoBar.querySelector(`[data-info="${key}"]`);
    if (node) node.textContent = value;
  }
  function updateInfoBar() {
    if (!ui.infoBar) return;
    const modeLabel2 = { signal: "\u4FE1\u53F7\u6D41", circuit: "\u7535\u8DEF", vector: "\u77E2\u91CF" }[state.mode] || state.mode || "\u2014";
    const network = state.currentNetwork?.name || "\u7F51\u7EDC 1";
    const total = state.networks?.length || 1;
    const sim = state.sim || {};
    setInfo("project", `${state.project.name || "\u672A\u547D\u540D\u5DE5\u7A0B"}${state.project.dirty ? " *" : ""}`);
    setInfo("network", total > 1 ? `${network} (${total})` : network);
    setInfo("mode", modeLabel2);
    const nodes = state.scene?.nodes?.length || 0;
    const edges = state.scene?.edges?.length || 0;
    setInfo("counts", `\u8282\u70B9 ${nodes} \xB7 \u8FDE\u7EBF ${edges}`);
    const dt = Number(sim.config?.dt ?? sim.dt ?? state.scene?.sim?.dt ?? 0);
    const dtMs = dt * 1e3;
    const dtText = dt >= 1 ? `${dt.toFixed(dt % 1 ? 2 : 0)} s` : `${dtMs >= 10 ? dtMs.toFixed(0) : dtMs >= 1 ? dtMs.toFixed(1) : dtMs.toFixed(2)} ms`;
    setInfo("dt", `dt ${dtText}`);
    setInfo("time", `t ${Number(sim.time || 0).toFixed(3)} s`);
    setInfo("steps", `step ${Number(sim.steps || 0)}`);
    const alerts = Number(sim.alerts ?? sim.warnings ?? 0) || 0;
    const alertNode = ui.infoBar.querySelector('[data-info="alerts"]');
    if (alertNode) {
      alertNode.textContent = `\u544A\u8B66 ${alerts}`;
      alertNode.classList.toggle("has-alert", alerts > 0);
    }
    const run = ui.infoBar.querySelector('[data-info="run"]');
    if (run) {
      run.textContent = sim.running ? "\u8FD0\u884C\u4E2D" : "\u505C\u6B62";
      run.classList.toggle("stopped", !sim.running);
    }
  }
  async function fetchNetworks(silent = true) {
    try {
      const response = await jsonRequest("/api/networks", "GET");
      state.networks = response.networks || [];
      state.currentNetwork = state.networks.find((item) => item.current) || state.networks[0] || null;
      renderNetworkList();
      updateInfoBar();
      return state.networks;
    } catch (error) {
      if (!silent) toast(`\u7F51\u7EDC\u5217\u8868\u8BFB\u53D6\u5931\u8D25\uFF1A${error.message}`, "error", 4e3);
      return state.networks;
    }
  }
  function renderNetworkList() {
    if (!ui.networkList) return;
    ui.networkList.replaceChildren();
    for (const network of state.networks || []) {
      const item = el("button", "network-item");
      item.type = "button";
      item.setAttribute("role", "option");
      item.dataset.networkId = network.id;
      item.classList.toggle("current", Boolean(network.current));
      item.setAttribute("aria-selected", network.current ? "true" : "false");
      item.title = `${network.name} \xB7 ${network.mode} \xB7 ${network.nodes} \u8282\u70B9 / ${network.edges} \u8FDE\u63A5`;
      const dot = div("dot");
      const label = el("span", null, network.name);
      const meta = el("span", "meta", network.nodes);
      item.append(dot, label, meta);
      item.addEventListener("click", () => void switchNetwork(network.id));
      item.addEventListener("dblclick", () => void renameNetwork(network.id));
      item.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        openNetworkMenu(network, event.clientX, event.clientY);
      });
      ui.networkList.appendChild(item);
    }
  }
  function openNetworkMenu(network, x, y) {
    const isCurrent = Boolean(network.current);
    const picked = isCurrent ? multiSelection().nodes.size : 0;
    const tempModule = String(network.name || "").startsWith("\u6A21\u5757 ");
    const moduleName = tempModule ? String(network.name).slice(3).trim() : "";
    const knownBlock = moduleName ? (state.blocks || []).find((block) => block.name === moduleName) : null;
    if (tempModule && !(state.blocks || []).length) void refreshBlocks();
    const items = [
      {
        label: "\u5C01\u88C5\u9009\u4E2D\u8282\u70B9\u4E3A\u6A21\u5757\u2026",
        hint: isCurrent ? picked ? `\u5DF2\u9009 ${picked} \u4E2A\u8282\u70B9` : "\u5148\u5728\u753B\u5E03\u4E0A Ctrl+\u5355\u51FB\u591A\u9009" : "\u5148\u5207\u6362\u5230\u8BE5\u7F51\u7EDC",
        disabled: !isCurrent || !picked,
        action: () => void encapsulateSelection()
      },
      {
        label: "\u6253\u5F00\u6A21\u5757\u5E93",
        hint: "\u5C01\u88C5 / \u5B9E\u4F8B\u5316 / \u6253\u5F00\u5185\u90E8",
        action: () => switchTab("blocks")
      },
      { sep: true },
      {
        label: "\u5728\u6A21\u5757\u5185\u90E8\u6D6E\u7A97\u4E2D\u6253\u5F00",
        hint: knownBlock ? `\u9884\u89C8\u300C${moduleName}\u300D\u5185\u90E8` : tempModule ? "\u6A21\u5757\u5E93\u91CC\u627E\u4E0D\u5230\u540C\u540D\u6A21\u5757" : "\u5148\u5207\u5230\u6A21\u5757\u5185\u90E8\u4E34\u65F6\u7F51\u7EDC",
        disabled: !knownBlock,
        action: () => {
          if (knownBlock) openModuleInternal(knownBlock.id);
        }
      },
      {
        label: "\u5173\u95ED\u6A21\u5757\u5185\u90E8\u4E34\u65F6\u7F51\u7EDC",
        disabled: !tempModule,
        action: () => void closeInternalNetwork()
      }
    ];
    showFloatingMenu(x, y, items, network.name);
  }
  let floatingMenu = null;
  function closeFloatingMenu() {
    if (!floatingMenu) return;
    floatingMenu.remove();
    floatingMenu = null;
  }
  function showFloatingMenu(x, y, items, title = "") {
    closeFloatingMenu();
    const box = div("ctxmenu");
    box.setAttribute("role", "menu");
    if (title) box.appendChild(div("ctxmenu-title", title));
    for (const item of items) {
      if (item.sep) {
        box.appendChild(div("menu-sep"));
        continue;
      }
      const entry = el("button", "menu-item");
      entry.type = "button";
      entry.disabled = Boolean(item.disabled);
      entry.appendChild(el("strong", null, item.label));
      if (item.hint) entry.appendChild(el("small", null, item.hint));
      entry.addEventListener("click", () => {
        closeFloatingMenu();
        if (!item.disabled) item.action();
      });
      box.appendChild(entry);
    }
    document.body.appendChild(box);
    const rect = box.getBoundingClientRect();
    box.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 8))}px`;
    box.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 8))}px`;
    floatingMenu = box;
    return box;
  }
  function initFloatingMenu() {
    document.addEventListener("pointerdown", (event) => {
      if (!floatingMenu) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(".ctxmenu")) closeFloatingMenu();
    }, true);
    window.addEventListener("blur", () => closeFloatingMenu());
    window.addEventListener("resize", () => closeFloatingMenu());
  }
  async function switchNetwork(networkId) {
    if (!networkId || networkId === state.currentNetwork?.id) return;
    const response = await task(
      () => jsonRequest(`/api/networks/${encodeURIComponent(networkId)}/activate`, "POST", {})
    );
    if (!response || !response.scene) return;
    state.selection = { type: null, id: null };
    state.inspectorId = null;
    state.inspectorDirty = false;
    state.frames = [];
    state.values.clear();
    state.nodeValues.clear();
    state.edgeValues.clear();
    applySnapshot({ scene: response.scene, sim: response.sim, limits: state.limits });
    state.cursor = Number(response.sim?.cursor || 0);
    await fetchNetworks();
    renderScenePanel();
    renderInspector();
    fitView();
    toast(`\u5DF2\u5207\u6362\u5230\u7F51\u7EDC\uFF1A${state.currentNetwork?.name || networkId}`, "ok", 2200);
  }
  async function addNetwork() {
    const choice = await newNetworkModal(state.mode);
    if (!choice) return;
    const payload = { mode: choice.mode };
    if (choice.name) payload.name = choice.name;
    const response = await task(() => jsonRequest("/api/networks", "POST", payload));
    if (!response) return;
    await fetchNetworks();
    const created = String(response.created || "");
    if (created) {
      await switchNetwork(created);
    }
    toast(`\u5DF2\u65B0\u5EFA\u7F51\u7EDC\uFF08${modeLabel(choice.mode)}\u6A21\u5F0F\uFF09`, "ok", 2600);
  }
  async function renameNetwork(networkId = state.currentNetwork?.id) {
    if (!networkId) return;
    const item = (state.networks || []).find((network) => network.id === networkId);
    const proposed = window.prompt("\u7F51\u7EDC\u540D\u79F0\uFF08\u6700\u957F 60 \u5B57\uFF09", item?.name || "");
    if (proposed === null) return;
    const response = await task(
      () => jsonRequest(`/api/networks/${encodeURIComponent(networkId)}`, "PATCH", { name: proposed })
    );
    if (!response) return;
    await fetchNetworks();
    toast(`\u7F51\u7EDC\u5DF2\u6539\u540D\uFF1A${response.name}`, "ok", 2200);
  }
  async function deleteNetwork() {
    const network = state.currentNetwork;
    if (!network) return;
    if ((state.networks || []).length <= 1) {
      toast("\u5DE5\u7A0B\u81F3\u5C11\u9700\u8981\u4FDD\u7559\u4E00\u4E2A\u7F51\u7EDC", "error", 3200);
      return;
    }
    const confirmed = await confirmModal(
      `\u5220\u9664\u7F51\u7EDC\u300C${network.name}\u300D\uFF1F`,
      "\u8BE5\u7F51\u7EDC\u7684\u8282\u70B9\u4E0E\u8FDE\u63A5\u4F1A\u4E00\u5E76\u5220\u9664\uFF1B\u5DE5\u7A0B\u6B63\u672C\u4ECD\u53EF\u7528\u300C\u4FDD\u5B58\u5DE5\u7A0B\u300D\u8986\u76D6\u3002",
      "\u5220\u9664",
      true
    );
    if (!confirmed) return;
    const response = await task(
      () => jsonRequest(`/api/networks/${encodeURIComponent(network.id)}`, "DELETE")
    );
    if (!response) return;
    await fetchNetworks();
    const snapshot = await api("/api/state");
    applySnapshot(snapshot);
    toast("\u7F51\u7EDC\u5DF2\u5220\u9664", "ok", 2200);
  }
  function syncChromeEdges() {
    if (!ui.main) return;
    if (ui.networks && !ui.main.classList.contains("net-hidden")) {
      const netWidth = Math.round(ui.networks.getBoundingClientRect().width);
      if (netWidth > 0) ui.main.style.setProperty("--net-edge", `${netWidth}px`);
    }
    if (ui.panel && !ui.main.classList.contains("panel-hidden")) {
      const panelWidth = Math.round(ui.panel.getBoundingClientRect().width);
      if (panelWidth > 0) ui.main.style.setProperty("--panel-edge", `${panelWidth}px`);
    }
  }
  function applyNetCollapsed(collapsed) {
    ui.main.classList.toggle("net-hidden", collapsed);
    if (ui.netHanger) {
      ui.netHanger.textContent = collapsed ? "\u203A" : "\u2039";
      ui.netHanger.title = collapsed ? "\u5C55\u5F00\u7F51\u7EDC\u680F" : "\u6536\u8D77\u7F51\u7EDC\u680F";
      ui.netHanger.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
    try {
      localStorage.setItem(SHELL_KEYS.netCollapsed, collapsed ? "1" : "0");
    } catch (error) {
    }
    setTimeout(() => {
      syncChromeEdges();
      resizeGraph();
      resizeChart();
      schedulePhaseDraw();
    }, 60);
  }
  function toggleNetworks() {
    applyNetCollapsed(!ui.main.classList.contains("net-hidden"));
  }
  function initNetworkSidebar() {
    if (!ui.networkList) return;
    let width = 0;
    let collapsed = false;
    try {
      width = Number(localStorage.getItem(SHELL_KEYS.netWidth)) || 0;
      collapsed = localStorage.getItem(SHELL_KEYS.netCollapsed) === "1";
    } catch (error) {
      width = 0;
    }
    if (width >= 140 && width <= 360) {
      ui.main.style.setProperty("--net-w", `${Math.round(width)}px`);
    }
    applyNetCollapsed(collapsed);
    ui.netHanger?.addEventListener("click", toggleNetworks);
    ui.netAdd?.addEventListener("click", () => void addNetwork());
    ui.netRename?.addEventListener("click", () => void renameNetwork());
    ui.netDelete?.addEventListener("click", () => void deleteNetwork());
    const handle = ui.netResize;
    if (!handle) return;
    let dragging = false;
    let startX = 0;
    let startWidth = 0;
    const currentWidth = () => {
      const rect = ui.networks?.getBoundingClientRect();
      if (rect && rect.width > 0) return rect.width;
      const value = parseFloat(getComputedStyle(ui.main).getPropertyValue("--net-w"));
      return Number.isFinite(value) ? value : 172;
    };
    handle.addEventListener("pointerdown", (event) => {
      dragging = true;
      startX = event.clientX;
      startWidth = currentWidth();
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add("net-dragging");
      event.preventDefault();
    });
    handle.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const next = clamp(Math.round(startWidth + event.clientX - startX), 140, 360);
      ui.main.style.setProperty("--net-w", `${next}px`);
      ui.main.style.setProperty("--net-edge", `${next}px`);
    });
    const finish = (event) => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("net-dragging");
      try {
        localStorage.setItem(SHELL_KEYS.netWidth, String(Math.round(currentWidth())));
      } catch (error) {
      }
      syncChromeEdges();
      resizeGraph();
      resizeChart();
      schedulePhaseDraw();
      if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }
  async function snapSceneToGrid() {
    const grid = Number(state.ui.grid) || 20;
    const snapValue = (value) => Math.round(value / grid) * grid;
    const nodes = (state.scene?.nodes || []).filter((node) => {
      const x = Number(node.position?.x || 0);
      const y = Number(node.position?.y || 0);
      return snapValue(x) !== Math.round(x) || snapValue(y) !== Math.round(y);
    });
    const edges = (state.scene?.edges || []).filter(
      (edge) => (edge.waypoints || []).some((point) => snapValue(point.x) !== Math.round(point.x) || snapValue(point.y) !== Math.round(point.y))
    );
    if (!nodes.length && !edges.length) {
      toast("\u6240\u6709\u8282\u70B9\u4E0E\u62D0\u70B9\u5DF2\u5728\u7F51\u683C\u4E0A", "info", 2200);
      return;
    }
    await pushUndoSnapshot();
    for (const node of nodes) {
      const position = { x: snapValue(Number(node.position.x) || 0), y: snapValue(Number(node.position.y) || 0) };
      await task(() => jsonRequest(`/api/nodes/${encodeURIComponent(node.id)}`, "PATCH", { position }), { history: false });
    }
    for (const edge of edges) {
      const waypoints = (edge.waypoints || []).map((point) => ({ x: snapValue(point.x), y: snapValue(point.y) }));
      await task(() => jsonRequest(`/api/edges/${encodeURIComponent(edge.id)}`, "PATCH", { waypoints }), { history: false });
    }
    await refreshState(true);
    toast(`\u5DF2\u6574\u7406 ${nodes.length} \u4E2A\u8282\u70B9\u3001${edges.length} \u6761\u8FDE\u7EBF\u5230 ${grid} \u7F51\u683C`, "ok", 2600);
  }
  function toggleSnap() {
    state.ui.snap = !state.ui.snap;
    toast(`\u7F51\u683C\u5438\u9644\u5DF2${state.ui.snap ? "\u5F00\u542F" : "\u5173\u95ED"}\uFF08Alt \u4E34\u65F6\u6682\u505C\uFF09`, "info", 2400);
    markProjectDirty();
  }
  function toggleSymbol() {
    state.ui.symbol = state.ui.symbol === "gb" ? "classic" : "gb";
    requestDraw();
    markProjectDirty();
    toast(`\u7B26\u53F7\u98CE\u683C\uFF1A${state.ui.symbol === "gb" ? "GB \u77E9\u5F62" : "\u7ECF\u5178\u5706\u5F62"}\uFF08\u4EC5\u672C\u5DE5\u7A0B\uFF09`, "info", 2600);
  }
  function applyProjectUi(uiSettings) {
    if (!uiSettings || typeof uiSettings !== "object") return;
    if (uiSettings.grid && typeof uiSettings.grid === "object") {
      if (typeof uiSettings.grid.snap === "boolean") state.ui.snap = uiSettings.grid.snap;
      if (typeof uiSettings.grid.show === "boolean") state.ui.showGrid = uiSettings.grid.show;
      if (typeof uiSettings.grid.markers === "boolean") state.ui.snapMarkers = uiSettings.grid.markers;
      if (typeof uiSettings.grid.orthogonal === "boolean") state.ui.circuitOrthogonal = uiSettings.grid.orthogonal;
      const size = Number(uiSettings.grid.size);
      if (Number.isFinite(size) && size >= 5 && size <= 80) state.ui.grid = size;
    }
    if (uiSettings.symbol === "gb" || uiSettings.symbol === "classic") {
      state.ui.symbol = uiSettings.symbol;
    }
    if (["circle", "dot", "box"].includes(uiSettings.nodeStyle)) state.ui.nodeStyle = uiSettings.nodeStyle;
    if (typeof uiSettings.drawingMode === "boolean") state.ui.drawingMode = uiSettings.drawingMode;
    if (typeof uiSettings.drawingSheet === "string" && SHEET_SIZES[uiSettings.drawingSheet]) state.ui.drawingSheet = uiSettings.drawingSheet;
    if (typeof uiSettings.drawingLabels === "boolean") state.ui.drawingLabels = uiSettings.drawingLabels;
    if (Number.isFinite(Number(uiSettings.drawingPage))) state.ui.drawingPage = Math.max(1, Math.min(9, Number(uiSettings.drawingPage)));
    if (typeof uiSettings.cardDetail === "boolean") state.ui.cardDetail = uiSettings.cardDetail;
    if (typeof uiSettings.cardValue === "boolean") state.ui.cardValue = uiSettings.cardValue;
    if (Number.isFinite(Number(uiSettings.symbolScale))) state.ui.symbolScale = clamp(Number(uiSettings.symbolScale), 0.6, 2.5);
    if (typeof uiSettings.glyphColor === "string") state.ui.glyphColor = uiSettings.glyphColor;
    requestDraw();
  }
  function blockBadges(spec) {
    const badges = [
      spec.mode,
      spec.model || "behavioral",
      `v${spec.version}`,
      `${spec.node_count} \u8282\u70B9`,
      `${(spec.inputs || []).length} \u5165 / ${(spec.outputs || []).length} \u51FA`
    ];
    if (spec.builtin) badges.unshift("\u5185\u7F6E");
    return badges;
  }
  async function refreshBlocks() {
    const response = await task(() => jsonRequest("/api/blocks", "GET"), { dirty: false });
    if (!response) return;
    state.blocks = response.blocks || [];
    state.blocksLibrary = response.library || "";
    renderBlocksPanel();
  }
  async function instantiateBlockFromLibrary(blockId) {
    const place = centerPlacement();
    const response = await task(
      () => jsonRequest("/api/blocks/instantiate", "POST", {
        block_id: blockId,
        position: { x: Math.round(place.x), y: Math.round(place.y) }
      })
    );
    if (!response) return;
    applySnapshot(response);
    await refreshBlocks();
    if (response.instance?.block_node) {
      await selectEntity("node", response.instance.block_node, true);
      switchTab("inspect");
    }
    toast("\u6A21\u5757\u5DF2\u5B9E\u4F8B\u5316\u5230\u753B\u5E03", "ok", 2400);
  }
  async function encapsulateSelection() {
    const liveNodes = new Set((state.scene?.nodes || []).map((node) => node.id));
    const picked = [...multiSelection().nodes];
    const nodes = picked.filter((id) => liveNodes.has(id));
    if (picked.length && !nodes.length) {
      await refreshState(false);
      toast("\u753B\u5E03\u5DF2\u8FC7\u671F\uFF08\u8282\u70B9\u5DF2\u4E0D\u5728\u5F53\u524D\u573A\u666F\uFF09\uFF0C\u5DF2\u5237\u65B0\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u8981\u5C01\u88C5\u7684\u8282\u70B9", "error", 5200);
      return;
    }
    if (!nodes.length) {
      toast("\u5148\u5728\u753B\u5E03\u4E0A\u9009\u4E2D\u8981\u5C01\u88C5\u7684\u8282\u70B9\uFF08Ctrl+\u5355\u51FB\u591A\u9009\uFF09", "info", 3200);
      return;
    }
    const proposed = window.prompt("\u6A21\u5757\u540D\u79F0\uFF08\u6700\u957F 32 \u5B57\uFF09", "\u6A21\u5757");
    if (proposed === null) return;
    let response = null;
    try {
      response = await jsonRequest("/api/blocks/encapsulate", "POST", {
        node_ids: nodes,
        name: proposed,
        model: state.blocksStructural ? "structural" : "behavioral"
      });
    } catch (error) {
      await refreshState(false);
      toast(`\u5C01\u88C5\u5931\u8D25\uFF1A${error.message || error}`, "error", 6e3);
      return;
    }
    if (!response) return;
    applySnapshot({ scene: response.scene, sim: response.sim, limits: state.limits });
    state.multi.nodes.clear();
    state.multi.edges.clear();
    clearSelection();
    await refreshBlocks();
    toast(`\u5DF2\u5C01\u88C5\u4E3A\u6A21\u5757\u300C${response.block.name}\u300D\u5E76\u5199\u5165\u5E93`, "ok", 3e3);
  }
  async function retryDegradedProject() {
    const response = await task(() => jsonRequest("/api/project/retry", "POST", {}));
    if (!response) return;
    applySnapshot({ scene: response.scene, sim: response.sim, limits: state.limits });
    if (response.degraded) {
      toast("\u5E93\u6587\u4EF6\u4ECD\u7F3A\u5931\uFF0C\u5DF2\u4FDD\u6301\u964D\u7EA7\u53EA\u8BFB", "error", 3200);
    } else {
      toast("\u5DF2\u89E3\u9664\u964D\u7EA7\u53EA\u8BFB\uFF0C\u53EF\u4EE5\u8FD0\u884C", "ok", 2800);
    }
    await refreshBlocks();
  }
  async function closeInternalNetwork() {
    const network = state.currentNetwork;
    if (!network || !String(network.name || "").startsWith("\u6A21\u5757 ")) {
      toast("\u5F53\u524D\u7F51\u7EDC\u4E0D\u662F\u6A21\u5757\u5185\u90E8\u4E34\u65F6\u7F51\u7EDC", "info", 2600);
      return;
    }
    await deleteNetwork();
    await refreshBlocks();
  }
  function initBlockDragDrop() {
    const graph = ui.graph;
    if (!graph) return;
    graph.addEventListener("dragover", (event) => {
      if (!event.dataTransfer || !event.dataTransfer.types.includes("text/netlab-block")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    });
    graph.addEventListener("drop", async (event) => {
      const blockId = event.dataTransfer?.getData("text/netlab-block");
      if (!blockId) return;
      event.preventDefault();
      const rect = graph.getBoundingClientRect();
      const world = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
      const response = await task(
        () => jsonRequest("/api/blocks/instantiate", "POST", {
          block_id: blockId,
          position: { x: Math.round(world.x), y: Math.round(world.y) }
        })
      );
      if (!response) return;
      applySnapshot(response);
      if (response.instance?.block_node) {
        await selectEntity("node", response.instance.block_node, true);
      }
      toast("\u6A21\u5757\u5DF2\u62D6\u5165\u753B\u5E03\u5E76\u5B9E\u4F8B\u5316", "ok", 2400);
    });
  }
  async function openBlockInternal(blockId) {
    const response = await task(
      () => jsonRequest(`/api/blocks/${encodeURIComponent(blockId)}/open-internal`, "POST", {})
    );
    if (!response) return false;
    applySnapshot({ scene: response.scene, sim: response.sim, limits: state.limits });
    await fetchNetworks();
    fitView();
    toast("\u5DF2\u5728\u4E34\u65F6\u7F51\u7EDC\u4E2D\u6253\u5F00\u6A21\u5757\u5185\u90E8", "ok", 3e3);
    return true;
  }
  const MODULE_DIR_GLYPH = { input: "\u2192", output: "\u2190", inout: "\u2194" };
  const MODULE_DIR_LABEL = { input: "\u8F93\u5165", output: "\u8F93\u51FA", inout: "\u53CC\u5411" };
  const PORT_DIRECTION_CHOICES = [
    ["input", "\u8F93\u5165", "\u5F15\u811A\u753B\u5728\u6A21\u5757\u5DE6\u4FA7\uFF0C\u8868\u793A\u4ECE\u5916\u90E8\u6D41\u8FDB\u6765"],
    ["output", "\u8F93\u51FA", "\u5F15\u811A\u753B\u5728\u6A21\u5757\u53F3\u4FA7\uFF0C\u8868\u793A\u5411\u5916\u6D41\u51FA"],
    ["inout", "\u53CC\u5411", "\u7535\u6C14\u7F51\u7EDC\u9ED8\u8BA4\uFF0C\u4E24\u4FA7\u90FD\u53EF\u63A5\u7EBF\uFF0C\u4E5F\u53EF\u5F53\u6D4B\u8BD5\u70B9"]
  ];
  function describeBlockPorts(spec) {
    const ports = Array.isArray(spec?.ports) ? spec.ports : [];
    if (String(spec?.mode || "") === "circuit" && ports.length) {
      const grouped = { input: [], output: [], inout: [] };
      for (const port of ports) {
        const bucket = grouped[port.direction] || grouped.inout;
        bucket.push(port.name);
      }
      const parts = [];
      for (const key of ["input", "output", "inout"]) {
        if (grouped[key].length) parts.push(`${MODULE_DIR_LABEL[key]} ${grouped[key].join("/")}`);
      }
      return parts.join("   ") || "\u65E0\u7AEF\u53E3";
    }
    const inputs = (spec?.inputs || []).map((port) => port.name).join(", ") || "\u2014";
    const outputs = (spec?.outputs || []).map((port) => port.name).join(", ") || "\u2014";
    return `${inputs} \u2192 ${outputs}`;
  }
  function modulePortList(block) {
    return (block?.ports || []).map((port) => ({
      name: String(port.name || "port"),
      direction: String(port.direction || (port.dtype === "electrical" ? "inout" : "input")),
      dtype: String(port.dtype || ""),
      net: String(port.net || "")
    }));
  }
  function renderModuleSide(block) {
    const side = ui.modulePorts;
    if (side) {
      side.replaceChildren();
      const ports = modulePortList(block);
      side.appendChild(el("h4", null, `\u7AEF\u53E3\uFF08${ports.length}\uFF09`));
      if (!ports.length) side.appendChild(div("help", "\u8FD9\u4E2A\u6A21\u5757\u6CA1\u6709\u7AEF\u53E3\u3002"));
      for (const port of ports) {
        const row = div("port-row");
        row.appendChild(el("span", "port-dir", MODULE_DIR_GLYPH[port.direction] || "\xB7"));
        const name = el("span", "port-name", port.name);
        name.title = `${port.name} \xB7 ${port.direction}${port.net ? ` \xB7 ${port.net}` : ""}`;
        row.appendChild(name);
        row.appendChild(el("span", "badge gray", port.dtype === "electrical" ? "\u7535\u6C14" : "\u4FE1\u53F7"));
        side.appendChild(row);
      }
    }
    const meta = ui.moduleMeta;
    if (meta) {
      meta.replaceChildren();
      const rows = [
        ["\u8282\u70B9", String((block?.nodes || []).length)],
        ["\u8FDE\u7EBF", String((block?.edges || []).length)],
        ["\u7AEF\u53E3", String((block?.ports || []).length)],
        ["\u7248\u672C", `v${Number(block?.version || 1)}`],
        ["\u6A21\u578B", block?.model === "structural" ? "\u7ED3\u6784" : "\u884C\u4E3A"]
      ];
      for (const [key, value] of rows) {
        meta.appendChild(el("span", null, key));
        meta.appendChild(el("b", null, value));
      }
    }
  }
  function drawModulePreview() {
    const canvas2 = ui.moduleCanvas;
    const block = state.moduleBlock;
    const stage2 = ui.moduleStage;
    if (!canvas2 || !stage2 || !block) return;
    const ctx2 = canvas2.getContext("2d");
    if (!ctx2) return;
    const box = stage2.getBoundingClientRect();
    const width = Math.round(box.width);
    const height = Math.round(box.height);
    if (width < 20 || height < 20) return;
    const dpr = window.devicePixelRatio || 1;
    canvas2.width = Math.round(width * dpr);
    canvas2.height = Math.round(height * dpr);
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2.clearRect(0, 0, width, height);
    ctx2.fillStyle = C("#faf8f2");
    ctx2.fillRect(0, 0, width, height);
    const nodes = (block.nodes || []).map((node) => ({
      id: String(node.id || ""),
      label: String(node.params?.port_name || node.name || node.label || node.kind || node.id || "?"),
      kind: String(node.kind || ""),
      x: Number(node.position?.x ?? node.x ?? 0),
      y: Number(node.position?.y ?? node.y ?? 0)
    }));
    const isEmpty = !nodes.length;
    if (ui.moduleEmpty) ui.moduleEmpty.hidden = !isEmpty;
    canvas2.hidden = isEmpty;
    if (isEmpty) return;
    const portNets = new Set(modulePortList(block).map((port) => port.net).filter(Boolean));
    const xs = nodes.map((node) => node.x);
    const ys = nodes.map((node) => node.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = 34;
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY, 1.15);
    const offsetX = (width - spanX * scale) / 2 - minX * scale;
    const offsetY = (height - spanY * scale) / 2 - minY * scale;
    const project = (node) => ({ x: node.x * scale + offsetX, y: node.y * scale + offsetY });
    const byId = new Map(nodes.map((node) => [node.id, node]));
    ctx2.strokeStyle = C("#ded7c8");
    ctx2.lineWidth = 1;
    for (const edge of block.edges || []) {
      const source = byId.get(String(edge.source || ""));
      const target = byId.get(String(edge.target || ""));
      if (!source || !target) continue;
      const a = project(source);
      const b = project(target);
      ctx2.beginPath();
      ctx2.moveTo(a.x, a.y);
      ctx2.lineTo(b.x, b.y);
      ctx2.stroke();
    }
    ctx2.font = '10px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx2.textAlign = "center";
    ctx2.textBaseline = "middle";
    for (const node of nodes) {
      const point = project(node);
      const isPort = portNets.has(node.id);
      const isGround = node.kind === "ground";
      const isDevice = node.kind === "device";
      const text = node.label.length > 12 ? `${node.label.slice(0, 11)}\u2026` : node.label;
      const w = Math.max(54, Math.round(ctx2.measureText(text).width) + 18);
      const h = 22;
      const fill = isPort ? tokens().modPortFill : isGround ? tokens().modGroundFill : isDevice ? tokens().modDeviceFill : tokens().modFill;
      const stroke = isPort ? tokens().modPortStroke : isGround ? tokens().modGroundStroke : isDevice ? tokens().modDeviceStroke : tokens().modStroke;
      const ink = isPort ? tokens().modPortInk : isGround ? tokens().modGroundInk : isDevice ? tokens().modDeviceInk : tokens().modInk;
      ctx2.beginPath();
      ctx2.rect(point.x - w / 2, point.y - h / 2, w, h);
      ctx2.fillStyle = fill;
      ctx2.fill();
      ctx2.strokeStyle = stroke;
      ctx2.lineWidth = isPort ? 1.6 : 1;
      ctx2.stroke();
      ctx2.fillStyle = ink;
      ctx2.fillText(text, point.x, point.y);
    }
    ctx2.textAlign = "left";
    ctx2.fillStyle = C("#969083");
    ctx2.font = '9.5px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx2.fillText(`\u53EA\u8BFB\u9884\u89C8 \xB7 ${block.name || block.id} \xB7 ${nodes.length} \u8282\u70B9 / ${(block.edges || []).length} \u8FDE\u7EBF`, 12, height - 12);
  }
  function layoutModuleWindow() {
    if (!ui.moduleWin) return;
    ui.moduleWin.classList.toggle("docked", Boolean(state.moduleDock));
    if (ui.moduleDock) ui.moduleDock.classList.toggle("on", Boolean(state.moduleDock));
  }
  function openModuleInternal(blockId, block) {
    const run = async () => {
      let target = block;
      if (!target) {
        const response = await task(
          () => jsonRequest(`/api/blocks/${encodeURIComponent(blockId)}`, "GET"),
          { dirty: false }
        );
        if (!response?.block) return;
        target = response.block;
      }
      state.moduleBlock = target;
      if (ui.moduleWinTitle) ui.moduleWinTitle.textContent = target.name || target.id || "\u6A21\u5757\u5185\u90E8";
      if (ui.moduleWinHint) {
        const suffix = target.builtin ? " \xB7 \u5185\u7F6E\u7ED3\u6784\u53EA\u8BFB\uFF0C\u53EF\u53E6\u5B58\u526F\u672C" : "";
        ui.moduleWinHint.textContent = `MODULE \xB7 ${(target.nodes || []).length} \u8282\u70B9 \xB7 v${Number(target.version || 1)}${suffix}`;
      }
      if (ui.moduleEdit) {
        ui.moduleEdit.textContent = target.builtin ? "\u5728\u4E34\u65F6\u7F51\u7EDC\u4E2D\u53E6\u5B58\u526F\u672C" : "\u5728\u4E34\u65F6\u7F51\u7EDC\u4E2D\u7F16\u8F91";
      }
      renderModuleSide(target);
      ui.moduleWin.hidden = false;
      layoutModuleWindow();
      if (!state.moduleDock) {
        placeFloatWindow(ui.moduleWin, "moduleGeo");
        raiseFloatWindow(ui.moduleWin);
      }
      requestAnimationFrame(() => drawModulePreview());
    };
    void run();
  }
  function closeModuleInternal() {
    if (!ui.moduleWin || ui.moduleWin.hidden) return;
    ui.moduleWin.hidden = true;
    toast("\u5DF2\u5173\u95ED\u6A21\u5757\u5185\u90E8\u89C6\u56FE", "info", 1800);
  }
  function toggleModuleDock() {
    if (!ui.moduleWin) return;
    state.moduleDock = !state.moduleDock;
    layoutModuleWindow();
    if (state.moduleDock) {
      ui.moduleWin.hidden = false;
      ui.moduleWin.classList.remove("moved");
      ui.moduleWin.style.left = "";
      ui.moduleWin.style.top = "";
      ui.moduleWin.style.width = "";
      ui.moduleWin.style.height = "";
      requestAnimationFrame(() => drawModulePreview());
    } else {
      placeFloatWindow(ui.moduleWin, "moduleGeo");
      raiseFloatWindow(ui.moduleWin);
      requestAnimationFrame(() => drawModulePreview());
    }
  }
  function initModuleWindow() {
    if (!ui.moduleWin) return;
    initFloatWindow(ui.moduleWin, "moduleGeo", { minWidth: 520, minHeight: 340 });
    ui.moduleWinClose?.addEventListener("click", () => closeModuleInternal());
    ui.moduleDock?.addEventListener("click", () => toggleModuleDock());
    ui.moduleEdit?.addEventListener("click", () => {
      const block = state.moduleBlock;
      if (!block?.id) return;
      void openBlockInternal(block.id).then((ok) => {
        if (ok) closeModuleInternal();
      });
    });
    ui.moduleAddInstance?.addEventListener("click", () => {
      const block = state.moduleBlock;
      if (!block?.id) return;
      void instantiateBlockFromLibrary(block.id);
    });
    if (ui.moduleStage && typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(() => {
        if (!ui.moduleWin?.hidden) drawModulePreview();
      });
      observer.observe(ui.moduleStage);
    }
  }
  async function saveCurrentAsBlockCopy() {
    const proposed = window.prompt("\u526F\u672C\u6A21\u5757\u540D\u79F0\uFF08\u65B0 id\uFF0Cv1\uFF09", `${state.currentNetwork?.name || "\u6A21\u5757"}-copy`);
    if (proposed === null) return;
    const response = await task(
      () => jsonRequest("/api/blocks/save-copy", "POST", { name: proposed })
    );
    if (!response) return;
    await refreshBlocks();
    await fetchNetworks();
    toast(`\u5DF2\u53E6\u5B58\u4E3A\u6A21\u5757\u526F\u672C\u300C${response.block.name}\u300D\uFF08id=${response.block.id}\uFF09`, "ok", 3400);
  }
  async function importBlockFile() {
    const input = el("input");
    input.type = "file";
    input.accept = ".block,application/json";
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const payload = JSON.parse(text);
        const report = await task(
          () => jsonRequest("/api/blocks/validate", "POST", { payload }),
          { dirty: false }
        );
        if (!report) return;
        if (!report.ok) {
          const lines = (report.blocking || []).map((item) => `\xB7 [${item.code}] ${item.message}`);
          showBanner(`\u6A21\u5757\u6821\u9A8C\u672A\u901A\u8FC7\uFF1A${lines.join("\uFF1B")}`);
          toast("\u6A21\u5757\u6821\u9A8C\u672A\u901A\u8FC7\uFF0C\u5DF2\u963B\u6B62\u5BFC\u5165\uFF08\u62A5\u544A\u89C1\u9876\u90E8\u6A2A\u5E45\uFF09", "error", 6e3);
          return;
        }
        if ((report.warnings || []).length) {
          const body = div("help");
          body.textContent = (report.warnings || []).map((item) => `\xB7 [${item.code}] ${item.message}`).join("\uFF1B");
          const proceed = await confirmModal(
            `\u6A21\u5757\u6709 ${report.warnings.length} \u6761\u8B66\u544A`,
            body,
            "\u4ECD\u7136\u5BFC\u5165",
            false
          );
          if (!proceed) return;
        }
        const response = await task(
          () => jsonRequest("/api/blocks/import", "POST", { payload })
        );
        if (!response) return;
        await refreshBlocks();
        toast(`\u5DF2\u5BFC\u5165\u6A21\u5757 v${response.version}\uFF08\u5E72\u8DD1 ${report.summary?.dry_run || "skipped"}\uFF09`, "ok", 3e3);
      } catch (error) {
        toast(`\u5BFC\u5165\u5931\u8D25\uFF1A${error.message}`, "error", 5e3);
      }
    });
    input.click();
  }
  const WB_INTEGRATIONS = [
    { value: "trapezoidal", label: "\u68AF\u5F62\u6CD5" },
    { value: "backward_euler", label: "\u540E\u5411\u6B27\u62C9" },
    { value: "gear2", label: "Gear2" }
  ];
  const WB_SIM_FIELDS = [
    { key: "dt", label: "\u6B65\u957F dt", type: "float", unit: "s" },
    { key: "fps", label: "\u76EE\u6807 FPS", type: "int" },
    { key: "steps_per_frame", label: "\u6BCF\u5E27\u6B65\u6570", type: "int" },
    { key: "sample_every", label: "\u91C7\u6837\u95F4\u9694", type: "int" },
    { key: "reltol", label: "\u76F8\u5BF9\u5BB9\u5DEE reltol", type: "float" },
    { key: "vntol", label: "\u7535\u538B\u5BB9\u5DEE vntol", type: "float", unit: "V" },
    { key: "abstol", label: "\u7535\u6D41\u5BB9\u5DEE abstol", type: "float", unit: "A" },
    { key: "max_iter", label: "\u6700\u5927\u8FED\u4EE3 max_iter", type: "int" },
    { key: "gmin_steps", label: "gmin \u6B65\u6570", type: "int" },
    { key: "src_steps", label: "\u6E90\u6B65\u6570", type: "int" },
    { key: "residual_tol", label: "\u6B8B\u5DEE\u5BB9\u5DEE", type: "float" }
  ];
  let wbStatesPayload = null;
  let wbSelectedId = "";
  let wbDirty = false;
  let wbFilterText = "";
  let wbCacheStatus = null;
  let wbCompareStateIds = [];
  let wbCompareSignals = [];
  let wbCompareLayout = { cols: 0, height: 220 };
  let wbComparePayload = null;
  let wbCompareRenderer = "simple-chart";
  let wbActiveRenderers = [];
  function wbBadge(text, cls) {
    return el("span", cls, text);
  }
  function wbMarkDirty() {
    wbDirty = true;
    const badge = $("#wbDirtyBadge");
    if (badge) {
      badge.textContent = "\u672A\u4FDD\u5B58\u5230\u72B6\u6001";
      badge.className = "badge violet";
    }
    markProjectDirty();
  }
  function renderWorkbenchAnalysis() {
    const pane = $("#tab-wb-analysis");
    if (!pane) return;
    const host = div("blocks-host wb-analysis");
    const head = div("insp-head");
    const title = div("insp-title");
    title.append(
      el("h2", null, "\u5DE5\u4F5C\u53F0 \xB7 \u5206\u6790"),
      el("p", null, "\u591A\u72B6\u6001\u7ED3\u679C\u5BF9\u6BD4\uFF1A\u6BCF\u4E2A\u72B6\u6001\u4E00\u5B50\u56FE\uFF0C\u5171\u4EAB\u540C\u4E00\u4FE1\u53F7\u7EC4\uFF0Cx \u8F74\u5BF9\u9F50\u3002")
    );
    head.appendChild(title);
    host.appendChild(head);
    const toolbar = div("blocks-toolbar");
    toolbar.append(
      button("\u9884\u8BA1\u7B97\u9009\u4E2D\u72B6\u6001", "btn tiny", () => void wbPrecomputeSelected()),
      button("\u7EDF\u4E00\u4EFF\u771F\u8BBE\u7F6E", "btn tiny", () => void wbUnifySim()),
      button("\u751F\u6210\u5BF9\u6BD4\u56FE", "btn tiny primary", () => void wbGenerateCompare()),
      button("\u4FE1\u53F7\u7A97 \u6D6E\u51FA/\u505C\u9760", "btn tiny", () => setWbSignalDock(!state.wbSignalDock))
    );
    host.appendChild(toolbar);
    const layoutRow = div("field-row wb-layout-row");
    const colsInput = el("input", "input");
    colsInput.type = "number";
    colsInput.min = "0";
    colsInput.max = "6";
    colsInput.value = String(wbCompareLayout.cols);
    colsInput.title = "\u6BCF\u884C\u5217\u6570\uFF080 = \u81EA\u52A8\uFF09";
    const heightInput = el("input", "input");
    heightInput.type = "number";
    heightInput.min = "120";
    heightInput.max = "600";
    heightInput.step = "20";
    heightInput.value = String(wbCompareLayout.height);
    heightInput.title = "\u5355\u4E2A\u5B50\u56FE\u9AD8\u5EA6\uFF08px\uFF09";
    colsInput.addEventListener("change", () => {
      wbCompareLayout.cols = Math.max(0, Math.min(6, Number(colsInput.value) || 0));
      if (wbComparePayload) renderCompareGrid();
    });
    heightInput.addEventListener("change", () => {
      wbCompareLayout.height = Math.max(120, Math.min(600, Number(heightInput.value) || 220));
      if (wbComparePayload) renderCompareGrid();
    });
    const rendererSelect = el("select", "input");
    rendererSelect.title = "\u5BF9\u6BD4\u5B50\u56FE\u7ED8\u5236\u5668\uFF08\u7B80\u6613 canvas / PlotKit \u5185\u5D4C\uFF09";
    const rendererChoices = [
      ["simple-chart", "\u7B80\u6613 canvas"],
      ["plotkit", "PlotKit \u5185\u5D4C"]
    ];
    for (const [value, label] of rendererChoices) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      rendererSelect.appendChild(option);
    }
    rendererSelect.value = wbCompareRenderer;
    rendererSelect.addEventListener("change", () => {
      wbCompareRenderer = rendererSelect.value === "plotkit" ? "plotkit" : "simple-chart";
      if (wbComparePayload) renderCompareGrid();
    });
    layoutRow.append(
      el("label", null, "\u5217\u6570"),
      colsInput,
      el("label", null, "\u5B50\u56FE\u9AD8\u5EA6(px)"),
      heightInput,
      el("label", null, "\u7ED8\u5236\u5668"),
      rendererSelect
    );
    host.appendChild(layoutRow);
    const inline = el("div", "wb-signal-inline");
    inline.id = "wbSignalInline";
    host.appendChild(inline);
    const grid = el("div", "wb-compare-grid");
    grid.id = "wbCompareGrid";
    host.appendChild(grid);
    const status = div("help wb-compare-status");
    status.id = "wbCompareStatus";
    status.textContent = "\u8BFB\u53D6\u7F13\u5B58\u4E2D\u2026";
    host.appendChild(status);
    pane.replaceChildren(host);
    void refreshWbAnalysis();
  }
  async function syncProjectContext() {
    const path = String(state.project?.path || "");
    try {
      await api("/api/project/context", {
        method: "POST",
        body: JSON.stringify({ path }),
        timeoutMs: 8e3
      });
    } catch {
    }
  }
  function wbToggleInArray(arr, value, on) {
    const index = arr.indexOf(value);
    if (on && index < 0) arr.push(value);
    else if (!on && index >= 0) arr.splice(index, 1);
  }
  function wbAvailableProbes() {
    const set = /* @__PURE__ */ new Set();
    const rows = wbCacheStatus?.states || [];
    const pick = rows.filter((row) => wbCompareStateIds.indexOf(String(row.state_id)) >= 0);
    const source = pick.length ? pick : rows;
    for (const row of source) for (const probe of row.probes || []) set.add(String(probe));
    if (!set.size) {
      const keys = state.sim?.probe_keys || [];
      for (const key of keys) set.add(String(key));
    }
    return Array.from(set);
  }
  function wbSimInconsistent() {
    const states = wbStatesPayload?.states || [];
    if (states.length < 2) return false;
    const signatures = states.map((item) => JSON.stringify(item.sim || {}));
    return signatures.some((sig) => sig !== signatures[0]);
  }
  async function refreshWbAnalysis() {
    await syncProjectContext();
    try {
      const sp = await jsonRequest("/api/network/states", "GET");
      if (sp) wbStatesPayload = sp;
    } catch {
    }
    try {
      const cache = await jsonRequest("/api/network/state/cache", "GET");
      if (cache) wbCacheStatus = cache;
    } catch (error) {
      toast(`\u8BFB\u53D6\u7F13\u5B58\u72B6\u6001\u5931\u8D25\uFF1A${error?.message || error}`, "error", 6e3);
    }
    const rows = wbCacheStatus?.states || [];
    const ids = rows.map((row) => String(row.state_id || "")).filter(Boolean);
    wbCompareStateIds = wbCompareStateIds.filter((id) => ids.indexOf(id) >= 0);
    if (wbCompareStateIds.length < 2) wbCompareStateIds = ids.slice(0, 2);
    const probes = wbAvailableProbes();
    wbCompareSignals = wbCompareSignals.filter((sig) => probes.indexOf(sig) >= 0);
    if (!wbCompareSignals.length) wbCompareSignals = probes.slice(0, 2);
    renderWbSignalPanel();
    setWbSignalDock(state.wbSignalDock);
    if (wbCompareStateIds.length >= 2 && wbCompareSignals.length) {
      await wbGenerateCompare();
    } else {
      const status = $("#wbCompareStatus");
      if (status) status.textContent = "\u8BF7\u9009\u62E9\u81F3\u5C11\u4E24\u4E2A\u72B6\u6001\u4E0E\u4E00\u7EC4\u5171\u4EAB\u4FE1\u53F7\uFF0C\u518D\u70B9\u300C\u751F\u6210\u5BF9\u6BD4\u56FE\u300D\u3002";
    }
  }
  function renderWbSignalPanel() {
    let panel = $("#wbSignalPanel");
    if (!panel) {
      panel = div("wb-signal-panel");
      panel.id = "wbSignalPanel";
    }
    panel.replaceChildren();
    const rows = wbCacheStatus?.states || [];
    const stateSection = div("wb-signal-section");
    stateSection.appendChild(div("wb-signal-title", "\u72B6\u6001\uFF08\u52FE\u9009 \u22652 \u4E2A\u53C2\u4E0E\u5BF9\u6BD4\uFF09"));
    const stateList = div("wb-signal-list");
    if (!rows.length) stateList.appendChild(div("help", "\u5C1A\u65E0\u72B6\u6001\u3002\u8BF7\u5230\u300C\u72B6\u6001\u300D\u9875\u65B0\u5EFA\u3002"));
    for (const row of rows) {
      const id = String(row.state_id || "");
      const label = el("label", "wb-check");
      const box = el("input", "");
      box.type = "checkbox";
      box.checked = wbCompareStateIds.indexOf(id) >= 0;
      box.addEventListener("change", () => wbToggleInArray(wbCompareStateIds, id, box.checked));
      const suffix = row.cached ? `\uFF08${row.frames || 0} \u5E27\uFF09` : "\uFF08\u672A\u9884\u8BA1\u7B97\uFF09";
      label.append(box, el("span", null, `${row.name || id}${suffix}`));
      stateList.appendChild(label);
    }
    stateSection.appendChild(stateList);
    if (wbSimInconsistent()) {
      stateSection.appendChild(
        div("help wb-warn", "\u5404\u72B6\u6001\u4EFF\u771F\u8BBE\u7F6E\u4E0D\u4E00\u81F4\uFF0C\u5BF9\u6BD4\u524D\u5EFA\u8BAE\u70B9\u300C\u7EDF\u4E00\u4EFF\u771F\u8BBE\u7F6E\u300D\u4EE5\u4FDD\u8BC1\u53EF\u6BD4\u3002")
      );
    }
    panel.appendChild(stateSection);
    const probes = wbAvailableProbes();
    const signalSection = div("wb-signal-section");
    signalSection.appendChild(div("wb-signal-title", "\u5171\u4EAB\u4FE1\u53F7\uFF08\u6240\u6709\u5B50\u56FE\u5171\u7528\u540C\u4E00\u7EC4\uFF09"));
    const signalList = div("wb-signal-list");
    if (!probes.length) {
      signalList.appendChild(div("help", "\u5C1A\u65E0\u53EF\u9009\u4FE1\u53F7\uFF1A\u8BF7\u5148\u9884\u8BA1\u7B97\u81F3\u5C11\u4E00\u4E2A\u72B6\u6001\u3002"));
    }
    for (const key of probes) {
      const label = el("label", "wb-check");
      const box = el("input", "");
      box.type = "checkbox";
      box.checked = wbCompareSignals.indexOf(key) >= 0;
      box.addEventListener("change", () => wbToggleInArray(wbCompareSignals, key, box.checked));
      const swatch = el("span", "wb-swatch");
      swatch.style.background = colorForKey(key);
      label.append(box, swatch, el("span", null, key));
      signalList.appendChild(label);
    }
    signalSection.appendChild(signalList);
    const applyRow = div("blocks-toolbar");
    applyRow.append(button("\u5E94\u7528\u5E76\u7ED8\u56FE", "btn tiny primary", () => void wbGenerateCompare()));
    signalSection.appendChild(applyRow);
    panel.appendChild(signalSection);
    if (state.wbSignalDock) {
      const inline = $("#wbSignalInline");
      if (inline) inline.appendChild(panel);
    } else {
      const body = $("#wbSignalBody");
      if (body) body.appendChild(panel);
    }
  }
  function setWbSignalDock(docked) {
    state.wbSignalDock = docked;
    const win = $("#wbSignalWin");
    const panel = $("#wbSignalPanel");
    const inline = $("#wbSignalInline");
    const body = $("#wbSignalBody");
    if (!win || !panel) return;
    if (docked) {
      win.hidden = true;
      if (inline) {
        inline.hidden = false;
        inline.appendChild(panel);
      }
    } else {
      if (inline) inline.hidden = true;
      if (body) body.appendChild(panel);
      if (!state.wbSignalGeo) {
        state.wbSignalGeo = {
          left: Math.max(40, window.innerWidth - 430),
          top: 120,
          width: 360,
          height: 460
        };
      }
      win.hidden = false;
      placeFloatWindow(win, "wbSignalGeo");
      raiseFloatWindow(win);
    }
  }
  async function wbGenerateCompare() {
    const statusEl = $("#wbCompareStatus");
    if (wbCompareStateIds.length < 2) {
      if (statusEl) statusEl.textContent = "\u5BF9\u6BD4\u5206\u6790\u81F3\u5C11\u9700\u8981\u9009\u62E9\u4E24\u4E2A\u72B6\u6001\u3002";
      return;
    }
    if (!wbCompareSignals.length) {
      if (statusEl) statusEl.textContent = "\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u4E2A\u5171\u4EAB\u4FE1\u53F7\u3002";
      return;
    }
    if (statusEl) statusEl.textContent = "\u8BFB\u53D6\u7F13\u5B58\u4E2D\u2026";
    let payload = null;
    try {
      payload = await api("/api/network/state/compare", {
        method: "POST",
        body: JSON.stringify({ state_ids: wbCompareStateIds, signals: wbCompareSignals }),
        timeoutMs: 12e4
      });
    } catch (error) {
      if (statusEl) statusEl.textContent = `\u5BF9\u6BD4\u8BFB\u53D6\u5931\u8D25\uFF1A${error?.message || error}`;
      return;
    }
    if (!payload) return;
    wbComparePayload = payload;
    renderCompareGrid();
    if (statusEl) {
      const entries = payload.states || [];
      const ok = entries.filter((entry) => entry.ok).length;
      const total = entries.length;
      statusEl.textContent = ok === total ? `\u5DF2\u751F\u6210 ${total} \u4E2A\u5B50\u56FE \xB7 \u5171\u4EAB\u4FE1\u53F7\uFF1A${(payload.signals || []).join("\u3001")}` : `\u90E8\u5206\u72B6\u6001\u65E0\u6709\u6548\u7F13\u5B58\uFF08${ok}/${total} \u53EF\u7ED8\uFF09\xB7 \u8BF7\u5BF9\u7F3A\u5931\u72B6\u6001\u5148\u300C\u9884\u8BA1\u7B97\u9009\u4E2D\u72B6\u6001\u300D\u3002`;
    }
  }
  function wbFmtAxis(value) {
    if (!Number.isFinite(value)) return "\u2014";
    const abs = Math.abs(value);
    if (abs !== 0 && (abs >= 1e4 || abs < 1e-3)) return value.toExponential(1);
    return String(Math.round(value * 1e3) / 1e3);
  }
  function renderCompareGrid() {
    const grid = $("#wbCompareGrid");
    if (!grid) return;
    const payload = wbComparePayload;
    const entries = (payload?.states || []).filter((entry) => entry.ok);
    const signals = payload?.signals && payload.signals.length ? payload.signals : wbCompareSignals.slice();
    for (const renderer of wbActiveRenderers) renderer.destroy();
    wbActiveRenderers = [];
    grid.replaceChildren();
    if (!entries.length) {
      grid.appendChild(div("help", "\u6CA1\u6709\u53EF\u7ED8\u5236\u7684\u7F13\u5B58\u3002\u8BF7\u5148\u5BF9\u9009\u4E2D\u72B6\u6001\u6267\u884C\u300C\u9884\u8BA1\u7B97\u9009\u4E2D\u72B6\u6001\u300D\u3002"));
      return;
    }
    const count = entries.length;
    const cols = wbCompareLayout.cols > 0 ? wbCompareLayout.cols : Math.min(count, Math.ceil(Math.sqrt(count)));
    grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    let xMin = Infinity;
    let xMax = -Infinity;
    for (const entry of entries) {
      const times = entry.t || [];
      if (times.length) {
        xMin = Math.min(xMin, times[0]);
        xMax = Math.max(xMax, times[times.length - 1]);
      }
    }
    if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMax <= xMin) {
      xMin = 0;
      xMax = 1;
    }
    for (const entry of entries) {
      const card = div("wb-subplot");
      const titleBar = div("wb-subplot-title");
      titleBar.append(
        el("b", null, entry.name || String(entry.state_id || "")),
        el("span", "wb-subplot-meta", `${(entry.t || []).length} \u70B9`)
      );
      card.appendChild(titleBar);
      const canvasHost = div("wb-subplot-canvas-host");
      card.appendChild(canvasHost);
      grid.appendChild(card);
      const renderer = createChartRenderer(wbCompareRenderer);
      renderer.mount(canvasHost, { height: wbCompareLayout.height, title: entry.name });
      renderer.setSeries({ entry, signals, xMin, xMax, height: wbCompareLayout.height });
      wbActiveRenderers.push(renderer);
    }
  }
  function drawWbSubplot(canvas2, entry, signals, xMin, xMax, height) {
    const parentWidth = canvas2.parentElement?.getBoundingClientRect().width || 320;
    const cssW = Math.max(120, Math.round(parentWidth));
    const cssH = height == null ? wbCompareLayout.height : height;
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
    canvas2.width = Math.round(cssW * dpr);
    canvas2.height = Math.round(cssH * dpr);
    canvas2.style.width = `${cssW}px`;
    canvas2.style.height = `${cssH}px`;
    const ctx2 = canvas2.getContext("2d");
    if (!ctx2) return;
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2.clearRect(0, 0, cssW, cssH);
    ctx2.fillStyle = C("#faf8f2");
    ctx2.fillRect(0, 0, cssW, cssH);
    const left = 48;
    const right = 12;
    const top = 10;
    const bottom = 22;
    const plotW = Math.max(10, cssW - left - right);
    const plotH = Math.max(10, cssH - top - bottom);
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const key of signals) {
      const arr = entry.series?.[key] || [];
      for (const value of arr) {
        if (Number.isFinite(value)) {
          yMin = Math.min(yMin, value);
          yMax = Math.max(yMax, value);
        }
      }
    }
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
      yMin = -1;
      yMax = 1;
    }
    if (yMax - yMin < 1e-12) {
      const mid = (yMax + yMin) / 2 || 0;
      yMin = mid - 0.5;
      yMax = mid + 0.5;
    }
    const spanY = Math.max(1e-12, yMax - yMin);
    const spanX = Math.max(1e-12, xMax - xMin);
    const toX = (t) => left + (t - xMin) / spanX * plotW;
    const toY = (v) => top + (1 - (v - yMin) / spanY) * plotH;
    ctx2.strokeStyle = C("#e6e2d6");
    ctx2.lineWidth = 1;
    ctx2.fillStyle = C("#969083");
    ctx2.font = '10px "Segoe UI","Microsoft YaHei",sans-serif';
    ctx2.textAlign = "right";
    ctx2.textBaseline = "middle";
    for (let i = 0; i <= 4; i += 1) {
      const value = yMin + spanY * (i / 4);
      const y = toY(value);
      ctx2.beginPath();
      ctx2.moveTo(left, y);
      ctx2.lineTo(left + plotW, y);
      ctx2.stroke();
      ctx2.fillText(wbFmtAxis(value), left - 6, y);
    }
    ctx2.textAlign = "center";
    ctx2.textBaseline = "top";
    for (let i = 0; i <= 4; i += 1) {
      const t = xMin + spanX * (i / 4);
      const x = toX(t);
      ctx2.beginPath();
      ctx2.moveTo(x, top);
      ctx2.lineTo(x, top + plotH);
      ctx2.stroke();
      ctx2.fillText(wbFmtAxis(t), x, top + plotH + 4);
    }
    ctx2.strokeStyle = C("#b8b3a4");
    ctx2.strokeRect(left, top, plotW, plotH);
    for (const key of signals) {
      const arr = entry.series?.[key] || [];
      const times = entry.t || [];
      const n = Math.min(arr.length, times.length);
      if (!n) continue;
      ctx2.strokeStyle = colorForKey(key);
      ctx2.lineWidth = 1.6;
      ctx2.beginPath();
      for (let i = 0; i < n; i += 1) {
        const x = toX(times[i]);
        const y = toY(arr[i]);
        if (i === 0) ctx2.moveTo(x, y);
        else ctx2.lineTo(x, y);
      }
      ctx2.stroke();
    }
  }
  const PLOTKIT_RENDER2D_URL = "/plotkit/static/render2d.js";
  function readPlot2D() {
    const holder = window;
    return holder.Plot2D;
  }
  let plot2dLoading = null;
  async function loadPlot2DApi() {
    const existing = readPlot2D();
    if (existing) return existing;
    if (!plot2dLoading) {
      const url = PLOTKIT_RENDER2D_URL;
      plot2dLoading = (async () => {
        await import(url);
        const api2 = readPlot2D();
        if (!api2) throw new Error("PlotKit render2d \u672A\u6CE8\u518C window.Plot2D");
        return api2;
      })();
    }
    return plot2dLoading;
  }
  class SimpleCanvasRenderer {
    constructor() {
      this.kind = "simple-chart";
      this.host = null;
      this.canvas = null;
      this.series = null;
      this.height = wbCompareLayout.height;
    }
    mount(host, opts) {
      this.host = host;
      this.height = opts?.height ?? wbCompareLayout.height;
      host.replaceChildren();
      const canvas2 = document.createElement("canvas");
      canvas2.className = "wb-subplot-canvas";
      host.appendChild(canvas2);
      this.canvas = canvas2;
    }
    setSeries(series) {
      this.series = series;
      this.draw();
    }
    draw() {
      if (!this.canvas || !this.series) return;
      const { entry, signals, xMin, xMax, height } = this.series;
      drawWbSubplot(this.canvas, entry, signals, xMin ?? 0, xMax ?? 1, height ?? this.height);
    }
    resize() {
      this.draw();
    }
    destroy() {
      this.canvas = null;
      this.series = null;
      this.host = null;
    }
  }
  class PlotKitRenderer {
    constructor() {
      this.kind = "plotkit";
      this.host = null;
      this.canvas = null;
      this.series = null;
      this.height = wbCompareLayout.height;
      this.renderToken = 0;
    }
    mount(host, opts) {
      this.host = host;
      this.height = opts?.height ?? wbCompareLayout.height;
      host.replaceChildren();
      const canvas2 = document.createElement("canvas");
      canvas2.className = "wb-subplot-canvas";
      host.appendChild(canvas2);
      this.canvas = canvas2;
    }
    setSeries(series) {
      this.series = series;
      this.renderToken += 1;
      void this.renderAsync(this.renderToken);
    }
    async renderAsync(token) {
      const canvas2 = this.canvas;
      const series = this.series;
      if (!canvas2 || !series) return;
      try {
        const api2 = await loadPlot2DApi();
        if (token !== this.renderToken || this.canvas !== canvas2 || !this.series) return;
        this.drawWithPlotKit(api2, canvas2, series);
        if (this.host) this.host.removeAttribute("data-renderer-fallback");
      } catch (error) {
        if (token !== this.renderToken || this.canvas !== canvas2 || !this.series) return;
        const { entry, signals, xMin, xMax, height } = series;
        drawWbSubplot(canvas2, entry, signals, xMin ?? 0, xMax ?? 1, height ?? this.height);
        if (this.host) this.host.setAttribute("data-renderer-fallback", "1");
        console.warn("[W3] PlotKit \u6E32\u67D3\u4E0D\u53EF\u7528\uFF0C\u5DF2\u56DE\u9000\u7B80\u6613\u6E32\u67D3\uFF1A", error?.message || error);
      }
    }
    drawWithPlotKit(api2, canvas2, series) {
      const { entry, signals, height } = series;
      const times = entry.t || [];
      if (!times.length) return;
      const hostW = canvas2.parentElement?.getBoundingClientRect().width || 320;
      const cssW = Math.max(120, Math.round(hostW));
      const cssH = Math.max(80, Math.round(height ?? this.height));
      canvas2.style.width = `${cssW}px`;
      canvas2.style.height = `${cssH}px`;
      const columns = {};
      columns.__t = Float32Array.from(times);
      for (const key of signals) {
        const arr = entry.series?.[key] || [];
        const n = Math.min(arr.length, times.length);
        const values = new Float32Array(n);
        for (let i = 0; i < n; i += 1) values[i] = arr[i];
        columns[key] = values;
      }
      const store = {
        get(name) {
          const values = columns[name];
          return values ? { values } : null;
        }
      };
      const layers = [];
      for (const key of signals) {
        const values = columns[key];
        if (!values || !values.length) continue;
        layers.push({
          kind: "line",
          data: { x: "__t", y: key },
          style: { color: colorForKey(key), width: 1.6 },
          label: key,
          legend: true
        });
      }
      const toks = tokens();
      const themeTokens = {
        paper: C("#faf8f2"),
        plot: C("#fbf9f4"),
        text: C("#3a3a33"),
        muted: C("#969083"),
        grid: C("#e6e2d6"),
        accent: String(toks.accent || C("#a8541f"))
      };
      const spec = {
        figure: {
          title: entry.name || String(entry.state_id || ""),
          xlabel: "t",
          ylabel: "",
          subplots: 1,
          ncols: 1
        },
        layers
      };
      api2.render(canvas2, spec, store, {
        dpr: clamp(window.devicePixelRatio || 1, 1, 2.5),
        width: cssW,
        height: cssH,
        tokens: themeTokens
      });
    }
    resize() {
      if (!this.canvas || !this.series) return;
      this.renderToken += 1;
      void this.renderAsync(this.renderToken);
    }
    destroy() {
      this.renderToken += 1;
      this.canvas = null;
      this.series = null;
      this.host = null;
    }
  }
  function createChartRenderer(kind) {
    return kind === "plotkit" ? new PlotKitRenderer() : new SimpleCanvasRenderer();
  }
  async function wbPrecomputeSelected() {
    if (!wbCompareStateIds.length) {
      toast("\u8BF7\u5148\u5728\u4FE1\u53F7\u7A97\u52FE\u9009\u8981\u9884\u8BA1\u7B97\u7684\u72B6\u6001", "error");
      return;
    }
    const input = window.prompt("\u9884\u8BA1\u7B97\u65F6\u957F\uFF08\u79D2\uFF0C0 < \u65F6\u957F \u2264 120\uFF09", "5");
    if (input === null) return;
    const seconds = Number(input);
    if (!(seconds > 0)) {
      toast("\u9884\u8BA1\u7B97\u65F6\u957F\u9700\u4E3A\u6B63\u6570", "error");
      return;
    }
    for (const id of wbCompareStateIds.slice()) {
      const row = (wbCacheStatus?.states || []).find((item) => String(item.state_id) === id);
      const label = `\u9884\u8BA1\u7B97 ${row?.name || id}\u2026`;
      try {
        const result = await runPrecomputeWithProgress(
          () => api("/api/network/state/precompute", {
            method: "POST",
            body: JSON.stringify({ state_id: id, seconds }),
            timeoutMs: 6e5
          }),
          label
        );
        if (result && result.ok === false) {
          toast(`${label}\u5931\u8D25\uFF1A${result.error || "\u672A\u77E5\u9519\u8BEF"}`, "error", 7e3);
        }
      } catch (error) {
        toast(`${label}\u5931\u8D25\uFF1A${error?.message || error}`, "error", 7e3);
      }
    }
    toast("\u9884\u8BA1\u7B97\u5B8C\u6210", "ok", 2600);
    await refreshWbAnalysis();
  }
  async function wbUnifySim() {
    const rows = wbCacheStatus?.states || [];
    if (rows.length < 2) {
      toast("\u81F3\u5C11\u9700\u8981\u4E24\u4E2A\u72B6\u6001\u624D\u80FD\u7EDF\u4E00\u4EFF\u771F\u8BBE\u7F6E", "error");
      return;
    }
    const sourceId = wbCompareStateIds[0] || String(rows[0].state_id || "");
    const sourceName = rows.find((row) => String(row.state_id) === String(sourceId))?.name || sourceId;
    if (!window.confirm(
      `\u4EE5\u300C${sourceName}\u300D\u7684\u4EFF\u771F\u8BBE\u7F6E\u7EDF\u4E00\u5168\u90E8\u72B6\u6001\uFF1F
\uFF08\u5404\u72B6\u6001\u7F13\u5B58\u5C06\u5931\u6548\uFF0C\u9700\u8981\u91CD\u65B0\u9884\u8BA1\u7B97\uFF09`
    )) {
      return;
    }
    try {
      await api("/api/network/state", {
        method: "POST",
        body: JSON.stringify({ action: "unify_sim", state_id: String(sourceId) }),
        timeoutMs: 3e4
      });
      markProjectDirty();
      toast("\u5DF2\u7EDF\u4E00\u5404\u72B6\u6001\u4EFF\u771F\u8BBE\u7F6E\uFF0C\u7F13\u5B58\u5DF2\u5931\u6548", "ok", 3600);
      await refreshWbAnalysis();
    } catch (error) {
      toast(error?.message || String(error), "error", 6e3);
    }
  }
  async function renderWorkbenchState() {
    const pane = $("#tab-wb-state");
    if (!pane) return;
    let payload = null;
    try {
      payload = await jsonRequest("/api/network/states", "GET");
    } catch (error) {
      toast(`\u8BFB\u53D6\u72B6\u6001\u5931\u8D25\uFF1A${error?.message || error}`, "error", 6e3);
    }
    if (payload) {
      wbStatesPayload = payload;
      const ids = (payload.states || []).map((item) => item.id);
      if (!wbSelectedId || ids.indexOf(wbSelectedId) < 0) {
        wbSelectedId = payload.base || ids[0] || "";
      }
    }
    const host = div("wb-host");
    const head = div("insp-head");
    const title = div("insp-title");
    title.append(
      el("h2", null, "\u5DE5\u4F5C\u53F0 \xB7 \u72B6\u6001"),
      el("p", null, "\u53C2\u6570\u8868\u683C + \u591A\u5957\u53C2\u6570\u72B6\u6001\uFF1B\u5207\u6362\u72B6\u6001\u5373\u628A\u8BE5\u72B6\u6001\u53C2\u6570\u5199\u56DE\u5F53\u524D\u7F51\u7EDC\u3002")
    );
    head.appendChild(title);
    const dirtyBadge = wbBadge(
      wbDirty ? "\u672A\u4FDD\u5B58\u5230\u72B6\u6001" : "\u5DF2\u540C\u6B65\u5230\u72B6\u6001",
      wbDirty ? "badge violet" : "badge green"
    );
    dirtyBadge.id = "wbDirtyBadge";
    head.appendChild(dirtyBadge);
    host.appendChild(head);
    const states = wbStatesPayload?.states || [];
    const toolbar = div("blocks-toolbar");
    toolbar.append(
      button("\uFF0B \u65B0\u5EFA\u72B6\u6001", "btn tiny primary", () => void wbCreateNew()),
      button("\u66F4\u65B0\u5230\u6B64\u72B6\u6001", "btn tiny", () => void wbUpdateCurrent()),
      button("\u53E6\u5B58\u4E3A\u65B0\u72B6\u6001", "btn tiny", () => void wbCreateNew())
    );
    host.appendChild(toolbar);
    const listRow = div("wb-state-list");
    if (!states.length) {
      listRow.appendChild(div("help", "\u6682\u65E0\u72B6\u6001\u3002\u70B9\u300C\u65B0\u5EFA\u72B6\u6001\u300D\u6309\u5F53\u524D\u7F51\u7EDC\u53C2\u6570\u5EFA\u7ACB\u7B2C\u4E00\u4E2A\u72B6\u6001\u3002"));
    }
    for (const item of states) {
      const rowEl = div("wb-state-chip" + (item.id === wbSelectedId ? " active" : ""));
      if (item.base) rowEl.appendChild(wbBadge("\u57FA\u51C6", "badge gray"));
      const nameEl = el("button", "wb-state-name", item.name);
      nameEl.type = "button";
      nameEl.title = "\u5207\u6362\u5230\u8BE5\u72B6\u6001\uFF08\u628A\u53C2\u6570\u5199\u56DE\u5F53\u524D\u7F51\u7EDC\uFF09";
      nameEl.addEventListener("click", () => void wbApplyState(item.id));
      rowEl.appendChild(nameEl);
      rowEl.appendChild(button("\u8BBE\u57FA\u51C6", "btn tiny", () => void wbAction("set_base", item.id)));
      rowEl.appendChild(button("\u91CD\u547D\u540D", "btn tiny", () => void wbRename(item.id, item.name)));
      rowEl.appendChild(button("\u590D\u5236", "btn tiny", () => void wbAction("duplicate", item.id)));
      rowEl.appendChild(button("\u5220\u9664", "btn tiny", () => void wbDelete(item.id)));
      listRow.appendChild(rowEl);
    }
    host.appendChild(listRow);
    const filter = el("input", "input");
    filter.type = "search";
    filter.placeholder = "\u68C0\u7D22 \u8282\u70B9\u540D / kind / \u53C2\u6570\u540D\u2026";
    filter.value = wbFilterText;
    const filterRow = div("field-row");
    filterRow.append(el("label", null, "\u68C0\u7D22"), filter);
    host.appendChild(filterRow);
    const table = div("wb-param-table");
    const rows = [];
    const addRow = (objLabel, paramLabel, control2) => {
      const row = div("wb-param-row");
      row.append(el("span", "wb-obj", objLabel), el("span", "wb-key", paramLabel));
      const valCell = div("wb-val");
      valCell.appendChild(control2);
      row.appendChild(valCell);
      table.appendChild(row);
      rows.push({ el: row, text: `${objLabel} ${paramLabel}`.toLowerCase() });
    };
    const scene = state.scene;
    for (const node of scene?.nodes || []) {
      const spec = getNodeSpec(node.kind);
      const list = spec && Array.isArray(spec.params) ? spec.params : [];
      if (!list.length) continue;
      const baseParams = Object.assign(specDefaults(spec), node.params || {});
      for (const param of list) {
        const value = param.key in baseParams ? baseParams[param.key] : clone(param.default);
        const control2 = buildParamField(param, value);
        control2.addEventListener("change", () => void wbCommitNodeParam(node.id, control2, baseParams));
        addRow(`${node.name} \xB7 ${node.kind}`, String(param.label || param.key), control2);
      }
    }
    for (const edge of scene?.edges || []) {
      const spec = getEdgeSpec(edge.kind);
      const list = spec && Array.isArray(spec.params) ? spec.params : [];
      if (!list.length) continue;
      const baseParams = Object.assign(specDefaults(spec), edge.params || {});
      for (const param of list) {
        const value = param.key in baseParams ? baseParams[param.key] : clone(param.default);
        const control2 = buildParamField(param, value);
        control2.addEventListener("change", () => void wbCommitEdgeParam(edge.id, control2, baseParams));
        addRow(`${edge.name} \xB7 ${edge.kind}`, String(param.label || param.key), control2);
      }
    }
    const config = state.sim?.config || {};
    for (const field of WB_SIM_FIELDS) {
      const paramSpec = {
        key: field.key,
        type: field.type,
        label: field.label,
        unit: field.unit,
        step: field.step,
        min: field.min
      };
      const value = field.key in config ? config[field.key] : void 0;
      const control2 = buildParamField(paramSpec, value);
      control2.addEventListener("change", () => void wbCommitSimParam(field.key, control2));
      addRow("\u4EFF\u771F\u8BBE\u7F6E", field.label, control2);
    }
    const integValue = String(scene?.integration || "trapezoidal");
    const integSpec = {
      key: "integration",
      type: "choice",
      label: "\u79EF\u5206\u65B9\u6CD5 integration",
      choices: WB_INTEGRATIONS
    };
    const integControl = buildParamField(integSpec, integValue);
    integControl.addEventListener("change", () => void wbCommitIntegration(integControl));
    addRow("\u573A\u666F", "\u79EF\u5206\u65B9\u6CD5 (integration)", integControl);
    const applyFilter = () => {
      for (const item of rows) {
        item.el.classList.toggle("hidden", wbFilterText !== "" && item.text.indexOf(wbFilterText) < 0);
      }
    };
    filter.addEventListener("input", () => {
      wbFilterText = filter.value.trim().toLowerCase();
      applyFilter();
    });
    applyFilter();
    host.appendChild(table);
    pane.replaceChildren(host);
  }
  async function wbCreateNew() {
    const suggested = `\u72B6\u6001 ${(wbStatesPayload?.states?.length || 0) + 1}`;
    const name = window.prompt("\u65B0\u72B6\u6001\u540D\u79F0\uFF08\u81EA\u52A8\u5FEB\u7167\u5F53\u524D\u7F51\u7EDC\u53C2\u6570\uFF09", suggested);
    if (name === null) return;
    await wbAction("create", void 0, { name });
  }
  async function wbRename(id, oldName) {
    const name = window.prompt("\u91CD\u547D\u540D\u72B6\u6001", oldName);
    if (name === null) return;
    await wbAction("rename", id, { name });
  }
  async function wbDelete(id) {
    if (!window.confirm("\u5220\u9664\u8BE5\u72B6\u6001\uFF1F\uFF08\u5176\u9884\u8BA1\u7B97\u7F13\u5B58\u5C06\u5728 W2 \u4E2D\u4E00\u5E76\u5220\u9664\uFF09")) return;
    await wbAction("delete", id);
  }
  async function wbUpdateCurrent() {
    if (!wbSelectedId) {
      toast("\u8BF7\u5148\u9009\u62E9\u4E00\u4E2A\u72B6\u6001", "error");
      return;
    }
    await wbAction("update", wbSelectedId);
  }
  async function wbAction(action, stateId, extra) {
    const body = Object.assign({ action }, extra || {});
    if (stateId) body.state_id = stateId;
    try {
      const resp = await jsonRequest("/api/network/state", "POST", body);
      if (!resp) return;
      markProjectDirty();
      await renderWorkbenchState();
    } catch (error) {
      toast(error?.message || String(error), "error", 6e3);
    }
  }
  async function wbApplyState(id) {
    try {
      const resp = await jsonRequest("/api/network/state", "POST", {
        action: "apply",
        state_id: id
      });
      if (!resp) return;
      applySnapshot(resp);
      wbSelectedId = id;
      wbDirty = false;
      markProjectDirty();
      await renderWorkbenchState();
    } catch (error) {
      toast(error?.message || String(error), "error", 6e3);
    }
  }
  async function wbCommitNodeParam(nodeId, control2, baseParams) {
    let values;
    try {
      values = collectParamValues(control2.parentElement || control2);
    } catch (error) {
      toast(error.message, "error", 5e3);
      return;
    }
    const merged = Object.assign({}, baseParams, values);
    try {
      const resp = await jsonRequest(`/api/nodes/${encodeURIComponent(nodeId)}`, "PATCH", {
        params: merged
      });
      if (!resp) return;
      Object.assign(baseParams, values);
      if (resp.node) {
        const list = state.scene?.nodes || [];
        const index = list.findIndex((item) => item.id === nodeId);
        if (index >= 0) list[index] = Object.assign({}, list[index], resp.node);
      }
      if (resp.sim) state.sim = resp.sim;
      wbMarkDirty();
    } catch (error) {
      toast(error?.message || String(error), "error", 6e3);
    }
  }
  async function wbCommitEdgeParam(edgeId, control2, baseParams) {
    let values;
    try {
      values = collectParamValues(control2.parentElement || control2);
    } catch (error) {
      toast(error.message, "error", 5e3);
      return;
    }
    const merged = Object.assign({}, baseParams, values);
    try {
      const resp = await jsonRequest(`/api/edges/${encodeURIComponent(edgeId)}`, "PATCH", {
        params: merged
      });
      if (!resp) return;
      Object.assign(baseParams, values);
      if (resp.edge) {
        const list = state.scene?.edges || [];
        const index = list.findIndex((item) => item.id === edgeId);
        if (index >= 0) list[index] = Object.assign({}, list[index], resp.edge);
      }
      if (resp.sim) state.sim = resp.sim;
      wbMarkDirty();
    } catch (error) {
      toast(error?.message || String(error), "error", 6e3);
    }
  }
  async function wbCommitSimParam(key, control2) {
    let values;
    try {
      values = collectParamValues(control2.parentElement || control2);
    } catch (error) {
      toast(error.message, "error", 5e3);
      return;
    }
    try {
      const resp = await jsonRequest("/api/config", "PATCH", {
        [key]: values[key]
      });
      if (!resp) return;
      if (resp.sim) state.sim = resp.sim;
      wbMarkDirty();
    } catch (error) {
      toast(error?.message || String(error), "error", 6e3);
    }
  }
  async function wbCommitIntegration(control2) {
    let values;
    try {
      values = collectParamValues(control2.parentElement || control2);
    } catch (error) {
      toast(error.message, "error", 5e3);
      return;
    }
    try {
      const resp = await jsonRequest("/api/scene", "PATCH", {
        integration: values["integration"]
      });
      if (!resp) return;
      applySnapshot(resp);
      wbMarkDirty();
    } catch (error) {
      toast(error?.message || String(error), "error", 6e3);
    }
  }
  function renderAnalysisPanel() {
    const pane = ui.analysisPane;
    if (!pane) return;
    const host = div("blocks-host");
    const head = div("insp-head");
    const title = div("insp-title");
    title.append(el("h2", null, "\u5206\u6790\uFF08\u65C1\u8DEF\uFF09"), el("p", null, "\u53EA\u8BFB\u5F55\u5236\u6570\u636E\uFF1B\u7ED3\u8BBA\u5E26\u6765\u6E90\uFF0C\u4E0D\u5199\u6C42\u89E3\u5668"));
    head.appendChild(title);
    host.appendChild(head);
    const keys = state.sim?.probe_keys || [];
    const signal = el("select", "input");
    for (const key2 of keys) {
      const option = el("option", null, key2);
      option.value = key2;
      signal.appendChild(option);
    }
    const key = analysisSignalKey();
    if (key) signal.value = key;
    const keyRow = div("field-row");
    keyRow.append(el("label", null, "\u4FE1\u53F7"), signal);
    host.appendChild(keyRow);
    const row = div("blocks-toolbar");
    row.append(
      button("\u6307\u6807", "btn tiny primary", () => void runAnalysisMetrics()),
      button("\u9891\u8C31", "btn tiny", () => void runAnalysisSpectrum()),
      button("\u5468\u671F", "btn tiny", () => void runAnalysisPeriod()),
      button("\u6570\u5B66\u5F62\u5F0F", "btn tiny", () => void runAnalysisMath()),
      button("\u5BFC\u51FA CSV", "btn tiny", () => void exportAnalysisCsv())
    );
    host.appendChild(row);
    const canvas2 = el("canvas", "analysis-chart");
    canvas2.id = "analysisChart";
    host.appendChild(canvas2);
    const transferRow = div("field-row");
    const inputNode = el("input", "input");
    inputNode.id = "analysisInputNode";
    inputNode.placeholder = "\u8F93\u5165\u8282\u70B9\u540D";
    inputNode.value = state.scene?.nodes?.[0]?.name || "";
    const outputNode = el("input", "input");
    outputNode.id = "analysisOutputNode";
    outputNode.placeholder = "\u8F93\u51FA\u8282\u70B9\u540D";
    outputNode.value = state.scene?.nodes?.[state.scene.nodes.length - 1]?.name || "";
    transferRow.append(
      el("label", null, "\u4F20\u9012\u51FD\u6570"),
      inputNode,
      outputNode,
      button("\u63A8\u5BFC", "btn tiny", () => void runAnalysisTransfer()),
      button("\u5BFC\u51FA A/B/C/D", "btn tiny", () => exportTFStateSpace())
    );
    host.appendChild(transferRow);
    const tfSection = div("insp-section");
    tfSection.appendChild(el("h3", null, "\u4F20\u9012\u51FD\u6570\u5206\u6790\uFF08s \u57DF\uFF09"));
    const tfNodes = (state.scene?.nodes || []).filter((node) => node.kind === "transfer_function");
    const tfNode = el("select", "input");
    tfNode.id = "analysisTFNode";
    const tfDirect = el("option", null, "\uFF08\u7528\u8868\u8FBE\u5F0F\uFF09");
    tfDirect.value = "";
    tfNode.appendChild(tfDirect);
    for (const node of tfNodes) {
      const option = el("option", null, node.name);
      option.value = node.name;
      tfNode.appendChild(option);
    }
    const tfExpr = el("input", "input");
    tfExpr.id = "analysisTFExpr";
    tfExpr.placeholder = "\u5982 (2*s+1)/(s^2+3*s+2)";
    tfExpr.value = "1/(s+1)";
    tfNode.addEventListener("change", () => {
      tfExpr.disabled = Boolean(tfNode.value);
    });
    const tfRow = div("field-row");
    tfRow.append(el("label", null, "\u8282\u70B9 / \u8868\u8FBE\u5F0F"), tfNode, tfExpr);
    tfSection.appendChild(tfRow);
    const tfView = el("select", "input");
    tfView.id = "analysisTFView";
    for (const [value, label] of [
      ["bode", "Bode \u56FE"],
      ["step", "\u9636\u8DC3\u54CD\u5E94"],
      ["poles", "\u96F6\u6781\u70B9\u56FE"]
    ]) {
      const option = el("option", null, label);
      option.value = value;
      tfView.appendChild(option);
    }
    tfView.addEventListener("change", () => drawAnalysisTF());
    const tfTools = div("field-row");
    tfTools.append(
      button("\u5206\u6790", "btn tiny primary", () => void runAnalysisTF()),
      button("\u53D1\u9001\u5230 PlotKit", "btn tiny", () => void sendTFToPlotKit()),
      el("label", null, "\u89C6\u56FE"),
      tfView
    );
    tfSection.appendChild(tfTools);
    const tfCanvas = el("canvas", "analysis-chart");
    tfCanvas.id = "analysisTFChart";
    tfCanvas.style.height = "210px";
    tfSection.appendChild(tfCanvas);
    const tfOut = el("pre", "analysis-out");
    tfOut.id = "analysisTFOut";
    tfOut.textContent = state.analysisTF ? analysisTFSummary(state.analysisTF) : "\u9009\u4F20\u9012\u51FD\u6570\u8282\u70B9\u6216\u76F4\u63A5\u5199 s \u8868\u8FBE\u5F0F\uFF0C\u70B9\u300C\u5206\u6790\u300D\u5F97\u5230 Bode / \u9636\u8DC3 / \u96F6\u6781\u70B9\u3002";
    tfSection.appendChild(tfOut);
    host.appendChild(tfSection);
    const out = el("pre", "analysis-out");
    out.id = "analysisOut";
    out.textContent = state.analysisLast || "\u9009\u4FE1\u53F7\u540E\u8FD0\u884C\u6307\u6807/\u9891\u8C31/\u5468\u671F/\u6570\u5B66\u5F62\u5F0F\uFF1B\u4F20\u9012\u51FD\u6570\u586B\u8282\u70B9\u540D\u3002";
    host.appendChild(out);
    const perf = div("insp-section");
    perf.appendChild(el("h3", null, "\u6027\u80FD\u4E0E\u8D85\u65F6\uFF08R13\uFF09"));
    const timeoutInput = el("input", "input");
    timeoutInput.type = "number";
    timeoutInput.id = "analysisStepTimeout";
    timeoutInput.min = "0";
    timeoutInput.step = "0.5";
    timeoutInput.value = String(state.sim?.config?.step_timeout_ms ?? 0);
    const apply = button("\u5E94\u7528\u5355\u6B65\u4E0A\u9650", "btn tiny", async () => {
      const response = await task(() => jsonRequest("/api/config", "PATCH", { step_timeout_ms: Number(timeoutInput.value) || 0 }));
      if (response) toast("\u5355\u6B65\u8D85\u65F6\u5DF2\u66F4\u65B0\uFF080=\u5173\u95ED\uFF09", "ok", 2400);
    });
    const perfRow = div("field-row");
    perfRow.append(el("label", null, "\u5355\u6B65\u4E0A\u9650 ms"), timeoutInput, apply);
    perf.appendChild(perfRow);
    const profileToggle = el("input");
    profileToggle.type = "checkbox";
    profileToggle.id = "analysisProfileEnabled";
    const profileButtons = div("field-row");
    profileButtons.append(
      el("label", null, "\u8BA1\u65F6\u5F00\u5173"),
      profileToggle,
      button("\u5E94\u7528", "btn tiny", async () => {
        const response = await task(() => jsonRequest("/api/profile", "PATCH", {
          enabled: Boolean(profileToggle.checked)
        }));
        if (response) {
          profileToggle.checked = Boolean(response.enabled);
          toast(response.enabled ? "\u6027\u80FD\u8BA1\u65F6\u5DF2\u5F00\u542F" : "\u6027\u80FD\u8BA1\u65F6\u5DF2\u5173\u95ED", "ok", 2200);
        }
      }),
      button("\u6E05\u7A7A", "btn tiny", async () => {
        const response = await task(() => jsonRequest("/api/profile", "PATCH", { reset: true }));
        if (response) toast("\u6027\u80FD\u91C7\u6837\u5DF2\u6E05\u7A7A", "ok", 2e3);
      })
    );
    perf.appendChild(profileButtons);
    const profileOut = el("pre", "analysis-out");
    profileOut.id = "analysisProfile";
    profileOut.textContent = "\u70B9\u51FB\u5237\u65B0\u8BFB\u53D6 /api/profile\uFF08\u9ED8\u8BA4\u5173\u95ED\uFF0C\u5F00\u9500\u53EF\u5FFD\u7565\uFF09";
    perf.appendChild(
      button("\u5237\u65B0\u6027\u80FD", "btn tiny", async () => {
        const response = await task(() => jsonRequest("/api/profile?top=20", "GET"), { dirty: false });
        if (!response) return;
        profileToggle.checked = Boolean(response.enabled);
        const rows = (response.entries || []).map(
          (item) => `${item.name}	${item.count} \u6B21	\u603B ${item.total_ms} ms	\u5747 ${item.mean_ms} ms	\u5CF0 ${item.max_ms} ms`
        );
        profileOut.textContent = [
          `\u8BA1\u65F6\uFF1A${response.enabled ? "\u5F00" : "\u5173"}  \u6837\u672C ${response.samples}/${response.capacity}`,
          ...rows.length ? rows : ["\uFF08\u6682\u65E0\u91C7\u6837\uFF0C\u5F00\u542F\u8BA1\u65F6\u540E\u8FD0\u884C\u4EFF\u771F\uFF09"]
        ].join("\n");
      })
    );
    perf.appendChild(profileOut);
    host.appendChild(perf);
    pane.replaceChildren(host);
    if (state.analysisSpectrum) drawAnalysisSpectrum();
    if (state.analysisTF) drawAnalysisTF();
  }
  const UI_TOKEN_LEGACY_DEFAULTS = {
    background: "#0b1220",
    surface: "#111a2c",
    panel: "#162238",
    text: "#e6edf7",
    muted: "#8da2bf",
    accent: "#4cc9f0",
    grid: "#22314b",
    edge: "#7c8db5",
    node: "#1c2b45",
    danger: "#ff6b6b",
    success: "#5ee39b"
  };
  function applyUiTokens(tokens2, mode) {
    const root = document.documentElement;
    const tokenVars = {
      background: "--paper",
      surface: "--paper-2",
      panel: "--paper-3",
      text: "--ink",
      muted: "--muted",
      accent: "--accent",
      grid: "--line",
      edge: "--line-strong",
      node: "--ink-2",
      danger: "--red",
      success: "--green"
    };
    for (const [key, value] of Object.entries(tokens2 || {})) {
      root.style.setProperty(`--nl-${key}`, value);
      const target = tokenVars[key];
      if (!target) continue;
      const isCustom = String(value).toLowerCase() !== (UI_TOKEN_LEGACY_DEFAULTS[key] || "").toLowerCase();
      if (isCustom) root.style.setProperty(target, value);
    }
    if (tokens2?.accent && String(tokens2.accent).toLowerCase() !== UI_TOKEN_LEGACY_DEFAULTS.accent) {
      root.style.setProperty("--accent-strong", tokens2.accent);
    }
    if (mode) {
      document.body.dataset.canvasMode = mode;
      document.body.classList.toggle("simple-canvas", mode === "simple");
    }
  }
  async function loadUiProfile() {
    try {
      const response = await jsonRequest("/api/ui", "GET");
      if (response?.current) applyUiTokens(response.current.tokens, response.current.mode);
    } catch {
    }
  }
  function openIroColorPopover(anchor, value, onChange) {
    document.querySelectorAll(".iro-popover").forEach((node) => node.remove());
    if (!window.iro || typeof window.iro.ColorPicker !== "function") {
      anchor.click();
      return;
    }
    const pop = div("iro-popover");
    const rect = anchor.getBoundingClientRect();
    pop.style.position = "fixed";
    pop.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 260))}px`;
    pop.style.top = `${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 300))}px`;
    pop.style.zIndex = "20000";
    pop.style.padding = "10px";
    pop.style.borderRadius = "10px";
    pop.style.background = "var(--panel, #fff)";
    pop.style.boxShadow = "0 12px 36px rgba(0,0,0,.24)";
    pop.style.border = "1px solid var(--line, #ccd4d8)";
    const host = div("iro-host");
    pop.appendChild(host);
    pop.appendChild(button("\u5173\u95ED", "btn tiny", () => pop.remove()));
    document.body.appendChild(pop);
    const picker = new window.iro.ColorPicker(host, { width: 220, color: value || "#000000" });
    picker.on("color:change", (color) => onChange(color.hexString));
    setTimeout(() => {
      const close = (event) => {
        if (pop.contains(event.target) || event.target === anchor) return;
        pop.remove();
        document.removeEventListener("pointerdown", close);
      };
      document.addEventListener("pointerdown", close);
    }, 0);
  }
  function previewElementAppearance(item, appearance) {
    item.appearance = { ...appearance };
    requestDraw();
  }
  async function persistElementAppearance(kind, id, appearance) {
    const path = kind === "node" ? `/api/nodes/${encodeURIComponent(id)}` : `/api/edges/${encodeURIComponent(id)}`;
    const response = await task(() => jsonRequest(path, "PATCH", { appearance: appearance ?? {} }));
    if (!response) return;
    renderInspector();
  }
  async function openViewDesigner() {
    try {
      const response = await jsonRequest("/api/ui", "GET");
      if (!response) return;
      let current = response.current || response.defaults;
      state.ui.cardDetail = current.node?.show_detail !== false;
      state.ui.cardValue = current.node?.show_value !== false;
      const tokenLabels = {
        background: "\u80CC\u666F",
        surface: "\u8868\u9762",
        panel: "\u9762\u677F",
        text: "\u6587\u5B57",
        muted: "\u6B21\u8981\u6587\u5B57",
        accent: "\u5F3A\u8C03\u8272",
        grid: "\u7F51\u683C",
        edge: "\u8FDE\u7EBF",
        node: "\u8282\u70B9",
        danger: "\u8B66\u793A",
        success: "\u6210\u529F"
      };
      const tokenInputs = {};
      const tokenGrid = div("ui-token-grid");
      for (const [key, value] of Object.entries(current.tokens || {})) {
        const label = div("ui-field");
        label.appendChild(el("span", null, tokenLabels[key] || key));
        const input = el("input", "ui-color");
        input.type = "color";
        input.value = value;
        input.dataset.token = key;
        input.addEventListener("input", () => {
          current.tokens[key] = input.value;
          applyUiTokens(current.tokens);
        });
        tokenInputs[key] = input;
        const colorRow = div("ui-color-row");
        colorRow.appendChild(input);
        colorRow.appendChild(button("\u8C03\u8272", "btn tiny", () => openIroColorPopover(input, input.value, (hex) => {
          input.value = hex;
          current.tokens[key] = hex;
          applyUiTokens(current.tokens);
        })));
        label.appendChild(colorRow);
        tokenGrid.appendChild(label);
      }
      const modeRow = div("ui-field wide");
      modeRow.appendChild(el("span", null, "\u753B\u5E03\u6A21\u5F0F"));
      const modeSelect = el("select");
      for (const [value, label] of [["simple", "\u7B80\u6D01\u753B\u5E03"], ["professional", "\u4E13\u4E1A\u753B\u5E03"]]) {
        const option = el("option", null, label);
        option.value = value;
        modeSelect.appendChild(option);
      }
      modeSelect.value = current.mode || "professional";
      modeSelect.addEventListener("change", () => {
        current.mode = modeSelect.value;
      });
      modeRow.appendChild(modeSelect);
      const layoutRows = div("ui-layout-rows");
      for (const [key, value] of Object.entries(current.layout || {})) {
        const label = div("ui-field wide");
        label.appendChild(el("span", null, key));
        const input = el("input");
        input.type = "range";
        input.min = key === "font_scale" ? "0.6" : "4";
        input.max = key === "font_scale" ? "2.0" : "600";
        input.step = key === "font_scale" ? "0.05" : "1";
        input.value = String(value);
        input.addEventListener("input", () => {
          current.layout[key] = Number(input.value);
        });
        label.appendChild(input);
        layoutRows.appendChild(label);
      }
      const nodeRows = div("ui-layout-rows");
      const addNodeToggle = (key, labelText) => {
        const label = div("ui-field wide");
        label.appendChild(el("span", null, labelText));
        const input = el("input");
        input.type = "checkbox";
        input.checked = current.node?.[key] !== false;
        input.addEventListener("change", () => {
          current.node = current.node || {};
          current.node[key] = input.checked;
          if (key === "show_detail") state.ui.cardDetail = input.checked;
          else state.ui.cardValue = input.checked;
          requestDraw();
        });
        label.appendChild(input);
        nodeRows.appendChild(label);
      };
      addNodeToggle("show_detail", "\u663E\u793A\u8282\u70B9\u7C7B\u578B/\u7AEF\u53E3");
      addNodeToggle("show_value", "\u663E\u793A\u8282\u70B9\u6570\u503C");
      const appearanceRows = div("ui-layout-rows");
      const appearanceNode = selectedNode();
      const appearanceEdge = appearanceNode ? null : selectedEdge();
      const appearanceItem = appearanceNode || appearanceEdge;
      const appearanceKind = appearanceNode ? "node" : appearanceEdge ? "edge" : null;
      if (!appearanceItem || !appearanceKind) {
        appearanceRows.appendChild(div("help", "\u5148\u5728\u753B\u5E03\u4E0A\u9009\u4E2D\u4E00\u4E2A\u8282\u70B9\u6216\u8FDE\u7EBF\uFF0C\u518D\u56DE\u5230\u8FD9\u91CC\u8BBE\u7F6E\u5143\u7D20\u5916\u89C2\u3002"));
      } else {
        const app = { ...appearanceItem.appearance || {} };
        const commit = () => {
          previewElementAppearance(appearanceItem, app);
        };
        const persist = () => {
          void persistElementAppearance(appearanceKind, appearanceItem.id, app);
        };
        const colorField = div("ui-field wide");
        colorField.appendChild(el("span", null, "\u989C\u8272"));
        const colorInput = el("input");
        colorInput.type = "color";
        colorInput.value = app.color || tokens().edgeDefault;
        colorInput.addEventListener("input", () => {
          app.color = colorInput.value;
          commit();
        });
        colorInput.addEventListener("change", persist);
        colorField.appendChild(colorInput);
        appearanceRows.appendChild(colorField);
        const addRange = (key, labelText, min, max, step, fallback) => {
          const field = div("ui-field wide");
          field.appendChild(el("span", null, labelText));
          const input = el("input");
          input.type = "range";
          input.min = String(min);
          input.max = String(max);
          input.step = String(step);
          const currentValue = app[key];
          input.value = String(currentValue !== void 0 ? currentValue : fallback);
          input.addEventListener("input", () => {
            app[key] = Number(input.value);
            commit();
          });
          input.addEventListener("change", persist);
          field.appendChild(input);
          appearanceRows.appendChild(field);
        };
        addRange("opacity", "\u900F\u660E\u5EA6", 0.05, 1, 0.05, 1);
        addRange("lineWidth", "\u7EBF\u5BBD", 0.5, 12, 0.1, appearanceKind === "node" ? 1 : 1.15);
        addRange("fontSize", "\u6807\u7B7E\u5B57\u53F7", 6, 48, 0.5, 12);
        const clearRow = div("modal-actions");
        clearRow.appendChild(button("\u6E05\u9664\u8BE5\u5143\u7D20\u5916\u89C2\u8986\u76D6", "btn tiny", () => {
          appearanceItem.appearance = {};
          requestDraw();
          void persistElementAppearance(appearanceKind, appearanceItem.id, null);
          toast("\u5DF2\u6E05\u9664\u8BE5\u5143\u7D20\u7684\u5916\u89C2\u8986\u76D6", "ok");
        }));
        appearanceRows.appendChild(clearRow);
      }
      ui.modalCard.replaceChildren();
      ui.modalCard.append(
        el("h3", null, "\u89C6\u56FE\u8BBE\u8BA1"),
        div("help", "\u53EA\u8C03\u6574\u58F0\u660E\u5F0F UI \u4EE4\u724C\u4E0E\u5E03\u5C40\uFF0C\u4E0D\u6267\u884C\u4EFB\u610F HTML/CSS/JS\u3002\u989C\u8272\u9009\u62E9\u5668\u53EF\u76F4\u63A5\u53D6\u8272\uFF0C\u4FEE\u6539\u4F1A\u7ACB\u5373\u9884\u89C8\u3002"),
        modeRow,
        tokenGrid,
        el("h4", null, "\u5E03\u5C40"),
        layoutRows,
        el("h4", null, "\u8282\u70B9\u5361\u7247\u5B57\u6BB5"),
        nodeRows,
        el("h4", null, "\u5143\u7D20\u5916\u89C2\uFF08\u5F53\u524D\u9009\u4E2D\u9879\uFF09"),
        appearanceRows
      );
      const actions = div("modal-actions");
      actions.appendChild(button("\u5E94\u7528\u5E76\u4FDD\u5B58", "btn primary", async () => {
        const saved = await jsonRequest("/api/ui", "POST", current);
        if (saved?.current) applyUiTokens(saved.current.tokens, saved.current.mode);
        toast("\u89C6\u56FE\u8BBE\u8BA1\u5DF2\u4FDD\u5B58", "success");
        ui.modal.classList.add("hidden");
        ui.modalCard.replaceChildren();
      }));
      actions.appendChild(button("\u5173\u95ED", "btn", () => {
        ui.modal.classList.add("hidden");
        ui.modalCard.replaceChildren();
      }));
      ui.modalCard.appendChild(actions);
      ui.modal.classList.remove("hidden");
    } catch (error) {
      toast(`\u89C6\u56FE\u8BBE\u8BA1\u6253\u5F00\u5931\u8D25\uFF1A${error.message || error}`, "error", 6e3);
    }
  }
  async function openPluginManager() {
    const render = async () => {
      const response = await jsonRequest("/api/plugins", "GET");
      if (!response) return;
      const plugins = response.plugins || [];
      const list = div("plugin-list");
      if (!plugins.length) list.appendChild(div("help", "\u5C1A\u672A\u53D1\u73B0\u63D2\u4EF6\u3002\u628A\u63D2\u4EF6\u5305\u653E\u5230 NetlabHome/extensions/plugins/<id>/ \u540E\u70B9\u300C\u626B\u63CF\u300D\u3002"));
      for (const plugin of plugins) {
        const row = div("plugin-row");
        const head = div("plugin-head");
        head.appendChild(el("b", null, `${plugin.name || plugin.id}  `));
        head.appendChild(el("span", "plugin-version", `v${plugin.version || "?"}`));
        head.appendChild(el("span", `plugin-status ${plugin.status || ""}`, plugin.status || "unknown"));
        row.appendChild(head);
        row.appendChild(div("help", `${plugin.id} \xB7 API ${plugin.plugin_api} \xB7 ${plugin.description || "\u65E0\u63CF\u8FF0"}`));
        row.appendChild(div("help", `\u80FD\u529B\uFF1A${(plugin.capabilities || []).join(", ") || "\u2014"}`));
        if (plugin.error) row.appendChild(div("plugin-error", plugin.error));
        const actions = div("modal-actions");
        actions.appendChild(button(plugin.status === "loaded" ? "\u7981\u7528" : "\u542F\u7528", "btn tiny", async () => {
          await jsonRequest(`/api/plugins/${encodeURIComponent(plugin.id)}/enable`, "POST", { enabled: plugin.status !== "loaded" });
          await render();
        }));
        actions.appendChild(button("\u91CD\u65B0\u52A0\u8F7D", "btn tiny", async () => {
          await jsonRequest(`/api/plugins/${encodeURIComponent(plugin.id)}/reload`, "POST", {});
          await render();
        }));
        row.appendChild(actions);
        list.appendChild(row);
      }
      ui.modalCard.replaceChildren();
      ui.modalCard.append(
        el("h3", null, "\u63D2\u4EF6\u7BA1\u7406"),
        div("help", "\u63D2\u4EF6\u662F\u53D7\u4FE1\u4EFB\u7684\u8FDB\u7A0B\u5185 Python \u5305\uFF0C\u4E0D\u662F\u6C99\u7BB1\u3002\u5DE5\u7A0B\u53EA\u5F15\u7528\u63D2\u4EF6 id/version\uFF1B\u7F3A\u5305\u65F6\u5DE5\u7A0B\u4F1A\u964D\u7EA7\u6253\u5F00\u3002"),
        list
      );
      const footer = div("modal-actions");
      footer.appendChild(button("\u626B\u63CF\u63D2\u4EF6\u76EE\u5F55", "btn", async () => {
        await jsonRequest("/api/plugins/scan", "POST", {});
        await render();
      }));
      footer.appendChild(button("\u5173\u95ED", "btn", () => {
        ui.modal.classList.add("hidden");
        ui.modalCard.replaceChildren();
      }));
      ui.modalCard.appendChild(footer);
      ui.modal.classList.remove("hidden");
    };
    try {
      await render();
    } catch (error) {
      toast(`\u63D2\u4EF6\u7BA1\u7406\u6253\u5F00\u5931\u8D25\uFF1A${error.message || error}`, "error", 6e3);
    }
  }
  async function compareBuiltinBlock(spec) {
    try {
      const result = await jsonRequest(
        `/api/blocks/${encodeURIComponent(spec.id)}/compare`,
        "POST",
        { duration: 0.02, dt: 1e-3 }
      );
      if (!result.ok) {
        toast(`\u5BF9\u6BD4\u5931\u8D25\uFF1A${result.reason || "\u672A\u77E5\u539F\u56E0"}`, "error", 6e3);
        return;
      }
      const summary = [
        `\u6A21\u5757\uFF1A${result.name || spec.name || spec.id}`,
        `\u8F93\u51FA\uFF1A${result.output}.${result.field}`,
        `\u65F6\u957F/\u6B65\u957F\uFF1A${result.duration}s / ${result.dt}s\uFF08${result.steps} \u6B65\uFF09`,
        `\u884C\u4E3A\u5CF0\u503C\uFF1A${Math.max(...result.behavior).toFixed(6)}`,
        `\u7ED3\u6784\u5CF0\u503C\uFF1A${Math.max(...result.structural).toFixed(6)}`,
        `\u6700\u5927\u7EDD\u5BF9\u5DEE\uFF1A${Number(result.max_abs_diff).toFixed(6)}`,
        `RMS \u5DEE\uFF1A${Number(result.rms_diff).toFixed(6)}`
      ].join("\n");
      const detail = [
        `\u884C\u4E3A\uFF1A${result.behavior.join(", ")}`,
        `\u7ED3\u6784\uFF1A${result.structural.join(", ")}`
      ].join("\n");
      ui.modalCard.replaceChildren();
      ui.modalCard.append(
        el("h3", null, "\u5185\u7F6E\u5757\uFF1A\u884C\u4E3A / \u7ED3\u6784\u5BF9\u6BD4"),
        div("help", summary),
        el("pre", "compare-pre", detail),
        div("help", result.note || "")
      );
      const close = button("\u5173\u95ED", "btn", () => {
        ui.modal.classList.add("hidden");
        ui.modalCard.replaceChildren();
      });
      const actions = div("modal-actions");
      actions.appendChild(close);
      ui.modalCard.appendChild(actions);
      ui.modal.classList.remove("hidden");
      ui.modal.onclick = (event) => {
        if (event.target === ui.modal) close.click();
      };
    } catch (error) {
      toast(`\u5BF9\u6BD4\u5931\u8D25\uFF1A${error.message || error}`, "error", 6e3);
    }
  }
  function renderBlocksPanel() {
    const pane = ui.blocksPane;
    if (!pane) return;
    const host = div("blocks-host");
    const head = div("insp-head");
    const title = div("insp-title");
    title.append(
      el("h2", null, "\u6A21\u5757\u5E93"),
      el("p", null, state.blocksLibrary ? `\u5E93\u76EE\u5F55\uFF1A${state.blocksLibrary}` : "\u5E93\u76EE\u5F55\uFF1A\u9ED8\u8BA4 library/")
    );
    head.appendChild(title);
    host.appendChild(head);
    const toolbar = div("blocks-toolbar");
    const structuralRow = el("label", "switch-row");
    structuralRow.appendChild(el("span", null, "\u5C01\u88C5\u4E3A\u7ED3\u6784\u6A21\u578B\uFF08\u53EF\u770B\u5185\u90E8\uFF09"));
    const structuralInput = el("input");
    structuralInput.type = "checkbox";
    structuralInput.checked = Boolean(state.blocksStructural);
    structuralInput.addEventListener("change", () => {
      state.blocksStructural = Boolean(structuralInput.checked);
    });
    structuralRow.appendChild(structuralInput);
    toolbar.append(
      button("\u5237\u65B0", "btn tiny", () => void refreshBlocks()),
      button("\u5BFC\u5165 .block", "btn tiny", () => void importBlockFile()),
      button("\u5C01\u88C5\u9009\u4E2D", "btn tiny primary", () => void encapsulateSelection()),
      button("\u53E6\u5B58\u4E3A\u526F\u672C", "btn tiny", () => void saveCurrentAsBlockCopy()),
      button("\u63D2\u4EF6\u7BA1\u7406", "btn tiny", () => void openPluginManager()),
      button("\u89C6\u56FE\u8BBE\u8BA1", "btn tiny", () => void openViewDesigner())
    );
    const closeBtn = button("\u5173\u95ED\u5185\u90E8\u7F51\u7EDC", "btn tiny", () => void closeInternalNetwork());
    closeBtn.disabled = !String(state.currentNetwork?.name || "").startsWith("\u6A21\u5757 ");
    closeBtn.title = closeBtn.disabled ? "\u5F53\u524D\u4E0D\u662F\u6A21\u5757\u5185\u90E8\u4E34\u65F6\u7F51\u7EDC" : "\u5220\u9664\u5F53\u524D\u4E34\u65F6\u7F51\u7EDC\u5E76\u8FD4\u56DE\u4E0A\u4E00\u5C42";
    toolbar.appendChild(closeBtn);
    if (state.sim?.degraded?.read_only) {
      toolbar.appendChild(button("\u8865\u56DE\u540E\u91CD\u8BD5", "btn tiny", () => void retryDegradedProject()));
    }
    host.appendChild(structuralRow);
    host.appendChild(toolbar);
    if (!state.blocks.length) {
      host.appendChild(
        div("help", "\u5E93\u4E2D\u6CA1\u6709\u6A21\u5757\uFF1A\u9009\u4E2D\u753B\u5E03\u8282\u70B9\u540E\u70B9\u300C\u5C01\u88C5\u9009\u4E2D\u300D\uFF0C\u6216\u7528\u300C\u5BFC\u5165 .block\u300D\u8F7D\u5165\u5DF2\u6709\u6A21\u5757\u3002")
      );
      pane.replaceChildren(host);
      return;
    }
    const list = div("block-list");
    for (const spec of state.blocks) {
      const item = div("block-item");
      const info = div("block-info");
      const name = el("strong", null, spec.name || spec.id);
      const badges = div("block-badges");
      for (const badge of blockBadges(spec)) badges.appendChild(el("span", "badge gray", badge));
      info.append(name, badges);
      const ports = el("small", "block-ports", describeBlockPorts(spec));
      info.appendChild(ports);
      item.draggable = true;
      item.addEventListener("dragstart", (event) => {
        if (!event.dataTransfer) return;
        event.dataTransfer.setData("text/netlab-block", spec.id);
        event.dataTransfer.effectAllowed = "copy";
      });
      const actions = div("block-actions");
      actions.appendChild(button("\u5B9E\u4F8B\u5316", "btn tiny primary", () => void instantiateBlockFromLibrary(spec.id)));
      const openBtn = button("\u6253\u5F00\u5185\u90E8", "btn tiny", () => openModuleInternal(spec.id));
      openBtn.title = (spec.model || "behavioral") !== "structural" ? "\u6253\u5F00\u5185\u90E8\u6D6E\u7A97\uFF08\u884C\u4E3A\u6A21\u578B\u53EA\u770B\u5F97\u5230\u7AEF\u53E3\uFF09" : "\u5728\u5185\u90E8\u6D6E\u7A97\u4E2D\u9884\u89C8\u6A21\u5757\u7ED3\u6784";
      actions.appendChild(openBtn);
      if (spec.builtin) {
        const compareBtn = button("\u884C\u4E3A/\u7ED3\u6784\u5BF9\u6BD4", "btn tiny", () => void compareBuiltinBlock(spec));
        compareBtn.title = "\u8FD0\u884C\u884C\u4E3A\u5FEB\u901F\u6A21\u578B\u4E0E structural \u5185\u90E8\u573A\u666F\uFF0C\u5BF9\u6BD4\u540C\u4E00\u8F93\u5165\u7684\u8F93\u51FA";
        actions.appendChild(compareBtn);
      }
      const renameBtn = button("\u6539\u540D", "btn tiny", () => void renameLibraryBlock(spec));
      renameBtn.title = spec.builtin ? "\u5185\u7F6E\u6A21\u5757\u53EA\u8BFB\uFF0C\u8BF7\u5148\u53E6\u5B58\u4E3A\u526F\u672C" : "\u6539\u6A21\u5757\u540D\u5B57\uFF08\u6587\u4EF6\u540D\u540C\u6B65\u6539\uFF0C\u5F15\u7528\u4E0D\u53D8\uFF09";
      renameBtn.disabled = Boolean(spec.builtin);
      actions.appendChild(renameBtn);
      const deleteBtn = button("\u5220\u9664", "btn tiny danger", () => void deleteLibraryBlock(spec));
      deleteBtn.disabled = Boolean(spec.builtin);
      deleteBtn.title = spec.builtin ? "\u5185\u7F6E\u6A21\u5757\u53EA\u8BFB\uFF0C\u4E0D\u80FD\u5220\u9664" : "\u4ECE\u5E93\u91CC\u5220\u6389\u8FD9\u4E2A\u6A21\u5757\u6587\u4EF6";
      actions.appendChild(deleteBtn);
      item.append(info, actions);
      list.appendChild(item);
    }
    host.appendChild(list);
    host.appendChild(
      div("help", "\u6A21\u5757\u6587\u4EF6\u4F4D\u4E8E library/blocks/<\u6A21\u5757\u540D>.block\uFF1A\u4E00\u4E2A\u6A21\u5757\u4E00\u4E2A\u6587\u4EF6\uFF0C\u6587\u4EF6\u540D\u5C31\u662F\u6A21\u5757\u540D\uFF1B\u5E93\u4E2D\u53EA\u4FDD\u7559\u6700\u65B0\u7248\u3002")
    );
    pane.replaceChildren(host);
  }
  function findBlockNameClash(name, ignoreId) {
    const wanted = String(name || "").trim().toLowerCase();
    if (!wanted) return null;
    return state.blocks.find(
      (item) => item.id !== ignoreId && String(item.name || "").trim().toLowerCase() === wanted
    ) || null;
  }
  async function renameLibraryBlock(spec) {
    const proposed = window.prompt(`\u6A21\u5757\u65B0\u540D\u5B57\uFF08\u5F53\u524D\uFF1A${spec.name || spec.id}\uFF09`, spec.name || "");
    if (proposed === null) return;
    const name = proposed.trim();
    if (!name) {
      toast("\u6A21\u5757\u540D\u4E0D\u80FD\u4E3A\u7A7A", "error");
      return;
    }
    if (name === spec.name) return;
    const clash = findBlockNameClash(name, spec.id);
    if (clash) {
      toast(`\u6A21\u5757\u540D\u5DF2\u5B58\u5728\uFF1A\u300C${clash.name}\u300D\uFF0C\u8BF7\u6362\u4E00\u4E2A\u540D\u5B57`, "error", 3600);
      return;
    }
    const run = async (force) => {
      const body = await jsonRequest(
        `/api/blocks/${encodeURIComponent(spec.id)}/rename`,
        "POST",
        { name, force }
      );
      return body;
    };
    try {
      try {
        await run(false);
      } catch (error) {
        const message = error?.message || String(error);
        if (!/引用|存在/.test(message)) throw error;
        if (!window.confirm(`${message}

\u4ECD\u7136\u6539\u540D\uFF1F`)) return;
        await run(true);
      }
      await refreshBlocks();
      toast(`\u5DF2\u6539\u540D\u4E3A\u300C${name}\u300D`, "ok");
    } catch (error) {
      toast(`\u6539\u540D\u5931\u8D25\uFF1A${error?.message || error}`, "error", 4e3);
    }
  }
  async function deleteLibraryBlock(spec) {
    if (!window.confirm(
      `\u5220\u9664\u6A21\u5757\u300C${spec.name || spec.id}\u300D\uFF1F
\u5E93\u91CC\u5BF9\u5E94\u7684 .block \u6587\u4EF6\u4F1A\u88AB\u5220\u9664\uFF0C\u5DF2\u7ECF\u653E\u8FDB\u753B\u5E03\u7684\u5B9E\u4F8B\u4F1A\u53D8\u6210\u7F3A\u5931\u72B6\u6001\u3002`
    )) {
      return;
    }
    const run = async (force) => {
      const body = await jsonRequest(
        `/api/blocks/${encodeURIComponent(spec.id)}/delete`,
        "POST",
        { version: spec.version, force }
      );
      return body;
    };
    try {
      try {
        await run(false);
      } catch (error) {
        const message = error?.message || String(error);
        if (!/引用|存在/.test(message)) throw error;
        if (!window.confirm(`${message}

\u4ECD\u7136\u5220\u9664\uFF1F`)) return;
        await run(true);
      }
      await refreshBlocks();
      toast(`\u5DF2\u5220\u9664\u6A21\u5757\u300C${spec.name || spec.id}\u300D`, "ok");
    } catch (error) {
      toast(`\u5220\u9664\u5931\u8D25\uFF1A${error?.message || error}`, "error", 4e3);
    }
  }
  function initStatusToggles() {
    const bind = (id, key, label) => {
      const node = $(`#${id}`);
      if (!node) return;
      const sync = () => {
        const active = Boolean(state.ui?.[key]);
        node.classList.toggle("active", active);
        if (label) node.textContent = label(active);
      };
      node.addEventListener("click", () => {
        state.ui[key] = !state.ui[key];
        sync();
        markProjectDirty();
        requestDraw();
        toast(`${node.textContent}\uFF1A${state.ui[key] ? "\u5F00" : "\u5173"}`, "info", 1600);
      });
      sync();
    };
    bind("stGrid", "showGrid");
    bind("stSnap", "snap");
    bind("stSnapMark", "snapMarkers");
    bind("stOrtho", "circuitOrthogonal");
    bind("stDrawing", "drawingMode");
    const styleBtn = $("#stNodeStyle");
    if (styleBtn) {
      const labels = { circle: "\u8282\u70B9\xB7\u5706", dot: "\u8282\u70B9\xB7\u70B9", box: "\u8282\u70B9\xB7\u6846" };
      const order = ["circle", "dot", "box"];
      const sync = () => {
        styleBtn.textContent = labels[state.ui.nodeStyle || "circle"];
      };
      styleBtn.addEventListener("click", () => {
        const index = order.indexOf(state.ui.nodeStyle || "circle");
        state.ui.nodeStyle = order[(index + 1) % order.length];
        sync();
        markProjectDirty();
        requestDraw();
        toast(`\u8282\u70B9\u6837\u5F0F\uFF1A${styleBtn.textContent}`, "info", 1800);
      });
      sync();
    }
  }
  function applyPanelHidden(hidden, persist = true) {
    ui.main.classList.toggle("panel-hidden", hidden);
    ui.panel?.classList.toggle("collapsed", hidden);
    if (ui.panelHanger) {
      ui.panelHanger.textContent = hidden ? "\u2039" : "\u203A";
      ui.panelHanger.title = hidden ? "\u5C55\u5F00\u53F3\u4FA7\u9762\u677F" : "\u6536\u8D77\u53F3\u4FA7\u9762\u677F";
      ui.panelHanger.setAttribute("aria-expanded", hidden ? "false" : "true");
    }
    if (persist) {
      try {
        localStorage.setItem(SHELL_KEYS.panelCollapsed, hidden ? "1" : "0");
      } catch (error) {
      }
    }
    setTimeout(() => {
      syncChromeEdges();
      resizeGraph();
      resizeChart();
      resizePhase();
    }, 60);
  }
  function togglePanel() {
    applyPanelHidden(!ui.main.classList.contains("panel-hidden"));
  }
  function initPanelChrome() {
    let hidden = false;
    let width = 0;
    try {
      hidden = localStorage.getItem(SHELL_KEYS.panelCollapsed) === "1";
      width = Number(localStorage.getItem(SHELL_KEYS.panelWidth)) || 0;
    } catch (error) {
      hidden = false;
    }
    if (width >= 260 && width <= 720) ui.main.style.setProperty("--panel-w", `${Math.round(width)}px`);
    applyPanelHidden(hidden, false);
    ui.panelHanger?.addEventListener("click", togglePanel);
    const handle = ui.panelResize;
    if (!handle) return;
    let dragging = false;
    let startX = 0;
    let startWidth = 0;
    const panelVar = () => "--panel-w";
    const currentWidth = () => {
      const rect = ui.panel?.getBoundingClientRect();
      if (rect && rect.width > 0) return rect.width;
      const value = parseFloat(getComputedStyle(ui.main).getPropertyValue(panelVar()));
      return Number.isFinite(value) && value > 0 ? value : 388;
    };
    handle.addEventListener("pointerdown", (event) => {
      if (ui.main.classList.contains("panel-hidden")) return;
      dragging = true;
      startX = event.clientX;
      startWidth = currentWidth();
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add("panel-dragging");
      event.preventDefault();
    });
    handle.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const next = clamp(Math.round(startWidth - (event.clientX - startX)), 260, 720);
      ui.main.style.setProperty(panelVar(), `${next}px`);
      ui.main.style.setProperty("--panel-edge", `${next}px`);
    });
    const finish = (event) => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("panel-dragging");
      try {
        localStorage.setItem(SHELL_KEYS.panelWidth, String(Math.round(currentWidth())));
      } catch (error) {
      }
      syncChromeEdges();
      resizeGraph();
      resizeChart();
      resizePhase();
      if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }
  function initShell() {
    initMenus();
    initNetworkSidebar();
    initPanelChrome();
    updateInfoBar();
    requestAnimationFrame(syncChromeEdges);
  }
  function bindStaticEvents() {
    ui.exitBtn?.addEventListener("click", () => void shutdownApp());
    ui.runBtn.addEventListener("click", () => void control("toggle"));
    $("#btnStep").addEventListener("click", () => void control("step", 1));
    $("#btnReset").addEventListener("click", () => void control("reset"));
    $("#btnAdd").addEventListener("click", () => {
      const place = centerPlacement();
      openAddMenu(16, 88, place.x, place.y);
    });
    $("#btnLayout").addEventListener("click", () => void autoLayout());
    $("#btnFit").addEventListener("click", () => fitView(true));
    $("#btnZoomIn").addEventListener("click", () => zoomCenter(1.2));
    $("#btnZoomOut").addEventListener("click", () => zoomCenter(1 / 1.2));
    $("#btnClear").addEventListener("click", () => void clearScene());
    if (ui.workspaceSwitch) {
      $$("button[data-workspace]", ui.workspaceSwitch).forEach((buttonNode) => {
        buttonNode.addEventListener("click", () => void switchWorkspace(buttonNode.dataset.workspace));
      });
    }
    setWorkspaceButtons();
    $$(".panel-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const group = tab.dataset.group;
        switchTab(group === "inspect" ? "inspect" : defaultTabForGroup(group));
      });
    });
    $$("#panel .group-subnav").forEach((nav) => {
      nav.addEventListener("click", (event) => {
        const target = event.target.closest("button");
        if (!target) return;
        if (target.dataset.fnrole) {
          state.fnRole = target.dataset.fnrole;
          state.specKind = "";
          switchTab(target.dataset.fnrole === "edge" ? "edge-fn" : "node-fn");
        } else if (target.dataset.sub) {
          switchTab(target.dataset.sub);
        }
      });
    });
    setPanelGroup("inspect");
    setGroupSub("modules", "blocks");
    setGroupSub("analysis", "chart");
    setGroupSub("workbench", "wb-analysis");
    if (ui.vectorNode) {
      ui.vectorNode.addEventListener("change", () => {
        state.phaseNode = ui.vectorNode.value;
        state.phaseIndex = null;
        stopPhasePlay();
        drawPhase();
      });
    }
    if (ui.vectorTrail) {
      ui.vectorTrail.addEventListener("change", () => {
        const value = Number(ui.vectorTrail.value);
        if (!Number.isFinite(value)) return;
        state.phaseTrail = clamp(Math.round(value), 20, 1200);
        ui.vectorTrail.value = String(state.phaseTrail);
        drawPhase();
      });
    }
    if (ui.phasePlay) {
      ui.phasePlay.addEventListener("click", togglePhasePlay);
    }
    if (ui.phaseStep) {
      ui.phaseStep.addEventListener("click", () => {
        const total = phaseFrameCount();
        if (!total) return;
        stopPhasePlay();
        const current = state.phaseIndex == null ? total - 1 : state.phaseIndex;
        setPhaseIndex(current + 1 >= total ? 0 : current + 1);
      });
    }
    if (ui.phaseLoop) {
      ui.phaseLoop.addEventListener("change", () => {
        state.phaseLoop = Boolean(ui.phaseLoop.checked);
      });
    }
    if (ui.phaseExport) {
      ui.phaseExport.addEventListener("click", () => {
        const node = (state.scene?.nodes || []).find((item) => item.name === state.phaseNode);
        const stateKeys = node ? phaseStateKeys(node) : [];
        const keys = stateKeys.length >= 2 ? stateKeys.slice(0, 2) : node ? [`n:${node.name}:x`, `n:${node.name}:y`] : null;
        void exportAnalysisCsv(keys, "phase");
      });
    }
    if (ui.phasePlotkit) {
      ui.phasePlotkit.addEventListener("click", () => void sendPhaseToPlotKit());
    }
    if (ui.phaseFrame) {
      ui.phaseFrame.addEventListener("input", () => {
        stopPhasePlay();
        setPhaseIndex(Number(ui.phaseFrame.value));
      });
    }
    ui.chartWindow.addEventListener("change", () => {
      const value = Number(ui.chartWindow.value);
      if (!Number.isFinite(value) || value < 0.1 || value > 120) {
        toast("\u65F6\u95F4\u7A97\u5FC5\u987B\u5728 0.1\u2013120 s \u4E4B\u95F4", "error", 3e3);
        ui.chartWindow.value = String(state.chart.window);
        return;
      }
      state.chart.window = value;
      scheduleChartDraw();
    });
    ui.signalSearch.addEventListener("input", () => {
      state.chart.filter = ui.signalSearch.value;
      renderSignalList();
    });
    ui.btnClearChart.addEventListener("click", () => {
      state.frames = [];
      state.chart.hover = null;
      stopReplayTimer();
      state.replay.active = false;
      state.replay.index = 0;
      state.replay.recordingRevision = null;
      updateReplayUI();
      drawChart();
      toast("\u8F68\u8FF9\u5DF2\u6E05\u7A7A\uFF0C\u65B0\u7684\u91C7\u6837\u4F1A\u7EE7\u7EED\u7ED8\u5236", "ok", 2e3);
    });
    if (ui.chartTimeline) {
      ui.chartTimeline.addEventListener("input", () => {
        enterReplay(Number(ui.chartTimeline.value));
      });
    }
    if (ui.topTimeline) {
      ui.topTimeline.addEventListener("input", () => {
        enterReplay(Number(ui.topTimeline.value));
      });
      ui.topTimeline.addEventListener("dblclick", () => {
        leaveReplay();
        toast("\u5DF2\u56DE\u5230\u5B9E\u65F6\u5F55\u5236", "info", 1600);
      });
    }
    if (ui.btnReplay) {
      ui.btnReplay.addEventListener("click", () => toggleReplayPlayback());
    }
    try {
      const storedSpeed = Number(localStorage.getItem("netlab.replaySpeed"));
      if (Number.isFinite(storedSpeed) && storedSpeed >= 5 && storedSpeed <= 240) {
        state.replay.speed = storedSpeed;
      }
    } catch (error) {
    }
    if (ui.replaySpeed) {
      ui.replaySpeed.addEventListener("input", () => {
        state.replay.speed = clamp(Number(ui.replaySpeed.value) || 60, 5, 240);
        try {
          localStorage.setItem("netlab.replaySpeed", String(state.replay.speed));
        } catch (error) {
        }
        updateReplayUI();
      });
    }
    if (ui.btnPrecompute) {
      ui.btnPrecompute.addEventListener("click", async () => {
        const raw = window.prompt("\u9884\u8BA1\u7B97 0\u2192T \u7684\u65F6\u957F\uFF08\u79D2\uFF0C\u6700\u5927 120\uFF09", "5");
        if (raw === null) return;
        const duration = Number(raw);
        if (!Number.isFinite(duration) || duration <= 0 || duration > 120) {
          toast("\u9884\u8BA1\u7B97\u65F6\u957F\u5FC5\u987B\u5728 (0, 120] s \u5185", "error", 3e3);
          return;
        }
        try {
          toast(`\u6B63\u5728\u9884\u8BA1\u7B97 0\u2192${duration} s\u2026`, "info", 2400);
          const response = await api("/api/solve-window", {
            method: "POST",
            body: JSON.stringify({ duration }),
            timeoutMs: 18e4
          });
          leaveReplay();
          state.frames = [];
          state.cursor = 0;
          state.values.clear();
          state.nodeValues.clear();
          state.edgeValues.clear();
          state.sim = response.sim;
          state.replay.recordingRevision = state.scene?.revision ?? null;
          await pollLive();
          updateReplayUI();
          scheduleChartDraw();
          const result = response.result || {};
          if (result.error) toast(`\u9884\u8BA1\u7B97\u4E2D\u65AD\uFF1A${result.error}`, "error", 6e3);
          else toast(`\u9884\u8BA1\u7B97\u5B8C\u6210\uFF1A${result.steps} \u6B65 / ${result.frames} \u5E27`, "ok", 3e3);
        } catch (error) {
          toast(`\u9884\u8BA1\u7B97\u5931\u8D25\uFF1A${error.message}`, "error", 6e3);
        }
      });
    }
    if (ui.btnLive) {
      ui.btnLive.addEventListener("click", () => {
        leaveReplay();
        toast("\u5DF2\u56DE\u5230\u5B9E\u65F6\u5F55\u5236", "info", 1800);
      });
    }
    if (ui.btnResolve) {
      ui.btnResolve.addEventListener("click", async () => {
        if (!recordingStale()) return;
        leaveReplay();
        await control("reset");
        await control("run", void 0, { skipWarn: true });
        toast("\u573A\u666F\u5DF2\u4FEE\u6539\uFF0C\u65E7\u8BB0\u5F55\u6E05\u9664\u5E76\u91CD\u65B0\u6C42\u89E3", "ok", 2400);
      });
    }
    if (ui.chartLoop) {
      ui.chartLoop.addEventListener("change", () => {
        state.chart.loop = Boolean(ui.chartLoop.checked);
        toast(`\u5FAA\u73AF\u56DE\u653E\uFF1A${state.chart.loop ? "\u5F00" : "\u5173"}`, "info", 1600);
      });
    }
    updateReplayUI();
    chartCanvas.addEventListener("pointermove", (event) => {
      const rect = chartCanvas.getBoundingClientRect();
      state.chart.hover = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      };
      scheduleChartDraw();
    });
    chartCanvas.addEventListener("pointerleave", () => {
      state.chart.hover = null;
      scheduleChartDraw();
    });
    document.addEventListener("pointerdown", (event) => {
      if (event.target.closest(".popup")) return;
      closePopups();
    }, true);
    document.addEventListener("keydown", (event) => {
      if (state.shuttingDown) return;
      if (event.key === "Escape") {
        closePopups();
        if (state.wireTool) cancelWireTool();
        if (!ui.modal.classList.contains("hidden")) closeModal();
        return;
      }
      if (isFormTarget(event.target)) return;
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === "s" && event.altKey) {
          event.preventDefault();
          void saveProject(true);
        } else if (key === "s") {
          event.preventDefault();
          void saveProject(false);
        } else if (key === "e" && event.shiftKey) {
          event.preventDefault();
          if (state.workspace === "network") void exportScene();
          else toast("\u6709\u9650\u5143\u573A\u4E0D\u5BFC\u51FA JSON\uFF1B\u53EF\u5728\u300C\u573A\u300D\u9762\u677F\u91CD\u5EFA\u53C2\u6570", "info", 3e3);
        } else if (key === "z") {
          event.preventDefault();
          if (event.shiftKey) void redo();
          else void undo();
        } else if (key === "y") {
          event.preventDefault();
          void redo();
        } else if (key === "c") {
          event.preventDefault();
          copySelection(false);
        } else if (key === "x") {
          event.preventDefault();
          copySelection(true);
        } else if (key === "v") {
          event.preventDefault();
          void pasteClipboard();
        } else if (key === "a") {
          event.preventDefault();
          selectAll();
        }
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        void control("toggle");
      } else if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        void control("step", 1);
      } else if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        void control("reset");
      } else if (state.workspace === "network" && (event.key === "f" || event.key === "F")) {
        event.preventDefault();
        fitView(true);
      } else if (state.workspace === "network" && (event.key === "a" || event.key === "A")) {
        event.preventDefault();
        const place = centerPlacement();
        openAddMenu(state.canvasSize.w / 2, state.canvasSize.h / 2, place.x, place.y);
      } else if (state.workspace === "network" && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        void deleteSelection();
      } else if (state.workspace === "network" && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        zoomCenter(1.2);
      } else if (state.workspace === "network" && (event.key === "-" || event.key === "_")) {
        event.preventDefault();
        zoomCenter(1 / 1.2);
      } else if (event.key === "?") {
        event.preventDefault();
        showHelp();
      }
    });
    canvas.tabIndex = 0;
    canvas.addEventListener("focus", () => {
    });
  }
  async function boot() {
    await loadUiPrefs();
    initProject();
    initShell();
    initAppearanceControls();
    initSettingsWin();
    initGuide();
    initDocWin();
    initAnalWin();
    initPlotkitDataBar();
    initModuleWindow();
    initFloatingMenu();
    initShellKeys();
    bindStaticEvents();
    bindCanvas();
    resizeGraph();
    resizeChart();
    resizePhase();
    initInstruments();
    const observer = new ResizeObserver(() => {
      if (state.workspace === "network") resizeGraph();
      resizeChart();
      resizePhase();
      resizeInstrument();
    });
    observer.observe(stage);
    const chartWrap = $(".chart-wrap");
    if (chartWrap) observer.observe(chartWrap);
    const phaseWrap = $(".phase-wrap");
    if (phaseWrap) observer.observe(phaseWrap);
    $$(".scope-wrap").forEach((wrap) => observer.observe(wrap));
    window.addEventListener("resize", () => {
      syncChromeEdges();
      resizeGraph();
      resizeChart();
      resizePhase();
      resizeInstrument();
    });
    setInterval(() => {
      if (!ui.sessionClock) return;
      const now = /* @__PURE__ */ new Date();
      ui.sessionClock.textContent = `LOCAL SESSION \xB7 ${now.toLocaleTimeString("zh-CN", { hour12: false })}`;
    }, 1e3);
    requestAnimationFrame(animationLoop);
    try {
      const [catalog, snapshot] = await Promise.all([api("/api/catalog"), api("/api/state")]);
      state.catalog = catalog.catalog;
      state.templates = catalog.templates || [];
      state.mode = snapshot.scene?.mode || "signal";
      applySnapshot(snapshot);
      await fetchNetworks();
      await refreshBlocks();
      initBlockDragDrop();
      initStatusToggles();
      state.cursor = Math.max(0, Number(snapshot.sim?.cursor || 0) - 600);
      renderScenePanel();
      await ensureDocs();
      renderSignalList();
      renderInspector();
      updateModeUI();
      fitView();
      if (Number(snapshot.sim?.cursor || 0) > 0) await pollLive();
      state.pollTimer = setTimeout(pollLoop, 220);
      state.stateTimer = setInterval(() => {
        if (state.sim?.running) void refreshState(true);
      }, 8e3);
      state.booted = true;
      await maybeOfferRecovery();
      await ensureStoppedOnBoot();
      showGuide();
      if (!state.sim?.running) {
        toast("\u753B\u5E03\u5DF2\u5C31\u7EEA\uFF1A\u7A7A\u683C\u8FD0\u884C\uFF0C\u53CC\u51FB\u8282\u70B9\u7F16\u8F91\uFF0C\u4ECE\u53F3\u4FA7\u7AEF\u53E3\u62D6\u51FA\u8FDE\u7EBF", "info", 4200);
      }
    } catch (error) {
      showBanner(`\u65E0\u6CD5\u8FDE\u63A5\u540E\u7AEF\uFF1A${error.message}`);
      toast(`\u521D\u59CB\u5316\u5931\u8D25\uFF1A${error.message}`, "error", 9e3);
      renderScenePanel();
      renderInspector();
    }
  }
  window.__netlabDebug = {
    state,
    nodeRect,
    edgePathPoints,
    elementPins,
    devicePins,
    devicePinScreen,
    waypointHitAt,
    worldToScreen,
    screenToWorld
  };
  const ACCENT_SWATCHES = ["", "#9b7247", "#565c46", "#3f5d6b", "#8a4234", "#6b6257", "#7a5a33", "#5f7a52"];
  const PREF_CACHE_KEY = "netlab.ui.prefs";
  const PREF_DEFAULTS = {
    theme: "system",
    motion: "low",
    perf: "perf",
    accent: "",
    accentDark: "",
    fontScale: 12,
    density: "standard",
    surfaceTone: 0,
    radius: 0,
    lineWidth: 1,
    chartPalette: "theme"
  };
  const FONT_SCALES = [11, 12, 13, 14];
  const RADIUS_STEPS = [0, 2, 4];
  const LINE_STEPS = [1, 1.5];
  const CHART_MODES = ["theme", "high-contrast", "colorblind"];
  function activeAccent(theme, pal) {
    const pref = state.prefs || {};
    const custom = theme === "dark" ? pref.accentDark : pref.accent;
    return typeof custom === "string" && custom ? custom : pal.accent;
  }
  function computeRuntimeOverride(theme) {
    const base = THEME_TOKENS[theme];
    const pref = state.prefs || {};
    const override = {};
    const accent = activeAccent(theme, base);
    if (accent && accent !== base.accent) {
      override.accent = accent;
      override.accentSoft = mixHex(base.paper, accent, 0.28);
    }
    const tone = clamp(Number(pref.surfaceTone) || 0, -1, 1);
    if (tone !== 0) {
      const anchor = tone > 0 ? base.toneWhite : base.toneBlack;
      if (anchor) {
        const amount = Math.abs(tone) * 0.16;
        for (const key of ["paper", "panel", "surface", "paper3"]) {
          if (base[key]) override[key] = mixHex(base[key], anchor, amount);
        }
      }
    }
    return override;
  }
  function applyAppearance() {
    const root = document.documentElement;
    const pref = state.prefs || {};
    const theme = resolveTheme(pref.theme || "system");
    root.dataset.theme = theme;
    root.dataset.motion = pref.motion || "low";
    root.dataset.perf = pref.perf || "perf";
    const fontScale = FONT_SCALES.includes(Number(pref.fontScale)) ? Number(pref.fontScale) : PREF_DEFAULTS.fontScale;
    root.dataset.font = String(fontScale);
    const density = ["compact", "standard", "loose"].includes(String(pref.density)) ? String(pref.density) : PREF_DEFAULTS.density;
    root.dataset.density = density;
    const lineWidth = LINE_STEPS.includes(Number(pref.lineWidth)) ? Number(pref.lineWidth) : PREF_DEFAULTS.lineWidth;
    root.dataset.line = String(lineWidth);
    const chartMode = CHART_MODES.includes(String(pref.chartPalette)) ? String(pref.chartPalette) : PREF_DEFAULTS.chartPalette;
    root.dataset.chart = chartMode;
    const radius = RADIUS_STEPS.includes(Number(pref.radius)) ? Number(pref.radius) : PREF_DEFAULTS.radius;
    root.style.setProperty("--radius", `${radius}px`);
    const pal = THEME_TOKENS[theme];
    const override = computeRuntimeOverride(theme);
    setRuntimeOverride(override);
    const accent = override.accent || pal.accent;
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent-rgb", hexToRgbString(accent));
    root.style.setProperty("--accent-soft", override.accentSoft || mixHex(pal.paper, accent, 0.28));
    root.style.setProperty("--accent-2", pal.accent2);
    root.style.setProperty("--green", pal.green);
    root.style.setProperty("--paper", override.paper || pal.paper);
    root.style.setProperty("--paper-2", override.panel || pal.panel);
    root.style.setProperty("--paper-3", override.surface || pal.surface);
    state.palette = pal;
    if (ui.infoBar) ui.infoBar.style.display = pref.infobar === false ? "none" : "";
    syncPrefControls();
    writePrefCache();
    if (state.booted) {
      requestDraw();
      scheduleChartDraw();
      drawPhase();
      if (ui.moduleWin && !ui.moduleWin.hidden) drawModulePreview();
    }
  }
  function resolveTheme(pref) {
    if (pref === "light" || pref === "dark") return pref;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function readPrefCache() {
    try {
      return JSON.parse(window.localStorage.getItem(PREF_CACHE_KEY) || "null");
    } catch (error) {
      return null;
    }
  }
  function writePrefCache() {
    try {
      window.localStorage.setItem(PREF_CACHE_KEY, JSON.stringify(state.prefs || {}));
    } catch (error) {
    }
  }
  async function loadUiPrefs() {
    const cached = readPrefCache();
    if (cached && typeof cached === "object") state.prefs = { ...state.prefs, ...cached };
    state.prefs.guide = "always";
    applyAppearance();
    try {
      const response = await jsonRequest("/api/settings", "GET");
      const stored = response.settings || {};
      state.settings = stored;
      state.prefs.theme = ["system", "light", "dark"].includes(stored.theme) ? stored.theme : "system";
      state.prefs.motion = ["off", "low", "med", "high"].includes(stored.ui_motion) ? stored.ui_motion : "low";
      state.prefs.perf = ["perf", "balanced", "quality"].includes(stored.ui_perf) ? stored.ui_perf : "perf";
      state.prefs.accent = typeof stored.ui_accent === "string" ? stored.ui_accent : "";
      state.prefs.guide = "always";
      if (typeof stored.autosave_enabled === "boolean") state.project.autosave = stored.autosave_enabled;
      const interval = Number(stored.autosave_interval_seconds);
      if (Number.isFinite(interval) && interval >= 5) state.project.autosaveInterval = interval * 1e3;
      applyAppearance();
    } catch (error) {
    }
    state.uiReady = true;
  }
  const PREF_SETTING_KEYS = { theme: "theme", motion: "ui_motion", perf: "ui_perf", accent: "ui_accent" };
  async function setPref(key, value) {
    state.prefs[key] = value;
    applyAppearance();
    const settingKey = PREF_SETTING_KEYS[key];
    if (!settingKey) return;
    try {
      const response = await jsonRequest("/api/settings", "PATCH", { [settingKey]: value });
      state.settings = response.settings || state.settings;
    } catch (error) {
      toast(`\u504F\u597D\u4FDD\u5B58\u5931\u8D25\uFF1A${error.message}`, "warn", 3200);
    }
  }
  function syncPrefControls() {
    const prefs = state.prefs || {};
    const paint = (host, value) => {
      if (!host) return;
      $$("button[data-value]", host).forEach((node) => {
        const on = node.dataset.value === value;
        node.classList.toggle("active", on);
        node.setAttribute("aria-pressed", on ? "true" : "false");
      });
    };
    paint($("#segTheme"), prefs.theme || "system");
    paint($("#segMotion"), prefs.motion || "low");
    paint($("#segPerf"), prefs.perf || "perf");
    paint($("#segInfoBar"), prefs.infobar === false ? "off" : "on");
    paint($("#segSheet"), String(state.ui?.drawingSheet || "A3"));
    paint($("#segDrawLabels"), state.ui?.drawingLabels ? "on" : "off");
    paint($("#segDrawPage"), String(state.ui?.drawingPage || 1));
    paint($("#segAutosave"), state.project.autosave ? "on" : "off");
    if ($("#selAutosaveInterval")) $("#selAutosaveInterval").value = String(Math.round(state.project.autosaveInterval / 1e3));
    paint($("#segFont"), String(prefs.fontScale ?? PREF_DEFAULTS.fontScale));
    paint($("#segDensity"), String(prefs.density ?? PREF_DEFAULTS.density));
    paint($("#segRadius"), String(prefs.radius ?? PREF_DEFAULTS.radius));
    paint($("#segLine"), String(prefs.lineWidth ?? PREF_DEFAULTS.lineWidth));
    paint($("#segChart"), String(prefs.chartPalette ?? PREF_DEFAULTS.chartPalette));
    const toneInput = $("#rngTone");
    if (toneInput) {
      const tone = Number(prefs.surfaceTone ?? 0);
      if (document.activeElement !== toneInput) toneInput.value = String(tone);
      const toneLabel = $("#rngToneVal");
      if (toneLabel) toneLabel.textContent = tone === 0 ? "0" : tone > 0 ? `+${tone.toFixed(2)}` : tone.toFixed(2);
    }
    const swatches = $("#accentSwatches");
    if (swatches) {
      const activeVal = themeKey() === "dark" ? prefs.accentDark || "" : prefs.accent || "";
      const preset = ACCENT_SWATCHES.includes(activeVal);
      $$("button", swatches).forEach((node) => {
        const val = node.dataset.value || "";
        const on = val === "__custom__" ? !preset && !!activeVal : val === activeVal;
        node.classList.toggle("active", on);
        node.setAttribute("aria-pressed", on ? "true" : "false");
        if (val === "__custom__") node.style.background = activeVal && !preset ? activeVal : "";
      });
    }
  }
  function initAppearanceControls() {
    $("#segTheme")?.addEventListener("click", (event) => {
      const target = event.target.closest("button[data-value]");
      if (target) void setPref("theme", target.dataset.value);
    });
    $("#segMotion")?.addEventListener("click", (event) => {
      const target = event.target.closest("button[data-value]");
      if (target) void setPref("motion", target.dataset.value);
    });
    $("#segPerf")?.addEventListener("click", (event) => {
      const target = event.target.closest("button[data-value]");
      if (target) void setPref("perf", target.dataset.value);
    });
    $("#segInfoBar")?.addEventListener("click", (event) => {
      const target = event.target.closest("button[data-value]");
      if (!target) return;
      state.prefs.infobar = target.dataset.value !== "off";
      applyAppearance();
    });
    const bindDrawingSeg = (id, apply) => {
      $(id)?.addEventListener("click", (event) => {
        const target = event.target.closest("button[data-value]");
        if (!target) return;
        apply(String(target.dataset.value || ""));
        markProjectDirty();
        requestDraw();
        syncPrefControls();
      });
    };
    bindDrawingSeg("#segSheet", (value) => {
      state.ui.drawingSheet = value;
    });
    bindDrawingSeg("#segDrawLabels", (value) => {
      state.ui.drawingLabels = value === "on";
    });
    bindDrawingSeg("#segDrawPage", (value) => {
      state.ui.drawingPage = Math.max(1, Math.min(9, Number(value) || 1));
    });
    $("#segAutosave")?.addEventListener("click", (event) => {
      const target = event.target.closest("button[data-value]");
      if (!target) return;
      void saveAutosaveSetting({ autosave_enabled: target.dataset.value === "on" });
    });
    $("#selAutosaveInterval")?.addEventListener("change", () => {
      const seconds = Number($("#selAutosaveInterval").value);
      if (Number.isFinite(seconds)) void saveAutosaveSetting({ autosave_interval_seconds: seconds });
    });
    const bindAppearSeg = (id, key, numeric) => {
      $(id)?.addEventListener("click", (event) => {
        const target = event.target.closest("button[data-value]");
        if (!target) return;
        const raw = String(target.dataset.value || "");
        void setPref(key, numeric ? Number(raw) : raw);
      });
    };
    bindAppearSeg("#segFont", "fontScale", true);
    bindAppearSeg("#segDensity", "density", false);
    bindAppearSeg("#segRadius", "radius", true);
    bindAppearSeg("#segLine", "lineWidth", true);
    bindAppearSeg("#segChart", "chartPalette", false);
    $("#rngTone")?.addEventListener("input", () => {
      const input = $("#rngTone");
      state.prefs.surfaceTone = Number(input.value) || 0;
      applyAppearance();
      const toneLabel = $("#rngToneVal");
      const tone = Number(state.prefs.surfaceTone);
      if (toneLabel) toneLabel.textContent = tone === 0 ? "0" : tone > 0 ? `+${tone.toFixed(2)}` : tone.toFixed(2);
    });
    $("#rngTone")?.addEventListener("change", () => {
      writePrefCache();
    });
    const swatches = $("#accentSwatches");
    if (swatches) {
      for (const value of ACCENT_SWATCHES) {
        const node = button(value ? "" : "A", "swatch", () => {
          if (themeKey() === "dark") void setPref("accentDark", value);
          else void setPref("accent", value);
        });
        node.dataset.value = value;
        node.title = value ? `\u5F3A\u8C03\u8272 ${value}` : "\u9ED8\u8BA4\u5F3A\u8C03\u8272\uFF08\u8DDF\u968F\u4E3B\u9898\uFF09";
        if (!value) node.classList.add("default");
        node.style.background = value || "linear-gradient(135deg, #9b7247 50%, #eae5e1 50%)";
        node.dataset.swatch = value || "default";
        swatches.appendChild(node);
      }
      const custom = button("", "swatch swatch-custom");
      custom.dataset.value = "__custom__";
      custom.title = "\u81EA\u5B9A\u4E49\u5F3A\u8C03\u8272";
      custom.addEventListener("click", () => {
        const dark = themeKey() === "dark";
        const current = (dark ? state.prefs.accentDark : state.prefs.accent) || "";
        const seed = current || (dark ? CANVAS_DARK.accent : CANVAS_LIGHT.accent);
        openIroColorPopover(custom, seed, (hex) => {
          if (dark) void setPref("accentDark", hex);
          else void setPref("accent", hex);
        });
      });
      swatches.appendChild(custom);
    }
    $("#btnResetAppearance")?.addEventListener("click", () => void resetAppearance());
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if ((state.prefs.theme || "system") === "system") applyAppearance();
    });
  }
  async function resetAppearance() {
    state.prefs = { ...state.prefs, ...PREF_DEFAULTS };
    applyAppearance();
    try {
      const response = await jsonRequest("/api/settings", "PATCH", {
        theme: PREF_DEFAULTS.theme,
        ui_motion: PREF_DEFAULTS.motion,
        ui_perf: PREF_DEFAULTS.perf,
        ui_accent: PREF_DEFAULTS.accent
      });
      state.settings = response.settings || state.settings;
      toast("\u5916\u89C2\u5DF2\u6062\u590D\u9ED8\u8BA4", "ok", 2e3);
    } catch (error) {
      toast(`\u5916\u89C2\u5DF2\u6062\u590D\u9ED8\u8BA4\uFF08\u672C\u5730\uFF09\uFF1B\u540E\u7AEF\u672A\u540C\u6B65\uFF1A${error.message}`, "warn", 3200);
    }
  }
  async function saveAutosaveSetting(patch) {
    state.project.autosave = patch.autosave_enabled !== void 0 ? patch.autosave_enabled : state.project.autosave;
    if (patch.autosave_interval_seconds) state.project.autosaveInterval = patch.autosave_interval_seconds * 1e3;
    syncPrefControls();
    try {
      const response = await jsonRequest("/api/settings", "PATCH", patch);
      state.settings = response.settings || state.settings;
      toast(patch.autosave_enabled === false ? "\u81EA\u52A8\u4FDD\u5B58\u5DF2\u5173\u95ED" : patch.autosave_enabled ? "\u81EA\u52A8\u4FDD\u5B58\u5DF2\u5F00\u542F" : "\u5FEB\u7167\u95F4\u9694\u5DF2\u66F4\u65B0", "ok", 2e3);
    } catch (error) {
      toast(`\u8BBE\u7F6E\u4FDD\u5B58\u5931\u8D25\uFF1A${error.message}`, "error", 3600);
    }
  }
  function formatQualityNumber(value, unit = "") {
    if (value === null || value === void 0) return "\u2014";
    if (!Number.isFinite(value)) return String(value);
    return `${value.toLocaleString("zh-CN", { maximumFractionDigits: 6 })}${unit}`;
  }
  function setQualityText(selector, text) {
    const node = $(selector);
    if (node) node.textContent = text;
  }
  async function refreshTelemetryQuality() {
    const status = $("#diagStatus");
    if (status) status.textContent = "\u8BFB\u53D6\u4E2D\u2026";
    try {
      const payload = await api("/api/diagnostics/telemetry");
      const quality = payload?.telemetry || {};
      const assumptions = (quality.assumptions || []).filter((item) => item.trim().length > 0);
      const missing = [];
      if (quality.sample_dt === null || quality.sample_dt === void 0) missing.push("sample_dt");
      if (quality.interp_error_bound === null || quality.interp_error_bound === void 0) missing.push("interp_error_bound");
      if (quality.delay_bound === null || quality.delay_bound === void 0) missing.push("delay_bound");
      setQualityText("#diagSampleDt", formatQualityNumber(quality.sample_dt, " s"));
      setQualityText(
        "#diagQuantBits",
        quality.quant_bits === null || quality.quant_bits === void 0 ? "\u672A\u542F\u7528\u91CF\u5316" : `${quality.quant_bits} bit`
      );
      setQualityText(
        "#diagInterpBound",
        quality.interp_error_bound === null || quality.interp_error_bound === void 0 ? "\u672A\u58F0\u660E" : `${formatQualityNumber(quality.interp_error_bound)}${quality.interp_error_bound_method ? `\uFF08${quality.interp_error_bound_method}\uFF09` : ""}`
      );
      setQualityText("#diagFifoDepth", formatQualityNumber(quality.fifo_depth, " \u5E27"));
      setQualityText(
        "#diagDelayBound",
        quality.delay_bound === null || quality.delay_bound === void 0 ? "\u672A\u58F0\u660E" : `${formatQualityNumber(quality.delay_bound, " s")}${quality.delay_bound_method ? `\uFF08${quality.delay_bound_method}\uFF09` : ""}`
      );
      setQualityText("#diagAssumptions", assumptions.length ? `\u5047\u8BBE\uFF1A${assumptions.join("\uFF1B")}` : "\u5047\u8BBE\uFF1A\u2014");
      if (status) {
        status.textContent = missing.length ? `\u4E0D\u5B8C\u6574\uFF1A\u7F3A\u5C11 ${missing.join("\u3001")}` : "\u5B8C\u6574\uFF08\u53EF\u7528\uFF09";
        status.dataset.state = missing.length ? "partial" : "ok";
      }
    } catch (error) {
      if (status) {
        status.textContent = `\u8BFB\u53D6\u5931\u8D25\uFF1A${error.message}`;
        status.dataset.state = "error";
      }
    }
  }
  function openSettings(pane = "project") {
    if (!ui.settingsWin) return;
    ui.settingsWin.hidden = false;
    ui.settingsWin.classList.remove("minimized");
    setSettingsPane(pane);
    if (!ui.scenePane || !ui.scenePane.dataset.ready) renderScenePanel();
    placeFloatWindow(ui.settingsWin, "settingsGeo");
    raiseFloatWindow(ui.settingsWin);
  }
  function closeSettings() {
    if (!ui.settingsWin) return;
    ui.settingsWin.classList.remove("minimized", "maximized");
    ui.settingsWin.hidden = true;
  }
  function setSettingsPane(pane) {
    $$("#settingsWin .setwin-nav button[data-pane]").forEach((node) => {
      node.classList.toggle("active", node.dataset.pane === pane);
    });
    $$("#settingsWin .setwin-pane").forEach((node) => {
      node.classList.toggle("active", node.dataset.pane === pane);
    });
    const hint = $("#setWinHint");
    if (hint) {
      const hints = {
        project: "SETTINGS \xB7 \u5DE5\u7A0B\u7EA7\uFF0C\u968F .netlab \u4FDD\u5B58",
        view: "SETTINGS \xB7 \u5168\u5C40\u5916\u89C2\u504F\u597D",
        interact: "SETTINGS \xB7 \u5168\u5C40\u4EA4\u4E92\u504F\u597D",
        diag: "SETTINGS \xB7 \u53EA\u8BFB\u8BCA\u65AD\uFF08P5 \u8BEF\u5DEE\u5408\u540C\uFF09"
      };
      hint.textContent = hints[pane] || "";
    }
    const main = ui.settingsWin?.querySelector(".setwin-main");
    if (main) main.scrollTop = 0;
    if (pane === "diag") void refreshTelemetryQuality();
  }
  function initSettingsWin() {
    $("#settingsWin .setwin-nav")?.addEventListener("click", (event) => {
      const target = event.target.closest("button[data-pane]");
      if (target) setSettingsPane(target.dataset.pane);
    });
    $("#btnDiagRefresh")?.addEventListener("click", () => void refreshTelemetryQuality());
    ui.settingsClose?.addEventListener("click", closeSettings);
    $$("#settingsWin [data-doc]").forEach((node) => {
      node.addEventListener("click", () => openDoc(node.dataset.doc));
    });
    initFloatWindow(ui.settingsWin, "settingsGeo", { minWidth: 520, minHeight: 380 });
  }
  function showGuide(force = false) {
    if (!ui.guide) return;
    void force;
    state.prefs.guide = "always";
    state.guideShown = true;
    document.body.classList.add("guide-open");
    ui.guide.hidden = false;
    selectGuideMode(state.guideMode || state.mode || "signal");
    syncPrefControls();
  }
  function hideGuide() {
    if (!ui.guide) return;
    ui.guide.hidden = true;
    document.body.classList.remove("guide-open");
  }
  function selectGuideMode(mode) {
    const picked = ["signal", "circuit", "vector"].includes(mode) ? mode : "signal";
    state.guideMode = picked;
    $$(".guide-mode").forEach((node) => {
      const on = node.dataset.mode === picked;
      node.classList.toggle("selected", on);
      node.setAttribute("aria-checked", on ? "true" : "false");
    });
  }
  async function enterGuideScene() {
    const mode = state.guideMode || "signal";
    hideGuide();
    if (mode !== state.mode) {
      await switchMode(mode, { skipConfirm: true });
    } else {
      toast(`${modeLabel(mode)}\u573A\u666F\u5DF2\u5C31\u7EEA \xB7 \u7A7A\u683C\u8FD0\u884C`, "ok", 2600);
    }
  }
  function initGuide() {
    if (!ui.guide) return;
    $$(".guide-mode").forEach((node) => {
      node.addEventListener("click", () => selectGuideMode(node.dataset.mode));
    });
    (() => {
      const handle = document.querySelector("#guide .guide-top");
      if (!handle) return;
      const desktop = window.netlabDesktop;
      if (!desktop || typeof desktop.attachWindowDrag !== "function") return;
      handle.style.cursor = "grab";
      desktop.attachWindowDrag(handle, {
        dblclick: false,
        onStart: () => {
          handle.style.cursor = "grabbing";
        },
        onEnd: () => {
          handle.style.cursor = "grab";
        }
      });
    })();
    ui.guideEnter?.addEventListener("click", () => void enterGuideScene());
    ui.guideClose?.addEventListener("click", hideGuide);
    ui.guideDocs?.addEventListener("click", () => {
      openDoc("quickstart");
    });
    ui.guideDemo?.addEventListener("click", () => {
      hideGuide();
      void loadTemplate("signal_chain", "\u4FE1\u53F7\u94FE\u793A\u4F8B");
    });
    ui.guideOpenProject?.addEventListener("click", () => void openProject());
    ui.guideSettings?.addEventListener("click", () => openSettings("view"));
    $$("#guide [data-doc]").forEach((node) => {
      node.addEventListener("click", (event) => {
        event.stopPropagation();
        openDoc(node.dataset.doc);
      });
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !ui.guide.hidden && !event.target.closest("input, textarea, select")) {
        event.preventDefault();
        void enterGuideScene();
      }
    });
  }
  async function ensureDocs() {
    if (state.docs && state.docs.length) return state.docs;
    try {
      const response = await jsonRequest("/api/docs", "GET");
      state.docs = Array.isArray(response.docs) ? response.docs : [];
    } catch (error) {
      state.docs = [];
      toast(`\u6587\u6863\u8BFB\u53D6\u5931\u8D25\uFF1A${error.message}`, "warn", 4200);
    }
    return state.docs;
  }
  function docBySlug(slug) {
    return (state.docs || []).find((doc) => doc.slug === slug) || null;
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
      if (typeof setStatusHint === "function") setStatusHint("\u7ED8\u56FE\u5DF2\u5D4C\u5728\u53F3\u4FA7\u9762\u677F \xB7 \u70B9\u300C\u6D6E\u51FA\u7A97\u53E3\u300D\u53EF\u62D6\u5230\u753B\u5E03\u4E0A");
    } else if (mode === "float") {
      if (host) host.hidden = true;
      if (floatBody) floatBody.appendChild(frame);
      openPlotkit();
    } else if (mode === "popup") {
      const url = plotkitFrameUrl({ embed: "1" });
      const popup = window.open(url, "netlab-plotkit", "width=1180,height=820");
      if (popup) {
        toast("\u5DF2\u5728\u72EC\u7ACB\u7A97\u53E3\u6253\u5F00\u7ED8\u56FE", "ok", 2400);
        if (typeof setStatusHint === "function") setStatusHint("\u72EC\u7ACB\u7ED8\u56FE\u7A97\u53E3 \xB7 \u6570\u636E\u4E0E\u4E3B\u754C\u9762\u540C\u6E90");
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
  async function openDoc(slug = "quickstart") {
    if (!ui.docWin) return;
    await ensureDocs();
    const doc = docBySlug(slug) || state.docs[0];
    if (!doc) {
      toast("\u6587\u6863\u76EE\u5F55\u4E3A\u7A7A\uFF0C\u8BF7\u68C0\u67E5\u540E\u7AEF\u5B89\u88C5", "warn", 4e3);
      return;
    }
    state.docSlug = doc.slug;
    ui.docWin.hidden = false;
    ui.docWin.classList.remove("min");
    document.body.classList.add("doc-open");
    ui.docTitle.textContent = `NETLAB \xB7 ${doc.title}`;
    renderDocNav();
    renderDocBody(doc);
    ui.docContent.parentElement.scrollTop = 0;
    ui.docSearch.value = "";
    ui.docResults.replaceChildren();
    placeDocWindow();
  }
  function closeDoc() {
    if (!ui.docWin) return;
    ui.docWin.hidden = true;
    ui.docWin.classList.remove("minimized", "maximized");
    document.body.classList.remove("doc-open");
    state.docGeo = null;
    if (state.guideShown && !ui.guide.hidden) syncPrefControls();
  }
  function renderDocNav() {
    if (!ui.docNav) return;
    ui.docNav.replaceChildren();
    for (const doc of state.docs) {
      const node = button(doc.title, "docnav-item", () => {
        state.docSlug = doc.slug;
        ui.docTitle.textContent = `NETLAB \xB7 ${doc.title}`;
        renderDocNav();
        renderDocBody(doc);
        ui.docResults.replaceChildren();
        ui.docSearch.value = "";
      });
      node.classList.toggle("active", doc.slug === state.docSlug);
      ui.docNav.appendChild(node);
    }
  }
  function renderDocBody(doc) {
    if (!ui.docContent) return;
    const fragment = renderMarkdown(doc.text || "");
    ui.docContent.replaceChildren(fragment);
  }
  function renderInline(text, target) {
    const source = String(text || "");
    const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
    let cursor = 0;
    let match;
    while (match = pattern.exec(source)) {
      if (match.index > cursor) target.appendChild(document.createTextNode(source.slice(cursor, match.index)));
      const token = match[0];
      if (token.startsWith("**")) {
        target.appendChild(el("b", null, token.slice(2, -2)));
      } else if (token.startsWith("`")) {
        target.appendChild(el("code", null, token.slice(1, -1)));
      } else {
        const label = token.slice(1, token.indexOf("]"));
        target.appendChild(el("span", "doc-link", label));
      }
      cursor = match.index + token.length;
    }
    if (cursor < source.length) target.appendChild(document.createTextNode(source.slice(cursor)));
    return target;
  }
  function renderMarkdown(text) {
    const fragment = document.createDocumentFragment();
    const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
    let index = 0;
    let blockId = 0;
    while (index < lines.length) {
      const line = lines[index];
      const fence = line.match(/^```(\w*)\s*$/);
      if (fence) {
        const code = [];
        index += 1;
        while (index < lines.length && !/^```\s*$/.test(lines[index])) {
          code.push(lines[index]);
          index += 1;
        }
        index += 1;
        const pre = el("pre", "doc-code");
        pre.textContent = code.join("\n");
        fragment.appendChild(pre);
        continue;
      }
      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        const level = heading[1].length;
        const node = el(level === 1 ? "h1" : level === 2 ? "h2" : "h3", "doc-h");
        node.id = `doc-h-${blockId++}`;
        renderInline(heading[2], node);
        fragment.appendChild(node);
        index += 1;
        continue;
      }
      if (/^\s*[-*]\s+/.test(line)) {
        const list = el("ul", "doc-list");
        while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
          const item = el("li");
          renderInline(lines[index].replace(/^\s*[-*]\s+/, ""), item);
          list.appendChild(item);
          index += 1;
        }
        fragment.appendChild(list);
        continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) {
        const list = el("ol", "doc-list");
        while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
          const item = el("li");
          renderInline(lines[index].replace(/^\s*\d+\.\s+/, ""), item);
          list.appendChild(item);
          index += 1;
        }
        fragment.appendChild(list);
        continue;
      }
      if (/^\s*>\s?/.test(line)) {
        const quote = el("blockquote", "doc-quote");
        while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
          renderInline(lines[index].replace(/^\s*>\s?/, ""), quote);
          quote.appendChild(document.createElement("br"));
          index += 1;
        }
        fragment.appendChild(quote);
        continue;
      }
      if (!line.trim()) {
        index += 1;
        continue;
      }
      const paragraph = el("p", "doc-p");
      const parts = [line];
      index += 1;
      while (index < lines.length && lines[index].trim() && !/^(#{1,4}\s|```|\s*[-*]\s|\s*\d+\.\s|>)/.test(lines[index])) {
        parts.push(lines[index]);
        index += 1;
      }
      renderInline(parts.join(" "), paragraph);
      fragment.appendChild(paragraph);
    }
    return fragment;
  }
  let docSearchSeq = 0;
  async function searchDocs(query) {
    if (!ui.docResults) return;
    const text = String(query || "").trim().toLowerCase();
    const seq = ++docSearchSeq;
    ui.docResults.replaceChildren();
    if (!text) {
      ui.docMain.classList.remove("searching");
      return;
    }
    ui.docMain.classList.add("searching");
    const hits = [];
    for (const doc of state.docs) {
      const blocks = String(doc.text || "").split(/\n{2,}/);
      for (const block of blocks) {
        if (block.toLowerCase().includes(text)) {
          hits.push({
            slug: doc.slug,
            title: doc.title,
            snippet: block.replace(/[#>*`]/g, " ").replace(/\s+/g, " ").trim().slice(0, 150)
          });
          break;
        }
      }
    }
    let extra = [];
    try {
      const response = await api(`/api/help/search?q=${encodeURIComponent(text)}&limit=12`);
      extra = (response?.items || []).filter((item) => item.kind !== "doc");
    } catch {
      extra = [];
    }
    if (seq !== docSearchSeq) return;
    if (!hits.length && !extra.length) {
      ui.docResults.appendChild(div("doc-empty", "\u6CA1\u6709\u5339\u914D\u7684\u6BB5\u843D\uFF1B\u8BD5\u8BD5\u300C\u8282\u70B9\u300D\u300C\u6C42\u89E3\u5668\u300D\u300C\u5FEB\u6377\u952E\u300D\u7B49\u5173\u952E\u8BCD\u3002"));
      return;
    }
    if (hits.length) {
      ui.docResults.appendChild(el("div", "doc-sec", `\u6587\u6863\u6BB5\u843D \xB7 ${hits.length}`));
    }
    for (const hit of hits) {
      const node = button("", "doc-hit", () => {
        void openDoc(hit.slug);
        ui.docSearch.value = query;
        void searchDocs(query);
      });
      node.appendChild(el("b", null, hit.title));
      node.appendChild(el("span", null, hit.snippet));
      ui.docResults.appendChild(node);
    }
    if (extra.length) {
      const order = ["element", "circuit_node", "compute", "method", "template", "doc"];
      const buckets = /* @__PURE__ */ new Map();
      for (const item of extra) {
        const key = String(item.kind || "other");
        if (!buckets.has(key)) {
          buckets.set(key, { label: String(item.kind_label || key), items: [] });
        }
        buckets.get(key).items.push(item);
      }
      const keys = [
        ...order.filter((key) => buckets.has(key)),
        ...[...buckets.keys()].filter((key) => !order.includes(key))
      ];
      for (const key of keys) {
        const bucket = buckets.get(key);
        ui.docResults.appendChild(
          el("div", "doc-sec", `${bucket.label} \xB7 ${bucket.items.length}`)
        );
        for (const item of bucket.items) {
          const node = button("", "doc-hit", () => {
            if (item.kind === "template") {
              closeDoc();
              void loadTemplate(item.ref || "", item.title || "");
            } else if (item.kind === "doc" && item.ref) {
              window.open(
                `/api/help/doc?path=${encodeURIComponent(item.ref)}&line=${Number(item.line) || 1}`,
                "_blank",
                "noopener"
              );
            } else {
              toast(`${item.title}\uFF1A${item.text || "\u65E0\u66F4\u591A\u8BF4\u660E"}`, "info", 4200);
            }
          });
          const head = el("b", null, item.title || item.ref || "");
          const badge = el("i", "doc-kind", item.kind_label || item.kind || "");
          head.appendChild(badge);
          node.appendChild(head);
          node.appendChild(el("span", null, item.text || item.subtitle || ""));
          ui.docResults.appendChild(node);
          node.title = `${item.title} \xB7 ${item.subtitle}`;
        }
      }
    }
  }
  function analEscape(text) {
    return String(text ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
  }
  function analNum(value, digits = 6) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "\u2014";
    const abs = Math.abs(num);
    if (abs !== 0 && (abs < 1e-4 || abs >= 1e5)) return num.toExponential(3);
    return String(Number(num.toFixed(digits)));
  }
  function analToken(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (value || "").trim() || fallback;
  }
  function analysisWarn() {
    toast("\u5206\u6790\u4F1A\u57FA\u4E8E\u5F53\u524D\u573A\u666F\u91CD\u65B0\u6C42\u89E3\uFF0C\u671F\u95F4\u5B9E\u65F6\u64AD\u653E\u4F1A\u6682\u505C\uFF1B\u53EF\u968F\u65F6\u5173\u95ED\u5206\u6790\u7A97\u3002", "warn", 4200);
  }
  function openAnalysis(tab = "op") {
    const win = $("#analWin");
    if (!win) return;
    if ((state.scene?.mode || state.mode) !== "circuit") {
      toast("DC \u5DE5\u4F5C\u70B9 / AC \u626B\u9891\u53EA\u5728\u7535\u8DEF\u6A21\u5F0F\u4E0B\u53EF\u7528", "error", 4e3);
      return;
    }
    win.hidden = false;
    raiseFloatWindow(win);
    fillAcSources();
    selectAnalTab(tab);
  }
  function closeAnalysis() {
    const win = $("#analWin");
    if (win) win.hidden = true;
  }
  function selectAnalTab(tab) {
    for (const btn of $$(".anal-tab")) {
      btn.classList.toggle("active", btn.dataset.anal === tab);
    }
    for (const pane of $$(".anal-pane")) {
      pane.hidden = pane.dataset.analPane !== tab;
    }
    if (tab === "ac") requestAnimationFrame(() => drawAcChart());
  }
  function fillAcSources() {
    const select = $("#analAcInput");
    if (!select) return;
    const previous = select.value;
    const nodes = state.scene?.nodes || [];
    const sources = nodes.filter((node) => {
      const kind = node.kind === "device" ? node.params?.element : node.kind;
      return kind === "vsource" || kind === "isource";
    });
    select.innerHTML = '<option value="">\u81EA\u52A8</option>' + sources.map((node) => `<option value="${analEscape(node.name)}">${analEscape(node.name)}</option>`).join("");
    if (sources.some((node) => node.name === previous)) select.value = previous;
  }
  async function runOperatingPoint() {
    analysisWarn();
    const body = $("#analOpTable");
    const meta = $("#analOpMeta");
    if (meta) meta.textContent = "\u6C42\u89E3\u4E2D\u2026";
    try {
      const data = await api("/api/operating-point");
      const result = data.result || {};
      const nodeRows = Object.entries(result.node_voltages || {}).map(([name, value]) => `<tr><td>${analEscape(name)}</td><td class="num">${analNum(value)}</td></tr>`).join("");
      const elementRows = Object.entries(result.elements || {}).map(([name, info]) => `<tr><td>${analEscape(name)}</td><td class="num">${analNum(info.current)}</td><td class="num">${analNum(info.voltage_difference)}</td><td class="num">${analNum(info.power)}</td></tr>`).join("");
      if (body) {
        body.innerHTML = "<table><caption>\u8282\u70B9\u7535\u538B\uFF08V\uFF09</caption><thead><tr><th>\u8282\u70B9</th><th>\u7535\u538B</th></tr></thead><tbody>" + (nodeRows || '<tr><td colspan="2">\u6CA1\u6709\u8282\u70B9</td></tr>') + "</tbody></table><table><caption>\u5143\u4EF6</caption><thead><tr><th>\u5143\u4EF6</th><th>\u7535\u6D41\uFF08A\uFF09</th><th>\u7AEF\u7535\u538B\uFF08V\uFF09</th><th>\u529F\u7387\uFF08W\uFF09</th></tr></thead><tbody>" + (elementRows || '<tr><td colspan="4">\u6CA1\u6709\u5143\u4EF6</td></tr>') + "</tbody></table>";
      }
      if (meta) {
        meta.textContent = `\u8FED\u4EE3 ${result.iterations ?? "\u2014"} \u6B65 \xB7 \u77E9\u9635 ${result.matrix_size ?? "\u2014"} \xB7 \u6B8B\u5DEE ${analNum(result.residual, 3)} \xB7 ${result.sparse ? "\u7A00\u758F" : "\u7A20\u5BC6"}` + (result.strategies?.length ? ` \xB7 ${result.strategies.join("/")}` : "");
      }
    } catch (error) {
      if (body) body.innerHTML = `<div class="anal-empty">${analEscape(error.message)}</div>`;
      if (meta) meta.textContent = "\u6C42\u89E3\u5931\u8D25";
      toast(`DC \u5DE5\u4F5C\u70B9\u5931\u8D25\uFF1A${error.message}`, "error", 6e3);
    }
  }
  async function runAcSweep() {
    analysisWarn();
    const meta = $("#analAcMeta");
    const params = new URLSearchParams();
    const input = $("#analAcInput")?.value || "";
    if (input) params.set("input", input);
    params.set("f_start", $("#analAcF1")?.value || "10");
    params.set("f_stop", $("#analAcF2")?.value || "1000000");
    params.set("points", $("#analAcPts")?.value || "121");
    params.set("scale", $("#analAcScale")?.value || "log");
    const probeNames = (state.scene?.nodes || []).filter((node) => node.kind === "node").map((node) => node.name).filter(Boolean);
    if (probeNames.length) params.set("probes", probeNames.join(","));
    if (meta) meta.textContent = "\u626B\u9891\u4E2D\u2026";
    try {
      const data = await api(`/api/ac-sweep?${params.toString()}`);
      state.acResult = data.result || null;
      state.acRevision = state.scene?.revision ?? null;
      const result = state.acResult;
      const count = Object.keys(result?.probes || {}).length;
      if (meta) {
        meta.textContent = `${count} \u6761\u66F2\u7EBF \xB7 \u6FC0\u52B1 ${result?.input || "\u2014"} \xB7 ${result?.frequencies?.length || 0} \u70B9`;
      }
      drawAcChart();
    } catch (error) {
      state.acResult = null;
      if (meta) meta.textContent = "\u626B\u9891\u5931\u8D25";
      toast(`AC \u626B\u9891\u5931\u8D25\uFF1A${error.message}`, "error", 7e3);
      drawAcChart();
    }
  }
  function drawAcChart() {
    const canvas2 = $("#analAcCanvas");
    if (!canvas2) return;
    const rect = canvas2.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return;
    const dpr = window.devicePixelRatio || 1;
    canvas2.width = Math.round(rect.width * dpr);
    canvas2.height = Math.round(rect.height * dpr);
    const ctx2 = canvas2.getContext("2d");
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = rect.width;
    const H = rect.height;
    const ink = analToken("--ink", "#080a08");
    const muted = analToken("--muted", "#7b7266");
    const line = analToken("--line", "#d9d3c7");
    ctx2.clearRect(0, 0, W, H);
    const result = state.acResult;
    const legend = $("#analAcLegend");
    if (!result || !result.frequencies?.length) {
      if (legend) legend.innerHTML = "";
      ctx2.fillStyle = muted;
      ctx2.font = '12.5px "Microsoft YaHei UI", sans-serif';
      ctx2.fillText("\u9009\u62E9\u6FC0\u52B1\u4E0E\u9891\u7387\u8303\u56F4\u540E\u70B9\u300C\u5F00\u59CB\u626B\u9891\u300D", 16, 26);
      return;
    }
    const freqs = result.frequencies;
    const probes = Object.entries(result.probes || {});
    const scale = $("#analAcScale")?.value || "log";
    const f0 = freqs[0];
    const f1 = freqs[freqs.length - 1];
    const padL = 52;
    const padR = 14;
    const padT = 12;
    const gap = 30;
    const padB = 26;
    const magH = (H - padT - padB - gap) * 0.62;
    const phaseH = H - padT - padB - gap - magH;
    const magTop = padT;
    const phaseTop = padT + magH + gap;
    const plotW = Math.max(40, W - padL - padR);
    const xOf = (f) => {
      if (scale === "log") {
        const lo = Math.log10(Math.max(f0, 1e-9));
        const hi = Math.log10(Math.max(f1, 1e-9));
        const span2 = hi - lo || 1;
        return padL + (Math.log10(Math.max(f, 1e-9)) - lo) / span2 * plotW;
      }
      const span = f1 - f0 || 1;
      return padL + (f - f0) / span * plotW;
    };
    let minDb = 0;
    let maxDb = 0;
    for (const [, info] of probes) {
      for (const value of info.db || []) {
        if (!Number.isFinite(value)) continue;
        minDb = Math.min(minDb, value);
        maxDb = Math.max(maxDb, value);
      }
    }
    if (maxDb - minDb < 6) {
      maxDb += 3;
      minDb -= 3;
    } else {
      minDb -= 3;
      maxDb += 3;
    }
    const yMag = (db) => magTop + (1 - (db - minDb) / (maxDb - minDb || 1)) * magH;
    const yPhase = (deg) => phaseTop + (1 - (deg + 180) / 360) * phaseH;
    ctx2.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx2.strokeStyle = line;
    ctx2.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = magTop + magH * i / 4;
      ctx2.beginPath();
      ctx2.moveTo(padL, y);
      ctx2.lineTo(padL + plotW, y);
      ctx2.stroke();
      ctx2.fillStyle = muted;
      const value = maxDb - (maxDb - minDb) * i / 4;
      ctx2.fillText(`${value.toFixed(0)} dB`, 6, y + 4);
    }
    for (const deg of [-180, -90, 0, 90, 180]) {
      const y = yPhase(deg);
      ctx2.beginPath();
      ctx2.moveTo(padL, y);
      ctx2.lineTo(padL + plotW, y);
      ctx2.stroke();
      ctx2.fillStyle = muted;
      ctx2.fillText(`${deg}\xB0`, 18, y + 4);
    }
    const ticks = 5;
    for (let i = 0; i < ticks; i += 1) {
      const ratio = i / (ticks - 1);
      const f = scale === "log" ? 10 ** (Math.log10(f0) + (Math.log10(f1) - Math.log10(f0)) * ratio) : f0 + (f1 - f0) * ratio;
      const x = padL + plotW * ratio;
      ctx2.strokeStyle = line;
      ctx2.beginPath();
      ctx2.moveTo(x, magTop);
      ctx2.lineTo(x, magTop + magH + gap + phaseH);
      ctx2.stroke();
      ctx2.fillStyle = muted;
      const label = f >= 1e6 ? `${(f / 1e6).toFixed(1)}M` : f >= 1e3 ? `${(f / 1e3).toFixed(1)}k` : f >= 1 ? `${f.toFixed(0)}` : f.toExponential(0);
      ctx2.fillText(label, x - 8, H - 8);
    }
    const swatches = [];
    probes.forEach(([name, info], index) => {
      const chartMode = String(state.prefs && state.prefs.chartPalette || "theme");
      const series = chartMode === "theme" ? PALETTE : chartPalette();
      const color = series[index % series.length];
      swatches.push(`<span><i style="background:${color}"></i>${analEscape(name)}</span>`);
      const draw = (values, yFn) => {
        ctx2.beginPath();
        ctx2.strokeStyle = color;
        ctx2.lineWidth = 1.6;
        let started = false;
        for (let i = 0; i < freqs.length; i += 1) {
          const value = values?.[i];
          if (!Number.isFinite(value)) continue;
          const x = xOf(freqs[i]);
          const y = yFn(value);
          if (!started) {
            ctx2.moveTo(x, y);
            started = true;
          } else {
            ctx2.lineTo(x, y);
          }
        }
        if (started) ctx2.stroke();
      };
      draw(info.db, yMag);
      draw(info.phase_deg, yPhase);
    });
    if (legend) legend.innerHTML = swatches.join("");
    ctx2.fillStyle = ink;
    ctx2.font = '11.5px "Microsoft YaHei UI", sans-serif';
    ctx2.fillText("\u5E45\u503C", 6, magTop + 8);
    ctx2.fillText("\u76F8\u4F4D", 6, phaseTop + 10);
  }
  let pkChannelCache = [];
  function pkKeyShort(key) {
    const parts = String(key).split(":");
    if (parts.length >= 3 && parts[0] === "n") return parts.slice(1).join(".");
    return String(key);
  }
  function pkCheckedKeys() {
    return Array.from(document.querySelectorAll("#pkChannelList input[type=checkbox]")).filter((el2) => el2.checked).map((el2) => el2.value);
  }
  function renderPkChannels(selected) {
    const box = $("#pkChannelList");
    if (!box) return;
    const want = new Set(selected && selected.length ? selected : pkCheckedKeys());
    box.textContent = "";
    if (!pkChannelCache.length) {
      const empty = document.createElement("span");
      empty.className = "pk-empty";
      empty.textContent = "\u8FD8\u6CA1\u6709\u63A2\u9488\u6570\u636E\uFF1A\u5148\u8FD0\u884C\u4EFF\u771F\uFF0C\u6216\u6253\u5F00\u5E26\u63A2\u9488\u7684\u5DE5\u7A0B\u3002";
      box.appendChild(empty);
    } else {
      pkChannelCache.forEach((key) => {
        const label = document.createElement("label");
        label.className = "pk-ch";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.value = key;
        input.checked = want.has(key);
        const span = document.createElement("span");
        span.textContent = pkKeyShort(key);
        span.title = key;
        label.appendChild(input);
        label.appendChild(span);
        box.appendChild(label);
      });
    }
    const count = $("#pkDataCount");
    if (count) count.textContent = String(pkChannelCache.length);
  }
  function showPkChannelLoadError(message) {
    const hint = $("#pkDataHint");
    const box = $("#pkChannelList");
    const text = message || "\u8BF7\u6C42\u5931\u8D25";
    if (hint) hint.textContent = `\u6570\u636E\u5237\u65B0\u5931\u8D25\uFF1A${text}\uFF1B\u73B0\u6709\u901A\u9053\u5217\u8868\u672A\u6E05\u9664\uFF0C\u53EF\u70B9\u51FB\u300C\u91CD\u8BD5\u300D\u3002`;
    if (pkChannelCache.length || !box) return;
    box.textContent = "";
    const empty = document.createElement("span");
    empty.className = "pk-empty";
    empty.textContent = `\u63A2\u9488\u5217\u8868\u52A0\u8F7D\u5931\u8D25\uFF1A${text}`;
    box.appendChild(empty);
  }
  async function refreshPkChannels(keepSelection) {
    const hint = $("#pkDataHint");
    try {
      const data = await api("/api/plotkit/channels");
      const avail = data && data.available || [];
      const registered = data && data.channels || [];
      if (data && data.build && data.build !== UI_BUILD) {
        pkChannelCache = avail;
        renderPkChannels([]);
        if (hint) hint.textContent = `\u670D\u52A1\u7AEF\u8FDB\u7A0B\u8FD8\u662F\u65E7\u7248\u672C\uFF08\u540E\u7AEF ${data.build} / \u754C\u9762 ${UI_BUILD}\uFF09\u2014\u2014\u8BF7\u5B8C\u5168\u9000\u51FA\u5E94\u7528\u540E\u91CD\u65B0\u542F\u52A8\uFF1B\u53EA\u5173\u95ED\u7A97\u53E3\u53EF\u80FD\u6B8B\u7559\u65E7\u8FDB\u7A0B\u3002`;
        return false;
      }
      if (!data || !data.mounted) {
        pkChannelCache = avail;
        renderPkChannels([]);
        const why = data && data.diag && data.diag.last_error || "\u627E\u4E0D\u5230 plotkit \u5305";
        if (hint) hint.textContent = `PlotKit \u672A\u6302\u8F7D\uFF1A${why}`;
        return false;
      }
      pkChannelCache = avail.length ? avail : registered;
      renderPkChannels(keepSelection ? null : data.selected || []);
      if (hint) {
        hint.textContent = avail.length ? `\u573A\u666F\u5171 ${avail.length} \u6761\u63A2\u9488\uFF0C\u5DF2\u767B\u8BB0 ${registered.length} \u6761\uFF0C\u5F53\u524D\u753B ${(data.selected || []).length} \u6761\uFF1B\u52FE\u9009\u540E\u70B9\u300C\u63A5\u5165\u300D\u3002` : "\u5F53\u524D\u573A\u666F\u6CA1\u6709\u63A2\u9488\uFF1A\u5148\u653E\u63A2\u9488\u8282\u70B9\u6216\u6253\u5F00\u5E26\u63A2\u9488\u7684\u5DE5\u7A0B\u3002";
      }
      return true;
    } catch (error) {
      showPkChannelLoadError(error.message);
      return false;
    }
  }
  async function retryPlotkit() {
    const hint = $("#pkDataHint");
    if (hint) hint.textContent = "\u6B63\u5728\u91CD\u65B0\u68C0\u6D4B PlotKit\u2026";
    try {
      const data = await api("/api/plotkit/channels");
      if (data && data.mounted) {
        reloadPlotkitFrame();
        const refreshed = await refreshPkChannels(true);
        if (!refreshed) {
          toast("\u901A\u9053\u5237\u65B0\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u63D0\u793A", "warn", 4e3);
          return;
        }
        toast("PlotKit \u5DF2\u5C31\u7EEA", "info", 1800);
      } else {
        const why = data && data.diag && data.diag.last_error || "\u672A\u77E5\u539F\u56E0";
        if (hint) hint.textContent = `\u4ECD\u7136\u672A\u6302\u8F7D\uFF1A${why}`;
        toast("PlotKit \u4ECD\u672A\u6302\u8F7D\uFF0C\u8BF7\u770B\u63D0\u793A", "warn", 4e3);
      }
    } catch (error) {
      showPkChannelLoadError(error.message);
      toast("\u91CD\u65B0\u68C0\u6D4B\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u63D0\u793A", "warn", 4e3);
    }
  }
  function reloadPlotkitFrame() {
    const frame = $("#plotkitFrame");
    if (frame) frame.src = plotkitFrameUrl({ embed: "1", r: String(Date.now()) });
  }
  function mountPrecomputeBar() {
    const prior = document.getElementById("pkPrecomputeBar");
    if (prior) prior.remove();
    const host = document.createElement("div");
    host.id = "pkPrecomputeBar";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    host.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:10000;width:min(460px,92vw);background:var(--paper-2,#f3efe6);color:var(--text-primary,#080a08);border:1px solid var(--line-strong,#b9ae98);border-radius:12px;box-shadow:0 18px 48px rgba(0,0,0,.28);padding:12px 16px 13px;font:13px/1.5 "Microsoft YaHei",system-ui,sans-serif;';
    const head = document.createElement("div");
    head.style.cssText = "display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:8px;";
    const title = document.createElement("span");
    title.style.cssText = "color:var(--text-primary,#080a08);font-weight:600;";
    title.textContent = "\u9884\u8BA1\u7B97\u4E2D\u2026";
    const pct = document.createElement("span");
    pct.style.cssText = "color:var(--accent,#9b7247);font-weight:600;font-variant-numeric:tabular-nums;";
    pct.textContent = "0%";
    head.append(title, pct);
    const track = document.createElement("div");
    track.style.cssText = "height:8px;border-radius:999px;background:var(--paper-3,#e7e0d1);overflow:hidden;";
    const fill = document.createElement("div");
    fill.style.cssText = "height:100%;width:0%;border-radius:999px;background:var(--accent,#9b7247);transition:width .18s linear;";
    track.appendChild(fill);
    const sub = document.createElement("div");
    sub.style.cssText = "margin-top:7px;color:var(--text-secondary,#7b7266);font-size:12px;";
    sub.textContent = "\u6B63\u5728\u51C6\u5907\u2026";
    host.append(head, track, sub);
    document.body.appendChild(host);
    return { host, title, pct, fill, sub };
  }
  function paintPrecomputeBar(parts, progress, label) {
    if (!progress) return;
    const total = Number(progress.total || 0);
    const done = Number(progress.done || 0);
    let pctValue = Number(progress.percent);
    if (!Number.isFinite(pctValue)) pctValue = total > 0 ? done * 100 / total : 0;
    pctValue = Math.max(0, Math.min(100, pctValue));
    parts.fill.style.width = `${pctValue.toFixed(1)}%`;
    parts.pct.textContent = `${Math.round(pctValue)}%`;
    const status = progress.status || "";
    parts.title.textContent = status === "done" ? "\u9884\u8BA1\u7B97\u5B8C\u6210" : status === "cancelled" ? "\u5DF2\u505C\u6B62\u9884\u8BA1\u7B97" : status === "error" ? "\u9884\u8BA1\u7B97\u5931\u8D25" : label;
    const bits = [];
    if (total > 0) bits.push(`${done} / ${total} \u6B65`);
    const elapsed = Number(progress.elapsed);
    if (Number.isFinite(elapsed) && elapsed > 0) bits.push(`\u5DF2\u7528 ${elapsed.toFixed(1)}s`);
    const eta = progress.eta == null ? Number.NaN : Number(progress.eta);
    if (progress.running && Number.isFinite(eta) && eta >= 0 && pctValue < 100) {
      bits.push(`\u5269\u4F59\u7EA6 ${eta.toFixed(1)}s`);
    }
    parts.sub.textContent = bits.length ? bits.join(" \xB7 ") : "\u6B63\u5728\u51C6\u5907\u2026";
  }
  async function runPrecomputeWithProgress(launch, label = "\u9884\u8BA1\u7B97\u4E2D\u2026") {
    const parts = mountPrecomputeBar();
    let finished = false;
    const tick = async () => {
      if (finished) return;
      try {
        const progress = await api("/api/precompute/progress", {
          timeoutMs: 4e3
        });
        if (!finished) paintPrecomputeBar(parts, progress, label);
      } catch {
      }
    };
    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, 220);
    try {
      return await launch();
    } finally {
      finished = true;
      window.clearInterval(timer);
      parts.host.remove();
    }
  }
  async function syncAfterPrecompute(pre) {
    if (pre && pre.sim) state.sim = pre.sim;
    else await refreshState(true);
    updateSignalKeyCache();
    if (activeTab() === "analysis") renderAnalysisPanel();
  }
  async function applyPkChannels() {
    const keys = pkCheckedKeys();
    const hint = $("#pkDataHint");
    const applyBtn = $("#pkChApply");
    const seconds = Math.max(1, Math.min(120, Number(state.chart && state.chart.window) || 5));
    if (applyBtn) applyBtn.disabled = true;
    try {
      if (hint) hint.textContent = "\u6B63\u5728\u767B\u8BB0\u9009\u4E2D\u901A\u9053\u2026";
      const data = await api("/api/plotkit/channels", {
        method: "POST",
        body: JSON.stringify({ keys })
      });
      if (!data || !data.ok) {
        const message = data && data.error || (data && data.mounted === false ? "PlotKit \u672A\u6302\u8F7D" : "\u672A\u77E5\u539F\u56E0");
        if (hint) hint.textContent = `\u63A5\u5165\u5931\u8D25\uFF1A${message}`;
        toast(`\u63A5\u5165\u5931\u8D25\uFF1A${message}`, "warn", 4e3);
        return;
      }
      if (hint) hint.textContent = `\u6B63\u5728\u9884\u8BA1\u7B97 0\u2192${seconds}s \u7684\u6570\u636E\u2026`;
      const pre = await runPrecomputeWithProgress(
        () => api("/api/plotkit/precompute", {
          method: "POST",
          body: JSON.stringify({ seconds }),
          timeoutMs: 18e4
        }),
        `\u6B63\u5728\u8BA1\u7B97 0\u2192${seconds}s`
      );
      if (pre && pre.ok === false) {
        toast("\u9884\u8BA1\u7B97\u5931\u8D25\uFF1A" + (pre.error || "\u672A\u77E5\u9519\u8BEF"), "warn", 4e3);
        if (hint) hint.textContent = `\u9884\u8BA1\u7B97\u5931\u8D25\uFF1A${pre.error || "\u672A\u77E5\u9519\u8BEF"}\uFF1B\u53EF\u91CD\u8BD5\u6216\u68C0\u67E5\u573A\u666F\u3002`;
        return;
      }
      if (pre && pre.elapsed_ms) {
        const degradedNote = pre.degraded ? `\uFF1B\u6B65\u957F\u5DF2\u964D\u7EA7\u4E3A ${Number(pre.dt_used).toExponential(1)}s\uFF08\u8BF7\u6C42 ${Number(pre.requested_dt).toExponential(1)}s\uFF0C\u53D7 20 \u4E07\u6B65\u4E0A\u9650\u9650\u5236\uFF09` : "";
        if (hint) hint.textContent = `\u9884\u8BA1\u7B97\u5B8C\u6210\uFF1A${seconds}s / ${pre.frames ?? pre.frames_recorded ?? "?"} \u5E27 / ${Math.round(pre.elapsed_ms)} ms${degradedNote}`;
        if (pre.degraded) {
          toast(`\u9884\u8BA1\u7B97\u5DF2\u964D\u7EA7\u6B65\u957F ${Number(pre.dt_used).toExponential(1)}s\uFF0C\u7F29\u5C0F\u65F6\u95F4\u7A97\u53EF\u63D0\u9AD8\u7CBE\u5EA6`, "warn", 5200);
        }
      }
      await syncAfterPrecompute(pre);
      toast(`\u5DF2\u63A5\u5165 ${(data.selected || []).length} \u6761\u901A\u9053`, "ok", 2600);
      reloadPlotkitFrame();
      await refreshPkChannels();
    } catch (error) {
      const message = error.message || "\u8BF7\u6C42\u5931\u8D25";
      if (hint) hint.textContent = `\u63A5\u5165\u5931\u8D25\uFF1A${message}`;
      toast(`\u63A5\u5165\u5931\u8D25\uFF1A${message}`, "warn", 4e3);
    } finally {
      if (applyBtn) applyBtn.disabled = false;
    }
  }
  function pkKeysForSelectedNode() {
    const node = selectedNode();
    if (!node) {
      toast("\u5148\u5728\u753B\u5E03\u4E0A\u9009\u4E2D\u4E00\u4E2A\u8282\u70B9", "warn", 2400);
      return null;
    }
    const names = [node.id, node.name].filter(Boolean).map(String);
    return pkChannelCache.filter((key) => names.some((name) => key === name || key.startsWith(name + ":") || key.indexOf(":" + name + ":") >= 0));
  }
  function initPlotkitDataBar() {
    const all = $("#pkChAll");
    const none = $("#pkChNone");
    const nodeBtn = $("#pkChNode");
    const apply = $("#pkChApply");
    if (all) all.addEventListener("click", () => {
      document.querySelectorAll("#pkChannelList input").forEach((i) => {
        i.checked = true;
      });
    });
    if (none) none.addEventListener("click", () => {
      document.querySelectorAll("#pkChannelList input").forEach((i) => {
        i.checked = false;
      });
    });
    if (nodeBtn) nodeBtn.addEventListener("click", () => {
      const keys = pkKeysForSelectedNode();
      if (!keys) return;
      if (!keys.length) {
        toast("\u8FD9\u4E2A\u8282\u70B9\u6CA1\u6709\u63A2\u9488\u901A\u9053", "warn", 2400);
        return;
      }
      document.querySelectorAll("#pkChannelList input").forEach((i) => {
        i.checked = keys.indexOf(i.value) >= 0;
      });
      toast(`\u5DF2\u52FE\u9009\u8BE5\u8282\u70B9\u7684 ${keys.length} \u6761\u901A\u9053`, "info", 2200);
    });
    if (apply) apply.addEventListener("click", applyPkChannels);
    const retry = $("#pkChRetry");
    if (retry) retry.addEventListener("click", retryPlotkit);
    document.querySelectorAll('[data-sub="plotkit"]').forEach((btn) => {
      btn.addEventListener("click", () => setTimeout(() => refreshPkChannels(true), 60));
    });
    setInterval(() => {
      const pane = $("#tab-plotkit");
      if (pane && !pane.hidden) refreshPkChannels(true);
    }, 5e3);
  }
  function initAnalWin() {
    const win = $("#analWin");
    if (!win) return;
    win.querySelector("#analWinClose")?.addEventListener("click", closeAnalysis);
    for (const btn of $$(".anal-tab")) {
      btn.addEventListener("click", () => {
        selectAnalTab(btn.dataset.anal || "op");
        if (btn.dataset.anal === "ac") fillAcSources();
      });
    }
    $("#analRunOp")?.addEventListener("click", () => void runOperatingPoint());
    $("#analRunAc")?.addEventListener("click", () => void runAcSweep());
    initFloatWindow(win, "analGeo", { minWidth: 560, minHeight: 420 });
    window.addEventListener("resize", () => {
      if (!win.hidden && !win.querySelector('.anal-pane[data-anal-pane="ac"]')?.hidden) {
        drawAcChart();
      }
    });
  }
  function initDocWin() {
    if (!ui.docWin) return;
    ui.docWin.querySelector("#docWinClose")?.addEventListener("click", closeDoc);
    ui.docSearch?.addEventListener("input", () => searchDocs(ui.docSearch.value));
    ui.docSearch?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        const first = ui.docResults.querySelector(".doc-hit");
        if (first) first.click();
      }
      if (event.key === "Escape") {
        ui.docSearch.value = "";
        searchDocs("");
      }
    });
    initFloatWindow(ui.docWin, "docGeo", { minWidth: 420, minHeight: 320 });
    const plotkitWin = $("#plotkitWin");
    if (plotkitWin) {
      initFloatWindow(plotkitWin, "plotkitGeo", { minWidth: 720, minHeight: 480 });
      $("#plotkitWinClose")?.addEventListener("click", closePlotkit);
      $("#plotkitDock")?.addEventListener("click", togglePlotkitDock);
      window.addEventListener("resize", () => {
        if (state.plotkitDock && !plotkitWin.hidden) layoutPlotkitWindow();
      });
      $("#btnOpenPlotkit")?.addEventListener("click", () => placePlotkit("float"));
      $("#btnPlotkitInline")?.addEventListener("click", () => placePlotkit("inline"));
      $("#btnPlotkitPopup")?.addEventListener("click", () => placePlotkit("popup"));
      $("#plotkitPopout")?.addEventListener("click", () => {
        closePlotkit();
        placePlotkit("popup");
      });
    }
    const vscodeWin = $("#vscodeWin");
    if (vscodeWin) {
      initFloatWindow(vscodeWin, "vscodeGeo", { minWidth: 720, minHeight: 520 });
      $("#vscodeWinClose")?.addEventListener("click", closeVscode);
      maybePrewarmVscode();
    }
    const wbSignalWin = $("#wbSignalWin");
    if (wbSignalWin) {
      initFloatWindow(wbSignalWin, "wbSignalGeo", { minWidth: 280, minHeight: 320 });
      $("#wbSignalWinClose")?.addEventListener("click", () => setWbSignalDock(true));
      $("#wbSignalDockBtn")?.addEventListener("click", () => setWbSignalDock(true));
      window.addEventListener("resize", () => {
        if (activeTab() === "wb-analysis" && wbComparePayload) renderCompareGrid();
      });
    }
    void syncProjectContext();
  }
  function attachParamHelp(cell, param, spec, role) {
    if (!cell) return;
    const ask = button("?", "qbtn", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showHelpCard(ask, {
        title: `${param.label || param.key}\uFF08${param.key}\uFF09`,
        description: param.help,
        range: paramRangeText(param),
        unit: param.unit,
        def: param.default,
        formula: spec?.formula || "",
        source: spec?.source_path || "",
        role
      });
    });
    ask.title = "\u56DB\u6BB5\u5F0F\u53C2\u6570\u8BF4\u660E\uFF08\u8BF4\u660E / \u53D6\u503C / \u5355\u4F4D\u4E0E\u9ED8\u8BA4 / \u516C\u5F0F\uFF09";
    ask.setAttribute("aria-label", `\u67E5\u770B ${param.key} \u7684\u8BF4\u660E`);
    cell.appendChild(ask);
  }
  async function ensureStoppedOnBoot() {
    try {
      if (state.sim?.running) await networkControl("pause");
    } catch (error) {
    }
  }
  function initShellKeys() {
    document.addEventListener("keydown", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const typing = target?.closest('input, textarea, select, [contenteditable="true"]');
      if (event.key === "Escape") {
        if (floatingMenu) {
          closeFloatingMenu();
          event.preventDefault();
          return;
        }
        if (ui.qcard && !ui.qcard.hidden) {
          hideHelpCard();
          event.preventDefault();
          return;
        }
        if (ui.moduleWin && !ui.moduleWin.hidden) {
          ui.moduleWin.hidden = true;
          event.preventDefault();
          return;
        }
        if (ui.settingsWin && !ui.settingsWin.hidden) {
          closeSettings();
          event.preventDefault();
          return;
        }
        if (ui.analWin && !ui.analWin.hidden) {
          closeAnalysis();
          event.preventDefault();
          return;
        }
        if (ui.docWin && !ui.docWin.hidden) {
          closeDoc();
          event.preventDefault();
        }
        return;
      }
      if (typing) return;
      const key = event.key.toLowerCase();
      if (event.ctrlKey && key === "k") {
        event.preventDefault();
        openDoc(state.docSlug || "quickstart");
        setTimeout(() => ui.docSearch?.focus(), 60);
        return;
      }
      if (key === "h") {
        event.preventDefault();
        openDoc("quickstart");
      }
      if (event.key === "?") {
        event.preventDefault();
        openDoc("shortcuts");
      }
    });
    document.addEventListener("click", (event) => {
      if (ui.qcard && !ui.qcard.hidden && !event.target.closest("#qcard, .qbtn")) hideHelpCard();
    });
  }
  function openDocSearch() {
    openDoc(state.docSlug || "quickstart");
    setTimeout(() => {
      if (ui.docSearch) {
        ui.docSearch.focus();
        ui.docSearch.select();
      }
    }, 90);
  }
  function syncFnRoleToSelection() {
    const type = state.selection?.type;
    if (type !== "node" && type !== "edge") return;
    const role = type === "edge" ? "edge" : "node";
    if (state.fnRole === role) return;
    state.fnRole = role;
    state.specKind = "";
    $$("#panel .group-subnav [data-fnrole]").forEach((node) => {
      node.classList.toggle("active", node.dataset.fnrole === role);
    });
    if ($(".panel-group.active")?.dataset.group === "fn") renderSpecPane();
  }
  setTypeLabelHelp(typeLabelHelp);
  setSwitchTab(switchTab);
  setEmptyInspectorActions({ centerPlacement, openAddMenu, fitView });
  setInspectorActions({ deleteNode, patchNodeGeometry, nodeDiameter, deleteEdge, patchEdgeGeometry, syncUI, updateScenePanelValues, renderInspector, updateSignalKeyCache, refreshState });
  setSpecPanelActions({ attachParamHelp, confirmModal, renderInspector });
  setAnalysisActions({ task, downloadText, phaseStateKeys, C, tokens });
  setGeometryActions({ distance, circuitPinPath, wirePathPoints });
  setInstrumentActions({ scheduleChartDraw });
  setProjectActions({
    confirmModal,
    applySnapshot,
    syncProjectContext,
    applyProjectUi,
    renderScenePanel,
    renderInspector,
    renderSignalList,
    fetchNetworks,
    fitView,
    chooseModeModal,
    task,
    showHelp
  });
  loadUiProfile();
  boot();
  setTimeout(checkCacheQuietly, 6e3);
})();
