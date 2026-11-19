/* 分析结果信封的前端类型。放在独立模块以避免 chart 与 detail 互相 import。 */
export interface AnalysisAxis {
  id: string;
  label: string;
  unit: string;
  scale: string;
  n: number;
  values: number[];
}

export interface AnalysisCurve {
  id: string;
  label: string;
  axes: [string, string] | string[];
  style: string;
  category: string;
  n: number;
  x: number[];
  y: number[];
  detail?: Record<string, number[] | number | string | null>;
}

export interface AnalysisMarker {
  id: string;
  shape: string;
  label: string;
  category: string;
  axis_x: string;
  axis_y: string;
  x: number;
  y: number;
  detail?: Record<string, number | string | null>;
}

export interface AnalysisWarning {
  code: string;
  message: string;
  severity?: string;
  [key: string]: unknown;
}

export interface ChartView {
  xlim: [number, number];
  ylims: Record<number, [number, number]>;
}

/** 可随工程保存的子画布视图：缩放/平移范围、图层开关、固定标记。 */
export interface AnalysisChartViewState {
  xlim: [number, number];
  ylims: Record<string, [number, number]>;
  visible_categories: string[];
  pinned_marker_id: string | null;
}

export interface AnalysisEnvelope {
  schema: string;
  analysis_id?: string;
  kind: string;
  generated_at?: number;
  source?: Record<string, unknown>;
  axes: AnalysisAxis[];
  curves: AnalysisCurve[];
  markers: AnalysisMarker[];
  metrics?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  warnings?: AnalysisWarning[];
  fingerprint?: string;
}
