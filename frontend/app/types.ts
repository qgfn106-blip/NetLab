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
