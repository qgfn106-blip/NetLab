/* 分析工作台布局/画布登记的持久化模型（schema v2）。
 *
 * v2 把布局从全局 grid/tile/split/max 模式改为 Tab → SplitTree → Leaf：
 * 工程保存 tabs（每个标签页一棵 LayoutNode 树）、当前标签页、侧栏宽度与折叠状态。
 * 旧工程（schema /1 的 mode/rows/cols/order）在读取时自动迁移。
 * 本模块只做数据规范化，不依赖 DOM。
 */
import type { AnalysisKind } from './analysis_workbench_meta.js';
import type { WorkbenchCanvasRec, WorkbenchLayoutRecV2 } from './analysis_workbench_layout_tree.js';
import { emptyLayout, normalizeLayout } from './analysis_workbench_layout_tree.js';

export type { WorkbenchCanvasRec } from './analysis_workbench_layout_tree.js';

export const WORKBENCH_SCHEMA = 'netlab-analysis-workbench/2';
export const LEGACY_WORKBENCH_SCHEMA = 'netlab-analysis-workbench/1';
export const WORKBENCH_KINDS: AnalysisKind[] = ['bode', 'time', 'nyquist', 'loop', 'metrics', 'poles', 'loop_closed', 'loop_step'];

export interface WorkbenchUiRec {
  schema: string;
  active_analysis: AnalysisKind;
  canvases: WorkbenchCanvasRec[];
  layout: WorkbenchLayoutRecV2;
  sizes: { sidebar: number; detail: number };
  collapsed: { sidebar: boolean; detail: boolean };
  selected_state_ids: string[];
}

export function defaultWorkbenchUi(): WorkbenchUiRec {
  return {
    schema: WORKBENCH_SCHEMA,
    active_analysis: 'bode',
    canvases: [],
    layout: emptyLayout(),
    sizes: { sidebar: 280, detail: 320 },
    collapsed: { sidebar: false, detail: false },
    selected_state_ids: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asKind(value: unknown): AnalysisKind | null {
  return WORKBENCH_KINDS.includes(value as AnalysisKind) ? value as AnalysisKind : null;
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function normalizeCanvas(value: unknown, index: number): WorkbenchCanvasRec | null {
  if (!isRecord(value)) return null;
  const kind = asKind(value.kind);
  const id = typeof value.canvas_id === 'string' ? value.canvas_id.trim() : '';
  if (!kind || !id) return null;
  const view = isRecord(value.view_state) ? value.view_state : undefined;
  return {
    canvas_id: id,
    kind,
    figure_id: typeof value.figure_id === 'string' && value.figure_id ? value.figure_id : 'f1',
    slot_id: integer(value.slot_id, index, 0, 63),
    title: typeof value.title === 'string' && value.title ? value.title : '',
    ...(view ? { view_state: view } : {}),
    ...(typeof value.result_key === 'string' && value.result_key ? { result_key: value.result_key } : {}),
    ...(Array.isArray(value.result_keys) ? { result_keys: value.result_keys.filter((item): item is string => typeof item === 'string' && item !== '') } : {}),
  };
}

/** 读取工程 ui.analysis_workbench；返回 restored=false 表示旧工程/损坏数据用了默认值。 */
export function readWorkbenchUi(value: unknown): { ui: WorkbenchUiRec; restored: boolean } {
  const ui = defaultWorkbenchUi();
  if (!isRecord(value)) return { ui, restored: false };
  const source = value;
  let restored = source.schema === WORKBENCH_SCHEMA;
  const seen = new Set<string>();
  const canvases: WorkbenchCanvasRec[] = [];
  if (Array.isArray(source.canvases)) {
    source.canvases.forEach((item, index) => {
      const rec = normalizeCanvas(item, index);
      if (!rec || seen.has(rec.canvas_id)) return;
      seen.add(rec.canvas_id);
      rec.slot_id = canvases.length;
      canvases.push(rec);
    });
  }
  ui.canvases = canvases;
  ui.active_analysis = asKind(source.active_analysis) || 'bode';
  const legacy = source.schema === LEGACY_WORKBENCH_SCHEMA || (isRecord(source.layout) && !Array.isArray(source.layout.tabs));
  ui.layout = normalizeLayout(source.layout, canvases.map((canvas) => canvas.canvas_id), legacy);
  if (isRecord(source.sizes)) {
    ui.sizes = {
      sidebar: integer(source.sizes.sidebar, 280, 160, 640),
      detail: integer(source.sizes.detail, 320, 200, 720),
    };
  }
  if (isRecord(source.collapsed)) {
    ui.collapsed = {
      sidebar: source.collapsed.sidebar === true,
      detail: source.collapsed.detail === true,
    };
  }
  if (Array.isArray(source.selected_state_ids)) {
    ui.selected_state_ids = [...new Set(source.selected_state_ids.filter((item): item is string => typeof item === 'string' && item !== ''))].slice(0, 8);
  }
  if (!restored && Array.isArray(source.canvases) && source.canvases.length) restored = true;
  return { ui, restored };
}

export function writeWorkbenchUi(value: WorkbenchUiRec): WorkbenchUiRec {
  return readWorkbenchUi(value).ui;
}
