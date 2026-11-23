/* 单个分析子图的外观设置：标题、轴名称、轴刻度类型、面板排布、
 * 网格样式与图例标签。纯数据模型，不依赖 DOM，便于工程持久化与单元测试。
 */

export type ChartAxisScale = 'auto' | 'linear' | 'log';
export type ChartPanelLayout = 'auto' | 'row' | 'column';
export type ChartGridStyle = 'solid' | 'dashed' | 'dotted' | 'dashdot';

export interface ChartAppearance {
  title: string;
  xlabel: string;
  ylabel: string;
  ylabel2: string;
  xscale: ChartAxisScale;
  yscale: ChartAxisScale;
  panel_layout: ChartPanelLayout;
  grid: boolean;
  grid_x: boolean;
  grid_y: boolean;
  grid_color: string;
  grid_width: number;
  grid_style: ChartGridStyle;
  grid_opacity: number;
  legend: boolean;
  curve_labels: Record<string, string>;
}

export const DEFAULT_CHART_APPEARANCE: ChartAppearance = {
  title: '',
  xlabel: '',
  ylabel: '',
  ylabel2: '',
  xscale: 'auto',
  yscale: 'auto',
  panel_layout: 'auto',
  grid: true,
  grid_x: true,
  grid_y: true,
  grid_color: '',
  grid_width: 1,
  grid_style: 'solid',
  grid_opacity: 0.35,
  legend: false,
  curve_labels: {},
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.slice(0, 200) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function number(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function choice<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && (values as readonly string[]).includes(value) ? value as T : fallback;
}

export function normalizeChartAppearance(value: unknown): ChartAppearance {
  const raw = record(value);
  const labels = record(raw.curve_labels);
  const curveLabels: Record<string, string> = {};
  for (const [key, label] of Object.entries(labels)) {
    if (typeof label === 'string' && key && label.trim()) curveLabels[key.slice(0, 120)] = label.trim().slice(0, 120);
  }
  return {
    title: text(raw.title),
    xlabel: text(raw.xlabel),
    ylabel: text(raw.ylabel),
    ylabel2: text(raw.ylabel2),
    xscale: choice(raw.xscale, ['auto', 'linear', 'log'] as const, 'auto'),
    yscale: choice(raw.yscale, ['auto', 'linear', 'log'] as const, 'auto'),
    panel_layout: choice(raw.panel_layout, ['auto', 'row', 'column'] as const, 'auto'),
    grid: bool(raw.grid, true),
    grid_x: bool(raw.grid_x, true),
    grid_y: bool(raw.grid_y, true),
    grid_color: text(raw.grid_color, ''),
    grid_width: number(raw.grid_width, 1, 0.2, 4),
    grid_style: choice(raw.grid_style, ['solid', 'dashed', 'dotted', 'dashdot'] as const, 'solid'),
    grid_opacity: number(raw.grid_opacity, 0.35, 0.05, 1),
    legend: bool(raw.legend, false),
    curve_labels: curveLabels,
  };
}

export function cloneChartAppearance(value: ChartAppearance): ChartAppearance {
  return {
    ...value,
    curve_labels: { ...value.curve_labels },
  };
}

export function chartAppearanceIsDefault(value: ChartAppearance): boolean {
  return JSON.stringify(normalizeChartAppearance(value)) === JSON.stringify(DEFAULT_CHART_APPEARANCE);
}
