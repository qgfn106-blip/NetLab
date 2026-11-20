/* 分析工作台布局/画布登记的持久化模型。
 *
 * 只做数据规范化，不依赖 DOM：工程文件 ui.analysis_workbench 与前端运行时共用
 * 同一份结构，旧工程缺失或字段损坏时回落到默认值，并在 restored=false 时提示。
 */
import type { AnalysisKind } from './analysis_workbench_meta.js';

export const WORKBENCH_SCHEMA = 'netlab-analysis-workbench/1';
export const WORKBENCH_KINDS: AnalysisKind[] = ['bode', 'time', 'nyquist', 'loop', 'metrics', 'poles', 'loop_closed', 'loop_step'];
export type LayoutMode = 'grid' | 'tile' | 'split' | 'max';
export const WORKBENCH_LAYOUT_MODES: LayoutMode[] = ['grid', 'tile', 'split', 'max'];

export interface WorkbenchCanvasRec {
  canvas_id: string;
  kind: AnalysisKind;
  figure_id: string;
  slot_id: number;
  title: string;
  view_state?: Record<string, unknown>;
  /** 该画布最近一次成功运行的结果 key（导出时绑定实际结果，避免同状态同类型串结果）。 */
  result_key?: string;
  /** 多状态对比时该画布对应的各状态结果 key（导出绑定用）。 */
  result_keys?: string[];
}

export interface WorkbenchLayoutRec {
  mode: LayoutMode;
  rows: number;
  cols: number;
  order: string[];
}

export interface WorkbenchUiRec {
  schema: string;
  active_analysis: AnalysisKind;
  canvases: WorkbenchCanvasRec[];
  layout: WorkbenchLayoutRec;
  sizes: { sidebar: number; detail: number };
  selected_state_ids: string[];
}

export function defaultWorkbenchUi(): WorkbenchUiRec {
  return {
    schema: WORKBENCH_SCHEMA,
    active_analysis: 'bode',
    canvases: [],
    layout: { mode: 'grid', rows: 1, cols: 1, order: [] },
    sizes: { sidebar: 280, detail: 320 },
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
  const seen = new Set<string>();
  const canvases: WorkbenchCanvasRec[] = [];
  if (Array.isArray(source.canvases)) {
    for (const [index, item] of source.canvases.entries()) {
      const canvas = normalizeCanvas(item, index);
      if (!canvas || seen.has(canvas.canvas_id)) continue;
      seen.add(canvas.canvas_id);
      canvases.push(canvas);
    }
  }
  ui.canvases = canvases;
  const active = asKind(source.active_analysis);
  ui.active_analysis = active || canvases[0]?.kind || 'bode';

  const layout = isRecord(source.layout) ? source.layout : {};
  if (WORKBENCH_LAYOUT_MODES.includes(layout.mode as never)) {
    ui.layout.mode = layout.mode as WorkbenchLayoutRec['mode'];
  }
  ui.layout.rows = integer(layout.rows, 1, 1, 8);
  ui.layout.cols = integer(layout.cols, 1, 1, 8);
  const order = Array.isArray(layout.order)
    ? layout.order.filter((id): id is string => typeof id === 'string' && seen.has(id))
    : [];
  ui.layout.order = order.length ? order : canvases.map((canvas) => canvas.canvas_id);

  const sizes = isRecord(source.sizes) ? source.sizes : {};
  ui.sizes.sidebar = integer(sizes.sidebar, 280, 160, 640);
  ui.sizes.detail = integer(sizes.detail, 320, 200, 720);

  if (Array.isArray(source.selected_state_ids)) {
    ui.selected_state_ids = [...new Set(source.selected_state_ids.filter((id): id is string => typeof id === 'string' && id !== ''))].slice(0, 8);
  }
  return { ui, restored: true };
}

/** 写入工程文件前再规范化一次，避免运行时产生的临时字段漏进工程。 */
export function writeWorkbenchUi(value: WorkbenchUiRec): WorkbenchUiRec {
  return readWorkbenchUi(value).ui;
}
