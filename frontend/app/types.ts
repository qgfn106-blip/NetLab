/* Netlab app shared types (S5 split from app.ts; no runtime code). */

export interface SizeRec { w: number; h: number; dpr: number }
export interface ViewRec { x: number; y: number; k: number }
export interface PointerRec { x: number; y: number; wx?: number; wy?: number }
export interface SelectionRec { type: string | null; id: string | null }
export interface AppearanceRec { color?: string; opacity?: number; lineWidth?: number; fontSize?: number }
export interface HoverRec { id?: string; [k: string]: unknown }
export interface HoverWaypointRec { edgeId: string; index: number }
export interface WireToolRec { first?: { kind?: string; nodeId: string; pin?: string } | null; [k: string]: unknown }
export interface TemplateRec { name: string; label: string; mode?: string; description?: string; sim?: { fps?: number; dt?: number; steps_per_frame?: number; [k: string]: unknown }; [k: string]: unknown }
export interface OpElementRec { current?: number; voltage_difference?: number; power?: number; [k: string]: unknown }
export interface HelpInfoRec { title?: string; description?: string; range?: string; unit?: string; def?: unknown; formula?: string; source?: string; role?: string; [k: string]: unknown }
export type FloatGeo = { left: number; top: number; width: number; height: number };
export type PreviewNode = { id: string; label: string; kind: string; x: number; y: number };
export type IroPicker = { on(ev: string, cb: (color: { hexString: string }) => void): void };
export type IroGlobal = { ColorPicker: new (el: HTMLElement, opts?: Record<string, unknown>) => IroPicker };
export interface PayloadRec { name: string; kind: string; params: Record<string, unknown>; data?: Record<string, unknown>; delay?: boolean; source_port?: string; target_port?: string; waypoints?: Array<{ x: number; y: number }>; route?: string; enabled?: boolean; [k: string]: unknown }
export interface EdgeBodyRec { source: string; target: string; kind: string; params: Record<string, unknown>; enabled: boolean; route?: string; delay?: boolean; auto_delay?: boolean; source_pin?: string; target_pin?: string; [k: string]: unknown }
export interface ChartRec {
  selected: Set<string>;
  window: number;
  filter: string;
  colors: Map<string, string>;
  loop: boolean;
  hover?: HoverRec | null;
  [k: string]: unknown;
}
export interface InstrumentRec {
  meterKey: string;
  channels: (string | null)[];
  lx: string;
  ly: string;
  trail: number;
  window: number;
  scopeSize: SizeRec;
  lissSize: SizeRec;
  [k: string]: unknown;
}
export interface ReplayRec {
  active: boolean;
  playing: boolean;
  index: number;
  timer: number;
  speed: number;
  recordingRevision: number | null;
  carry?: number;
  lastTick?: number;
  [k: string]: unknown;
}
export interface UiPrefsRec {
  snap: boolean;
  grid: number;
  symbol: string;
  showGrid: boolean;
  snapMarkers: boolean;
  circuitOrthogonal: boolean;
  nodeStyle: string;
  symbolScale: number;
  glyphColor: string;
  drawingMode: boolean;
  drawingSheet?: string;
  drawingLabels?: boolean;
  drawingPage?: number;
  cardDetail?: boolean;
  cardValue?: boolean;
  showPins?: boolean;
  [k: string]: unknown;
}
export interface PrefsRec {
  theme: string;
  motion: string;
  perf: string;
  accent: string;
  accentDark?: string;
  fontScale?: number;
  density?: string;
  surfaceTone?: number;
  radius?: number;
  lineWidth?: number;
  chartPalette?: string;
  guide: string;
  infobar: boolean;
  runWarn: boolean;
  [k: string]: unknown;
}
export interface MultiRec { nodes: Set<string>; edges: Set<string>; [k: string]: unknown }
export interface ExtRec {
  list: unknown;
  scan: unknown[];
  notice: string;
  code: string;
  result: unknown;
  [k: string]: unknown;
}
export interface ProjectRec {
  name: string;
  path: string;
  dirty: boolean;
  autosave: boolean;
  autosaveInterval: number;
  autosavedAt: number;
  recent: { path: string; name: string; at?: number }[];
  desktop: boolean;
  [k: string]: unknown;
}
export interface NodeItem {
  id: string;
  name: string;
  kind: string;
  type: string;
  x: number;
  y: number;
  label?: string;
  params?: Record<string, unknown>;
  inputs?: unknown;
  state?: unknown;
  data?: Record<string, unknown>;
  position?: { x: number; y: number };
  size?: { w?: number; h?: number; [k: string]: unknown };
  appearance?: AppearanceRec;
  [k: string]: unknown;
}
export interface EdgeItem {
  id: string;
  name: string;
  kind: string;
  anchors?: { source?: string; target?: string; [k: string]: unknown };
  delay?: number;
  enabled?: boolean;
  layout?: LayoutRec;
  params?: Record<string, unknown>;
  route?: unknown;
  source: string;
  source_pin?: string;
  source_port?: string;
  target: string;
  target_pin?: string;
  target_port?: string;
  state?: unknown;
  waypoints?: { x: number; y: number }[];
  appearance?: AppearanceRec;
  [k: string]: unknown;
}
export interface SceneRec {
  nodes: NodeItem[];
  edges: EdgeItem[];
  integration?: unknown;
  mode?: string;
  revision: number;
  sim?: SimRec;
  [k: string]: unknown;
}
export interface SimRec {
  running: boolean;
  probe_keys: string[];
  cursor: number;
  steps: number;
  actual_fps?: number;
  config?: { fps?: number; steps_per_frame?: number; dt?: number; [k: string]: unknown };
  stats?: { kind?: string; matrix_size?: number; [k: string]: unknown };
  dt?: number;
  time?: number;
  alerts?: number;
  warnings?: number;
  scene?: SimStats;
  degraded?: DegradedRec;
  [k: string]: unknown;
}
export interface LimitsRec { nodes: number; edges: number; [k: string]: unknown }
export interface DegradedItemRec { id: string; version: number; [k: string]: unknown }
export interface LayoutRec { x: number; y: number; rot: number; [k: string]: unknown }
export interface SimStats { kind?: string; matrix_size?: number; step_ms?: number; iterations?: number; [k: string]: unknown }
export interface DegradedRec { read_only?: boolean; missing?: DegradedItemRec[]; message?: string; [k: string]: unknown }

