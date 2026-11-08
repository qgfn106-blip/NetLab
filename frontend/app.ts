import { fmt, intText, clamp, hashString, baseName } from './app.utils.js';
import {
  CANVAS_LIGHT, CANVAS_DARK,
  CHART_PALETTE_HC_LIGHT, CHART_PALETTE_HC_DARK,
  CHART_PALETTE_CB_LIGHT, CHART_PALETTE_CB_DARK,
} from './theme.tokens.js';
import type { AcResultRec, AppearanceRec, BezierRec, BlockItem, BoxRec, CacheEntryRec, CatalogRec, ChartRec, ClipboardRec, ComplexLike, DataHolder, DeclaredItemRec, DegradedItemRec, DegradedRec, DocItem, DragRec, EdgeBodyRec, EdgeItem, ExtItemRec, ExtRec, ExtResultRec, FieldKey, FloatGeo, FloatWindowSpec, FrameItem, HelpInfoRec, HoverRec, HoverWaypointRec, InstrumentRec, IroGlobal, IroPicker, IssueRec, LayoutRec, LimitsRec, MenuItemRec, MultiRec, NetworkItem, NodeItem, OpElementRec, ParamSpec, PayloadRec, PerfRowRec, PointerRec, PortSpec, PrefsRec, PreviewNode, ProjectRec, Pt, RailItemRec, ReplayRec, SceneRec, SelectionRec, SimRec, SimStats, SizeRec, SnapshotRec, SpecRec, SpectrumRec, State, StateSpaceRec, TemplateRec, TfBodeRec, TfDataRec, TfMetricsRec, TfStepRec, Ui, UiPrefsRec, ViewRec, WireToolRec } from './app/types.js';
import { UI_BUILD, PALETTE, GROUP_COLORS, NODE_RADIUS, NODE_W, NODE_H, CHART_KEYS, MAX_IMPORT_BYTES, MAX_FRAMES, INST_COLORS } from './app/constants.js';
import { $, $$, stage, canvas, ctx, chartCanvas, chartCtx, phaseCanvas, phaseCtx, scopeCanvas, scopeCtx, lissCanvas, lissCtx } from './app/dom.js';
import { state, ui } from './app/state.js';
import type { ApiOptions } from './app/net.js';
import { el, div, button, clone, isFormTarget } from './app/ui.js';
import { desktopBridge, isDesktop, callBridge, toast, showBanner, hideBanner } from './app/desktop.js';
import { api, jsonRequest, plotkitFrameUrl } from './app/net.js';
import { openCacheDialog, checkCacheQuietly } from './app/cache.js';
import { placeFloatWindow, placeDocWindow, raiseFloatWindow, toggleFloatMaximize, initFloatWindow } from './app/float.js';
import { CHART_PALETTE, chartPalette, themeKey } from './app/theme.js';
import { hexToRgb, hexToRgbString, mixHex } from './app/color.js';
import { THEME_TOKENS, C, tokens, setRuntimeOverride } from './app/colors.js';
import { formatAny, valueToText, parseSmartValue, kindListFor, buildKindSelect, numberedField, UNIT_PREFIXES, PREFIXABLE_UNITS, unitStorageKey, savedUnitFactor, bestUnitFactor, trimNumber } from './app/fields.js';
import { buildParamField, applyPresetOnModelChange, applyWaveFieldVisibility, buildWaveFieldVisibility, buildParamFields, collectParamValues, dataRow, collectData, markDirty, clearDirty, setTypeLabelHelp } from './app/param_fields.js';
import { hideHelpCard, showHelpCard, typeLabelHelp, paramRangeText, setSwitchTab } from './app/help_card.js';
import { activeTab, modeLabel, selectedNode, selectedEdge, nodeById, edgeById, nodeByName, edgeByName, getNodeSpec, getEdgeSpec, specDefaults, uniqueNodeName, hasGroundNode, displayDataFor, nodeDisplayData, edgeDisplayData } from './app/model.js';
import { sectionLabel, section, buildHeader, renderEmptyInspector, setEmptyInspectorActions } from './app/inspector_shell.js';
import { modulePorts, deviceElementSpec, isPinNode, devicePins, buildDevicePinList } from './app/device_pins.js';
import { renderNodeInspector, renderWireInspector, renderEdgeInspector, applyInspector, updateInspectorLive, setInspectorActions } from './app/inspector.js';
import { renderSpecPane, scheduleSpecRender, renderExtensionPanel, refreshExtensions, setSpecPanelActions } from './app/spec_panel.js';
import { AUTOSAVE_ENABLED_KEY, setProjectActions, setProjectFileInput, markProjectDirty, projectSaved, rememberRecent, loadRecent, updateProjectPanel, buildProjectPayload, projectDownloadText as downloadText, saveProject, importProjectText, openProject, openProjectPath, newProject, recoverAutosave, autosaveProject, maybeOfferRecovery, initProject } from './app/project.js';
import { setGeometryActions, worldToScreen, screenToWorld, nodeDiameter, nodeRect, isModuleNode, devicePinGroups, deviceWorldSize, deviceRect, devicePinLocal, devicePinWired, deviceSupplyLabel, deviceMissingPins, deviceImplicitGroundPin, deviceInactive, devicePinScreen, snapWorld, portOut, portIn, curveFor, nodeCenterScreen, anchorPoint, edgeEndpointHit, waypointHitAt, anchorSideFor, anchorScreenPoint, edgePathPoints, pathSegments, pathPointAt, pathMidpoint, pathEndAngle, distanceToPath, vectorForNode, bezierPoint } from './app/geometry.js';
import { analysisSignalKey, analysisGet, setAnalysisOutput, runAnalysisMetrics, runAnalysisSpectrum, runAnalysisPeriod, runAnalysisMath, runAnalysisTransfer, fmtComplex, analysisTFSummary, runAnalysisTF, drawAnalysisTF, tfRange, drawTFBode, tfBodeCursorFromEvent, attachTfCursor, drawTFStep, drawTFPoles, exportTFStateSpace, sendCurveToPlotKit, sendTFToPlotKit, phaseSeriesForPlotKit, sendPhaseToPlotKit, exportAnalysisCsv, drawAnalysisSpectrum, setAnalysisActions } from './app/analysis.js';
import { circuitMidAngle, drawCircuitGlyph, circuitWireGap, drawJunctionDots, elementPins, elementLayoutCenter, elementRot, symbolScalePx } from './app/circuit_symbols.js';
declare function setStatusHint(hint: string): void;

/* Netlab 拓扑网络仿真台 — 前端交互脚本
 *
 * 设计约束：
 *  - 纯浏览器端 ES2020，无构建步骤、无第三方依赖；
 *  - 所有用户内容一律用 textContent / value 写入，绝不拼接 innerHTML；
 *  - 参数表单完全由 /api/catalog 的 ParamSpec 生成，前后端共用一套校验语义；
 *  - 画布使用 devicePixelRatio 缩放，交互命中测试在屏幕坐标中完成；
 *  - 仿真数据只通过 JSON 与后端交换，页面内不执行任何用户代码。
 */
(() => {
  'use strict';





  // 浏览器模式的工程文件选择器（桌面模式走原生对话框）。
  let projectFileInput: HTMLInputElement | null = null;



  function colorForKey(key: string): string {
    // P-A4：按当前「画布配色」档位取色。默认「跟随主题」仍用 CHART_PALETTE 并经 C() 映射令牌；
    // 高对比/色盲友好用替代色板原样值（不经 C() 重映射，保持其精确色值）。
    const palette = chartPalette();
    const raw = palette[hashString(key) % palette.length];
    const mode = String((state.prefs && state.prefs.chartPalette) || 'theme');
    return mode === 'theme' ? C(raw) : raw;
  }

  interface TaskOptions {
    dirty?: boolean;
    history?: boolean;
    silent?: boolean;
    [k: string]: unknown;
  }



  /* ======================================================================
   * 0. 桌面模式会话
   * ==================================================================== */

  // 桌面外壳通过 ?token= 传入会话 token；读取后立刻从地址栏移除。


  async function task<T>(run: () => T | Promise<T>, options: TaskOptions = {}): Promise<T | null> {
    if (state.busy) {
      toast('上一条操作还在处理中，请稍候…', 'info', 1500);
      return null;
    }
    state.busy = true;
    try {
      if (options.dirty !== false && options.history !== false) await pushUndoSnapshot();
      const result = await run();
      // 默认把成功的写操作标记为"工程已修改"；运行/暂停等控制操作显式跳过。
      if (options.dirty !== false) markProjectDirty();
      return result;
    } catch (error) {
      const message = (error as Error)?.message || String(error);
      if (!options.silent) toast(message, 'error', 7000);
      if (/电路|代数环|接地|引擎|求逆|奇异|发散|未收敛|有限元/.test(message)) showBanner(message);
      return null;
    } finally {
      state.busy = false;
    }
  }

  /* ======================================================================
   * 2. 快照同步与全局 UI
   * ==================================================================== */

  function applySnapshot(snapshot: SnapshotRec) {
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.scene) return;
    const sim = snapshot.sim || state.sim;
    const previousCursor = state.cursor;
    const resetFrames = !state.sim || (sim && sim.steps === 0 && sim.time === 0);

    state.scene = snapshot.scene;
    state.sim = sim;
    // 电路变了（revision 变化），旧的扫频结果不再成立：清掉缓存并提示重算
    const nextRevision = snapshot.scene.revision ?? null;
    if (state.acResult && state.acRevision !== null && nextRevision !== state.acRevision) {
      state.acResult = null;
      const acMeta = $('#analAcMeta');
      if (acMeta) acMeta.textContent = '电路已变化，请重新扫频';
      if (ui.analWin && !ui.analWin.hidden) requestAnimationFrame(() => drawAcChart());
    }
    state.acRevision = nextRevision;
    // 场景被重置或替换后，旧预计算数据不再对应，恢复“首次运行提示”
    if (resetFrames || (state.precomputedRevision != null && nextRevision !== state.precomputedRevision)) {
      state.precomputedSeconds = null;
      state.precomputedRevision = null;
    }
    if (snapshot.limits) state.limits = snapshot.limits;
    state.mode = state.scene!.mode || state.mode;

    if (resetFrames || (sim && Number(sim.cursor) < previousCursor)) {
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
    // 场景被换掉/节点被删后，多选集合里的旧 id 要清掉，否则「封装选中」
    // 会拿着一批已经不存在的节点去请求，后端只能报「节点不存在」。
    const liveNodes = new Set((state.scene?.nodes || []).map((node) => node.id));
    const liveEdges = new Set((state.scene?.edges || []).map((edge) => edge.id));
    let staleSelection = false;
    for (const id of [...(state.multi?.nodes || [])]) {
      if (!liveNodes.has(id)) {
        state.multi.nodes.delete(id);
        staleSelection = true;
      }
    }
    for (const id of [...(state.multi?.edges || [])]) {
      if (!liveEdges.has(id)) {
        state.multi.edges.delete(id);
        staleSelection = true;
      }
    }
    if (staleSelection) requestDraw();
    updateModeUI();
    syncUI();
    updateInfoBar();
    const degraded = (sim && sim.degraded) as DegradedRec | null;
    if (degraded && degraded.read_only) {
      const missing = (degraded.missing || []).map((item: DegradedItemRec) => `${item.id}@v${item.version}`).join('、');
      showBanner(`降级只读：${degraded.message}${missing ? `（缺失：${missing}）` : ''}`);
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
    if (state.selection.type === 'node') return nodeById(state.selection.id);
    if (state.selection.type === 'edge') return edgeById(state.selection.id);
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
    ui.simFps.title = `目标 ${sim.config?.fps ?? '—'} fps · 实际 ${(sim.actual_fps ?? 0).toFixed(1)}`;

    const nodes = state.scene?.nodes?.length ?? 0;
    const edges = state.scene?.edges?.length ?? 0;
    const maxNodes = state.catalog?.limits?.nodes ?? state.limits?.nodes ?? 400;
    const maxEdges = state.catalog?.limits?.edges ?? state.limits?.edges ?? 1200;
    ui.statusLimits.textContent = `节点 ${nodes}/${maxNodes} · 连接 ${edges}/${maxEdges}`;
    ui.statusMode.textContent = modeLabel(state.mode);

    const stats = (sim.scene || {}) as SimStats;
    const revision = state.scene?.revision ?? 0;
    if (stats.kind === 'circuit') {
      ui.statusEngine.textContent = `MNA ${stats.matrix_size || 0}×${stats.matrix_size || 0}`;
    } else if (stats.kind === 'vector') {
      ui.statusEngine.textContent = `矢量流 · rev ${revision}`;
    } else if (stats.kind === 'signal') {
      ui.statusEngine.textContent = `字典流 · rev ${revision}`;
    } else {
      ui.statusEngine.textContent = '—';
    }

    let hint = sim.running ? '运行中' : '已暂停';
    if (sim.config) {
      hint += ` · ${sim.config.fps} fps × ${sim.config.steps_per_frame} 步 · dt ${fmt(sim.config.dt, 3)}`;
    }
    ui.statusHint.textContent = hint;

    const engineError = state.scene?.engine_error || null;
    const simError = sim.error || null;
    const message = simError || engineError;
    if (message) {
      if (state.dismissedError !== message) showBanner((message as string));
    } else {
      state.dismissedError = null;
      hideBanner();
    }

    ui.zoomBadge.textContent = `${Math.round(state.view.k * 100)}%`;
    ui.modePill.classList.toggle('circuit', state.mode === 'circuit');
    ui.modePill.classList.toggle('vector', state.mode === 'vector');
    ui.modePill.textContent = modeLabel(state.mode);

    updateScenePanelValues();
    schedulePhaseDraw();
  }

  function updateModeUI() {
    ui.modePill.classList.toggle('circuit', state.mode === 'circuit');
    ui.modePill.classList.toggle('vector', state.mode === 'vector');
    ui.modePill.textContent = modeLabel(state.mode);
    ui.statusMode.textContent = modeLabel(state.mode);
    ui.main.dataset.mode = state.mode;
    const modeHost = $('[data-role="mode"]');
    if (modeHost) {
      $$('button[data-mode]', modeHost).forEach((item) => {
        item.classList.toggle('active', item.dataset.mode === state.mode);
      });
    }
    const integration = $('[data-role="integration"]');
    if (integration) {
      (integration as HTMLButtonElement).disabled = state.mode !== 'circuit';
      if (state.scene) (integration as HTMLInputElement).value = (state.scene.integration || 'trapezoidal') as string;
    }
    const integrationNote = $('[data-role="integration-note"]');
    if (integrationNote) {
      integrationNote.textContent = state.mode === 'circuit'
        ? '梯形法精度高；后向欧拉更稳定，适合刚性电路。'
        : '仅电路模式使用；信号 / 矢量层由每条连接的离散化参数决定。';
    }
  }

  function updateRunButton(running: boolean) {
    ui.runBtn.classList.toggle('running', Boolean(running));
    ui.runBtn.setAttribute('aria-pressed', running ? 'true' : 'false');
    ui.runIcon.textContent = running ? '⏸' : '▶';
    ui.runLabel.textContent = running ? '暂停' : '运行';
    ui.runBtn.title = running ? '暂停（空格）' : '运行（空格）';
  }

  function frameCap() {
    const keys = Math.max(1, Number(state.sim?.probe_keys?.length) || state.values.size || 1);
    return Math.min(MAX_FRAMES, Math.max(600, Math.floor(250000 / keys)));
  }

  function updateSignalKeyCache() {
    const keys = Array.isArray(state.sim?.probe_keys) ? state.sim.probe_keys : [];
    const signature = keys.join('\u0001');
    if (signature === state.probeSignature) return;
    state.probeSignature = signature;
    state.probeKeys = keys;

    // 重置后 probe_keys 会短暂为空：保留用户探针选择，避免“重置即清空通道”。
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
      keys.slice(0, 2).forEach((key: string) => state.chart.selected.add(key));
    }
    renderSignalList();
    fillInstrumentSelects();
    scheduleChartDraw();
  }

  function ingestFrame(frame: FrameItem) {
    if (!frame || !frame.v) return;
    for (const [key, raw] of Object.entries(frame.v)) {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
      state.values.set(key, raw);
      if (key.startsWith('n:')) {
        const rest = key.slice(2);
        const cut = rest.lastIndexOf(':');
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
      } else if (key.startsWith('e:')) {
        const rest = key.slice(2);
        const cut = rest.lastIndexOf(':');
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
    const wrap = $('.chart-wrap');
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

  function roundRectPath(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
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

  const KIND_SHORT = {
    manual: 'MANUAL',
    sum: 'SUM',
    gain: 'GAIN',
    lag: 'LAG',
    integrate: 'INT',
    signal: 'SIGNAL',
    expression: 'EXPR',
    state_space: 'STATE',
    clip: 'CLIP',
    oscillator: 'OSC',
    nonlinear_plant: 'PLANT',
    sliding_mode: 'SMC',
    vector_transform: 'VECTOR',
    node: 'NODE',
    ground: 'GROUND',
  };

  const KIND_COLORS = {
    oscillator: '#a8541f',
    nonlinear_plant: '#1f5f5b',
    sliding_mode: '#7a4a7c',
    vector_transform: '#4a6f8a',
  };

  function nodeColor(node: NodeItem) {
    if (node.kind === 'ground') return C('#6f695f');
    if (state.mode === 'circuit') return C('#9a6a1c');
    if (KIND_COLORS[node.kind as keyof typeof KIND_COLORS]) return C(KIND_COLORS[node.kind as keyof typeof KIND_COLORS]);
    const spec = getNodeSpec(node.kind);
    return C(GROUP_COLORS[spec?.group as keyof typeof GROUP_COLORS] || '#a8541f');
  }

  function nodeKindLabel(node: NodeItem) {
    return KIND_SHORT[node.kind as keyof typeof KIND_SHORT] || String(node.kind || '').toUpperCase().slice(0, 9);
  }

  function nodeValueText(node: NodeItem) {
    const data = nodeDisplayData(node);
    const fields = Object.keys(data).filter((key: string) => typeof data[key] === 'number' && Number.isFinite(data[key]));
    if (!fields.length) return '—';
    const preferred = ['voltage', 'value', 'y0', 'output', 'acc', 'x1', 'x', 'y', 'vx', 'vy']
      .find((key: string) => fields.includes(key));
    const ordered = preferred ? [preferred, ...fields.filter((key: string) => key !== preferred)] : fields;
    return ordered.slice(0, 2).map((key: string) => `${key} ${fmt(data[key], 3)}`).join('  ·  ');
  }

  function edgeValueText(edge: EdgeItem) {
    const data = edgeDisplayData(edge);
    const field = ['current', 'voltage_difference', 'power', 'voltage']
      .find((key: string) => typeof data[key] === 'number');
    return field ? `${field} ${fmt(data[field], 3)}` : '';
  }

  const __gridPattern: { key: string; pattern: CanvasPattern | null } = { key: '', pattern: null };
  function gridPattern(step: number, dpr: number, color: string) {
    const key = `${step.toFixed(3)}|${dpr}|${color}`;
    if (__gridPattern.key === key) return __gridPattern.pattern;
    try {
      const tile = document.createElement('canvas');
      const size = Math.max(1, Math.round(step * dpr));
      tile.width = size;
      tile.height = size;
      const tctx = tile.getContext('2d');
      tctx!.scale(dpr, dpr);
      tctx!.fillStyle = color;
      tctx!.fillRect(0, 0, 1, 1);
      __gridPattern.key = key;
      __gridPattern.pattern = ctx.createPattern(tile, 'repeat');
    } catch (error) {
      __gridPattern.key = key;
      __gridPattern.pattern = null;
    }
    return __gridPattern.pattern;
  }

  function drawGrid(width: number, height: number) {
    if (state.ui?.showGrid === false || state.ui?.drawingMode) return;
    let step = (Number(state.ui?.grid) || 20) * state.view.k;
    while (step < 12) step *= 2;
    while (step > 84) step /= 2;
    const ox = ((state.view.x % step) + step) % step;
    const oy = ((state.view.y % step) + step) % step;

    // 网格点用 CanvasPattern 平铺：一次 fillRect 取代 (w/step)*(h/step) 次 1px 填充
    // （1400×900、步距 20 时原本每帧 3000+ 次 fillRect，是画布重绘的主要开销）。
    const pattern = gridPattern(step, state.canvasSize?.dpr || 1, tokens().gridDot);
    if (pattern) {
      ctx.save();
      ctx.translate(Math.round(ox), Math.round(oy));
      ctx.fillStyle = pattern;
      ctx.fillRect(-1, -1, width + 2, height + 2);
      ctx.restore();
    } else {
      ctx.fillStyle = tokens().gridDot;
      for (let x = ox; x < width; x += step) {
        for (let y = oy; y < height; y += step) {
          ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
        }
      }
    }

    if (state.view.x > 0 && state.view.x < width) {
      ctx.strokeStyle = tokens().gridAxis;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(state.view.x) + 0.5, 0);
      ctx.lineTo(Math.round(state.view.x) + 0.5, height);
      ctx.stroke();
    }
    if (state.view.y > 0 && state.view.y < height) {
      ctx.strokeStyle = tokens().gridAxis;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(state.view.y) + 0.5);
      ctx.lineTo(width, Math.round(state.view.y) + 0.5);
      ctx.stroke();
    }

    // CAD 式捕捉点：拖动时高亮最近的网格交点
    const dragging = state.drag && ['node', 'waypoint', 'resize', 'endpoint'].includes((state.drag.type as string));
    const pointer = state.pointer;
    if (
      dragging
      && state.ui?.snapMarkers !== false
      && state.ui?.snap
      && pointer
      && Number.isFinite(pointer.x)
      && Number.isFinite(pointer.y)
    ) {
      const grid = Number(state.ui?.grid) || 20;
      const snapped = {
        x: Math.round(pointer.x / grid) * grid,
        y: Math.round(pointer.y / grid) * grid,
      };
      const sp = (worldToScreen as Function)(snapped.x, snapped.y);
      const size = 7;
      ctx.strokeStyle = C('rgba(168, 84, 31, 0.85)');
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(sp.x - size, sp.y);
      ctx.lineTo(sp.x + size, sp.y);
      ctx.moveTo(sp.x, sp.y - size);
      ctx.lineTo(sp.x, sp.y + size);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, size + 3, 0, Math.PI * 2);
      ctx.strokeStyle = C('rgba(168, 84, 31, 0.35)');
      ctx.stroke();
    }
  }




  function pinScreenPoint(edge: EdgeItem, pin: { name: string; x: number; y: number; [k: string]: unknown }, points: Array<{ x: number; y: number }>, scale: number = 1) {
    const center = elementLayoutCenter(edge, points);
    const angle = elementRot(edge);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const unit = state.view.k * scale;
    const wx = center.x + (pin.x * cos - pin.y * sin) * unit;
    const wy = center.y + (pin.x * sin + pin.y * cos) * unit;
    return { x: wx, y: wy };
  }

  function edgeAnchorTowards(node: NodeItem, otherNode: NodeItem | null) {
    const other = nodeCenterScreen((otherNode as NodeItem));
    return anchorPoint(node, 'auto', other);
  }

  function circuitPinPath(edge: EdgeItem, source: NodeItem, target: NodeItem) {
    if (state.scene?.mode !== 'circuit' || state.ui?.symbol !== 'gb') return null;
    if (edge.kind === 'wire') return null;
    if (!edge.layout) return null;
    // 手动布线的边以 waypoints 为准，不再被引脚吸附改写。
    if (edge.route === 'manual' && Array.isArray(edge.waypoints) && edge.waypoints.length) return null;
    const pins = elementPins(edge);
    if (pins.length !== 2) return null; // 多引脚元件的输出端单独处理
    const binds = new Set(pins.map((pin: PortSpec) => pin.bind));
    if (!binds.has('source') || !binds.has('target')) return null; // 参数绑定的 2 引脚（变压器副边等）
    const start = edgeAnchorTowards(source, target);
    const end = edgeAnchorTowards(target, source);
    const pin1 = pinScreenPoint(edge, pins[0], [start, end]);
    const pin2 = pinScreenPoint(edge, pins[1], [start, end]);
    return [start, pin1, pin2, end];
  }

  function wirePathPoints(edge: EdgeItem, source: Pt, target: Pt) {
    const start = isPinNode((source as NodeItem))
      ? devicePinScreen((source as NodeItem), (edge.source_pin as string))
      : anchorPoint((source as NodeItem), 'auto', nodeCenterScreen((target as NodeItem)));
    const end = isPinNode((target as NodeItem))
      ? devicePinScreen((target as NodeItem), (edge.target_pin as string))
      : anchorPoint((target as NodeItem), 'auto', nodeCenterScreen((source as NodeItem)));
    let route = edge.route || 'auto';
    if (route === 'auto' && state.ui?.circuitOrthogonal !== false) route = 'orthogonal';
    if (route === 'manual' && Array.isArray(edge.waypoints) && edge.waypoints.length) {
      return [start, ...edge.waypoints.map((item: Pt) => worldToScreen(item)), end];
    }
    if (route === 'straight') return [start, end];
    if (Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)) {
      const midX = (start.x + end.x) / 2;
      return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
    }
    const midY = (start.y + end.y) / 2;
    return [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
  }

  function drawMultiPinWires(edge: EdgeItem, color: string) {
    if (state.scene?.mode !== 'circuit' || state.ui?.symbol !== 'gb' || !edge.layout) return;
    const pins = elementPins(edge);
    // 多引脚元件（运放/ADC/变压器…）主路径不画，所有引脚都由这里接线；
    // 两端元件只补参数绑定的引脚（主路径已在 drawEdges 画出）。
    const multi = pins.length > 2;
    const source = nodeById(edge.source);
    const target = nodeById(edge.target);
    if (!source || !target) return;
    const points = [nodeCenterScreen(source), nodeCenterScreen(target)];
    const center = elementLayoutCenter(edge, points);
    for (const pin of pins) {
      if (!pin.bind) continue;
      if (!multi && (pin.bind === 'source' || pin.bind === 'target')) continue;
      const nodeId = pin.bind === 'source'
        ? edge.source
        : pin.bind === 'target'
          ? edge.target
          : edge.params?.[pin.bind];
      const node = nodeId ? nodeById((nodeId as string)) : null;
      if (!node) continue;
      const from = pinScreenPoint(edge, pin, points, symbolScalePx());
      const to = anchorPoint(node, 'auto', center);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.0;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(to.x, to.y, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = C('#f7f4ec');
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  function elementIdentifier(edge: EdgeItem) {
    // GB 标识：位号 + 极性/类型简称；名称本身已是 R1/C1 时直接用。
    const name = String(edge.name || '');
    const kind = String(edge.kind || '');
    if (name) return name;
    const prefix = {
      resistor: 'R', capacitor: 'C', inductor: 'L', diode: 'D', led: 'LED',
      zener: 'ZD', vsource: 'V', isource: 'I', switch: 'S', opamp: 'U',
      comparator: 'U', dflipflop: 'U', vcvs: 'E', vccs: 'G',
      npn: 'Q', pnp: 'Q', nmos: 'Q', pmos: 'Q',
      transformer: 'T', coupling_inductor: 'L', adc4: 'U',
    }[kind] || kind.slice(0, 2).toUpperCase();
    return `${prefix}?`;
  }


  function segmentIntersection(a: Pt, b: Pt, c: Pt, d: Pt) {
    const r = { x: b.x - a.x, y: b.y - a.y };
    const s = { x: d.x - c.x, y: d.y - c.y };
    const denom = r.x * s.y - r.y * s.x;
    if (Math.abs(denom) < 1e-9) return null;
    const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom;
    const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denom;
    if (t <= 0.02 || t >= 0.98 || u <= 0.02 || u >= 0.98) return null;
    return { x: a.x + r.x * t, y: a.y + r.y * t };
  }

  function circuitCrossingMap(edges: EdgeItem[]) {
    const map = new Map();
    if (state.scene?.mode !== 'circuit' || state.ui?.symbol !== 'gb' || edges.length > 160) return map;
    const paths = edges.map((edge: EdgeItem) => ({ id: edge.id, points: edgePathPoints(edge) || [] }));
    for (let i = 0; i < paths.length; i += 1) {
      for (let j = i + 1; j < paths.length; j += 1) {
        const first = paths[i];
        const second = paths[j];
        if (!first.points.length || !second.points.length) continue;
        const points = [];
        for (let a = 1; a < first.points.length; a += 1) {
          for (let b = 1; b < second.points.length; b += 1) {
            const hit = segmentIntersection(first.points[a - 1], first.points[a], second.points[b - 1], second.points[b]);
            if (hit) points.push(hit);
          }
        }
        if (points.length) map.set(second.id, [...(map.get(second.id) || []), ...points]);
      }
    }
    return map;
  }

  function drawCrossingHops(points: Array<{ x: number; y: number }>, color: string) {
    for (const point of points) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = C('#f7f4ec');
      ctx.fill();
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4.2, Math.PI * 1.05, Math.PI * 1.95);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.restore();
    }
  }

  function labelCollisionFree(cx: number, cy: number, width: number, height: number, occupied: BoxRec[]) {
    const candidates = [
      [0, 0], [0, -14], [0, 14], [0, -28], [0, 28],
      [width / 2 + 12, 0], [-width / 2 - 12, 0],
    ];
    for (const [dx, dy] of candidates) {
      const rect = { x: cx + dx - width / 2, y: cy + dy - height / 2, w: width, h: height };
      const hit = occupied.some((item: BoxRec) =>
        rect.x < item.x + item.w && rect.x + rect.w > item.x && rect.y < item.y + item.h && rect.y + rect.h > item.y);
      if (!hit) return rect;
    }
    return { x: cx - width / 2, y: cy - height / 2, w: width, h: height };
  }

  const SHEET_SIZES: Record<string, { w: number; h: number; label: string }> = {
    A4: { w: 297, h: 210, label: 'A4' },
    A3: { w: 420, h: 297, label: 'A3' },
    A2: { w: 594, h: 420, label: 'A2' },
    A1: { w: 841, h: 594, label: 'A1' },
  };

  // R18：只电路模式的出图视图——GB 图幅、分区刻度、标题栏、页号。
  function drawDrawingFrame(width: number, height: number) {
    if (state.scene?.mode !== 'circuit') return;
    const sheet = SHEET_SIZES[String(state.ui?.drawingSheet || 'A3')] || SHEET_SIZES.A3;
    const page = Math.max(1, Math.min(9, Number(state.ui?.drawingPage) || 1));
    const margin = 12;
    const scale = Math.min((width - margin * 2) / sheet.w, (height - margin * 2) / sheet.h);
    const pw = sheet.w * scale;
    const ph = sheet.h * scale;
    const x = (width - pw) / 2;
    const y = (height - ph) / 2;
    ctx.save();
    ctx.fillStyle = C('#fffdf8');
    ctx.fillRect(x, y, pw, ph);
    ctx.strokeStyle = C('#3b352c');
    ctx.lineWidth = 2.2;
    ctx.strokeRect(x, y, pw, ph);
    ctx.lineWidth = 0.9;
    ctx.strokeRect(x + 4, y + 4, pw - 8, ph - 8);

    // 分区刻度：纵向 1..8、横向 A..F（GB/T 14689 简化）。
    const cols = 8;
    const rows = 6;
    ctx.font = '9px "Cascadia Code", Consolas, monospace';
    ctx.fillStyle = C('#5b554b');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 1; i < cols; i += 1) {
      const gx = x + (pw * i) / cols;
      ctx.beginPath(); ctx.moveTo(gx, y + 4); ctx.lineTo(gx, y + 12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gx, y + ph - 4); ctx.lineTo(gx, y + ph - 12); ctx.stroke();
      ctx.fillText(String(i), gx, y + 16);
      ctx.fillText(String(i), gx, y + ph - 16);
    }
    for (let i = 1; i < rows; i += 1) {
      const gy = y + (ph * i) / rows;
      ctx.beginPath(); ctx.moveTo(x + 4, gy); ctx.lineTo(x + 12, gy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + pw - 4, gy); ctx.lineTo(x + pw - 12, gy); ctx.stroke();
      ctx.fillText(String.fromCharCode(64 + i), x + 16, gy);
      ctx.fillText(String.fromCharCode(64 + i), x + pw - 16, gy);
    }

    // 标题栏（GB 简化块），固定贴右下。
    const boxW = Math.min(pw * 0.58, 180 * scale);
    const boxH = Math.min(ph * 0.22, 56 * scale);
    const bx = x + pw - 4 - boxW;
    const by = y + ph - 4 - boxH;
    ctx.fillStyle = C('#fffdf8');
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = C('#3b352c');
    ctx.lineWidth = 1.1;
    ctx.strokeRect(bx, by, boxW, boxH);
    ctx.beginPath();
    ctx.moveTo(bx, by + boxH * 0.52); ctx.lineTo(bx + boxW, by + boxH * 0.52);
    ctx.moveTo(bx + boxW * 0.62, by); ctx.lineTo(bx + boxW * 0.62, by + boxH);
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = C('#11100e');
    ctx.font = '600 11px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.fillText(state.project?.name || '未命名工程', bx + 8, by + 14);
    ctx.font = '9px "Cascadia Code", Consolas, monospace';
    ctx.fillStyle = C('#6f695f');
    ctx.fillText(`${state.currentNetwork?.name || '网络'} · ${sheet.label} · 第 ${page} 页`, bx + 8, by + 30);
    ctx.fillText(`比例 1:1 · ${pipeModeLabel(state.scene?.mode || '')}`, bx + 8, by + boxH - 12);
    ctx.textAlign = 'right';
    ctx.fillText('NetLab / GB', bx + boxW - 8, by + 14);
    ctx.fillText(new Date().toISOString().slice(0, 10), bx + boxW - 8, by + boxH - 12);
    ctx.restore();
  }

  function pipeModeLabel(mode: string) {
    if (mode === 'circuit') return '电路';
    if (mode === 'vector') return '矢量场';
    if (mode === 'signal') return '信号流';
    return mode;
  }


  function circuitPinSegments(edge: EdgeItem, source: NodeItem, target: NodeItem) {
    if (state.scene?.mode !== 'circuit' || state.ui?.symbol !== 'gb' || !edge.layout) return null;
    const pins = elementPins(edge);
    if (pins.length !== 2) return null;
    const start = edgeAnchorTowards(source, target);
    const end = edgeAnchorTowards(target, source);
    const pin1 = pinScreenPoint(edge, pins[0], [start, end]);
    const pin2 = pinScreenPoint(edge, pins[1], [start, end]);
    const horizontal = Math.abs(Math.cos(elementRot(edge))) > 0.5;
    const before = horizontal
      ? [start, { x: pin1.x, y: start.y }, { x: pin1.x, y: pin1.y }, pin1]
      : [start, { x: start.x, y: pin1.y }, { x: pin1.x, y: pin1.y }, pin1];
    const after = horizontal
      ? [pin2, { x: pin2.x, y: end.y }, { x: end.x, y: end.y }, end]
      : [pin2, { x: pin2.x, y: end.y }, { x: end.x, y: end.y }, end];
    return { before, after };
  }

  function drawEdges(now: number) {
    const edges = (state.scene?.edges || []).slice().sort((a, b) => {
      if (a.id === state.selection.id) return 1;
      if (b.id === state.selection.id) return -1;
      return 0;
    });
    const crossingMap = circuitCrossingMap(edges);
    const occupiedLabels = [];
    for (const edge of edges) {
      const points = edgePathPoints(edge);
      if (!points || points.length < 2) continue;
      const selected =
        (state.selection.type === 'edge' && state.selection.id === edge.id) ||
        state.multi?.edges?.has(edge.id);
      const hovered = state.hover?.type === 'edge' && state.hover.id === edge.id;
      let color: string = tokens().edgeDefault;
      if (!edge.enabled) color = tokens().edgeDisabled;
      else if (edge.delay) color = tokens().edgeDelay;
      if (selected) color = C('#a8541f');
      else if (hovered) color = tokens().edgeHover;
      const ap = appearanceOf(edge);
      if (ap.color) color = ap.color;

      ctx.save();
      if (ap.opacity !== undefined) ctx.globalAlpha = clamp(ap.opacity, 0.05, 1);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = color;
      ctx.lineWidth = ap.lineWidth !== undefined ? ap.lineWidth : selected ? 2.1 : hovered ? 1.7 : state.ui?.drawingMode ? (edge.kind === 'wire' ? 1.75 : 1.3) : 1.15;
      if (!edge.enabled) ctx.setLineDash([3, 5]);
      else if (edge.delay) ctx.setLineDash([7, 5]);
      const circuitGb = state.scene?.mode === 'circuit' && state.ui?.symbol === 'gb';
      const multiPin = circuitGb && elementPins(edge).length > 2;
      if (!multiPin) {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length; index += 1) {
          ctx.lineTo(points[index].x, points[index].y);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);

      if (circuitGb) {
        const hops = crossingMap.get(edge.id);
        if (hops && hops.length) drawCrossingHops(hops, color);
        drawMultiPinWires(edge, color);
        const middle = pathMidpoint(points);
        const layout = edge.layout || null;
        const center = layout && Number.isFinite(layout.x) && Number.isFinite(layout.y)
          ? worldToScreen({ x: layout.x, y: layout.y })
          : middle;
        if (center && !multiPin && edge.kind !== 'wire') circuitWireGap(points, center, 40 * Math.max(1.2, state.view.k));
        drawCircuitGlyph(edge, points, color);
      } else {
        const angle = pathEndAngle(points);
        const tip = points[points.length - 1];
        const size = selected ? 8 : 6;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(tip.x - size * Math.cos(angle - 0.42), tip.y - size * Math.sin(angle - 0.42));
        ctx.lineTo(tip.x - size * Math.cos(angle + 0.42), tip.y - size * Math.sin(angle + 0.42));
        ctx.closePath();
        ctx.fill();
      }

      if (state.view.k > 0.38 && edge.kind !== 'wire') {
        const middle = pathMidpoint(points);
        const label = edge.delay ? `${edge.name}  z⁻¹` : elementIdentifier(edge);
        const labelRot = edge.layout && Number.isFinite(Number(edge.layout.rot))
          ? (Number(edge.layout.rot) * Math.PI) / 180
          : circuitMidAngle(points);
        const vertical = Math.abs(Math.sin(circuitGb ? labelRot : 0)) > 0.5;
        let labelX = middle.x;
        let labelY = middle.y - (circuitGb ? (vertical ? 0 : 24) : 16);
        ctx.textAlign = 'center';
        if (circuitGb && vertical) {
          labelX = middle.x + 20;
          labelY = middle.y - 2;
          ctx.textAlign = 'left';
        }
        ctx.font = `${ap.fontSize !== undefined ? ap.fontSize : 9}px "Cascadia Code", Consolas, monospace`;
        ctx.textBaseline = 'middle';
        const textWidth = ctx.measureText(label).width;
        const boxW = textWidth + 8;
        const labelRect = labelCollisionFree(
          ctx.textAlign === 'left' ? labelX + boxW / 2 : labelX,
          labelY,
          boxW,
          12,
          occupiedLabels,
        );
        occupiedLabels.push(labelRect);
        if (ctx.textAlign === 'left') {
          labelX = labelRect.x + 4;
        } else {
          labelX = labelRect.x + boxW / 2;
        }
        labelY = labelRect.y + 6;
        const boxLeft = labelRect.x;
        ctx.fillStyle = tokens().labelBg;
        ctx.fillRect(boxLeft, labelY - 6, boxW, 12);
        ctx.fillStyle = selected ? C('#a8541f') : tokens().labelText;
        ctx.fillText(label, labelX, labelY);
        if (selected && !circuitGb) {
          const value = edgeValueText(edge);
          if (value) {
            ctx.fillStyle = C('#1f5f5b');
            ctx.font = '9px "Cascadia Code", Consolas, monospace';
            ctx.fillText(value, middle.x, middle.y + 5);
          }
        }
      }

      if (state.ui?.drawingMode && state.ui?.drawingLabels && state.view.k > 0.42) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '8px "Cascadia Code", Consolas, monospace';
        const mid = pathMidpoint(points);
        if (edge.kind === 'wire' && mid) {
          const text = edge.name || 'W';
          const w = ctx.measureText(text).width + 6;
          ctx.fillStyle = tokens().labelBg2;
          ctx.fillRect(mid.x - w / 2, mid.y - 12, w, 11);
          ctx.fillStyle = C('#5b554b');
          ctx.fillText(text, mid.x, mid.y - 6.5);
        } else {
          ctx.fillStyle = C('#5b554b');
          ctx.fillText('1', points[0].x + 6, points[0].y - 6);
          ctx.fillText('2', points[points.length - 1].x - 6, points[points.length - 1].y - 6);
        }
      }

      if (selected) {
        const handles = [
          { p: points[0], end: 'source' },
          { p: points[points.length - 1], end: 'target' },
        ];
        for (const handle of handles) {
          const active = state.drag?.type === 'endpoint' && state.drag.id === edge.id && state.drag.end === handle.end;
          ctx.beginPath();
          ctx.arc(handle.p.x, handle.p.y, active ? 6 : 4.5, 0, Math.PI * 2);
          ctx.fillStyle = active ? C('#a8541f') : C('#faf8f2');
          ctx.fill();
          ctx.strokeStyle = C('#a8541f');
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        if (state.drag?.type === 'endpoint' && state.drag.id === edge.id) {
          const node = nodeById(state.drag.end === 'source' ? edge.source : edge.target);
          if (node && state.drag.anchor !== 'auto') {
            const snapPoint = anchorScreenPoint(node, (state.drag.anchor as string));
            ctx.beginPath();
            ctx.arc(snapPoint.x, snapPoint.y, 7, 0, Math.PI * 2);
            ctx.fillStyle = C('rgba(168, 84, 31, 0.18)');
            ctx.fill();
            ctx.strokeStyle = C('#a8541f');
            ctx.lineWidth = 1.4;
            ctx.stroke();
          }
        }
      }

      if (edge.route === 'manual' && (selected || state.drag?.type === 'waypoint' || state.hoverWaypoint?.edgeId === edge.id)) {
        for (const item of edge.waypoints || []) {
          const point = (worldToScreen as Function)(item.x, item.y);
          const index = (edge.waypoints || []).indexOf(item);
          const active = (state.drag?.type === 'waypoint' && state.drag.id === edge.id && state.drag.index === index)
            || (state.hoverWaypoint?.edgeId === edge.id && state.hoverWaypoint.index === index);
          ctx.beginPath();
          ctx.arc(point.x, point.y, active ? 6.5 : 5, 0, Math.PI * 2);
          ctx.fillStyle = active ? C('#a8541f') : C('#faf8f2');
          ctx.fill();
          ctx.strokeStyle = C('#a8541f');
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }

      const totalEdges = state.scene?.edges?.length || 0;
      if (state.sim?.running && edge.enabled && (totalEdges <= 220 || selected)) {
        const phase = (now / 1600 + (hashString(edge.id) % 997) / 997) % 1;
        for (let index = 0; index < 2; index += 1) {
          const t = (phase + index / 2) % 1;
          const point = pathPointAt(points, t);
          ctx.beginPath();
          ctx.arc(point.x, point.y, selected ? 2.0 : 1.35, 0, Math.PI * 2);
          ctx.fillStyle = edge.delay ? C('rgba(176,118,42,.8)') : C('rgba(168,84,31,.7)');
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }


  function drawGbCircuitNode(ctx: CanvasRenderingContext2D, node: NodeItem, cx: number, cy: number, radius: number, accent: string, isSelected: boolean, isHovered: boolean, k: number) {
    const style = state.ui?.nodeStyle || 'circle';
    const color = isSelected ? C('#a8541f') : isHovered ? tokens().edgeHover : tokens().labelText;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = C('#faf8f2');
    ctx.lineWidth = isSelected ? 1.8 : 1.2;
    if (node.kind === 'ground') {
      const top = cy - radius * 0.5;
      ctx.beginPath();
      ctx.moveTo(cx, top);
      ctx.lineTo(cx, cy + 2);
      ctx.stroke();
      const bars = [[15, 6], [10, 10], [5, 14]];
      for (const [width, offset] of bars) {
        ctx.beginPath();
        ctx.moveTo(cx - width / 2, cy + offset);
        ctx.lineTo(cx + width / 2, cy + offset);
        ctx.stroke();
      }
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(radius, 12) + 4, 0, Math.PI * 2);
        ctx.strokeStyle = C('rgba(168, 84, 31, 0.45)');
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    if (style === 'dot') {
      ctx.beginPath();
      ctx.arc(cx, cy, 4.2, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? C('#a8541f') : accent;
      ctx.fill();
    } else if (style === 'box') {
      ctx.beginPath();
      ctx.rect(cx - 10, cy - 7, 20, 14);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(cx, cy, 10.5, 0, Math.PI * 2);
      ctx.strokeStyle = C('rgba(168, 84, 31, 0.6)');
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawGbFunctionGlyph(ctx: CanvasRenderingContext2D, node: NodeItem, cx: number, cy: number, radius: number, accent: string, isSelected: boolean, isHovered: boolean, k: number) {
    const color = isSelected ? C('#a8541f') : isHovered ? tokens().edgeHover : accent;
    const R = radius * 0.92;
    const fontPx = Math.max(10, Math.round(R * 0.8));
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = isSelected ? 1.8 : clamp(1.15 * k, 0.9, 1.8);
    ctx.lineJoin = 'round';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${fontPx}px "Cascadia Code", Consolas, monospace`;
    const kind = node.kind;
    if (kind === 'sum') {
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
      ctx.fillText('Σ', cx, cy + 1);
    } else if (kind === 'gain') {
      ctx.beginPath();
      ctx.moveTo(cx - R * 0.72, cy - R * 0.75);
      ctx.lineTo(cx - R * 0.72, cy + R * 0.75);
      ctx.lineTo(cx + R * 0.9, cy);
      ctx.closePath();
      ctx.stroke();
      ctx.font = `600 ${Math.round(fontPx * 0.72)}px "Cascadia Code", Consolas, monospace`;
      ctx.fillText('K', cx - R * 0.18, cy + 1);
    } else if (kind === 'integrate') {
      ctx.strokeRect(cx - R * 0.62, cy - R * 0.58, R * 1.24, R * 1.16);
      ctx.fillText('∫', cx, cy + 1);
    } else if (kind === 'lag') {
      ctx.strokeRect(cx - R * 0.66, cy - R * 0.58, R * 1.32, R * 1.16);
      ctx.font = `600 ${Math.round(fontPx * 0.62)}px "Cascadia Code", Consolas, monospace`;
      ctx.fillText('1/(1+τs)', cx, cy + 1);
    } else if (kind === 'expression') {
      ctx.strokeRect(cx - R * 0.62, cy - R * 0.55, R * 1.24, R * 1.1);
      ctx.fillText('f(x)', cx, cy + 1);
    } else if (kind === 'oscillator') {
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.82, 0, Math.PI * 2); ctx.stroke();
      ctx.fillText('~', cx, cy + 1);
    } else if (kind === 'signal') {
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.82, 0, Math.PI * 2); ctx.stroke();
      ctx.fillText('s', cx, cy + 1);
    } else if (kind === 'manual') {
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.82, 0, Math.PI * 2); ctx.stroke();
      ctx.fillText('M', cx, cy + 1);
    } else if (kind === 'module_input' || kind === 'module_output') {
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.7, 0, Math.PI * 2); ctx.stroke();
      ctx.fillText(kind === 'module_input' ? 'I' : 'O', cx, cy + 1);
    } else if (kind === 'block') {
      const hw = R * 0.72;
      const hh = R * 0.5;
      ctx.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2);
      ctx.font = `600 ${Math.round(fontPx * 0.7)}px "Cascadia Code", Consolas, monospace`;
      ctx.fillText('B', cx, cy + 1);
    } else {
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.72, 0, Math.PI * 2); ctx.stroke();
      ctx.font = `600 ${Math.round(fontPx * 0.55)}px "Cascadia Code", Consolas, monospace`;
      ctx.fillText(String(nodeKindLabel(node) || kind).slice(0, 2), cx, cy + 1);
    }
    ctx.restore();
  }

  function drawGbDeviceNode(ctx: CanvasRenderingContext2D, node: NodeItem, rect: BoxRec, accent: string, isSelected: boolean, isHovered: boolean, k: number) {
    const color = isSelected ? C('#a8541f') : isHovered ? tokens().edgeHover : accent;
    const inactive = Boolean(state.sim?.running) && deviceInactive(node);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 1.8 : 1.2;
    ctx.fillStyle = C('#faf8f2');
    if (inactive) {
      // R21/D43：运行中未参与求解的器件红色辉光（停止后恢复）。
      ctx.save();
      ctx.shadowColor = tokens().dangerShadow;
      ctx.shadowBlur = 16 * k;
      ctx.strokeStyle = C('#dc2626');
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? 1.8 : 1.2;
    }
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.fill();
    ctx.stroke();
    const spec = deviceElementSpec(node);
    const cx = rect.cx as number;
    const cy = rect.cy as number;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${clamp(9 * k, 7, 12)}px "Cascadia Code", Consolas, monospace`;
    ctx.fillText((spec?.label || node.params?.block_name || node.params?.element || '器件') as string, cx, cy);
    const showNames = k > 0.55 && state.ui.showPins !== false;
    for (const pin of devicePins(node)) {
      const local = devicePinLocal(node, pin);
      const px = cx + local.x * k;
      const py = cy + local.y * k;
      const inwardX = local.side === 'left' ? 1 : local.side === 'right' ? -1 : 0;
      const inwardY = local.side === 'bottom' ? -1 : local.side === 'top' ? 1 : 0;
      if (inwardX || inwardY) {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + inwardX * 8 * k, py + inwardY * 8 * k);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(px, py, 2.8 * k, 0, Math.PI * 2);
      ctx.fillStyle = pin.required ? color : tokens().pinFill;
      ctx.fill();
      if (showNames) {
        const label = deviceSupplyLabel(node, pin);
        ctx.fillStyle = C('#6f695f');
        ctx.font = `${clamp(6.5 * k, 4.5, 9)}px "Cascadia Code", Consolas, monospace`;
        if (local.side === 'left') {
          ctx.textAlign = 'right';
          ctx.fillText(label, px - 7 * k, py);
        } else if (local.side === 'right') {
          ctx.textAlign = 'left';
          ctx.fillText(label, px + 7 * k, py);
        } else if (local.side === 'top') {
          ctx.textAlign = 'center';
          ctx.fillText(label, px, py - 10 * k);
        } else {
          ctx.textAlign = 'center';
          ctx.fillText(label, px, py + 10 * k);
        }
      }
    }
    const implicitPin = deviceImplicitGroundPin(node);
    if (implicitPin) {
      // R21/D43：单端电源的空脚画接地标记（可见，不是隐藏接地）。
      const local = devicePinLocal(node, (devicePins(node).find((pin: PortSpec) => pin.name === implicitPin) as PortSpec));
      const gx = cx + local.x * k;
      const gy = cy + local.y * k;
      const dir = local.side === 'top' ? -1 : 1;
      ctx.strokeStyle = C('#6f695f');
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx, gy + dir * 6 * k);
      ctx.stroke();
      for (let row = 0; row < 3; row += 1) {
        const half = (5 - row * 1.4) * k;
        const y = gy + dir * (6 + row * 4) * k;
        ctx.beginPath();
        ctx.moveTo(gx - half, y);
        ctx.lineTo(gx + half, y);
        ctx.stroke();
      }
      if (showNames) {
        ctx.fillStyle = C('#6f695f');
        ctx.font = `${clamp(6 * k, 4.2, 8.5)}px "Cascadia Code", Consolas, monospace`;
        ctx.textAlign = 'center';
        ctx.fillText('自动接地', gx, gy + dir * 22 * k);
      }
    }
    ctx.restore();
  }

  function drawNodes() {
    const nodes = (state.scene?.nodes || []).slice();
    const selected = selectedNode();
    if (selected) {
      const index = nodes.findIndex((node) => node.id === selected.id);
      if (index >= 0) {
        nodes.splice(index, 1);
        nodes.push(selected);
      }
    }
    const k = state.view.k;
    const showDetail = state.ui.cardDetail !== false && k > 0.38;
    const showValue = state.ui.cardValue !== false && k > 0.52;
    const nameSize = clamp(12.5 * k, 6.5, 17);
    const metaSize = clamp(7.5 * k, 5, 11);
    const valueSize = clamp(8.6 * k, 5, 12);

    for (const node of nodes) {
      const rect = nodeRect(node);
      if (rect.x + rect.w < -50 || rect.y + rect.h < -50 || rect.x > state.canvasSize.w + 50 || rect.y > state.canvasSize.h + 50) {
        continue;
      }
      const isPrimary = state.selection.type === 'node' && state.selection.id === node.id;
      const isSelected = isPrimary || state.multi?.nodes?.has(node.id);
      const isHovered = state.hover?.type === 'node' && state.hover.id === node.id;
      const ap = appearanceOf(node);
      const fontOverride = ap.fontSize;
      const accent = ap.color ? ap.color : nodeColor(node);
      const cx = rect.cx;
      const cy = rect.cy;
      const radius = rect.r;

      ctx.save();
      if (ap.opacity !== undefined) ctx.globalAlpha = clamp(ap.opacity, 0.05, 1);
      const gbStyle = state.ui?.symbol === 'gb';
      const isDeviceNode = isPinNode(node);
      let customLabel = false;
      if (isDeviceNode) {
        customLabel = true;
        drawGbDeviceNode(ctx, node, rect, accent, isSelected, isHovered, k);
      } else if (gbStyle) {
        customLabel = true;
        const isCircuitTerminal = state.scene?.mode === 'circuit'
          && (node.kind === 'node' || node.kind === 'ground');
        if (isCircuitTerminal) {
          drawGbCircuitNode(ctx, node, cx, cy, radius, accent, isSelected, isHovered, k);
        } else {
          drawGbFunctionGlyph(ctx, node, cx, cy, radius, accent, isSelected, isHovered, k);
        }
      } else {
        // 外圈与纸面圆盘
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 5, 0, Math.PI * 2);
        ctx.strokeStyle = isSelected ? C('#a8541f') : isHovered ? tokens().nodeRingHover : C('#cfc6b5');
        ctx.lineWidth = isSelected ? 1.6 : 1;
        if (!isSelected && !isHovered) ctx.setLineDash([2, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? tokens().nodeFillSelected : C('#faf8f2');
        ctx.fill();
        if (isSelected) { ctx.shadowColor = tokens().nodeShadow; ctx.shadowBlur = Math.max(6, 9 * k); }
        ctx.strokeStyle = ap.color ? ap.color : isSelected ? C('#a8541f') : C('#bcb3a1');
        ctx.lineWidth = ap.lineWidth !== undefined ? ap.lineWidth : isSelected ? 2.2 : 1;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // 顶部彩色弧线，作为类型标识
        ctx.beginPath();
        ctx.arc(cx, cy, radius - 2.5, -Math.PI * 0.78, -Math.PI * 0.22);
        ctx.strokeStyle = accent;
        ctx.lineWidth = clamp(2.4 * k, 1.2, 3.5);
        ctx.stroke();
      }

      // 矢量箭头：优先速度，其次位置 / 状态
      const vector = vectorForNode(node);
      if (vector) {
        // 画布 y 轴向下；物理平面 y 轴向上，因此取反。
        const angle = Math.atan2(-vector.vy, vector.vx);
        const length = radius + clamp(7 + 13 * Math.tanh(vector.magnitude), 7, 26);
        const sx = cx + Math.cos(angle) * (radius * 0.38);
        const sy = cy + Math.sin(angle) * (radius * 0.38);
        const ex = cx + Math.cos(angle) * length;
        const ey = cy + Math.sin(angle) * length;
        ctx.strokeStyle = vector.source === 'velocity' ? C('rgba(168, 84, 31, .5)') : C('rgba(31, 95, 91, .45)');
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.fillStyle = vector.source === 'velocity' ? C('rgba(168, 84, 31, .8)') : C('rgba(31, 95, 91, .75)');
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - 5 * Math.cos(angle - 0.42), ey - 5 * Math.sin(angle - 0.42));
        ctx.lineTo(ex - 5 * Math.cos(angle + 0.42), ey - 5 * Math.sin(angle + 0.42));
        ctx.closePath();
        ctx.fill();
      }

      if (showDetail && !customLabel) {
        const pad = radius * 0.3;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = isSelected ? tokens().nodeMetaSel : accent;
        ctx.font = `600 ${metaSize}px "Cascadia Code", Consolas, monospace`;
        ctx.fillText(nodeKindLabel(node), cx, cy - radius * 0.56, radius * 1.42);

        ctx.fillStyle = isSelected ? tokens().nodeNameSel : C('#11100e');
        ctx.font = `700 ${fontOverride ?? nameSize}px "Segoe UI", "Microsoft YaHei", sans-serif`;
        const maxNameWidth = radius * 1.55;
        let name = node.name;
        if (ctx.measureText(name).width > maxNameWidth) {
          while (name.length > 2 && ctx.measureText(`${name}…`).width > maxNameWidth) name = name.slice(0, -1);
          name += '…';
        }
        ctx.fillText(name, cx, cy - radius * 0.06);

        if (showValue) {
          ctx.fillStyle = isSelected ? tokens().nodeValueSel : C('#6f695f');
          ctx.font = `${fontOverride ?? valueSize}px "Cascadia Code", Consolas, monospace`;
          const text = node.kind === 'ground' ? '0 V · REF' : nodeValueText(node);
          ctx.fillText(text, cx, cy + radius * 0.38, radius * 1.55);
        }

        if (isSelected) {
          ctx.fillStyle = C('#a8541f');
          ctx.font = `600 ${metaSize}px "Cascadia Code", Consolas, monospace`;
          ctx.fillText('●', cx, cy - radius - 13);
          ctx.fillStyle = C('#7b7266');
          ctx.font = `${metaSize}px "Cascadia Code", Consolas, monospace`;
          ctx.fillText(node.id.slice(-4), cx + radius * 0.9, cy - radius - 13);
        }
      } else if (showDetail && customLabel) {
        const nameSize2 = clamp(10.5 * k, 6.5, 13);
        const valueSize2 = clamp(8.6 * k, 5, 12);
        const labelY = node.kind === 'device'
          ? rect.y + rect.h + Math.max(11, 11 * k)
          : cy + (radius < 20 ? Math.max(14, radius + 8) : radius * 0.62);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = C('#11100e');
        ctx.font = `600 ${fontOverride ?? nameSize2}px "Segoe UI", "Microsoft YaHei", sans-serif`;
        ctx.fillText(node.name, cx, labelY, 96);
        if (showValue && state.scene?.mode !== 'circuit') {
          ctx.fillStyle = C('#6f695f');
          ctx.font = `${fontOverride ?? valueSize2}px "Cascadia Code", Consolas, monospace`;
          const text = node.kind === 'ground' ? '0 V · REF' : nodeValueText(node);
          ctx.fillText(text, cx, labelY + (fontOverride ?? nameSize2) + 3, 96);
        }
      } else {
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.2;
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = ap.opacity !== undefined ? clamp(ap.opacity, 0.05, 1) : 1;
      }

      if (isSelected) {
        const tick = 6;
        ctx.strokeStyle = C('#a8541f');
        ctx.lineWidth = 1;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          ctx.beginPath();
          ctx.moveTo(cx + dx * (radius + 7), cy + dy * (radius + 7));
          ctx.lineTo(cx + dx * (radius + 7 + tick), cy + dy * (radius + 7 + tick));
          ctx.stroke();
        }
      }

      // 端口：电路 GB 小节点沿实际连线方向；其他模式保持左入右出
      const portRadius = clamp(3.4 * k, 2, 5);
      const circuitPorts = state.scene?.mode === 'circuit'
        && !state.ui?.drawingMode
        && state.ui?.symbol === 'gb'
        && state.ui?.nodeStyle !== 'box'
        && (node.kind === 'node' || node.kind === 'ground');
      if (circuitPorts) {
        const points: Array<{ x: number; y: number }> = [];
        for (const edge of state.scene!.edges || []) {
          if (!edge.enabled || (edge.source !== node.id && edge.target !== node.id)) continue;
          const other = nodeById(edge.source === node.id ? edge.target : edge.source);
          if (!other) continue;
          const otherCenter = nodeCenterScreen(other);
          const anchor = edge.source === node.id
            ? (edge.anchors?.source || 'auto')
            : (edge.anchors?.target || 'auto');
          const point = anchorPoint(node, anchor, otherCenter);
          if (!points.some((item) => Math.hypot(item.x - point.x, item.y - point.y) < 2)) points.push(point);
        }
        for (const point of points) {
          ctx.beginPath();
          ctx.arc(point.x, point.y, portRadius - 0.4, 0, Math.PI * 2);
          ctx.fillStyle = C('#faf8f2');
          ctx.fill();
          ctx.strokeStyle = C('#8e8477');
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.restore();
        continue;
      }
      const inPoint = { x: cx - radius, y: cy };
      const outPoint = { x: cx + radius, y: cy };
      const linkingSource = state.drag?.type === 'link' && state.drag.sourceId === node.id;
      ctx.fillStyle = C('#faf8f2');
      ctx.strokeStyle = C('#8e8477');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(inPoint.x, inPoint.y, portRadius - 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(outPoint.x, outPoint.y, linkingSource ? portRadius + 1.5 : portRadius, 0, Math.PI * 2);
      ctx.fillStyle = linkingSource ? C('#a8541f') : C('#faf8f2');
      ctx.strokeStyle = linkingSource ? C('#a8541f') : accent;
      ctx.lineWidth = 1.2;
      ctx.fill();
      ctx.stroke();

      if (isPrimary) {
        // 尺寸手柄：右下角，拖动改变节点直径（R09）
        const hx = cx + radius - 2;
        const hy = cy + radius - 2;
        ctx.fillStyle = C('#faf8f2');
        ctx.strokeStyle = C('#a8541f');
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.rect(hx - 4, hy - 4, 8, 8);
        ctx.fill();
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  function drawLinkPreview() {
    const tool = state.wireTool;
    if (tool?.first) {
      const first = tool.first;
      const node = nodeById((first.nodeId as string | null));
      if (!node) return;
      const start = first.kind === 'pin'
        ? devicePinScreen(node, (first.pin as string))
        : worldToScreen(node.position || { x: 0, y: 0 });
      const end = state.pointer
        ? { x: state.pointer.x, y: state.pointer.y }
        : start;
      ctx.save();
      ctx.strokeStyle = C('rgba(168, 84, 31, .55)');
      ctx.lineWidth = 1.7;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(start.x, start.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = C('rgba(168, 84, 31, .25)');
      ctx.fill();
      ctx.strokeStyle = C('#a8541f');
      ctx.stroke();
      ctx.restore();
      return;
    }
    const drag = state.drag;
    if (!drag || (drag.type !== 'link' && drag.type !== 'pin')) return;
    const source = nodeById((drag.sourceId as string | null));
    if (!source) return;
    const start = drag.type === 'pin'
      ? devicePinScreen(source, (drag.pin as string))
      : portOut(source);
    const target = drag.targetId ? nodeById(drag.targetId) : null;
    const end = target ? portIn(target) : { x: state.pointer.x, y: state.pointer.y };
    const bend = Math.max(34, Math.abs(end.x - start.x) * 0.35);
    ctx.save();
    ctx.strokeStyle = target ? C('#a8541f') : C('rgba(168, 84, 31, .45)');
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.bezierCurveTo(start.x + bend, start.y, end.x - bend, end.y, end.x, end.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(end.x, end.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = C('#a8541f');
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
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = C('#8e8477');
      ctx.font = '13px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillText('画布为空 · 点击左侧「节点」或从「场景」载入模板', w / 2, h / 2);
      ctx.font = '10px "Cascadia Code", Consolas, monospace';
      ctx.fillStyle = C('#a49a89');
      ctx.fillText('拖拽移动 · 从右侧端口拖出连接 · 滚轮缩放 · 双击编辑', w / 2, h / 2 + 24);
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
    if (!drag || drag.type !== 'box') return;
    const x = Math.min((drag.startX as number), (drag.x as number));
    const y = Math.min((drag.startY as number), (drag.y as number));
    const w = Math.abs(drag.x! - drag.startX!);
    const h = Math.abs(drag.y! - drag.startY!);
    ctx.save();
    // 固定半透明：深色主题下若走 C() 的 legacy 映射，某些 token 会退化成近黑实心
    const dark = themeKey() === 'dark';
    ctx.fillStyle = dark ? 'rgba(197, 161, 107, .16)' : 'rgba(168, 84, 31, .10)';
    ctx.strokeStyle = dark ? 'rgba(197, 161, 107, .70)' : 'rgba(168, 84, 31, .65)';
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
    let label = '';
    if (drag && drag.type === 'waypoint') {
      const edge = edgeById((drag.id as string | null));
      const point = edge?.waypoints?.[drag.index as number];
      if (point) {
        target = worldToScreen(point);
        label = `拐点 ${drag.index! + 1}`;
      }
    } else if (drag && drag.type === 'node') {
      const node = nodeById((drag.id as string | null));
      if (node?.position) {
        target = worldToScreen(node.position);
        label = '节点';
      }
    } else if (drag && drag.type === 'endpoint') {
      const pointer = state.pointer;
      if (pointer) {
        target = { x: pointer.x, y: pointer.y };
        label = '端点';
      }
    } else if (state.hoverWaypoint) {
      const edge = edgeById(state.hoverWaypoint.edgeId);
      const point = edge?.waypoints?.[state.hoverWaypoint.index];
      if (point) {
        target = worldToScreen((point as { x: number; y: number; }));
        label = `拐点 ${state.hoverWaypoint.index + 1}`;
      }
    }
    if (!target) return;
    const world = screenToWorld(target.x, target.y);
    ctx.save();
    // 十字准线：让用户看清拐点落在网格的哪里。
    ctx.strokeStyle = C('rgba(168, 84, 31, .28)');
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(0, target.y);
    ctx.lineTo(w, target.y);
    ctx.moveTo(target.x, 0);
    ctx.lineTo(target.x, h);
    ctx.stroke();
    ctx.setLineDash([]);
    // 拐点标记
    ctx.beginPath();
    ctx.arc(target.x, target.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = C('rgba(168, 84, 31, .18)');
    ctx.fill();
    ctx.strokeStyle = C('#a8541f');
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // 坐标标签（画布内偏移，避免贴边裁切）
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
    ctx.strokeStyle = C('rgba(168, 84, 31, .75)');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect
      ? ctx.roundRect(bx, by, boxW, boxH, 4)
      : ctx.rect(bx, by, boxW, boxH);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C('#5a3a24');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + padding, by + boxH / 2 + 0.5);
    ctx.restore();
  }

  function requestDraw() {
    state.needsDraw = true;
  }

  const __graphMs: number[] = [];
  function __dbgGraph(ms: number) {
    __graphMs.push(Math.round(ms * 10) / 10);
    if (__graphMs.length > 300) __graphMs.splice(0, 150);
    (window as Window & { __graphMs?: number[] }).__graphMs = __graphMs;
  }

  function animationLoop(timestamp: number) {
    if (state.shuttingDown) return;
    if (state.workspace === 'network') {
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
      minX = Math.min(minX, node.position!.x - NODE_W / 2);
      maxX = Math.max(maxX, node.position!.x + NODE_W / 2);
      minY = Math.min(minY, node.position!.y - NODE_H / 2);
      maxY = Math.max(maxY, node.position!.y + NODE_H / 2);
    }
    const margin = 90;
    const boxW = Math.max(1, maxX - minX + margin * 2);
    const boxH = Math.max(1, maxY - minY + margin * 2);
    const k = clamp(Math.min(w / boxW, h / boxH), 0.12, 1.5);
    state.view = {
      k,
      x: w / 2 - ((minX + maxX) / 2) * k,
      y: h / 2 - ((minY + maxY) / 2) * k,
    };
    requestDraw();
    ui.zoomBadge.textContent = `${Math.round(k * 100)}%`;
    if (announce) toast('已适配视图', 'info', 1200);
  }

  function zoomAt(factor: number, screenX: number, screenY: number) {
    const next = clamp(state.view.k * factor, 0.12, 3.2);
    const ratio = next / state.view.k;
    state.view.x = screenX - (screenX - state.view.x) * ratio;
    state.view.y = screenY - (screenY - state.view.y) * ratio;
    state.view.k = next;
    ui.zoomBadge.textContent = `${Math.round(next * 100)}%`;
    requestDraw();
  }

  function zoomCenter(factor: number) {
    zoomAt(factor, state.canvasSize.w / 2, state.canvasSize.h / 2);
  }

  function pointerPosition(event: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function distance(ax: number, ay: number, bx: number, by: number) {
    return Math.hypot(ax - bx, ay - by);
  }

  function hitTest(x: number, y: number) {
    const nodes = state.scene?.nodes || [];
    if (!nodes.length) return null;

    if (state.scene?.mode === 'circuit' && state.view.k > 0.25) {
      const radius = Math.max(7, 7 * state.view.k);
      for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const node = nodes[index];
        if (node.kind !== 'device') continue;
        for (const pin of devicePins(node)) {
          const point = devicePinScreen(node, pin.name);
          if (distance(x, y, point.x, point.y) <= radius) {
            return { type: 'pin', id: node.id, node, pin: pin.name };
          }
        }
      }
    }
    if (state.view.k > 0.25) {
      for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const node = nodes[index];
        const out = portOut(node);
        if (distance(x, y, out.x, out.y) <= Math.max(9, 8 * state.view.k)) {
          return { type: 'port', id: node.id, node };
        }
      }
    }

    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index];
      const rect = nodeRect(node);
      if (rect.shape === 'rect'
        ? (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h)
        : distance(x, y, rect.cx, rect.cy) <= rect.r + 1) {
        return { type: 'node', id: node.id, node };
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
        return { type: 'edge', id: edge.id, edge };
      }
    }
    return null;
  }

  function nearestNodeWithin(x: number, y: number, margin = 24) {
    const nodes = state.scene?.nodes || [];
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index];
      const rect = nodeRect(node);
      if (rect.shape === 'rect'
        ? (x >= rect.x - margin && x <= rect.x + rect.w + margin
          && y >= rect.y - margin && y <= rect.y + rect.h + margin)
        : distance(x, y, rect.cx, rect.cy) <= rect.r + margin) {
        return node;
      }
    }
    return null;
  }

  /* ======================================================================
   * 4. 画布交互：选择、拖拽、连线、缩放、平移
   * ==================================================================== */

  function bindCanvas() {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', () => {
      if (state.drag) return;
      if (state.hoverWaypoint) {
        state.hoverWaypoint = null;
        requestDraw();
      }
      if (ui.statusCursor) ui.statusCursor.textContent = 'x —  y —';
      if (state.hover) {
        state.hover = null;
        requestDraw();
        canvas.style.cursor = 'default';
      }
    });
    canvas.addEventListener('dblclick', onDoubleClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('pointerdown', (event: PointerEvent) => {
      if (event.button === 1) {
        event.preventDefault();
      }
    });
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button === 2) return;
    closePopups();
    const point = pointerPosition(event);
    state.pointer = { ...point, ...screenToWorld(point.x, point.y) };

    if (event.button === 1) {
      state.drag = {
        type: 'pan',
        startX: point.x,
        startY: point.y,
        viewX: state.view.x,
        viewY: state.view.y,
      };
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = 'grabbing';
      event.preventDefault();
      return;
    }

    const primaryNode = selectedNode();
    if (state.wireTool && event.button === 0) {
      const endpoint = wireToolEndpointAt(point);
      if (!endpoint) {
        toast('请点击网络节点或器件引脚（Esc 取消导线工具）', 'info', 2400);
        return;
      }
      if (!state.wireTool.first) {
        state.wireTool.first = endpoint;
        if (ui.statusHint) ui.statusHint.textContent = '导线工具：起点已选，点击第二个端点（Esc 取消）';
        requestDraw();
      } else {
        void completeWireTool(((endpoint)));
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
          type: 'resize',
          id: primaryNode.id,
          startDiameter: nodeDiameter(primaryNode),
          startX: point.x,
          startY: point.y,
        };
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = 'nwse-resize';
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
          type: 'endpoint',
          id: endpoint.id,
          end: endpoint.end,
          anchor: ((edgeRecord?.anchors && edgeRecord.anchors[endpoint.end]) || 'auto') as string,
          moved: false,
        };
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = 'crosshair';
        requestDraw();
        event.preventDefault();
        return;
      }
    }
    if (!event.ctrlKey && !event.metaKey) {
      const waypoint = waypointHitAt(point, true);
      if (waypoint) {
        // 直接拖拐点：即使连线未选中也先选中它，并显示坐标 HUD。
        if (state.selection.type !== 'edge' || state.selection.id !== waypoint.edge.id) {
          state.selection = { type: 'edge', id: waypoint.edge.id };
          state.inspectorDirty = false;
          renderInspector();
        }
        state.drag = { type: 'waypoint', id: waypoint.edge.id, index: waypoint.index, moved: false };
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = 'grabbing';
        requestDraw();
        event.preventDefault();
        return;
      }
    }
    if (primaryEdge && event.altKey) {
      const world = screenToWorld(point.x, point.y);
      const snapped = snapWorld(world.x, world.y, event.altKey);
      const waypoints = [...(primaryEdge.waypoints || []), { x: snapped.x, y: snapped.y }];
      void patchEdgeGeometry(primaryEdge.id, { route: 'manual', waypoints });
      return;
    }

    const hit = hitTest(point.x, point.y);
    if ((event.ctrlKey || event.metaKey) && hit && (hit.type === 'node' || hit.type === 'edge')) {
      toggleMultiSelection(hit.type, hit.id);
      event.preventDefault();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !hit) {
      state.drag = {
        type: 'box',
        startX: point.x,
        startY: point.y,
        x: point.x,
        y: point.y,
      };
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    if (hit && hit.type === 'pin') {
      state.drag = {
        type: 'pin',
        sourceId: hit.id,
        pin: hit.pin,
        startX: point.x,
        startY: point.y,
      };
      canvas.setPointerCapture(event.pointerId);
      requestDraw();
      event.preventDefault();
      return;
    }
    if (hit && hit.type === 'port') {
      state.drag = {
        type: 'link',
        sourceId: hit.id,
        targetId: null,
        startX: point.x,
        startY: point.y,
      };
      canvas.setPointerCapture(event.pointerId);
      requestDraw();
      event.preventDefault();
      return;
    }

    if (hit && hit.type === 'node') {
      const node = hit.node;
      void selectEntity('node', node!.id);
      state.drag = {
        type: 'node',
        id: node!.id,
        startX: point.x,
        startY: point.y,
        originX: node!.position!.x,
        originY: node!.position!.y,
        moved: false,
      };
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = 'grabbing';
      event.preventDefault();
      return;
    }

    if (hit && hit.type === 'edge') {
      void selectEntity('edge', hit.id);
      drawGraph();
      return;
    }

    void selectEntity(null, null);
    state.drag = {
      type: 'pan',
      startX: point.x,
      startY: point.y,
      viewX: state.view.x,
      viewY: state.view.y,
      moved: false,
    };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'grab';
  }

  function onPointerMove(event: PointerEvent) {
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
        canvas.style.cursor = 'grab';
        requestDraw();
        return;
      }
      if (state.hoverWaypoint) {
        state.hoverWaypoint = null;
        requestDraw();
      }
      if (edgeEndpointHit(point)) {
        canvas.style.cursor = 'crosshair';
        return;
      }
      const hit = hitTest(point.x, point.y);
      const nextHover = hit ? { type: hit.type, id: hit.id } : null;
      const changed = (nextHover?.type || null) !== (state.hover?.type || null)
        || (nextHover?.id || null) !== (state.hover?.id || null);
      if (changed) {
        state.hover = nextHover;
        requestDraw();
      }
      if (!hit) canvas.style.cursor = 'default';
      else if (hit.type === 'port' || hit.type === 'pin') canvas.style.cursor = 'crosshair';
      else if (hit.type === 'node') canvas.style.cursor = 'grab';
      else canvas.style.cursor = 'pointer';
      return;
    }

    const drag = state.drag;
    if (drag.type === 'box') {
      drag.x = point.x;
      drag.y = point.y;
      requestDraw();
      return;
    }

    if (drag.type === 'pan') {
      state.view.x = drag.viewX! + (point.x - drag.startX!);
      state.view.y = drag.viewY! + (point.y - drag.startY!);
      drag.moved = true;
      requestDraw();
      return;
    }

    if (drag.type === 'resize') {
      const node = nodeById((drag.id as string | null));
      if (!node) return;
      const rect = nodeRect(node);
      const world = screenToWorld(point.x, point.y);
      const center = { x: node.position!.x, y: node.position!.y };
      const raw = Math.hypot(world.x - center.x, world.y - center.y) * 2;
      const snapped = state.ui?.snap && !event.altKey
        ? Math.round(raw / (Number(state.ui.grid) || 20)) * (Number(state.ui.grid) || 20)
        : raw;
      const diameter = clamp(snapped, 24, 200);
      state.drag.diameter = diameter;
      drag.diameter = diameter;
      node.size = { w: diameter };
      rect.r = (diameter / 2) * state.view.k;
      drag.moved = true;
      requestDraw();
      return;
    }

    if (drag.type === 'endpoint') {
      const edge = edgeById((drag.id as string | null));
      if (!edge) return;
      const node = nodeById(drag.end === 'source' ? edge.source : edge.target);
      if (!node) return;
      const side = anchorSideFor(node, point);
      drag.anchor = side;
      edge.anchors = Object.assign({}, edge.anchors || {}, { [drag.end as string]: side });
      drag.moved = true;
      requestDraw();
      return;
    }

    if (drag.type === 'waypoint') {
      const edge = edgeById((drag.id as string | null));
      if (!edge) return;
      const world = screenToWorld(point.x, point.y);
      const snapped = snapWorld(world.x, world.y, event.altKey);
      edge.waypoints![drag.index as number] = { x: snapped.x, y: snapped.y };
      drag.moved = true;
      requestDraw();
      return;
    }

    if (drag.type === 'node') {
      const k = state.view.k;
      const node = nodeById((drag.id as string | null));
      if (!node) return;
      const rawX = clamp(drag.originX! + (point.x - drag.startX!) / k, -10000, 10000);
      const rawY = clamp(drag.originY! + (point.y - drag.startY!) / k, -10000, 10000);
      const snapped = snapWorld(rawX, rawY, event.altKey);
      node.position!.x = snapped.x;
      node.position!.y = snapped.y;
      drag.moved = true;
      requestDraw();
      return;
    }

    if (drag.type === 'link') {
      const target = nearestNodeWithin(point.x, point.y, 18);
      drag.targetId = target && target.id !== drag.sourceId ? target.id : (target ? target.id : null);
      requestDraw();
    }
  }

  function onPointerUp(event: PointerEvent) {
    const drag = state.drag;
    state.drag = null;
    state.hoverWaypoint = null;
    canvas.style.cursor = 'default';
    if (!drag) return;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch (error) {
      // pointer capture 可能已自动释放
    }

    if (drag.type === 'box') {
      const x1 = Math.min((drag.startX as number), (drag.x as number));
      const x2 = Math.max((drag.startX as number), (drag.x as number));
      const y1 = Math.min((drag.startY as number), (drag.y as number));
      const y2 = Math.max((drag.startY as number), (drag.y as number));
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
        toast(`框选 ${nodes.length} 节点 / ${edges.length} 连接`, 'info', 1800);
      }
      return;
    }

    if (drag.type === 'node' && drag.moved) {
      queuePositionSave((drag.id as string));
    }

    if (drag.type === 'resize' && drag.moved) {
      const node = nodeById((drag.id as string | null));
      if (node) void patchNodeGeometry(node.id, { size: { w: node.size?.w || nodeDiameter(node) } });
    }

    if (drag.type === 'waypoint' && drag.moved) {
      const edge = edgeById((drag.id as string | null));
      if (edge) void patchEdgeGeometry(edge.id, { waypoints: edge.waypoints });
    }

    if (drag.type === 'endpoint' && drag.moved) {
      const edge = edgeById((drag.id as string | null));
      if (edge) void patchEdgeGeometry(edge.id, { anchors: edge.anchors });
    }

    if (drag.type === 'link') {
      const point = pointerPosition(event);
      const target = nearestNodeWithin(point.x, point.y, 18);
      if (target) {
        openLinkMenu(target.id, point.x, point.y, (drag.sourceId as string | null));
      }
      requestDraw();
    }

    if (drag.type === 'pin') {
      const point = pointerPosition(event);
      const target = nearestNodeWithin(point.x, point.y, 18);
      if (target && (target.kind === 'node' || target.kind === 'ground')) {
        void createWire((drag.sourceId as string), target.id, (drag.pin as string));
      } else {
        toast('请把引脚拖到网络节点（电学节点/接地）', 'error', 3500);
      }
      requestDraw();
    }
  }

  function onDoubleClick(event: MouseEvent) {
    const point = pointerPosition(event);
    const hit = hitTest(point.x, point.y);
    if (hit && hit.type === 'node') {
      void selectEntity('node', hit.id, true);
      switchTab('inspect');
    } else if (hit && hit.type === 'edge') {
      void selectEntity('edge', hit.id, true);
      switchTab('inspect');
    } else {
      openAddMenu(point.x, point.y);
    }
  }

  function onWheel(event: MouseEvent) {
    event.preventDefault();
    const point = pointerPosition(event);
    const factor = Math.exp(-(event as Event as WheelEvent).deltaY * 0.0015);
    zoomAt(factor, point.x, point.y);
  }

  async function deleteDeviceWires(nodeId: string) {
    const wires = (state.scene?.edges || []).filter(
      (edge) => edge.kind === 'wire' && (edge.source === nodeId || edge.target === nodeId),
    );
    if (!wires.length) {
      toast('该器件没有导线', 'info', 2000);
      return;
    }
    for (const wire of wires) await deleteEdge(wire.id);
    toast(`已断开 ${wires.length} 条导线`, 'ok', 2200);
  }

  async function convertNodeToGround(nodeId: string) {
    try {
      await jsonRequest(`/api/nodes/${encodeURIComponent(nodeId)}`, 'PATCH', {
        kind: 'ground',
        params: {},
        data: {},
        size: {},
      });
      await refreshState(true);
      toast('已设为接地（多接地自动合并为 0V）', 'ok', 2600);
    } catch (error) {
      toast(`设为接地失败：${(error as Error).message}`, 'error', 4000);
    }
  }

  function pinWires(nodeId: string, pinName: string) {
    return (state.scene?.edges || []).filter(
      (edge) => edge.kind === 'wire'
        && ((edge.source === nodeId && edge.source_pin === pinName)
          || (edge.target === nodeId && edge.target_pin === pinName)),
    );
  }

  function wireToolEndpointAt(point: { x: number; y: number }) {
    const hit = hitTest(point.x, point.y);
    if (!hit) return null;
    if (hit.type === 'pin') return { kind: 'pin', nodeId: hit.id, pin: hit.pin };
    if (hit.type === 'node' && (hit.node!.kind === 'node' || hit.node!.kind === 'ground')) {
      return { kind: 'net', nodeId: hit.id };
    }
    return null;
  }

  function startWireTool(first: { kind?: string; nodeId: string; pin?: string } | null = null) {
    state.wireTool = { first };
    const hint = first
      ? `导线工具：起点已选，点击第二个端点（网络节点或器件引脚）`
      : '导线工具：依次点击两个端点（网络节点 / 器件引脚）';
    if (ui.statusHint) ui.statusHint.textContent = hint;
    toast(hint, 'info', 2600);
    requestDraw();
  }

  function cancelWireTool() {
    if (!state.wireTool) return;
    state.wireTool = null;
    if (ui.statusHint) ui.statusHint.textContent = '就绪';
    requestDraw();
  }

  async function completeWireTool(second: { kind?: string; nodeId: string; pin?: string } | null) {
    const first = state.wireTool?.first;
    if (!first) return;
    let sourceId = '';
    let targetId = '';
    let sourcePin = '';
    if (first.kind === 'pin' && second!.kind === 'net') {
      sourceId = first.nodeId as string;
      targetId = second!.nodeId as string;
      sourcePin = first.pin as string;
    } else if (first.kind === 'net' && second!.kind === 'pin') {
      sourceId = second!.nodeId as string;
      targetId = first.nodeId as string;
      sourcePin = second!.pin as string;
    } else if (first.kind === 'net' && second!.kind === 'net') {
      sourceId = first.nodeId as string;
      targetId = second!.nodeId as string;
    } else {
      toast('导线只允许「器件引脚 ↔ 网络节点」或「网络 ↔ 网络」', 'error', 3600);
      return;
    }
    cancelWireTool();
    await createWireBetween(sourceId, targetId, sourcePin, '');
  }

  function alignmentMenuItems() {
    return [
      { label: '左对齐', action: () => void alignSelection('left') },
      { label: '右对齐', action: () => void alignSelection('right') },
      { label: '水平居中', action: () => void alignSelection('centerX') },
      { label: '顶对齐', action: () => void alignSelection('top') },
      { label: '底对齐', action: () => void alignSelection('bottom') },
      { label: '垂直居中', action: () => void alignSelection('centerY') },
      { sep: true },
      { label: '横向等距分布', action: () => void distributeSelection('x') },
      { label: '纵向等距分布', action: () => void distributeSelection('y') },
    ];
  }

  function displayMenuItems() {
    return [
      { label: '栅格', hint: state.ui?.showGrid !== false ? '当前：开' : '当前：关', action: () => $('#stGrid')?.click() },
      { label: '吸附', hint: state.ui?.snap !== false ? '当前：开' : '当前：关', action: () => $('#stSnap')?.click() },
      { label: '捕捉点', hint: state.ui?.snapMarkers !== false ? '当前：开' : '当前：关', action: () => $('#stSnapMark')?.click() },
      { label: '正交布线', hint: state.ui?.circuitOrthogonal !== false ? '当前：开' : '当前：关', action: () => $('#stOrtho')?.click() },
    ];
  }

  function onContextMenu(event: MouseEvent) {
    event.preventDefault();
    const point = pointerPosition(event);
    const hit = hitTest(point.x, point.y);
    const items = [];
    if (hit && hit.type === 'pin') {
      const node = hit.node;
      const wires = pinWires(hit.id, (hit.pin as string));
      items.push({
        label: '引脚信息',
        hint: `${node!.name}.${hit.pin}${wires.length ? ` · ${wires.length} 条导线` : ' · 未接线'}`,
        action: () => toast(`${node!.name}.${hit.pin}：${wires.length ? `已接 ${wires.length} 条导线` : '未接线'}`, 'info', 3000),
      });
      items.push({
        label: '从此引脚建线…',
        hint: '点击后选另一个网络节点',
        action: () => startWireTool({ kind: 'pin', nodeId: node!.id, pin: hit.pin }),
      });
      if (wires.length) {
        items.push({
          label: '断开该引脚导线',
          hint: `${wires.length} 条`,
          danger: true,
          action: async () => {
            for (const wire of wires) await deleteEdge(wire.id);
            toast(`已断开 ${node!.name}.${hit.pin} 的 ${wires.length} 条导线`, 'ok', 2400);
          },
        });
      }
      openGenericMenu(ui.linkMenu, point.x, point.y, `引脚 · ${node!.name}.${hit.pin}`, items);
      return;
    }
    if (hit && hit.type === 'node') {
      const node = hit.node;
      const isDevice = node!.kind === 'device';
      items.push({
        label: isDevice ? '器件属性' : '节点属性',
        hint: node!.name,
        action: () => {
          void selectEntity('node', hit.id, true);
          switchTab('inspect');
        },
      });
      if (!isDevice && node!.kind !== 'ground' && state.mode === 'circuit') {
        items.push({
          label: '设为接地',
          hint: '多接地会自动合并为 0V',
          action: () => void convertNodeToGround(hit.id),
        });
      }
      if (node!.kind === 'node' && state.mode === 'circuit') {
        const marked = Boolean(node!.params?.port_name);
        const current = node!.params?.port_direction || 'inout';
        const portName = marked ? String(node!.params!.port_name) : node!.name;
        items.push({
          label: marked ? '改端口方向' : '设为模块端口',
          hint: marked
            ? `当前「${portName}」· ${MODULE_DIR_LABEL[current as keyof typeof MODULE_DIR_LABEL] || '双向'}`
            : '先选方向，封装时按方向画引脚',
          children: PORT_DIRECTION_CHOICES.map(([value, label, hint]) => ({
            label: `${label}${marked && value === current ? ' · 当前' : ''}`,
            hint,
            action: () => void setNetPort(node!.id, portName, value),
          })),
        });
        if (marked) {
          items.push({
            label: '取消模块端口',
            hint: `当前端口 ${portName}`,
            action: () => void setNetPort(node!.id, '', 'inout'),
          });
        }
      }
      items.push({ label: '复制', hint: 'Ctrl+C', action: () => copySelection(false) });
      if (isDevice) {
        items.push({
          label: '断开全部导线',
          hint: '器件保留，只删导线',
          action: () => void deleteDeviceWires(hit.id),
        });
      }
      if ((state.multi?.nodes?.size || 0) > 1) {
        items.push({
          label: '对齐 / 分布',
          hint: `当前多选 ${state.multi.nodes.size} 个`,
          children: [
            { label: '左对齐', action: () => void alignSelection('left') },
            { label: '右对齐', action: () => void alignSelection('right') },
            { label: '水平居中', action: () => void alignSelection('centerX') },
            { label: '顶对齐', action: () => void alignSelection('top') },
            { label: '底对齐', action: () => void alignSelection('bottom') },
            { label: '垂直居中', action: () => void alignSelection('centerY') },
            { sep: true },
            { label: '横向等距分布', action: () => void distributeSelection('x') },
            { label: '纵向等距分布', action: () => void distributeSelection('y') },
          ],
        });
      }
      items.push({ sep: true });
      items.push({
        label: isDevice ? '删除器件' : '删除节点',
        hint: '同时删除相连连接',
        danger: true,
        action: () => deleteNode(hit.id),
      });
      openGenericMenu(ui.linkMenu, point.x, point.y, `${isDevice ? '器件' : '节点'} · ${node!.name}`, items);
      return;
    }
    if (hit && hit.type === 'edge') {
      items.push({
        label: '连接属性',
        hint: hit.edge!.name,
        action: () => {
          void selectEntity('edge', hit.id, true);
          switchTab('inspect');
        },
      });
      items.push({ label: '复制', hint: 'Ctrl+C', action: () => copySelection(false) });
      if (hit.edge!.kind === 'wire') {
        items.push({
          label: '添加拐点（中点）',
          action: () => void addWireWaypoint((hit.edge as EdgeItem)),
        });
        if ((hit.edge!.waypoints || []).length) {
          items.push({
            label: '清除拐点',
            hint: '恢复自动布线',
            action: () => void clearWireWaypoints(hit.id),
          });
        }
        items.push({
          label: '选中整条网络',
          hint: '同端点的导线一起选中',
          action: () => selectWireNetwork((hit.edge as EdgeItem)),
        });
      }
      if (state.mode !== 'circuit') {
        items.push({
          label: hit.edge!.delay ? '取消单步延迟' : '设为单步延迟',
          hint: '用于切断代数环',
          action: () => toggleEdgeDelay(hit.id),
        });
      }
      items.push({ sep: true });
      items.push({
        label: '删除连接',
        hint: hit.edge!.name,
        danger: true,
        action: () => deleteEdge(hit.id),
      });
      openGenericMenu(ui.linkMenu, point.x, point.y, `连接 · ${hit.edge!.name}`, items);
      return;
    }
    items.push({
      label: '添加',
      hint: state.mode === 'circuit' ? '节点 / 器件（按分类）/ 导线' : '节点',
      children: buildAddMenuItems(point.x, point.y),
    });
    const modeChoices =
      (state.catalog?.modes as Array<{ value: string; label: string }> | undefined) || [
        { value: 'signal', label: '信号流' },
        { value: 'circuit', label: '电路' },
        { value: 'vector', label: '矢量场' },
      ];
    items.push({
      label: `切换本网络模式（当前：${modeLabel(state.mode)}）`,
      hint: '只影响当前网络',
      children: modeChoices.map((entry) => ({
        label: entry.value === state.mode ? `${entry.label}（当前）` : entry.label,
        hint: entry.value === state.mode ? '已是当前模式' : '会重建本网络的空白场景',
        action: entry.value === state.mode ? null : () => void switchMode(entry.value),
      })),
    });
    if (state.mode === 'circuit') {
      items.push({
        label: '导线工具（点两端）…',
        hint: '依次点击网络节点 / 器件引脚；Esc 取消',
        action: () => startWireTool(),
      });
    }
    items.push({ label: '显示', children: displayMenuItems() });
    const multiNodes = state.multi?.nodes?.size || 0;
    const multiEdges = state.multi?.edges?.size || 0;
    if (multiNodes > 1 || multiEdges > 0) {
      const multiItems = [];
      if (multiNodes > 1) {
        multiItems.push({
          label: '对齐 / 分布',
          hint: `${multiNodes} 个节点`,
          children: alignmentMenuItems(),
        });
        multiItems.push({
          label: '批量设置尺寸…',
          hint: '统一宽 / 直径',
          action: () => void batchResizeSelection(),
        });
        multiItems.push({ sep: true });
      }
      multiItems.push({
        label: '删除选中',
        hint: `节点 ${multiNodes} / 连接 ${multiEdges}`,
        danger: true,
        action: () => void deleteSelection(),
      });
      items.push({ label: `多选（${multiNodes} 节点 / ${multiEdges} 连接）`, children: multiItems });
    }
    items.push({ label: '粘贴', hint: 'Ctrl+V', action: () => void pasteClipboard() });
    items.push({ label: '全选', hint: 'Ctrl+A', action: () => selectAll() });
    items.push({ sep: true });
    items.push({ label: '撤销', hint: 'Ctrl+Z', action: () => void undo() });
    items.push({ label: '重做', hint: 'Ctrl+Shift+Z', action: () => void redo() });
    items.push({ sep: true });
    items.push({
      label: state.sim?.running ? '暂停' : '运行',
      hint: '空格',
      action: () => void control('toggle'),
    });
    items.push({ label: '单步', hint: 'S', action: () => void control('step') });
    items.push({ sep: true });
    items.push({ label: '适配视图', action: () => fitView(true) });
    items.push({ label: '自动布局', action: () => void autoLayout() });
    openGenericMenu(ui.linkMenu, point.x, point.y, '画布', items);
  }

  function queuePositionSave(nodeId: string) {
    const node = nodeById(nodeId);
    if (!node) return;
    state.dirtyPositions.set(nodeId, { x: node.position!.x, y: node.position!.y });
    clearTimeout(state.positionTimer);
    state.positionTimer = setTimeout(flushPositions, 180);
  }

  async function flushPositions() {
    if (!state.dirtyPositions.size) return;
    const items = Array.from(state.dirtyPositions.entries())
      .filter(([id]) => Boolean(nodeById(id)))
      .map(([id, position]) => ({
        id,
        position: { x: Number(position.x.toFixed(3)), y: Number(position.y.toFixed(3)) },
      }));
    state.dirtyPositions.clear();
    if (!items.length) return;
    try {
      await jsonRequest('/api/positions', 'POST', { positions: items });
    } catch (error) {
      toast(`保存坐标失败：${(error as Error).message}`, 'error', 6000);
      await refreshState(true);
    }
  }

  async function patchNodeGeometry(nodeId: string, payload: Record<string, unknown>) {
    const response = await task(() =>
      jsonRequest(`/api/nodes/${encodeURIComponent(nodeId)}`, 'PATCH', payload),
    );
    if (!response) return;
    await refreshState(true);
    renderInspector();
  }

  // R24/D49：把网络节点标记/取消为模块端口。
  async function setNetPort(nodeId: string, portName: string, direction = 'inout') {
    const node = nodeById(nodeId);
    if (!node) return;
    const params = portName
      ? { port_name: String(portName).slice(0, 24), port_direction: direction || 'inout' }
      : {};
    const response = await task(() =>
      jsonRequest(`/api/nodes/${encodeURIComponent(nodeId)}`, 'PATCH', {
        name: node.name,
        kind: node.kind,
        params,
      }),
    );
    if (!response) return;
    await refreshState(true);
    renderInspector();
    toast(params.port_name ? `已标记端口「${params.port_name}」` : '已取消端口标记', 'ok', 2200);
  }

  async function patchEdgeGeometry(edgeId: string, payload: Record<string, unknown>) {
    const response = await task(() =>
      jsonRequest(`/api/edges/${encodeURIComponent(edgeId)}`, 'PATCH', payload),
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
      if (tab === 'chart') drawChart();
      else if (tab === 'inst') drawInstruments();
    }, 70);
  }

  const PANEL_GROUPS: Record<string, { group: string; role?: string; sub?: string }> = {
    inspect: { group: 'inspect' },
    'node-fn': { group: 'fn', role: 'node' },
    'edge-fn': { group: 'fn', role: 'edge' },
    spec: { group: 'fn' },
    blocks: { group: 'modules', sub: 'blocks' },
    ext: { group: 'modules', sub: 'ext' },
    chart: { group: 'analysis', sub: 'chart' },
    inst: { group: 'analysis', sub: 'inst' },
    vector: { group: 'analysis', sub: 'vector' },
    analysis: { group: 'analysis', sub: 'analysis' },
    plotkit: { group: 'analysis', sub: 'plotkit' },
    'wb-analysis': { group: 'workbench', sub: 'wb-analysis' },
    'wb-state': { group: 'workbench', sub: 'wb-state' },
  };

  function defaultTabForGroup(group: string) {
    if (group === 'fn') return state.fnRole === 'edge' ? 'edge-fn' : 'node-fn';
    if (group === 'modules') {
      const sub = $('.panel-group[data-group="modules"] .group-subnav [data-sub].active');
      return sub ? sub.dataset.sub : 'blocks';
    }
    if (group === 'analysis') {
      const sub = $('.panel-group[data-group="analysis"] .group-subnav [data-sub].active');
      return sub ? sub.dataset.sub : 'chart';
    }
    if (group === 'workbench') {
      const sub = $('.panel-group[data-group="workbench"] .group-subnav [data-sub].active');
      return sub ? sub.dataset.sub : 'wb-analysis';
    }
    return 'inspect';
  }

  function setPanelGroup(group: string) {
    $$('.panel-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.group === group));
    $$('.panel-group').forEach((node) => node.classList.toggle('active', node.dataset.group === group));
  }

  function setGroupSub(group: string, sub: string) {
    const host = $(`.panel-group[data-group="${group}"]`);
    if (!host) return;
    const attr = group === 'fn' ? 'fnrole' : 'sub';
    $$(`[data-${attr}]`, host).forEach((node) => {
      node.classList.toggle('active', node.dataset[attr] === sub);
    });
    if (group === 'modules' || group === 'analysis' || group === 'workbench') {
      $$('.tab-pane', host).forEach((pane) => {
        pane.classList.toggle('hidden', pane.id !== `tab-${sub}`);
      });
    }
  }

  function switchTab(name: string) {
    if (name === 'scene') {
      openSettings('project');
      return;
    }
    const conf = PANEL_GROUPS[name] || PANEL_GROUPS.inspect;
    if (conf.role) {
      state.fnRole = conf.role;
      state.specKind = '';
      setGroupSub('fn', conf.role);
    }
    setPanelGroup(conf.group);
    if (conf.sub) setGroupSub(conf.group, conf.sub);
    if (conf.group === 'fn') {
      const note = $('#fnNote');
      if (note) note.textContent = state.fnRole === 'edge' ? '连接函数' : '节点函数';
      renderSpecPane();
      requestDraw();
    }
    if (conf.sub === 'chart') {
      resizeChart();
      scheduleChartDraw();
    }
    if (conf.sub === 'vector') {
      resizePhase();
      renderVectorNodeList();
      drawPhase();
    }
    if (conf.sub === 'plotkit') {
      // 侧栏只放入口；真正的绘图在非模态浮窗里（iframe 懒加载）
      $('#btnOpenPlotkit')?.focus({ preventScroll: true });
    }
    // 让 PlotKit 知道自己是"看得见"还是"被切走了"：看不见就停掉实时出图，
    // 否则面板藏在别的页签后面还在按 1Hz 出 100–200ms 的图，白烧 CPU。
    notifyPlotkit(conf.sub === 'plotkit');
    if (conf.sub === 'analysis') {
      renderAnalysisPanel();
    }
    if (conf.sub === 'wb-analysis') {
      renderWorkbenchAnalysis();
    }
    if (conf.sub === 'wb-state') {
      void renderWorkbenchState();
    }
    if (conf.sub === 'blocks') {
      renderBlocksPanel();
    }
    if (conf.sub === 'ext') {
      renderExtensionPanel();
    }
  }

  /* ======================================================================
   * 5. 弹层、菜单、模态框
   * ==================================================================== */

  function plotkitFrames() {
    return [$('#plotkitFrame'), $('#plotkitInlineHost iframe')].filter(Boolean);
  }

  function notifyPlotkit(visible: boolean) {
    for (const frame of plotkitFrames()) {
      try {
        (frame as HTMLIFrameElement).contentWindow?.postMessage({ type: 'plotkit-visibility', visible: Boolean(visible) }, '*');
      } catch (err) { /* 跨源/未加载完成时忽略 */ }
    }
    // 同步告诉后端：面板不可见就别采样（否则 2Hz 白跑，还让数据集无限增长）。
    const want = Boolean(visible);
    if (want !== state.plotkitActive) {
      state.plotkitActive = want;
      api('/api/plotkit/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: want }),
      }).catch(() => { /* 后端未挂载 plotkit 时忽略 */ });
    }
  }

  function positionPopup(popup: HTMLElement, x: number, y: number) {
    popup.classList.remove('hidden');
    popup.style.left = '0px';
    popup.style.top = '0px';
    const stageRect = stage.getBoundingClientRect();
    const width = popup.offsetWidth;
    const height = popup.offsetHeight;
    const left = clamp(x, 8, Math.max(8, stageRect.width - width - 8));
    const top = clamp(y, 8, Math.max(8, stageRect.height - height - 8));
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  }

  function closePopups() {
    ui.addMenu.classList.add('hidden');
    ui.linkMenu.classList.add('hidden');
  }

  function openGenericMenu(popup: HTMLElement, x: number, y: number, title: string, items: MenuItemRec[]) {
    popup.replaceChildren();
    popup.appendChild(div('popup-title', title));
    for (const item of items) {
      if (item.sep) {
        popup.appendChild(div('popup-sep'));
        continue;
      }
      if (Array.isArray(item.children)) {
        // R22：子菜单用“下钻 + 返回”而不是悬停级联，键盘/触控也能用。
        const node = el('button', 'popup-item');
        node.type = 'button';
        node.appendChild(el('strong', null, `${item.label}  ▸`));
        if (item.hint) node.appendChild(el('small', null, item.hint));
        node.addEventListener('click', (event: MouseEvent) => {
          event.stopPropagation();
          const children = [
            ...(item.children as MenuItemRec[]),
            { sep: true },
            {
              label: '‹ 返回',
              action: () => openGenericMenu(popup, x, y, title, items),
            },
          ];
          openGenericMenu(popup, x, y, `${title} › ${item.label}`, children);
        });
        popup.appendChild(node);
        continue;
      }
      const node = el('button', 'popup-item');
      node.type = 'button';
      const strong = el('strong', null, item.label);
      if (item.danger) strong.style.color = 'var(--text-button-danger)';
      node.appendChild(strong);
      if (item.hint) node.appendChild(el('small', null, item.hint));
      node.addEventListener('click', () => {
        closePopups();
        (item as { action: () => void }).action();
      });
      popup.appendChild(node);
    }
    positionPopup(popup, x, y);
  }

  // R22/D46：与后端 ELEMENT_GROUP_ORDER 同名同序；只作展示顺序，不重复分类逻辑。
  const ELEMENT_GROUP_ORDER = [
    '基础无源', '电源', '受控源', '二极管', '开关',
    '放大与比较', '晶体管', '数字与逻辑', '计时与电源管理', '磁性',
  ];

  // 信号流/矢量场的计算节点分类顺序；未列出的组按 catalog 出现顺序补在后面。
  const COMPUTE_GROUP_ORDER = ['基础', '动态', '高级', '矢量', '模块', '接口'];

  function buildAddMenuItems(placeX: number, placeY: number) {
    const list = kindListFor('node');
    const items = [];
    if (state.mode !== 'circuit') {
      const byGroup = new Map();
      for (const spec of list) {
        // 模块实例/端口节点只能由模块库实例化或封装生成，手动添加会得到
        // 没有 block_id 的坏节点（P0-0），所以按 catalog 的 addable 过滤。
        if (spec.addable === false) continue;
        const group = String(spec.group || '未分类');
        if (!byGroup.has(group)) byGroup.set(group, []);
        byGroup.get(group).push(spec);
      }
      const order = state.mode === 'vector'
        ? ['矢量', ...COMPUTE_GROUP_ORDER.filter((group: string) => group !== '矢量')]
        : COMPUTE_GROUP_ORDER;
      const emitted = new Set();
      for (const group of [...order, ...byGroup.keys()]) {
        if (emitted.has(group)) continue;
        const specs = byGroup.get(group);
        if (!specs || !specs.length) continue;
        emitted.add(group);
        items.push({
          label: `节点 · ${group}`,
          hint: `${specs.length} 种`,
          children: specs.map((spec: SpecRec) => ({
            label: spec.label,
            hint: spec.description,
            action: () => addNodeAt(spec.kind, placeX, placeY),
          })),
        });
      }
      return items;
    }
    for (const spec of list) {
      // 模块实例/端口节点只能由模块库实例化或封装生成，手动添加会得到
      // 没有 block_id 的坏节点（P0-0），所以按 catalog 的 addable 过滤。
      if (spec.addable === false) continue;
      items.push({
        label: spec.label,
        hint: state.mode === 'circuit' && spec.kind === 'ground'
          ? '参考节点（R21：可放多个，自动合并为 0V）'
          : spec.description,
        action: () => addNodeAt(spec.kind, placeX, placeY),
      });
    }
    if (state.mode === 'circuit') {
      const byGroup = new Map();
      for (const spec of state.catalog?.elements || []) {
        const group = String(spec.group || '未分类');
        if (!byGroup.has(group)) byGroup.set(group, []);
        byGroup.get(group).push(spec);
      }
      for (const group of ELEMENT_GROUP_ORDER) {
        const specs = byGroup.get(group);
        if (!specs || !specs.length) continue;
        items.push({
          label: `器件 · ${group}`,
          hint: `${specs.length} 种`,
          children: specs.map((spec: SpecRec) => ({
            label: spec.label,
            hint: spec.description,
            action: () => addDeviceAt((spec.kind), placeX, placeY),
          })),
        });
      }
      items.push({ sep: true });
      items.push({
        label: '导线工具（点两端）…',
        hint: '依次点击两个端点；Esc 取消',
        action: () => startWireTool(),
      });
      items.push({
        label: '导线（选择端点）…',
        hint: '点两个端点建线；也可从引脚拖拽（R22）',
        action: () => openWireDialog(),
      });
    }
    return items;
  }

  function openAddMenu(x: number, y: number, placeX = x, placeY = y) {
    if (!state.catalog) return;
    const items = buildAddMenuItems(placeX, placeY);
    const menuLabel = state.mode === 'circuit' ? '电学节点/器件' : state.mode === 'vector' ? '矢量节点' : '计算节点';
    openGenericMenu(ui.addMenu, x, y, `添加${menuLabel}`, items);
  }

  function centerPlacement() {
    const count = state.scene?.nodes?.length || 0;
    const offset = ((count % 3) - 1) * 46;
    return {
      x: state.canvasSize.w / 2 + offset,
      y: state.canvasSize.h / 2 + offset,
    };
  }

  function openLinkMenu(targetId: string, x: number, y: number, forcedSourceId: string | null) {
    const sourceId = forcedSourceId || state.drag?.sourceId;
    const target = nodeById(targetId);
    const source = nodeById((sourceId as string | null));
    if (!source || !target) return;
    if (state.mode === 'circuit' && source.id === target.id) {
      toast('电路元件两端不能是同一个节点', 'error');
      state.drag = null;
      return;
    }
    if (state.mode === 'circuit' && (isPinNode(source) || isPinNode(target))) {
      if (isPinNode(source) && isPinNode(target)) {
        toast('导线只允许「器件/模块引脚 ↔ 网络节点」', 'error', 4000);
        state.drag = null;
        return;
      }
      const deviceNode = isPinNode(source) ? source : target;
      const netNode = isPinNode(source) ? target : source;
      const used = new Set((state.scene?.edges || [])
        .filter((edge) => edge.kind === 'wire')
        .map((edge) => (edge.source === deviceNode.id ? edge.source_pin : edge.target === deviceNode.id ? edge.target_pin : '')));
      const items = devicePins(deviceNode)
        .filter((pin: PortSpec) => !used.has(pin.name))
        .map((pin: PortSpec) => ({
          label: `${deviceNode.name}.${pin.name}`,
          hint: `${pin.role}${pin.required ? ' · 必接' : ''} → ${netNode.name}`,
          action: () => createWire(deviceNode.id, netNode.id, pin.name),
        }));
      if (!items.length) {
        toast(`${deviceNode.name} 的引脚都已连接`, 'info', 3000);
        state.drag = null;
        return;
      }
      openGenericMenu(ui.linkMenu, x, y, `${deviceNode.name} 引脚 → ${netNode.name}`, items);
      state.drag = null;
      return;
    }
    const netKind = (node: NodeItem) => node.kind === 'node' || node.kind === 'ground';
    const items = [];
    if (state.mode === 'circuit' && netKind(source) && netKind(target)) {
      items.push({
        label: '纯导线（合并两个网络节点）',
        hint: '电气上视为同一个网络；可以连续画多段',
        action: () => createWireBetween(source.id, target.id, '', ''),
      });
    }
    const list = kindListFor('edge');
    items.push(...list.map((spec: SpecRec) => ({
      label: spec.label,
      hint: spec.description,
      action: () => createEdge(source.id, target.id, spec.kind),
    })));
    openGenericMenu(ui.linkMenu, x, y, `${source.name} → ${target.name}`, items);
    state.drag = null;
  }

  let modalResolver: ((value: boolean) => void) | null = null;

  function closeModal() {
    ui.modal.classList.add('hidden');
    ui.modalCard.replaceChildren();
    const resolver = modalResolver;
    modalResolver = null;
    if (resolver) resolver(false);
  }

  function confirmModal(title: string, message: string | Node, confirmLabel = '确定', danger = false) {
    return new Promise((resolve) => {
      if (modalResolver) modalResolver(false);
      modalResolver = resolve;
      ui.modalCard.replaceChildren();
      const heading = el('h3', null, title);
      const body = message instanceof Node ? message : el('p', null, message);
      const actions = div('modal-actions');
      const cancel = button('取消', 'btn', () => {
        ui.modal.classList.add('hidden');
        const inner = modalResolver;
        modalResolver = null;
        if (inner) inner(false);
      });
      const okay = button(confirmLabel, danger ? 'btn danger' : 'btn primary', () => {
        ui.modal.classList.add('hidden');
        const inner = modalResolver;
        modalResolver = null;
        if (inner) inner(true);
      });
      actions.append(cancel, okay);
      ui.modalCard.append(heading, body, actions);
      ui.modal.classList.remove('hidden');
      setTimeout(() => okay.focus(), 30);
      ui.modal.onclick = (event: MouseEvent) => {
        if (event.target === ui.modal) cancel.click();
      };
      const onKey = (event: MouseEvent) => {
        if ((event as Event as KeyboardEvent).key === 'Escape') {
          event.preventDefault();
          document.removeEventListener('keydown', onKey as EventListener, true);
          cancel.click();
        }
      };
      document.addEventListener('keydown', onKey as EventListener, true);
    });
  }

  let modeResolver: ((value: string | null) => void) | null = null;

  function chooseModeModal() {
    return new Promise<string | null>((resolve) => {
      if (modeResolver) modeResolver(null);
      modeResolver = resolve;
      ui.modalCard.replaceChildren();
      const finish = (value: string | null) => {
        ui.modal.classList.add('hidden');
        ui.modalCard.replaceChildren();
        const inner = modeResolver;
        modeResolver = null;
        if (inner) inner(value);
      };
      const heading = el('h3', null, '新建工程：选择场景模式');
      const body = el('p', null, '模式决定可用元件与求解器；创建后仍可通过打开工程切换。');
      const list = div('modal-actions');
      const make = (mode: string, label: string, hint: string) => {
        const item = button(`${label} · ${hint}`, 'btn', () => finish(mode));
        item.style.flex = '1';
        return item;
      };
      const cancel = button('取消', 'btn', () => finish(null));
      list.append(
        make('signal', '信号流', '增益/求和/滤波'),
        make('circuit', '电路', '器件节点与 MNA'),
        make('vector', '矢量场', '有限元/场求解'),
      );
      const actions = div('modal-actions');
      actions.append(cancel);
      ui.modalCard.append(heading, body, list, actions);
      ui.modal.classList.remove('hidden');
      ui.modal.onclick = (event: MouseEvent) => {
        if (event.target === ui.modal) finish(null);
      };
    });
  }

  function showHelp() {
    openDoc('shortcuts');
  }

  let networkModalResolver: ((value: { name: string; mode: string } | null) => void) | null = null;

  function newNetworkModal(defaultMode: string = state.mode) {
    return new Promise<{ name: string; mode: string } | null>((resolve) => {
      if (networkModalResolver) networkModalResolver(null);
      networkModalResolver = resolve;
      ui.modalCard.replaceChildren();
      let chosen = defaultMode;
      const finish = (value: { name: string; mode: string } | null) => {
        ui.modal.classList.add('hidden');
        ui.modalCard.replaceChildren();
        const inner = networkModalResolver;
        networkModalResolver = null;
        if (inner) inner(value);
      };
      const heading = el('h3', null, '新建网络');
      const body = el('p', null, '每条网络独立保存自己的工作模式，切换活动网络时会自动载入。');
      const nameField = div('field');
      nameField.appendChild(el('span', null, '网络名称（可留空自动命名，最长 60 字）'));
      const nameInput = el<HTMLInputElement>('input', 'input');
      nameInput.type = 'text';
      nameInput.maxLength = 60;
      nameInput.placeholder = `网络 ${(state.networks?.length || 0) + 1}`;
      nameField.appendChild(nameInput);
      const modeSection = section('工作模式', '只在新建时应用，之后随该网络独立保存');
      const segmented = div('segmented');
      const modes =
        (state.catalog?.modes as Array<{ value: string; label: string; description?: string }> | undefined) || [
          { value: 'signal', label: '信号流' },
          { value: 'circuit', label: '电路' },
          { value: 'vector', label: '矢量场' },
        ];
      const modeButtons: HTMLButtonElement[] = [];
      for (const item of modes) {
        const btn = button(item.label, '', () => {
          chosen = item.value;
          for (const other of modeButtons) other.classList.toggle('active', other === btn);
        });
        btn.dataset.mode = item.value;
        btn.classList.toggle('active', item.value === chosen);
        btn.title = item.description || '';
        modeButtons.push(btn);
        segmented.appendChild(btn);
      }
      modeSection.appendChild(segmented);
      const actions = div('modal-actions');
      const cancel = button('取消', 'btn', () => finish(null));
      const okay = button('创建网络', 'btn primary', () =>
        finish({ name: nameInput.value.trim(), mode: chosen }),
      );
      actions.append(cancel, okay);
      ui.modalCard.append(heading, body, nameField, modeSection, actions);
      ui.modal.classList.remove('hidden');
      setTimeout(() => nameInput.focus(), 30);
      nameInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          okay.click();
        }
      });
      ui.modal.onclick = (event: MouseEvent) => {
        if (event.target === ui.modal) finish(null);
      };
    });
  }

  /* ======================================================================
   * 6. 检查器：按 catalog 的 ParamSpec 动态生成表单
   * ==================================================================== */

  async function selectEntity(type: string | null, id: string | null, force = false) {
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
          toast('当前修改无法保存，请先修正检查器中的参数', 'error', 5000);
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
    if (state.selection.type === 'node' && state.selection.id) nodes.add(state.selection.id);
    if (state.selection.type === 'edge' && state.selection.id) edges.add(state.selection.id);
    return { nodes, edges };
  }

  function toggleMultiSelection(type: string, id: string) {
    if (type === 'node') {
      if (state.multi.nodes.has(id)) state.multi.nodes.delete(id);
      else state.multi.nodes.add(id);
    } else if (type === 'edge') {
      if (state.multi.edges.has(id)) state.multi.edges.delete(id);
      else state.multi.edges.add(id);
    }
    if ((state.multi.nodes.size + state.multi.edges.size) === 1) {
      const onlyNode = state.multi.nodes.values().next().value;
      const onlyEdge = state.multi.edges.values().next().value;
      if (onlyNode) void selectEntity('node', onlyNode);
      else if (onlyEdge) void selectEntity('edge', onlyEdge);
    } else {
      requestDraw();
    }
    toast(`已选 ${state.multi.nodes.size} 节点 / ${state.multi.edges.size} 连接`, 'info', 1600);
  }

  function selectAll() {
    state.multi.nodes = new Set((state.scene?.nodes || []).map((node) => node.id));
    state.multi.edges = new Set((state.scene?.edges || []).map((edge) => edge.id));
    requestDraw();
    toast(`已全选 ${state.multi.nodes.size} 节点 / ${state.multi.edges.size} 连接`, 'info', 1800);
  }

  function clipboardPayload(): ClipboardRec | null {
    const { nodes, edges } = multiSelection();
    if (!nodes.size && !edges.size) return null;
    const nodeSet = new Set(nodes);
    const edgeList = (state.scene?.edges || []).filter(
      (edge) => edges.has(edge.id) || (nodeSet.has(edge.source) && nodeSet.has(edge.target)),
    );
    return {
      networkId: state.currentNetwork?.id || '',
      nodes: (state.scene?.nodes || [])
        .filter((node) => nodeSet.has(node.id))
        .map((node) => JSON.parse(JSON.stringify(node))),
      edges: edgeList.map((edge) => JSON.parse(JSON.stringify(edge))),
    };
  }

  function copySelection(cut = false) {
    const payload = clipboardPayload();
    if (!payload) {
      toast('先在画布上选择节点或连线（Ctrl+单击 / Ctrl+拖框）', 'info', 2600);
      return;
    }
    state.clipboard = payload;
    if (cut) {
      void deleteSelection();
      toast(`已剪切 ${payload.nodes.length} 节点 / ${payload.edges.length} 连接`, 'ok', 2200);
    } else {
      toast(`已复制 ${payload.nodes.length} 节点 / ${payload.edges.length} 连接`, 'ok', 2200);
    }
  }

  function uniquePasteName(base: string, reserved: Set<string>) {
    const existing = new Set((state.scene?.nodes || []).map((node) => node.name));
    let candidate = `${String(base || 'node').slice(0, 24)}_copy`;
    let index = 2;
    while (existing.has(candidate) || reserved.has(candidate)) {
      candidate = `${String(base || 'node').slice(0, 22)}_c${index++}`;
    }
    reserved.add(candidate);
    return candidate.slice(0, 32);
  }

  async function pasteClipboard() {
    const clipboard = state.clipboard;
    if (!clipboard || (!clipboard.nodes.length && !clipboard.edges.length)) {
      toast('剪贴板为空：先 Ctrl+C 复制选中对象', 'info', 2400);
      return;
    }
    if (clipboard.networkId && clipboard.networkId !== (state.currentNetwork?.id || '')) {
      const confirmed = await confirmModal(
        '跨网络粘贴？',
        '剪贴板来自另一个网络。连接与参数会保留绑定，但跨层语义请自行确认。',
        '粘贴',
        false,
      );
      if (!confirmed) return;
    }
    const offset = 28;
    await pushUndoSnapshot();
    const reserved = new Set();
    const idMap = new Map();
    let nodesCreated = 0;
    let edgesCreated = 0;
    for (const node of clipboard.nodes) {
      const payload = {
        name: uniquePasteName(node.name, (reserved as Set<string>)),
        kind: node.kind,
        params: node.params || {},
        data: node.data || {},
        position: {
          x: (Number(node.position?.x) || 0) + offset,
          y: (Number(node.position?.y) || 0) + offset,
        },
        size: node.size || {},
      };
      const response = await task(() => jsonRequest('/api/nodes', 'POST', payload), { history: false });
      if (!response?.node) continue;
      idMap.set(node.id, response.node.id);
      nodesCreated += 1;
    }
    for (const edge of clipboard.edges) {
      const source = idMap.get(edge.source);
      const target = idMap.get(edge.target);
      if (!source || !target) continue;
      const response = await task(
        () => jsonRequest('/api/edges', 'POST', {
          source,
          target,
          kind: edge.kind,
          params: edge.params || {},
          delay: Boolean(edge.delay),
          enabled: edge.enabled !== false,
          auto_delay: false,
          route: edge.route || 'auto',
          waypoints: edge.waypoints || [],
          anchors: edge.anchors || {},
        }),
        { history: false },
      );
      if (response) edgesCreated += 1;
    }
    await refreshState(true);
    toast(`已粘贴 ${nodesCreated} 节点 / ${edgesCreated} 连接`, 'ok', 2600);
  }

  async function captureSceneSnapshot() {
    try {
      return await jsonRequest('/api/scene/export', 'GET');
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

  async function restoreSceneSnapshot(payload: Record<string, unknown>) {
    const current = await captureSceneSnapshot();
    // 库文件（blocks）用当前值：撤销不得复活已删除的库模块（D25）。
    const merged = { ...payload, blocks: current?.blocks || [] };
    await jsonRequest('/api/control', 'POST', { action: 'pause' });
    const response = await jsonRequest('/api/scene', 'POST', merged);
    if (!response?.scene) return;
    clearSelection();
    applySnapshot(response);
    renderInspector();
    markProjectDirty();
  }

  async function undo() {
    const snapshot = state.undoStack.pop();
    if (!snapshot) {
      toast('没有可撤销的操作', 'info', 2000);
      return;
    }
    const current = await captureSceneSnapshot();
    if (current) state.redoStack.push(current);
    await task(() => restoreSceneSnapshot((snapshot as Record<string, unknown>)), { dirty: true, history: false });
    toast('已撤销', 'ok', 1600);
  }

  async function redo() {
    const snapshot = state.redoStack.pop();
    if (!snapshot) {
      toast('没有可重做的操作', 'info', 2000);
      return;
    }
    const current = await captureSceneSnapshot();
    if (current) state.undoStack.push(current);
    await task(() => restoreSceneSnapshot((snapshot as Record<string, unknown>)), { dirty: true, history: false });
    toast('已重做', 'ok', 1600);
  }



  function renderInspector() {
    syncFnRoleToSelection();
    scheduleSpecRender();
    if (!state.selection.type) {
      renderEmptyInspector();
      return;
    }
    if (state.selection.type === 'node') {
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

  /* ======================================================================
   * 7. 节点 / 连接 / 场景变更
   * ==================================================================== */

  async function alignSelection(mode: string) {
    const targets = [...multiSelection().nodes].map((id: string) => nodeById(id)).filter(Boolean);
    if (targets.length < 2) {
      toast('至少选中两个节点/器件才能对齐', 'info', 2400);
      return;
    }
    const xs = targets.map((node) => node!.position!.x);
    const ys = targets.map((node) => node!.position!.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const positions = targets.map((node) => {
      let x = node!.position!.x;
      let y = node!.position!.y;
      if (mode === 'left') x = minX;
      else if (mode === 'right') x = maxX;
      else if (mode === 'centerX') x = (minX + maxX) / 2;
      else if (mode === 'top') y = minY;
      else if (mode === 'bottom') y = maxY;
      else if (mode === 'centerY') y = (minY + maxY) / 2;
      return { id: node!.id, position: { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 } };
    });
    try {
      await jsonRequest('/api/positions', 'POST', { positions });
      await refreshState(true);
      toast(`已对齐 ${targets.length} 个节点（${mode}）`, 'ok', 2200);
    } catch (error) {
      toast(`对齐失败：${(error as Error).message}`, 'error', 4000);
    }
  }

  async function distributeSelection(axis: string) {
    const targets = [...multiSelection().nodes].map((id: string) => nodeById(id)).filter(Boolean);
    if (targets.length < 3) {
      toast('等距分布至少需要三个节点/器件', 'info', 2400);
      return;
    }
    const key = axis === 'y' ? 'y' : 'x';
    const sorted = [...targets].sort((a, b) => a!.position![key] - b!.position![key]);
    const first = sorted![0]!.position![key as 'x' | 'y'];
    const last = sorted![sorted.length - 1]!.position![key as 'x' | 'y'];
    const step = (last - first) / (sorted.length - 1);
    const positions = sorted.map((node, index: number) => {
      const value = index === 0 || index === sorted.length - 1
        ? node!.position![key]
        : first + step * index;
      const x = key === 'x' ? value : node!.position!.x;
      const y = key === 'y' ? value : node!.position!.y;
      return { id: node!.id, position: { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 } };
    });
    try {
      await jsonRequest('/api/positions', 'POST', { positions });
      await refreshState(true);
      toast(`已等距分布 ${targets.length} 个节点（${axis === 'y' ? '纵向' : '横向'}）`, 'ok', 2200);
    } catch (error) {
      toast(`分布失败：${(error as Error).message}`, 'error', 4000);
    }
  }

  function selectWireNetwork(edge: EdgeItem) {
    const ends = new Set([edge.source, edge.target]);
    const wires = (state.scene?.edges || []).filter(
      (item) => item.kind === 'wire' && (ends.has(item.source) || ends.has(item.target)),
    );
    state.multi.nodes = new Set(ends);
    state.multi.edges = new Set(wires.map((item) => item.id));
    state.selection = { type: null, id: null };
    requestDraw();
    toast(`已选中 ${wires.length} 条导线 / ${ends.size} 个端点`, 'info', 2200);
  }

  async function addWireWaypoint(edge: EdgeItem) {
    const source = nodeById(edge.source);
    const target = nodeById(edge.target);
    if (!source || !target) return;
    const x = (source.position!.x + target.position!.x) / 2;
    const y = (source.position!.y + target.position!.y) / 2;
    const waypoints = [...(edge.waypoints || []), { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }];
    try {
      await jsonRequest(`/api/edges/${encodeURIComponent(edge.id)}`, 'PATCH', {
        route: 'manual',
        waypoints,
      });
      await refreshState(true);
      state.selection = { type: 'edge', id: edge.id };
      renderInspector();
      requestDraw();
      toast(`已添加拐点（共 ${waypoints.length} 个）；可直接拖动拐点，画布会显示坐标`, 'ok', 2800);
    } catch (error) {
      toast(`添加拐点失败：${(error as Error).message}`, 'error', 4000);
    }
  }

  async function clearWireWaypoints(edgeId: string) {
    try {
      await jsonRequest(`/api/edges/${encodeURIComponent(edgeId)}`, 'PATCH', {
        route: 'auto',
        waypoints: [],
      });
      await refreshState(true);
      toast('已清除拐点，恢复自动布线', 'ok', 2200);
    } catch (error) {
      toast(`清除拐点失败：${(error as Error).message}`, 'error', 4000);
    }
  }

  async function batchResizeSelection() {
    const { nodes } = multiSelection();
    const targets = [...nodes].map((id: string) => nodeById(id)).filter(Boolean);
    if (!targets.length) {
      toast('先多选节点/器件（Ctrl+单击），再执行批量尺寸', 'info', 2800);
      return;
    }
    const raw = window.prompt(
      `统一尺寸（24–200，宽/直径）；将应用到 ${targets.length} 个节点/器件`,
      '60',
    );
    if (raw === null) return;
    const width = Number(raw);
    if (!Number.isFinite(width) || width < 24 || width > 200) {
      toast('尺寸需在 24–200 之间', 'error', 3000);
      return;
    }
    let done = 0;
    for (const node of targets) {
      if (node!.kind === 'ground') continue;
      try {
        await jsonRequest(`/api/nodes/${encodeURIComponent(node!.id)}`, 'PATCH', {
          size: { w: Math.round(width) },
        });
        done += 1;
      } catch (error) {
        toast(`设置 ${node!.name} 失败：${(error as Error).message}`, 'error', 4000);
      }
    }
    if (done) {
      await refreshState(true);
      toast(`已统一 ${done} 个节点/器件尺寸为 ${Math.round(width)}`, 'ok', 2600);
    }
  }

  async function addNodeAt(kind: string, screenX: number, screenY: number) {
    const spec = getNodeSpec(kind);
    if (!spec) {
      toast(`当前模式没有节点类型 ${kind}`, 'error');
      return;
    }
    const world = screenToWorld(screenX, screenY);
    const snapped = snapWorld(world.x, world.y);
    const base = kind === 'ground' ? 'gnd' : kind === 'node' ? 'n' : kind.replace(/[^a-z0-9_]/gi, '') || 'node';
    const name = uniqueNodeName(base);
    const payload = {
      name,
      kind,
      params: specDefaults(spec),
      data: kind === 'manual'
        ? (state.mode === 'vector' ? { x: 1.0, y: 0.0 } : { voltage: 1.0 })
        : {},
      position: {
        x: clamp(Math.round(snapped.x), -10000, 10000),
        y: clamp(Math.round(snapped.y), -10000, 10000),
      },
    };
    const response = await task(() => jsonRequest('/api/nodes', 'POST', payload));
    if (!response) return;
    applySnapshot(response);
    await selectEntity('node', response.node.id, true);
    switchTab('inspect');
    if (kind === 'ground') {
      const count = (state.scene?.nodes || []).filter((node) => node.kind === 'ground').length;
      toast(`已添加接地：共 ${count} 个，自动合并为 0V`, 'ok', 2600);
    } else {
      toast(`已添加节点 ${response.node.name}`, 'ok', 2000);
    }
  }

  async function addDeviceAt(element: string, screenX: number, screenY: number) {
    const spec = getEdgeSpec((element));
    if (!spec) {
      toast(`当前模式没有器件类型 ${element}`, 'error');
      return;
    }
    const world = screenToWorld(screenX, screenY);
    const snapped = snapWorld(world.x, world.y);
    const name = uniqueNodeName(element.replace(/[^a-z0-9]/gi, '') || 'dev');
    const payload = {
      name,
      kind: 'device',
      params: { element, ...specDefaults(spec) },
      data: {},
      position: {
        x: clamp(Math.round(snapped.x), -10000, 10000),
        y: clamp(Math.round(snapped.y), -10000, 10000),
      },
    };
    const response = await task(() => jsonRequest('/api/nodes', 'POST', payload));
    if (!response) return;
    applySnapshot(response);
    await selectEntity('node', response.node.id, true);
    switchTab('inspect');
    toast(`已添加器件 ${response.node.name}`, 'ok', 2000);
  }

  async function createWire(deviceId: string, netId: string, pinName: string) {
    return createWireBetween(deviceId, netId, pinName, '');
  }

  async function createWireBetween(sourceId: string, targetId: string, sourcePin: string | null, targetPin: string | null) {
    const source = nodeById(sourceId);
    const target = nodeById(targetId);
    if (!source || !target) {
      toast('连线的端点不存在', 'error', 3000);
      return;
    }
    if (source.id === target.id) {
      toast('连线的两个端点不能是同一个节点', 'error', 3000);
      return;
    }
    // 器件与模块实例都是"带引脚的东西"：模块实例的端口就是引脚。
    if (isPinNode(source) && isPinNode(target)) {
      toast('导线不允许直接连接两个器件（请经网络节点）', 'error', 3500);
      return;
    }
    const body: EdgeBodyRec = {
      source: source.id,
      target: target.id,
      kind: 'wire',
      params: {},
      enabled: true,
      route: state.ui?.circuitOrthogonal !== false ? 'orthogonal' : 'straight',
    };
    // 模块实例以前被漏掉（只判 kind==='device'），导致连到模块上的导线不带引脚。
    // 只有唯一端口时直接用它——用户从模块符号上拖线时不必再挑一次引脚。
    const pinFor = (node: NodeItem, pin: string | null) => {
      if (pin) return pin;
      const pins = devicePins(node);
      return pins.length === 1 ? String(pins[0].name || '') : '';
    };
    if (isPinNode(source)) body.source_pin = pinFor(source, ((sourcePin)));
    if (isPinNode(target)) body.target_pin = pinFor(target, ((targetPin)));
    const response = await task(() => jsonRequest('/api/edges', 'POST', body));
    if (!response) return;
    applySnapshot(response);
    if (response.edge) {
      await selectEntity('edge', response.edge.id, true);
      switchTab('inspect');
    }
    toast('已创建导线', 'ok', 1800);
  }

  function openWireDialog() {
    if (state.mode !== 'circuit') {
      toast('连线对话框只用于电路场景', 'error', 3000);
      return;
    }
    const nodes = state.scene?.nodes || [];
    if (nodes.length < 2) {
      toast('至少需要两个节点才能连线', 'error', 3000);
      return;
    }
    ui.modalCard.replaceChildren();
    const heading = el('h3', null, '新建连线（选择端点）');
    const note = el('p', null, '端点可以是「网络节点 ↔ 网络节点」（纯导线，电气合并）或「器件引脚 ↔ 网络节点」。');
    const form = el('form');
    form.autocomplete = 'off';
    const rows = div('inline-fields');
    const makeSelect = (roleLabel: string) => {
      const wrap = div('field');
      wrap.appendChild(numberedField(roleLabel, ''));
      const select = el('select');
      select.dataset.role = roleLabel.includes('A') ? 'wire-a' : 'wire-b';
      for (const node of nodes) {
        const option = el('option', null, `${node.name} · ${node.kind === 'module' ? `模块 ${node.params?.block_name || ''}`.trim() : node.kind === 'device' ? (node.params?.element || 'device') : node.kind}`);
        option.value = node.id;
        select.appendChild(option);
      }
      wrap.appendChild(select);
      const pinWrap = div('field');
      pinWrap.appendChild(numberedField('引脚', '器件节点必填'));
      const pinSelect = el('select');
      pinSelect.dataset.role = roleLabel.includes('A') ? 'wire-a-pin' : 'wire-b-pin';
      pinWrap.appendChild(pinSelect);
      return { wrap, select, pinWrap, pinSelect };
    };
    const first = makeSelect('端点 A');
    const second = makeSelect('端点 B');
    const refreshPins = () => {
      for (const item of [first, second]) {
        const node = nodeById(item.select.value);
        item.pinSelect.replaceChildren();
        const blank = el('option', null, isPinNode((node as NodeItem)) ? '（请选择引脚）' : '—');
        blank.value = '';
        item.pinSelect.appendChild(blank);
        if (isPinNode((node as NodeItem))) {
          for (const pin of devicePins((node as NodeItem))) {
            const option = el('option', null, `${pin.name}（${pin.role}${pin.required ? ' · 必接' : ''}）`);
            option.value = pin.name;
            item.pinSelect.appendChild(option);
          }
        }
        item.pinSelect.disabled = !isPinNode((node as NodeItem));
      }
    };
    first.select.addEventListener('change', refreshPins);
    second.select.addEventListener('change', refreshPins);
    if (nodes[1]) second.select.value = nodes[1].id;
    refreshPins();
    rows.append(first.wrap, first.pinWrap, second.wrap, second.pinWrap);
    form.appendChild(rows);
    const actions = div('modal-actions');
    const cancel = button('取消', 'btn', closeModal);
    const create = button('创建连线', 'btn primary', null);
    create.type = 'button';
    create.addEventListener('click', () => {
      const a = nodeById(first.select.value);
      const b = nodeById(second.select.value);
      const aPin = isPinNode((a as NodeItem)) ? first.pinSelect.value : '';
      const bPin = isPinNode((b as NodeItem)) ? second.pinSelect.value : '';
      if (isPinNode((a as NodeItem)) && !aPin) {
        toast('端点 A 是器件，请选择引脚', 'error', 3000);
        return;
      }
      if (isPinNode((b as NodeItem)) && !bPin) {
        toast('端点 B 是器件，请选择引脚', 'error', 3000);
        return;
      }
      closeModal();
      void createWireBetween(first.select.value, second.select.value, aPin, bPin);
    });
    actions.append(cancel, create);
    form.append(actions);
    ui.modalCard.append(heading, note, form);
    ui.modal.classList.remove('hidden');
  }

  async function createEdge(source: string, target: string, kind: string) {
    const spec = getEdgeSpec(kind);
    if (!spec) {
      toast(`当前模式没有连接类型 ${kind}`, 'error');
      return;
    }
    const body: EdgeBodyRec = {
      source,
      target,
      kind,
      params: specDefaults(spec),
      delay: false,
      enabled: true,
      auto_delay: false,
    };
    if (state.mode === 'circuit' && state.ui?.circuitOrthogonal !== false) body.route = 'orthogonal';
    const response = await task(() => jsonRequest('/api/edges', 'POST', body));
    if (!response) return;
    applySnapshot(response);
    if (response.edge) {
      await selectEntity('edge', response.edge.id, true);
      switchTab('inspect');
    }
    if (response.notice) toast(response.notice, 'info', 5000);
    else toast(`已创建连接 ${response.edge?.name || ''}`, 'ok', 1800);
  }

  async function toggleEdgeDelay(edgeId: string) {
    const edge = edgeById(edgeId);
    if (!edge) return;
    const response = await task(() => jsonRequest(`/api/edges/${encodeURIComponent(edgeId)}`, 'PATCH', { delay: !edge.delay }));
    if (!response) return;
    const index = state.scene!.edges.findIndex((item) => item.id === edgeId);
    if (index >= 0) state.scene!.edges[index] = response.edge;
    if (response.sim) state.sim = response.sim;
    syncUI();
    requestDraw();
    toast(response.edge.delay ? '已设为单步延迟' : '已取消单步延迟', 'ok', 2000);
    void refreshState(true);
  }

  async function deleteNode(nodeId: string) {
    const node = nodeById(nodeId);
    if (!node) return;
    const connected = (state.scene?.edges || []).filter((edge) => edge.source === nodeId || edge.target === nodeId).length;
    const confirmed = await confirmModal(
      `删除节点「${node.name}」？`,
      connected
        ? `将同时删除 ${connected} 条相连的连接。该操作不可撤销。`
        : '该操作不可撤销。',
      '删除',
      true,
    );
    if (!confirmed) return;
    const response = await task(() => jsonRequest(`/api/nodes/${encodeURIComponent(nodeId)}`, 'DELETE'));
    if (!response) return;
    if (state.selection.type === 'node' && state.selection.id === nodeId) {
      state.selection = { type: null, id: null };
      state.inspectorId = null;
    }
    applySnapshot(response);
    renderInspector();
    toast('节点已删除', 'ok', 1800);
  }

  async function deleteEdge(edgeId: string) {
    const edge = edgeById(edgeId);
    if (!edge) return;
    const confirmed = await confirmModal(
      `删除连接「${edge.name}」？`,
      '只删除这条传递关系，节点与其它连接保持不变。',
      '删除',
      true,
    );
    if (!confirmed) return;
    const response = await task(() => jsonRequest(`/api/edges/${encodeURIComponent(edgeId)}`, 'DELETE'));
    if (!response) return;
    if (state.selection.type === 'edge' && state.selection.id === edgeId) {
      state.selection = { type: null, id: null };
      state.inspectorId = null;
    }
    applySnapshot(response);
    renderInspector();
    toast('连接已删除', 'ok', 1800);
  }

  async function deleteSelection() {
    const { nodes, edges } = multiSelection();
    if (!nodes.size && !edges.size) return;
    await pushUndoSnapshot();
    let removed = 0;
    for (const edgeId of edges) {
      if (!edgeById(edgeId)) continue;
      const response = await task(
        () => jsonRequest(`/api/edges/${encodeURIComponent(edgeId)}`, 'DELETE'),
        { history: false },
      );
      if (response) {
        removed += 1;
        applySnapshot(response);
      }
    }
    for (const nodeId of nodes) {
      if (!nodeById(nodeId)) continue;
      const response = await task(
        () => jsonRequest(`/api/nodes/${encodeURIComponent(nodeId)}`, 'DELETE'),
        { history: false },
      );
      if (response) {
        removed += 1;
        applySnapshot(response);
      }
    }
    clearSelection();
    await refreshState(true);
    toast(`已删除 ${removed} 个对象`, 'ok', 2200);
  }

  async function autoLayout() {
    const nodes = state.scene?.nodes || [];
    if (!nodes.length) {
      toast('画布中还没有节点', 'info', 1800);
      return;
    }
    const edges = (state.scene?.edges || []).filter((edge) => edge.enabled);
    const ids = new Set(nodes.map((node) => node.id));
    const layer = new Map(nodes.map((node) => [node.id, 0]));

    if (state.mode === 'circuit') {
      const ground = nodes.find((node) => node.kind === 'ground');
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

    const groups = new Map();
    for (const node of nodes) {
      const level = layer.get(node.id) || 0;
      if (!groups.has(level)) groups.set(level, []);
      groups.get(level).push(node);
    }
    const levels = Array.from(groups.keys()).sort((a, b) => a - b);
    const mid = (levels[0] + levels[levels.length - 1]) / 2;
    const old = new Map(nodes.map((node) => [node.id, { x: node.position!.x, y: node.position!.y }]));

    for (const level of levels) {
      const members = groups.get(level).sort((a: NodeItem, b: NodeItem) => {
        if (a.position!.y !== b.position!.y) return a.position!.y - b.position!.y;
        return a.name.localeCompare(b.name);
      });
      members.forEach((node: NodeItem, index: number) => {
        node.position!.x = (level - mid) * 276;
        node.position!.y = (index - (members.length - 1) / 2) * 128;
      });
    }

    requestDraw();
    try {
      const items = nodes.map((node) => ({
        id: node.id,
        position: { x: Number(node.position!.x.toFixed(3)), y: Number(node.position!.y.toFixed(3)) },
      }));
      await jsonRequest('/api/positions', 'POST', { positions: items });
      fitView();
      toast('已按信号流向重新布局', 'ok', 1800);
    } catch (error) {
      for (const node of nodes) {
        const previous = old.get(node.id);
        if (previous) {
          node.position!.x = previous.x;
          node.position!.y = previous.y;
        }
      }
      requestDraw();
      toast(`自动布局失败：${(error as Error).message}`, 'error', 6000);
    }
  }

  /* ======================================================================
   * 8. 场景面板：模式、节奏、统计、模板、导入导出
   * ==================================================================== */

  function fieldFor(labelText: string, unitText: string, input: HTMLInputElement) {
    const wrapper = div('field');
    wrapper.appendChild(numberedField(labelText, unitText));
    wrapper.appendChild(input);
    return wrapper;
  }

  function numberInput(value: number, options: ApiOptions = {}) {
    const input = el('input');
    input.type = 'number';
    if (options.min !== undefined) input.min = String(options.min);
    if (options.max !== undefined) input.max = String(options.max);
    if (options.step !== undefined) input.step = String(options.step);
    input.value = String(value);
    return input;
  }

  function renderScenePanel() {
    const pane = ui.scenePane;
    if (!pane) return;
    pane.replaceChildren();
    pane.dataset.ready = '1';

    const modes = state.catalog?.modes || [
      { value: 'signal', label: '信号流' },
      { value: 'circuit', label: '电路' },
    ];
    const modeSection = section('工作模式', '切换会重建空白场景');
    const segmented = div('segmented');
    segmented.dataset.role = 'mode';
    for (const item of (modes as Array<{ value: string; label: string; description?: string }>)) {
      const btn = button(item.label, '', () => void switchMode(item.value));
      btn.dataset.mode = item.value;
      btn.classList.toggle('active', item.value === state.mode);
      btn.title = item.description || '';
      segmented.appendChild(btn);
    }
    modeSection.appendChild(segmented);
    modeSection.appendChild(div('help', '信号流按拓扑顺序传播字典数据；电路用节点电压法求解；矢量模式提供非线性动态源、二维矢量连接与相图。'));
    pane.appendChild(modeSection);

    const simSection = section('仿真节奏', '修改后自动应用');
    const simGrid = div('inline-fields');
    const fpsInput = numberInput(30, { min: 1, max: 240, step: 1 });
    fpsInput.dataset.sim = 'fps';
    const stepsInput = numberInput(1, { min: 1, max: 200, step: 1 });
    stepsInput.dataset.sim = 'steps';
    const dtInput = numberInput(0.01, { min: 0.000000001, max: 10, step: 'a' + 'ny' });
    dtInput.dataset.sim = 'dt';
    const sampleInput = numberInput(1, { min: 1, max: 100, step: 1 });
    sampleInput.dataset.sim = 'sample';
    simGrid.append(
      fieldFor('帧率', 'fps', fpsInput),
      fieldFor('每帧步数', 'steps', stepsInput),
      (() => {
        const field = fieldFor('时间步长', 's', dtInput);
        const tools = div('inline-fields');
        const stepDown = button('÷10', 'btn tiny', () => {
          dtInput.value = trimNumber(Math.max(1e-9, Number(dtInput.value) / 10));
          dtInput.dispatchEvent(new Event('change', { bubbles: true }));
        });
        const stepUp = button('×10', 'btn tiny', () => {
          dtInput.value = trimNumber(Math.min(10, Number(dtInput.value) * 10));
          dtInput.dispatchEvent(new Event('change', { bubbles: true }));
        });
        stepDown.title = '时间步长 ÷10（更细）';
        stepUp.title = '时间步长 ×10（更粗）';
        tools.append(stepDown, stepUp);
        field.appendChild(tools);
        return field;
      })(),
      fieldFor('采样间隔', '帧', sampleInput),
    );
    simSection.appendChild(simGrid);

    const lockRow = div('switch-row');
    lockRow.appendChild(el('span', null, '锁定 dt = 1 / (fps × 步数)'));
    const lockInput = el('input');
    lockInput.type = 'checkbox';
    lockInput.dataset.sim = 'lock';
    lockRow.appendChild(lockInput);
    simSection.appendChild(lockRow);

    const realtimeRow = div('switch-row');
    realtimeRow.appendChild(el('span', null, '实时节拍（关闭则极速迭代）'));
    const realtimeInput = el('input');
    realtimeInput.type = 'checkbox';
    realtimeInput.dataset.sim = 'realtime';
    realtimeRow.appendChild(realtimeInput);
    simSection.appendChild(realtimeRow);

    const precisionRow = div('inline-fields');
    precisionRow.appendChild(el('span', null, '时间步长预设'));
    for (const [label, value] of [['快速 1e-4', 1e-4], ['标准 1e-5', 1e-5], ['高精度 1e-6', 1e-6], ['超高 1e-7', 1e-7]]) {
      const preset = button((label as string | null | undefined), 'btn tiny', () => {
        dtInput.value = String(value);
        if (lockInput.checked) {
          lockInput.checked = false;
          dtInput.disabled = false;
        }
        void applySimConfig();
      });
      preset.dataset.dtPreset = String(value);
      preset.title = `时间步长设为 ${value} s`;
      precisionRow.appendChild(preset);
    }
    simSection.appendChild(precisionRow);
    simSection.appendChild(div('help', '时间步长越小求解越细，但每帧计算量越大；曲线分辨率还受「采样间隔」影响。'));

    const simNote = div('help');
    simNote.dataset.role = 'sim-note';
    simSection.appendChild(simNote);
    pane.appendChild(simSection);

    const solverSection = section('求解器设置', '电路模式：Newton 收敛与失败救急');
    const solverGrid = div('inline-fields');
    const solverInput = (label: string, unit: string, name: string, value: number, min: number, max: number, step: number | string) => {
      const input = numberInput(value, { min, max, step });
      input.dataset.solver = name;
      return fieldFor(label, unit, input);
    };
    solverGrid.append(
      solverInput('相对容差 reltol', '', 'reltol', 1e-9, 1e-15, 0.1, 'a' + 'ny'),
      solverInput('电压容差 vntol', 'V', 'vntol', 1e-6, 1e-15, 1, 'a' + 'ny'),
      solverInput('电流容差 abstol', 'A', 'abstol', 1e-6, 1e-15, 1, 'a' + 'ny'),
      solverInput('Newton 上限', '次', 'max_iter', 60, 1, 500, 1),
      solverInput('gmin 步数', '步', 'gmin_steps', 10, 0, 100, 1),
      solverInput('source 步数', '步', 'src_steps', 10, 0, 100, 1),
      solverInput('残差容差', '', 'residual_tol', 0, 0, 1, 'a' + 'ny'),
    );
    solverSection.appendChild(solverGrid);
    solverSection.appendChild(div('help', '残差容差 0 = 只记录不强制；失败时自动 gmin/source stepping，仍失败会报最大节点。修改后立即生效（重建电路引擎）。'));
    pane.appendChild(solverSection);

    if (state.mode !== 'circuit') {
      const algebraicSection = section('信号流代数环', '显式选择；不再静默改写拓扑');
      const algebraicRow = div('set-row');
      const algebraicLabel = el('label', null, '直接馈通求解');
      algebraicLabel.appendChild(el('em', null, '开启后环路由 solver_plan/SCC 求线性解；关闭时含环连接报错，除非显式设置单步延迟'));
      const algebraicControl = div('set-control');
      const algebraicInput = el('input');
      algebraicInput.type = 'checkbox';
      algebraicInput.dataset.role = 'algebraic';
      algebraicInput.checked = Boolean(state.scene?.solve_algebraic);
      algebraicInput.addEventListener('change', () => void changeAlgebraicSolver(algebraicInput.checked));
      algebraicControl.appendChild(algebraicInput);
      algebraicRow.append(algebraicLabel, algebraicControl);
      algebraicSection.appendChild(algebraicRow);
      pane.appendChild(algebraicSection);
    }

    const statsSection = section('网络统计', '运行时更新');
    const statsGrid = div('stat-grid');
    const statSpecs = [
      ['节点', 'nodes'], ['连接', 'edges'],
      ['步耗时', 'step'], ['实际帧率', 'fps'],
      ['矩阵', 'matrix'], ['Newton', 'iterations'],
      ['录制帧', 'frames'], ['修订', 'revision'],
    ];
    for (const [labelText, key] of statSpecs) {
      const stat = div('stat');
      stat.appendChild(el('span', null, labelText));
      const value = el('b', null, '—');
      value.dataset.stat = key;
      stat.appendChild(value);
      statsGrid.appendChild(stat);
    }
    statsSection.appendChild(statsGrid);
    pane.appendChild(statsSection);

    const integrationSection = section('积分方法', '仅电路模式');
    const integration = el('select');
    integration.dataset.role = 'integration';
    for (const item of ((state.catalog?.integration as Array<{ value: string; label: string }>) || [])) {
      const option = el('option', null, item.label || item.value);
      option.value = item.value;
      integration.appendChild(option);
    }
    integration.addEventListener('change', () => void changeIntegration(integration.value));
    integrationSection.appendChild(integration);
    const integrationNote = div('help');
    integrationNote.dataset.role = 'integration-note';
    integrationSection.appendChild(integrationNote);
    pane.appendChild(integrationSection);

    const templateSection = section('场景模板', '一键替换');
    const templateList = div('template-list');
    templateList.dataset.role = 'templates';
    for (const template of state.templates) {
      const item = el('button', 'template');
      item.type = 'button';
      const title = el('strong');
      title.append(el('span', null, template.label));
      title.append(document.createTextNode('  '));
      const modeBadge = el('span', 'tpl-mode', modeLabel((template.mode as string)));
      title.appendChild(modeBadge);
      item.appendChild(title);
      item.appendChild(el('small', null, template.description));
      if (template.sim && Object.keys(template.sim).length) {
        const bits = [];
        if (template.sim.fps) bits.push(`${template.sim.fps} fps`);
        if (template.sim.dt) bits.push(`dt ${fmt(template.sim.dt, 3)}`);
        if (template.sim.steps_per_frame) bits.push(`${template.sim.steps_per_frame} 步/帧`);
        item.appendChild(el('small', null, bits.join(' · ')));
      }
      item.addEventListener('click', () => void loadTemplate(template.name, template.label));
      templateList.appendChild(item);
    }
    if (!state.templates.length) templateList.appendChild(div('help', '模板目录不可用。'));
    templateSection.appendChild(templateList);
    pane.appendChild(templateSection);

    const projectSection = section('工程文件', '版本化 .netlab · 原子写入');
    const projectName = el('input');
    projectName.type = 'text';
    projectName.maxLength = 120;
    projectName.dataset.role = 'project-name';
    projectName.value = state.project.name || '';
    projectName.addEventListener('change', () => {
      const value = projectName.value.trim() || '未命名工程';
      if (value !== state.project.name) {
        state.project.name = value.slice(0, 120);
        markProjectDirty();
      }
      updateProjectPanel();
    });
    projectSection.appendChild(fieldFor('工程名称', '', projectName));

    const projectPath = div('project-path');
    projectPath.dataset.role = 'project-path';
    projectSection.appendChild(projectPath);

    const projectRow = div('file-row');
    projectRow.append(
      button('保存', 'btn', () => void saveProject(false)),
      button('另存为…', 'btn', () => void saveProject(true)),
      button('打开…', 'btn', () => void openProject()),
      button('恢复自动保存', 'btn', () => void recoverAutosave()),
    );
    projectSection.appendChild(projectRow);

    const autosaveRow = div('switch-row');
    autosaveRow.appendChild(
      el('span', null, `每 ${Math.round(state.project.autosaveInterval / 1000)} 秒写工程快照（只写 backups/，不动正本）`),
    );
    const autosaveToggle = el('input');
    autosaveToggle.type = 'checkbox';
    autosaveToggle.dataset.role = 'project-autosave';
    autosaveToggle.checked = Boolean(state.project.autosave);
    autosaveToggle.addEventListener('change', () => {
      state.project.autosave = Boolean(autosaveToggle.checked);
      try {
        localStorage.setItem(AUTOSAVE_ENABLED_KEY, state.project.autosave ? '1' : '0');
      } catch (error) {
        /* 忽略 */
      }
      toast(state.project.autosave ? '已开启自动保存' : '已关闭自动保存', 'info', 2000);
    });
    autosaveRow.appendChild(autosaveToggle);
    projectSection.appendChild(autosaveRow);

    const recentBox = div('recent-projects');
    recentBox.dataset.role = 'project-recent';
    projectSection.appendChild(recentBox);

    const fileInput = el('input');
    setProjectFileInput(fileInput);
    fileInput.type = 'file';
    fileInput.accept = '.netlab,application/json,.json';
    fileInput.className = 'hidden-input';
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) {
        toast('工程文件超过 8 MB，已拒绝', 'error', 6000);
        return;
      }
      void file.text().then((text: string) => importProjectText(text, ''));
    });
    projectSection.appendChild(fileInput);
    projectSection.appendChild(div('help', '工程只保存拓扑、参数、模块定义与界面偏好，不保存运行状态与录制帧。浏览器模式通过下载/上传文件保存。'));
    pane.appendChild(projectSection);

    const gridSection = section('画布与标准网格', '吸附 · 正交布线 · 整理');
    const gridRow = div('field-row');
    const snapBox = el('input');
    snapBox.type = 'checkbox';
    snapBox.checked = Boolean(state.ui.snap);
    snapBox.addEventListener('change', () => {
      state.ui.snap = Boolean(snapBox.checked);
      markProjectDirty();
      toast(state.ui.snap ? '网格吸附已开启' : '网格吸附已关闭', 'info', 1800);
    });
    const gridSelect = el('select', 'input');
    for (const size of [10, 20, 50]) {
      const option = el('option', null, `${size} 单位`);
      option.value = String(size);
      gridSelect.appendChild(option);
    }
    gridSelect.value = String(Number(state.ui.grid) || 20);
    gridSelect.addEventListener('change', () => {
      state.ui.grid = Number(gridSelect.value) || 20;
      markProjectDirty();
      requestDraw();
    });
    gridRow.append(el('label', null, '吸附'), snapBox, el('label', null, '标准网格'), gridSelect);
    gridSection.appendChild(gridRow);

    const styleRow = div('field-row');
    const nodeStyleSelect = el('select', 'input');
    for (const [value, label] of [['circle', '空心圆'], ['dot', '实心点'], ['box', '小方框']]) {
      const option = el('option', null, label);
      option.value = value;
      nodeStyleSelect.appendChild(option);
    }
    nodeStyleSelect.value = state.ui.nodeStyle || 'circle';
    nodeStyleSelect.addEventListener('change', () => {
      state.ui.nodeStyle = nodeStyleSelect.value;
      markProjectDirty();
      requestDraw();
    });
    const scaleSelect = el('select', 'input');
    for (const size of [0.8, 1.0, 1.2, 1.6]) {
      const option = el('option', null, `${size}×`);
      option.value = String(size);
      scaleSelect.appendChild(option);
    }
    scaleSelect.value = String(Number(state.ui.symbolScale) || 1.2);
    scaleSelect.addEventListener('change', () => {
      state.ui.symbolScale = Number(scaleSelect.value) || 1.2;
      markProjectDirty();
      requestDraw();
    });
    const colorSelect = el('select', 'input');
    for (const [value, label] of [['#1f5f5b', '青绿'], [C('#a8541f'), '暖橙'], ['#2563a8', '靛蓝']]) {
      const option = el('option', null, label);
      option.value = value;
      colorSelect.appendChild(option);
    }
    colorSelect.value = state.ui.glyphColor || '#1f5f5b';
    colorSelect.addEventListener('change', () => {
      state.ui.glyphColor = colorSelect.value;
      markProjectDirty();
      requestDraw();
    });
    styleRow.append(
      el('label', null, '节点样式'), nodeStyleSelect,
      el('label', null, '符号大小'), scaleSelect,
      el('label', null, '符号颜色'), colorSelect,
    );
    gridSection.appendChild(styleRow);
    gridSection.appendChild(
      button('整理到网格', 'btn', () => void snapSceneToGrid()),
    );
    gridSection.appendChild(div('help', '元件位置由元件自身 layout 决定（可在检查器微调）；不再自动重排，避免打乱手工图。'));
    gridSection.appendChild(
      div('help', '电路模式新建连线默认正交路由；拖动/新建节点吸附到网格；按住 Alt 临时暂停吸附。整理会按当前网格对齐全部节点与手动拐点（可撤销）。'),
    );
    pane.appendChild(gridSection);
    updateProjectPanel();

    const dataSection = section('场景数据', 'JSON');
    const fileRow = div('file-row');
    fileRow.appendChild(button('导出 JSON', 'btn', () => void exportScene()));
    fileRow.appendChild(button('导出原理图 SVG', 'btn', () => void exportSchematic()));
    fileRow.appendChild(button('导入 JSON', 'btn', () => importInput.click()));
    dataSection.appendChild(fileRow);
    const importInput = el('input');
    importInput.type = 'file';
    importInput.accept = 'application/json,.json';
    importInput.className = 'hidden-input';
    importInput.addEventListener('change', () => {
      const file = importInput.files && importInput.files[0];
      importInput.value = '';
      if (file) void importSceneFile(file);
    });
    dataSection.appendChild(importInput);
    dataSection.appendChild(div('help', '导出不含运行时状态；导入上限 2 MB，导入前会再次确认。服务端会校验节点、连接、参数与拓扑。'));
    pane.appendChild(dataSection);

    for (const input of [fpsInput, stepsInput, dtInput, sampleInput, lockInput, realtimeInput]) {
      input.addEventListener('change', () => void applySimConfig());
    }
    for (const input of $$('[data-solver]', pane)) {
      input.addEventListener('change', () => void applySimConfig());
    }
    lockInput.addEventListener('change', () => {
      dtInput.disabled = lockInput.checked;
    });

    updateModeUI();
    updateScenePanelValues();
  }

  function setStat(key: string, value: unknown) {
    const node = $(`[data-stat="${key}"]`, ui.scenePane);
    if (node) node.textContent = value as string;
  }

  function updateScenePanelValues() {
    const pane = ui.scenePane;
    if (!pane || !pane.dataset.ready) return;
    const sim = state.sim;
    const config = sim?.config;
    if (config) {
      const setValue = (name: string, value: unknown) => {
        const input = $(`[data-sim="${name}"]`, pane);
        if (!input) return;
        if (document.activeElement === input) return;
        (input as HTMLInputElement).value = String(value);
      };
      setValue('fps', config.fps);
      setValue('steps', config.steps_per_frame);
      setValue('dt', config.dt);
      setValue('sample', config.sample_every);
      for (const key of ['reltol', 'vntol', 'abstol', 'max_iter', 'gmin_steps', 'src_steps', 'residual_tol']) {
        if (config[key] !== undefined) setValue(key, config[key]);
      }
      const lock = $('[data-sim="lock"]', pane);
      if (lock) (lock as HTMLInputElement).checked = Boolean(config.lock_dt);
      const realtime = $('[data-sim="realtime"]', pane);
      if (realtime) (realtime as HTMLInputElement).checked = Boolean(config.realtime);
      const algebraic = $('[data-role="algebraic"]', pane);
      if (algebraic) (algebraic as HTMLInputElement).checked = Boolean(state.scene?.solve_algebraic);
      const dtInput = $('[data-sim="dt"]', pane);
      if (dtInput) (dtInput as HTMLButtonElement).disabled = Boolean(config.lock_dt);

      const note = $('[data-role="sim-note"]', pane);
      if (note) {
        const perFrame = Number(config.dt) * Number(config.steps_per_frame);
        const perSecond = perFrame * Number(config.fps);
        let text = `每帧 ${fmt(perFrame, 4)} s · 每秒推进 ${fmt(perSecond, 4)} s`;
        if (config.realtime) {
          text += perSecond > 1.0001 ? ` · 加速 ${perSecond.toFixed(2)}×` : ' · 实时';
        } else {
          text += ' · 极速模式（不等待墙钟）';
        }
        text += config.lock_dt ? ' · dt 已锁定（每帧固定 1/fps，曲线采样也受此限制）' : '';
        note.textContent = text;
      }
    }

    const scene = state.scene;
    const stats = (sim?.scene || {}) as SimStats;
    setStat('nodes', String(scene?.nodes?.length ?? 0));
    setStat('edges', String(scene?.edges?.length ?? 0));
    const stepMs = Number((scene?.stats as SimStats)?.step_ms ?? stats.step_ms ?? 0);
    const stepEl = $('[data-stat="step"]', pane);
    if (stepEl) {
      stepEl.replaceChildren(
        document.createTextNode(fmt(stepMs, 3)),
        el('small', null, 'ms'),
      );
    }
    setStat('fps', String(Math.round(sim?.actual_fps ?? 0)));
    setStat('matrix', stats.kind === 'circuit' ? `${stats.matrix_size || 0}×${stats.matrix_size || 0}` : '—');
    setStat('iterations', stats.iterations !== undefined ? String(stats.iterations) : '—');
    setStat('frames', String(sim?.frames_recorded ?? state.frames.length));
    setStat('revision', String(scene?.revision ?? 0));

    const integration = $('[data-role="integration"]', pane);
    if (integration && scene) {
      (integration as HTMLInputElement).value = (scene.integration || 'trapezoidal') as string;
      (integration as HTMLButtonElement).disabled = state.mode !== 'circuit';
    }
    const note = $('[data-role="integration-note"]', pane);
    if (note) {
      note.textContent = state.mode === 'circuit'
        ? '梯形法精度高；后向欧拉更稳定，适合刚性电路。'
        : '仅电路模式使用；信号流由每条连接的离散化参数决定。';
    }
    const modeHost = $('[data-role="mode"]', pane);
    if (modeHost) {
      $$('button[data-mode]', modeHost).forEach((item) => {
        item.classList.toggle('active', item.dataset.mode === state.mode);
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

    const fps = Number((fpsInput as HTMLInputElement).value);
    const steps = Number((stepsInput as HTMLInputElement).value);
    const sample = Number((sampleInput as HTMLInputElement).value);
    const lock = Boolean((lockInput as HTMLInputElement)?.checked);
    let dt = Number((dtInput as HTMLInputElement).value);
    if (!Number.isInteger(fps) || fps < 1 || fps > 240) throw new Error('帧率必须是 1–240 的整数');
    if (!Number.isInteger(steps) || steps < 1 || steps > 200) throw new Error('每帧步数必须是 1–200 的整数');
    if (!Number.isInteger(sample) || sample < 1 || sample > 100) throw new Error('采样间隔必须是 1–100 的整数');
    if (lock) dt = 1 / (fps * steps);
    if (!Number.isFinite(dt) || dt < 1e-9 || dt > 10) throw new Error('dt 必须在 1e-9 到 10 s 之间');
    if (dt * steps > 10) throw new Error('每帧推进的仿真时间过大，请减小 dt 或步数');
    const readSolver = (name: string, label: string, lo: number, hi: number, integer = false) => {
      const input = $(`[data-solver="${name}"]`, pane);
      if (!input) return undefined;
      const value = Number((input as HTMLInputElement).value);
      if (!Number.isFinite(value) || value < lo || value > hi) {
        throw new Error(`${label}必须在 ${lo}–${hi} 之间`);
      }
      if (integer && !Number.isInteger(value)) throw new Error(`${label}必须是整数`);
      return value;
    };
    const payload: Record<string, number | boolean> = {
      fps,
      steps_per_frame: steps,
      dt,
      sample_every: sample,
      lock_dt: lock,
      realtime: Boolean((realtimeInput as HTMLInputElement)?.checked),
    };
    const solverFields = [
      ['reltol', '相对容差 reltol', 1e-15, 0.1, false],
      ['vntol', '电压容差 vntol', 1e-15, 1, false],
      ['abstol', '电流容差 abstol', 1e-15, 1, false],
      ['max_iter', 'Newton 迭代上限', 1, 500, true],
      ['gmin_steps', 'gmin 步数', 0, 100, true],
      ['src_steps', 'source 步数', 0, 100, true],
      ['residual_tol', '残差容差', 0, 1, false],
    ];
    for (const [key, label, lo, hi, integer] of solverFields) {
      const value = readSolver(key as string, label as string, lo as number, hi as number, integer as boolean);
      if (value !== undefined) payload[key as string] = value;
    }
    return payload;
  }

  async function applySimConfig() {
    let payload;
    try {
      payload = readSimConfig();
    } catch (error) {
      toast((error as Error).message, 'error', 6000);
      updateScenePanelValues();
      return;
    }
    if (!payload) return;
    const response = await task(() => jsonRequest('/api/config', 'PATCH', payload));
    if (!response) {
      updateScenePanelValues();
      return;
    }
    state.sim = response.sim;
    syncUI();
    updateScenePanelValues();
    updateRunButton(Boolean(state.sim?.running));
    const solverKeys = ['reltol', 'vntol', 'abstol', 'max_iter', 'gmin_steps', 'src_steps', 'residual_tol'];
    toast('仿真设置已更新', 'ok', 1600);
  }

  async function changeIntegration(value: string) {
    if (state.mode !== 'circuit') {
      toast('积分方法只用于电路模式', 'info', 1800);
      updateScenePanelValues();
      return;
    }
    const response = await task(() => jsonRequest('/api/scene', 'PATCH', { integration: value }));
    if (!response) {
      updateScenePanelValues();
      return;
    }
    applySnapshot(response);
    renderScenePanel();
    toast(`积分方法已切换为 ${value === 'trapezoidal' ? '梯形法' : '后向欧拉'}`, 'ok', 2000);
  }

  async function changeAlgebraicSolver(enabled: boolean) {
    const response = await task(() => jsonRequest('/api/scene/algebraic', 'PUT', { enabled }));
    if (!response) {
      updateScenePanelValues();
      return;
    }
    applySnapshot(response);
    renderScenePanel();
    toast(enabled ? '已开启信号流代数环直接求解' : '已关闭代数环直接求解', 'ok', 2000);
  }

  async function switchMode(mode: string, options: ApiOptions = {}) {
    if (mode === state.mode) return;
    if (!options.skipConfirm) {
      const confirmed = await confirmModal(
        `切换到${modeLabel(mode)}模式？`,
        '切换会把当前场景替换为该模式的空白模板，节点、连接、参数与录制数据都会清空。请先导出需要保留的场景。',
        '切换',
        true,
      );
      if (!confirmed) return;
    }
    const response = await task(() => jsonRequest('/api/mode', 'POST', { mode }));
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
    toast(`已切换到${modeLabel(mode)}模式`, 'ok', 2200);
  }

  async function loadTemplate(name: string, label: string) {
    const nodeCount = state.scene?.nodes?.length || 0;
    if (nodeCount > 0) {
      const confirmed = await confirmModal(
        `载入模板「${label}」？`,
        `当前场景有 ${nodeCount} 个节点，将被模板完全替换。请先导出需要保留的场景。`,
        '载入',
        true,
      );
      if (!confirmed) return;
    }
    const response = await task(() => jsonRequest(`/api/templates/${encodeURIComponent(name)}`, 'POST'));
    if (!response) return;
    state.selection = { type: null, id: null };
    state.inspectorId = null;
    applySnapshot(response);
    state.cursor = Number(response.sim?.cursor) || 0;
    renderInspector();
    renderScenePanel();
    renderSignalList();
    fitView();
    toast(`已载入模板：${label}`, 'ok', 2200);
  }

  async function migrateSceneToDevices() {
    if (state.mode !== 'circuit') {
      toast('只有电路场景可以迁移为器件模型', 'error', 3500);
      return;
    }
    const confirmed = await confirmModal(
      '迁移为器件模型（R20）',
      '将把当前场景的元件边转换为「器件节点 + 引脚导线」，网络节点保留；之后工程按 v4 保存。该操作不可撤销。',
      '迁移',
      false,
    );
    if (!confirmed) return;
    const response = await task(() => jsonRequest('/api/scene/migrate-devices', 'POST', {}));
    if (!response) return;
    applySnapshot(response);
    const converted = Number(response.migration?.converted || 0);
    toast(`已迁移 ${converted} 个元件为器件节点`, 'ok', 3000);
    fitView(true);
  }

  async function clearScene() {
    const confirmed = await confirmModal(
      '清空当前场景？',
      '将删除所有节点与连接，并重建为空白模板。该操作不可撤销。',
      '清空',
      true,
    );
    if (!confirmed) return;
    const response = await task(() => jsonRequest('/api/scene/clear', 'POST'));
    if (!response) return;
    state.selection = { type: null, id: null };
    state.inspectorId = null;
    applySnapshot(response);
    state.cursor = Number(response.sim?.cursor) || 0;
    renderInspector();
    renderScenePanel();
    renderSignalList();
    fitView();
    toast('场景已清空', 'ok', 2000);
  }

  async function exportScene() {
    const payload = await task(() => api('/api/scene/export?include_state=false'), { dirty: false });
    if (!payload) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const text = JSON.stringify(payload, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a');
    link.href = url;
    link.download = `netlab-${state.mode}-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('场景已导出', 'ok', 1800);
  }

  async function exportSchematic() {
    if (state.scene?.mode !== 'circuit') {
      toast('原理图导出仅支持电路模式', 'info', 2600);
      return;
    }
    const params = new URLSearchParams({
      name: state.project?.name || '',
      network: state.currentNetwork?.name || '',
    });
    const payload = await task(
      () => jsonRequest(`/api/export/schematic?${params.toString()}`, 'GET'),
      { dirty: false },
    );
    if (!payload?.svg) return;
    const blob = new Blob([String(payload.svg)], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = el('a');
    link.href = url;
    link.download = String(payload.filename || 'schematic.svg');
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('原理图 SVG 已导出', 'ok', 1800);
  }

  async function importSceneFile(file: File) {
    if (file.size > MAX_IMPORT_BYTES) {
      toast('场景文件超过 2 MB，已拒绝', 'error', 6000);
      return;
    }
    let payload;
    try {
      const text = await file.text();
      payload = JSON.parse(text);
    } catch (error) {
      toast(`JSON 解析失败：${(error as Error).message}`, 'error', 6000);
      return;
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      toast('场景必须是 JSON 对象', 'error', 5000);
      return;
    }
    if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) {
      toast('场景必须包含 nodes 与 edges 数组', 'error', 5000);
      return;
    }
    const confirmed = await confirmModal(
      '导入并替换当前场景？',
      `文件包含 ${payload.nodes.length} 个节点、${payload.edges.length} 条连接。导入会清空当前场景的节点、连接与录制数据。`,
      '导入',
      true,
    );
    if (!confirmed) return;
    const response = await task(() => jsonRequest('/api/scene', 'POST', payload));
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
    toast('场景已导入', 'ok', 2200);
  }

  /* ======================================================================
   * 9. 信号图与实时轮询
   * ==================================================================== */

  function decodeProbeKey(key: string) {
    if (key.startsWith('n:')) {
      const rest = key.slice(2);
      const cut = rest.lastIndexOf(':');
      return {
        group: '节点',
        label: cut > 0 ? `${rest.slice(0, cut)} · ${rest.slice(cut + 1)}` : rest,
        target: '节点',
      };
    }
    if (key.startsWith('e:')) {
      const rest = key.slice(2);
      const cut = rest.lastIndexOf(':');
      return {
        group: '连接',
        label: cut > 0 ? `${rest.slice(0, cut)} · ${rest.slice(cut + 1)}` : rest,
        target: '连接',
      };
    }
    return { group: '信号', label: key };
  }

  function renderSignalList() {
    if (!ui.signalList) return;
    ui.signalList.replaceChildren();
    if (!state.probeKeys.length) {
      ui.signalList.appendChild(div('help', '运行仿真后自动列出可绘制信号。'));
      renderLegend();
      return;
    }
    const filter = state.chart.filter.trim().toLowerCase();
    const keys = state.probeKeys.filter((key: string) => key.toLowerCase().includes(filter));
    if (!keys.length) {
      ui.signalList.appendChild(div('help', '没有匹配的信号。'));
      renderLegend();
      return;
    }
    const groups = new Map();
    for (const key of keys) {
      const info = decodeProbeKey(key);
      if (!groups.has(info.group)) groups.set(info.group, []);
      groups.get(info.group).push({ key, info });
    }
    for (const [group, entries] of groups) {
      ui.signalList.appendChild(div('signal-group', group));
      for (const { key, info } of entries) {
        const item = el('label', 'signal-item');
        item.dataset.key = key;
        item.title = key;
        const dot = el('span', 'legend-dot');
        dot.style.background = colorForKey(key);
        const checkbox = el('input');
        checkbox.type = 'checkbox';
        checkbox.checked = state.chart.selected.has(key);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) {
            if (state.chart.selected.size >= CHART_KEYS) {
              checkbox.checked = false;
              toast(`最多同时绘制 ${CHART_KEYS} 条信号`, 'info', 2200);
              return;
            }
            state.chart.selected.add(key);
          } else {
            state.chart.selected.delete(key);
          }
          renderLegend();
          scheduleChartDraw();
        });
        const name = el('span', null, info.label);
        const value = el('em', null, state.values.has(key) ? fmt(state.values.get(key), 3) : '—');
        value.dataset.signalValue = key;
        item.append(dot, checkbox, name, value);
        ui.signalList.appendChild(item);
      }
    }
    updateSignalListValues();
    renderLegend();
  }

  function updateSignalListValues() {
    for (const node of $$('[data-signal-value]', ui.signalList)) {
      const key = node.dataset.signalValue;
      node.textContent = state.values.has((key as string)) ? fmt(state.values.get((key as string)), 3) : '—';
    }
  }

  function renderLegend() {
    if (!ui.legend) return;
    ui.legend.replaceChildren();
    const keys = Array.from(state.chart.selected);
    if (!keys.length) {
      ui.legend.appendChild(div('help', '勾选上方信号以绘制曲线。'));
      return;
    }
    for (const key of keys) {
      const item = div('legend-item');
      const dot = el('span', 'legend-dot');
      dot.style.background = colorForKey(key);
      const name = el('span', 'legend-name', decodeProbeKey(key).label);
      name.title = key;
      const value = el('span', 'legend-value', state.values.has(key) ? fmt(state.values.get(key), 4) : '—');
      value.dataset.legendValue = key;
      item.append(dot, name, value);
      ui.legend.appendChild(item);
    }
  }

  function updateLegendValues() {
    for (const node of $$('[data-legend-value]', ui.legend)) {
      const key = node.dataset.legendValue;
      node.textContent = state.values.has((key as string)) ? fmt(state.values.get((key as string)), 4) : '—';
    }
  }

  function nearestFrame(time: number) {
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
  function recordingStale() {
    const revision = state.scene?.revision;
    return Boolean(
      state.frames.length
      && state.replay.recordingRevision !== null
      && revision !== undefined
      && revision !== state.replay.recordingRevision,
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

  function enterReplay(index: number = state.replay.index) {
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

  // 回放定时器固定 16 ms 一跳；速度只影响每次推进的帧数。
  const REPLAY_TICK_MS = 16;

  function toggleReplayPlayback() {
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
        scheduleChartDraw();
        return;
      }
      next = max > 0 ? next % (max + 1) : 0;
    }
    state.replay.index = next;
    updateReplayUI();
    scheduleChartDraw();
  }

  /* ---- 相图 ------------------------------------------------------------ */
  function phaseStateKeys(node: NodeItem) {
    const prefix = `state:${node.name}:`;
    return (state.probeKeys || [])
      .filter((key: string) => key.startsWith(prefix))
      .sort((left, right) => {
        const a = Number(left.slice(prefix.length));
        const b = Number(right.slice(prefix.length));
        if (Number.isFinite(a) && Number.isFinite(b)) return a - b;
        return left.localeCompare(right);
      });
  }

  function vectorCandidates() {
    const nodes = state.scene?.nodes || [];
    return nodes.filter((node) => {
      const data = nodeDisplayData(node);
      const hasX = typeof data.x === 'number' && typeof data.y === 'number';
      const hasV = typeof data.vx === 'number' && typeof data.vy === 'number';
      const hasState = typeof data.x1 === 'number' && typeof data.x2 === 'number';
      return hasX || hasV || hasState || phaseStateKeys(node).length >= 2;
    });
  }

  function renderVectorNodeList() {
    if (!ui.vectorNode) return;
    const nodes = vectorCandidates();
    const previous = state.phaseNode;
    ui.vectorNode.replaceChildren();
    if (!nodes.length) {
      const option = el('option', null, '（无矢量节点）');
      option.value = '';
      ui.vectorNode.appendChild(option);
      state.phaseNode = '';
      drawPhase();
      return;
    }
    for (const node of nodes) {
      const option = el('option', null, `${node.name} · ${node.kind}`);
      option.value = node.name;
      ui.vectorNode.appendChild(option);
    }
    if (!nodes.some((node) => node.name === previous)) {
      state.phaseNode = nodes[0].name;
    }
    ui.vectorNode.value = state.phaseNode;
    drawPhase();
  }

  function resizePhase() {
    const wrap = $('.phase-wrap');
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    state.phaseSize = { w: width, h: height, dpr };
    phaseCanvas.width = Math.max(1, Math.round(width * dpr));
    phaseCanvas.height = Math.max(1, Math.round(height * dpr));
    schedulePhaseDraw();
  }

  function schedulePhaseDraw() {
    if (state.phaseTimer) return;
    state.phaseTimer = setTimeout(() => {
      state.phaseTimer = 0;
      if (activeTab() === 'vector') drawPhase();
    }, 80);
  }

  function drawPhase() {
    if (activeTab() !== 'vector') return;
    const { w, h, dpr } = state.phaseSize;
    if (w < 20 || h < 20) return;
    phaseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    phaseCtx.clearRect(0, 0, w, h);
    phaseCtx.fillStyle = C('#faf8f2');
    phaseCtx.fillRect(0, 0, w, h);

    const node = nodeByName(state.phaseNode);
    if (!node) {
      phaseCtx.fillStyle = C('#969083');
      phaseCtx.font = '11px "Segoe UI", "Microsoft YaHei", sans-serif';
      phaseCtx.textAlign = 'center';
      phaseCtx.textBaseline = 'middle';
      phaseCtx.fillText('没有可绘制的二维矢量节点', w / 2, h / 2);
      ui.phaseReadout.textContent = '在矢量模式下添加「非线性动态源」后即可查看相图。';
      return;
    }

    const trail = clamp(Number(state.phaseTrail) || 360, 20, 1200);
    const total = state.frames.length;
    const cursor = state.phaseIndex == null
      ? Math.max(0, total - 1)
      : clamp(Math.round(Number(state.phaseIndex) || 0), 0, Math.max(0, total - 1));
    const frames = state.frames.slice(Math.max(0, cursor - trail + 1), cursor + 1);
    const keyX = `n:${node.name}:x`;
    const keyY = `n:${node.name}:y`;
    const keyVX = `n:${node.name}:vx`;
    const keyVY = `n:${node.name}:vy`;
    const keyX1 = `n:${node.name}:x1`;
    const keyX2 = `n:${node.name}:x2`;
    let fieldX = keyX;
    let fieldY = keyY;
    let labelX = 'x';
    let labelY = 'y';
    let points = frames
      .filter((frame) => typeof frame.v[keyX] === 'number' && typeof frame.v[keyY] === 'number')
      .map((frame) => ({ x: frame.v[keyX], y: frame.v[keyY], t: frame.t }));
    if (points.length < 2) {
      fieldX = keyVX;
      fieldY = keyVY;
      labelX = 'vx';
      labelY = 'vy';
      points = frames
        .filter((frame) => typeof frame.v[keyVX] === 'number' && typeof frame.v[keyVY] === 'number')
        .map((frame) => ({ x: frame.v[keyVX], y: frame.v[keyVY], t: frame.t }));
    }
    if (points.length < 2) {
      fieldX = keyX1;
      fieldY = keyX2;
      labelX = 'x1';
      labelY = 'x2';
      points = frames
        .filter((frame) => typeof frame.v[keyX1] === 'number' && typeof frame.v[keyX2] === 'number')
        .map((frame) => ({ x: frame.v[keyX1], y: frame.v[keyX2], t: frame.t }));
    }
    if (points.length < 2) {
      const stateKeys = phaseStateKeys(node);
      if (stateKeys.length >= 2) {
        fieldX = stateKeys[0];
        fieldY = stateKeys[1];
        labelX = fieldX.slice(`state:${node.name}:`.length);
        labelY = fieldY.slice(`state:${node.name}:`.length);
        points = frames
          .filter((frame) => typeof frame.v[fieldX] === 'number' && typeof frame.v[fieldY] === 'number')
          .map((frame) => ({ x: frame.v[fieldX], y: frame.v[fieldY], t: frame.t }));
      }
    }
    if (!points.length) {
      if (state.sim?.mode === 'signal' && !phaseStateKeys(node).length) {
        ui.phaseReadout.textContent = '该信号流节点暂无状态通道：先运行预计算，或选择传递函数 / 积分器节点。';
        return;
      }
      const data = nodeDisplayData(node);
      if (typeof data.x === 'number' && typeof data.y === 'number') {
        points = [{ x: data.x, y: data.y, t: state.sim?.time || 0 }];
        fieldX = 'x';
        fieldY = 'y';
      } else if (typeof data.vx === 'number' && typeof data.vy === 'number') {
        points = [{ x: data.vx, y: data.vy, t: state.sim?.time || 0 }];
        fieldX = 'vx';
        fieldY = 'vy';
        labelX = 'vx';
        labelY = 'vy';
      } else if (typeof data.x1 === 'number' && typeof data.x2 === 'number') {
        points = [{ x: data.x1, y: data.x2, t: state.sim?.time || 0 }];
        fieldX = 'x1';
        fieldY = 'x2';
        labelX = 'x1';
        labelY = 'x2';
      }
    }

    const margin = 34;
    const plotW = Math.max(10, w - margin * 2);
    const plotH = Math.max(10, h - margin * 2 - 14);
    const ox = margin;
    const oy = 20;
    const size = Math.min(plotW, plotH);
    const px = ox + (plotW - size) / 2;
    const py = oy + (plotH - size) / 2;

    let minX = 0;
    let maxX = 0;
    let minY = 0;
    let maxY = 0;
    for (const point of points) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
    let spanX = maxX - minX;
    let spanY = maxY - minY;
    const span = Math.max(spanX, spanY, 1.0e-3);
    const pad = span * 0.12;
    minX -= pad; maxX += pad; minY -= pad; maxY += pad;
    spanX = maxX - minX;
    spanY = maxY - minY;
    const scale = size / Math.max(spanX, spanY, 1.0e-3);
    const mapX = (value: number) => px + size / 2 + (value - (minX + maxX) / 2) * scale;
    const mapY = (value: number) => py + size / 2 - (value - (minY + maxY) / 2) * scale;

    // 网格
    phaseCtx.strokeStyle = C('#e3ddd0');
    phaseCtx.lineWidth = 1;
    phaseCtx.beginPath();
    for (let index = 0; index <= 6; index += 1) {
      const gx = px + (size * index) / 6;
      const gy = py + (size * index) / 6;
      phaseCtx.moveTo(gx, py);
      phaseCtx.lineTo(gx, py + size);
      phaseCtx.moveTo(px, gy);
      phaseCtx.lineTo(px + size, gy);
    }
    phaseCtx.stroke();

    // 坐标轴
    phaseCtx.strokeStyle = C('#bcb3a1');
    phaseCtx.lineWidth = 1;
    phaseCtx.beginPath();
    const axisY = clamp(mapY(0), py, py + size);
    const axisX = clamp(mapX(0), px, px + size);
    phaseCtx.moveTo(px, axisY);
    phaseCtx.lineTo(px + size, axisY);
    phaseCtx.moveTo(axisX, py);
    phaseCtx.lineTo(axisX, py + size);
    phaseCtx.stroke();

    // 轨迹
    if (points.length > 1) {
      phaseCtx.strokeStyle = C('rgba(168, 84, 31, 0.78)');
      phaseCtx.lineWidth = 1.4;
      phaseCtx.lineJoin = 'round';
      phaseCtx.beginPath();
      points.forEach((point: { x: number; y: number }, index: number) => {
        const sx = mapX(point.x);
        const sy = mapY(point.y);
        if (index === 0) phaseCtx.moveTo(sx, sy);
        else phaseCtx.lineTo(sx, sy);
      });
      phaseCtx.stroke();

      const previous = points[Math.max(0, points.length - 18)];
      const current = points[points.length - 1];
      const angle = Math.atan2(mapY(current.y) - mapY(previous.y), mapX(current.x) - mapX(previous.x));
      const tipX = mapX(current.x);
      const tipY = mapY(current.y);
      phaseCtx.fillStyle = C('#1f5f5b');
      phaseCtx.beginPath();
      phaseCtx.arc(tipX, tipY, 3.2, 0, Math.PI * 2);
      phaseCtx.fill();
      phaseCtx.beginPath();
      phaseCtx.moveTo(tipX, tipY);
      phaseCtx.lineTo(tipX - 11 * Math.cos(angle - 0.42), tipY - 11 * Math.sin(angle - 0.42));
      phaseCtx.lineTo(tipX - 11 * Math.cos(angle + 0.42), tipY - 11 * Math.sin(angle + 0.42));
      phaseCtx.closePath();
      phaseCtx.fill();
    }

    phaseCtx.fillStyle = C('#7b7266');
    phaseCtx.font = '9px "Cascadia Code", Consolas, monospace';
    phaseCtx.textAlign = 'left';
    phaseCtx.textBaseline = 'top';
    phaseCtx.fillText(`${labelX} / ${labelY} · ${node.name}`, px, 3);
    phaseCtx.textAlign = 'right';
    phaseCtx.fillText(`${points.length} pts`, px + size, 3);
    phaseCtx.textAlign = 'left';
    phaseCtx.textBaseline = 'bottom';
    phaseCtx.fillText(fmt(minX, 2), px, py + size + 12);
    phaseCtx.textAlign = 'right';
    phaseCtx.fillText(fmt(maxX, 2), px + size, py + size + 12);
    phaseCtx.textAlign = 'right';
    phaseCtx.textBaseline = 'bottom';
    phaseCtx.fillText(fmt(maxY, 2), px - 5, py + 9);
    phaseCtx.textBaseline = 'top';
    phaseCtx.fillText(fmt(minY, 2), px - 5, py + size - 9);

    const current = points[points.length - 1];
    if (current) {
      const magnitude = Math.hypot(current.x, current.y);
      let pathLength = 0;
      let area = 0;
      for (let index = 1; index < points.length; index += 1) {
        pathLength += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
        area += points[index - 1].x * points[index].y - points[index].x * points[index - 1].y;
      }
      const ys = points.map((point: { x: number; y: number }) => point.y);
      const finalY = current.y;
      const peakY = finalY >= 0 ? Math.max(...ys) : Math.min(...ys);
      const overshoot = Math.abs(finalY) > 1e-12
        ? Math.max(0, (peakY - finalY) / Math.abs(finalY) * 100)
        : 0;
      const band = Math.abs(finalY) * 0.02;
      let lastOutside = -1;
      for (let index = 0; index < points.length; index += 1) {
        if (Math.abs(points[index].y - finalY) > band) lastOutside = index;
      }
      const settling = lastOutside >= 0 && lastOutside + 1 < points.length
        ? Math.max(0, current.t - points[lastOutside].t)
        : 0;
      ui.phaseReadout.textContent =
        `${node.kind}  ${labelX}=${fmt(current.x, 5)}  ${labelY}=${fmt(current.y, 5)}  `
        + `|r|=${fmt(magnitude, 5)}  t=${fmt(current.t, 4)} s  `
        + `L=${fmt(pathLength, 4)}  A=${fmt(Math.abs(area) / 2, 4)}  `
        + `峰值=${fmt(peakY, 5)}  超调=${fmt(overshoot, 2)}%  `
        + `稳态=${fmt(finalY, 5)}  调节=${fmt(settling, 4)} s`;
    }
    syncPhaseControls();
  }

  function phaseFrameCount() {
    return state.frames.length;
  }

  function syncPhaseControls() {
    const total = phaseFrameCount();
    const cursor = state.phaseIndex == null
      ? Math.max(0, total - 1)
      : clamp(Math.round(Number(state.phaseIndex) || 0), 0, Math.max(0, total - 1));
    if (ui.phaseFrame) {
      ui.phaseFrame.max = String(Math.max(0, total - 1));
      ui.phaseFrame.value = String(cursor);
      ui.phaseFrame.disabled = total === 0;
    }
    if (ui.phaseFrameLabel) {
      ui.phaseFrameLabel.textContent = total ? `${cursor + 1}/${total}` : '0/0';
    }
    if (ui.phasePlay) {
      ui.phasePlay.textContent = state.phasePlaying ? '暂停' : '播放';
    }
  }

  function setPhaseIndex(index: number) {
    const total = phaseFrameCount();
    if (!total) return;
    state.phaseIndex = clamp(Math.round(Number(index) || 0), 0, total - 1);
    drawPhase();
  }

  function stopPhasePlay() {
    state.phasePlaying = false;
    if (state.phasePlayTimer) {
      clearInterval(state.phasePlayTimer);
      state.phasePlayTimer = 0;
    }
    syncPhaseControls();
  }

  function togglePhasePlay() {
    if (state.phasePlaying) {
      stopPhasePlay();
      return;
    }
    if (phaseFrameCount() < 2) return;
    state.phasePlaying = true;
    if (state.phaseIndex == null) state.phaseIndex = phaseFrameCount() - 1;
    state.phasePlayTimer = setInterval(() => {
      const total = phaseFrameCount();
      if (!total) {
        stopPhasePlay();
        return;
      }
      let next = (state.phaseIndex == null ? total - 1 : state.phaseIndex) + 1;
      if (next >= total) {
        if (!state.phaseLoop) {
          stopPhasePlay();
          return;
        }
        next = 0;
      }
      state.phaseIndex = next;
      drawPhase();
    }, 90);
    syncPhaseControls();
  }

  // ---------------- 仪器面板（R23 / D47，P7-04） ----------------
  // 全部只读 state.frames：仪表/示波器/李萨如都是旁路观察，绝不写回电路状态。
  function instrumentPrefsKey() {
    return 'netlab.instrument';
  }

  function loadInstrumentPrefs() {
    let data = null;
    try {
      data = JSON.parse(localStorage.getItem(instrumentPrefsKey()) || 'null');
    } catch {
      data = null;
    }
    if (!data || typeof data !== 'object') return;
    if (typeof data.meterKey === 'string') state.instrument.meterKey = data.meterKey;
    if (Array.isArray(data.channels)) {
      state.instrument.channels = [0, 1, 2, 3].map((i: number) => (
        typeof data.channels[i] === 'string' ? data.channels[i] : null
      ));
    }
    if (typeof data.lx === 'string') state.instrument.lx = data.lx;
    if (typeof data.ly === 'string') state.instrument.ly = data.ly;
    if (Number.isFinite(data.trail)) state.instrument.trail = clamp(Math.round(data.trail), 20, 4000);
    if (Number.isFinite(data.window)) state.instrument.window = clamp(data.window, 0.1, 120);
  }

  function saveInstrumentPrefs() {
    try {
      localStorage.setItem(instrumentPrefsKey(), JSON.stringify({
        meterKey: state.instrument.meterKey,
        channels: state.instrument.channels,
        lx: state.instrument.lx,
        ly: state.instrument.ly,
        trail: state.instrument.trail,
        window: state.instrument.window,
      }));
    } catch {
      /* 存储不可用时静默降级：仪表仍可用，只是不记忆选择 */
    }
  }

  function instrumentFieldLabel(field: FieldKey) {
    const map = { voltage: '电压', current: '电流', power: '功率', voltage_difference: '压差' };
    return map[field as keyof typeof map] || field || '值';
  }

  function instrumentKeyLabel(key: string) {
    const parts = String(key || '').split(':');
    const field = parts.length > 1 ? parts[parts.length - 1] : '';
    const name = parts.length > 2 ? parts.slice(1, -1).join(':') : (parts[1] || key);
    return `${name} · ${instrumentFieldLabel(field)}`;
  }

  function instrumentSelectGroups() {
    const groups = new Map();
    for (const key of state.probeKeys) {
      const parts = String(key).split(':');
      const field = parts.length > 1 ? parts[parts.length - 1] : '';
      const name = parts.length > 2 ? parts.slice(1, -1).join(':') : (parts[1] || key);
      const kind = parts[0] === 'e' ? '元件' : '节点';
      const label = `${kind}${instrumentFieldLabel(field)}`;
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push({ key, text: `${name} · ${instrumentFieldLabel(field)}` });
    }
    const order = ['节点电压', '元件电流', '元件压差', '元件电压', '元件功率'];
    return [...groups.entries()].sort((a, b) => {
      const ia = order.indexOf(a[0]);
      const ib = order.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a[0].localeCompare(b[0]);
    });
  }

  function fillInstrumentSelect(select: HTMLInputElement | HTMLSelectElement, current: string | null, placeholder: string) {
    if (!select) return '';
    select.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = placeholder;
    select.appendChild(none);
    for (const [label, items] of instrumentSelectGroups()) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = label;
      for (const item of items) {
        const option = document.createElement('option');
        option.value = item.key;
        option.textContent = item.text;
        optgroup.appendChild(option);
      }
      select.appendChild(optgroup);
    }
    const wanted = current && state.probeKeys.includes(current) ? current : '';
    select.value = wanted;
    return select.value;
  }

  function fillInstrumentSelects() {
    if (!ui.instPane) return;
    const firstRun = !state.instrument.meterKey
      && !state.instrument.lx && !state.instrument.ly
      && state.instrument.channels.every((key: string | null) => !key);
    state.instrument.meterKey = fillInstrumentSelect(((ui.instMeterKey)), state.instrument.meterKey, '选择电压 / 电流信号');
    state.instrument.channels = [0, 1, 2, 3].map((i: number) => (
      fillInstrumentSelect(((ui.instCh[i])), state.instrument.channels[i], `CH${i + 1} 未接`) || null
    ));
    state.instrument.lx = fillInstrumentSelect(((ui.instLX)), state.instrument.lx, 'X 未接');
    state.instrument.ly = fillInstrumentSelect(((ui.instLY)), state.instrument.ly, 'Y 未接');
    if (firstRun && state.probeKeys.length) {
      // 首次打开仪器页时自动接上「第一个电压 + 第一个电流」，避免空白页
      const volts = state.probeKeys.filter((key: string) => key.endsWith(':voltage'));
      const currents = state.probeKeys.filter((key: string) => key.endsWith(':current'));
      const ch1 = volts[0] || state.probeKeys[0];
      const ch2 = currents[0] || state.probeKeys[1] || '';
      state.instrument.meterKey = ch1;
      state.instrument.channels = [ch1, ch2 || null, null, null];
      state.instrument.lx = ch1;
      state.instrument.ly = ch2;
      if (ui.instMeterKey) ui.instMeterKey.value = ch1;
      if (ui.instCh[0]) ui.instCh[0].value = ch1;
      if (ui.instCh[1]) ui.instCh[1].value = ch2;
      if (ui.instLX) ui.instLX.value = ch1;
      if (ui.instLY) ui.instLY.value = ch2;
    }
    state.instrument.channels.forEach((key: string | null, i: number) => {
      const dot = ui.instCh[i]?.closest('.inst-ch')?.querySelector('.dot');
      if (!dot) return;
      dot.classList.toggle('on', Boolean(key));
      (dot as HTMLElement).style.color = key ? INST_COLORS[i] : '';
    });
    if (ui.instWindow) ui.instWindow.value = String(state.instrument.window);
    if (ui.instTrail) ui.instTrail.value = String(state.instrument.trail);
    saveInstrumentPrefs();
    scheduleChartDraw();
  }

  function instrumentFrames() {
    const all = state.replay.active ? state.frames.slice(0, state.replay.index + 1) : state.frames;
    const window = Math.max(0.1, Number(state.instrument.window) || 5);
    if (!all.length) return { frames: [], window };
    const last = all[all.length - 1].t;
    const start = last - window;
    let from = all.length - 1;
    while (from > 0 && all[from - 1].t >= start) from -= 1;
    return { frames: all.slice(from), window };
  }

  function instrumentStats(frames: FrameItem[], key: string) {
    let count = 0;
    let sum = 0;
    let square = 0;
    let min = Infinity;
    let max = -Infinity;
    let last = 0;
    for (const frame of frames) {
      const value = frame.v?.[key as string];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      count += 1;
      sum += value;
      square += value * value;
      last = value;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    if (!count) return null;
    return { count, last, mean: sum / count, rms: Math.sqrt(square / count), min, max, pp: max - min };
  }

  function instrumentSurface(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, size: SizeRec, fill: string) {
    if (!context || !canvas) return null;
    const { w, h, dpr } = size;
    if (w < 20 || h < 20) return null;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, w, h);
    context.fillStyle = C(fill);
    context.fillRect(0, 0, w, h);
    return { w, h };
  }

  function instrumentHint(context: CanvasRenderingContext2D, w: number, h: number, text: string) {
    context.fillStyle = C('#969083');
    context.font = '12px "Segoe UI", "Microsoft YaHei", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, w / 2, h / 2);
  }

  function renderInstrumentMeter(frames: FrameItem[]) {
    const key = state.instrument.meterKey;
    const stats = key ? instrumentStats(frames, key) : null;
    const put = (element: HTMLElement, text: string) => {
      if (element) element.textContent = text;
    };
    if (!stats) {
      put(ui.instValNow, '—');
      put(ui.instValMean, '—');
      put(ui.instValRms, '—');
      put(ui.instValPP, '—');
      put(ui.instValMinMax, '—');
      return;
    }
    put(ui.instValNow, fmt(stats.last, 4));
    put(ui.instValMean, fmt(stats.mean, 4));
    put(ui.instValRms, fmt(stats.rms, 4));
    put(ui.instValPP, fmt(stats.pp, 4));
    put(ui.instValMinMax, `${fmt(stats.max, 3)} / ${fmt(stats.min, 3)}`);
  }

  function renderInstrumentLegend(frames: FrameItem[]) {
    if (!ui.instLegend) return;
    ui.instLegend.innerHTML = '';
    state.instrument.channels.forEach((key: string | null, index: number) => {
      if (!key) return;
      const stats = instrumentStats(frames, key);
      const item = document.createElement('div');
      item.className = 'legend-item';
      const dot = document.createElement('i');
      dot.className = 'legend-dot';
      dot.style.background = INST_COLORS[index];
      const name = document.createElement('span');
      name.className = 'legend-name';
      name.textContent = `CH${index + 1} ${instrumentKeyLabel(key)}`;
      const value = document.createElement('em');
      value.className = 'legend-value';
      value.textContent = stats ? fmt(stats.last, 4) : '—';
      item.append(dot, name, value);
      ui.instLegend.appendChild(item);
    });
  }

  function drawScope(frames: FrameItem[], window: number) {
    const surface = instrumentSurface((scopeCtx as CanvasRenderingContext2D), scopeCanvas, state.instrument.scopeSize, '#faf8f2');
    if (!surface) return;
    const { w, h } = surface;
    const left = 46;
    const right = 12;
    const top = 12;
    const bottom = 20;
    const plotW = Math.max(10, w - left - right);
    const plotH = Math.max(10, h - top - bottom);
    scopeCtx!.strokeStyle = C('#e7e2d7');
    scopeCtx!.lineWidth = 1;
    scopeCtx!.beginPath();
    for (let i = 0; i <= 4; i += 1) {
      const y = top + (plotH * i) / 4 + 0.5;
      scopeCtx!.moveTo(left, y);
      scopeCtx!.lineTo(left + plotW, y);
    }
    for (let i = 0; i <= 4; i += 1) {
      const x = left + (plotW * i) / 4 + 0.5;
      scopeCtx!.moveTo(x, top);
      scopeCtx!.lineTo(x, top + plotH);
    }
    scopeCtx!.stroke();

    const channels = state.instrument.channels
      .map((key: string | null, index: number) => ({ key, index }))
      .filter((entry) => entry.key && state.probeKeys.includes(entry.key));
    if (!frames.length || !channels.length) {
      instrumentHint(
        (scopeCtx as CanvasRenderingContext2D), w, h,
        channels.length ? '运行仿真后显示波形' : '给 CH1–CH4 接上信号',
      );
      renderInstrumentLegend([]);
      return;
    }

    const last = frames[frames.length - 1].t;
    const start = Math.max(frames[0].t, last - Math.max(0.1, window));
    const span = Math.max(1e-9, last - start);
    let amp = 0;
    for (const { key } of channels) {
      for (const frame of frames) {
        const value = frame.v?.[key as string];
        if (Number.isFinite(value)) amp = Math.max(amp, Math.abs(value));
      }
    }
    amp = amp > 0 ? amp * 1.1 : 1;
    const xOf = (t: number) => left + plotW * ((t - start) / span);
    const yOf = (v: number) => top + plotH / 2 - (v / amp) * (plotH / 2);

    scopeCtx!.strokeStyle = C('#c9c2b4');
    scopeCtx!.beginPath();
    scopeCtx!.moveTo(left, top + plotH / 2 + 0.5);
    scopeCtx!.lineTo(left + plotW, top + plotH / 2 + 0.5);
    scopeCtx!.stroke();

    for (const { key, index } of channels) {
      scopeCtx!.strokeStyle = INST_COLORS[index];
      scopeCtx!.lineWidth = 1.5;
      scopeCtx!.beginPath();
      let started = false;
      for (const frame of frames) {
        const value = frame.v?.[key as string];
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        const x = xOf(frame.t);
        const y = yOf(value);
        if (!started) {
          scopeCtx!.moveTo(x, y);
          started = true;
        } else {
          scopeCtx!.lineTo(x, y);
        }
      }
      scopeCtx!.stroke();
    }

    scopeCtx!.fillStyle = C('#969083');
    scopeCtx!.font = '9px "Segoe UI", "Microsoft YaHei", sans-serif';
    scopeCtx!.textAlign = 'right';
    scopeCtx!.textBaseline = 'middle';
    scopeCtx!.fillText(fmt(amp, 2), left - 5, top + 6);
    scopeCtx!.fillText('0', left - 5, top + plotH / 2);
    scopeCtx!.fillText(fmt(-amp, 2), left - 5, top + plotH - 6);
    scopeCtx!.textBaseline = 'top';
    scopeCtx!.textAlign = 'left';
    scopeCtx!.fillText(`${fmt(start, 3)} s`, left, top + plotH + 4);
    scopeCtx!.textAlign = 'right';
    scopeCtx!.fillText(`${fmt(last, 3)} s`, left + plotW, top + plotH + 4);
    renderInstrumentLegend(frames);
  }

  function drawLissajous(frames: FrameItem[]) {
    const surface = instrumentSurface((lissCtx as CanvasRenderingContext2D), lissCanvas, state.instrument.lissSize, '#faf8f2');
    if (!surface) return;
    const { w, h } = surface;
    const pad = 14;
    lissCtx!.strokeStyle = C('#e7e2d7');
    lissCtx!.lineWidth = 1;
    lissCtx!.beginPath();
    lissCtx!.moveTo(w / 2 + 0.5, pad);
    lissCtx!.lineTo(w / 2 + 0.5, h - pad);
    lissCtx!.moveTo(pad, h / 2 + 0.5);
    lissCtx!.lineTo(w - pad, h / 2 + 0.5);
    lissCtx!.stroke();

    const xKey = state.instrument.lx;
    const yKey = state.instrument.ly;
    const ready = Boolean(xKey && yKey && state.probeKeys.includes(xKey) && state.probeKeys.includes(yKey));
    if (!ready || !frames.length) {
      instrumentHint((lissCtx as CanvasRenderingContext2D), w, h, ready ? '运行仿真后显示李萨如图' : '选择 X / Y 两路信号');
      return;
    }
    const trail = clamp(Math.round(Number(state.instrument.trail) || 600), 20, 4000);
    const slice = frames.slice(-trail);
    let amp = 0;
    for (const frame of slice) {
      const x = frame.v?.[xKey];
      const y = frame.v?.[yKey];
      if (Number.isFinite(x)) amp = Math.max(amp, Math.abs(x));
      if (Number.isFinite(y)) amp = Math.max(amp, Math.abs(y));
    }
    amp = amp > 0 ? amp * 1.1 : 1;
    const size = Math.max(10, Math.min(w, h) - pad * 2);
    const xOf = (v: number) => w / 2 + (v / amp) * (size / 2);
    const yOf = (v: number) => h / 2 - (v / amp) * (size / 2);

    lissCtx!.strokeStyle = C('#c2542f');
    lissCtx!.lineWidth = 1.2;
    lissCtx!.beginPath();
    let started = false;
    let tail = null;
    for (const frame of slice) {
      const x = frame.v?.[xKey];
      const y = frame.v?.[yKey];
      if (typeof x !== 'number' || typeof y !== 'number') continue;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const px = xOf(x);
      const py = yOf(y);
      if (!started) {
        lissCtx!.moveTo(px, py);
        started = true;
      } else {
        lissCtx!.lineTo(px, py);
      }
      tail = { x: px, y: py };
    }
    lissCtx!.stroke();
    if (tail) {
      lissCtx!.fillStyle = C('#c2542f');
      lissCtx!.beginPath();
      lissCtx!.arc(tail.x, tail.y, 2.5, 0, Math.PI * 2);
      lissCtx!.fill();
    }
    lissCtx!.fillStyle = C('#969083');
    lissCtx!.font = '9px "Segoe UI", "Microsoft YaHei", sans-serif';
    lissCtx!.textAlign = 'left';
    lissCtx!.textBaseline = 'top';
    lissCtx!.fillText(`X ${xKey.split(':').slice(1, -1).join(':')}`, pad, pad - 10 + 0.5);
    lissCtx!.textBaseline = 'bottom';
    lissCtx!.fillText(`Y ${yKey.split(':').slice(1, -1).join(':')}`, pad, h - 1);
  }

  function drawInstruments() {
    if (activeTab() !== 'inst') return;
    const { frames, window } = instrumentFrames();
    renderInstrumentMeter(frames);
    drawScope(frames, window);
    drawLissajous(frames);
    if (ui.instStatus) {
      if (frames.length) {
        ui.instStatus.textContent = `${frames.length} 帧 · 窗口 ${fmt(window, 2)} s${state.replay.active ? ' · 回放中' : ''}`;
      } else {
        ui.instStatus.textContent = state.sim?.running ? '等待采集中…' : '运行仿真后显示读数与波形';
      }
    }
  }

  function resizeInstrument() {
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
    for (const [target, key] of [[scopeCanvas, 'scopeSize'], [lissCanvas, 'lissSize']]) {
      if (!target) continue;
      const wrap = (target as HTMLCanvasElement).parentElement;
      if (!wrap) continue;
      const rect = wrap.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      state.instrument[key as string] = { w, h, dpr };
      (target as HTMLCanvasElement).width = Math.max(1, Math.round(w * dpr));
      (target as HTMLCanvasElement).height = Math.max(1, Math.round(h * dpr));
    }
    scheduleChartDraw();
  }

  function bindInstrumentEvents() {
    const bind = (element: HTMLElement, event: string, handler: (event: MouseEvent) => void) => {
      if (element) element.addEventListener(event, handler as EventListener);
    };
    bind(ui.instMeterKey, (('change')), () => {
      state.instrument.meterKey = ui.instMeterKey.value || '';
      saveInstrumentPrefs();
      scheduleChartDraw();
    });
    ui.instCh.forEach((select, index: number) => {
      bind(select, (('change')), () => {
        state.instrument.channels[index] = select.value || null;
        const dot = select.closest('.inst-ch')?.querySelector('.dot');
        if (dot) {
          dot.classList.toggle('on', Boolean(select.value));
          (dot as HTMLElement).style.color = select.value ? INST_COLORS[index] : '';
        }
        saveInstrumentPrefs();
        scheduleChartDraw();
      });
    });
    bind(ui.instLX, (('change')), () => {
      state.instrument.lx = ui.instLX.value || '';
      saveInstrumentPrefs();
      scheduleChartDraw();
    });
    bind(ui.instLY, (('change')), () => {
      state.instrument.ly = ui.instLY.value || '';
      saveInstrumentPrefs();
      scheduleChartDraw();
    });
    bind(ui.instWindow, (('input')), () => {
      state.instrument.window = clamp(Number(ui.instWindow.value) || 5, 0.1, 120);
      saveInstrumentPrefs();
      scheduleChartDraw();
    });
    bind(ui.instTrail, (('input')), () => {
      state.instrument.trail = clamp(Math.round(Number(ui.instTrail.value) || 600), 20, 4000);
      saveInstrumentPrefs();
      scheduleChartDraw();
    });
  }

  function initInstruments() {
    loadInstrumentPrefs();
    resizeInstrument();
    bindInstrumentEvents();
    fillInstrumentSelects();
  }

  function drawChart() {
    if (activeTab() !== 'chart') return;
    const { w, h, dpr } = state.chartSize;
    if (w < 20 || h < 20) return;
    chartCanvas.dataset.renderSize = `${w}x${h}@${dpr}`;
    chartCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    chartCtx.clearRect(0, 0, w, h);
    chartCtx.fillStyle = C('#faf8f2');
    chartCtx.fillRect(0, 0, w, h);

    const keys = Array.from(state.chart.selected);
    const frames = state.replay.active
      ? state.frames.slice(0, state.replay.index + 1)
      : state.frames;
    if (!keys.length || !frames.length) {
      chartCtx.fillStyle = C('#969083');
      chartCtx.font = '12px "Segoe UI", "Microsoft YaHei", sans-serif';
      chartCtx.textAlign = 'center';
      chartCtx.textBaseline = 'middle';
      chartCtx.fillText(frames.length ? '在信号列表里勾选要绘制的信号' : '运行仿真后自动采集轨迹', w / 2, h / 2);
      return;
    }

    const left = 54;
    const right = 14;
    const top = 14;
    const bottom = 24;
    const plotW = Math.max(10, w - left - right);
    const plotH = Math.max(10, h - top - bottom);
    const window = Math.max(0.1, Number(state.chart.window) || 5);
    const tMax = frames[frames.length - 1].t;
    const tMin = Math.max(0, tMax - window);
    const spanT = Math.max(1e-9, tMax - tMin);

    // frames 按时间升序：二分定位时间窗起点，避免每帧从 0 开始扫（5000 帧 × N 信号）。
    let startAt = 0;
    {
      let lo = 0;
      let hi = frames.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (frames[mid].t < tMin) lo = mid + 1;
        else hi = mid;
      }
      startAt = lo;
    }
    const visibleCount = frames.length - startAt;
    // 每像素超过 4 个采样点时等间隔抽稀：只影响绘制，不改 state.frames 里的原始数据。
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
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        points.push({ t: frame.t, v: value });
        if (value < yMin) yMin = value;
        if (value > yMax) yMax = value;
      }
      // 抽稀后仍要保留最新一帧，曲线终点才能对上实时值。
      if (lastFrame && lastFrame.t >= tMin && lastFrame.v
          && typeof lastFrame.v[key] === 'number' && Number.isFinite(lastFrame.v[key])
          && (!points.length || points[points.length - 1].t !== lastFrame.t)) {
        const lastV = lastFrame.v[key];
        points.push({ t: lastFrame.t, v: lastV });
        if (lastV < yMin) yMin = lastV;
        if (lastV > yMax) yMax = lastV;
      }
      series.push({ key, color, points });
    }
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
      chartCtx.fillStyle = C('#969083');
      chartCtx.font = '12px "Segoe UI", "Microsoft YaHei", sans-serif';
      chartCtx.textAlign = 'center';
      chartCtx.fillText('所选信号在时间窗内没有数值', w / 2, h / 2);
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

    const xOf = (t: number) => left + ((t - tMin) / spanT) * plotW;
    const yOf = (v: number) => top + (1 - (v - yMin) / spanY) * plotH;

    chartCtx.font = '10px "Cascadia Code", Consolas, monospace';
    chartCtx.lineWidth = 1;
    chartCtx.textBaseline = 'middle';
    for (let index = 0; index <= 4; index += 1) {
      const y = top + (plotH * index) / 4;
      chartCtx.strokeStyle = index === 4 ? tokens().axisLine : tokens().gridLine;
      chartCtx.beginPath();
      chartCtx.moveTo(left, Math.round(y) + 0.5);
      chartCtx.lineTo(left + plotW, Math.round(y) + 0.5);
      chartCtx.stroke();
      chartCtx.fillStyle = C('#8b8376');
      chartCtx.textAlign = 'right';
      chartCtx.fillText(fmt(yMax - (spanY * index) / 4, 3), left - 8, y);
    }
    for (let index = 0; index <= 4; index += 1) {
      const x = left + (plotW * index) / 4;
      chartCtx.strokeStyle = index === 0 ? tokens().axisLine : tokens().gridLine;
      chartCtx.beginPath();
      chartCtx.moveTo(Math.round(x) + 0.5, top);
      chartCtx.lineTo(Math.round(x) + 0.5, top + plotH);
      chartCtx.stroke();
      chartCtx.fillStyle = C('#8b8376');
      chartCtx.textAlign = index === 0 ? 'left' : index === 4 ? 'right' : 'center';
      const tick = tMin + (spanT * index) / 4;
      const decimals = spanT >= 10 ? 1 : spanT >= 1 ? 2 : spanT >= 0.1 ? 3 : spanT >= 0.01 ? 4 : 5;
      chartCtx.fillText(`${tick.toFixed(decimals)}s`, x, top + plotH + 12);
    }

    chartCtx.save();
    chartCtx.beginPath();
    chartCtx.rect(left, top, plotW, plotH);
    chartCtx.clip();
    chartCtx.lineJoin = 'round';
    chartCtx.lineCap = 'round';
    for (const item of series) {
      if (!item.points.length) continue;
      chartCtx.strokeStyle = item.color;
      chartCtx.lineWidth = 1.6;
      chartCtx.beginPath();
      item.points.forEach((point: { t: number; v: number }, index: number) => {
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

    const hover = state.chart.hover as (HoverRec & { x: number; y: number }) | null;
    if (hover && hover.x >= left && hover.x <= left + plotW && hover.y >= top && hover.y <= top + plotH) {
      const t = tMin + ((hover.x - left) / plotW) * spanT;
      const frame = nearestFrame(t);
      if (frame) {
        const hx = xOf(frame.t);
        chartCtx.strokeStyle = C('rgba(168, 84, 31, .45)');
        chartCtx.lineWidth = 1;
        chartCtx.setLineDash([3, 3]);
        chartCtx.beginPath();
        chartCtx.moveTo(hx, top);
        chartCtx.lineTo(hx, top + plotH);
        chartCtx.stroke();
        chartCtx.setLineDash([]);
        for (const item of series) {
          const value = frame.v[item.key];
          if (typeof value !== 'number' || !Number.isFinite(value)) continue;
          chartCtx.beginPath();
          chartCtx.arc(hx, yOf(value), 2.8, 0, Math.PI * 2);
          chartCtx.fillStyle = item.color;
          chartCtx.fill();
        }
        const rows = series
          .filter((item) => typeof frame.v[item.key] === 'number' && Number.isFinite(frame.v[item.key]))
          .slice(0, 5)
          .map((item) => `${decodeProbeKey(item.key).label}  ${fmt(frame.v[item.key], 4)}`);
        const lines = [`t = ${fmt(frame.t, 4)} s`, ...rows];
        chartCtx.font = '10px "Cascadia Code", Consolas, monospace';
        let boxW = 0;
        for (const line of lines) boxW = Math.max(boxW, chartCtx.measureText(line).width);
        boxW += 16;
        const boxH = lines.length * 15 + 10;
        const boxX = clamp(hx + 12, left + 4, left + plotW - boxW - 4);
        const boxY = clamp(top + 6, top + 4, top + plotH - boxH - 4);
        chartCtx.fillStyle = tokens().hudBg;
        chartCtx.strokeStyle = C('#bcb3a1');
        chartCtx.lineWidth = 1;
        roundRectPath(chartCtx, boxX, boxY, boxW, boxH, 6);
        chartCtx.fill();
        chartCtx.stroke();
        chartCtx.textAlign = 'left';
        chartCtx.textBaseline = 'top';
        lines.forEach((line, index: number) => {
          chartCtx.fillStyle = index === 0 ? C('#a8541f') : tokens().edgeHover;
          chartCtx.fillText(line, boxX + 8, boxY + 6 + index * 15);
        });
      }
    }
    chartCtx.restore();
  }

  /* ======================================================================
   * 工作区切换
   * ==================================================================== */
  function setWorkspaceButtons() {
    if (!ui.workspaceSwitch) return;
    $$('button[data-workspace]', ui.workspaceSwitch).forEach((item) => {
      item.classList.toggle('active', item.dataset.workspace === state.workspace);
    });
  }

  async function switchWorkspace(name: string) {
    if (name === state.workspace) return;
    state.workspace = 'network';
    setWorkspaceButtons();
    switchTab('inspect');
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
        data.sim
        && (Number(data.cursor || 0) < previousCursor || Number(data.sim.steps || 0) < previousSteps),
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
        // 帧上限按探针数自适应：总采样点控制在 ~25 万，避免 100+ 探针时
        // 5000 帧 × N 键的 JS 堆把 GC 拖起来（表现为长时间运行后卡顿）。
        const cap = frameCap();
        if (state.frames.length > cap) {
          state.frames.splice(0, state.frames.length - cap);
        }
      }
      const gotFrames = Boolean(Array.isArray(data.frames) && data.frames.length);
      if (typeof data.cursor === 'number') state.cursor = data.cursor;
      if (data.sim) state.sim = data.sim;
      if (gotFrames || resetDetected) {
        updateSignalKeyCache();
        syncUI();
        updateReplayUI();
        // 面板不可见时跳过对应 DOM 更新：128 个探针下这些写操作每 110ms 一次并不便宜。
        if (ui.inspector?.offsetParent !== null) updateInspectorLive();
        if (ui.signalList?.offsetParent !== null) updateSignalListValues();
        if (activeTab() === 'chart') updateLegendValues();
        scheduleChartDraw();
      } else {
        // 没有新帧（暂停/空闲）：只刷新状态条，不重绘图、不刷图例与检视器。
        syncUI();
      }
      if (resetDetected) void refreshState(true);
    } catch (error) {
      const now = performance.now();
      if (now - (state.lastLiveError || 0) > 8000) {
        state.lastLiveError = now;
        toast(`实时数据获取失败：${(error as Error).message}`, 'error', 5000);
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
      const snapshot = await api('/api/state');
      state.lastStateFetch = performance.now();
      applySnapshot(snapshot);
    } catch (error) {
      if (!quiet) toast(`状态刷新失败：${(error as Error).message}`, 'error', 5000);
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
        // 窗口最小化/切到后台时不追帧：回来时用一次大 limit 追平即可。
        const delay = document.hidden ? 1000 : (activeRunning ? 110 : 500);
        state.pollTimer = setTimeout(pollLoop, delay);
      }
    }
  }

  /* ======================================================================
   * 10. 仿真控制、静态事件与启动
   * ==================================================================== */

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

  async function networkControl(action: string, steps?: number) {
    const body: { action: string; steps?: number } = { action };
    if (steps !== undefined) body.steps = steps;
    const response = await task(() => jsonRequest('/api/control', 'POST', body), { dirty: false });
    if (!response) return;
    state.sim = response.sim;
    if (action === 'reset') {
      resetLocalFrames();
    } else if (action === 'run' || action === 'step') {
      if (state.replay.active) leaveReplay();
    }
    syncUI();
    updateSignalKeyCache();
    updateInspectorLive();
    if (action === 'step' || action === 'reset') await pollLive();
    if (action === 'reset') toast('仿真已重置；探针与仪器设置保留', 'ok', 2200);
  }

  async function control(action: string, steps?: number, opts?: Record<string, unknown>) {
    // 运行前提示：建议先预计算，否则 PlotKit 面板拿不到整段数据（只能边跑边截断）
    const running = !!(state.sim && state.sim.running);
    if ((action === 'toggle' || action === 'run') && !running && !(opts && opts.skipWarn)
        && state.prefs.runWarn !== false && !hasPrecomputed()) {
      openRunWarn();
      return;
    }
    await networkControl(action, steps);
  }

  // 已有预计算数据（整段 0→T 已在录制缓冲里）就不再打扰用户
  function hasPrecomputed() {
    if (state.precomputedSeconds != null) return true;
    const frames = state.frames || [];
    if (frames.length < 2) return false;
    const span = frames[frames.length - 1].t - frames[0].t;
    const need = Number((state.chart && state.chart.window) || 5);
    return span >= need * 0.9;
  }

  // ---- 运行前「建议预计算」对话框 -------------------------------------------
  function openRunWarn() {
    if (document.getElementById('runWarnWin')) return;
    const overlay = document.createElement('div');
    overlay.id = 'runWarnWin';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(16,20,18,.45);display:flex;align-items:center;justify-content:center;z-index:9999;';
    const card = document.createElement('div');
    card.style.cssText = 'width:520px;max-width:92vw;background:var(--paper,#faf8f2);color:var(--text-primary,#080a08);border:1px solid var(--line,#cfc6b5);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.28);padding:22px 24px 18px;font:13px/1.7 "Microsoft YaHei UI",sans-serif;';
    card.innerHTML = `
      <div style="font-size:16px;font-weight:700;margin-bottom:6px;">运行前建议先预计算</div>
      <div style="color:var(--text-secondary,#7b7266);margin-bottom:14px;">
        实时运行只登记探针，绘图面板不会边算边画。先用下面的时间窗把 0→T 整段算完，
        之后在「绘图」页可以毫秒级回放、并直接接入为数据源。
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <span>预计算时间窗</span>
        <input id="runWarnSec" type="number" min="1" max="120" step="1" value="${Math.max(1, Math.min(120, Math.round(Number((state.chart && state.chart.window) || 5))))}"
          style="width:84px;padding:5px 8px;border:1px solid var(--line,#cfc6b5);border-radius:8px;background:var(--field-bg,#ffffff);color:var(--text-input,#111814);-webkit-text-fill-color:var(--text-input,#111814);font:600 14px/1.4 'Microsoft YaHei UI',sans-serif;" />
        <span>s</span>
        <span id="runWarnChips" style="display:flex;gap:6px;margin-left:6px;"></span>
      </div>
      <div id="runWarnInfo" style="color:var(--text-secondary,#7b7266);min-height:20px;margin-bottom:6px;"></div>
      <label style="display:flex;align-items:center;gap:8px;margin:10px 0 16px;color:var(--text-secondary,#7b7266);">
        <input id="runWarnNever" type="checkbox" /> 以后不再提示
      </label>
      <div style="display:flex;justify-content:flex-end;gap:10px;">
        <button id="runWarnCancel" class="ghost" style="padding:7px 14px;border:1px solid var(--line,#cfc6b5);border-radius:9px;background:transparent;color:inherit;cursor:pointer;">取消</button>
        <button id="runWarnRun" class="ghost" style="padding:7px 14px;border:1px solid var(--line,#cfc6b5);border-radius:9px;background:transparent;color:inherit;cursor:pointer;">直接运行</button>
        <button id="runWarnStop" class="ghost" style="display:none;padding:7px 14px;border:1px solid var(--red,#b75555);border-radius:9px;background:transparent;color:var(--text-button-danger,#b75555);cursor:pointer;">停止计算</button>
        <button id="runWarnPre" class="primary" style="padding:7px 16px;border:1px solid var(--accent,#9b7247);border-radius:9px;background:var(--accent,#9b7247);color:var(--text-on-accent,#f7f4ee);cursor:pointer;">预计算并接入</button>
      </div>`;
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    const sec = card.querySelector('#runWarnSec');
    const info = card.querySelector('#runWarnInfo');
    const chips = card.querySelector('#runWarnChips');
    [1, 5, 10, 30].forEach((v: number) => {
      const b = document.createElement('button');
      b.textContent = v + 's';
      b.style.cssText = 'padding:3px 9px;border:1px solid var(--line,#cfc6b5);border-radius:999px;background:transparent;color:inherit;cursor:pointer;font:inherit;';
      b.onclick = () => { (sec! as HTMLInputElement).value = String(v); };
      chips!.appendChild(b);
    });
    const close = () => overlay.remove();
    overlay.onclick = (ev) => { if (ev.target === overlay) close(); };
    (card!.querySelector('#runWarnCancel') as HTMLElement).onclick = close;
    (card!.querySelector('#runWarnRun') as HTMLElement).onclick = () => {
      if ((card!.querySelector('#runWarnNever') as HTMLInputElement).checked) void setPref('runWarn', false);
      close();
      void control('toggle', ((undefined)), { skipWarn: true });
    };
    (card!.querySelector('#runWarnPre') as HTMLElement).onclick = async () => {
      const seconds = Math.max(1, Math.min(120, Math.round(Number((sec! as HTMLInputElement).value) || 5)));
      if ((card!.querySelector('#runWarnNever') as HTMLInputElement).checked) void setPref('runWarn', false);
      const btn = card.querySelector('#runWarnPre');
      const stopBtn = card.querySelector('#runWarnStop');
      (btn! as HTMLButtonElement).disabled = true; btn!.textContent = '预计算中…'; info!.textContent = `正在计算 0→${seconds}s…`;
      (stopBtn! as HTMLElement).style.display = 'inline-block'; (stopBtn! as HTMLButtonElement).disabled = false; stopBtn!.textContent = '停止计算';
      (stopBtn! as HTMLElement).onclick = async () => {
        (stopBtn! as HTMLButtonElement).disabled = true; stopBtn!.textContent = '正在停止…';
        try {
          await api('/api/control', { method: 'POST', body: JSON.stringify({ action: 'cancel_precompute' }) });
        } catch (error) {
          info!.textContent = `取消失败：${(error as Error).message || '请求失败'}`;
        }
      };
      try {
        const pre = await runPrecomputeWithProgress(
          () => api('/api/plotkit/precompute', {
            method: 'POST',
            body: JSON.stringify({ seconds }),
            timeoutMs: 180000,
          }),
          `正在计算 0→${seconds}s`,
        );
        if (!pre || pre.ok === false) {
          info!.textContent = '预计算失败：' + ((pre && pre.error) || '未知错误') + '，可直接运行或缩小时间窗重试。';
          return;
        }
        if (pre.cancelled) {
          info!.textContent = `已停止：保留前 ${pre.frames ?? '?'} 帧（${Number(pre.last_time || 0).toFixed(3)}s）。`;
          return;
        }
        state.precomputedSeconds = seconds;
        state.precomputedRevision = state.scene?.revision ?? null;
        // 同步预计算产出的录制数据，让「分析·信号」等面板能列出并加载变量
        await syncAfterPrecompute(pre);
        // 2026-11-03：预计算现在按当前仿真 dt 采样，只有超过步数上限才会降级；
        // 降级必须说清楚，否则用户会以为「调高精度没生效」。
        const preNote = pre.degraded
          ? `（步长受 20 万步上限限制：请求 ${Number(pre.requested_dt).toExponential(1)}s，实际 ${Number(pre.dt_used).toExponential(1)}s）`
          : '';
        info!.textContent = `完成：${seconds}s / ${pre.frames ?? '?'} 帧 / ${Math.round(pre.elapsed_ms || 0)} ms${preNote}`;
        toast(
          pre.degraded
            ? `预计算完成但已降级步长（${Number(pre.dt_used).toExponential(1)}s）：${pre.frames ?? '?'} 帧，缩小时间窗可提高精度`
            : `预计算完成：${pre.frames ?? '?'} 帧，去「绘图」页勾选探针后点「接入」`,
          pre.degraded ? 'warn' : 'ok',
          pre.degraded ? 5200 : 4200,
        );
        close();
        const tab = document.querySelector('[data-sub="plotkit"]');
        if (tab) (tab as HTMLElement).click();
        setTimeout(() => refreshPkChannels(true), 400);
      } catch (error) {
        info!.textContent = `预计算失败：${(error as Error).message || '请求失败'}；可直接运行或检查桌面会话。`;
      } finally {
        (stopBtn! as HTMLElement).style.display = 'none';
        (btn! as HTMLButtonElement).disabled = false; btn!.textContent = '预计算并接入';
      }
    };
    (sec! as HTMLElement).focus();
  }

  async function maybeAutostart() {
    // R30-4：启动后任何模式都保持停止状态；运行必须由用户显式触发（空格/按钮）。
    return;
  }

  function showShutdownScreen() {
    ui.modalCard.replaceChildren();
    ui.modalCard.appendChild(el('h3', null, '服务已关闭'));
    const body = el('p', null, '后台仿真线程已停止，监听端口已释放。现在可以关闭此标签页。');
    const note = div('shutdown-note');
    note.textContent = '如需再次使用，请重新运行 run.py 或双击 start.bat；端口通常会在 1 秒内重新可用。';
    ui.modalCard.append(body, note);
    ui.modal.classList.remove('hidden');
    ui.modal.onclick = null;
  }

  async function shutdownApp() {
    if (state.shuttingDown) return;
    const confirmed = await confirmModal(
      '退出 Netlab？',
      '将停止仿真线程，终止后端进程并释放监听端口。所有未导出的内存场景都会丢失。',
      '退出并关闭',
      true,
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
      await fetch('/api/shutdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
        signal: controller.signal,
      });
    } catch (error) {
      // 进程可能在响应完全读取前退出；忽略网络错误。
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, 550));
    showShutdownScreen();
  }

  /* ======================================================================
   * 8.6 外壳：菜单栏 / 左侧网络栏 / 顶部信息条（R08）
   * ==================================================================== */

  const SHELL_KEYS = {
    netWidth: 'netlab.networks.width',
    netCollapsed: 'netlab.networks.collapsed',
    panelCollapsed: 'netlab.panel.collapsed',
    panelWidth: 'netlab.panel.width',
  };

  function menuDefinition() {
    return [
      {
        label: '文件',
        items: [
          { label: '新建工程', hint: '替换当前场景（未保存会提示）', action: () => void newProject() },
          { label: '打开工程…', action: () => void openProject() },
          { label: '保存工程', action: () => void saveProject(false) },
          { label: '另存为…', action: () => void saveProject(true) },
          { sep: true },
          { label: '恢复自动保存', action: () => void recoverAutosave() },
          { label: '导出场景 JSON', hint: 'Ctrl+Shift+E（下一票）', action: () => void exportScene() },
          { sep: true },
          { label: '退出服务', action: () => void shutdownApp() },
        ],
      },
      {
        label: '编辑',
        items: [
          { label: '撤销', hint: 'Ctrl+Z（100 步）', action: () => void undo() },
          { label: '重做', hint: 'Ctrl+Shift+Z', action: () => void redo() },
          { sep: true },
          { label: '复制', hint: 'Ctrl+C', action: () => copySelection(false) },
          { label: '剪切', hint: 'Ctrl+X', action: () => copySelection(true) },
          { label: '粘贴', hint: 'Ctrl+V（跨网络需确认）', action: () => void pasteClipboard() },
          { label: '全选', hint: 'Ctrl+A', action: () => selectAll() },
          { sep: true },
          { label: '删除选中', hint: 'Delete', action: () => void deleteSelection() },
          { label: '批量设置尺寸…', hint: '多选节点/器件后统一宽或直径', action: () => void batchResizeSelection() },
          { label: '清空场景', action: () => void clearScene() },
        ],
      },
      {
        label: '视图',
        items: [
          { label: '适配视图', action: () => fitView(true) },
          { label: '放大', action: () => zoomCenter(1.2) },
          { label: '缩小', action: () => zoomCenter(1 / 1.2) },
          { label: '自动布局', action: () => void autoLayout() },
          { label: '切换网格吸附', hint: 'Alt 拖动可临时暂停', action: () => toggleSnap() },
          { label: '切换符号风格', hint: '经典圆形 / GB 矩形（工程级）', action: () => toggleSymbol() },
          { label: '显示 / 隐藏引脚名', hint: '器件框引脚标注', action: () => {
            state.ui.showPins = state.ui.showPins === false;
            requestDraw();
          } },
          { sep: true },
          { label: '收起 / 展开左侧网络栏', action: () => toggleNetworks() },
          { label: '收起 / 展开右侧面板', action: () => togglePanel() },
        ],
      },
      {
        label: '工程 · 网络',
        items: [
          { label: '新建网络', action: () => void addNetwork() },
          { label: '重命名当前网络…', action: () => void renameNetwork() },
          { label: '删除当前网络…', action: () => void deleteNetwork() },
          { sep: true },
          { label: '刷新网络列表', action: () => void fetchNetworks(false) },
          { label: '工程文件位置', hint: '当前保存路径', action: () => {
            const path = state.project.path || '尚未保存：文件菜单可用「保存工程」落盘';
            toast(path, 'info', 5000);
          } },
        ],
      },
      {
        label: '仿真',
        items: [
          { label: '运行 / 暂停', hint: '空格', action: () => void control('toggle') },
          { label: '预计算数据…', hint: '先算 0→T，再在绘图页回放/接入', action: () => openRunWarn() },
          { label: '单步', hint: 'S', action: () => void control('step') },
          { label: '时间归零', hint: '只归零计时与录制，不清状态', action: () => void control('zero') },
          { label: '重置', hint: '清除状态与时间', action: () => void control('reset') },
        ],
      },
      {
        label: '分析',
        items: [
          { label: '分析面板', action: () => switchTab('analysis') },
          { label: '导出 CSV', action: () => void exportAnalysisCsv() },
        ],
      },
      {
        label: '工具',
        items: [
          { label: '全局搜索…', hint: 'Ctrl+K / R14', action: () => openDocSearch() },
          { sep: true },
          { label: '节点函数', action: () => switchTab('node-fn') },
          { label: '连接函数', action: () => switchTab('edge-fn') },
          { label: '模块与扩展', action: () => switchTab('blocks') },
          { sep: true },
          { label: '代码工作区（VS Code）', hint: '本地 IDE · 终端 / 扩展 / 调试', action: () => void openVscode() },
          { sep: true },
          { label: '性能面板', action: () => switchTab('analysis') },
          { label: '缓存体检与清理…', hint: '只清可再生成的缓存，不碰工程与自动保存', action: () => openCacheDialog() },
          { label: 'DC 工作点（.op）', hint: '不推进仿真，静默解一次静态电路', action: () => openAnalysis('op') },
          { label: 'AC 扫频（Bode）…', hint: '先求工作点再逐频点求解', action: () => openAnalysis('ac') },
          { label: '迁移场景为器件模型（R20）', hint: '元件边 → 器件节点 + 引脚导线', action: () => void migrateSceneToDevices() },
          { label: '新建连线（选择端点）…', hint: '网络↔网络纯导线 / 器件引脚↔网络', action: () => openWireDialog() },
        ],
      },
      {
        label: '设置',
        items: [
          { label: '工程设置…', hint: '工作模式 / 模板 / 文件 / 画布网格', action: () => openSettings('project') },
          { label: '视图与外观…', hint: '主题 / 强调色 / 动效 / 性能', action: () => openSettings('view') },
          { label: '交互与文档…', hint: '启动引导 / 自动保存 / 快捷键', action: () => openSettings('interact') },
          { sep: true },
          { label: '重新打开引导页', action: () => showGuide(true) },
          { label: '自动保存', hint: state.project.autosave ? '当前：开' : '当前：关', action: () => void saveAutosaveSetting({ autosave_enabled: !state.project.autosave }) },
        ],
      },
      {
        label: '帮助',
        items: [
          { label: '快速上手', action: () => openDoc('quickstart') },
          { label: '界面指南', action: () => openDoc('interface') },
          { label: '术语表', action: () => openDoc('glossary') },
          { label: '常见问题', action: () => openDoc('faq') },
          { label: '快捷键', hint: '?', action: () => openDoc('shortcuts') },
          { sep: true },
          { label: '文档中心（搜索）', hint: 'Ctrl+K', action: () => openDocSearch() },
          { label: '关于 Netlab', action: () => toast('Netlab · 拓扑网络 / 电路 / 热场仿真（本地运行）', 'info', 4000) },
        ],
      },
    ];
  }

  function closeMenus() {
    $$('.menu.open').forEach((node) => node.classList.remove('open'));
  }

  function initMenus() {
    const host = ui.menuItems;
    if (!host) return;
    host.replaceChildren();
    for (const menu of menuDefinition()) {
      const wrap = div('menu');
      const button = el('button', null, menu.label);
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.setAttribute('aria-haspopup', 'true');
      const panel = div('menu-panel');
      panel.setAttribute('role', 'menu');
      for (const item of menu.items) {
        if (item.sep) {
          panel.appendChild(div('menu-sep'));
          continue;
        }
        const entry = el('button', 'menu-item');
        entry.type = 'button';
        entry.disabled = Boolean((item as { disabled?: boolean }).disabled);
        entry.appendChild(el('strong', null, item.label));
        if (item.hint) entry.appendChild(el('small', null, item.hint));
        entry.addEventListener('click', () => {
          closeMenus();
          if (!(item as { disabled?: boolean }).disabled) (item as { action: () => void }).action();
        });
        panel.appendChild(entry);
      }
      button.addEventListener('click', (event: MouseEvent) => {
        event.stopPropagation();
        const open = wrap.classList.contains('open');
        closeMenus();
        if (!open) wrap.classList.add('open');
      });
      wrap.append(button, panel);
      host.appendChild(wrap);
    }
    document.addEventListener('pointerdown', (event: PointerEvent) => {
      if (!(event.target! as Element).closest('.menu')) closeMenus();
    });
    document.addEventListener('keydown', (event: KeyboardEvent) => {
      if ((event as Event as KeyboardEvent).key === 'Escape') closeMenus();
    });
  }

  function setInfo(key: string, value: unknown) {
    if (!ui.infoBar) return;
    const node = ui.infoBar.querySelector(`[data-info="${key}"]`);
    if (node) node.textContent = value as string;
  }

  function updateInfoBar() {
    if (!ui.infoBar) return;
    const modeLabel = { signal: '信号流', circuit: '电路', vector: '矢量' }[state.mode] || state.mode || '—';
    const network = state.currentNetwork?.name || '网络 1';
    const total = state.networks?.length || 1;
    const sim = (state.sim || {}) as SimRec;
    setInfo('project', `${state.project.name || '未命名工程'}${state.project.dirty ? ' *' : ''}`);
    setInfo('network', total > 1 ? `${network} (${total})` : network);
    setInfo('mode', modeLabel);
    const nodes = state.scene?.nodes?.length || 0;
    const edges = state.scene?.edges?.length || 0;
    setInfo('counts', `节点 ${nodes} · 连线 ${edges}`);
    const dt = Number(sim.config?.dt ?? sim.dt ?? state.scene?.sim?.dt ?? 0);
    const dtMs = dt * 1000;
    const dtText = dt >= 1
      ? `${dt.toFixed(dt % 1 ? 2 : 0)} s`
      : `${dtMs >= 10 ? dtMs.toFixed(0) : dtMs >= 1 ? dtMs.toFixed(1) : dtMs.toFixed(2)} ms`;
    setInfo('dt', `dt ${dtText}`);
    setInfo('time', `t ${Number(sim.time || 0).toFixed(3)} s`);
    setInfo('steps', `step ${Number(sim.steps || 0)}`);
    const alerts = Number(sim.alerts ?? sim.warnings ?? 0) || 0;
    const alertNode = ui.infoBar.querySelector('[data-info="alerts"]');
    if (alertNode) {
      alertNode.textContent = `告警 ${alerts}`;
      alertNode.classList.toggle('has-alert', alerts > 0);
    }
    const run = ui.infoBar.querySelector('[data-info="run"]');
    if (run) {
      run.textContent = sim.running ? '运行中' : '停止';
      run.classList.toggle('stopped', !sim.running);
    }
  }

  async function fetchNetworks(silent = true) {
    try {
      const response = await jsonRequest('/api/networks', 'GET');
      state.networks = response.networks || [];
      state.currentNetwork = state.networks.find((item) => item.current) || state.networks[0] || null;
      renderNetworkList();
      updateInfoBar();
      return state.networks;
    } catch (error) {
      if (!silent) toast(`网络列表读取失败：${(error as Error).message}`, 'error', 4000);
      return state.networks;
    }
  }

  function renderNetworkList() {
    if (!ui.networkList) return;
    ui.networkList.replaceChildren();
    for (const network of state.networks || []) {
      const item = el('button', 'network-item');
      item.type = 'button';
      item.setAttribute('role', 'option');
      item.dataset.networkId = network.id;
      item.classList.toggle('current', Boolean(network.current));
      item.setAttribute('aria-selected', network.current ? 'true' : 'false');
      item.title = `${network.name} · ${network.mode} · ${network.nodes} 节点 / ${network.edges} 连接`;
      const dot = div('dot');
      const label = el('span', null, network.name);
      const meta = el('span', 'meta', network.nodes as number);
      item.append(dot, label, meta);
      item.addEventListener('click', () => void switchNetwork(network.id));
      item.addEventListener('dblclick', () => void renameNetwork(network.id));
      item.addEventListener('contextmenu', (event: MouseEvent) => {
        event.preventDefault();
        openNetworkMenu(network, event.clientX, event.clientY);
      });
      ui.networkList.appendChild(item);
    }
  }

  /* 网络列表右键菜单（R02 / D49-D50，P7-07）：把封装入口放到网络这一层 */
  function openNetworkMenu(network: NetworkItem, x: number, y: number) {
    const isCurrent = Boolean(network.current);
    const picked = isCurrent ? multiSelection().nodes.size : 0;
    const tempModule = String(network.name || '').startsWith('模块 ');
    const moduleName = tempModule ? String(network.name).slice(3).trim() : '';
    const knownBlock = moduleName ? (state.blocks || []).find((block: BlockItem) => block.name === moduleName) : null;
    if (tempModule && !(state.blocks || []).length) void refreshBlocks();
    const items = [
      {
        label: '封装选中节点为模块…',
        hint: isCurrent
          ? (picked ? `已选 ${picked} 个节点` : '先在画布上 Ctrl+单击多选')
          : '先切换到该网络',
        disabled: !isCurrent || !picked,
        action: () => void encapsulateSelection(),
      },
      {
        label: '打开模块库',
        hint: '封装 / 实例化 / 打开内部',
        action: () => switchTab('blocks'),
      },
      { sep: true },
      {
        label: '在模块内部浮窗中打开',
        hint: knownBlock ? `预览「${moduleName}」内部` : tempModule ? '模块库里找不到同名模块' : '先切到模块内部临时网络',
        disabled: !knownBlock,
        action: () => {
          if (knownBlock) openModuleInternal(knownBlock.id);
        },
      },
      {
        label: '关闭模块内部临时网络',
        disabled: !tempModule,
        action: () => void closeInternalNetwork(),
      },
    ];
    showFloatingMenu(x, y, items, network.name);
  }

  /* 轻量浮层菜单：给右键 / 局部入口复用 */
  let floatingMenu: HTMLElement | null = null;

  function closeFloatingMenu() {
    if (!floatingMenu) return;
    floatingMenu.remove();
    floatingMenu = null;
  }

  function showFloatingMenu(x: number, y: number, items: MenuItemRec[], title: string = '') {
    closeFloatingMenu();
    const box = div('ctxmenu');
    box.setAttribute('role', 'menu');
    if (title) box.appendChild(div('ctxmenu-title', title));
    for (const item of items) {
      if (item.sep) {
        box.appendChild(div('menu-sep'));
        continue;
      }
      const entry = el('button', 'menu-item');
      entry.type = 'button';
      entry.disabled = Boolean((item as { disabled?: boolean }).disabled);
      entry.appendChild(el('strong', null, item.label));
      if (item.hint) entry.appendChild(el('small', null, item.hint));
      entry.addEventListener('click', () => {
        closeFloatingMenu();
        if (!(item as { disabled?: boolean }).disabled) (item as { action: () => void }).action();
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
    document.addEventListener('pointerdown', (event: PointerEvent) => {
      if (!floatingMenu) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('.ctxmenu')) closeFloatingMenu();
    }, true);
    window.addEventListener('blur', () => closeFloatingMenu());
    window.addEventListener('resize', () => closeFloatingMenu());
  }

  async function switchNetwork(networkId: string) {
    if (!networkId || networkId === state.currentNetwork?.id) return;
    const response = await task(() =>
      jsonRequest(`/api/networks/${encodeURIComponent(networkId)}/activate`, 'POST', {}),
    );
    if (!response || !response.scene) return;
    state.selection = { type: null, id: null };
    state.inspectorId = null;
    state.inspectorDirty = false;
    state.frames = [];
    state.values.clear();
    state.nodeValues.clear();
    state.edgeValues.clear();
    applySnapshot({ scene: response.scene, sim: response.sim, limits: (state.limits as LimitsRec | undefined) });
    state.cursor = Number(response.sim?.cursor || 0);
    await fetchNetworks();
    renderScenePanel();
    renderInspector();
    fitView();
    toast(`已切换到网络：${state.currentNetwork?.name || networkId}`, 'ok', 2200);
  }

  async function addNetwork() {
    const choice = await newNetworkModal(state.mode);
    if (!choice) return;
    const payload: Record<string, unknown> = { mode: choice.mode };
    if (choice.name) payload.name = choice.name;
    const response = await task(() => jsonRequest('/api/networks', 'POST', payload));
    if (!response) return;
    await fetchNetworks();
    const created = String(response.created || '');
    if (created) {
      await switchNetwork(created);
    }
    toast(`已新建网络（${modeLabel(choice.mode)}模式）`, 'ok', 2600);
  }

  async function renameNetwork(networkId = state.currentNetwork?.id) {
    if (!networkId) return;
    const item = (state.networks || []).find((network) => network.id === networkId);
    const proposed = window.prompt('网络名称（最长 60 字）', item?.name || '');
    if (proposed === null) return;
    const response = await task(() =>
      jsonRequest(`/api/networks/${encodeURIComponent(networkId)}`, 'PATCH', { name: proposed }),
    );
    if (!response) return;
    await fetchNetworks();
    toast(`网络已改名：${response.name}`, 'ok', 2200);
  }

  async function deleteNetwork() {
    const network = state.currentNetwork;
    if (!network) return;
    if ((state.networks || []).length <= 1) {
      toast('工程至少需要保留一个网络', 'error', 3200);
      return;
    }
    const confirmed = await confirmModal(
      `删除网络「${network.name}」？`,
      '该网络的节点与连接会一并删除；工程正本仍可用「保存工程」覆盖。',
      '删除',
      true,
    );
    if (!confirmed) return;
    const response = await task(() =>
      jsonRequest(`/api/networks/${encodeURIComponent(network.id)}`, 'DELETE'),
    );
    if (!response) return;
    await fetchNetworks();
    const snapshot = await api('/api/state');
    applySnapshot(snapshot);
    toast('网络已删除', 'ok', 2200);
  }

  // 挂耳位置跟随侧栏真实宽度：媒体查询会改列宽，只靠 CSS 里的默认值会偏出侧栏
  function syncChromeEdges() {
    if (!ui.main) return;
    if (ui.networks && !ui.main.classList.contains('net-hidden')) {
      const netWidth = Math.round(ui.networks.getBoundingClientRect().width);
      if (netWidth > 0) ui.main.style.setProperty('--net-edge', `${netWidth}px`);
    }
    if (ui.panel && !ui.main.classList.contains('panel-hidden')) {
      const panelWidth = Math.round(ui.panel.getBoundingClientRect().width);
      if (panelWidth > 0) ui.main.style.setProperty('--panel-edge', `${panelWidth}px`);
    }
  }

  function applyNetCollapsed(collapsed: boolean) {
    ui.main.classList.toggle('net-hidden', collapsed);
    if (ui.netHanger) {
      ui.netHanger.textContent = collapsed ? '›' : '‹';
      ui.netHanger.title = collapsed ? '展开网络栏' : '收起网络栏';
      ui.netHanger.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }
    try {
      localStorage.setItem(SHELL_KEYS.netCollapsed, collapsed ? '1' : '0');
    } catch (error) {
      // 隐私模式忽略
    }
    setTimeout(() => {
      syncChromeEdges();
      resizeGraph();
      resizeChart();
      schedulePhaseDraw();
    }, 60);
  }

  function toggleNetworks() {
    applyNetCollapsed(!ui.main.classList.contains('net-hidden'));
  }

  function initNetworkSidebar() {
    if (!ui.networkList) return;
    let width = 0;
    let collapsed = false;
    try {
      width = Number(localStorage.getItem(SHELL_KEYS.netWidth)) || 0;
      collapsed = localStorage.getItem(SHELL_KEYS.netCollapsed) === '1';
    } catch (error) {
      width = 0;
    }
    if (width >= 140 && width <= 360) {
      ui.main.style.setProperty('--net-w', `${Math.round(width)}px`);
    }
    applyNetCollapsed(collapsed);

    ui.netHanger?.addEventListener('click', toggleNetworks);
    ui.netAdd?.addEventListener('click', () => void addNetwork());
    ui.netRename?.addEventListener('click', () => void renameNetwork());
    ui.netDelete?.addEventListener('click', () => void deleteNetwork());

    const handle = ui.netResize;
    if (!handle) return;
    let dragging = false;
    let startX = 0;
    let startWidth = 0;
    const currentWidth = () => {
      const rect = ui.networks?.getBoundingClientRect();
      if (rect && rect.width > 0) return rect.width;
      const value = parseFloat(getComputedStyle(ui.main).getPropertyValue('--net-w'));
      return Number.isFinite(value) ? value : 172;
    };
    handle.addEventListener('pointerdown', (event: PointerEvent) => {
      dragging = true;
      startX = event.clientX;
      startWidth = currentWidth();
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add('net-dragging');
      event.preventDefault();
    });
    handle.addEventListener('pointermove', (event: PointerEvent) => {
      if (!dragging) return;
      const next = clamp(Math.round(startWidth + event.clientX - startX), 140, 360);
      ui.main.style.setProperty('--net-w', `${next}px`);
      ui.main.style.setProperty('--net-edge', `${next}px`);
    });
    const finish = (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('net-dragging');
      try {
        localStorage.setItem(SHELL_KEYS.netWidth, String(Math.round(currentWidth())));
      } catch (error) {
        // 忽略
      }
      syncChromeEdges();
      resizeGraph();
      resizeChart();
      schedulePhaseDraw();
      if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  }

  async function snapSceneToGrid() {
    const grid = Number(state.ui.grid) || 20;
    const snapValue = (value: number) => Math.round(value / grid) * grid;
    const nodes = (state.scene?.nodes || []).filter((node) => {
      const x = Number(node.position?.x || 0);
      const y = Number(node.position?.y || 0);
      return snapValue(x) !== Math.round(x) || snapValue(y) !== Math.round(y);
    });
    const edges = (state.scene?.edges || []).filter((edge) =>
      (edge.waypoints || []).some((point: { x: number; y: number }) => snapValue(point.x) !== Math.round(point.x) || snapValue(point.y) !== Math.round(point.y)),
    );
    if (!nodes.length && !edges.length) {
      toast('所有节点与拐点已在网格上', 'info', 2200);
      return;
    }
    await pushUndoSnapshot();
    for (const node of nodes) {
      const position = { x: snapValue(Number(node.position!.x) || 0), y: snapValue(Number(node.position!.y) || 0) };
      await task(() => jsonRequest(`/api/nodes/${encodeURIComponent(node.id)}`, 'PATCH', { position }), { history: false });
    }
    for (const edge of edges) {
      const waypoints = (edge.waypoints || []).map((point: { x: number; y: number }) => ({ x: snapValue(point.x), y: snapValue(point.y) }));
      await task(() => jsonRequest(`/api/edges/${encodeURIComponent(edge.id)}`, 'PATCH', { waypoints }), { history: false });
    }
    await refreshState(true);
    toast(`已整理 ${nodes.length} 个节点、${edges.length} 条连线到 ${grid} 网格`, 'ok', 2600);
  }

  function toggleSnap() {
    state.ui.snap = !state.ui.snap;
    toast(`网格吸附已${state.ui.snap ? '开启' : '关闭'}（Alt 临时暂停）`, 'info', 2400);
    markProjectDirty();
  }

  function toggleSymbol() {
    state.ui.symbol = state.ui.symbol === 'gb' ? 'classic' : 'gb';
    requestDraw();
    markProjectDirty();
    toast(`符号风格：${state.ui.symbol === 'gb' ? 'GB 矩形' : '经典圆形'}（仅本工程）`, 'info', 2600);
  }

  function applyProjectUi(uiSettings: Record<string, unknown>) {
    if (!uiSettings || typeof uiSettings !== 'object') return;
    if (uiSettings.grid && typeof uiSettings.grid === 'object') {
      if (typeof (uiSettings.grid as { [k: string]: unknown }).snap === 'boolean') state.ui.snap = (uiSettings.grid as { [k: string]: unknown }).snap as boolean;
      if (typeof (uiSettings.grid as { [k: string]: unknown }).show === 'boolean') state.ui.showGrid = (uiSettings.grid as { [k: string]: unknown }).show as boolean;
      if (typeof (uiSettings.grid as { [k: string]: unknown }).markers === 'boolean') state.ui.snapMarkers = (uiSettings.grid as { [k: string]: unknown }).markers as boolean;
      if (typeof (uiSettings.grid as { [k: string]: unknown }).orthogonal === 'boolean') state.ui.circuitOrthogonal = (uiSettings.grid as { [k: string]: unknown }).orthogonal as boolean;
      const size = Number((uiSettings.grid as { [k: string]: unknown }).size);
      if (Number.isFinite(size) && size >= 5 && size <= 80) state.ui.grid = size;
    }
    if (uiSettings.symbol === 'gb' || uiSettings.symbol === 'classic') {
      state.ui.symbol = uiSettings.symbol;
    }
    if (['circle', 'dot', 'box'].includes((uiSettings.nodeStyle as string))) state.ui.nodeStyle = uiSettings.nodeStyle as string;
    if (typeof uiSettings.drawingMode === 'boolean') state.ui.drawingMode = uiSettings.drawingMode;
    if (typeof uiSettings.drawingSheet === 'string' && SHEET_SIZES[uiSettings.drawingSheet]) state.ui.drawingSheet = uiSettings.drawingSheet;
    if (typeof uiSettings.drawingLabels === 'boolean') state.ui.drawingLabels = uiSettings.drawingLabels;
    if (Number.isFinite(Number(uiSettings.drawingPage))) state.ui.drawingPage = Math.max(1, Math.min(9, Number(uiSettings.drawingPage)));
    if (typeof uiSettings.cardDetail === 'boolean') state.ui.cardDetail = uiSettings.cardDetail;
    if (typeof uiSettings.cardValue === 'boolean') state.ui.cardValue = uiSettings.cardValue;
    if (Number.isFinite(Number(uiSettings.symbolScale))) state.ui.symbolScale = clamp(Number(uiSettings.symbolScale), 0.6, 2.5);
    if (typeof uiSettings.glyphColor === 'string') state.ui.glyphColor = uiSettings.glyphColor;
    requestDraw();
  }

  /* ======================================================================
   * 8.7 模块库面板（R02：封装 / 实例化 / 导入）
   * ==================================================================== */

  function blockBadges(spec: BlockItem) {
    const badges = [
      spec.mode,
      spec.model || 'behavioral',
      `v${spec.version}`,
      `${spec.node_count} 节点`,
      `${(spec.inputs || []).length} 入 / ${(spec.outputs || []).length} 出`,
    ];
    if (spec.builtin) badges.unshift('内置');
    return badges;
  }

  async function refreshBlocks() {
    const response = await task(() => jsonRequest('/api/blocks', 'GET'), { dirty: false });
    if (!response) return;
    state.blocks = response.blocks || [];
    state.blocksLibrary = response.library || '';
    renderBlocksPanel();
  }

  async function instantiateBlockFromLibrary(blockId: string) {
    const place = centerPlacement();
    const response = await task(() =>
      jsonRequest('/api/blocks/instantiate', 'POST', {
        block_id: blockId,
        position: { x: Math.round(place.x), y: Math.round(place.y) },
      }),
    );
    if (!response) return;
    applySnapshot(response);
    await refreshBlocks();
    if (response.instance?.block_node) {
      await selectEntity('node', response.instance.block_node, true);
      switchTab('inspect');
    }
    toast('模块已实例化到画布', 'ok', 2400);
  }

  async function encapsulateSelection() {
    const liveNodes = new Set((state.scene?.nodes || []).map((node) => node.id));
    const picked = [...multiSelection().nodes];
    const nodes = picked.filter((id: string) => liveNodes.has(id));
    if (picked.length && !nodes.length) {
      // 画布和服务端场景不同步（后端重启、另一个窗口改过场景）：先同步再让用户重选。
      await refreshState(false);
      toast('画布已过期（节点已不在当前场景），已刷新，请重新选择要封装的节点', 'error', 5200);
      return;
    }
    if (!nodes.length) {
      toast('先在画布上选中要封装的节点（Ctrl+单击多选）', 'info', 3200);
      return;
    }
    const proposed = window.prompt('模块名称（最长 32 字）', '模块');
    if (proposed === null) return;
    let response = null;
    try {
      response = await jsonRequest('/api/blocks/encapsulate', 'POST', {
        node_ids: nodes,
        name: proposed,
        model: state.blocksStructural ? 'structural' : 'behavioral',
      });
    } catch (error) {
      await refreshState(false);
      toast(`封装失败：${(error as Error).message || error}`, 'error', 6000);
      return;
    }
    if (!response) return;
    applySnapshot({ scene: response.scene, sim: response.sim, limits: (state.limits as LimitsRec | undefined) });
    state.multi.nodes.clear();
    state.multi.edges.clear();
    clearSelection();
    await refreshBlocks();
    toast(`已封装为模块「${response.block.name}」并写入库`, 'ok', 3000);
  }

  async function retryDegradedProject() {
    const response = await task(() => jsonRequest('/api/project/retry', 'POST', {}));
    if (!response) return;
    applySnapshot({ scene: response.scene, sim: response.sim, limits: (state.limits as LimitsRec | undefined) });
    if (response.degraded) {
      toast('库文件仍缺失，已保持降级只读', 'error', 3200);
    } else {
      toast('已解除降级只读，可以运行', 'ok', 2800);
    }
    await refreshBlocks();
  }

  async function closeInternalNetwork() {
    const network = state.currentNetwork;
    if (!network || !String(network.name || '').startsWith('模块 ')) {
      toast('当前网络不是模块内部临时网络', 'info', 2600);
      return;
    }
    await deleteNetwork();
    await refreshBlocks();
  }

  function initBlockDragDrop() {
    const graph = ui.graph;
    if (!graph) return;
    graph.addEventListener('dragover', (event: MouseEvent) => {
      if (!(event as Event as DragEvent).dataTransfer || !((event as Event as DragEvent).dataTransfer as DataTransfer).types.includes('text/netlab-block')) return;
      event.preventDefault();
      ((event as Event as DragEvent).dataTransfer as DataTransfer).dropEffect = 'copy';
    });
    graph.addEventListener('drop', async (event: MouseEvent) => {
      const blockId = (event as Event as DragEvent).dataTransfer?.getData('text/netlab-block');
      if (!blockId) return;
      event.preventDefault();
      const rect = graph.getBoundingClientRect();
      const world = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
      const response = await task(() =>
        jsonRequest('/api/blocks/instantiate', 'POST', {
          block_id: blockId,
          position: { x: Math.round(world.x), y: Math.round(world.y) },
        }),
      );
      if (!response) return;
      applySnapshot(response);
      if (response.instance?.block_node) {
        await selectEntity('node', response.instance.block_node, true);
      }
      toast('模块已拖入画布并实例化', 'ok', 2400);
    });
  }

  async function openBlockInternal(blockId: string) {
    const response = await task(() =>
      jsonRequest(`/api/blocks/${encodeURIComponent(blockId)}/open-internal`, 'POST', {}),
    );
    if (!response) return false;
    applySnapshot({ scene: response.scene, sim: response.sim, limits: (state.limits as LimitsRec | undefined) });
    await fetchNetworks();
    fitView();
    toast('已在临时网络中打开模块内部', 'ok', 3000);
    return true;
  }

  /* 8.7b 模块内部浮窗（R02 / D50，P7-07）：只读预览，不切换当前网络 */
  const MODULE_DIR_GLYPH = { input: '→', output: '←', inout: '↔' };
  const MODULE_DIR_LABEL = { input: '输入', output: '输出', inout: '双向' };
  // 网络节点右键盘口方向三选一（D49：方向只决定引脚画在哪一侧）。
  const PORT_DIRECTION_CHOICES = [
    ['input', '输入', '引脚画在模块左侧，表示从外部流进来'],
    ['output', '输出', '引脚画在模块右侧，表示向外流出'],
    ['inout', '双向', '电气网络默认，两侧都可接线，也可当测试点'],
  ];

  // 模块库卡片上的端口摘要：电路模块按方向分组，信号块仍是「入 → 出」。
  function describeBlockPorts(spec: BlockItem) {
    const ports = Array.isArray(spec?.ports) ? spec.ports : [];
    if (String(spec?.mode || '') === 'circuit' && ports.length) {
      const grouped: Record<string, string[]> = { input: [], output: [], inout: [] };
      for (const port of ports) {
        const bucket = grouped[port.direction as string] || grouped.inout;
        bucket.push(port.name);
      }
      const parts = [];
      for (const key of ['input', 'output', 'inout']) {
        if (grouped[key].length) parts.push(`${MODULE_DIR_LABEL[key as keyof typeof MODULE_DIR_LABEL]} ${grouped[key].join('/')}`);
      }
      return parts.join('   ') || '无端口';
    }
    const inputs = (spec?.inputs || []).map((port: PortSpec) => port.name).join(', ') || '—';
    const outputs = (spec?.outputs || []).map((port: PortSpec) => port.name).join(', ') || '—';
    return `${inputs} → ${outputs}`;
  }

  function modulePortList(block: BlockItem) {
    return (block?.ports || []).map((port: PortSpec) => ({
      name: String(port.name || 'port'),
      direction: String(port.direction || (port.dtype === 'electrical' ? 'inout' : 'input')),
      dtype: String(port.dtype || ''),
      net: String(port.net || ''),
    }));
  }

  function renderModuleSide(block: BlockItem) {
    const side = ui.modulePorts;
    if (side) {
      side.replaceChildren();
      const ports = modulePortList(block);
      side.appendChild(el('h4', null, `端口（${ports.length}）`));
      if (!ports.length) side.appendChild(div('help', '这个模块没有端口。'));
      for (const port of ports) {
        const row = div('port-row');
        row.appendChild(el('span', 'port-dir', MODULE_DIR_GLYPH[port.direction as keyof typeof MODULE_DIR_GLYPH] || '·'));
        const name = el('span', 'port-name', port.name);
        name.title = `${port.name} · ${port.direction}${port.net ? ` · ${port.net}` : ''}`;
        row.appendChild(name);
        row.appendChild(el('span', 'badge gray', port.dtype === 'electrical' ? '电气' : '信号'));
        side.appendChild(row);
      }
    }
    const meta = ui.moduleMeta;
    if (meta) {
      meta.replaceChildren();
      const rows = [
        ['节点', String((block?.nodes || []).length)],
        ['连线', String((block?.edges || []).length)],
        ['端口', String((block?.ports || []).length)],
        ['版本', `v${Number(block?.version || 1)}`],
        ['模型', block?.model === 'structural' ? '结构' : '行为'],
      ];
      for (const [key, value] of rows) {
        meta.appendChild(el('span', null, key));
        meta.appendChild(el('b', null, value));
      }
    }
  }

  function drawModulePreview() {
    const canvas = ui.moduleCanvas;
    const block = state.moduleBlock as BlockItem | null;
    const stage = ui.moduleStage;
    if (!canvas || !stage || !block) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const box = stage.getBoundingClientRect();
    const width = Math.round(box.width);
    const height = Math.round(box.height);
    if (width < 20 || height < 20) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = C('#faf8f2');
    ctx.fillRect(0, 0, width, height);

    const nodes = (block.nodes || []).map((node: NodeItem) => ({
      id: String(node.id || ''),
      label: String(node.params?.port_name || node.name || node.label || node.kind || node.id || '?'),
      kind: String(node.kind || ''),
      x: Number(node.position?.x ?? node.x ?? 0),
      y: Number(node.position?.y ?? node.y ?? 0),
    }));
    const isEmpty = !nodes.length;
    if (ui.moduleEmpty) ui.moduleEmpty.hidden = !isEmpty;
    canvas.hidden = isEmpty;
    if (isEmpty) return;

    const portNets = new Set(modulePortList(block).map((port: PortSpec) => port.net).filter(Boolean));
    const xs = nodes.map((node: PreviewNode) => node.x);
    const ys = nodes.map((node: PreviewNode) => node.y);
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
    const project = (node: NodeItem | PreviewNode) => ({ x: node.x * scale + offsetX, y: node.y * scale + offsetY });
    const byId = new Map(nodes.map((node: PreviewNode) => [node.id, node]));

    ctx.strokeStyle = C('#ded7c8');
    ctx.lineWidth = 1;
    for (const edge of block.edges || []) {
      const source = byId.get(String(edge.source || ''));
      const target = byId.get(String(edge.target || ''));
      if (!source || !target) continue;
      const a = project(source);
      const b = project(target);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    ctx.font = '10px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const node of nodes) {
      const point = project((node as NodeItem));
      const isPort = portNets.has(node.id);
      const isGround = node.kind === 'ground';
      const isDevice = node.kind === 'device';
      const text = node.label.length > 12 ? `${node.label.slice(0, 11)}…` : node.label;
      const w = Math.max(54, Math.round(ctx.measureText(text).width) + 18);
      const h = 22;
      // 端口 > 接地 > 器件 > 普通网络，四档配色让内部结构一眼分清
      const fill = isPort ? tokens().modPortFill : isGround ? tokens().modGroundFill : isDevice ? tokens().modDeviceFill : tokens().modFill;
      const stroke = isPort ? tokens().modPortStroke : isGround ? tokens().modGroundStroke : isDevice ? tokens().modDeviceStroke : tokens().modStroke;
      const ink = isPort ? tokens().modPortInk : isGround ? tokens().modGroundInk : isDevice ? tokens().modDeviceInk : tokens().modInk;
      ctx.beginPath();
      ctx.rect(point.x - w / 2, point.y - h / 2, w, h);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = isPort ? 1.6 : 1;
      ctx.stroke();
      ctx.fillStyle = ink;
      ctx.fillText(text, point.x, point.y);
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = C('#969083');
    ctx.font = '9.5px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.fillText(`只读预览 · ${block.name || block.id} · ${nodes.length} 节点 / ${(block.edges || []).length} 连线`, 12, height - 12);
  }

  function layoutModuleWindow() {
    if (!ui.moduleWin) return;
    ui.moduleWin.classList.toggle('docked', Boolean(state.moduleDock));
    if (ui.moduleDock) ui.moduleDock.classList.toggle('on', Boolean(state.moduleDock));
  }

  function openModuleInternal(blockId: string, block?: BlockItem) {
    const run = async () => {
      let target = block;
      if (!target) {
        const response = await task(
          () => jsonRequest(`/api/blocks/${encodeURIComponent(blockId)}`, 'GET'),
          { dirty: false },
        );
        if (!response?.block) return;
        target = response.block as BlockItem;
      }
      state.moduleBlock = target;
      if (ui.moduleWinTitle) ui.moduleWinTitle.textContent = target.name || target.id || '模块内部';
      if (ui.moduleWinHint) {
        const suffix = target.builtin
          ? ' · 内置结构只读，可另存副本'
          : '';
        ui.moduleWinHint.textContent =
          `MODULE · ${(target.nodes || []).length} 节点 · v${Number(target.version || 1)}${suffix}`;
      }
      if (ui.moduleEdit) {
        ui.moduleEdit.textContent = target.builtin ? '在临时网络中另存副本' : '在临时网络中编辑';
      }
      renderModuleSide(target);
      ui.moduleWin.hidden = false;
      layoutModuleWindow();
      if (!state.moduleDock) {
        placeFloatWindow(ui.moduleWin, 'moduleGeo');
        raiseFloatWindow(ui.moduleWin);
      }
      requestAnimationFrame(() => drawModulePreview());
    };
    void run();
  }

  function closeModuleInternal() {
    if (!ui.moduleWin || ui.moduleWin.hidden) return;
    ui.moduleWin.hidden = true;
    toast('已关闭模块内部视图', 'info', 1800);
  }

  function toggleModuleDock() {
    if (!ui.moduleWin) return;
    state.moduleDock = !state.moduleDock;
    layoutModuleWindow();
    if (state.moduleDock) {
      ui.moduleWin.hidden = false;
      ui.moduleWin.classList.remove('moved');
      ui.moduleWin.style.left = '';
      ui.moduleWin.style.top = '';
      ui.moduleWin.style.width = '';
      ui.moduleWin.style.height = '';
      requestAnimationFrame(() => drawModulePreview());
    } else {
      placeFloatWindow(ui.moduleWin, 'moduleGeo');
      raiseFloatWindow(ui.moduleWin);
      requestAnimationFrame(() => drawModulePreview());
    }
  }

  function initModuleWindow() {
    if (!ui.moduleWin) return;
    initFloatWindow(ui.moduleWin, 'moduleGeo', { minWidth: 520, minHeight: 340 });
    ui.moduleWinClose?.addEventListener('click', () => closeModuleInternal());
    ui.moduleDock?.addEventListener('click', () => toggleModuleDock());
    ui.moduleEdit?.addEventListener('click', () => {
      const block = state.moduleBlock as BlockItem | null;
      if (!block?.id) return;
      // 打开成功才收窗：失败（例如内部网络缺接地）时保留预览，错误由 task 统一提示
      void openBlockInternal(block.id).then((ok) => {
        if (ok) closeModuleInternal();
      });
    });
    ui.moduleAddInstance?.addEventListener('click', () => {
      const block = state.moduleBlock as BlockItem | null;
      if (!block?.id) return;
      void instantiateBlockFromLibrary(block.id);
    });
    if (ui.moduleStage && typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => {
        if (!ui.moduleWin?.hidden) drawModulePreview();
      });
      observer.observe(ui.moduleStage);
    }
  }

  async function saveCurrentAsBlockCopy() {
    const proposed = window.prompt('副本模块名称（新 id，v1）', `${state.currentNetwork?.name || '模块'}-copy`);
    if (proposed === null) return;
    const response = await task(() =>
      jsonRequest('/api/blocks/save-copy', 'POST', { name: proposed }),
    );
    if (!response) return;
    await refreshBlocks();
    await fetchNetworks();
    toast(`已另存为模块副本「${response.block.name}」（id=${response.block.id}）`, 'ok', 3400);
  }

  async function importBlockFile() {
    const input = el('input');
    input.type = 'file';
    input.accept = '.block,application/json';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const payload = JSON.parse(text);
        // R04：先校验再导入；阻断级直接拒绝，警告级需确认。
        const report = await task(
          () => jsonRequest('/api/blocks/validate', 'POST', { payload }),
          { dirty: false },
        );
        if (!report) return;
        if (!report.ok) {
          const lines = (report.blocking || []).map((item: IssueRec) => `· [${item.code}] ${item.message}`);
          showBanner(`模块校验未通过：${lines.join('；')}`);
          toast('模块校验未通过，已阻止导入（报告见顶部横幅）', 'error', 6000);
          return;
        }
        if ((report.warnings || []).length) {
          const body = div('help');
          body.textContent = (report.warnings || [])
            .map((item: IssueRec) => `· [${item.code}] ${item.message}`)
            .join('；');
          const proceed = await confirmModal(
            `模块有 ${report.warnings.length} 条警告`,
            ((body)),
            '仍然导入',
            false,
          );
          if (!proceed) return;
        }
        const response = await task(() =>
          jsonRequest('/api/blocks/import', 'POST', { payload }),
        );
        if (!response) return;
        await refreshBlocks();
        toast(`已导入模块 v${response.version}（干跑 ${report.summary?.dry_run || 'skipped'}）`, 'ok', 3000);
      } catch (error) {
        toast(`导入失败：${(error as Error).message}`, 'error', 5000);
      }
    });
    input.click();
  }


  /* ======================================================================
   * 工作台：多状态参数表 + 状态列表（W1）
   * ==================================================================== */
  interface WbStateRec {
    id: string;
    name: string;
    params?: {
      nodes?: Record<string, Record<string, unknown>>;
      edges?: Record<string, Record<string, unknown>>;
      integration?: unknown;
    };
    sim?: Record<string, unknown>;
    base?: boolean;
    created?: string;
    [k: string]: unknown;
  }

  interface WbStatesPayload {
    network: string;
    current: string;
    states: WbStateRec[];
    base?: string | null;
    removed?: string;
    cache_key?: string;
  }

  const WB_INTEGRATIONS = [
    { value: 'trapezoidal', label: '梯形法' },
    { value: 'backward_euler', label: '后向欧拉' },
    { value: 'gear2', label: 'Gear2' },
  ];

  const WB_SIM_FIELDS: Array<{
    key: string;
    label: string;
    type: string;
    unit?: string;
    step?: string;
    min?: string;
  }> = [
    { key: 'dt', label: '步长 dt', type: 'float', unit: 's' },
    { key: 'fps', label: '目标 FPS', type: 'int' },
    { key: 'steps_per_frame', label: '每帧步数', type: 'int' },
    { key: 'sample_every', label: '采样间隔', type: 'int' },
    { key: 'reltol', label: '相对容差 reltol', type: 'float' },
    { key: 'vntol', label: '电压容差 vntol', type: 'float', unit: 'V' },
    { key: 'abstol', label: '电流容差 abstol', type: 'float', unit: 'A' },
    { key: 'max_iter', label: '最大迭代 max_iter', type: 'int' },
    { key: 'gmin_steps', label: 'gmin 步数', type: 'int' },
    { key: 'src_steps', label: '源步数', type: 'int' },
    { key: 'residual_tol', label: '残差容差', type: 'float' },
  ];

  let wbStatesPayload: WbStatesPayload | null = null;
  let wbSelectedId = '';
  let wbDirty = false;
  let wbFilterText = '';

  /* ---- W2：每状态预计算缓存 + 多状态对比 + 可分离信号浮窗 ---- */
  interface WbCacheRow {
    state_id?: string;
    name?: string;
    cached?: boolean;
    frames?: number;
    created?: string;
    duration?: number;
    probes?: string[];
    params_hash?: string;
    invalid?: boolean;
    reason?: string;
  }
  interface WbCacheStatusPayload {
    network?: string;
    cache_root?: string;
    temporary?: boolean;
    states: WbCacheRow[];
  }
  interface WbCompareEntry {
    state_id?: string;
    name?: string;
    ok?: boolean;
    missing?: boolean;
    stale?: boolean;
    reason?: string;
    t?: number[];
    series?: Record<string, number[]>;
    meta?: Record<string, unknown>;
  }
  interface WbComparePayload {
    ok?: boolean;
    network?: string;
    signals?: string[];
    requested?: string[];
    states?: WbCompareEntry[];
  }

  let wbCacheStatus: WbCacheStatusPayload | null = null;
  let wbCompareStateIds: string[] = [];
  let wbCompareSignals: string[] = [];
  let wbCompareLayout = { cols: 0, height: 220 };
  let wbComparePayload: WbComparePayload | null = null;
  // W3：对比子图绘制器选择（默认简易 canvas，可选 PlotKit 内嵌渲染）。
  let wbCompareRenderer: WbRendererKind = 'simple-chart';
  let wbActiveRenderers: ChartRenderer[] = [];

  function wbBadge(text: string, cls: string): HTMLSpanElement {
    return el('span', cls, text);
  }

  function wbMarkDirty(): void {
    wbDirty = true;
    const badge = $('#wbDirtyBadge');
    if (badge) {
      badge.textContent = '未保存到状态';
      badge.className = 'badge violet';
    }
    markProjectDirty();
  }

  function renderWorkbenchAnalysis(): void {
    const pane = $('#tab-wb-analysis');
    if (!pane) return;
    const host = div('blocks-host wb-analysis');

    const head = div('insp-head');
    const title = div('insp-title');
    title.append(
      el('h2', null, '工作台 · 分析'),
      el('p', null, '多状态结果对比：每个状态一子图，共享同一信号组，x 轴对齐。'),
    );
    head.appendChild(title);
    host.appendChild(head);

    // 工具条：预计算 / 统一仿真 / 生成对比 / 信号窗浮出-停靠
    const toolbar = div('blocks-toolbar');
    toolbar.append(
      button('预计算选中状态', 'btn tiny', () => void wbPrecomputeSelected()),
      button('统一仿真设置', 'btn tiny', () => void wbUnifySim()),
      button('生成对比图', 'btn tiny primary', () => void wbGenerateCompare()),
      button('信号窗 浮出/停靠', 'btn tiny', () => setWbSignalDock(!state.wbSignalDock)),
    );
    host.appendChild(toolbar);

    // 布局：列数（0=自动）、子图高度；改动即重排，坐标仍对齐
    const layoutRow = div('field-row wb-layout-row');
    const colsInput = el('input', 'input') as HTMLInputElement;
    colsInput.type = 'number';
    colsInput.min = '0';
    colsInput.max = '6';
    colsInput.value = String(wbCompareLayout.cols);
    colsInput.title = '每行列数（0 = 自动）';
    const heightInput = el('input', 'input') as HTMLInputElement;
    heightInput.type = 'number';
    heightInput.min = '120';
    heightInput.max = '600';
    heightInput.step = '20';
    heightInput.value = String(wbCompareLayout.height);
    heightInput.title = '单个子图高度（px）';
    colsInput.addEventListener('change', () => {
      wbCompareLayout.cols = Math.max(0, Math.min(6, Number(colsInput.value) || 0));
      if (wbComparePayload) renderCompareGrid();
    });
    heightInput.addEventListener('change', () => {
      wbCompareLayout.height = Math.max(120, Math.min(600, Number(heightInput.value) || 220));
      if (wbComparePayload) renderCompareGrid();
    });
    const rendererSelect = el('select', 'input') as HTMLSelectElement;
    rendererSelect.title = '对比子图绘制器（简易 canvas / PlotKit 内嵌）';
    const rendererChoices: [WbRendererKind, string][] = [
      ['simple-chart', '简易 canvas'],
      ['plotkit', 'PlotKit 内嵌'],
    ];
    for (const [value, label] of rendererChoices) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      rendererSelect.appendChild(option);
    }
    rendererSelect.value = wbCompareRenderer;
    rendererSelect.addEventListener('change', () => {
      wbCompareRenderer = rendererSelect.value === 'plotkit' ? 'plotkit' : 'simple-chart';
      if (wbComparePayload) renderCompareGrid();
    });
    layoutRow.append(
      el('label', null, '列数'),
      colsInput,
      el('label', null, '子图高度(px)'),
      heightInput,
      el('label', null, '绘制器'),
      rendererSelect,
    );
    host.appendChild(layoutRow);

    // 信号浮窗的停靠位（浮出时面板移入 #wbSignalWin）
    const inline = el('div', 'wb-signal-inline') as HTMLDivElement;
    inline.id = 'wbSignalInline';
    host.appendChild(inline);

    const grid = el('div', 'wb-compare-grid') as HTMLDivElement;
    grid.id = 'wbCompareGrid';
    host.appendChild(grid);

    const status = div('help wb-compare-status');
    status.id = 'wbCompareStatus';
    status.textContent = '读取缓存中…';
    host.appendChild(status);

    pane.replaceChildren(host);
    void refreshWbAnalysis();
  }

  /** 把当前工程路径同步给后端（决定 .netlab-states 的落点；未保存→临时目录）。 */
  async function syncProjectContext(): Promise<void> {
    const path = String(state.project?.path || '');
    try {
      await api('/api/project/context', {
        method: 'POST',
        body: JSON.stringify({ path }),
        timeoutMs: 8000,
      });
    } catch {
      /* 后端不可用时静默：缓存只是优化项，不应阻塞前端 */
    }
  }

  function wbToggleInArray(arr: string[], value: string, on: boolean): void {
    const index = arr.indexOf(value);
    if (on && index < 0) arr.push(value);
    else if (!on && index >= 0) arr.splice(index, 1);
  }

  function wbAvailableProbes(): string[] {
    const set = new Set<string>();
    const rows = wbCacheStatus?.states || [];
    const pick = rows.filter((row) => wbCompareStateIds.indexOf(String(row.state_id)) >= 0);
    const source = pick.length ? pick : rows;
    for (const row of source) for (const probe of row.probes || []) set.add(String(probe));
    if (!set.size) {
      const keys = (state.sim?.probe_keys || []) as string[];
      for (const key of keys) set.add(String(key));
    }
    return Array.from(set);
  }

  function wbSimInconsistent(): boolean {
    const states = wbStatesPayload?.states || [];
    if (states.length < 2) return false;
    const signatures = states.map((item) => JSON.stringify(item.sim || {}));
    return signatures.some((sig) => sig !== signatures[0]);
  }

  /** 刷新缓存状态 → 校正选中集 → 重建信号面板 → 生成对比图。 */
  async function refreshWbAnalysis(): Promise<void> {
    await syncProjectContext();
    try {
      const sp = (await jsonRequest('/api/network/states', 'GET')) as WbStatesPayload | null;
      if (sp) wbStatesPayload = sp;
    } catch {
      /* 状态列表拿不到不影响缓存读取 */
    }
    try {
      const cache = (await jsonRequest('/api/network/state/cache', 'GET')) as WbCacheStatusPayload | null;
      if (cache) wbCacheStatus = cache;
    } catch (error) {
      toast(`读取缓存状态失败：${(error as Error)?.message || error}`, 'error', 6000);
    }
    const rows = wbCacheStatus?.states || [];
    const ids = rows.map((row) => String(row.state_id || '')).filter(Boolean);
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
      const status = $('#wbCompareStatus');
      if (status) status.textContent = '请选择至少两个状态与一组共享信号，再点「生成对比图」。';
    }
  }

  /** 信号/状态选择面板内容（可停靠在分析页，也可移入浮窗）。 */
  function renderWbSignalPanel(): void {
    let panel = $('#wbSignalPanel') as HTMLDivElement | null;
    if (!panel) {
      panel = div('wb-signal-panel');
      panel.id = 'wbSignalPanel';
    }
    panel.replaceChildren();

    const rows = wbCacheStatus?.states || [];
    const stateSection = div('wb-signal-section');
    stateSection.appendChild(div('wb-signal-title', '状态（勾选 ≥2 个参与对比）'));
    const stateList = div('wb-signal-list');
    if (!rows.length) stateList.appendChild(div('help', '尚无状态。请到「状态」页新建。'));
    for (const row of rows) {
      const id = String(row.state_id || '');
      const label = el('label', 'wb-check') as HTMLLabelElement;
      const box = el('input', '') as HTMLInputElement;
      box.type = 'checkbox';
      box.checked = wbCompareStateIds.indexOf(id) >= 0;
      box.addEventListener('change', () => wbToggleInArray(wbCompareStateIds, id, box.checked));
      const suffix = row.cached ? `（${row.frames || 0} 帧）` : '（未预计算）';
      label.append(box, el('span', null, `${row.name || id}${suffix}`));
      stateList.appendChild(label);
    }
    stateSection.appendChild(stateList);
    if (wbSimInconsistent()) {
      stateSection.appendChild(
        div('help wb-warn', '各状态仿真设置不一致，对比前建议点「统一仿真设置」以保证可比。'),
      );
    }
    panel.appendChild(stateSection);

    const probes = wbAvailableProbes();
    const signalSection = div('wb-signal-section');
    signalSection.appendChild(div('wb-signal-title', '共享信号（所有子图共用同一组）'));
    const signalList = div('wb-signal-list');
    if (!probes.length) {
      signalList.appendChild(div('help', '尚无可选信号：请先预计算至少一个状态。'));
    }
    for (const key of probes) {
      const label = el('label', 'wb-check') as HTMLLabelElement;
      const box = el('input', '') as HTMLInputElement;
      box.type = 'checkbox';
      box.checked = wbCompareSignals.indexOf(key) >= 0;
      box.addEventListener('change', () => wbToggleInArray(wbCompareSignals, key, box.checked));
      const swatch = el('span', 'wb-swatch') as HTMLElement;
      swatch.style.background = colorForKey(key);
      label.append(box, swatch, el('span', null, key));
      signalList.appendChild(label);
    }
    signalSection.appendChild(signalList);
    const applyRow = div('blocks-toolbar');
    applyRow.append(button('应用并绘图', 'btn tiny primary', () => void wbGenerateCompare()));
    signalSection.appendChild(applyRow);
    panel.appendChild(signalSection);

    if (state.wbSignalDock) {
      const inline = $('#wbSignalInline');
      if (inline) inline.appendChild(panel);
    } else {
      const body = $('#wbSignalBody');
      if (body) body.appendChild(panel);
    }
  }

  /** 停靠↔浮出切换：停靠=贴回分析页原位；浮出=移入 floatwin 可拖动。 */
  function setWbSignalDock(docked: boolean): void {
    state.wbSignalDock = docked;
    const win = $('#wbSignalWin');
    const panel = $('#wbSignalPanel');
    const inline = $('#wbSignalInline');
    const body = $('#wbSignalBody');
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
          height: 460,
        };
      }
      win.hidden = false;
      placeFloatWindow(win as HTMLElement, 'wbSignalGeo');
      raiseFloatWindow(win as HTMLElement);
    }
  }

  async function wbGenerateCompare(): Promise<void> {
    const statusEl = $('#wbCompareStatus');
    if (wbCompareStateIds.length < 2) {
      if (statusEl) statusEl.textContent = '对比分析至少需要选择两个状态。';
      return;
    }
    if (!wbCompareSignals.length) {
      if (statusEl) statusEl.textContent = '请至少选择一个共享信号。';
      return;
    }
    if (statusEl) statusEl.textContent = '读取缓存中…';
    let payload: WbComparePayload | null = null;
    try {
      payload = (await api('/api/network/state/compare', {
        method: 'POST',
        body: JSON.stringify({ state_ids: wbCompareStateIds, signals: wbCompareSignals }),
        timeoutMs: 120000,
      })) as WbComparePayload | null;
    } catch (error) {
      if (statusEl) statusEl.textContent = `对比读取失败：${(error as Error)?.message || error}`;
      return;
    }
    if (!payload) return;
    wbComparePayload = payload;
    renderCompareGrid();
    if (statusEl) {
      const entries = payload.states || [];
      const ok = entries.filter((entry) => entry.ok).length;
      const total = entries.length;
      statusEl.textContent =
        ok === total
          ? `已生成 ${total} 个子图 · 共享信号：${(payload.signals || []).join('、')}`
          : `部分状态无有效缓存（${ok}/${total} 可绘）· 请对缺失状态先「预计算选中状态」。`;
    }
  }

  function wbFmtAxis(value: number): string {
    if (!Number.isFinite(value)) return '—';
    const abs = Math.abs(value);
    if (abs !== 0 && (abs >= 1e4 || abs < 1e-3)) return value.toExponential(1);
    return String(Math.round(value * 1000) / 1000);
  }

  /** 多子图网格：每状态一子图，共享 x 范围与信号组，按列数自由排布但坐标对齐。 */
  function renderCompareGrid(): void {
    const grid = $('#wbCompareGrid');
    if (!grid) return;
    const payload = wbComparePayload;
    const entries = (payload?.states || []).filter((entry) => entry.ok);
    const signals =
      payload?.signals && payload.signals.length ? payload.signals : wbCompareSignals.slice();
    // 重建前销毁旧渲染器，避免 PlotKit 异步渲染残留在被替换的 canvas 上。
    for (const renderer of wbActiveRenderers) renderer.destroy();
    wbActiveRenderers = [];
    grid.replaceChildren();
    if (!entries.length) {
      grid.appendChild(div('help', '没有可绘制的缓存。请先对选中状态执行「预计算选中状态」。'));
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
      const card = div('wb-subplot');
      const titleBar = div('wb-subplot-title');
      titleBar.append(
        el('b', null, entry.name || String(entry.state_id || '')),
        el('span', 'wb-subplot-meta', `${(entry.t || []).length} 点`),
      );
      card.appendChild(titleBar);
      const canvasHost = div('wb-subplot-canvas-host');
      card.appendChild(canvasHost);
      grid.appendChild(card);
      const renderer = createChartRenderer(wbCompareRenderer);
      renderer.mount(canvasHost, { height: wbCompareLayout.height, title: entry.name });
      renderer.setSeries({ entry, signals, xMin, xMax, height: wbCompareLayout.height });
      wbActiveRenderers.push(renderer);
    }
  }

  function drawWbSubplot(
    canvas: HTMLCanvasElement,
    entry: WbCompareEntry,
    signals: string[],
    xMin: number,
    xMax: number,
    height?: number,
  ): void {
    const parentWidth = canvas.parentElement?.getBoundingClientRect().width || 320;
    const cssW = Math.max(120, Math.round(parentWidth));
    const cssH = height == null ? wbCompareLayout.height : height;
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = C('#faf8f2');
    ctx.fillRect(0, 0, cssW, cssH);

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
    const toX = (t: number) => left + ((t - xMin) / spanX) * plotW;
    const toY = (v: number) => top + (1 - (v - yMin) / spanY) * plotH;

    ctx.strokeStyle = C('#e6e2d6');
    ctx.lineWidth = 1;
    ctx.fillStyle = C('#969083');
    ctx.font = '10px "Segoe UI","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i += 1) {
      const value = yMin + spanY * (i / 4);
      const y = toY(value);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + plotW, y);
      ctx.stroke();
      ctx.fillText(wbFmtAxis(value), left - 6, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i <= 4; i += 1) {
      const t = xMin + spanX * (i / 4);
      const x = toX(t);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + plotH);
      ctx.stroke();
      ctx.fillText(wbFmtAxis(t), x, top + plotH + 4);
    }
    ctx.strokeStyle = C('#b8b3a4');
    ctx.strokeRect(left, top, plotW, plotH);

    for (const key of signals) {
      const arr = entry.series?.[key] || [];
      const times = entry.t || [];
      const n = Math.min(arr.length, times.length);
      if (!n) continue;
      ctx.strokeStyle = colorForKey(key);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let i = 0; i < n; i += 1) {
        const x = toX(times[i]);
        const y = toY(arr[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  // ===== W3：绘图渲染器抽象（PlotKit 去 iframe 化的内嵌渲染） =====
  // 规格（Q8=A）：PlotKit 保留渲染内核、去掉 iframe 独立外壳，作为 netlab 内嵌绘图模块；
  // netlab 自带简易 chart 保留；建/对比子图时可选绘制器。kind 与规格一致：'simple-chart' / 'plotkit'。
  type WbRendererKind = 'simple-chart' | 'plotkit';

  interface WbChartSeries {
    entry: WbCompareEntry;
    signals: string[];
    xMin?: number;
    xMax?: number;
    height?: number;
  }

  interface WbChartMountOptions {
    height?: number;
    title?: string;
  }

  interface ChartRenderer {
    readonly kind: WbRendererKind;
    mount(el: HTMLElement, opts?: WbChartMountOptions): void;
    setSeries(series: WbChartSeries): void;
    resize(): void;
    destroy(): void;
  }

  // PlotKit render2d ESM 的同源静态路径：plotkit_bridge 把 PlotKit 子应用挂到 /plotkit，
  // 其静态资源在此前缀下（见 netlab/_vendor/plotkit/server/app.py 的 /static 挂载）。
  const PLOTKIT_RENDER2D_URL = '/plotkit/static/render2d.js';

  // PlotKit 渲染内核最小类型面：运行时由 render2d.js 挂到 window.Plot2D，仅用 render 出图。
  interface Plot2DLayer {
    kind?: string;
    subplot?: number;
    data?: Record<string, string>;
    style?: Record<string, string | number>;
    label?: string;
    legend?: boolean;
  }
  interface Plot2DSpec {
    figure?: { title?: string; xlabel?: string; ylabel?: string; subplots?: number; ncols?: number };
    layers?: Plot2DLayer[];
  }
  interface Plot2DSeriesData { values: Float32Array; }
  interface Plot2DStore { get(name: string): Plot2DSeriesData | null; }
  interface Plot2DRenderOptions {
    dpr?: number;
    width?: number;
    height?: number;
    tokens?: Record<string, string>;
  }
  interface Plot2DApi {
    render(canvas: HTMLCanvasElement, spec: Plot2DSpec, store: Plot2DStore, opts?: Plot2DRenderOptions): unknown;
  }
  function readPlot2D(): Plot2DApi | undefined {
    const holder = window as unknown as { Plot2D?: Plot2DApi };
    return holder.Plot2D;
  }

  let plot2dLoading: Promise<Plot2DApi> | null = null;
  async function loadPlot2DApi(): Promise<Plot2DApi> {
    const existing = readPlot2D();
    if (existing) return existing;
    if (!plot2dLoading) {
      const url = PLOTKIT_RENDER2D_URL;
      plot2dLoading = (async () => {
        // 动态加载 PlotKit 渲染 ESM（变量路径 → 不静态打包进 netlab bundle）。
        await import(url);
        const api = readPlot2D();
        if (!api) throw new Error('PlotKit render2d 未注册 window.Plot2D');
        return api;
      })();
    }
    return plot2dLoading;
  }

  /** 简易 canvas 渲染器：封装现有 drawWbSubplot，行为与旧对比图完全一致。 */
  class SimpleCanvasRenderer implements ChartRenderer {
    readonly kind: WbRendererKind = 'simple-chart';
    private host: HTMLElement | null = null;
    private canvas: HTMLCanvasElement | null = null;
    private series: WbChartSeries | null = null;
    private height = wbCompareLayout.height;

    mount(host: HTMLElement, opts?: WbChartMountOptions): void {
      this.host = host;
      this.height = opts?.height ?? wbCompareLayout.height;
      host.replaceChildren();
      const canvas = document.createElement('canvas');
      canvas.className = 'wb-subplot-canvas';
      host.appendChild(canvas);
      this.canvas = canvas;
    }

    setSeries(series: WbChartSeries): void {
      this.series = series;
      this.draw();
    }

    private draw(): void {
      if (!this.canvas || !this.series) return;
      const { entry, signals, xMin, xMax, height } = this.series;
      drawWbSubplot(this.canvas, entry, signals, xMin ?? 0, xMax ?? 1, height ?? this.height);
    }

    resize(): void {
      this.draw();
    }

    destroy(): void {
      this.canvas = null;
      this.series = null;
      this.host = null;
    }
  }

  /** PlotKit 内嵌渲染器：动态 import PlotKit render2d ESM，直接把二维内核画到 netlab 的 canvas，无 iframe。 */
  class PlotKitRenderer implements ChartRenderer {
    readonly kind: WbRendererKind = 'plotkit';
    private host: HTMLElement | null = null;
    private canvas: HTMLCanvasElement | null = null;
    private series: WbChartSeries | null = null;
    private height = wbCompareLayout.height;
    private renderToken = 0;

    mount(host: HTMLElement, opts?: WbChartMountOptions): void {
      this.host = host;
      this.height = opts?.height ?? wbCompareLayout.height;
      host.replaceChildren();
      const canvas = document.createElement('canvas');
      canvas.className = 'wb-subplot-canvas';
      host.appendChild(canvas);
      this.canvas = canvas;
    }

    setSeries(series: WbChartSeries): void {
      this.series = series;
      this.renderToken += 1;
      void this.renderAsync(this.renderToken);
    }

    private async renderAsync(token: number): Promise<void> {
      const canvas = this.canvas;
      const series = this.series;
      if (!canvas || !series) return;
      try {
        const api = await loadPlot2DApi();
        if (token !== this.renderToken || this.canvas !== canvas || !this.series) return;
        this.drawWithPlotKit(api, canvas, series);
        if (this.host) this.host.removeAttribute('data-renderer-fallback');
      } catch (error) {
        // PlotKit 未挂载 / 加载失败：优雅回退到简易渲染，不打断界面、不抛错。
        if (token !== this.renderToken || this.canvas !== canvas || !this.series) return;
        const { entry, signals, xMin, xMax, height } = series;
        drawWbSubplot(canvas, entry, signals, xMin ?? 0, xMax ?? 1, height ?? this.height);
        if (this.host) this.host.setAttribute('data-renderer-fallback', '1');
        console.warn('[W3] PlotKit 渲染不可用，已回退简易渲染：', (error as Error)?.message || error);
      }
    }

    private drawWithPlotKit(api: Plot2DApi, canvas: HTMLCanvasElement, series: WbChartSeries): void {
      const { entry, signals, height } = series;
      const times = entry.t || [];
      if (!times.length) return;
      const hostW = canvas.parentElement?.getBoundingClientRect().width || 320;
      const cssW = Math.max(120, Math.round(hostW));
      const cssH = Math.max(80, Math.round(height ?? this.height));
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;

      // 组装 PlotKit Store：__t 共享时间轴 + 各信号序列转 Float32Array。
      const columns: Record<string, Float32Array> = {};
      columns.__t = Float32Array.from(times);
      for (const key of signals) {
        const arr = entry.series?.[key] || [];
        const n = Math.min(arr.length, times.length);
        const values = new Float32Array(n);
        for (let i = 0; i < n; i += 1) values[i] = arr[i];
        columns[key] = values;
      }
      const store: Plot2DStore = {
        get(name: string): Plot2DSeriesData | null {
          const values = columns[name];
          return values ? { values } : null;
        },
      };

      const layers: Plot2DLayer[] = [];
      for (const key of signals) {
        const values = columns[key];
        if (!values || !values.length) continue;
        layers.push({
          kind: 'line',
          data: { x: '__t', y: key },
          style: { color: colorForKey(key), width: 1.6 },
          label: key,
          legend: true,
        });
      }

      const toks = tokens();
      const themeTokens: Record<string, string> = {
        paper: C('#faf8f2'),
        plot: C('#fbf9f4'),
        text: C('#3a3a33'),
        muted: C('#969083'),
        grid: C('#e6e2d6'),
        accent: String(toks.accent || C('#a8541f')),
      };

      const spec: Plot2DSpec = {
        figure: {
          title: entry.name || String(entry.state_id || ''),
          xlabel: 't',
          ylabel: '',
          subplots: 1,
          ncols: 1,
        },
        layers,
      };
      api.render(canvas, spec, store, {
        dpr: clamp(window.devicePixelRatio || 1, 1, 2.5),
        width: cssW,
        height: cssH,
        tokens: themeTokens,
      });
    }

    resize(): void {
      if (!this.canvas || !this.series) return;
      this.renderToken += 1;
      void this.renderAsync(this.renderToken);
    }

    destroy(): void {
      this.renderToken += 1;
      this.canvas = null;
      this.series = null;
      this.host = null;
    }
  }

  function createChartRenderer(kind: WbRendererKind): ChartRenderer {
    return kind === 'plotkit' ? new PlotKitRenderer() : new SimpleCanvasRenderer();
  }

  async function wbPrecomputeSelected(): Promise<void> {
    if (!wbCompareStateIds.length) {
      toast('请先在信号窗勾选要预计算的状态', 'error');
      return;
    }
    const input = window.prompt('预计算时长（秒，0 < 时长 ≤ 120）', '5');
    if (input === null) return;
    const seconds = Number(input);
    if (!(seconds > 0)) {
      toast('预计算时长需为正数', 'error');
      return;
    }
    for (const id of wbCompareStateIds.slice()) {
      const row = (wbCacheStatus?.states || []).find((item) => String(item.state_id) === id);
      const label = `预计算 ${row?.name || id}…`;
      try {
        const result = (await runPrecomputeWithProgress(
          () =>
            api('/api/network/state/precompute', {
              method: 'POST',
              body: JSON.stringify({ state_id: id, seconds }),
              timeoutMs: 600000,
            }),
          label,
        )) as { ok?: boolean; error?: string; frames?: number } | null;
        if (result && result.ok === false) {
          toast(`${label}失败：${result.error || '未知错误'}`, 'error', 7000);
        }
      } catch (error) {
        toast(`${label}失败：${(error as Error)?.message || error}`, 'error', 7000);
      }
    }
    toast('预计算完成', 'ok', 2600);
    await refreshWbAnalysis();
  }

  async function wbUnifySim(): Promise<void> {
    const rows = wbCacheStatus?.states || [];
    if (rows.length < 2) {
      toast('至少需要两个状态才能统一仿真设置', 'error');
      return;
    }
    const sourceId = wbCompareStateIds[0] || String(rows[0].state_id || '');
    const sourceName = rows.find((row) => String(row.state_id) === String(sourceId))?.name || sourceId;
    if (
      !window.confirm(
        `以「${sourceName}」的仿真设置统一全部状态？\n（各状态缓存将失效，需要重新预计算）`,
      )
    ) {
      return;
    }
    try {
      await api('/api/network/state', {
        method: 'POST',
        body: JSON.stringify({ action: 'unify_sim', state_id: String(sourceId) }),
        timeoutMs: 30000,
      });
      markProjectDirty();
      toast('已统一各状态仿真设置，缓存已失效', 'ok', 3600);
      await refreshWbAnalysis();
    } catch (error) {
      toast((error as Error)?.message || String(error), 'error', 6000);
    }
  }


  async function renderWorkbenchState(): Promise<void> {
    const pane = $('#tab-wb-state');
    if (!pane) return;
    let payload: WbStatesPayload | null = null;
    try {
      payload = (await jsonRequest('/api/network/states', 'GET')) as WbStatesPayload | null;
    } catch (error) {
      toast(`读取状态失败：${(error as Error)?.message || error}`, 'error', 6000);
    }
    if (payload) {
      wbStatesPayload = payload;
      const ids = (payload.states || []).map((item) => item.id);
      if (!wbSelectedId || ids.indexOf(wbSelectedId) < 0) {
        wbSelectedId = payload.base || ids[0] || '';
      }
    }

    const host = div('wb-host');
    const head = div('insp-head');
    const title = div('insp-title');
    title.append(
      el('h2', null, '工作台 · 状态'),
      el('p', null, '参数表格 + 多套参数状态；切换状态即把该状态参数写回当前网络。'),
    );
    head.appendChild(title);
    const dirtyBadge = wbBadge(
      wbDirty ? '未保存到状态' : '已同步到状态',
      wbDirty ? 'badge violet' : 'badge green',
    );
    dirtyBadge.id = 'wbDirtyBadge';
    head.appendChild(dirtyBadge);
    host.appendChild(head);

    const states = wbStatesPayload?.states || [];
    const toolbar = div('blocks-toolbar');
    toolbar.append(
      button('＋ 新建状态', 'btn tiny primary', () => void wbCreateNew()),
      button('更新到此状态', 'btn tiny', () => void wbUpdateCurrent()),
      button('另存为新状态', 'btn tiny', () => void wbCreateNew()),
    );
    host.appendChild(toolbar);

    const listRow = div('wb-state-list');
    if (!states.length) {
      listRow.appendChild(div('help', '暂无状态。点「新建状态」按当前网络参数建立第一个状态。'));
    }
    for (const item of states) {
      const rowEl = div('wb-state-chip' + (item.id === wbSelectedId ? ' active' : ''));
      if (item.base) rowEl.appendChild(wbBadge('基准', 'badge gray'));
      const nameEl = el('button', 'wb-state-name', item.name);
      nameEl.type = 'button';
      nameEl.title = '切换到该状态（把参数写回当前网络）';
      nameEl.addEventListener('click', () => void wbApplyState(item.id));
      rowEl.appendChild(nameEl);
      rowEl.appendChild(button('设基准', 'btn tiny', () => void wbAction('set_base', item.id)));
      rowEl.appendChild(button('重命名', 'btn tiny', () => void wbRename(item.id, item.name)));
      rowEl.appendChild(button('复制', 'btn tiny', () => void wbAction('duplicate', item.id)));
      rowEl.appendChild(button('删除', 'btn tiny', () => void wbDelete(item.id)));
      listRow.appendChild(rowEl);
    }
    host.appendChild(listRow);

    const filter = el('input', 'input') as HTMLInputElement;
    filter.type = 'search';
    filter.placeholder = '检索 节点名 / kind / 参数名…';
    filter.value = wbFilterText;
    const filterRow = div('field-row');
    filterRow.append(el('label', null, '检索'), filter);
    host.appendChild(filterRow);

    const table = div('wb-param-table');
    const rows: Array<{ el: HTMLElement; text: string }> = [];
    const addRow = (objLabel: string, paramLabel: string, control: HTMLElement): void => {
      const row = div('wb-param-row');
      row.append(el('span', 'wb-obj', objLabel), el('span', 'wb-key', paramLabel));
      const valCell = div('wb-val');
      valCell.appendChild(control);
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
        const control = buildParamField(param, value);
        control.addEventListener('change', () => void wbCommitNodeParam(node.id, control, baseParams));
        addRow(`${node.name} · ${node.kind}`, String(param.label || param.key), control);
      }
    }
    for (const edge of scene?.edges || []) {
      const spec = getEdgeSpec(edge.kind);
      const list = spec && Array.isArray(spec.params) ? spec.params : [];
      if (!list.length) continue;
      const baseParams = Object.assign(specDefaults(spec), edge.params || {});
      for (const param of list) {
        const value = param.key in baseParams ? baseParams[param.key] : clone(param.default);
        const control = buildParamField(param, value);
        control.addEventListener('change', () => void wbCommitEdgeParam(edge.id, control, baseParams));
        addRow(`${edge.name} · ${edge.kind}`, String(param.label || param.key), control);
      }
    }
    const config = state.sim?.config || {};
    for (const field of WB_SIM_FIELDS) {
      const paramSpec: ParamSpec = {
        key: field.key,
        type: field.type,
        label: field.label,
        unit: field.unit,
        step: field.step,
        min: field.min,
      };
      const value = field.key in config ? config[field.key] : undefined;
      const control = buildParamField(paramSpec, value);
      control.addEventListener('change', () => void wbCommitSimParam(field.key, control));
      addRow('仿真设置', field.label, control);
    }
    const integValue = String(scene?.integration || 'trapezoidal');
    const integSpec: ParamSpec = {
      key: 'integration',
      type: 'choice',
      label: '积分方法 integration',
      choices: WB_INTEGRATIONS,
    };
    const integControl = buildParamField(integSpec, integValue);
    integControl.addEventListener('change', () => void wbCommitIntegration(integControl));
    addRow('场景', '积分方法 (integration)', integControl);

    const applyFilter = (): void => {
      for (const item of rows) {
        item.el.classList.toggle('hidden', wbFilterText !== '' && item.text.indexOf(wbFilterText) < 0);
      }
    };
    filter.addEventListener('input', () => {
      wbFilterText = filter.value.trim().toLowerCase();
      applyFilter();
    });
    applyFilter();
    host.appendChild(table);

    pane.replaceChildren(host);
  }

  async function wbCreateNew(): Promise<void> {
    const suggested = `状态 ${(wbStatesPayload?.states?.length || 0) + 1}`;
    const name = window.prompt('新状态名称（自动快照当前网络参数）', suggested);
    if (name === null) return;
    await wbAction('create', undefined, { name });
  }

  async function wbRename(id: string, oldName: string): Promise<void> {
    const name = window.prompt('重命名状态', oldName);
    if (name === null) return;
    await wbAction('rename', id, { name });
  }

  async function wbDelete(id: string): Promise<void> {
    if (!window.confirm('删除该状态？（其预计算缓存将在 W2 中一并删除）')) return;
    await wbAction('delete', id);
  }

  async function wbUpdateCurrent(): Promise<void> {
    if (!wbSelectedId) {
      toast('请先选择一个状态', 'error');
      return;
    }
    await wbAction('update', wbSelectedId);
  }

  async function wbAction(
    action: string,
    stateId?: string,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    const body: Record<string, unknown> = Object.assign({ action }, extra || {});
    if (stateId) body.state_id = stateId;
    try {
      const resp = await jsonRequest('/api/network/state', 'POST', body);
      if (!resp) return;
      markProjectDirty();
      await renderWorkbenchState();
    } catch (error) {
      toast((error as Error)?.message || String(error), 'error', 6000);
    }
  }

  async function wbApplyState(id: string): Promise<void> {
    try {
      const resp = (await jsonRequest('/api/network/state', 'POST', {
        action: 'apply',
        state_id: id,
      })) as SnapshotRec | null;
      if (!resp) return;
      applySnapshot(resp);
      wbSelectedId = id;
      wbDirty = false;
      markProjectDirty();
      await renderWorkbenchState();
    } catch (error) {
      toast((error as Error)?.message || String(error), 'error', 6000);
    }
  }

  async function wbCommitNodeParam(
    nodeId: string,
    control: HTMLElement,
    baseParams: Record<string, unknown>,
  ): Promise<void> {
    let values: Record<string, unknown>;
    try {
      values = collectParamValues(control.parentElement || control);
    } catch (error) {
      toast((error as Error).message, 'error', 5000);
      return;
    }
    const merged = Object.assign({}, baseParams, values);
    try {
      const resp = (await jsonRequest(`/api/nodes/${encodeURIComponent(nodeId)}`, 'PATCH', {
        params: merged,
      })) as { node?: NodeItem; sim?: SimRec } | null;
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
      toast((error as Error)?.message || String(error), 'error', 6000);
    }
  }

  async function wbCommitEdgeParam(
    edgeId: string,
    control: HTMLElement,
    baseParams: Record<string, unknown>,
  ): Promise<void> {
    let values: Record<string, unknown>;
    try {
      values = collectParamValues(control.parentElement || control);
    } catch (error) {
      toast((error as Error).message, 'error', 5000);
      return;
    }
    const merged = Object.assign({}, baseParams, values);
    try {
      const resp = (await jsonRequest(`/api/edges/${encodeURIComponent(edgeId)}`, 'PATCH', {
        params: merged,
      })) as { edge?: EdgeItem; sim?: SimRec } | null;
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
      toast((error as Error)?.message || String(error), 'error', 6000);
    }
  }

  async function wbCommitSimParam(key: string, control: HTMLElement): Promise<void> {
    let values: Record<string, unknown>;
    try {
      values = collectParamValues(control.parentElement || control);
    } catch (error) {
      toast((error as Error).message, 'error', 5000);
      return;
    }
    try {
      const resp = (await jsonRequest('/api/config', 'PATCH', {
        [key]: values[key],
      })) as { config?: unknown; sim?: SimRec } | null;
      if (!resp) return;
      if (resp.sim) state.sim = resp.sim;
      wbMarkDirty();
    } catch (error) {
      toast((error as Error)?.message || String(error), 'error', 6000);
    }
  }

  async function wbCommitIntegration(control: HTMLElement): Promise<void> {
    let values: Record<string, unknown>;
    try {
      values = collectParamValues(control.parentElement || control);
    } catch (error) {
      toast((error as Error).message, 'error', 5000);
      return;
    }
    try {
      const resp = (await jsonRequest('/api/scene', 'PATCH', {
        integration: values['integration'],
      })) as SnapshotRec | null;
      if (!resp) return;
      applySnapshot(resp);
      wbMarkDirty();
    } catch (error) {
      toast((error as Error)?.message || String(error), 'error', 6000);
    }
  }

  function renderAnalysisPanel() {
    const pane = ui.analysisPane;
    if (!pane) return;
    const host = div('blocks-host');
    const head = div('insp-head');
    const title = div('insp-title');
    title.append(el('h2', null, '分析（旁路）'), el('p', null, '只读录制数据；结论带来源，不写求解器'));
    head.appendChild(title);
    host.appendChild(head);

    const keys = state.sim?.probe_keys || [];
    const signal = el('select', 'input');
    for (const key of keys) {
      const option = el('option', null, key);
      option.value = key;
      signal.appendChild(option);
    }
    const key = analysisSignalKey();
    if (key) signal.value = key;
    const keyRow = div('field-row');
    keyRow.append(el('label', null, '信号'), signal);
    host.appendChild(keyRow);

    const row = div('blocks-toolbar');
    row.append(
      button('指标', 'btn tiny primary', () => void runAnalysisMetrics()),
      button('频谱', 'btn tiny', () => void runAnalysisSpectrum()),
      button('周期', 'btn tiny', () => void runAnalysisPeriod()),
      button('数学形式', 'btn tiny', () => void runAnalysisMath()),
      button('导出 CSV', 'btn tiny', () => void exportAnalysisCsv()),
    );
    host.appendChild(row);

    const canvas = el('canvas', 'analysis-chart');
    canvas.id = 'analysisChart';
    host.appendChild(canvas);

    const transferRow = div('field-row');
    const inputNode = el('input', 'input');
    inputNode.id = 'analysisInputNode';
    inputNode.placeholder = '输入节点名';
    inputNode.value = state.scene?.nodes?.[0]?.name || '';
    const outputNode = el('input', 'input');
    outputNode.id = 'analysisOutputNode';
    outputNode.placeholder = '输出节点名';
    outputNode.value = state.scene?.nodes?.[state.scene.nodes.length - 1]?.name || '';
    transferRow.append(
      el('label', null, '传递函数'), inputNode, outputNode,
      button('推导', 'btn tiny', () => void runAnalysisTransfer()),
      button('导出 A/B/C/D', 'btn tiny', () => exportTFStateSpace()),
    );
    host.appendChild(transferRow);

    const tfSection = div('insp-section');
    tfSection.appendChild(el('h3', null, '传递函数分析（s 域）'));
    const tfNodes = (state.scene?.nodes || []).filter((node) => node.kind === 'transfer_function');
    const tfNode = el('select', 'input');
    tfNode.id = 'analysisTFNode';
    const tfDirect = el('option', null, '（用表达式）');
    tfDirect.value = '';
    tfNode.appendChild(tfDirect);
    for (const node of tfNodes) {
      const option = el('option', null, node.name);
      option.value = node.name;
      tfNode.appendChild(option);
    }
    const tfExpr = el('input', 'input');
    tfExpr.id = 'analysisTFExpr';
    tfExpr.placeholder = '如 (2*s+1)/(s^2+3*s+2)';
    tfExpr.value = '1/(s+1)';
    tfNode.addEventListener('change', () => {
      tfExpr.disabled = Boolean(tfNode.value);
    });
    const tfRow = div('field-row');
    tfRow.append(el('label', null, '节点 / 表达式'), tfNode, tfExpr);
    tfSection.appendChild(tfRow);

    const tfView = el('select', 'input');
    tfView.id = 'analysisTFView';
    for (const [value, label] of [
      ['bode', 'Bode 图'],
      ['step', '阶跃响应'],
      ['poles', '零极点图'],
    ]) {
      const option = el('option', null, label);
      option.value = value;
      tfView.appendChild(option);
    }
    tfView.addEventListener('change', () => drawAnalysisTF());
    const tfTools = div('field-row');
    tfTools.append(
      button('分析', 'btn tiny primary', () => void runAnalysisTF()),
      button('发送到 PlotKit', 'btn tiny', () => void sendTFToPlotKit()),
      el('label', null, '视图'),
      tfView,
    );
    tfSection.appendChild(tfTools);

    const tfCanvas = el('canvas', 'analysis-chart');
    tfCanvas.id = 'analysisTFChart';
    tfCanvas.style.height = '210px';
    tfSection.appendChild(tfCanvas);

    const tfOut = el('pre', 'analysis-out');
    tfOut.id = 'analysisTFOut';
    tfOut.textContent = state.analysisTF
      ? analysisTFSummary((state.analysisTF as TfDataRec))
      : '选传递函数节点或直接写 s 表达式，点「分析」得到 Bode / 阶跃 / 零极点。';
    tfSection.appendChild(tfOut);
    host.appendChild(tfSection);

    const out = el('pre', 'analysis-out');
    out.id = 'analysisOut';
    out.textContent = state.analysisLast || '选信号后运行指标/频谱/周期/数学形式；传递函数填节点名。';
    host.appendChild(out);

    const perf = div('insp-section');
    perf.appendChild(el('h3', null, '性能与超时（R13）'));
    const timeoutInput = el('input', 'input');
    timeoutInput.type = 'number';
    timeoutInput.id = 'analysisStepTimeout';
    timeoutInput.min = '0';
    timeoutInput.step = '0.5';
    timeoutInput.value = String(state.sim?.config?.step_timeout_ms ?? 0);
    const apply = button('应用单步上限', 'btn tiny', async () => {
      const response = await task(() => jsonRequest('/api/config', 'PATCH', { step_timeout_ms: Number(timeoutInput.value) || 0 }));
      if (response) toast('单步超时已更新（0=关闭）', 'ok', 2400);
    });
    const perfRow = div('field-row');
    perfRow.append(el('label', null, '单步上限 ms'), timeoutInput, apply);
    perf.appendChild(perfRow);
    const profileToggle = el('input');
    profileToggle.type = 'checkbox';
    profileToggle.id = 'analysisProfileEnabled';
    const profileButtons = div('field-row');
    profileButtons.append(
      el('label', null, '计时开关'), profileToggle,
      button('应用', 'btn tiny', async () => {
        const response = await task(() => jsonRequest('/api/profile', 'PATCH', {
          enabled: Boolean(profileToggle.checked),
        }));
        if (response) {
          profileToggle.checked = Boolean(response.enabled);
          toast(response.enabled ? '性能计时已开启' : '性能计时已关闭', 'ok', 2200);
        }
      }),
      button('清空', 'btn tiny', async () => {
        const response = await task(() => jsonRequest('/api/profile', 'PATCH', { reset: true }));
        if (response) toast('性能采样已清空', 'ok', 2000);
      }),
    );
    perf.appendChild(profileButtons);
    const profileOut = el('pre', 'analysis-out');
    profileOut.id = 'analysisProfile';
    profileOut.textContent = '点击刷新读取 /api/profile（默认关闭，开销可忽略）';
    perf.appendChild(
      button('刷新性能', 'btn tiny', async () => {
        const response = await task(() => jsonRequest('/api/profile?top=20', 'GET'), { dirty: false });
        if (!response) return;
        profileToggle.checked = Boolean(response.enabled);
        const rows = (response.entries || []).map(
          (item: PerfRowRec) => `${item.name}\t${item.count} 次\t总 ${item.total_ms} ms\t均 ${item.mean_ms} ms\t峰 ${item.max_ms} ms`,
        );
        profileOut.textContent = [
          `计时：${response.enabled ? '开' : '关'}  样本 ${response.samples}/${response.capacity}`,
          ...(rows.length ? rows : ['（暂无采样，开启计时后运行仿真）']),
        ].join('\n');
      }),
    );
    perf.appendChild(profileOut);
    host.appendChild(perf);

    pane.replaceChildren(host);
    if (state.analysisSpectrum) drawAnalysisSpectrum();
    if (state.analysisTF) drawAnalysisTF();
  }

  // 旧版 UI profile（netlab-ui/1）的默认令牌，与 netlab/core/model/ui_profile.py DEFAULT_TOKENS 对齐。
  // 这套默认值是「暗色蓝图」皮肤，仅应落在旧版画布/面板令牌(--nl-*) 上；绝不能覆盖 theme.tokens.ts 的
  // 双主题语义变量（--paper/--ink/--red…），否则默认工程会把浅/深主题染成低对比霓虹色（P-A5 漏网根因）。
  // 仅当项目显式自定义（值≠默认）时才覆盖对应语义变量，从而保留 R40 的自定义能力。
  const UI_TOKEN_LEGACY_DEFAULTS: Record<string, string> = {
    background: '#0b1220', surface: '#111a2c', panel: '#162238', text: '#e6edf7',
    muted: '#8da2bf', accent: '#4cc9f0', grid: '#22314b', edge: '#7c8db5',
    node: '#1c2b45', danger: '#ff6b6b', success: '#5ee39b',
  };
  function applyUiTokens(tokens: Record<string, string>, mode?: string) {
    const root = document.documentElement;
    const tokenVars = {
      background: '--paper',
      surface: '--paper-2',
      panel: '--paper-3',
      text: '--ink',
      muted: '--muted',
      accent: '--accent',
      grid: '--line',
      edge: '--line-strong',
      node: '--ink-2',
      danger: '--red',
      success: '--green',
    };
    for (const [key, value] of Object.entries(tokens || {})) {
      root.style.setProperty(`--nl-${key}`, value);
      const target = tokenVars[key as keyof typeof tokenVars];
      if (!target) continue;
      const isCustom = String(value).toLowerCase() !== (UI_TOKEN_LEGACY_DEFAULTS[key] || '').toLowerCase();
      if (isCustom) root.style.setProperty(target, value);
    }
    if (tokens?.accent && String(tokens.accent).toLowerCase() !== UI_TOKEN_LEGACY_DEFAULTS.accent) {
      root.style.setProperty('--accent-strong', tokens.accent);
    }
    if (mode) {
      document.body.dataset.canvasMode = mode;
      document.body.classList.toggle('simple-canvas', mode === 'simple');
    }
  }

  async function loadUiProfile() {
    try {
      const response = await jsonRequest('/api/ui', 'GET');
      if (response?.current) applyUiTokens(response.current.tokens, response.current.mode);
    } catch {
      // 旧工程/离线模式没有 UI 配置时保持默认主题
    }
  }

  function openIroColorPopover(anchor: HTMLElement, value: string, onChange: (value: string) => void) {
    document.querySelectorAll('.iro-popover').forEach((node) => node.remove());
    if (!(window as Window & { iro?: IroGlobal }).iro || typeof (window as Window & { iro?: IroGlobal }).iro!.ColorPicker !== 'function') {
      anchor.click();
      return;
    }
    const pop = div('iro-popover');
    const rect = anchor.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 260))}px`;
    pop.style.top = `${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 300))}px`;
    pop.style.zIndex = '20000';
    pop.style.padding = '10px';
    pop.style.borderRadius = '10px';
    pop.style.background = 'var(--panel, #fff)';
    pop.style.boxShadow = '0 12px 36px rgba(0,0,0,.24)';
    pop.style.border = '1px solid var(--line, #ccd4d8)';
    const host = div('iro-host');
    pop.appendChild(host);
    pop.appendChild(button('关闭', 'btn tiny', () => pop.remove()));
    document.body.appendChild(pop);
    const picker = new (window as Window & { iro?: IroGlobal }).iro!.ColorPicker(host, { width: 220, color: value || '#000000' });
    picker.on('color:change', (color: { hexString: string }) => onChange(color.hexString));
    setTimeout(() => {
      const close = (event: MouseEvent) => {
        if (pop.contains((event.target as Node | null)) || event.target === anchor) return;
        pop.remove();
        document.removeEventListener('pointerdown', close);
      };
      document.addEventListener('pointerdown', close);
    }, 0);
  }

  // P-B 元素级外观（Appearance Engine 二期）：只覆盖用户显式设置过的项。
  function appearanceOf(item: { appearance?: AppearanceRec }): AppearanceRec {
    return item.appearance || {};
  }

  // 把覆盖写回内存对象并立即重绘（拖动滑块时实时预览，不发请求）。
  function previewElementAppearance(item: NodeItem | EdgeItem, appearance: AppearanceRec): void {
    item.appearance = { ...appearance };
    requestDraw();
  }

  // 覆盖持久化：轻量 PATCH 到现有节点/连线端点，写回 scene 记录并随工程保存。
  async function persistElementAppearance(kind: 'node' | 'edge', id: string, appearance: AppearanceRec | null): Promise<void> {
    const path = kind === 'node'
      ? `/api/nodes/${encodeURIComponent(id)}`
      : `/api/edges/${encodeURIComponent(id)}`;
    const response = await task(() => jsonRequest(path, 'PATCH', { appearance: appearance ?? {} }));
    if (!response) return;
    renderInspector();
  }

  async function openViewDesigner() {
    try {
      const response = await jsonRequest('/api/ui', 'GET');
      if (!response) return;
      let current = response.current || response.defaults;
      state.ui.cardDetail = current.node?.show_detail !== false;
      state.ui.cardValue = current.node?.show_value !== false;
      const tokenLabels = {
        background: '背景', surface: '表面', panel: '面板', text: '文字', muted: '次要文字',
        accent: '强调色', grid: '网格', edge: '连线', node: '节点', danger: '警示', success: '成功',
      };
      const tokenInputs: Record<string, HTMLInputElement> = {};
      const tokenGrid = div('ui-token-grid');
      for (const [key, value] of Object.entries(current.tokens || {})) {
        const label = div('ui-field');
        label.appendChild(el('span', null, tokenLabels[key as keyof typeof tokenLabels] || key));
        const input = el('input', 'ui-color');
        input.type = 'color';
        input.value = value as string;
        input.dataset.token = key;
        input.addEventListener('input', () => {
          current.tokens[key] = input.value;
          applyUiTokens(current.tokens);
        });
        tokenInputs[key] = input;
        const colorRow = div('ui-color-row');
        colorRow.appendChild(input);
        colorRow.appendChild(button('调色', 'btn tiny', () => openIroColorPopover(input, input.value, (hex: string) => {
          input.value = hex;
          current.tokens[key] = hex;
          applyUiTokens(current.tokens);
        })));
        label.appendChild(colorRow);
        tokenGrid.appendChild(label);
      }
      const modeRow = div('ui-field wide');
      modeRow.appendChild(el('span', null, '画布模式'));
      const modeSelect = el('select');
      for (const [value, label] of [['simple', '简洁画布'], ['professional', '专业画布']]) {
        const option = el('option', null, label);
        option.value = value;
        modeSelect.appendChild(option);
      }
      modeSelect.value = current.mode || 'professional';
      modeSelect.addEventListener('change', () => { current.mode = modeSelect.value; });
      modeRow.appendChild(modeSelect);
      const layoutRows = div('ui-layout-rows');
      for (const [key, value] of Object.entries(current.layout || {})) {
        const label = div('ui-field wide');
        label.appendChild(el('span', null, key));
        const input = el('input');
        input.type = 'range';
        input.min = key === 'font_scale' ? '0.6' : '4';
        input.max = key === 'font_scale' ? '2.0' : '600';
        input.step = key === 'font_scale' ? '0.05' : '1';
        input.value = String(value);
        input.addEventListener('input', () => {
          current.layout[key] = Number(input.value);
        });
        label.appendChild(input);
        layoutRows.appendChild(label);
      }
      const nodeRows = div('ui-layout-rows');
      const addNodeToggle = (key: 'show_detail' | 'show_value', labelText: string) => {
        const label = div('ui-field wide');
        label.appendChild(el('span', null, labelText));
        const input = el('input');
        input.type = 'checkbox';
        input.checked = current.node?.[key] !== false;
        input.addEventListener('change', () => {
          current.node = current.node || {};
          current.node[key] = input.checked;
          if (key === 'show_detail') state.ui.cardDetail = input.checked;
          else state.ui.cardValue = input.checked;
          requestDraw();
        });
        label.appendChild(input);
        nodeRows.appendChild(label);
      };
      addNodeToggle('show_detail', '显示节点类型/端口');
      addNodeToggle('show_value', '显示节点数值');
      // P-B 元素外观：针对画布当前选中的节点或连线设置覆盖（仅设置过的项才覆盖）。
      const appearanceRows = div('ui-layout-rows');
      const appearanceNode = selectedNode();
      const appearanceEdge = appearanceNode ? null : selectedEdge();
      const appearanceItem: NodeItem | EdgeItem | null = appearanceNode || appearanceEdge;
      const appearanceKind: 'node' | 'edge' | null = appearanceNode ? 'node' : appearanceEdge ? 'edge' : null;
      if (!appearanceItem || !appearanceKind) {
        appearanceRows.appendChild(div('help', '先在画布上选中一个节点或连线，再回到这里设置元素外观。'));
      } else {
        const app: AppearanceRec = { ...(appearanceItem.appearance || {}) };
        const commit = (): void => { previewElementAppearance(appearanceItem, app); };
        const persist = (): void => { void persistElementAppearance(appearanceKind, appearanceItem.id, app); };
        const colorField = div('ui-field wide');
        colorField.appendChild(el('span', null, '颜色'));
        const colorInput = el('input');
        colorInput.type = 'color';
        colorInput.value = app.color || tokens().edgeDefault;
        colorInput.addEventListener('input', () => { app.color = colorInput.value; commit(); });
        colorInput.addEventListener('change', persist);
        colorField.appendChild(colorInput);
        appearanceRows.appendChild(colorField);
        const addRange = (key: 'opacity' | 'lineWidth' | 'fontSize', labelText: string, min: number, max: number, step: number, fallback: number): void => {
          const field = div('ui-field wide');
          field.appendChild(el('span', null, labelText));
          const input = el('input');
          input.type = 'range';
          input.min = String(min);
          input.max = String(max);
          input.step = String(step);
          const currentValue = app[key];
          input.value = String(currentValue !== undefined ? currentValue : fallback);
          input.addEventListener('input', () => { app[key] = Number(input.value); commit(); });
          input.addEventListener('change', persist);
          field.appendChild(input);
          appearanceRows.appendChild(field);
        };
        addRange('opacity', '透明度', 0.05, 1, 0.05, 1);
        addRange('lineWidth', '线宽', 0.5, 12, 0.1, appearanceKind === 'node' ? 1 : 1.15);
        addRange('fontSize', '标签字号', 6, 48, 0.5, 12);
        const clearRow = div('modal-actions');
        clearRow.appendChild(button('清除该元素外观覆盖', 'btn tiny', () => {
          appearanceItem.appearance = {};
          requestDraw();
          void persistElementAppearance(appearanceKind, appearanceItem.id, null);
          toast('已清除该元素的外观覆盖', 'ok');
        }));
        appearanceRows.appendChild(clearRow);
      }
      ui.modalCard.replaceChildren();
      ui.modalCard.append(
        el('h3', null, '视图设计'),
        div('help', '只调整声明式 UI 令牌与布局，不执行任意 HTML/CSS/JS。颜色选择器可直接取色，修改会立即预览。'),
        modeRow,
        tokenGrid,
        el('h4', null, '布局'),
        layoutRows,
        el('h4', null, '节点卡片字段'),
        nodeRows,
        el('h4', null, '元素外观（当前选中项）'),
        appearanceRows,
      );
      const actions = div('modal-actions');
      actions.appendChild(button('应用并保存', 'btn primary', async () => {
        const saved = await jsonRequest('/api/ui', 'POST', current);
        if (saved?.current) applyUiTokens(saved.current.tokens, saved.current.mode);
        toast('视图设计已保存', 'success');
        ui.modal.classList.add('hidden');
        ui.modalCard.replaceChildren();
      }));
      actions.appendChild(button('关闭', 'btn', () => {
        ui.modal.classList.add('hidden');
        ui.modalCard.replaceChildren();
      }));
      ui.modalCard.appendChild(actions);
      ui.modal.classList.remove('hidden');
    } catch (error) {
      toast(`视图设计打开失败：${(error as Error).message || error}`, 'error', 6000);
    }
  }

  async function openPluginManager() {
    const render = async () => {
      const response = await jsonRequest('/api/plugins', 'GET');
      if (!response) return;
      const plugins = response.plugins || [];
      const list = div('plugin-list');
      if (!plugins.length) list.appendChild(div('help', '尚未发现插件。把插件包放到 NetlabHome/extensions/plugins/<id>/ 后点「扫描」。'));
      for (const plugin of plugins) {
        const row = div('plugin-row');
        const head = div('plugin-head');
        head.appendChild(el('b', null, `${plugin.name || plugin.id}  `));
        head.appendChild(el('span', 'plugin-version', `v${plugin.version || '?'}`));
        head.appendChild(el('span', `plugin-status ${plugin.status || ''}`, plugin.status || 'unknown'));
        row.appendChild(head);
        row.appendChild(div('help', `${plugin.id} · API ${plugin.plugin_api} · ${plugin.description || '无描述'}`));
        row.appendChild(div('help', `能力：${(plugin.capabilities || []).join(', ') || '—'}`));
        if (plugin.error) row.appendChild(div('plugin-error', plugin.error));
        const actions = div('modal-actions');
        actions.appendChild(button(plugin.status === 'loaded' ? '禁用' : '启用', 'btn tiny', async () => {
          await jsonRequest(`/api/plugins/${encodeURIComponent(plugin.id)}/enable`, 'POST', { enabled: plugin.status !== 'loaded' });
          await render();
        }));
        actions.appendChild(button('重新加载', 'btn tiny', async () => {
          await jsonRequest(`/api/plugins/${encodeURIComponent(plugin.id)}/reload`, 'POST', {});
          await render();
        }));
        row.appendChild(actions);
        list.appendChild(row);
      }
      ui.modalCard.replaceChildren();
      ui.modalCard.append(
        el('h3', null, '插件管理'),
        div('help', '插件是受信任的进程内 Python 包，不是沙箱。工程只引用插件 id/version；缺包时工程会降级打开。'),
        list,
      );
      const footer = div('modal-actions');
      footer.appendChild(button('扫描插件目录', 'btn', async () => {
        await jsonRequest('/api/plugins/scan', 'POST', {});
        await render();
      }));
      footer.appendChild(button('关闭', 'btn', () => {
        ui.modal.classList.add('hidden');
        ui.modalCard.replaceChildren();
      }));
      ui.modalCard.appendChild(footer);
      ui.modal.classList.remove('hidden');
    };
    try {
      await render();
    } catch (error) {
      toast(`插件管理打开失败：${(error as Error).message || error}`, 'error', 6000);
    }
  }

  async function compareBuiltinBlock(spec: BlockItem) {
    try {
      const result = await jsonRequest(
        `/api/blocks/${encodeURIComponent((spec.id as string | number | boolean))}/compare`,
        'POST',
        { duration: 0.02, dt: 0.001 },
      );
      if (!result.ok) {
        toast(`对比失败：${result.reason || '未知原因'}`, 'error', 6000);
        return;
      }
      const summary = [
        `模块：${result.name || spec.name || spec.id}`,
        `输出：${result.output}.${result.field}`,
        `时长/步长：${result.duration}s / ${result.dt}s（${result.steps} 步）`,
        `行为峰值：${Math.max(...result.behavior).toFixed(6)}`,
        `结构峰值：${Math.max(...result.structural).toFixed(6)}`,
        `最大绝对差：${Number(result.max_abs_diff).toFixed(6)}`,
        `RMS 差：${Number(result.rms_diff).toFixed(6)}`,
      ].join('\n');
      const detail = [
        `行为：${result.behavior.join(', ')}`,
        `结构：${result.structural.join(', ')}`,
      ].join('\n');
      ui.modalCard.replaceChildren();
      ui.modalCard.append(
        el('h3', null, '内置块：行为 / 结构对比'),
        div('help', summary),
        el('pre', 'compare-pre', detail),
        div('help', result.note || ''),
      );
      const close = button('关闭', 'btn', () => {
        ui.modal.classList.add('hidden');
        ui.modalCard.replaceChildren();
      });
      const actions = div('modal-actions');
      actions.appendChild(close);
      ui.modalCard.appendChild(actions);
      ui.modal.classList.remove('hidden');
      ui.modal.onclick = (event: MouseEvent) => {
        if (event.target === ui.modal) close.click();
      };
    } catch (error) {
      toast(`对比失败：${(error as Error).message || error}`, 'error', 6000);
    }
  }

  function renderBlocksPanel() {
    const pane = ui.blocksPane;
    if (!pane) return;
    const host = div('blocks-host');
    const head = div('insp-head');
    const title = div('insp-title');
    title.append(
      el('h2', null, '模块库'),
      el('p', null, state.blocksLibrary ? `库目录：${state.blocksLibrary}` : '库目录：默认 library/'),
    );
    head.appendChild(title);
    host.appendChild(head);

    const toolbar = div('blocks-toolbar');
    const structuralRow = el('label', 'switch-row');
    structuralRow.appendChild(el('span', null, '封装为结构模型（可看内部）'));
    const structuralInput = el('input');
    structuralInput.type = 'checkbox';
    structuralInput.checked = Boolean(state.blocksStructural);
    structuralInput.addEventListener('change', () => {
      state.blocksStructural = Boolean(structuralInput.checked);
    });
    structuralRow.appendChild(structuralInput);
    toolbar.append(
      button('刷新', 'btn tiny', () => void refreshBlocks()),
      button('导入 .block', 'btn tiny', () => void importBlockFile()),
      button('封装选中', 'btn tiny primary', () => void encapsulateSelection()),
      button('另存为副本', 'btn tiny', () => void saveCurrentAsBlockCopy()),
      button('插件管理', 'btn tiny', () => void openPluginManager()),
      button('视图设计', 'btn tiny', () => void openViewDesigner()),
    );
    const closeBtn = button('关闭内部网络', 'btn tiny', () => void closeInternalNetwork());
    closeBtn.disabled = !String(state.currentNetwork?.name || '').startsWith('模块 ');
    closeBtn.title = closeBtn.disabled ? '当前不是模块内部临时网络' : '删除当前临时网络并返回上一层';
    toolbar.appendChild(closeBtn);
    if (state.sim?.degraded?.read_only) {
      toolbar.appendChild(button('补回后重试', 'btn tiny', () => void retryDegradedProject()));
    }
    host.appendChild(structuralRow);
    host.appendChild(toolbar);

    if (!state.blocks.length) {
      host.appendChild(
        div('help', '库中没有模块：选中画布节点后点「封装选中」，或用「导入 .block」载入已有模块。'),
      );
      pane.replaceChildren(host);
      return;
    }

    const list = div('block-list');
    for (const spec of state.blocks) {
      const item = div('block-item');
      const info = div('block-info');
      const name = el('strong', null, spec.name || spec.id);
      const badges = div('block-badges');
      for (const badge of blockBadges(((spec)))) badges.appendChild(el('span', 'badge gray', badge));
      info.append(name, badges);
      const ports = el('small', 'block-ports', describeBlockPorts(((spec))));
      info.appendChild(ports);
      item.draggable = true;
      item.addEventListener('dragstart', (event: MouseEvent) => {
        if (!(event as Event as DragEvent).dataTransfer) return;
        ((event as Event as DragEvent).dataTransfer as DataTransfer).setData('text/netlab-block', spec.id);
        ((event as Event as DragEvent).dataTransfer as DataTransfer).effectAllowed = 'copy';
      });
      const actions = div('block-actions');
      actions.appendChild(button('实例化', 'btn tiny primary', () => void instantiateBlockFromLibrary(spec.id)));
      const openBtn = button('打开内部', 'btn tiny', () => openModuleInternal(spec.id));
      openBtn.title = (spec.model || 'behavioral') !== 'structural'
        ? '打开内部浮窗（行为模型只看得到端口）'
        : '在内部浮窗中预览模块结构';
      actions.appendChild(openBtn);
      if (spec.builtin) {
        const compareBtn = button('行为/结构对比', 'btn tiny', () => void compareBuiltinBlock(((spec))));
        compareBtn.title = '运行行为快速模型与 structural 内部场景，对比同一输入的输出';
        actions.appendChild(compareBtn);
      }
      const renameBtn = button('改名', 'btn tiny', () => void renameLibraryBlock(((spec))));
      renameBtn.title = spec.builtin ? '内置模块只读，请先另存为副本' : '改模块名字（文件名同步改，引用不变）';
      renameBtn.disabled = Boolean(spec.builtin);
      actions.appendChild(renameBtn);
      const deleteBtn = button('删除', 'btn tiny danger', () => void deleteLibraryBlock(((spec))));
      deleteBtn.disabled = Boolean(spec.builtin);
      deleteBtn.title = spec.builtin ? '内置模块只读，不能删除' : '从库里删掉这个模块文件';
      actions.appendChild(deleteBtn);
      item.append(info, actions);
      list.appendChild(item);
    }
    host.appendChild(list);
    host.appendChild(
      div('help', '模块文件位于 library/blocks/<模块名>.block：一个模块一个文件，文件名就是模块名；库中只保留最新版。'),
    );
    pane.replaceChildren(host);
  }

  function findBlockNameClash(name: string, ignoreId: string | null) {
    const wanted = String(name || '').trim().toLowerCase();
    if (!wanted) return null;
    return (
      state.blocks.find(
        (item) =>
          item.id !== ignoreId && String(item.name || '').trim().toLowerCase() === wanted,
      ) || null
    );
  }

  async function renameLibraryBlock(spec: BlockItem) {
    const proposed = window.prompt(`模块新名字（当前：${spec.name || spec.id}）`, (spec.name || '') as string);
    if (proposed === null) return;
    const name = proposed.trim();
    if (!name) {
      toast('模块名不能为空', 'error');
      return;
    }
    if (name === spec.name) return;
    const clash = findBlockNameClash(name, (spec.id as string | null));
    if (clash) {
      toast(`模块名已存在：「${clash.name}」，请换一个名字`, 'error', 3600);
      return;
    }
    const run = async (force: boolean) => {
      const body = await jsonRequest(
        `/api/blocks/${encodeURIComponent((spec.id as string | number | boolean))}/rename`,
        'POST',
        { name, force },
      );
      return body;
    };
    try {
      try {
        await run(false);
      } catch (error) {
        const message = (error as Error)?.message || String(error);
        if (!/引用|存在/.test(message)) throw error;
        if (!window.confirm(`${message}\n\n仍然改名？`)) return;
        await run(true);
      }
      await refreshBlocks();
      toast(`已改名为「${name}」`, 'ok');
    } catch (error) {
      toast(`改名失败：${(error as Error)?.message || error}`, 'error', 4000);
    }
  }

  async function deleteLibraryBlock(spec: BlockItem) {
    if (
      !window.confirm(
        `删除模块「${spec.name || spec.id}」？\n库里对应的 .block 文件会被删除，已经放进画布的实例会变成缺失状态。`,
      )
    ) {
      return;
    }
    const run = async (force: boolean) => {
      const body = await jsonRequest(
        `/api/blocks/${encodeURIComponent((spec.id as string | number | boolean))}/delete`,
        'POST',
        { version: spec.version, force },
      );
      return body;
    };
    try {
      try {
        await run(false);
      } catch (error) {
        const message = (error as Error)?.message || String(error);
        if (!/引用|存在/.test(message)) throw error;
        if (!window.confirm(`${message}\n\n仍然删除？`)) return;
        await run(true);
      }
      await refreshBlocks();
      toast(`已删除模块「${spec.name || spec.id}」`, 'ok');
    } catch (error) {
      toast(`删除失败：${(error as Error)?.message || error}`, 'error', 4000);
    }
  }

  function initStatusToggles() {
    const bind = (id: string, key: string, label?: (active: boolean) => string) => {
      const node = $(`#${id}`);
      if (!node) return;
      const sync = () => {
        const active = Boolean(state.ui?.[key]);
        node.classList.toggle('active', active);
        if (label) node.textContent = label(active);
      };
      node.addEventListener('click', () => {
        state.ui[key] = !state.ui[key];
        sync();
        markProjectDirty();
        requestDraw();
        toast(`${node.textContent}：${state.ui[key] ? '开' : '关'}`, 'info', 1600);
      });
      sync();
    };
    bind('stGrid', 'showGrid');
    bind('stSnap', 'snap');
    bind('stSnapMark', 'snapMarkers');
    bind('stOrtho', 'circuitOrthogonal');
    bind('stDrawing', 'drawingMode');
    const styleBtn = $('#stNodeStyle');
    if (styleBtn) {
      const labels = { circle: '节点·圆', dot: '节点·点', box: '节点·框' };
      const order = ['circle', 'dot', 'box'];
      const sync = () => { styleBtn.textContent = labels[(state.ui.nodeStyle || 'circle') as keyof typeof labels]; };
      styleBtn.addEventListener('click', () => {
        const index = order.indexOf(state.ui.nodeStyle || 'circle');
        state.ui.nodeStyle = order[(index + 1) % order.length];
        sync();
        markProjectDirty();
        requestDraw();
        toast(`节点样式：${styleBtn.textContent}`, 'info', 1800);
      });
      sync();
    }
  }

  function applyPanelHidden(hidden: boolean, persist = true) {
    ui.main.classList.toggle('panel-hidden', hidden);
    ui.panel?.classList.toggle('collapsed', hidden);
    if (ui.panelHanger) {
      ui.panelHanger.textContent = hidden ? '‹' : '›';
      ui.panelHanger.title = hidden ? '展开右侧面板' : '收起右侧面板';
      ui.panelHanger.setAttribute('aria-expanded', hidden ? 'false' : 'true');
    }
    if (persist) {
      try {
        localStorage.setItem(SHELL_KEYS.panelCollapsed, hidden ? '1' : '0');
      } catch (error) {
        // 隐私模式忽略
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
    applyPanelHidden(!ui.main.classList.contains('panel-hidden'));
  }

  function initPanelChrome() {
    let hidden = false;
    let width = 0;
    try {
      hidden = localStorage.getItem(SHELL_KEYS.panelCollapsed) === '1';
      width = Number(localStorage.getItem(SHELL_KEYS.panelWidth)) || 0;
    } catch (error) {
      hidden = false;
    }
    if (width >= 260 && width <= 720) ui.main.style.setProperty('--panel-w', `${Math.round(width)}px`);
    applyPanelHidden(hidden, false);
    ui.panelHanger?.addEventListener('click', togglePanel);

    const handle = ui.panelResize;
    if (!handle) return;
    let dragging = false;
    let startX = 0;
    let startWidth = 0;
    const panelVar = () => '--panel-w';
    const currentWidth = () => {
      const rect = ui.panel?.getBoundingClientRect();
      if (rect && rect.width > 0) return rect.width;
      const value = parseFloat(getComputedStyle(ui.main).getPropertyValue(panelVar()));
      return Number.isFinite(value) && value > 0 ? value : 388;
    };
    handle.addEventListener('pointerdown', (event: PointerEvent) => {
      if (ui.main.classList.contains('panel-hidden')) return;
      dragging = true;
      startX = event.clientX;
      startWidth = currentWidth();
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add('panel-dragging');
      event.preventDefault();
    });
    handle.addEventListener('pointermove', (event: PointerEvent) => {
      if (!dragging) return;
      const next = clamp(Math.round(startWidth - (event.clientX - startX)), 260, 720);
      ui.main.style.setProperty(panelVar(), `${next}px`);
      ui.main.style.setProperty('--panel-edge', `${next}px`);
    });
    const finish = (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('panel-dragging');
      try {
        localStorage.setItem(SHELL_KEYS.panelWidth, String(Math.round(currentWidth())));
      } catch (error) {
        // 忽略
      }
      syncChromeEdges();
      resizeGraph();
      resizeChart();
      resizePhase();
      if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  }

  function initShell() {
    initMenus();
    initNetworkSidebar();
    initPanelChrome();
    updateInfoBar();
    requestAnimationFrame(syncChromeEdges);
  }

  function bindStaticEvents() {
    ui.exitBtn?.addEventListener('click', () => void shutdownApp());
    ui.runBtn.addEventListener('click', () => void control('toggle'));
    $('#btnStep').addEventListener('click', () => void control('step', 1));
    $('#btnReset').addEventListener('click', () => void control('reset'));

    $('#btnAdd').addEventListener('click', () => {
      const place = centerPlacement();
      openAddMenu(16, 88, place.x, place.y);
    });
    $('#btnLayout').addEventListener('click', () => void autoLayout());
    $('#btnFit').addEventListener('click', () => fitView(true));
    $('#btnZoomIn').addEventListener('click', () => zoomCenter(1.2));
    $('#btnZoomOut').addEventListener('click', () => zoomCenter(1 / 1.2));
    $('#btnClear').addEventListener('click', () => void clearScene());

    // 顶栏不再放“帮助”按钮：帮助菜单与 H/F1 快捷键仍调用 showHelp()。

    if (ui.workspaceSwitch) {
      $$('button[data-workspace]', ui.workspaceSwitch).forEach((buttonNode) => {
        buttonNode.addEventListener('click', () => void switchWorkspace((buttonNode.dataset.workspace as string)));
      });
    }
    setWorkspaceButtons();

    $$('.panel-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const group = tab.dataset.group;
        switchTab(group === 'inspect' ? 'inspect' : (defaultTabForGroup((group as string)) as string));
      });
    });
    $$('#panel .group-subnav').forEach((nav) => {
      nav.addEventListener('click', (event: MouseEvent) => {
        const target = (event.target! as Element).closest('button');
        if (!target) return;
        if (target.dataset.fnrole) {
          state.fnRole = target.dataset.fnrole;
          state.specKind = '';
          switchTab(target.dataset.fnrole === 'edge' ? 'edge-fn' : 'node-fn');
        } else if (target.dataset.sub) {
          switchTab(target.dataset.sub);
        }
      });
    });
    setPanelGroup('inspect');
    setGroupSub('modules', 'blocks');
    setGroupSub('analysis', 'chart');
    setGroupSub('workbench', 'wb-analysis');

    if (ui.vectorNode) {
      ui.vectorNode.addEventListener('change', () => {
        state.phaseNode = ui.vectorNode.value;
        state.phaseIndex = null;
        stopPhasePlay();
        drawPhase();
      });
    }
    if (ui.vectorTrail) {
      ui.vectorTrail.addEventListener('change', () => {
        const value = Number(ui.vectorTrail.value);
        if (!Number.isFinite(value)) return;
        state.phaseTrail = clamp(Math.round(value), 20, 1200);
        ui.vectorTrail.value = String(state.phaseTrail);
        drawPhase();
      });
    }
    if (ui.phasePlay) {
      ui.phasePlay.addEventListener('click', togglePhasePlay);
    }
    if (ui.phaseStep) {
      ui.phaseStep.addEventListener('click', () => {
        const total = phaseFrameCount();
        if (!total) return;
        stopPhasePlay();
        const current = state.phaseIndex == null ? total - 1 : state.phaseIndex;
        setPhaseIndex(current + 1 >= total ? 0 : current + 1);
      });
    }
    if (ui.phaseLoop) {
      ui.phaseLoop.addEventListener('change', () => {
        state.phaseLoop = Boolean(ui.phaseLoop.checked);
      });
    }
    if (ui.phaseExport) {
      ui.phaseExport.addEventListener('click', () => {
        const node = (state.scene?.nodes || []).find((item) => item.name === state.phaseNode);
        const stateKeys = node ? phaseStateKeys(node) : [];
        const keys = stateKeys.length >= 2
          ? stateKeys.slice(0, 2)
          : (node ? [`n:${node.name}:x`, `n:${node.name}:y`] : null);
        void exportAnalysisCsv((keys as null | undefined), 'phase');
      });
    }
    if (ui.phasePlotkit) {
      ui.phasePlotkit.addEventListener('click', () => void sendPhaseToPlotKit());
    }
    if (ui.phaseFrame) {
      ui.phaseFrame.addEventListener('input', () => {
        stopPhasePlay();
        setPhaseIndex(Number(ui.phaseFrame.value));
      });
    }

    ui.chartWindow.addEventListener('change', () => {
      const value = Number(ui.chartWindow.value);
      if (!Number.isFinite(value) || value < 0.1 || value > 120) {
        toast('时间窗必须在 0.1–120 s 之间', 'error', 3000);
        ui.chartWindow.value = String(state.chart.window);
        return;
      }
      state.chart.window = value;
      scheduleChartDraw();
    });

    ui.signalSearch.addEventListener('input', () => {
      state.chart.filter = ui.signalSearch.value;
      renderSignalList();
    });

    ui.btnClearChart.addEventListener('click', () => {
      state.frames = [];
      state.chart.hover = null;
      stopReplayTimer();
      state.replay.active = false;
      state.replay.index = 0;
      state.replay.recordingRevision = null;
      updateReplayUI();
      drawChart();
      toast('轨迹已清空，新的采样会继续绘制', 'ok', 2000);
    });

    if (ui.chartTimeline) {
      ui.chartTimeline.addEventListener('input', () => {
        enterReplay(Number(ui.chartTimeline.value));
      });
    }
    if (ui.topTimeline) {
      ui.topTimeline.addEventListener('input', () => {
        enterReplay(Number(ui.topTimeline.value));
      });
      ui.topTimeline.addEventListener('dblclick', () => {
        leaveReplay();
        toast('已回到实时录制', 'info', 1600);
      });
    }
    if (ui.btnReplay) {
      ui.btnReplay.addEventListener('click', () => toggleReplayPlayback());
    }
    try {
      const storedSpeed = Number(localStorage.getItem('netlab.replaySpeed'));
      if (Number.isFinite(storedSpeed) && storedSpeed >= 5 && storedSpeed <= 240) {
        state.replay.speed = storedSpeed;
      }
    } catch (error) { /* 存储不可用时用默认速度 */ }
    if (ui.replaySpeed) {
      ui.replaySpeed.addEventListener('input', () => {
        state.replay.speed = clamp(Number(ui.replaySpeed.value) || 60, 5, 240);
        try {
          localStorage.setItem('netlab.replaySpeed', String(state.replay.speed));
        } catch (error) { /* 忽略 */ }
        updateReplayUI();
      });
    }
    if (ui.btnPrecompute) {
      ui.btnPrecompute.addEventListener('click', async () => {
        const raw = window.prompt('预计算 0→T 的时长（秒，最大 120）', '5');
        if (raw === null) return;
        const duration = Number(raw);
        if (!Number.isFinite(duration) || duration <= 0 || duration > 120) {
          toast('预计算时长必须在 (0, 120] s 内', 'error', 3000);
          return;
        }
        try {
          toast(`正在预计算 0→${duration} s…`, 'info', 2400);
          const response = await api('/api/solve-window', {
            method: 'POST',
            body: JSON.stringify({ duration }),
            timeoutMs: 180000,
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
          if (result.error) toast(`预计算中断：${result.error}`, 'error', 6000);
          else toast(`预计算完成：${result.steps} 步 / ${result.frames} 帧`, 'ok', 3000);
        } catch (error) {
          toast(`预计算失败：${(error as Error).message}`, 'error', 6000);
        }
      });
    }
    if (ui.btnLive) {
      ui.btnLive.addEventListener('click', () => {
        leaveReplay();
        toast('已回到实时录制', 'info', 1800);
      });
    }
    if (ui.btnResolve) {
      ui.btnResolve.addEventListener('click', async () => {
        if (!recordingStale()) return;
        leaveReplay();
        await control('reset');
        await control('run', ((undefined)), { skipWarn: true });
        toast('场景已修改，旧记录清除并重新求解', 'ok', 2400);
      });
    }
    if (ui.chartLoop) {
      ui.chartLoop.addEventListener('change', () => {
        state.chart.loop = Boolean(ui.chartLoop.checked);
        toast(`循环回放：${state.chart.loop ? '开' : '关'}`, 'info', 1600);
      });
    }
    updateReplayUI();

    chartCanvas.addEventListener('pointermove', (event: PointerEvent) => {
      const rect = chartCanvas.getBoundingClientRect();
      state.chart.hover = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      scheduleChartDraw();
    });
    chartCanvas.addEventListener('pointerleave', () => {
      state.chart.hover = null;
      scheduleChartDraw();
    });

    document.addEventListener('pointerdown', (event: PointerEvent) => {
      if ((event.target! as Element).closest('.popup')) return;
      closePopups();
    }, true);

    document.addEventListener('keydown', (event: KeyboardEvent) => {
      if (state.shuttingDown) return;
      if ((event as Event as KeyboardEvent).key === 'Escape') {
        closePopups();
        if (state.wireTool) cancelWireTool();
        if (!ui.modal.classList.contains('hidden')) closeModal();
        return;
      }
      if (isFormTarget(event.target)) return;
      if (event.ctrlKey || event.metaKey) {
        const key = (event as Event as KeyboardEvent).key.toLowerCase();
        if (key === 's' && event.altKey) {
          event.preventDefault();
          void saveProject(true);
        } else if (key === 's') {
          event.preventDefault();
          void saveProject(false);
        } else if (key === 'e' && event.shiftKey) {
          event.preventDefault();
          if (state.workspace === 'network') void exportScene();
          else toast('有限元场不导出 JSON；可在「场」面板重建参数', 'info', 3000);
        } else if (key === 'z') {
          event.preventDefault();
          if (event.shiftKey) void redo();
          else void undo();
        } else if (key === 'y') {
          event.preventDefault();
          void redo();
        } else if (key === 'c') {
          event.preventDefault();
          copySelection(false);
        } else if (key === 'x') {
          event.preventDefault();
          copySelection(true);
        } else if (key === 'v') {
          event.preventDefault();
          void pasteClipboard();
        } else if (key === 'a') {
          event.preventDefault();
          selectAll();
        }
        return;
      }
      if ((event as Event as KeyboardEvent).key === ' ') {
        event.preventDefault();
        void control('toggle');
      } else if ((event as Event as KeyboardEvent).key === 's' || (event as Event as KeyboardEvent).key === 'S') {
        event.preventDefault();
        void control('step', 1);
      } else if ((event as Event as KeyboardEvent).key === 'r' || (event as Event as KeyboardEvent).key === 'R') {
        event.preventDefault();
        void control('reset');
      } else if (state.workspace === 'network' && ((event as Event as KeyboardEvent).key === 'f' || (event as Event as KeyboardEvent).key === 'F')) {
        event.preventDefault();
        fitView(true);
      } else if (state.workspace === 'network' && ((event as Event as KeyboardEvent).key === 'a' || (event as Event as KeyboardEvent).key === 'A')) {
        event.preventDefault();
        const place = centerPlacement();
        openAddMenu(state.canvasSize.w / 2, state.canvasSize.h / 2, place.x, place.y);
      } else if (state.workspace === 'network' && ((event as Event as KeyboardEvent).key === 'Delete' || (event as Event as KeyboardEvent).key === 'Backspace')) {
        event.preventDefault();
        void deleteSelection();
      } else if (state.workspace === 'network' && ((event as Event as KeyboardEvent).key === '+' || (event as Event as KeyboardEvent).key === '=')) {
        event.preventDefault();
        zoomCenter(1.2);
      } else if (state.workspace === 'network' && ((event as Event as KeyboardEvent).key === '-' || (event as Event as KeyboardEvent).key === '_')) {
        event.preventDefault();
        zoomCenter(1 / 1.2);
      } else if ((event as Event as KeyboardEvent).key === '?') {
        event.preventDefault();
        showHelp();
      }
    });

    canvas.tabIndex = 0;
    canvas.addEventListener('focus', () => {
      // 让画布获得键盘焦点；输入控件仍优先。
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
      if (state.workspace === 'network') resizeGraph();
      resizeChart();
      resizePhase();
      resizeInstrument();
    });
    observer.observe(stage);
    const chartWrap = $('.chart-wrap');
    if (chartWrap) observer.observe(chartWrap);
    const phaseWrap = $('.phase-wrap');
    if (phaseWrap) observer.observe(phaseWrap);
    $$('.scope-wrap').forEach((wrap) => observer.observe(wrap));
    window.addEventListener('resize', () => {
      syncChromeEdges();
      resizeGraph();
      resizeChart();
      resizePhase();
      resizeInstrument();
    });
    setInterval(() => {
      if (!ui.sessionClock) return;
      const now = new Date();
      ui.sessionClock.textContent = `LOCAL SESSION · ${now.toLocaleTimeString('zh-CN', { hour12: false })}`;
    }, 1000);

    requestAnimationFrame(animationLoop);

    try {
      const [catalog, snapshot] = await Promise.all([api('/api/catalog'), api('/api/state')]);
      state.catalog = catalog.catalog;
      state.templates = catalog.templates || [];
      state.mode = snapshot.scene?.mode || 'signal';
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
      }, 8000);
      state.booted = true;
      await maybeOfferRecovery();
      await ensureStoppedOnBoot();
      // 启动引导：每次启动都无条件显示开始页（不再受任何「不再显示」偏好影响）
      showGuide();
      if (!state.sim?.running) {
        toast('画布已就绪：空格运行，双击节点编辑，从右侧端口拖出连线', 'info', 4200);
      }
    } catch (error) {
      showBanner(`无法连接后端：${(error as Error).message}`);
      toast(`初始化失败：${(error as Error).message}`, 'error', 9000);
      renderScenePanel();
      renderInspector();
    }
  }

  // 只读调试钩子：给 CDP/自动化验证计算屏幕坐标用，不改变业务行为。
  (window as Window & { __netlabDebug?: unknown }).__netlabDebug = {
    state,
    nodeRect,
    edgePathPoints,
    elementPins,
    devicePins,
    devicePinScreen,
    waypointHitAt,
    worldToScreen,
    screenToWorld,
  };

  /* ======================================================================
   * 8.7 R30：外观令牌 / 设置窗与浮窗通用层 / 启动引导 / 文档中心 / 参数帮助卡
   * ==================================================================== */

  // P-A1：外观令牌唯一来源见 frontend/theme.tokens.ts（画布调色板旧值快照 CANVAS_LIGHT/CANVAS_DARK）。
  // 此处仅引用同源数据，不再重复字面量；C() 行为不变。

  const ACCENT_SWATCHES = ['', '#9b7247', '#565c46', '#3f5d6b', '#8a4234', '#6b6257', '#7a5a33', '#5f7a52'];
  const PREF_CACHE_KEY = 'netlab.ui.prefs';

  /* ---- P-A4 外观面板：默认值、档位枚举与运行期覆盖层 ----
   * 单一来源原则：默认令牌仍只来自 theme.tokens.ts；本层仅保存「用户可调项」的偏好，
   * 由 applyAppearance() 计算出一张精简的运行期覆盖（只含与默认不同的键），
   * tokens() 返回 {...基础令牌, ...运行期覆盖}，从而同一份覆盖同时驱动 DOM(--accent…) 与画布取色。 */
  interface AppearanceDefaults {
    theme: string; motion: string; perf: string; accent: string; accentDark: string;
    fontScale: number; density: string; surfaceTone: number; radius: number;
    lineWidth: number; chartPalette: string;
  }
  const PREF_DEFAULTS: AppearanceDefaults = {
    theme: 'system', motion: 'low', perf: 'perf', accent: '', accentDark: '',
    fontScale: 12, density: 'standard', surfaceTone: 0, radius: 0,
    lineWidth: 1, chartPalette: 'theme',
  };
  const FONT_SCALES = [11, 12, 13, 14];
  const RADIUS_STEPS = [0, 2, 4];
  const LINE_STEPS = [1, 1.5];
  const CHART_MODES = ['theme', 'high-contrast', 'colorblind'];

  // 运行期令牌覆盖表：默认空（=与静态令牌完全一致）；applyAppearance 按需填充。

  // 当前主题实际生效的强调色（浅色读 accent，深色读 accentDark，各自记忆）。
  function activeAccent(theme: string, pal: Record<string, string>): string {
    const pref = state.prefs || {};
    const custom = theme === 'dark' ? pref.accentDark : pref.accent;
    return (typeof custom === 'string' && custom) ? custom : pal.accent;
  }

  // 计算运行期覆盖：只记录与默认不同的键（强调色 / 明暗强度微调）。
  function computeRuntimeOverride(theme: 'light' | 'dark'): Record<string, string> {
    const base = THEME_TOKENS[theme] as Record<string, string>;
    const pref = state.prefs || {};
    const override: Record<string, string> = {};
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
        for (const key of ['paper', 'panel', 'surface', 'paper3']) {
          if (base[key]) override[key] = mixHex(base[key], anchor, amount);
        }
      }
    }
    return override;
  }


  function applyAppearance() {
    const root = document.documentElement;
    const pref = state.prefs || {};
    const theme = resolveTheme(pref.theme || 'system');
    root.dataset.theme = theme;
    root.dataset.motion = pref.motion || 'low';
    root.dataset.perf = pref.perf || 'perf';

    // 3) 字号档 / 4) 密度 / 6b) 线条 / 9) 画布配色 → data-* 钩子（CSS 侧 var(--ui-font-scale) / var(--ui-line) / 密度规则）
    const fontScale = FONT_SCALES.includes(Number(pref.fontScale)) ? Number(pref.fontScale) : PREF_DEFAULTS.fontScale;
    root.dataset.font = String(fontScale);
    const density = ['compact', 'standard', 'loose'].includes(String(pref.density)) ? String(pref.density) : PREF_DEFAULTS.density;
    root.dataset.density = density;
    const lineWidth = LINE_STEPS.includes(Number(pref.lineWidth)) ? Number(pref.lineWidth) : PREF_DEFAULTS.lineWidth;
    root.dataset.line = String(lineWidth);
    const chartMode = CHART_MODES.includes(String(pref.chartPalette)) ? String(pref.chartPalette) : PREF_DEFAULTS.chartPalette;
    root.dataset.chart = chartMode;

    // 6a) 圆角：直接覆盖 --radius（默认 0px 与生成 CSS 一致，不产生变化）
    const radius = RADIUS_STEPS.includes(Number(pref.radius)) ? Number(pref.radius) : PREF_DEFAULTS.radius;
    root.style.setProperty('--radius', `${radius}px`);

    // 运行期覆盖层（强调色 / 明暗微调）：同步写入画布 token 与 DOM CSS 变量
    const pal = THEME_TOKENS[theme] as Record<string, string>;
    const override = computeRuntimeOverride(theme);
    setRuntimeOverride(override);
    const accent = override.accent || pal.accent;
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-rgb', hexToRgbString(accent));
    root.style.setProperty('--accent-soft', override.accentSoft || mixHex(pal.paper, accent, 0.28));
    root.style.setProperty('--accent-2', pal.accent2);
    root.style.setProperty('--green', pal.green);
    // 5) 明暗强度微调：纸面(paper) / 表面(paper-2↔panel, paper-3↔surface)；默认值=基础令牌值，无变化
    root.style.setProperty('--paper', override.paper || pal.paper);
    root.style.setProperty('--paper-2', override.panel || pal.panel);
    root.style.setProperty('--paper-3', override.surface || pal.surface);

    state.palette = pal;
    if (ui.infoBar) ui.infoBar.style.display = pref.infobar === false ? 'none' : '';
    syncPrefControls();
    writePrefCache();
    if (state.booted) {
      requestDraw();
      scheduleChartDraw();
      drawPhase();
      if (ui.moduleWin && !ui.moduleWin.hidden) drawModulePreview();
    }
  }

  function resolveTheme(pref: string) {
    if (pref === 'light' || pref === 'dark') return pref;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function readPrefCache() {
    try {
      return JSON.parse(window.localStorage.getItem(PREF_CACHE_KEY) || 'null');
    } catch (error) {
      return null;
    }
  }

  function writePrefCache() {
    try {
      window.localStorage.setItem(PREF_CACHE_KEY, JSON.stringify(state.prefs || {}));
    } catch (error) {
      // 隐私模式忽略
    }
  }

  async function loadUiPrefs() {
    const cached = readPrefCache();
    if (cached && typeof cached === 'object') state.prefs = { ...state.prefs, ...cached };
    // 启动引导改为「每次启动必显」：无论缓存里存过什么都没关系，强制 always
    state.prefs.guide = 'always';
    applyAppearance();
    try {
      const response = await jsonRequest('/api/settings', 'GET');
      const stored = response.settings || {};
      state.settings = stored;
      state.prefs.theme = ['system', 'light', 'dark'].includes(stored.theme) ? stored.theme : 'system';
      state.prefs.motion = ['off', 'low', 'med', 'high'].includes(stored.ui_motion) ? stored.ui_motion : 'low';
      state.prefs.perf = ['perf', 'balanced', 'quality'].includes(stored.ui_perf) ? stored.ui_perf : 'perf';
      state.prefs.accent = typeof stored.ui_accent === 'string' ? stored.ui_accent : '';
      // 启动引导一律按 always 处理（不再允许通过 ui_guide='never' 关闭开始页）
      state.prefs.guide = 'always';
      if (typeof stored.autosave_enabled === 'boolean') state.project.autosave = stored.autosave_enabled;
      const interval = Number(stored.autosave_interval_seconds);
      if (Number.isFinite(interval) && interval >= 5) state.project.autosaveInterval = interval * 1000;
      applyAppearance();
    } catch (error) {
      // 后端离线时使用缓存
    }
    state.uiReady = true;
  }

  const PREF_SETTING_KEYS = { theme: 'theme', motion: 'ui_motion', perf: 'ui_perf', accent: 'ui_accent' };

  async function setPref(key: string, value: unknown) {
    state.prefs[key] = value;
    applyAppearance();
    const settingKey = PREF_SETTING_KEYS[key as keyof typeof PREF_SETTING_KEYS];
    if (!settingKey) return;
    try {
      const response = await jsonRequest('/api/settings', 'PATCH', { [settingKey]: value });
      state.settings = response.settings || state.settings;
    } catch (error) {
      toast(`偏好保存失败：${(error as Error).message}`, 'warn', 3200);
    }
  }

  function syncPrefControls() {
    const prefs = state.prefs || {};
    const paint = (host: HTMLElement, value: string) => {
      if (!host) return;
      $$('button[data-value]', host).forEach((node) => {
        const on = node.dataset.value === value;
        node.classList.toggle('active', on);
        node.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    };
    paint($('#segTheme'), prefs.theme || 'system');
    paint($('#segMotion'), prefs.motion || 'low');
    paint($('#segPerf'), prefs.perf || 'perf');
    paint($('#segInfoBar'), prefs.infobar === false ? 'off' : 'on');
    paint($('#segSheet'), String(state.ui?.drawingSheet || 'A3'));
    paint($('#segDrawLabels'), state.ui?.drawingLabels ? 'on' : 'off');
    paint($('#segDrawPage'), String(state.ui?.drawingPage || 1));
    paint($('#segAutosave'), state.project.autosave ? 'on' : 'off');
    if ($('#selAutosaveInterval')) ($('#selAutosaveInterval') as HTMLInputElement).value = String(Math.round(state.project.autosaveInterval / 1000));
    // P-A4 新增 6 项外观控件回填
    paint($('#segFont'), String(prefs.fontScale ?? PREF_DEFAULTS.fontScale));
    paint($('#segDensity'), String(prefs.density ?? PREF_DEFAULTS.density));
    paint($('#segRadius'), String(prefs.radius ?? PREF_DEFAULTS.radius));
    paint($('#segLine'), String(prefs.lineWidth ?? PREF_DEFAULTS.lineWidth));
    paint($('#segChart'), String(prefs.chartPalette ?? PREF_DEFAULTS.chartPalette));
    const toneInput = $('#rngTone') as HTMLInputElement | null;
    if (toneInput) {
      const tone = Number(prefs.surfaceTone ?? 0);
      if (document.activeElement !== toneInput) toneInput.value = String(tone);
      const toneLabel = $('#rngToneVal');
      if (toneLabel) toneLabel.textContent = tone === 0 ? '0' : (tone > 0 ? `+${tone.toFixed(2)}` : tone.toFixed(2));
    }
    const swatches = $('#accentSwatches');
    if (swatches) {
      const activeVal = themeKey() === 'dark' ? (prefs.accentDark || '') : (prefs.accent || '');
      const preset = ACCENT_SWATCHES.includes(activeVal);
      $$('button', swatches).forEach((node) => {
        const val = node.dataset.value || '';
        const on = val === '__custom__' ? (!preset && !!activeVal) : (val === activeVal);
        node.classList.toggle('active', on);
        node.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (val === '__custom__') node.style.background = (activeVal && !preset) ? activeVal : '';
      });
    }
  }

  function initAppearanceControls() {
    $('#segTheme')?.addEventListener('click', (event: MouseEvent) => {
      const target = (event.target! as Element).closest('button[data-value]') as HTMLElement | null;
      if (target) void setPref('theme', target.dataset.value);
    });
    $('#segMotion')?.addEventListener('click', (event: MouseEvent) => {
      const target = (event.target! as Element).closest('button[data-value]') as HTMLElement | null;
      if (target) void setPref('motion', target.dataset.value);
    });
    $('#segPerf')?.addEventListener('click', (event: MouseEvent) => {
      const target = (event.target! as Element).closest('button[data-value]') as HTMLElement | null;
      if (target) void setPref('perf', target.dataset.value);
    });
    $('#segInfoBar')?.addEventListener('click', (event: MouseEvent) => {
      const target = (event.target! as Element).closest('button[data-value]') as HTMLElement | null;
      if (!target) return;
      state.prefs.infobar = target.dataset.value !== 'off';
      applyAppearance();
    });
    const bindDrawingSeg = (id: string, apply: (value: string) => void) => {
      $(id)?.addEventListener('click', (event: MouseEvent) => {
        const target = (event.target! as Element).closest('button[data-value]') as HTMLElement | null;
        if (!target) return;
        apply(String(target.dataset.value || ''));
        markProjectDirty();
        requestDraw();
        syncPrefControls();
      });
    };
    bindDrawingSeg('#segSheet', (value) => { state.ui.drawingSheet = value; });
    bindDrawingSeg('#segDrawLabels', (value) => { state.ui.drawingLabels = value === 'on'; });
    bindDrawingSeg('#segDrawPage', (value) => { state.ui.drawingPage = Math.max(1, Math.min(9, Number(value) || 1)); });
    $('#segAutosave')?.addEventListener('click', (event: MouseEvent) => {
      const target = (event.target! as Element).closest('button[data-value]') as HTMLElement | null;
      if (!target) return;
      void saveAutosaveSetting({ autosave_enabled: target.dataset.value === 'on' });
    });
    $('#selAutosaveInterval')?.addEventListener('change', () => {
      const seconds = Number(($('#selAutosaveInterval') as HTMLInputElement).value);
      if (Number.isFinite(seconds)) void saveAutosaveSetting({ autosave_interval_seconds: seconds });
    });

    // P-A4：字号 / 密度 / 圆角 / 线条 / 画布配色 —— 通用分段控件绑定
    const bindAppearSeg = (id: string, key: string, numeric: boolean) => {
      $(id)?.addEventListener('click', (event: MouseEvent) => {
        const target = (event.target! as Element).closest('button[data-value]') as HTMLElement | null;
        if (!target) return;
        const raw = String(target.dataset.value || '');
        void setPref(key, numeric ? Number(raw) : raw);
      });
    };
    bindAppearSeg('#segFont', 'fontScale', true);
    bindAppearSeg('#segDensity', 'density', false);
    bindAppearSeg('#segRadius', 'radius', true);
    bindAppearSeg('#segLine', 'lineWidth', true);
    bindAppearSeg('#segChart', 'chartPalette', false);

    // 5) 明暗强度微调（纸面/表面）：拖动实时应用，结束落盘
    $('#rngTone')?.addEventListener('input', () => {
      const input = $('#rngTone') as HTMLInputElement;
      state.prefs.surfaceTone = Number(input.value) || 0;
      applyAppearance();
      const toneLabel = $('#rngToneVal');
      const tone = Number(state.prefs.surfaceTone);
      if (toneLabel) toneLabel.textContent = tone === 0 ? '0' : (tone > 0 ? `+${tone.toFixed(2)}` : tone.toFixed(2));
    });
    $('#rngTone')?.addEventListener('change', () => { writePrefCache(); });

    const swatches = $('#accentSwatches');
    if (swatches) {
      for (const value of ACCENT_SWATCHES) {
        const node = button(value ? '' : 'A', 'swatch', () => {
          // 浅色与深色各自记忆：浅色写 accent（后端），深色写 accentDark（本地）
          if (themeKey() === 'dark') void setPref('accentDark', value);
          else void setPref('accent', value);
        });
        node.dataset.value = value;
        node.title = value ? `强调色 ${value}` : '默认强调色（跟随主题）';
        if (!value) node.classList.add('default');
        node.style.background = value || 'linear-gradient(135deg, #9b7247 50%, #eae5e1 50%)';
        node.dataset.swatch = value || 'default';
        swatches.appendChild(node);
      }
      // 2) 自定义强调色（iro 取色器，浅深各记）
      const custom = button('', 'swatch swatch-custom');
      custom.dataset.value = '__custom__';
      custom.title = '自定义强调色';
      custom.addEventListener('click', () => {
        const dark = themeKey() === 'dark';
        const current = (dark ? state.prefs.accentDark : state.prefs.accent) || '';
        const seed = current || (dark ? CANVAS_DARK.accent : CANVAS_LIGHT.accent);
        openIroColorPopover(custom, seed, (hex: string) => {
          if (dark) void setPref('accentDark', hex);
          else void setPref('accent', hex);
        });
      });
      swatches.appendChild(custom);
    }

    // 恢复默认（外观 9 项回默认 = 当前外观）
    $('#btnResetAppearance')?.addEventListener('click', () => void resetAppearance());

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if ((state.prefs.theme || 'system') === 'system') applyAppearance();
    });
  }

  // P-A4：恢复默认（把外观 9 项偏好回退到默认值；默认=当前外观，不改则无视觉变化）。
  // 新增 6 项只存 localStorage（writePrefCache）；现有 5 项同步回后端 settings.json。
  async function resetAppearance() {
    state.prefs = { ...state.prefs, ...PREF_DEFAULTS };
    applyAppearance();
    try {
      const response = await jsonRequest('/api/settings', 'PATCH', {
        theme: PREF_DEFAULTS.theme,
        ui_motion: PREF_DEFAULTS.motion,
        ui_perf: PREF_DEFAULTS.perf,
        ui_accent: PREF_DEFAULTS.accent,
      });
      state.settings = response.settings || state.settings;
      toast('外观已恢复默认', 'ok', 2000);
    } catch (error) {
      toast(`外观已恢复默认（本地）；后端未同步：${(error as Error).message}`, 'warn', 3200);
    }
  }

  async function saveAutosaveSetting(patch: Record<string, unknown>) {
    state.project.autosave = (patch.autosave_enabled !== undefined ? patch.autosave_enabled : state.project.autosave) as boolean;
    if (patch.autosave_interval_seconds) state.project.autosaveInterval = (patch.autosave_interval_seconds as number) * 1000;
    syncPrefControls();
    try {
      const response = await jsonRequest('/api/settings', 'PATCH', patch);
      state.settings = response.settings || state.settings;
      toast(patch.autosave_enabled === false ? '自动保存已关闭' : patch.autosave_enabled ? '自动保存已开启' : '快照间隔已更新', 'ok', 2000);
    } catch (error) {
      toast(`设置保存失败：${(error as Error).message}`, 'error', 3600);
    }
  }

  // ---- 设置窗（非模态内部浮窗） ---------------------------------------------
  type TelemetryQuality = {
    sample_dt?: number | null;
    quant_bits?: number | null;
    interp_error_bound?: number | null;
    interp_error_bound_method?: string | null;
    fifo_depth?: number | null;
    delay_bound?: number | null;
    delay_bound_method?: string | null;
    assumptions?: string[];
    sim_time?: number;
    steps?: number;
    running?: boolean;
  };

  function formatQualityNumber(value: number | null | undefined, unit = ''): string {
    if (value === null || value === undefined) return '—';
    if (!Number.isFinite(value)) return String(value);
    return `${value.toLocaleString('zh-CN', { maximumFractionDigits: 6 })}${unit}`;
  }

  function setQualityText(selector: string, text: string) {
    const node = $(selector);
    if (node) node.textContent = text;
  }

  async function refreshTelemetryQuality() {
    const status = $('#diagStatus');
    if (status) status.textContent = '读取中…';
    try {
      const payload = await api('/api/diagnostics/telemetry');
      const quality = (payload?.telemetry || {}) as TelemetryQuality;
      const assumptions = (quality.assumptions || []).filter((item) => item.trim().length > 0);
      const missing: string[] = [];
      if (quality.sample_dt === null || quality.sample_dt === undefined) missing.push('sample_dt');
      // quant_bits=None 表示"当前链路未启用量化"，是合法状态，不算缺失。
      if (quality.interp_error_bound === null || quality.interp_error_bound === undefined) missing.push('interp_error_bound');
      if (quality.delay_bound === null || quality.delay_bound === undefined) missing.push('delay_bound');
      setQualityText('#diagSampleDt', formatQualityNumber(quality.sample_dt, ' s'));
      setQualityText(
        '#diagQuantBits',
        quality.quant_bits === null || quality.quant_bits === undefined ? '未启用量化' : `${quality.quant_bits} bit`,
      );
      setQualityText(
        '#diagInterpBound',
        quality.interp_error_bound === null || quality.interp_error_bound === undefined
          ? '未声明'
          : `${formatQualityNumber(quality.interp_error_bound)}${quality.interp_error_bound_method ? `（${quality.interp_error_bound_method}）` : ''}`,
      );
      setQualityText('#diagFifoDepth', formatQualityNumber(quality.fifo_depth, ' 帧'));
      setQualityText(
        '#diagDelayBound',
        quality.delay_bound === null || quality.delay_bound === undefined
          ? '未声明'
          : `${formatQualityNumber(quality.delay_bound, ' s')}${quality.delay_bound_method ? `（${quality.delay_bound_method}）` : ''}`,
      );
      setQualityText('#diagAssumptions', assumptions.length ? `假设：${assumptions.join('；')}` : '假设：—');
      if (status) {
        status.textContent = missing.length ? `不完整：缺少 ${missing.join('、')}` : '完整（可用）';
        status.dataset.state = missing.length ? 'partial' : 'ok';
      }
    } catch (error) {
      if (status) {
        status.textContent = `读取失败：${(error as Error).message}`;
        status.dataset.state = 'error';
      }
    }
  }

  function openSettings(pane = 'project') {
    if (!ui.settingsWin) return;
    ui.settingsWin.hidden = false;
    ui.settingsWin.classList.remove('minimized');
    setSettingsPane(pane);
    if (!ui.scenePane || !ui.scenePane.dataset.ready) renderScenePanel();
    placeFloatWindow(ui.settingsWin, 'settingsGeo');
    raiseFloatWindow(ui.settingsWin);
  }

  function closeSettings() {
    if (!ui.settingsWin) return;
    ui.settingsWin.classList.remove('minimized', 'maximized');
    ui.settingsWin.hidden = true;
  }

  function setSettingsPane(pane: string) {
    $$('#settingsWin .setwin-nav button[data-pane]').forEach((node) => {
      node.classList.toggle('active', node.dataset.pane === pane);
    });
    $$('#settingsWin .setwin-pane').forEach((node) => {
      node.classList.toggle('active', node.dataset.pane === pane);
    });
    const hint = $('#setWinHint');
    if (hint) {
      const hints: Record<string, string> = {
        project: 'SETTINGS · 工程级，随 .netlab 保存',
        view: 'SETTINGS · 全局外观偏好',
        interact: 'SETTINGS · 全局交互偏好',
        diag: 'SETTINGS · 只读诊断（P5 误差合同）',
      };
      hint.textContent = hints[pane] || '';
    }
    const main = ui.settingsWin?.querySelector('.setwin-main');
    if (main) main.scrollTop = 0;
    if (pane === 'diag') void refreshTelemetryQuality();
  }

  function initSettingsWin() {
    $('#settingsWin .setwin-nav')?.addEventListener('click', (event: MouseEvent) => {
      const target = (event.target! as Element).closest('button[data-pane]') as HTMLElement | null;
      if (target) setSettingsPane((target.dataset.pane as string));
    });
    $('#btnDiagRefresh')?.addEventListener('click', () => void refreshTelemetryQuality());
    ui.settingsClose?.addEventListener('click', closeSettings);
    $$('#settingsWin [data-doc]').forEach((node) => {
      node.addEventListener('click', () => openDoc(node.dataset.doc));
    });
    initFloatWindow(ui.settingsWin, 'settingsGeo', { minWidth: 520, minHeight: 380 });
  }

  // ---- 启动引导 -------------------------------------------------------------
  // 开始页每次启动必显：showGuide 不再受任何偏好控制（force 参数仅为兼容旧调用保留）。
  function showGuide(force = false) {
    if (!ui.guide) return;
    void force;
    state.prefs.guide = 'always';
    state.guideShown = true;
    document.body.classList.add('guide-open');
    ui.guide.hidden = false;
    selectGuideMode(state.guideMode || state.mode || 'signal');
    syncPrefControls();
  }

  function hideGuide() {
    if (!ui.guide) return;
    ui.guide.hidden = true;
    document.body.classList.remove('guide-open');
  }

  function selectGuideMode(mode: string) {
    const picked = ['signal', 'circuit', 'vector'].includes(mode) ? mode : 'signal';
    state.guideMode = picked;
    $$('.guide-mode').forEach((node) => {
      const on = node.dataset.mode === picked;
      node.classList.toggle('selected', on);
      node.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  async function enterGuideScene() {
    const mode = state.guideMode || 'signal';
    // 进入场景只是隐藏本次开始页，不再写入任何「不再显示」偏好，下次启动仍会显示
    hideGuide();
    if (mode !== state.mode) {
      await switchMode(mode, { skipConfirm: true });
    } else {
      toast(`${modeLabel(mode)}场景已就绪 · 空格运行`, 'ok', 2600);
    }
  }

  function initGuide() {
    if (!ui.guide) return;
    $$('.guide-mode').forEach((node) => {
      node.addEventListener('click', () => selectGuideMode((node.dataset.mode as string)));
    });
    // 开始页标题区 = 窗口拖动柄：拖动它移动整个窗口（仅桌面壳；浏览器没有窗口可动）。
    // 旧实现拖动的是卡片本身（translate），在整屏开始页里视觉上等于没反应，已移除。
    (() => {
      const handle = document.querySelector('#guide .guide-top');
      if (!handle) return;
      const desktop = window.netlabDesktop;
      if (!desktop || typeof desktop.attachWindowDrag !== 'function') return;
      (handle as HTMLElement).style.cursor = 'grab';
      desktop.attachWindowDrag((handle as HTMLElement), {
        dblclick: false,
        onStart: () => { (handle as HTMLElement).style.cursor = 'grabbing'; },
        onEnd: () => { (handle as HTMLElement).style.cursor = 'grab'; },
      });
    })();
    ui.guideEnter?.addEventListener('click', () => void enterGuideScene());
    ui.guideClose?.addEventListener('click', hideGuide);
    ui.guideDocs?.addEventListener('click', () => {
      // 保持引导层不退出：文档窗浮在开始页之上，关闭文档后仍回到开始页
      openDoc('quickstart');
    });
    ui.guideDemo?.addEventListener('click', () => {
      hideGuide();
      void loadTemplate('signal_chain', '信号链示例');
    });
    ui.guideOpenProject?.addEventListener('click', () => void openProject());
    ui.guideSettings?.addEventListener('click', () => openSettings('view'));
    $$('#guide [data-doc]').forEach((node) => {
      node.addEventListener('click', (event: MouseEvent) => {
        event.stopPropagation();
        openDoc(node.dataset.doc);
      });
    });
    document.addEventListener('keydown', (event: KeyboardEvent) => {
      if ((event as Event as KeyboardEvent).key === 'Enter' && !ui.guide.hidden && !(event.target! as Element).closest('input, textarea, select')) {
        event.preventDefault();
        void enterGuideScene();
      }
    });
  }

  // ---- 文档中心 -------------------------------------------------------------
  async function ensureDocs() {
    if (state.docs && state.docs.length) return state.docs;
    try {
      const response = await jsonRequest('/api/docs', 'GET');
      state.docs = Array.isArray(response.docs) ? response.docs : [];
    } catch (error) {
      state.docs = [];
      toast(`文档读取失败：${(error as Error).message}`, 'warn', 4200);
    }
    return state.docs;
  }

  function docBySlug(slug: string) {
    return (state.docs || []).find((doc) => doc.slug === slug) || null;
  }

  // ---- PlotKit 绘图窗口（非模态浮窗，iframe 懒加载） ----------------------
  let plotkitReady = false;

  function layoutPlotkitWindow() {
    const win = $('#plotkitWin');
    if (!win) return;
    win.classList.toggle('docked', Boolean(state.plotkitDock));
    const dock = $('#plotkitDock');
    if (dock) dock.classList.toggle('on', Boolean(state.plotkitDock));
    if (!state.plotkitDock) {
      if (!win.hidden) placeFloatWindow(win, 'plotkitGeo');
      return;
    }
    // 停靠 = 贴在画布区右侧，占 62% 宽、72% 高；跟随窗口尺寸变化
    const stage = $('#graph')?.closest('.stage') || $('#graph')?.parentElement;
    const rect = stage?.getBoundingClientRect();
    if (!rect || rect.width < 240) return;
    const width = Math.max(560, Math.round(rect.width * 0.72));
    const height = Math.max(320, Math.round(rect.height * 0.78));
    win.style.left = `${Math.round(rect.left + rect.width - width - 16)}px`;
    win.style.top = `${Math.round(rect.top + 16)}px`;
    win.style.width = `${width}px`;
    win.style.height = `${height}px`;
  }

  function togglePlotkitDock() {
    const win = $('#plotkitWin');
    if (!win || win.hidden) return;
    state.plotkitDock = !state.plotkitDock;
    if (!state.plotkitDock) {
      win.style.left = '';
      win.style.top = '';
      win.style.width = '';
      win.style.height = '';
    }
    layoutPlotkitWindow();
  }

  function ensurePlotkitFrame() {
    const frame = $('#plotkitFrame');
    if (frame && !plotkitReady) {
      (frame as HTMLIFrameElement).src = plotkitFrameUrl({ embed: '1' });
      plotkitReady = true;
    }
    return frame;
  }

  // 三种承载方式：嵌进右侧「分析 → 绘图」页签 / 浮窗 / 独立浏览器窗口
  function placePlotkit(mode: string) {
    const frame = ensurePlotkitFrame();
    const win = $('#plotkitWin');
    const host = $('#plotkitInlineHost');
    const floatBody = $('#plotkitWin .plotkit-body');
    state.plotkitMode = mode;
    if (!frame) {
      if (mode === 'popup') toast('绘图 iframe 不存在，已改为独立窗口', 'warn', 2400);
      return;
    }
    if (mode === 'inline') {
      if (win) win.hidden = true;
      if (host) {
        host.hidden = false;
        host.appendChild(frame);
      }
      (document.querySelector('[data-sub="plotkit"]') as HTMLElement)?.click();
      if (typeof setStatusHint === 'function') setStatusHint('绘图已嵌在右侧面板 · 点「浮出窗口」可拖到画布上');
    } else if (mode === 'float') {
      if (host) host.hidden = true;
      if (floatBody) floatBody.appendChild(frame);
      openPlotkit();
    } else if (mode === 'popup') {
      const url = plotkitFrameUrl({ embed: '1' });
      const popup = window.open(url, 'netlab-plotkit', 'width=1180,height=820');
      if (popup) {
        toast('已在独立窗口打开绘图', 'ok', 2400);
        if (typeof setStatusHint === 'function') setStatusHint('独立绘图窗口 · 数据与主界面同源');
      } else {
        toast('浏览器拦截了弹出窗口，请允许后重试', 'warn', 3200);
      }
    }
  }

  function openPlotkit() {
    const win = $('#plotkitWin');
    if (!win) return;
    ensurePlotkitFrame();
    win.hidden = false;
    win.classList.remove('minimized');
    layoutPlotkitWindow();
    if (typeof raiseFloatWindow === 'function') raiseFloatWindow(win);
  }

  function closePlotkit() {
    const win = $('#plotkitWin');
    if (!win) return;
    win.hidden = true;
    win.classList.remove('minimized', 'maximized');
    state.plotkitGeo = null;
  }

  // ---- VS Code 代码工作区（非模态浮窗；iframe 直连本地 code server） ----------
  let vscodeStarting: Promise<unknown> | null = null;

  async function ensureVscodeFrame() {
    const frame = $('#vscodeFrame');
    if (!frame) return null;
    if (frame.dataset.ready === '1') return frame;
    if (vscodeStarting) return vscodeStarting;
    const status = $('#vscodeStatus');
    if (status) {
      status.hidden = false;
      status.textContent = '正在启动 VS Code Server…';
    }
    vscodeStarting = (async () => {
      try {
        const info = await api('/api/vscode/status?start=1', { timeoutMs: 60000 });
        if (!info || !info.url) {
          throw new Error((info && info.error) || 'VS Code Server 不可用');
        }
        (frame as HTMLIFrameElement).src = info.url;
        frame.dataset.ready = '1';
        if (status) status.hidden = true;
        try { localStorage.setItem('netlab.vscode.used', '1'); } catch (e) {}
        return frame;
      } catch (error) {
        if (status) {
          status.hidden = false;
          status.textContent = `VS Code 启动失败：${(error as Error).message}`;
        }
        toast(`VS Code 启动失败：${(error as Error).message}`, 'warn', 5000);
        return null;
      } finally {
        vscodeStarting = null;
      }
    })();
    return vscodeStarting;
  }

  async function openVscode() {
    const win = $('#vscodeWin');
    if (!win) return;
    win.hidden = false;
    win.classList.remove('minimized');
    placeFloatWindow(win, 'vscodeGeo');
    raiseFloatWindow(win);
    await ensureVscodeFrame();
  }

  function closeVscode() {
    const win = $('#vscodeWin');
    if (!win) return;
    win.hidden = true;
    win.classList.remove('minimized', 'maximized');
    state.vscodeGeo = null;
  }

  // 用过一次 VS Code 后，下次启动应用时后台静默预热（拉起 server + 预载 21MB 包，
  // 让下一次点开是热缓存 ~1.7s，而不是冷启动 5–8s）。仅对老用户生效，新人首次不预载。
  function vscodeWasUsed() {
    try { return localStorage.getItem('netlab.vscode.used') === '1'; } catch (e) { return false; }
  }

  function maybePrewarmVscode() {
    if (!vscodeWasUsed()) return;
    setTimeout(() => { void ensureVscodeFrame(); }, 2500);
  }

  async function openDoc(slug = 'quickstart') {
    if (!ui.docWin) return;
    await ensureDocs();
    const doc = docBySlug(slug) || state.docs[0];
    if (!doc) {
      toast('文档目录为空，请检查后端安装', 'warn', 4000);
      return;
    }
    state.docSlug = doc.slug;
    ui.docWin.hidden = false;
    ui.docWin.classList.remove('min');
    document.body.classList.add('doc-open');
    ui.docTitle.textContent = `NETLAB · ${doc.title}`;
    renderDocNav();
    renderDocBody(doc);
    ui.docContent.parentElement!.scrollTop = 0;
    ui.docSearch.value = '';
    ui.docResults.replaceChildren();
    placeDocWindow();
  }

  function closeDoc() {
    if (!ui.docWin) return;
    ui.docWin.hidden = true;
    ui.docWin.classList.remove('minimized', 'maximized');
    document.body.classList.remove('doc-open');
    state.docGeo = null;
    if (state.guideShown && !ui.guide.hidden) syncPrefControls();
  }

  function renderDocNav() {
    if (!ui.docNav) return;
    ui.docNav.replaceChildren();
    for (const doc of state.docs) {
      const node = button(doc.title, 'docnav-item', () => {
        state.docSlug = doc.slug;
        ui.docTitle.textContent = `NETLAB · ${doc.title}`;
        renderDocNav();
        renderDocBody(doc);
        ui.docResults.replaceChildren();
        ui.docSearch.value = '';
      });
      node.classList.toggle('active', doc.slug === state.docSlug);
      ui.docNav.appendChild(node);
    }
  }

  function renderDocBody(doc: DocItem) {
    if (!ui.docContent) return;
    const fragment = renderMarkdown((doc.text || '') as string);
    ui.docContent.replaceChildren(fragment);
  }

  function renderInline(text: string, target: HTMLElement) {
    const source = String(text || '');
    const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
    let cursor = 0;
    let match;
    while ((match = pattern.exec(source))) {
      if (match.index > cursor) target.appendChild(document.createTextNode(source.slice(cursor, match.index)));
      const token = match[0];
      if (token.startsWith('**')) {
        target.appendChild(el('b', null, token.slice(2, -2)));
      } else if (token.startsWith('`')) {
        target.appendChild(el('code', null, token.slice(1, -1)));
      } else {
        const label = token.slice(1, token.indexOf(']'));
        target.appendChild(el('span', 'doc-link', label));
      }
      cursor = match.index + token.length;
    }
    if (cursor < source.length) target.appendChild(document.createTextNode(source.slice(cursor)));
    return target;
  }

  function renderMarkdown(text: string) {
    const fragment = document.createDocumentFragment();
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
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
        const pre = el('pre', 'doc-code');
        pre.textContent = code.join('\n');
        fragment.appendChild(pre);
        continue;
      }
      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        const level = heading[1].length;
        const node = el(level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3', 'doc-h');
        node.id = `doc-h-${blockId++}`;
        renderInline(heading[2], node);
        fragment.appendChild(node);
        index += 1;
        continue;
      }
      if (/^\s*[-*]\s+/.test(line)) {
        const list = el('ul', 'doc-list');
        while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
          const item = el('li');
          renderInline(lines[index].replace(/^\s*[-*]\s+/, ''), item);
          list.appendChild(item);
          index += 1;
        }
        fragment.appendChild(list);
        continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) {
        const list = el('ol', 'doc-list');
        while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
          const item = el('li');
          renderInline(lines[index].replace(/^\s*\d+\.\s+/, ''), item);
          list.appendChild(item);
          index += 1;
        }
        fragment.appendChild(list);
        continue;
      }
      if (/^\s*>\s?/.test(line)) {
        const quote = el('blockquote', 'doc-quote');
        while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
          renderInline(lines[index].replace(/^\s*>\s?/, ''), quote);
          quote.appendChild(document.createElement('br'));
          index += 1;
        }
        fragment.appendChild(quote);
        continue;
      }
      if (!line.trim()) {
        index += 1;
        continue;
      }
      const paragraph = el('p', 'doc-p');
      const parts = [line];
      index += 1;
      while (index < lines.length && lines[index].trim() && !/^(#{1,4}\s|```|\s*[-*]\s|\s*\d+\.\s|>)/.test(lines[index])) {
        parts.push(lines[index]);
        index += 1;
      }
      renderInline(parts.join(' '), paragraph);
      fragment.appendChild(paragraph);
    }
    return fragment;
  }

  let docSearchSeq = 0;

  async function searchDocs(query: string) {
    if (!ui.docResults) return;
    const text = String(query || '').trim().toLowerCase();
    const seq = ++docSearchSeq;
    ui.docResults.replaceChildren();
    if (!text) {
      ui.docMain.classList.remove('searching');
      return;
    }
    ui.docMain.classList.add('searching');
    const hits = [];
    for (const doc of state.docs) {
      const blocks = String(doc.text || '').split(/\n{2,}/);
      for (const block of blocks) {
        if (block.toLowerCase().includes(text)) {
          hits.push({
            slug: doc.slug,
            title: doc.title,
            snippet: block.replace(/[#>*`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150),
          });
          break;
        }
      }
    }
    let extra: Array<Record<string, string>> = [];
    try {
      const response = await api(`/api/help/search?q=${encodeURIComponent(text)}&limit=12`);
      extra = (response?.items || []).filter((item: Record<string, string>) => item.kind !== 'doc');
    } catch {
      extra = [];
    }
    if (seq !== docSearchSeq) return;
    if (!hits.length && !extra.length) {
      ui.docResults.appendChild(div('doc-empty', '没有匹配的段落；试试「节点」「求解器」「快捷键」等关键词。'));
      return;
    }
    if (hits.length) {
      ui.docResults.appendChild(el('div', 'doc-sec', `文档段落 · ${hits.length}`));
    }
    for (const hit of hits) {
      const node = button('', 'doc-hit', () => {
        void openDoc(hit.slug);
        ui.docSearch.value = query;
        void searchDocs(query);
      });
      node.appendChild(el('b', null, hit.title));
      node.appendChild(el('span', null, hit.snippet));
      ui.docResults.appendChild(node);
    }
    if (extra.length) {
      const order = ['element', 'circuit_node', 'compute', 'method', 'template', 'doc'];
      const buckets = new Map<string, { label: string; items: Array<Record<string, string>> }>();
      for (const item of extra) {
        const key = String(item.kind || 'other');
        if (!buckets.has(key)) {
          buckets.set(key, { label: String(item.kind_label || key), items: [] });
        }
        buckets.get(key)!.items.push(item);
      }
      const keys = [
        ...order.filter((key) => buckets.has(key)),
        ...[...buckets.keys()].filter((key) => !order.includes(key)),
      ];
      for (const key of keys) {
        const bucket = buckets.get(key)!;
        ui.docResults.appendChild(
          el('div', 'doc-sec', `${bucket.label} · ${bucket.items.length}`),
        );
        for (const item of bucket.items) {
          const node = button('', 'doc-hit', () => {
            if (item.kind === 'template') {
              closeDoc();
              void loadTemplate(item.ref || '', item.title || '');
            } else if (item.kind === 'doc' && item.ref) {
              window.open(
                `/api/help/doc?path=${encodeURIComponent(item.ref)}&line=${Number(item.line) || 1}`,
                '_blank',
                'noopener',
              );
            } else {
              toast(`${item.title}：${item.text || '无更多说明'}`, 'info', 4200);
            }
          });
          const head = el('b', null, item.title || item.ref || '');
          const badge = el('i', 'doc-kind', item.kind_label || item.kind || '');
          head.appendChild(badge);
          node.appendChild(head);
          node.appendChild(el('span', null, item.text || item.subtitle || ''));
          ui.docResults.appendChild(node);
          node.title = `${item.title} · ${item.subtitle}`;
        }
      }
    }
  }

  // ---- 内部浮窗（文档中心 / 设置窗共用：拖动 · 缩放 · 最小化 · 最大化） -------

  // ---- 电路分析浮窗（R26）：DC 工作点 / AC 小信号扫频 -----------------------
  function analEscape(text: string) {
    return String(text ?? '').replace(/[&<>"]/g, (ch) => (
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[ch]
    ));
  }

  function analNum(value: unknown, digits: number = 6) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '—';
    const abs = Math.abs(num);
    if (abs !== 0 && (abs < 1e-4 || abs >= 1e5)) return num.toExponential(3);
    return String(Number(num.toFixed(digits)));
  }

  function analToken(name: string, fallback: string) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (value || '').trim() || fallback;
  }

  function analysisWarn() {
    // 用户要求：开始分析前弹提醒，但不阻止
    toast('分析会基于当前场景重新求解，期间实时播放会暂停；可随时关闭分析窗。', 'warn', 4200);
  }

  function openAnalysis(tab = 'op') {
    const win = $('#analWin');
    if (!win) return;
    if ((state.scene?.mode || state.mode) !== 'circuit') {
      toast('DC 工作点 / AC 扫频只在电路模式下可用', 'error', 4000);
      return;
    }
    win.hidden = false;
    raiseFloatWindow(win);
    fillAcSources();
    selectAnalTab(tab);
  }

  function closeAnalysis() {
    const win = $('#analWin');
    if (win) win.hidden = true;
  }

  function selectAnalTab(tab: string) {
    for (const btn of $$('.anal-tab')) {
      btn.classList.toggle('active', btn.dataset.anal === tab);
    }
    for (const pane of $$('.anal-pane')) {
      pane.hidden = pane.dataset.analPane !== tab;
    }
    if (tab === 'ac') requestAnimationFrame(() => drawAcChart());
  }

  function fillAcSources() {
    const select = $('#analAcInput');
    if (!select) return;
    const previous = (select as HTMLInputElement).value;
    const nodes = state.scene?.nodes || [];
    const sources = nodes.filter((node) => {
      const kind = node.kind === 'device' ? node.params?.element : node.kind;
      return kind === 'vsource' || kind === 'isource';
    });
    select.innerHTML = '<option value="">自动</option>'
      + sources.map((node) => (
        `<option value="${analEscape(node.name)}">${analEscape(node.name)}</option>`
      )).join('');
    if (sources.some((node) => node.name === previous)) (select as HTMLInputElement).value = previous;
  }

  async function runOperatingPoint() {
    analysisWarn();
    const body = $('#analOpTable');
    const meta = $('#analOpMeta');
    if (meta) meta.textContent = '求解中…';
    try {
      const data = await api('/api/operating-point');
      const result = data.result || {};
      const nodeRows = Object.entries(result.node_voltages || {}).map(([name, value]) => (
        `<tr><td>${analEscape(name)}</td><td class="num">${analNum(value)}</td></tr>`
      )).join('');
      const elementRows = Object.entries((result.elements || {}) as Record<string, OpElementRec>).map(([name, info]) => (
        `<tr><td>${analEscape(name)}</td><td class="num">${analNum(info.current)}</td>`
        + `<td class="num">${analNum(info.voltage_difference)}</td>`
        + `<td class="num">${analNum(info.power)}</td></tr>`
      )).join('');
      if (body) {
        body.innerHTML = '<table><caption>节点电压（V）</caption><thead><tr><th>节点</th>'
          + '<th>电压</th></tr></thead><tbody>' + (nodeRows || '<tr><td colspan="2">没有节点</td></tr>')
          + '</tbody></table><table><caption>元件</caption><thead><tr><th>元件</th>'
          + '<th>电流（A）</th><th>端电压（V）</th><th>功率（W）</th></tr></thead><tbody>'
          + (elementRows || '<tr><td colspan="4">没有元件</td></tr>') + '</tbody></table>';
      }
      if (meta) {
        meta.textContent = `迭代 ${result.iterations ?? '—'} 步 · 矩阵 ${result.matrix_size ?? '—'}`
          + ` · 残差 ${analNum(result.residual, 3)} · ${result.sparse ? '稀疏' : '稠密'}`
          + (result.strategies?.length ? ` · ${result.strategies.join('/')}` : '');
      }
    } catch (error) {
      if (body) body.innerHTML = `<div class="anal-empty">${analEscape((error as Error).message)}</div>`;
      if (meta) meta.textContent = '求解失败';
      toast(`DC 工作点失败：${(error as Error).message}`, 'error', 6000);
    }
  }

  async function runAcSweep() {
    analysisWarn();
    const meta = $('#analAcMeta');
    const params = new URLSearchParams();
    const input = ($('#analAcInput') as HTMLInputElement)?.value || '';
    if (input) params.set('input', input);
    params.set('f_start', ($('#analAcF1') as HTMLInputElement)?.value || '10');
    params.set('f_stop', ($('#analAcF2') as HTMLInputElement)?.value || '1000000');
    params.set('points', ($('#analAcPts') as HTMLInputElement)?.value || '121');
    params.set('scale', ($('#analAcScale') as HTMLInputElement)?.value || 'log');
    // 默认只看节点电压（元件电流曲线太密，需要时可在后端 probes 指定）
    // 接地节点电压恒为 0，且后端 AC 探针不接受 ground，一并排除
    const probeNames = (state.scene?.nodes || [])
      .filter((node) => node.kind === 'node')
      .map((node) => node.name)
      .filter(Boolean);
    if (probeNames.length) params.set('probes', probeNames.join(','));
    if (meta) meta.textContent = '扫频中…';
    try {
      const data = await api(`/api/ac-sweep?${params.toString()}`);
      state.acResult = data.result || null;
      state.acRevision = state.scene?.revision ?? null;
      const result = state.acResult as AcResultRec | null;
      const count = Object.keys(result?.probes || {}).length;
      if (meta) {
        meta.textContent = `${count} 条曲线 · 激励 ${result?.input || '—'} · ${result?.frequencies?.length || 0} 点`;
      }
      drawAcChart();
    } catch (error) {
      state.acResult = null;
      if (meta) meta.textContent = '扫频失败';
      toast(`AC 扫频失败：${(error as Error).message}`, 'error', 7000);
      drawAcChart();
    }
  }

  function drawAcChart() {
    const canvas = $('#analAcCanvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return;
    const dpr = window.devicePixelRatio || 1;
    (canvas as HTMLCanvasElement).width = Math.round(rect.width * dpr);
    (canvas as HTMLCanvasElement).height = Math.round(rect.height * dpr);
    const ctx = (canvas as HTMLCanvasElement).getContext('2d');
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = rect.width;
    const H = rect.height;
    const ink = analToken('--ink', '#080a08');
    const muted = analToken('--muted', '#7b7266');
    const line = analToken('--line', '#d9d3c7');
    ctx!.clearRect(0, 0, W, H);
    const result = state.acResult as AcResultRec | null;
    const legend = $('#analAcLegend');
    if (!result || !result.frequencies?.length) {
      if (legend) legend.innerHTML = '';
      ctx!.fillStyle = muted;
      ctx!.font = '12.5px "Microsoft YaHei UI", sans-serif';
      ctx!.fillText('选择激励与频率范围后点「开始扫频」', 16, 26);
      return;
    }
    const freqs = result.frequencies;
    const probes = Object.entries(result.probes || {});
    const scale = ($('#analAcScale') as HTMLInputElement)?.value || 'log';
    const f0 = freqs[0];
    const f1 = freqs[freqs.length - 1];
    const padL = 52;
    const padR = 14;
    const padT = 12;
    const gap = 30;
    const padB = 26;
    const magH = (H - padT - padB - gap) * 0.62;
    const phaseH = (H - padT - padB - gap) - magH;
    const magTop = padT;
    const phaseTop = padT + magH + gap;
    const plotW = Math.max(40, W - padL - padR);
    const xOf = (f: number) => {
      if (scale === 'log') {
        const lo = Math.log10(Math.max(f0, 1e-9));
        const hi = Math.log10(Math.max(f1, 1e-9));
        const span = hi - lo || 1;
        return padL + ((Math.log10(Math.max(f, 1e-9)) - lo) / span) * plotW;
      }
      const span = (f1 - f0) || 1;
      return padL + ((f - f0) / span) * plotW;
    };

    let minDb = 0;
    let maxDb = 0;
    for (const [, info] of probes) {
      for (const value of (info as { db?: number[] }).db || []) {
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
    const yMag = (db: number) => magTop + (1 - (db - minDb) / (maxDb - minDb || 1)) * magH;
    const yPhase = (deg: number) => phaseTop + (1 - (deg + 180) / 360) * phaseH;

    ctx!.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    // 幅度区网格
    ctx!.strokeStyle = line;
    ctx!.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = magTop + (magH * i) / 4;
      ctx!.beginPath();
      ctx!.moveTo(padL, y);
      ctx!.lineTo(padL + plotW, y);
      ctx!.stroke();
      ctx!.fillStyle = muted;
      const value = maxDb - ((maxDb - minDb) * i) / 4;
      ctx!.fillText(`${value.toFixed(0)} dB`, 6, y + 4);
    }
    // 相位区网格
    for (const deg of [-180, -90, 0, 90, 180]) {
      const y = yPhase(deg);
      ctx!.beginPath();
      ctx!.moveTo(padL, y);
      ctx!.lineTo(padL + plotW, y);
      ctx!.stroke();
      ctx!.fillStyle = muted;
      ctx!.fillText(`${deg}°`, 18, y + 4);
    }
    // 频率刻度
    const ticks = 5;
    for (let i = 0; i < ticks; i += 1) {
      const ratio = i / (ticks - 1);
      const f = scale === 'log' ? 10 ** (Math.log10(f0) + (Math.log10(f1) - Math.log10(f0)) * ratio) : f0 + (f1 - f0) * ratio;
      const x = padL + plotW * ratio;
      ctx!.strokeStyle = line;
      ctx!.beginPath();
      ctx!.moveTo(x, magTop);
      ctx!.lineTo(x, magTop + magH + gap + phaseH);
      ctx!.stroke();
      ctx!.fillStyle = muted;
      const label = f >= 1e6 ? `${(f / 1e6).toFixed(1)}M` : f >= 1e3 ? `${(f / 1e3).toFixed(1)}k` : f >= 1 ? `${f.toFixed(0)}` : f.toExponential(0);
      ctx!.fillText(label, x - 8, H - 8);
    }
    // 曲线
    const swatches: string[] = [];
    probes.forEach(([name, info], index: number) => {
      const chartMode = String((state.prefs && state.prefs.chartPalette) || 'theme');
      const series = chartMode === 'theme' ? PALETTE : chartPalette();
      const color = series[index % series.length];
      swatches.push(`<span><i style="background:${color}"></i>${analEscape(name)}</span>`);
      const draw = (values: number[], yFn: (value: number) => number) => {
        ctx!.beginPath();
        ctx!.strokeStyle = color;
        ctx!.lineWidth = 1.6;
        let started = false;
        for (let i = 0; i < freqs.length; i += 1) {
          const value = values?.[i];
          if (!Number.isFinite(value)) continue;
          const x = xOf(freqs[i]);
          const y = yFn(value);
          if (!started) {
            ctx!.moveTo(x, y);
            started = true;
          } else {
            ctx!.lineTo(x, y);
          }
        }
        if (started) ctx!.stroke();
      };
      draw((info as { db: number[] }).db, yMag);
      draw((info as { phase_deg: number[] }).phase_deg, yPhase);
    });
    if (legend) legend.innerHTML = swatches.join('');
    ctx!.fillStyle = ink;
    ctx!.font = '11.5px "Microsoft YaHei UI", sans-serif';
    ctx!.fillText('幅值', 6, magTop + 8);
    ctx!.fillText('相位', 6, phaseTop + 10);
  }

  // ---- PlotKit 数据接入：把探针通道挑给 PlotKit -------------------------
  let pkChannelCache: string[] = [];

  function pkKeyShort(key: string) {
    const parts = String(key).split(':');
    if (parts.length >= 3 && parts[0] === 'n') return parts.slice(1).join('.');
    return String(key);
  }

  function pkCheckedKeys() {
    return Array.from(document.querySelectorAll('#pkChannelList input[type=checkbox]'))
      .filter((el) => (el as HTMLInputElement).checked).map((el) => (el as HTMLInputElement).value);
  }

  function renderPkChannels(selected: Set<string> | string[]) {
    const box = $('#pkChannelList');
    if (!box) return;
    const want = new Set(selected && (selected as Set<string> & { length?: number }).length ? selected : pkCheckedKeys());
    box.textContent = '';
    if (!pkChannelCache.length) {
      const empty = document.createElement('span');
      empty.className = 'pk-empty';
      empty.textContent = '还没有探针数据：先运行仿真，或打开带探针的工程。';
      box.appendChild(empty);
    } else {
      pkChannelCache.forEach((key: string) => {
        const label = document.createElement('label');
        label.className = 'pk-ch';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = key;
        input.checked = want.has(key);
        const span = document.createElement('span');
        span.textContent = pkKeyShort(key);
        span.title = key;
        label.appendChild(input);
        label.appendChild(span);
        box.appendChild(label);
      });
    }
    const count = $('#pkDataCount');
    if (count) count.textContent = String(pkChannelCache.length);
  }

  function showPkChannelLoadError(message: string) {
    const hint = $('#pkDataHint');
    const box = $('#pkChannelList');
    const text = message || '请求失败';
    if (hint) hint.textContent = `数据刷新失败：${text}；现有通道列表未清除，可点击「重试」。`;
    if (pkChannelCache.length || !box) return;
    box.textContent = '';
    const empty = document.createElement('span');
    empty.className = 'pk-empty';
    empty.textContent = `探针列表加载失败：${text}`;
    box.appendChild(empty);
  }

  async function refreshPkChannels(keepSelection?: boolean) {
    const hint = $('#pkDataHint');
    try {
      const data = await api('/api/plotkit/channels');
      const avail = (data && data.available) || [];
      const registered = (data && data.channels) || [];
      if (data && data.build && data.build !== UI_BUILD) {
        pkChannelCache = avail;
        renderPkChannels([]);
        if (hint) hint.textContent = `服务端进程还是旧版本（后端 ${data.build} / 界面 ${UI_BUILD}）——请完全退出应用后重新启动；只关闭窗口可能残留旧进程。`;
        return false;
      }
      if (!data || !data.mounted) {
        pkChannelCache = avail;
        renderPkChannels([]);
        const why = (data && data.diag && data.diag.last_error) || '找不到 plotkit 包';
        if (hint) hint.textContent = `PlotKit 未挂载：${why}`;
        return false;
      }
      // 优先列「场景里的探针」（不运行也能选），已登记的也算
      pkChannelCache = avail.length ? avail : registered;
      renderPkChannels(keepSelection ? null : (data.selected || []));
      if (hint) {
        hint.textContent = avail.length
          ? `场景共 ${avail.length} 条探针，已登记 ${registered.length} 条，当前画 ${(data.selected || []).length} 条；勾选后点「接入」。`
          : '当前场景没有探针：先放探针节点或打开带探针的工程。';
      }
      return true;
    } catch (error) {
      showPkChannelLoadError((error as Error).message);
      return false;
    }
  }

  async function retryPlotkit() {
    const hint = $('#pkDataHint');
    if (hint) hint.textContent = '正在重新检测 PlotKit…';
    try {
      const data = await api('/api/plotkit/channels');
      if (data && data.mounted) {
        reloadPlotkitFrame();
        const refreshed = await refreshPkChannels(true);
        if (!refreshed) {
          toast('通道刷新失败，请查看提示', 'warn', 4000);
          return;
        }
        toast('PlotKit 已就绪', 'info', 1800);
      } else {
        const why = (data && data.diag && data.diag.last_error) || '未知原因';
        if (hint) hint.textContent = `仍然未挂载：${why}`;
        toast('PlotKit 仍未挂载，请看提示', 'warn', 4000);
      }
    } catch (error) {
      showPkChannelLoadError((error as Error).message);
      toast('重新检测失败，请查看提示', 'warn', 4000);
    }
  }

  function reloadPlotkitFrame() {
    const frame = $('#plotkitFrame');
    if (frame) (frame as HTMLIFrameElement).src = plotkitFrameUrl({ embed: '1', r: String(Date.now()) });
  }

  /** 预计算进度快照（GET /api/precompute/progress 的返回体）。 */
  type PrecomputeProgress = {
    ok?: boolean;
    status?: string;
    running?: boolean;
    done?: number;
    total?: number;
    percent?: number;
    elapsed?: number;
    eta?: number | null;
    error?: string | null;
  };

  function mountPrecomputeBar() {
    const prior = document.getElementById('pkPrecomputeBar');
    if (prior) prior.remove();
    const host = document.createElement('div');
    host.id = 'pkPrecomputeBar';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    host.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:10000;width:min(460px,92vw);background:var(--paper-2,#f3efe6);color:var(--text-primary,#080a08);border:1px solid var(--line-strong,#b9ae98);border-radius:12px;box-shadow:0 18px 48px rgba(0,0,0,.28);padding:12px 16px 13px;font:13px/1.5 "Microsoft YaHei",system-ui,sans-serif;';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:8px;';
    const title = document.createElement('span');
    title.style.cssText = 'color:var(--text-primary,#080a08);font-weight:600;';
    title.textContent = '预计算中…';
    const pct = document.createElement('span');
    pct.style.cssText = 'color:var(--accent,#9b7247);font-weight:600;font-variant-numeric:tabular-nums;';
    pct.textContent = '0%';
    head.append(title, pct);
    const track = document.createElement('div');
    track.style.cssText = 'height:8px;border-radius:999px;background:var(--paper-3,#e7e0d1);overflow:hidden;';
    const fill = document.createElement('div');
    fill.style.cssText = 'height:100%;width:0%;border-radius:999px;background:var(--accent,#9b7247);transition:width .18s linear;';
    track.appendChild(fill);
    const sub = document.createElement('div');
    sub.style.cssText = 'margin-top:7px;color:var(--text-secondary,#7b7266);font-size:12px;';
    sub.textContent = '正在准备…';
    host.append(head, track, sub);
    document.body.appendChild(host);
    return { host, title, pct, fill, sub };
  }

  function paintPrecomputeBar(
    parts: ReturnType<typeof mountPrecomputeBar>,
    progress: PrecomputeProgress | null,
    label: string,
  ) {
    if (!progress) return;
    const total = Number(progress.total || 0);
    const done = Number(progress.done || 0);
    let pctValue = Number(progress.percent);
    if (!Number.isFinite(pctValue)) pctValue = total > 0 ? (done * 100) / total : 0;
    pctValue = Math.max(0, Math.min(100, pctValue));
    parts.fill.style.width = `${pctValue.toFixed(1)}%`;
    parts.pct.textContent = `${Math.round(pctValue)}%`;
    const status = progress.status || '';
    parts.title.textContent =
      status === 'done' ? '预计算完成'
      : status === 'cancelled' ? '已停止预计算'
      : status === 'error' ? '预计算失败'
      : label;
    const bits: string[] = [];
    if (total > 0) bits.push(`${done} / ${total} 步`);
    const elapsed = Number(progress.elapsed);
    if (Number.isFinite(elapsed) && elapsed > 0) bits.push(`已用 ${elapsed.toFixed(1)}s`);
    const eta = progress.eta == null ? Number.NaN : Number(progress.eta);
    if (progress.running && Number.isFinite(eta) && eta >= 0 && pctValue < 100) {
      bits.push(`剩余约 ${eta.toFixed(1)}s`);
    }
    parts.sub.textContent = bits.length ? bits.join(' · ') : '正在准备…';
  }

  /**
   * 预计算期间挂一个浮动进度条 + 百分比 + ETA，完成/失败后自动消失。
   * 进度条生命周期绑定 launch() 的 Promise（而非进度快照的 status），因此不会
   * 因上一轮遗留的 done 快照而提前收掉；POST 仍保持同步返回完整结果，调用方拿到
   * pre 后照常 await syncAfterPrecompute(pre)。进度查询失败不影响主流程。
   */
  async function runPrecomputeWithProgress<T>(
    launch: () => Promise<T>,
    label = '预计算中…',
  ): Promise<T> {
    const parts = mountPrecomputeBar();
    let finished = false;
    const tick = async () => {
      if (finished) return;
      try {
        const progress = (await api('/api/precompute/progress', {
          timeoutMs: 4000,
        })) as PrecomputeProgress | null;
        if (!finished) paintPrecomputeBar(parts, progress, label);
      } catch {
        // 进度查询失败不应影响主流程；继续等待 launch()
      }
    };
    void tick();
    const timer = window.setInterval(() => { void tick(); }, 220);
    try {
      return await launch();
    } finally {
      finished = true;
      window.clearInterval(timer);
      parts.host.remove();
    }
  }

  /**
   * 预计算（/api/plotkit/precompute）把 0→T 整段时序写进了 SERVICE.current.recorder，
   * 与 /api/solve-window 是同一条落地路径。但此前前端只提示帧数、从不刷新 state.sim，
   * 于是「分析·信号」等 netlab 自身分析面板仍用旧的（空）probe_keys，表现为"没有
   * 数据可加载"。这里把最新 sim 同步回本地 state，并重渲染分析面板（若正显示）。
   */
  async function syncAfterPrecompute(pre: { sim?: SimRec } | null) {
    if (pre && pre.sim) state.sim = pre.sim;
    else await refreshState(true);
    updateSignalKeyCache();
    if (activeTab() === 'analysis') renderAnalysisPanel();
  }

  async function applyPkChannels() {
    const keys = pkCheckedKeys();
    const hint = $('#pkDataHint');
    const applyBtn = $('#pkChApply');
    const seconds = Math.max(1, Math.min(120, Number(state.chart && state.chart.window) || 5));
    if (applyBtn) (applyBtn as HTMLButtonElement).disabled = true;
    try {
      // 先登记选中通道，再预计算：桥的同步线程可能在预计算期间就消费帧，顺序反过来
      // 会让旧选择吃掉整段预计算，新选中的通道则永远停在 NaN（2026-11-03 修复）。
      if (hint) hint.textContent = '正在登记选中通道…';
      const data = await api('/api/plotkit/channels', {
        method: 'POST',
        body: JSON.stringify({ keys }),
      });
      if (!data || !data.ok) {
        const message = (data && data.error) || (data && data.mounted === false ? 'PlotKit 未挂载' : '未知原因');
        if (hint) hint.textContent = `接入失败：${message}`;
        toast(`接入失败：${message}`, 'warn', 4000);
        return;
      }
      // 接入前先强制预计算：把 0→T 的整段数据算完再登记，避免边跑边画导致的卡顿
      if (hint) hint.textContent = `正在预计算 0→${seconds}s 的数据…`;
      const pre = await runPrecomputeWithProgress(
        () => api('/api/plotkit/precompute', {
          method: 'POST',
          body: JSON.stringify({ seconds }),
          timeoutMs: 180000,
        }),
        `正在计算 0→${seconds}s`,
      );
      if (pre && pre.ok === false) {
        toast('预计算失败：' + (pre.error || '未知错误'), 'warn', 4000);
        if (hint) hint.textContent = `预计算失败：${pre.error || '未知错误'}；可重试或检查场景。`;
        return;
      }
      if (pre && pre.elapsed_ms) {
        // 2026-11-03：降级（步数超上限）要说清楚，否则看起来像「提高精度没生效」。
        const degradedNote = pre.degraded
          ? `；步长已降级为 ${Number(pre.dt_used).toExponential(1)}s（请求 ${Number(pre.requested_dt).toExponential(1)}s，受 20 万步上限限制）`
          : '';
        if (hint) hint.textContent = `预计算完成：${seconds}s / ${pre.frames ?? pre.frames_recorded ?? '?'} 帧 / ${Math.round(pre.elapsed_ms)} ms${degradedNote}`;
        if (pre.degraded) {
          toast(`预计算已降级步长 ${Number(pre.dt_used).toExponential(1)}s，缩小时间窗可提高精度`, 'warn', 5200);
        }
      }
      // 同步预计算产出的录制数据，让「分析·信号」等面板能列出并加载变量
      await syncAfterPrecompute(pre);
      toast(`已接入 ${(data.selected || []).length} 条通道`, 'ok', 2600);
      reloadPlotkitFrame();
      await refreshPkChannels();
    } catch (error) {
      const message = (error as Error).message || '请求失败';
      if (hint) hint.textContent = `接入失败：${message}`;
      toast(`接入失败：${message}`, 'warn', 4000);
    } finally {
      if (applyBtn) (applyBtn as HTMLButtonElement).disabled = false;
    }
  }

  function pkKeysForSelectedNode() {
    const node = selectedNode();
    if (!node) { toast('先在画布上选中一个节点', 'warn', 2400); return null; }
    const names = [node.id, node.name].filter(Boolean).map(String);
    return pkChannelCache.filter((key: string) => names.some((name: string) => (
      key === name || key.startsWith(name + ':') || key.indexOf(':' + name + ':') >= 0
    )));
  }

  function initPlotkitDataBar() {
    const all = $('#pkChAll');
    const none = $('#pkChNone');
    const nodeBtn = $('#pkChNode');
    const apply = $('#pkChApply');
    if (all) all.addEventListener('click', () => {
      document.querySelectorAll<HTMLInputElement>('#pkChannelList input').forEach((i: HTMLInputElement) => { i.checked = true; });
    });
    if (none) none.addEventListener('click', () => {
      document.querySelectorAll<HTMLInputElement>('#pkChannelList input').forEach((i: HTMLInputElement) => { i.checked = false; });
    });
    if (nodeBtn) nodeBtn.addEventListener('click', () => {
      const keys = pkKeysForSelectedNode();
      if (!keys) return;
      if (!keys.length) { toast('这个节点没有探针通道', 'warn', 2400); return; }
      document.querySelectorAll<HTMLInputElement>('#pkChannelList input').forEach((i: HTMLInputElement) => { i.checked = keys.indexOf(i.value) >= 0; });
      toast(`已勾选该节点的 ${keys.length} 条通道`, 'info', 2200);
    });
    if (apply) apply.addEventListener('click', applyPkChannels);
    const retry = $('#pkChRetry');
    if (retry) retry.addEventListener('click', retryPlotkit);
    document.querySelectorAll('[data-sub="plotkit"]').forEach((btn) => {
      btn.addEventListener('click', () => setTimeout(() => refreshPkChannels(true), 60));
    });
    setInterval(() => {
      const pane = $('#tab-plotkit');
      if (pane && !pane.hidden) refreshPkChannels(true);
    }, 5000);
  }

  function initAnalWin() {
    const win = $('#analWin');
    if (!win) return;
    win.querySelector('#analWinClose')?.addEventListener('click', closeAnalysis);
    for (const btn of $$('.anal-tab')) {
      btn.addEventListener('click', () => {
        selectAnalTab(btn.dataset.anal || 'op');
        if (btn.dataset.anal === 'ac') fillAcSources();
      });
    }
    $('#analRunOp')?.addEventListener('click', () => void runOperatingPoint());
    $('#analRunAc')?.addEventListener('click', () => void runAcSweep());
    initFloatWindow(win, 'analGeo', { minWidth: 560, minHeight: 420 });
    window.addEventListener('resize', () => {
      if (!win.hidden && !(win.querySelector('.anal-pane[data-anal-pane="ac"]') as HTMLElement)?.hidden) {
        drawAcChart();
      }
    });
  }

  function initDocWin() {
    if (!ui.docWin) return;
    ui.docWin.querySelector('#docWinClose')?.addEventListener('click', closeDoc);
    ui.docSearch?.addEventListener('input', () => searchDocs(ui.docSearch.value));
    ui.docSearch?.addEventListener('keydown', (event: KeyboardEvent) => {
      if ((event as Event as KeyboardEvent).key === 'Enter') {
        const first = ui.docResults.querySelector('.doc-hit');
        if (first) (first as HTMLElement).click();
      }
      if ((event as Event as KeyboardEvent).key === 'Escape') {
        ui.docSearch.value = '';
        searchDocs('');
      }
    });
    initFloatWindow(ui.docWin, 'docGeo', { minWidth: 420, minHeight: 320 });
    const plotkitWin = $('#plotkitWin');
    if (plotkitWin) {
      initFloatWindow(plotkitWin, 'plotkitGeo', { minWidth: 720, minHeight: 480 });
      $('#plotkitWinClose')?.addEventListener('click', closePlotkit);
      $('#plotkitDock')?.addEventListener('click', togglePlotkitDock);
      window.addEventListener('resize', () => {
        if (state.plotkitDock && !plotkitWin.hidden) layoutPlotkitWindow();
      });
      $('#btnOpenPlotkit')?.addEventListener('click', () => placePlotkit('float'));
      $('#btnPlotkitInline')?.addEventListener('click', () => placePlotkit('inline'));
      $('#btnPlotkitPopup')?.addEventListener('click', () => placePlotkit('popup'));
      $('#plotkitPopout')?.addEventListener('click', () => {
        closePlotkit();
        placePlotkit('popup');
      });
    }
    const vscodeWin = $('#vscodeWin');
    if (vscodeWin) {
      initFloatWindow(vscodeWin, 'vscodeGeo', { minWidth: 720, minHeight: 520 });
      $('#vscodeWinClose')?.addEventListener('click', closeVscode);
      maybePrewarmVscode();
    }
    const wbSignalWin = $('#wbSignalWin');
    if (wbSignalWin) {
      initFloatWindow(wbSignalWin, 'wbSignalGeo', { minWidth: 280, minHeight: 320 });
      $('#wbSignalWinClose')?.addEventListener('click', () => setWbSignalDock(true));
      $('#wbSignalDockBtn')?.addEventListener('click', () => setWbSignalDock(true));
      window.addEventListener('resize', () => {
        if (activeTab() === 'wb-analysis' && wbComparePayload) renderCompareGrid();
      });
    }
    void syncProjectContext();
  }

  // ---- 参数 ? 卡片 -----------------------------------------------------------

  function attachParamHelp(cell: HTMLElement, param: ParamSpec, spec: SpecRec, role: string) {
    if (!cell) return;
    const ask = button('?', 'qbtn', (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      showHelpCard(ask, {
        title: `${param.label || param.key}（${param.key}）`,
        description: (param.help as string | undefined),
        range: paramRangeText(param),
        unit: (param.unit as string | undefined),
        def: param.default,
        formula: spec?.formula || '',
        source: spec?.source_path || '',
        role,
      });
    });
    ask.title = '四段式参数说明（说明 / 取值 / 单位与默认 / 公式）';
    ask.setAttribute('aria-label', `查看 ${param.key} 的说明`);
    cell.appendChild(ask);
  }

  // ---- 启动时保持停止 --------------------------------------------------------
  async function ensureStoppedOnBoot() {
    try {
      if (state.sim?.running) await networkControl('pause');
    } catch (error) {
      // 保持静默；状态刷新会纠正按钮
    }
  }

  // ---- 键盘：文档与设置窗 ----------------------------------------------------
  function initShellKeys() {
    document.addEventListener('keydown', (event: KeyboardEvent) => {
      // 合成事件可能把 document 当 target（无 closest），统一兜一层
      const target = event.target instanceof Element ? event.target : null;
      const typing = target?.closest('input, textarea, select, [contenteditable="true"]');
      if ((event as Event as KeyboardEvent).key === 'Escape') {
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
      const key = (event as Event as KeyboardEvent).key.toLowerCase();
      if (event.ctrlKey && key === 'k') {
        event.preventDefault();
        openDoc(state.docSlug || 'quickstart');
        setTimeout(() => ui.docSearch?.focus(), 60);
        return;
      }
      if (key === 'h') {
        event.preventDefault();
        openDoc('quickstart');
      }
      if ((event as Event as KeyboardEvent).key === '?') {
        event.preventDefault();
        openDoc('shortcuts');
      }
    });
    document.addEventListener('click', (event: MouseEvent) => {
      if (ui.qcard && !ui.qcard.hidden && !(event.target! as Element).closest('#qcard, .qbtn')) hideHelpCard();
    });
  }





  function openDocSearch() {
    openDoc(state.docSlug || 'quickstart');
    setTimeout(() => {
      if (ui.docSearch) {
        ui.docSearch.focus();
        ui.docSearch.select();
      }
    }, 90);
  }

  function syncFnRoleToSelection() {
    const type = state.selection?.type;
    if (type !== 'node' && type !== 'edge') return;
    const role = type === 'edge' ? 'edge' : 'node';
    if (state.fnRole === role) return;
    state.fnRole = role;
    state.specKind = '';
    $$('#panel .group-subnav [data-fnrole]').forEach((node) => {
      node.classList.toggle('active', node.dataset.fnrole === role);
    });
    if ($('.panel-group.active')?.dataset.group === 'fn') renderSpecPane();
  }

  setTypeLabelHelp(typeLabelHelp);
  setSwitchTab(switchTab);
  setEmptyInspectorActions({ centerPlacement, openAddMenu, fitView });
  setInspectorActions({ deleteNode, patchNodeGeometry, nodeDiameter, deleteEdge, patchEdgeGeometry, syncUI, updateScenePanelValues, renderInspector, updateSignalKeyCache, refreshState });
  setSpecPanelActions({ attachParamHelp, confirmModal, renderInspector });
  setAnalysisActions({ task, downloadText, phaseStateKeys, C, tokens });
  setGeometryActions({ distance, circuitPinPath, wirePathPoints });
  setProjectActions({
    confirmModal, applySnapshot, syncProjectContext, applyProjectUi, renderScenePanel,
    renderInspector, renderSignalList, fetchNetworks, fitView, chooseModeModal, task, showHelp,
  });

  loadUiProfile();
  boot();
  setTimeout(checkCacheQuietly, 6000);
})();

export {};
