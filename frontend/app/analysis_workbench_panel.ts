import { fmt, intText, clamp, hashString, baseName } from '../app.utils.js';
import {
  CANVAS_LIGHT, CANVAS_DARK,
  CHART_PALETTE_HC_LIGHT, CHART_PALETTE_HC_DARK,
  CHART_PALETTE_CB_LIGHT, CHART_PALETTE_CB_DARK,
} from '../theme.tokens.js';
import type { AcResultRec, AppearanceRec, BezierRec, BlockItem, BoxRec, CacheEntryRec, CatalogRec, ChartRec, ClipboardRec, ComplexLike, DataHolder, DeclaredItemRec, DegradedItemRec, DegradedRec, DocItem, DragRec, EdgeBodyRec, EdgeItem, ExtItemRec, ExtRec, ExtResultRec, FieldKey, FloatGeo, FloatWindowSpec, FrameItem, HelpInfoRec, HoverRec, HoverWaypointRec, InstrumentRec, IroGlobal, IroPicker, IssueRec, LayoutRec, LimitsRec, MenuItemRec, MultiRec, NetworkItem, NodeItem, OpElementRec, ParamSpec, PayloadRec, PerfRowRec, PointerRec, PortSpec, PrefsRec, PreviewNode, ProjectRec, Pt, RailItemRec, ReplayRec, SceneRec, SelectionRec, SimRec, SimStats, SizeRec, SnapshotRec, SpecRec, SpectrumRec, State, StateSpaceRec, TemplateRec, TfBodeRec, TfDataRec, TfMetricsRec, TfStepRec, Ui, UiPrefsRec, ViewRec, WireToolRec } from './types.js';
import { UI_BUILD, PALETTE, GROUP_COLORS, NODE_RADIUS, NODE_W, NODE_H, CHART_KEYS, MAX_IMPORT_BYTES, MAX_FRAMES, INST_COLORS } from './constants.js';
import { $, $$, stage, canvas, ctx, chartCanvas, chartCtx, phaseCanvas, phaseCtx, scopeCanvas, scopeCtx, lissCanvas, lissCtx } from './dom.js';
import { roundRectPath, pointerPosition, frameCap } from './canvas_geometry.js';
import { drawWbSubplot } from './wb_subplot.js';
import { drawModulePreview } from './module_preview.js';
import { drawChart } from './chart_draw.js';
import { state, ui } from './state.js';
import type { ApiOptions } from './net.js';
import { el, div, button, clone, isFormTarget } from './ui.js';
import { normalizeCardFields } from './card_fields.js';
import { applyGridPayload, normaliseAngleSet } from './grid_prefs.js';
import { desktopBridge, isDesktop, callBridge, toast, showBanner, hideBanner } from './desktop.js';
import { openExportDialog, type ExportChoice, type ExportDestination, type ExportStyle } from './export_dialog.js';
import { api, jsonRequest, plotkitFrameUrl } from './net.js';
import { openCacheDialog, checkCacheQuietly } from './cache.js';
import { appearancePanelTitle, collectAppearanceTargets, renderAppearancePanel } from './appearance_panel.js';
import { placeFloatWindow, placeDocWindow, raiseFloatWindow, toggleFloatMaximize, initFloatWindow } from './float.js';
import { CHART_PALETTE, chartPalette, themeKey } from './theme.js';
import { hexToRgb, hexToRgbString, mixHex } from './color.js';
import { THEME_TOKENS, C, tokens, setRuntimeOverride } from './colors.js';
import { formatAny, valueToText, parseSmartValue, kindListFor, buildKindSelect, numberedField, UNIT_PREFIXES, PREFIXABLE_UNITS, unitStorageKey, savedUnitFactor, bestUnitFactor, trimNumber } from './fields.js';
import { buildParamField, applyPresetOnModelChange, applyWaveFieldVisibility, buildWaveFieldVisibility, buildParamFields, collectParamValues, dataRow, collectData, markDirty, clearDirty, setTypeLabelHelp } from './param_fields.js';
import { hideHelpCard, showHelpCard, typeLabelHelp, paramRangeText, setSwitchTab } from './help_card.js';
import { appearanceOf, activeTab, modeLabel, selectedNode, selectedEdge, nodeById, edgeById, nodeByName, edgeByName, getNodeSpec, getEdgeSpec, specDefaults, uniqueNodeName, hasGroundNode, displayDataFor, nodeDisplayData, edgeDisplayData } from './model.js';
import { PLOT_SEMANTICS, frameSeriesToPoints, buildPlotLineLayers } from './plot_semantics.js';
import { createParamGroupTable, fallbackParams } from './param_groups.js';
import { groupNodeSpecs } from './menu_model.js';
import { drawEdges, labelCollisionFree } from './canvas_edges.js';
import { SHEET_SIZES, drawDrawingFrame, pipeModeLabel, drawLinkPreview, drawGraph, drawSelectionBox, drawDragHud, requestDraw, __graphMs, __dbgGraph, animationLoop } from './canvas_render.js';
import { openIroColorPopover, setGroupSub, blockBadges, numberInput, modulePortList, captureSceneSnapshot, fieldFor, wbFmtAxis, wbToggleInArray, setPanelGroup, previewElementAppearance, plotkitFrames, closeMenus, wbBadge } from './ui_helpers.js';
import { drawPhase, phaseFrameCount, phaseStateKeys, renderVectorNodeList, resizePhase, schedulePhaseDraw, setPhaseIndex, stopPhasePlay, togglePhasePlay } from './phase.js';
import { setInstrumentActions, loadInstrumentPrefs, saveInstrumentPrefs, fillInstrumentSelects, renderInstrumentMeter, instrumentSelectGroups, instrumentFrames, instrumentSurface, drawScope, drawLissajous, drawInstruments, resizeInstrument, bindInstrumentEvents, initInstruments } from './instruments.js';
import { circuitCrossingMap, circuitPinPath, drawCrossingHops, drawGrid, drawMultiPinWires, edgeAnchorTowards, edgeValueText, elementIdentifier, gridPattern, nodeColor, nodeKindLabel, nodeValueText, pinScreenPoint, segmentIntersection, wirePathPoints, KIND_COLORS, KIND_SHORT } from './canvas_base.js';
import { drawGbCircuitNode, drawGbFunctionGlyph, drawGbDeviceNode } from './canvas_glyphs.js';
import { drawNodes } from './canvas_nodes.js';
import { sectionLabel, section, buildHeader, renderEmptyInspector, setEmptyInspectorActions } from './inspector_shell.js';
import { modulePorts, deviceElementSpec, isPinNode, devicePins, buildDevicePinList } from './device_pins.js';
import { renderNodeInspector, renderWireInspector, renderEdgeInspector, applyInspector, updateInspectorLive, setInspectorActions } from './inspector.js';
import { renderSpecPane, scheduleSpecRender, renderExtensionPanel, refreshExtensions, setSpecPanelActions } from './spec_panel.js';
import { applyNumericProjectUi, AUTOSAVE_ENABLED_KEY, setProjectActions, setProjectFileInput, markProjectDirty, projectSaved, rememberRecent, loadRecent, updateProjectPanel, buildProjectPayload, projectDownloadText as downloadText, saveProject, importProjectText, openProject, openProjectPath, newProject, recoverAutosave, autosaveProject, maybeOfferRecovery, initProject } from './project.js';
import { ACCENT_SWATCHES, PREF_CACHE_KEY, PREF_DEFAULTS, FONT_SCALES, RADIUS_STEPS, LINE_STEPS, CHART_MODES, activeAccent, computeRuntimeOverride, applyAppearance, resolveTheme, readPrefCache, writePrefCache, loadUiPrefs, PREF_SETTING_KEYS, setPref, syncPrefControls, setAppearanceActions } from './appearance.js';
import { initAppearanceControls, resetAppearance, saveAutosaveSetting, TelemetryQuality, formatQualityNumber, setQualityText, refreshTelemetryQuality, setAppearanceControlActions } from './appearance_controls.js';
import { setGeometryActions, worldToScreen, screenToWorld, nodeDiameter, nodeRect, isModuleNode, devicePinGroups, deviceWorldSize, deviceRect, devicePinLocal, devicePinWired, deviceSupplyLabel, deviceMissingPins, deviceImplicitGroundPin, deviceInactive, devicePinScreen, snapWorld, portOut, portIn, curveFor, nodeCenterScreen, anchorPoint, edgeEndpointHit, waypointHitAt, anchorSideFor, anchorScreenPoint, edgePathPoints, pathSegments, pathPointAt, pathMidpoint, pathEndAngle, distanceToPath, vectorForNode, bezierPoint } from './geometry.js';
import { analysisSignalKey, analysisGet, setAnalysisOutput, runAnalysisMetrics, runAnalysisSpectrum, runAnalysisPeriod, runAnalysisMath, runAnalysisTransfer, fmtComplex, analysisTFSummary, runAnalysisTF, drawAnalysisTF, tfRange, drawTFBode, tfBodeCursorFromEvent, attachTfCursor, drawTFStep, drawTFPoles, exportTFStateSpace, sendCurveToPlotKit, sendTFToPlotKit, phaseSeriesForPlotKit, sendPhaseToPlotKit, exportAnalysisCsv, drawAnalysisSpectrum, setAnalysisActions } from './analysis.js';
import { analEscape, analNum, analToken, analysisWarn, openAnalysis, closeAnalysis, selectAnalTab, runOperatingPoint } from './ac_analysis.js';
import { pkChannelCache, pkKeyShort, pkCheckedKeys, renderPkChannels, showPkChannelLoadError, refreshPkChannels, retryPlotkit, reloadPlotkitFrame, PrecomputeProgress, mountPrecomputeBar, paintPrecomputeBar, runPrecomputeWithProgress, syncAfterPrecompute, applyPkChannels, pkKeysForSelectedNode, initPlotkitDataBar, setPlotkitDataActions } from './plotkit_data.js';
import { plotkitReady, layoutPlotkitWindow, togglePlotkitDock, ensurePlotkitFrame, placePlotkit, openPlotkit, closePlotkit, vscodeStarting, ensureVscodeFrame, openVscode, closeVscode, vscodeWasUsed, maybePrewarmVscode } from './plotkit_frame.js';
import { initAnalWin, initDocWin, setWindowActions } from './windows.js';
import { ensureDocs, docBySlug, openDoc, closeDoc, renderDocNav, renderDocBody, renderInline, renderMarkdown, docSearchSeq, searchDocs, setDocsActions } from './docs.js';
import { openSettings, closeSettings, setSettingsPane, initSettingsWin, showGuide, hideGuide, selectGuideMode, enterGuideScene, initGuide, setGuideActions } from './settings_guide.js';
import { setPlotkitFrameActions } from './plotkit_frame.js';
import { circuitMidAngle, drawCircuitGlyph, circuitWireGap, drawJunctionDots, elementPins, elementLayoutCenter, elementRot, symbolScalePx } from './circuit_symbols.js';
import { closeModal, openConfirmModal as confirmModal, openModeModal as chooseModeModal } from './dialogs_build.js';
import { wbCommitNodeParam, wbCommitEdgeParam, wbCommitSimParam, wbCommitIntegration, type ParamCommitDeps } from './param_commit.js';