export interface CatalogRec {
  circuit_nodes: SpecRec[];
  computes: SpecRec[];
  elements: SpecRec[];
  methods: SpecRec[];
  limits?: LimitsRec;
  [k: string]: unknown;
}
export interface FrameItem { t: number; v: Record<string, number>; field?: unknown; min?: number; max?: number }
export interface NetworkItem { id: string; name: string; current?: boolean; [k: string]: unknown }
export interface BlockItem { id: string; name: string; nodes?: NodeItem[]; edges?: EdgeItem[]; ports?: PortSpec[]; version?: number; model?: string; kind?: string; label?: string; mode?: string; node_count?: number; builtin?: boolean; inputs?: PortSpec[]; outputs?: PortSpec[]; params?: unknown[]; expression?: string; description?: string; source?: string; [k: string]: unknown }
export interface DocItem { slug: string; title: string; [k: string]: unknown }
export interface DragRec {
  anchor?: string;
  diameter?: number;
  end?: string;
  id?: string;
  index?: number;
  sourceId?: string;
  targetId?: string | null;
  pin?: string;
  type?: string;
  startX?: number;
  startY?: number;
  x?: number;
  y?: number;
  viewX?: number;
  viewY?: number;
  originX?: number;
  originY?: number;
  startDiameter?: number;
  moved?: boolean;
  [k: string]: unknown;
}
export interface SnapshotRec { scene?: SceneRec; sim?: SimRec; limits?: LimitsRec; [k: string]: unknown }
export interface DataHolder { name?: string; data?: Record<string, unknown>; output?: unknown; state?: unknown; [k: string]: unknown }
export interface BoxRec { x: number; y: number; w: number; h: number; [k: string]: unknown }
export interface Pt { x: number; y: number }
export interface BezierRec { p0: Pt; p1: Pt; p2: Pt; p3: Pt }
export interface MenuItemRec { label?: string; hint?: string; sep?: boolean; disabled?: boolean; action?: (() => void) | null; children?: MenuItemRec[]; [k: string]: unknown }
export interface DeclaredItemRec { kind?: string; function?: string; name?: string; [k: string]: unknown }
export interface RailItemRec { [k: string]: unknown }
export interface IssueRec { code?: string; message?: string; [k: string]: unknown }
export interface ComplexLike { real?: number; re?: number; imag?: number; im?: number }
export interface TfMetricsRec { final?: number; peak_value?: number; peak_time?: number; overshoot_pct?: number; rise_time?: number; settling_time?: number; steady_state_error?: number; [k: string]: unknown }
export interface TfStepRec { metrics?: TfMetricsRec; stable?: boolean; t?: number[]; y?: number[]; [k: string]: unknown }
export interface TfBodeRec { omega?: number[]; magnitude_db?: number[]; phase_deg?: number[]; [k: string]: unknown }
export interface StateSpaceRec { order?: number; [k: string]: unknown }
export interface TfDataRec { step?: TfStepRec; bode?: TfBodeRec; poles?: ComplexLike[]; zeros?: ComplexLike[]; assumptions?: string[]; stability?: 'stable' | 'marginal' | 'unstable'; expression?: string; order?: number; relative_order?: number; dc_gain?: number; dc_gain_finite?: boolean; state_space?: StateSpaceRec; [k: string]: unknown }
export interface PerfRowRec { name?: string; count?: number; total_ms?: number; mean_ms?: number; max_ms?: number; [k: string]: unknown }
export interface CacheEntryRec { path?: string; size?: number; exists?: boolean; [k: string]: unknown }
export interface ClipboardRec { nodes: NodeItem[]; edges: EdgeItem[]; networkId?: string; [k: string]: unknown }
export interface ExtItemRec { label?: string; kind?: string; type?: string; filename?: string; sha256?: string; error?: string; params?: unknown[]; source?: unknown; [k: string]: unknown }
export interface ExtResultRec { kind?: string; message?: string; detail?: unknown; [k: string]: unknown }
export interface SpectrumRec { magnitude?: number[]; freqs?: number[]; [k: string]: unknown }
export interface AcResultRec { probes?: Record<string, unknown>; input?: string; frequencies?: number[]; [k: string]: unknown }
export type FieldKey = string
export interface FloatWindowSpec { minWidth?: number; minHeight?: number; [k: string]: unknown }
export interface Ui {
  main: HTMLElement;
  panel: HTMLElement;
  graph: HTMLCanvasElement;
  modePill: HTMLElement;
  runBtn: HTMLElement;
  runIcon: HTMLElement;
  runLabel: HTMLElement;
  simTime: HTMLElement;
  simFps: HTMLElement;
  simSteps: HTMLElement;
  statusMode: HTMLElement;
  statusEngine: HTMLElement;
  statusHint: HTMLElement;
  statusCursor: HTMLElement;
  statusLimits: HTMLElement;
  errorBanner: HTMLElement;
  zoomBadge: HTMLElement;
  addMenu: HTMLElement;
  linkMenu: HTMLElement;
  modal: HTMLElement;
  modalCard: HTMLElement;
  toasts: HTMLElement;
  inspector: HTMLElement;
  specPane: HTMLElement;
  extPane: HTMLElement;
  blocksPane: HTMLElement;
  analysisPane: HTMLElement;
  chartPane: HTMLElement;
  instPane: HTMLElement;
  instWindow: HTMLInputElement;
  instStatus: HTMLElement;
  instMeterKey: HTMLInputElement;
  instValNow: HTMLElement;
  instValMean: HTMLElement;
  instValRms: HTMLElement;
  instValPP: HTMLElement;
  instValMinMax: HTMLElement;
  instLegend: HTMLElement;
  instLX: HTMLInputElement;
  instLY: HTMLInputElement;
  instTrail: HTMLInputElement;
  instCh: HTMLInputElement[];
  scenePane: HTMLElement;
  settingsScene: HTMLElement;
  settingsWin: HTMLElement;
  settingsClose: HTMLElement;
  guide: HTMLElement;
  guideEnter: HTMLElement;
  guideDocs: HTMLElement;
  guideDemo: HTMLElement;
  guideClose: HTMLElement;
  docWin: HTMLElement;
  analWin: HTMLElement;
  moduleWin: HTMLElement;
  moduleWinTitle: HTMLElement;
  moduleWinHint: HTMLElement;
  modulePorts: HTMLElement;
  moduleMeta: HTMLElement;
  moduleStage: HTMLElement;
  moduleCanvas: HTMLCanvasElement;
  phaseCanvas: HTMLCanvasElement;
  moduleEmpty: HTMLElement;
  moduleDock: HTMLElement;
  moduleWinClose: HTMLElement;
  moduleEdit: HTMLElement;
  moduleAddInstance: HTMLElement;
  docNav: HTMLElement;
  docMain: HTMLElement;
  docContent: HTMLElement;
  docSearch: HTMLInputElement;
  docResults: HTMLElement;
  docTitle: HTMLElement;
  qcard: HTMLElement;
  signalList: HTMLElement;
  legend: HTMLElement;
  chartWindow: HTMLInputElement;
  chartTimeline: HTMLInputElement;
  chartReplayTime: HTMLElement;
  topTimeline: HTMLInputElement;
  topTimelineTime: HTMLElement;
  btnReplay: HTMLButtonElement;
  replaySpeed: HTMLInputElement;
  replaySpeedVal: HTMLElement;
  btnPrecompute: HTMLElement;
  chartLoop: HTMLInputElement;
  btnLive: HTMLButtonElement;
  btnResolve: HTMLButtonElement;
  chartStatus: HTMLElement;
  signalSearch: HTMLInputElement;
  btnClearChart: HTMLElement;
  vectorPane: HTMLElement;
  phaseReadout: HTMLElement;
  vectorNode: HTMLInputElement;
  vectorTrail: HTMLInputElement;
  phasePlay: HTMLElement;
  phaseStep: HTMLElement;
  phaseExport: HTMLElement;
  phasePlotkit: HTMLElement;
  phaseLoop: HTMLInputElement;
  phaseFrame: HTMLInputElement;
  phaseFrameLabel: HTMLElement;
  workspaceSwitch: HTMLElement;
  sessionClock: HTMLElement;
  exitBtn: HTMLElement;
  menuItems: HTMLElement;
  infoBar: HTMLElement;
  networks: HTMLElement;
  networkList: HTMLElement;
  netAdd: HTMLElement;
  netRename: HTMLElement;
  netDelete: HTMLElement;
  netResize: HTMLElement;
  netHanger: HTMLElement;
  panelHanger: HTMLElement;
  panelResize: HTMLElement;
  guideOpenProject: HTMLElement;
  guideSettings: HTMLElement;
}
export interface State {
  catalog: CatalogRec | null;
  templates: TemplateRec[];
  mode: string;
  scene: SceneRec | null;
  sim: SimRec | null;
  limits: LimitsRec | null;
  selection: SelectionRec;
  inspectorId: string | null;
  inspectorDirty: boolean;
  hover: HoverRec | null;
  view: ViewRec;
  canvasSize: SizeRec;
  chartSize: SizeRec;
  pointer: PointerRec;
  drag: DragRec | null;
  needsDraw: boolean;
  lastPaint: number;
  busy: boolean;
  liveBusy: boolean;
  stateBusy: boolean;
  cursor: number;
  frames: FrameItem[];
  values: Map<string, number>;
  nodeValues: Map<string, Record<string, number>>;
  edgeValues: Map<string, Record<string, number>>;
  probeKeys: string[];
  probeLabels: Record<string, string>;
  probeSignature: string;
  chart: ChartRec;
  instrument: InstrumentRec;
  replay: ReplayRec;
  pollTimer: number;
  chartTimer: number;
  stateTimer: number;
  lastStateFetch: number;
  dismissedError: string | null;
  dirtyPositions: Map<string, { x: number; y: number }>;
  positionTimer: number;
  booted: boolean;
  selectionBusy: boolean;
  specRole: string;
  fnRole: string;
  networks: NetworkItem[];
  currentNetwork: NetworkItem | null;
  blocks: BlockItem[];
  blocksLibrary: string;
  blocksStructural: boolean;
  analysisLast: string;
  analysisSpectrum: unknown;
  analysisTF: TfDataRec | null;
  tfCursor: number | null;
  tfDragging: boolean;
  degradedBanner: boolean;
  ui: UiPrefsRec;
  prefs: PrefsRec;
  palette: unknown;
  settings: unknown;
  docs: DocItem[];
  docSlug: string;
  docGeo: unknown;
  plotkitGeo: unknown;
  vscodeGeo: unknown;
  plotkitDock: boolean;
  settingsGeo: unknown;
  moduleGeo: unknown;
  wbSignalGeo: unknown;
  wbSignalDock: boolean;
  moduleBlock: unknown;
  moduleDock: boolean;
  guideMode: string;
  guideShown: boolean;
  uiReady: boolean;
  multi: MultiRec;
  undoStack: unknown[];
  redoStack: unknown[];
  clipboard: ClipboardRec | null;
  specKind: string;
  ext: ExtRec;
  lastLiveError: number;
  workspace: string;
  phaseSize: SizeRec;
  phaseNode: string;
  phaseTrail: number;
  phaseIndex: number | null;
  phasePlaying: boolean;
  phaseLoop: boolean;
  phasePlayTimer: number;
  phaseTimer: number;
  shuttingDown: boolean;
  project: ProjectRec;
  acResult?: unknown;
  acRevision?: number | null;
  floatZ?: number;
  hoverWaypoint?: HoverWaypointRec | null;
  plotkitActive?: boolean;
  plotkitMode?: string;
  precomputedRevision?: number | null;
  precomputedSeconds?: number | null;
  wireTool?: WireToolRec | null;
}

export interface ParamSpec {
  key: string;
  default?: unknown;
  [k: string]: unknown;
}
export interface PortSpec {
  name: string;
  [k: string]: unknown;
}
export interface SpecRec {
  kind: string;
  label?: string;
  params?: ParamSpec[];
  ports?: PortSpec[];
  inputs?: PortSpec[];
  outputs?: PortSpec[];
  mode?: string;
  model?: string;
  version?: number;
  node_count?: number;
  builtin?: boolean;
  formula?: string;
  description?: string;
  source?: string;
  source_path?: string;
  [k: string]: unknown;
}
