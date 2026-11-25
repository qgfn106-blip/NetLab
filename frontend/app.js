import { fmt, intText, clamp, hashString } from "./app.utils.js";
import { ENDPOINTS } from "./app/endpoints.js";
import { initSessionStore, applySnapshot } from "./app/store.js";
import { NODE_W, NODE_H } from "./app/constants.js";
import { $, $$, stage, canvas, chartCanvas } from "./app/dom.js";
import { pointerPosition, frameCap } from "./app/canvas_geometry.js";
import { drawModulePreview } from "./app/module_preview.js";
import { drawChart } from "./app/chart_draw.js";
import { state, ui } from "./app/state.js";
import { initScenePanel, updateScenePanelValues } from "./app/scene_panel.js";
import { initSceneActions, renderScenePanel, switchMode, loadTemplate, migrateSceneToDevices, clearScene, openExport } from "./app/scene_actions.js";
import { initReplay, nearestFrame, recordingStale, stopReplayTimer, updateReplayUI, enterReplay, leaveReplay, toggleReplayPlayback, setWorkspaceButtons } from "./app/analysis_replay.js";
import { initSignalList, decodeProbeKey, renderSignalList, updateSignalListValues, updateLegendValues } from "./app/signal_list.js";
import { el, div, button, isFormTarget } from "./app/ui.js";
import { normalizeCardFields } from "./app/card_fields.js";
import { applyGridPayload } from "./app/grid_prefs.js";
import { toast, showBanner, hideBanner } from "./app/desktop.js";
import { api, jsonRequest } from "./app/net.js";
import { openCacheDialog, checkCacheQuietly } from "./app/cache.js";
import { appearancePanelTitle, collectAppearanceTargets, renderAppearancePanel } from "./app/appearance_panel.js";
import { placeFloatWindow, raiseFloatWindow, initFloatWindow } from "./app/float.js";
import { chartPalette } from "./app/theme.js";
import { C, tokens } from "./app/colors.js";
import { kindListFor, numberedField } from "./app/fields.js";
import { setTypeLabelHelp } from "./app/param_fields.js";
import { hideHelpCard, showHelpCard, typeLabelHelp, paramRangeText, setSwitchTab } from "./app/help_card.js";
import { activeTab, modeLabel, selectedNode, selectedEdge, nodeById, edgeById, getNodeSpec, getEdgeSpec, specDefaults, uniqueNodeName } from "./app/model.js";
import { groupNodeSpecs } from "./app/menu_model.js";
import { SHEET_SIZES, drawGraph, requestDraw, animationLoop } from "./app/canvas_render.js";
import { openIroColorPopover, setGroupSub, blockBadges, modulePortList, captureSceneSnapshot, setPanelGroup, plotkitFrames, closeMenus } from "./app/ui_helpers.js";
import { drawPhase, phaseFrameCount, phaseStateKeys, renderVectorNodeList, resizePhase, schedulePhaseDraw, setPhaseIndex, stopPhasePlay, togglePhasePlay } from "./app/phase.js";
import { setInstrumentActions, fillInstrumentSelects, drawInstruments, resizeInstrument, initInstruments } from "./app/instruments.js";
import { circuitCrossingMap, circuitPinPath, edgeAnchorTowards, pinScreenPoint, wirePathPoints } from "./app/canvas_base.js";
import { section, renderEmptyInspector, setEmptyInspectorActions } from "./app/inspector_shell.js";
import { isPinNode, devicePins } from "./app/device_pins.js";
import { renderNodeInspector, renderEdgeInspector, applyInspector, updateInspectorLive, setInspectorActions } from "./app/inspector.js";
import { renderSpecPane, scheduleSpecRender, renderExtensionPanel, setSpecPanelActions } from "./app/spec_panel.js";
import { applyNumericProjectUi, setProjectActions, markProjectDirty, projectDownloadText as downloadText, saveProject, openProject, newProject, recoverAutosave, maybeOfferRecovery, initProject } from "./app/project.js";
import { loadUiPrefs, setAppearanceActions } from "./app/appearance.js";
import { initAppearanceControls, saveAutosaveSetting, refreshTelemetryQuality, setAppearanceControlActions } from "./app/appearance_controls.js";
import { setGeometryActions, worldToScreen, screenToWorld, nodeDiameter, nodeRect, devicePinScreen, snapWorld, portOut, edgeEndpointHit, waypointHitAt, anchorSideFor, edgePathPoints, pathMidpoint, distanceToPath } from "./app/geometry.js";
import { analysisSignalKey, runAnalysisMetrics, runAnalysisSpectrum, runAnalysisPeriod, runAnalysisMath, runAnalysisTransfer, analysisTFSummary, runAnalysisTF, drawAnalysisTF, exportTFStateSpace, sendTFToPlotKit, sendPhaseToPlotKit, exportAnalysisCsv, drawAnalysisSpectrum, setAnalysisActions } from "./app/analysis.js";
import { openAnalysis, closeAnalysis } from "./app/ac_analysis.js";
import { runPrecomputeWithProgress, syncAfterPrecompute, initPlotkitDataBar, setPlotkitDataActions } from "./app/plotkit_data.js";
import { openVscode } from "./app/plotkit_frame.js";
import { initAnalWin, initDocWin, setWindowActions } from "./app/windows.js";
import { ensureDocs, openDoc, closeDoc, setDocsActions } from "./app/docs.js";
import { openSettings, closeSettings, initSettingsWin, showGuide, initGuide, setGuideActions } from "./app/settings_guide.js";
import { setPlotkitFrameActions } from "./app/plotkit_frame.js";
import { elementPins, elementRot } from "./app/circuit_symbols.js";
import { closeModal, openConfirmModal as confirmModal, openModeModal as chooseModeModal } from "./app/dialogs_build.js";
import { initAnalysisWorkbenchPanel, renderWorkbenchAnalysis, renderWorkbenchState, refreshWbAnalysis, syncProjectContext, renderCompareGrid, setWbSignalDock, getWbCompareStateIds, getWbCacheStatus, getWbComparePayload } from "./app/analysis_workbench_panel.js";
function setStatusHint(hint) {
  const node = document.getElementById("statusHint");
  if (node) node.textContent = hint;
}
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
      const multi = multiSelection();
      const inGroup = !event.ctrlKey && !event.metaKey && multi.nodes.has(node.id);
      if (inGroup) {
        const origins = /* @__PURE__ */ new Map();
        for (const id of multi.nodes) {
          const item = nodeById(id);
          if (item?.position) origins.set(id, { x: item.position.x, y: item.position.y });
        }
        if (origins.size > 1) {
          const waypointOrigins = /* @__PURE__ */ new Map();
          for (const edgeItem of state.scene?.edges || []) {
            if (!edgeItem.waypoints?.length) continue;
            if (!origins.has(edgeItem.source) || !origins.has(edgeItem.target)) continue;
            waypointOrigins.set(edgeItem.id, edgeItem.waypoints.map((point2) => ({ ...point2 })));
          }
          state.drag = {
            type: "nodes",
            startX: point.x,
            startY: point.y,
            origins,
            waypoints: waypointOrigins,
            moved: false
          };
          canvas.setPointerCapture(event.pointerId);
          canvas.style.cursor = "grabbing";
          event.preventDefault();
          return;
        }
      }
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
    if (drag.type === "nodes") {
      const k = state.view.k;
      const dx = (point.x - drag.startX) / k;
      const dy = (point.y - drag.startY) / k;
      const origins = drag.origins;
      let appliedDx = dx;
      let appliedDy = dy;
      let firstOrigin = true;
      for (const [id, origin] of origins) {
        const node = nodeById(id);
        if (!node?.position) continue;
        const snapped = snapWorld(origin.x + dx, origin.y + dy, event.altKey);
        if (firstOrigin) {
          appliedDx = snapped.x - origin.x;
          appliedDy = snapped.y - origin.y;
          firstOrigin = false;
        }
        node.position.x = snapped.x;
        node.position.y = snapped.y;
      }
      const waypointOrigins = drag.waypoints;
      for (const [edgeId, points] of waypointOrigins || []) {
        const edgeItem = edgeById(edgeId);
        if (!edgeItem) continue;
        edgeItem.waypoints = points.map((point2) => ({
          x: Math.round((point2.x + appliedDx) * 100) / 100,
          y: Math.round((point2.y + appliedDy) * 100) / 100
        }));
      }
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
  async function onPointerUp(event) {
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
    if (drag.type === "nodes" && drag.moved) {
      await pushUndoSnapshot();
      const waypointOrigins = drag.waypoints;
      for (const [edgeId] of waypointOrigins || []) {
        const edgeItem = edgeById(edgeId);
        if (!edgeItem) continue;
        await task(
          () => jsonRequest(ENDPOINTS.edge(edgeId), "PATCH", { waypoints: edgeItem.waypoints || [] }),
          { history: false }
        );
      }
      const origins = drag.origins;
      for (const id of origins.keys()) queuePositionSave(id);
    }
    if (drag.type === "node" && drag.moved) {
      await pushUndoSnapshot();
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
      await jsonRequest(ENDPOINTS.node(nodeId), "PATCH", {
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
          hint: "\u76F8\u8FDE\u7684\u5BFC\u7EBF\u6574\u6BB5\u4E00\u8D77\u9009\u4E2D",
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
    if (state.mode === "circuit") {
      items.push({ sep: true });
      items.push({ label: "\u5BFC\u51FA\u2026", action: () => void openExport("schematic") });
    }
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
      await jsonRequest(ENDPOINTS.positions, "POST", { positions: items });
    } catch (error) {
      toast(`\u4FDD\u5B58\u5750\u6807\u5931\u8D25\uFF1A${error.message}`, "error", 6e3);
      await refreshState(true);
    }
  }
  async function patchNodeGeometry(nodeId, payload) {
    const response = await task(
      () => jsonRequest(ENDPOINTS.node(nodeId), "PATCH", payload)
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
      () => jsonRequest(ENDPOINTS.node(nodeId), "PATCH", {
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
      () => jsonRequest(ENDPOINTS.edge(edgeId), "PATCH", payload)
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
      if (tab === "chart") drawChart({ colorForKey, decodeProbeKey, nearestFrame, state: { chart: state.chart, chartSize: state.chartSize, frames: state.frames, replay: state.replay } });
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
      api(ENDPOINTS.plotkitActive, {
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
  function buildAddMenuItems(placeX, placeY) {
    const list = kindListFor("node");
    const items = [];
    if (state.mode !== "circuit") {
      for (const { group, specs } of groupNodeSpecs(list, state.mode)) {
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
    const pastedNodeIds = [];
    const pastedEdgeIds = [];
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
      const response = await task(() => jsonRequest(ENDPOINTS.nodes, "POST", payload), { history: false });
      if (!response?.node) continue;
      idMap.set(node.id, response.node.id);
      pastedNodeIds.push(response.node.id);
      nodesCreated += 1;
    }
    for (const edge of clipboard.edges) {
      const source = idMap.get(edge.source);
      const target = idMap.get(edge.target);
      if (!source || !target) continue;
      const response = await task(
        () => jsonRequest(ENDPOINTS.edges, "POST", {
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
      if (response) {
        pastedEdgeIds.push(response.id || response.edge?.id || "");
        edgesCreated += 1;
      }
    }
    await refreshState(true);
    state.multi.nodes = new Set(pastedNodeIds);
    state.multi.edges = new Set(pastedEdgeIds.filter(Boolean));
    state.selection = pastedNodeIds.length ? { type: "node", id: pastedNodeIds[0] } : { type: null, id: null };
    requestDraw();
    toast(`\u5DF2\u7C98\u8D34 ${nodesCreated} \u8282\u70B9 / ${edgesCreated} \u8FDE\u63A5`, "ok", 2600);
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
    await jsonRequest(ENDPOINTS.control, "POST", { action: "pause" });
    const response = await jsonRequest(ENDPOINTS.scene, "POST", merged);
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
    await pushUndoSnapshot();
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
      await jsonRequest(ENDPOINTS.positions, "POST", { positions });
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
    await pushUndoSnapshot();
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
      await jsonRequest(ENDPOINTS.positions, "POST", { positions });
      await refreshState(true);
      toast(`\u5DF2\u7B49\u8DDD\u5206\u5E03 ${targets.length} \u4E2A\u8282\u70B9\uFF08${axis === "y" ? "\u7EB5\u5411" : "\u6A2A\u5411"}\uFF09`, "ok", 2200);
    } catch (error) {
      toast(`\u5206\u5E03\u5931\u8D25\uFF1A${error.message}`, "error", 4e3);
    }
  }
  function selectWireNetwork(edge) {
    const adjacency = /* @__PURE__ */ new Map();
    for (const item of state.scene?.edges || []) {
      if (item.kind !== "wire") continue;
      if (!adjacency.has(item.source)) adjacency.set(item.source, []);
      if (!adjacency.has(item.target)) adjacency.set(item.target, []);
      adjacency.get(item.source).push({ edge: item, other: item.target });
      adjacency.get(item.target).push({ edge: item, other: item.source });
    }
    const endpoints = /* @__PURE__ */ new Set([edge.source, edge.target]);
    const selectedWires = /* @__PURE__ */ new Map();
    if (edge.kind === "wire") selectedWires.set(edge.id, edge);
    const queue = [edge.source, edge.target];
    while (queue.length) {
      const id = queue.shift();
      for (const link of adjacency.get(id) || []) {
        selectedWires.set(link.edge.id, link.edge);
        if (!endpoints.has(link.other)) {
          endpoints.add(link.other);
          queue.push(link.other);
        }
      }
    }
    state.multi.nodes = endpoints;
    state.multi.edges = new Set(selectedWires.keys());
    state.selection = { type: null, id: null };
    requestDraw();
    toast(`\u5DF2\u9009\u4E2D ${selectedWires.size} \u6761\u5BFC\u7EBF / ${endpoints.size} \u4E2A\u7AEF\u70B9`, "info", 2200);
  }
  async function addWireWaypoint(edge) {
    const source = nodeById(edge.source);
    const target = nodeById(edge.target);
    if (!source || !target) return;
    const x = (source.position.x + target.position.x) / 2;
    const y = (source.position.y + target.position.y) / 2;
    const waypoints = [...edge.waypoints || [], { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }];
    try {
      await jsonRequest(ENDPOINTS.edge(edge.id), "PATCH", {
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
      await jsonRequest(ENDPOINTS.edge(edgeId), "PATCH", {
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
        await jsonRequest(ENDPOINTS.node(node.id), "PATCH", {
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
    const response = await task(() => jsonRequest(ENDPOINTS.nodes, "POST", payload));
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
    const response = await task(() => jsonRequest(ENDPOINTS.nodes, "POST", payload));
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
    const response = await task(() => jsonRequest(ENDPOINTS.edges, "POST", body));
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
    const response = await task(() => jsonRequest(ENDPOINTS.edges, "POST", body));
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
    const response = await task(() => jsonRequest(ENDPOINTS.edge(edgeId), "PATCH", { delay: !edge.delay }));
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
    const response = await task(() => jsonRequest(ENDPOINTS.node(nodeId), "DELETE"));
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
    const response = await task(() => jsonRequest(ENDPOINTS.edge(edgeId), "DELETE"));
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
        () => jsonRequest(ENDPOINTS.edge(edgeId), "DELETE"),
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
        () => jsonRequest(ENDPOINTS.node(nodeId), "DELETE"),
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
    await pushUndoSnapshot();
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
      await jsonRequest(ENDPOINTS.positions, "POST", { positions: items });
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
          { label: "\u5BFC\u51FA\u573A\u666F JSON", hint: "Ctrl+Shift+E", action: () => void openExport("scene-data") },
          { label: "\u5BFC\u51FA\u539F\u7406\u56FE SVG\u2026", hint: "\u7EDF\u4E00\u5BFC\u51FA\u7A97\u53E3", action: () => void openExport("schematic") },
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
          { label: "\u89C6\u56FE\u8BBE\u8BA1\u2026", hint: "\u4E3B\u9898\u3001\u5E03\u5C40\u4E0E\u5143\u7D20\u5916\u89C2", action: () => void openViewDesigner() },
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
        label: "\u8FD0\u884C",
        items: [
          { label: "\u9884\u8BA1\u7B97\u2026", hint: "\u7EDF\u4E00\u5165\u53E3\uFF1A\u5F53\u524D\u7F51\u7EDC / PlotKit / \u5DE5\u4F5C\u53F0\u72B6\u6001", action: () => openPrecomputeDialog() }
        ]
      },
      {
        label: "\u4EFF\u771F",
        items: [
          { label: "\u8FD0\u884C / \u6682\u505C", hint: "\u7A7A\u683C", action: () => void control("toggle") },
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
          { label: "\u7535\u8DEF\u5206\u6790\u5DE5\u4F5C\u53F0\u2026", hint: "Bode / \u65F6\u57DF / Nyquist / \u73AF\u8DEF \xB7 \u591A\u72B6\u6001\u5BF9\u6BD4", action: () => openAnalysis("wb-analysis") },
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
      const response = await jsonRequest(ENDPOINTS.networks, "GET");
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
      () => jsonRequest(ENDPOINTS.networkActivate(networkId), "POST", {})
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
    const response = await task(() => jsonRequest(ENDPOINTS.networks, "POST", payload));
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
      () => jsonRequest(ENDPOINTS.network(networkId), "PATCH", { name: proposed })
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
      () => jsonRequest(ENDPOINTS.network(network.id), "DELETE")
    );
    if (!response) return;
    await fetchNetworks();
    const snapshot = await api(ENDPOINTS.state);
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
      await task(() => jsonRequest(ENDPOINTS.node(node.id), "PATCH", { position }), { history: false });
    }
    for (const edge of edges) {
      const waypoints = (edge.waypoints || []).map((point) => ({ x: snapValue(point.x), y: snapValue(point.y) }));
      await task(() => jsonRequest(ENDPOINTS.edge(edge.id), "PATCH", { waypoints }), { history: false });
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
      applyGridPayload(state.ui, uiSettings.grid);
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
    if (Array.isArray(uiSettings.cardFields)) {
      const next = normalizeCardFields(uiSettings.cardFields);
      state.ui.cardFields = next;
      state.ui.cardDetail = next.length > 0;
      state.ui.cardValue = next.includes("value");
    }
    if (Number.isFinite(Number(uiSettings.symbolScale))) state.ui.symbolScale = clamp(Number(uiSettings.symbolScale), 0.6, 2.5);
    if (typeof uiSettings.glyphColor === "string") state.ui.glyphColor = uiSettings.glyphColor;
    if (uiSettings.analysis_workbench && typeof uiSettings.analysis_workbench === "object") {
      state.ui.analysis_workbench = uiSettings.analysis_workbench;
    }
    applyNumericProjectUi(uiSettings);
    requestDraw();
  }
  async function refreshBlocks() {
    const response = await task(() => jsonRequest(ENDPOINTS.blocks, "GET"), { dirty: false });
    if (!response) return;
    state.blocks = response.blocks || [];
    state.blocksLibrary = response.library || "";
    renderBlocksPanel();
  }
  async function instantiateBlockFromLibrary(blockId) {
    const place = centerPlacement();
    const response = await task(
      () => jsonRequest(ENDPOINTS.blockInstantiate, "POST", {
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
      response = await jsonRequest(ENDPOINTS.blockEncapsulate, "POST", {
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
    const response = await task(() => jsonRequest(ENDPOINTS.projectRetry, "POST", {}));
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
        () => jsonRequest(ENDPOINTS.blockInstantiate, "POST", {
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
      () => jsonRequest(ENDPOINTS.blockOpenInternal(blockId), "POST", {})
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
          () => jsonRequest(ENDPOINTS.block(blockId), "GET"),
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
      requestAnimationFrame(() => drawModulePreview({ state, ui }));
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
      requestAnimationFrame(() => drawModulePreview({ state, ui }));
    } else {
      placeFloatWindow(ui.moduleWin, "moduleGeo");
      raiseFloatWindow(ui.moduleWin);
      requestAnimationFrame(() => drawModulePreview({ state, ui }));
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
        if (!ui.moduleWin?.hidden) drawModulePreview({ state, ui });
      });
      observer.observe(ui.moduleStage);
    }
  }
  async function saveCurrentAsBlockCopy() {
    const proposed = window.prompt("\u526F\u672C\u6A21\u5757\u540D\u79F0\uFF08\u65B0 id\uFF0Cv1\uFF09", `${state.currentNetwork?.name || "\u6A21\u5757"}-copy`);
    if (proposed === null) return;
    const response = await task(
      () => jsonRequest(ENDPOINTS.blockSaveCopy, "POST", { name: proposed })
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
          () => jsonRequest(ENDPOINTS.blockValidate, "POST", { payload }),
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
          () => jsonRequest(ENDPOINTS.blockImport, "POST", { payload })
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
  function renderAnalysisPanel() {
    const pane = ui.analysisPane;
    if (!pane) return;
    const host = div("blocks-host");
    const head = div("insp-head");
    const title = div("insp-title");
    title.append(el("h2", null, "\u5206\u6790\uFF08\u65C1\u8DEF\uFF09"), el("p", null, "\u53EA\u8BFB\u5F55\u5236\u6570\u636E\uFF1B\u7ED3\u8BBA\u5E26\u6765\u6E90\uFF0C\u4E0D\u5199\u6C42\u89E3\u5668"));
    head.appendChild(title);
    host.appendChild(head);
    const keys = state.probeKeys || [];
    const signal = el("select", "input");
    for (const key2 of keys) {
      const option = el("option", null, decodeProbeKey(key2).label);
      option.value = key2;
      signal.appendChild(option);
    }
    const key = analysisSignalKey();
    if (key) signal.value = key;
    signal.addEventListener("change", () => {
      const chosen = String(signal.value || "");
      if (!chosen) return;
      state.chart.selected.clear();
      state.chart.selected.add(chosen);
      renderSignalList();
      scheduleChartDraw();
    });
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
      const response = await task(() => jsonRequest(ENDPOINTS.config, "PATCH", { step_timeout_ms: Number(timeoutInput.value) || 0 }));
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
        const response = await task(() => jsonRequest(ENDPOINTS.profile, "PATCH", {
          enabled: Boolean(profileToggle.checked)
        }));
        if (response) {
          profileToggle.checked = Boolean(response.enabled);
          toast(response.enabled ? "\u6027\u80FD\u8BA1\u65F6\u5DF2\u5F00\u542F" : "\u6027\u80FD\u8BA1\u65F6\u5DF2\u5173\u95ED", "ok", 2200);
        }
      }),
      button("\u6E05\u7A7A", "btn tiny", async () => {
        const response = await task(() => jsonRequest(ENDPOINTS.profile, "PATCH", { reset: true }));
        if (response) toast("\u6027\u80FD\u91C7\u6837\u5DF2\u6E05\u7A7A", "ok", 2e3);
      })
    );
    perf.appendChild(profileButtons);
    const profileOut = el("pre", "analysis-out");
    profileOut.id = "analysisProfile";
    profileOut.textContent = "\u70B9\u51FB\u5237\u65B0\u8BFB\u53D6 /api/profile\uFF08\u9ED8\u8BA4\u5173\u95ED\uFF0C\u5F00\u9500\u53EF\u5FFD\u7565\uFF09";
    perf.appendChild(
      button("\u5237\u65B0\u6027\u80FD", "btn tiny", async () => {
        const response = await task(() => jsonRequest(ENDPOINTS.profileTop(20), "GET"), { dirty: false });
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
      const response = await jsonRequest(ENDPOINTS.ui, "GET");
      if (response?.current) applyUiTokens(response.current.tokens, response.current.mode);
    } catch {
    }
  }
  async function persistElementAppearanceBatch(items) {
    if (!items.length) return;
    const payload = {
      nodes: items.filter((item) => item.kind === "node").map((item) => ({ id: item.id, appearance: item.appearance ?? {} })),
      edges: items.filter((item) => item.kind === "edge").map((item) => ({ id: item.id, appearance: item.appearance ?? {} }))
    };
    const response = await task(() => jsonRequest(ENDPOINTS.sceneAppearance, "PATCH", payload));
    if (!response) return;
    renderInspector();
  }
  async function persistElementAppearance(kind, id, appearance) {
    await persistElementAppearanceBatch([{ kind, id, appearance }]);
  }
  async function openViewDesigner() {
    try {
      const response = await jsonRequest(ENDPOINTS.ui, "GET");
      if (!response) return;
      let current = response.current || response.defaults;
      state.ui.cardDetail = current.node?.show_detail !== false;
      state.ui.cardValue = current.node?.show_value !== false;
      state.ui.cardFields = normalizeCardFields(current.node?.card_fields);
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
      const fieldCatalog = Array.isArray(response.card_fields) ? response.card_fields : [];
      let cardFields = normalizeCardFields(current.node?.card_fields);
      const syncCardFields = () => {
        current.node = current.node || {};
        current.node.card_fields = cardFields.slice();
        current.node.show_detail = cardFields.length > 0;
        current.node.show_value = cardFields.includes("value");
        state.ui.cardFields = cardFields.slice();
        state.ui.cardDetail = cardFields.length > 0;
        state.ui.cardValue = cardFields.includes("value");
        requestDraw();
      };
      const renderCardRows = () => {
        nodeRows.replaceChildren();
        const ordered = [...cardFields, ...fieldCatalog.map((entry) => entry.id).filter((id) => !cardFields.includes(id))];
        for (const [index, id] of ordered.entries()) {
          const entry = fieldCatalog.find((item) => item.id === id);
          const row = div("ui-field wide");
          const input = el("input");
          input.type = "checkbox";
          input.checked = cardFields.includes(id);
          input.dataset.cardField = id;
          input.addEventListener("change", () => {
            cardFields = input.checked ? normalizeCardFields([...cardFields, id]) : cardFields.filter((item) => item !== id);
            syncCardFields();
            renderCardRows();
          });
          row.appendChild(input);
          row.appendChild(el("span", null, entry ? entry.label : id));
          for (const [delta, text, dir] of [[-1, "\u2191", "up"], [1, "\u2193", "down"]]) {
            const move = button(text, "btn tiny", () => {
              const from = cardFields.indexOf(id);
              const to = from + delta;
              if (from < 0 || to < 0 || to >= cardFields.length) return;
              const next = cardFields.slice();
              [next[from], next[to]] = [next[to], next[from]];
              cardFields = next;
              syncCardFields();
              renderCardRows();
            });
            move.dataset.cardMove = dir;
            row.appendChild(move);
          }
          nodeRows.appendChild(row);
        }
      };
      renderCardRows();
      const appearanceRows = div("ui-layout-rows");
      const appearanceTargets = collectAppearanceTargets();
      const appearanceTitle = appearancePanelTitle(appearanceTargets);
      renderAppearancePanel(appearanceRows, appearanceTargets, {
        pushUndo: () => {
          void pushUndoSnapshot();
        },
        persist: persistElementAppearance,
        persistElements: (items) => persistElementAppearanceBatch(items)
      });
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
        el("h4", null, appearanceTitle),
        appearanceRows
      );
      const actions = div("modal-actions");
      actions.appendChild(button("\u5E94\u7528\u5E76\u4FDD\u5B58", "btn primary", async () => {
        const saved = await jsonRequest(ENDPOINTS.ui, "POST", current);
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
      const response = await jsonRequest(ENDPOINTS.plugins, "GET");
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
          await jsonRequest(ENDPOINTS.pluginEnable(plugin.id), "POST", { enabled: plugin.status !== "loaded" });
          await render();
        }));
        actions.appendChild(button("\u91CD\u65B0\u52A0\u8F7D", "btn tiny", async () => {
          await jsonRequest(ENDPOINTS.pluginReload(plugin.id), "POST", {});
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
        await jsonRequest(ENDPOINTS.pluginScan, "POST", {});
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
        ENDPOINTS.blockCompare(spec.id),
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
        ENDPOINTS.blockRename(spec.id),
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
        ENDPOINTS.blockDelete(spec.id),
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
      drawChart({ colorForKey, decodeProbeKey, nearestFrame, state: { chart: state.chart, chartSize: state.chartSize, frames: state.frames, replay: state.replay } });
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
      ui.btnPrecompute.addEventListener("click", () => openPrecomputeDialog("solve"));
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
      const formTarget = isFormTarget(event.target);
      const buttonTarget = formTarget && event.target.tagName === "BUTTON";
      if (formTarget && !(buttonTarget && (event.ctrlKey || event.metaKey))) return;
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
          void openExport(state.workspace === "network" ? "scene-data" : "schematic");
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
      const [catalog, snapshot] = await Promise.all([api(ENDPOINTS.catalog), api(ENDPOINTS.state)]);
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
  initSessionStore({
    scheduleChartDraw,
    clearSelection,
    requestDraw,
    updateModeUI,
    syncUI,
    updateInfoBar,
    showBanner,
    hideBanner,
    updateScenePanelValues,
    updateSignalKeyCache,
    updateInspectorLive,
    renderVectorNodeList,
    schedulePhaseDraw,
    nodeById,
    edgeById
  });
  initAnalysisWorkbenchPanel({ colorForKey, decodeProbeKey, openPrecomputeDialog, applySnapshot });
  initScenePanel({ task, syncUI, updateRunButton, applySnapshot, renderInspector, renderSignalList, fetchNetworks, fitView, snapSceneToGrid, updateModeUI });
  initSceneActions({ task, syncUI, updateRunButton, applySnapshot, renderInspector, renderSignalList, fetchNetworks, fitView, snapSceneToGrid, updateModeUI });
  initReplay({ scheduleChartDraw });
  initSignalList({ colorForKey, scheduleChartDraw });
  setTypeLabelHelp(typeLabelHelp);
  setSwitchTab(switchTab);
  setEmptyInspectorActions({ centerPlacement, openAddMenu, fitView });
  setInspectorActions({ deleteNode, patchNodeGeometry, nodeDiameter, deleteEdge, patchEdgeGeometry, syncUI, updateScenePanelValues, renderInspector, updateSignalKeyCache, refreshState });
  setSpecPanelActions({ attachParamHelp, confirmModal, renderInspector });
  setAnalysisActions({ task, downloadText, phaseStateKeys, C, tokens });
  setAppearanceActions({ drawModulePreview: () => drawModulePreview({ state, ui }), scheduleChartDraw });
  setPlotkitDataActions({ refreshState, renderAnalysisPanel, updateSignalKeyCache });
  setPlotkitFrameActions({ setStatusHint });
  setDocsActions({ loadTemplate });
  setGuideActions({ loadTemplate, refreshTelemetryQuality, renderScenePanel, switchMode });
  setAppearanceControlActions({ openIroColorPopover });
  setGeometryActions({ distance, circuitPinPath, wirePathPoints });
  setInstrumentActions({ scheduleChartDraw });
  setProjectActions({ confirmModal, applySnapshot, syncProjectContext, applyProjectUi, renderScenePanel, renderInspector, renderSignalList, fetchNetworks, fitView, chooseModeModal, task, showHelp });
  setWindowActions({ renderCompareGrid, setWbSignalDock, syncProjectContext, getWbComparePayload });
  loadUiProfile();
  boot();
  setTimeout(checkCacheQuietly, 6e3);
})();
