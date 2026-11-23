/* 分析子图的图表设置对话框：预设、画布尺寸/字体/线宽、标题与轴名称、坐标轴范围与刻度、
 * 面板排布、网格、图例位置、标记与箭头标注、逐曲线 label/颜色/线宽/线型。
 * 采用实时预览 + 应用/取消；取消不写回画布设置。
 */
import { button, div, el } from './ui.js';
import { ui } from './state.js';
import {
  DEFAULT_CHART_APPEARANCE,
  applyChartPreset,
  cloneChartAppearance,
  normalizeChartAppearance,
  type ChartAppearance,
  type ChartAxisScale,
  type ChartCurveStyle,
  type ChartGridStyle,
  type ChartLegendPosition,
  type ChartPanelLayout,
  type ChartPreset,
} from './analysis_chart_appearance.js';

export interface ChartSettingsCurve {
  id: string;
  label: string;
}

export interface ChartSettingsOptions {
  initial: ChartAppearance;
  curves: ChartSettingsCurve[];
  panelCount: number;
  onPreview(next: ChartAppearance): void;
  onCommit(next: ChartAppearance): void;
  onCancel?(): void;
}

interface SelectField {
  row: HTMLElement;
  select: HTMLSelectElement;
}

function selectField(label: string, values: Array<[string, string]>, current: string): SelectField {
  const select = el('select', 'awb-settings-input') as HTMLSelectElement;
  for (const [value, text] of values) {
    const option = el('option', null, text) as HTMLOptionElement;
    option.value = value;
    select.append(option);
  }
  select.value = current;
  const row = div('awb-settings-row');
  row.append(el('span', 'awb-settings-label', label), select);
  return { row, select };
}

function textField(label: string, value: string, placeholder = ''): { row: HTMLElement; input: HTMLInputElement } {
  const input = el('input', 'awb-settings-input') as HTMLInputElement;
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  const row = div('awb-settings-row');
  row.append(el('span', 'awb-settings-label', label), input);
  return { row, input };
}

function numberField(label: string, value: number, min: number, max: number, step: number): { row: HTMLElement; input: HTMLInputElement } {
  const input = el('input', 'awb-settings-input') as HTMLInputElement;
  input.type = 'number';
  input.value = String(value);
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  const row = div('awb-settings-row');
  row.append(el('span', 'awb-settings-label', label), input);
  return { row, input };
}

function checkField(label: string, checked: boolean): { row: HTMLElement; input: HTMLInputElement } {
  const input = el('input') as HTMLInputElement;
  input.type = 'checkbox';
  input.checked = checked;
  const row = el('label', 'awb-settings-check');
  row.append(input, el('span', null, label));
  return { row, input };
}

function sectionTitle(text: string): HTMLElement {
  return el('div', 'awb-settings-section', text);
}