export interface AnalysisWorkbenchPanelDeps {
  colorForKey: (key: string) => string;
  decodeProbeKey: (key: string) => { label: string };
  openPrecomputeDialog: (initial?: 'solve' | 'plotkit' | 'states', onRun?: () => void) => void;
  applySnapshot: (snapshot: SnapshotRec) => void;
}

import { createChartRenderer, initWorkbenchChart, type ChartRenderer, type WbRendererKind } from './analysis_workbench_chart.js';

let deps: AnalysisWorkbenchPanelDeps;
let paramCommitDeps: ParamCommitDeps;

export function initAnalysisWorkbenchPanel(d: AnalysisWorkbenchPanelDeps): void {
  deps = d;
  paramCommitDeps = { state, toast, jsonRequest, wbMarkDirty, applySnapshot: d.applySnapshot };
  initWorkbenchChart({ colorForKey: d.colorForKey, getCompareLayout: () => wbCompareLayout });
}

export function getWbCompareStateIds(): string[] { return wbCompareStateIds; }
export function getWbCacheStatus(): WbCacheStatusPayload | null { return wbCacheStatus; }
export function getWbComparePayload(): WbComparePayload | null { return wbComparePayload; }

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


function wbMarkDirty(): void {
  wbDirty = true;
  const badge = $('#wbDirtyBadge');
  if (badge) {
    badge.textContent = '未保存到状态';
    badge.className = 'badge violet';
  }
  markProjectDirty();
}

