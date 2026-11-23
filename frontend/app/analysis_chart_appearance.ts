/* 单个分析子图的外观设置：标题、轴名称、轴刻度类型、面板排布、网格样式、
 * 画布尺寸/字体/线宽、曲线颜色与线型、标记与箭头标注、图例位置等。
 * 纯数据模型，不依赖 DOM，便于工程持久化与单元测试。
 */

export type ChartAxisScale = 'auto' | 'linear' | 'log';
export type ChartPanelLayout = 'auto' | 'row' | 'column';
export type ChartGridStyle = 'solid' | 'dashed' | 'dotted' | 'dashdot';
export type ChartLegendPosition = 'auto' | 'upper right' | 'upper left' | 'lower left' | 'lower right' | 'right' | 'none';
export type ChartPreset = 'default' | 'matlab' | 'publication' | 'minimal';
export type ChartCurveStyle = 'solid' | 'dashed' | 'dotted' | 'dashdot';

export interface ChartAppearance {
  preset: ChartPreset;
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
  legend_position: ChartLegendPosition;
  curve_labels: Record<string, string>;
  /* —— matplotlib 级画布设置 —— */
  figure_width: number;      // 英寸；0 = 自动
  figure_height: number;     // 英寸；0 = 自动
  dpi: number;
  font_title: number;
  font_axis: number;
  font_tick: number;
  font_legend: number;
  line_width: number;
  show_markers: boolean;
  show_annotations: boolean;
  facecolor: string;
  text_color: string;
  axis_color: string;
  x_min: string;
  x_max: string;
  y_min: string;
  y_max: string;
  curve_colors: Record<string, string>;
  curve_widths: Record<string, number>;
  curve_styles: Record<string, ChartCurveStyle>;
}

export const DEFAULT_CHART_APPEARANCE: ChartAppearance = {
  preset: 'default',
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
  legend_position: 'auto',
  curve_labels: {},
  figure_width: 0,
  figure_height: 0,
  dpi: 120,
  font_title: 14,
  font_axis: 12,
  font_tick: 11,
  font_legend: 11,
  line_width: 1.7,
  show_markers: true,
  show_annotations: true,
  facecolor: '',
  text_color: '',
  axis_color: '',
  x_min: '',
  x_max: '',
  y_min: '',
  y_max: '',
  curve_colors: {},
  curve_widths: {},
  curve_styles: {},
};

export const CHART_PRESETS: Record<ChartPreset, Partial<ChartAppearance>> = {
  default: {},
  matlab: {
    grid: true, grid_x: true, grid_y: true, grid_color: '#b9b9b9', grid_width: 0.8,
    grid_style: 'solid', grid_opacity: 0.5, font_title: 14, font_axis: 12, font_tick: 10,
    font_legend: 10, line_width: 1.5, facecolor: '#ffffff', text_color: '#000000', axis_color: '#000000',
  },
  publication: {
    grid: false, grid_x: false, grid_y: false, font_title: 16, font_axis: 13, font_tick: 11,
    font_legend: 11, line_width: 2, legend: true, legend_position: 'upper right',
    facecolor: '#ffffff', text_color: '#111111', axis_color: '#111111',
  },
  minimal: {
    grid: false, grid_x: false, grid_y: false, font_title: 13, font_axis: 11, font_tick: 10,
    font_legend: 10, line_width: 1.4, legend: false, facecolor: '#ffffff', text_color: '#333333', axis_color: '#666666',
  },
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

function labels(value: unknown): Record<string, string> {
  const raw = record(value);
  const out: Record<string, string> = {};
  for (const [key, label] of Object.entries(raw)) {
    if (typeof label === 'string' && key && label.trim()) out[key.slice(0, 160)] = label.trim().slice(0, 160);
  }
  return out;
}

function colors(value: unknown): Record<string, string> {
  const raw = record(value);
  const out: Record<string, string> = {};
  for (const [key, color] of Object.entries(raw)) {
    if (typeof color === 'string' && key && /^#?[0-9a-zA-Z(),.# ]{2,40}$/.test(color.trim())) {
      out[key.slice(0, 160)] = color.trim().slice(0, 40);
    }
  }
  return out;
}

function widths(value: unknown): Record<string, number> {
  const raw = record(value);
  const out: Record<string, number> = {};
  for (const [key, width] of Object.entries(raw)) {
    const parsed = Number(width);
    if (Number.isFinite(parsed) && parsed > 0) out[key.slice(0, 160)] = Math.min(8, Math.max(0.2, parsed));
  }
  return out;
}

function styles(value: unknown): Record<string, ChartCurveStyle> {
  const raw = record(value);
  const out: Record<string, ChartCurveStyle> = {};
  for (const [key, style] of Object.entries(raw)) {
    if (typeof style === 'string' && ['solid', 'dashed', 'dotted', 'dashdot'].includes(style)) {
      out[key.slice(0, 160)] = style as ChartCurveStyle;
    }
  }
  return out;
}

export function normalizeChartAppearance(value: unknown): ChartAppearance {
  const raw = record(value);
  return {
    preset: choice(raw.preset, ['default', 'matlab', 'publication', 'minimal'] as const, 'default'),
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
    legend_position: choice(raw.legend_position, ['auto', 'upper right', 'upper left', 'lower left', 'lower right', 'right', 'none'] as const, 'auto'),
    curve_labels: labels(raw.curve_labels),
    figure_width: number(raw.figure_width, 0, 0, 40),
    figure_height: number(raw.figure_height, 0, 0, 40),
    dpi: Math.round(number(raw.dpi, 120, 60, 600)),
    font_title: number(raw.font_title, 14, 6, 40),
    font_axis: number(raw.font_axis, 12, 6, 40),
    font_tick: number(raw.font_tick, 11, 6, 40),
    font_legend: number(raw.font_legend, 11, 6, 40),
    line_width: number(raw.line_width, 1.7, 0.2, 8),
    show_markers: bool(raw.show_markers, true),
    show_annotations: bool(raw.show_annotations, true),
    facecolor: text(raw.facecolor, ''),
    text_color: text(raw.text_color, ''),
    axis_color: text(raw.axis_color, ''),
    x_min: text(raw.x_min, '').slice(0, 40),
    x_max: text(raw.x_max, '').slice(0, 40),
    y_min: text(raw.y_min, '').slice(0, 40),
    y_max: text(raw.y_max, '').slice(0, 40),
    curve_colors: colors(raw.curve_colors),
    curve_widths: widths(raw.curve_widths),
    curve_styles: styles(raw.curve_styles),
  };
}

export function cloneChartAppearance(value: ChartAppearance): ChartAppearance {
  return {
    ...value,
    curve_labels: { ...value.curve_labels },
    curve_colors: { ...value.curve_colors },
    curve_widths: { ...value.curve_widths },
    curve_styles: { ...value.curve_styles },
  };
}

export function applyChartPreset(value: ChartAppearance, preset: ChartPreset): ChartAppearance {
  const base = normalizeChartAppearance(value);
  return normalizeChartAppearance({ ...base, ...CHART_PRESETS[preset], preset });
}

export function chartAppearanceIsDefault(value: ChartAppearance): boolean {
  return JSON.stringify(normalizeChartAppearance(value)) === JSON.stringify(DEFAULT_CHART_APPEARANCE);
}