export function openChartSettingsDialog(options: ChartSettingsOptions): void {
  const original = cloneChartAppearance(normalizeChartAppearance(options.initial));
  const starting = cloneChartAppearance(original);
  let closed = false;

  const heading = el('h3', null, '图表设置');
  const note = el('p', 'awb-settings-note', '这些设置只影响当前子图，并随工程保存；导出 PNG/SVG/PDF 时同步生效。');
  const form = div('awb-settings-form');

  const preset = selectField('预设模板', [
    ['default', '默认'], ['matlab', 'MATLAB 风格'], ['publication', '科研出版'], ['minimal', '简洁'],
  ], starting.preset);
  const title = textField('大标题', starting.title, '例如：闭环频率响应');
  const xlabel = textField('X 轴名称', starting.xlabel, '留空使用默认轴名');
  const ylabel = textField('Y 轴名称（主图）', starting.ylabel, '留空使用默认轴名');
  const ylabel2 = textField('Y 轴名称（副图）', starting.ylabel2, '仅 Bode 副图使用');
  const xscale = selectField('X 轴刻度', [['auto', '自动'], ['linear', '线性'], ['log', '对数']], starting.xscale);
  const yscale = selectField('Y 轴刻度', [['auto', '自动'], ['linear', '线性'], ['log', '对数']], starting.yscale);
  const xMin = textField('X 轴最小值', starting.x_min, '留空自动');
  const xMax = textField('X 轴最大值', starting.x_max, '留空自动');
  const yMin = textField('Y 轴最小值', starting.y_min, '留空自动');
  const yMax = textField('Y 轴最大值', starting.y_max, '留空自动');
  const layout = selectField('面板排布', [['auto', '自动（上下）'], ['row', '左右并排'], ['column', '上下排列']], starting.panel_layout);

  const width = numberField('画布宽（英寸）', starting.figure_width, 0, 40, 0.5);
  const height = numberField('画布高（英寸）', starting.figure_height, 0, 40, 0.5);
  const dpi = numberField('导出 DPI', starting.dpi, 60, 600, 10);
  const fontTitle = numberField('标题字号', starting.font_title, 6, 40, 1);
  const fontAxis = numberField('轴标签字号', starting.font_axis, 6, 40, 1);
  const fontTick = numberField('刻度字号', starting.font_tick, 6, 40, 1);
  const fontLegend = numberField('图例字号', starting.font_legend, 6, 40, 1);
  const lineWidth = numberField('默认线宽', starting.line_width, 0.2, 8, 0.1);
  const facecolor = textField('背景色', starting.facecolor, '#ffffff，留空自动');
  const textColor = textField('文字色', starting.text_color, '#111111，留空自动');
  const axisColor = textField('坐标轴颜色', starting.axis_color, '#333333，留空自动');

  const grid = checkField('显示网格', starting.grid);
  const gridX = checkField('竖向网格', starting.grid_x);
  const gridY = checkField('横向网格', starting.grid_y);
  const gridColor = el('input', 'awb-settings-input awb-settings-color') as HTMLInputElement;
  gridColor.type = 'color';
  gridColor.value = starting.grid_color || '#64748b';
  const gridColorRow = div('awb-settings-row');
  gridColorRow.append(el('span', 'awb-settings-label', '网格颜色'), gridColor);
  const gridWidth = numberField('网格线宽', starting.grid_width, 0.2, 4, 0.1);
  const gridStyle = selectField('网格线型', [['solid', '实线'], ['dashed', '虚线'], ['dotted', '点线'], ['dashdot', '点划线']], starting.grid_style);
  const gridOpacity = numberField('网格透明度', starting.grid_opacity, 0.05, 1, 0.05);

  const legend = checkField('显示图例', starting.legend);
  const legendPosition = selectField('图例位置', [
    ['auto', '自动'], ['upper right', '右上'], ['upper left', '左上'], ['lower left', '左下'],
    ['lower right', '右下'], ['right', '右侧'], ['none', '不显示'],
  ], starting.legend_position);
  const showMarkers = checkField('显示标记点', starting.show_markers);
  const showAnnotations = checkField('显示箭头/文字标注', starting.show_annotations);

  const gridInline = div('awb-settings-inline');
  gridInline.append(gridX.row, gridY.row);
  const markerInline = div('awb-settings-inline');
  markerInline.append(showMarkers.row, showAnnotations.row);

  form.append(
    sectionTitle('预设与画布'),
    preset.row, width.row, height.row, dpi.row,
    sectionTitle('字体与线宽'),
    fontTitle.row, fontAxis.row, fontTick.row, fontLegend.row, lineWidth.row,
    facecolor.row, textColor.row, axisColor.row,
    sectionTitle('标题与轴名称'),
    title.row, xlabel.row, ylabel.row, ylabel2.row,
    sectionTitle('坐标轴范围与分布'),
    xscale.row, yscale.row, xMin.row, xMax.row, yMin.row, yMax.row, layout.row,
    sectionTitle('网格'),
    grid.row, gridInline, gridColorRow, gridWidth.row, gridStyle.row, gridOpacity.row,
    sectionTitle('图例与标注'),
    legend.row, legendPosition.row, markerInline,
  );

  interface CurveRow {
    id: string;
    label: HTMLInputElement;
    color: HTMLInputElement;
    width: HTMLInputElement;
    style: HTMLSelectElement;
  }
  const curveRows: CurveRow[] = [];
  if (options.curves.length) {
    const curveBox = div('awb-settings-curves');
    curveBox.append(el('div', 'awb-settings-section', '逐曲线样式'));
    for (const curve of options.curves) {
      const label = el('input', 'awb-settings-input') as HTMLInputElement;
      label.type = 'text';
      label.value = starting.curve_labels[curve.id] || '';
      label.placeholder = curve.label || curve.id;
      const color = el('input', 'awb-settings-input') as HTMLInputElement;
      color.type = 'text';
      color.value = starting.curve_colors[curve.id] || '';
      color.placeholder = '自动颜色';
      const widthInput = el('input', 'awb-settings-input awb-settings-narrow') as HTMLInputElement;
      widthInput.type = 'number';
      widthInput.min = '0.2';
      widthInput.max = '8';
      widthInput.step = '0.1';
      widthInput.value = starting.curve_widths[curve.id] ? String(starting.curve_widths[curve.id]) : '';
      widthInput.placeholder = '线宽';
      const styleSelect = selectField('', [
        ['auto', '默认线型'], ['solid', '实线'], ['dashed', '虚线'], ['dotted', '点线'], ['dashdot', '点划线'],
      ], starting.curve_styles[curve.id] || 'auto').select as HTMLSelectElement;
      const row = div('awb-settings-row awb-settings-curve-row');
      row.append(el('span', 'awb-settings-label', curve.label || curve.id), label, color, widthInput, styleSelect);
      curveBox.append(row);
      curveRows.push({ id: curve.id, label, color, width: widthInput, style: styleSelect });
    }
    form.append(curveBox);
  }

  function read(): ChartAppearance {
    const curveLabels: Record<string, string> = {};
    const curveColors: Record<string, string> = {};
    const curveWidths: Record<string, number> = {};
    const curveStyles: Record<string, ChartCurveStyle> = {};
    for (const item of curveRows) {
      const labelValue = item.label.value.trim();
      if (labelValue) curveLabels[item.id] = labelValue;
      const colorValue = item.color.value.trim();
      if (colorValue) curveColors[item.id] = colorValue;
      const widthValue = Number(item.width.value);
      if (Number.isFinite(widthValue) && widthValue > 0) curveWidths[item.id] = widthValue;
      const styleValue = item.style.value;
      if (styleValue !== 'auto') curveStyles[item.id] = styleValue as ChartCurveStyle;
    }
    return normalizeChartAppearance({
      preset: preset.select.value as ChartPreset,
      title: title.input.value,
      xlabel: xlabel.input.value,
      ylabel: ylabel.input.value,
      ylabel2: ylabel2.input.value,
      xscale: xscale.select.value as ChartAxisScale,
      yscale: yscale.select.value as ChartAxisScale,
      panel_layout: layout.select.value as ChartPanelLayout,
      grid: grid.input.checked,
      grid_x: gridX.input.checked,
      grid_y: gridY.input.checked,
      grid_color: gridColor.value,
      grid_width: gridWidth.input.value,
      grid_style: gridStyle.select.value as ChartGridStyle,
      grid_opacity: gridOpacity.input.value,
      legend: legend.input.checked,
      legend_position: legendPosition.select.value as ChartLegendPosition,
      curve_labels: curveLabels,
      figure_width: width.input.value,
      figure_height: height.input.value,
      dpi: dpi.input.value,
      font_title: fontTitle.input.value,
      font_axis: fontAxis.input.value,
      font_tick: fontTick.input.value,
      font_legend: fontLegend.input.value,
      line_width: lineWidth.input.value,
      show_markers: showMarkers.input.checked,
      show_annotations: showAnnotations.input.checked,
      facecolor: facecolor.input.value,
      text_color: textColor.input.value,
      axis_color: axisColor.input.value,
      x_min: xMin.input.value,
      x_max: xMax.input.value,
      y_min: yMin.input.value,
      y_max: yMax.input.value,
      curve_colors: curveColors,
      curve_widths: curveWidths,
      curve_styles: curveStyles,
    });
  }

  function syncControls(value: ChartAppearance): void {
    preset.select.value = value.preset;
    title.input.value = value.title;
    xlabel.input.value = value.xlabel;
    ylabel.input.value = value.ylabel;
    ylabel2.input.value = value.ylabel2;
    xscale.select.value = value.xscale;
    yscale.select.value = value.yscale;
    xMin.input.value = value.x_min;
    xMax.input.value = value.x_max;
    yMin.input.value = value.y_min;
    yMax.input.value = value.y_max;
    layout.select.value = value.panel_layout;
    width.input.value = String(value.figure_width);
    height.input.value = String(value.figure_height);
    dpi.input.value = String(value.dpi);
    fontTitle.input.value = String(value.font_title);
    fontAxis.input.value = String(value.font_axis);
    fontTick.input.value = String(value.font_tick);
    fontLegend.input.value = String(value.font_legend);
    lineWidth.input.value = String(value.line_width);
    facecolor.input.value = value.facecolor;
    textColor.input.value = value.text_color;
    axisColor.input.value = value.axis_color;
    grid.input.checked = value.grid;
    gridX.input.checked = value.grid_x;
    gridY.input.checked = value.grid_y;
    gridColor.value = value.grid_color || '#64748b';
    gridWidth.input.value = String(value.grid_width);
    gridStyle.select.value = value.grid_style;
    gridOpacity.input.value = String(value.grid_opacity);
    legend.input.checked = value.legend;
    legendPosition.select.value = value.legend_position;
    showMarkers.input.checked = value.show_markers;
    showAnnotations.input.checked = value.show_annotations;
    for (const item of curveRows) {
      item.label.value = value.curve_labels[item.id] || '';
      item.color.value = value.curve_colors[item.id] || '';
      item.width.value = value.curve_widths[item.id] ? String(value.curve_widths[item.id]) : '';
      item.style.value = value.curve_styles[item.id] || 'auto';
    }
  }

  let previewFrame = 0;
  function preview(): void {
    if (closed || previewFrame) return;
    previewFrame = requestAnimationFrame(() => {
      previewFrame = 0;
      if (!closed) options.onPreview(read());
    });
  }

  const textInputs = [
    title.input, xlabel.input, ylabel.input, ylabel2.input, xMin.input, xMax.input, yMin.input, yMax.input,
    width.input, height.input, dpi.input, fontTitle.input, fontAxis.input, fontTick.input, fontLegend.input,
    lineWidth.input, facecolor.input, textColor.input, axisColor.input, gridColor, gridWidth.input, gridOpacity.input,
    ...curveRows.flatMap((item) => [item.label, item.color, item.width]),
  ];
  for (const input of textInputs) input.addEventListener('input', preview);
  const selects = [
    xscale.select, yscale.select, layout.select, gridStyle.select, legendPosition.select,
    ...curveRows.map((item) => item.style),
  ];
  for (const select of selects) select.addEventListener('change', preview);
  const checks = [
    grid.input, gridX.input, gridY.input, legend.input, showMarkers.input, showAnnotations.input,
  ];
  for (const input of checks) input.addEventListener('change', preview);
  preset.select.addEventListener('change', () => {
    const next = applyChartPreset(read(), preset.select.value as ChartPreset);
    syncControls(next);
    preview();
  });
  if (options.panelCount < 2) layout.row.hidden = true;
  if (options.panelCount < 2) ylabel2.row.hidden = true;

  function close(commit: boolean): void {
    if (closed) return;
    closed = true;
    if (previewFrame) cancelAnimationFrame(previewFrame);
    document.removeEventListener('keydown', onKey, true);
    ui.modal.classList.add('hidden');
    ui.modal.classList.remove('awb-settings-modal');
    ui.modalCard.classList.remove('awb-settings-card');
    ui.modalCard.replaceChildren();
    ui.modal.onclick = null;
    if (commit) options.onCommit(read());
    else options.onCancel?.();
  }

  function reset(): void {
    syncControls(cloneChartAppearance(DEFAULT_CHART_APPEARANCE));
    preview();
  }

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(false);
    }
  };
  document.addEventListener('keydown', onKey, true);
  ui.modal.onclick = (event: MouseEvent) => {
    if (event.target === ui.modal) close(false);
  };

  const actions = div('modal-actions');
  actions.append(
    button('恢复默认', 'btn', reset),
    button('取消', 'btn', () => close(false)),
    button('应用', 'btn primary', () => close(true)),
  );
  ui.modalCard.replaceChildren(heading, note, form, actions);
  ui.modalCard.classList.add('awb-settings-card');
  ui.modal.classList.add('awb-settings-modal');
  ui.modal.classList.remove('hidden');
  window.setTimeout(() => title.input.focus(), 30);
}