export function renderWorkbenchAnalysis(): void {
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
    button('打开电路分析工作台', 'btn tiny primary', () => openAnalysis('ac')),
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
export async function syncProjectContext(): Promise<void> {
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


function wbAvailableProbes(): string[] {
  const set = new Set<string>();
  const rows = wbCacheStatus?.states || [];
  const pick = rows.filter((row) => wbCompareStateIds.indexOf(String(row.state_id)) >= 0);
  const source = pick.length ? pick : rows;
  for (const row of source) for (const probe of row.probes || []) set.add(String(probe));
  if (!set.size) {
    // 正常使用显示名；raw probe_keys 仅作最后兜底。
    const keys = (state.probeKeys.length ? state.probeKeys : (state.sim?.probe_keys || [])) as string[];
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
export async function refreshWbAnalysis(): Promise<void> {
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
    swatch.style.background = deps.colorForKey(key);
    const nameSpan = el('span', null, deps.decodeProbeKey(key).label);
    nameSpan.title = key;
    label.append(box, swatch, nameSpan);
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
export function setWbSignalDock(docked: boolean): void {
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


/** 多子图网格：每状态一子图，共享 x 范围与信号组，按列数自由排布但坐标对齐。 */
export function renderCompareGrid(): void {
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

async function wbPrecomputeSelected(): Promise<void> {
  deps.openPrecomputeDialog('states');
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


export async function renderWorkbenchState(): Promise<void> {
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

  const { table, addRow, applyFilter: applyGroupFilter } = createParamGroupTable();

  const scene = state.scene;
  for (const node of scene?.nodes || []) {
    const spec = getNodeSpec(node.kind);
    const list = spec && Array.isArray(spec.params) && spec.params.length ? spec.params : fallbackParams(node.params);
    if (!list.length) continue;
    const baseParams = spec ? Object.assign(specDefaults(spec), node.params || {}) : Object.assign({}, node.params || {});
    for (const param of list) {
      const value = param.key in baseParams ? baseParams[param.key] : clone(param.default);
      const control = buildParamField(param, value);
      control.addEventListener('change', () => void wbCommitNodeParam(paramCommitDeps, node.id, control, baseParams));
      addRow(`${node.name} · ${node.kind}`, node.id, String(param.label || param.key), control);
    }
  }
  for (const edge of scene?.edges || []) {
    const spec = getEdgeSpec(edge.kind);
    const list = spec && Array.isArray(spec.params) && spec.params.length ? spec.params : fallbackParams(edge.params);
    if (!list.length) continue;
    const baseParams = spec ? Object.assign(specDefaults(spec), edge.params || {}) : Object.assign({}, edge.params || {});
    for (const param of list) {
      const value = param.key in baseParams ? baseParams[param.key] : clone(param.default);
      const control = buildParamField(param, value);
      control.addEventListener('change', () => void wbCommitEdgeParam(paramCommitDeps, edge.id, control, baseParams));
      addRow(`${edge.name || edge.id} · ${edge.kind}`, edge.id, String(param.label || param.key), control);
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
    control.addEventListener('change', () => void wbCommitSimParam(paramCommitDeps, field.key, control));
    addRow('仿真设置', 'sim', field.label, control);
  }
  const integValue = String(scene?.integration || 'trapezoidal');
  const integSpec: ParamSpec = {
    key: 'integration',
    type: 'choice',
    label: '积分方法',
    choices: ['trapezoidal', 'backward_euler', 'gear2'],
  };
  const integControl = buildParamField(integSpec, integValue);
  integControl.addEventListener('change', () => void wbCommitSimParam(paramCommitDeps, 'integration', integControl));
  addRow('仿真设置', 'sim', '积分方法', integControl);

  const applyFilter = (): void => applyGroupFilter(wbFilterText);
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
    deps.applySnapshot(resp);
    wbSelectedId = id;
    wbDirty = false;
    markProjectDirty();
    await renderWorkbenchState();
  } catch (error) {
    toast((error as Error)?.message || String(error), 'error', 6000);
  }
}
