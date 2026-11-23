/* 分析子图的图表设置对话框：标题、轴名称、轴刻度、面板排布、网格与图例。
 * 采用实时预览 + 应用/取消；取消不写回画布设置。
 */
import { button, div, el } from './ui.js';
import { ui } from './state.js';
import {
  DEFAULT_CHART_APPEARANCE,
  cloneChartAppearance,
  normalizeChartAppearance,
  type ChartAppearance,
  type ChartAxisScale,
  type ChartGridStyle,
  type ChartPanelLayout,
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
  const note = el('p', 'awb-settings-note', '这些设置只影响当前子图，并随工程保存。');
  const form = div('awb-settings-form');

  const title = textField('大标题', starting.title, '例如：闭环频率响应');
  const xlabel = textField('X 轴名称', starting.xlabel, '留空使用默认轴名');
  const ylabel = textField('Y 轴名称（主图）', starting.ylabel, '留空使用默认轴名');
  const ylabel2 = textField('Y 轴名称（副图）', starting.ylabel2, '仅 Bode 副图使用');
  const xscale = selectField('X 轴刻度', [['auto', '自动'], ['linear', '线性'], ['log', '对数']], starting.xscale);
  const yscale = selectField('Y 轴刻度', [['auto', '自动'], ['linear', '线性'], ['log', '对数']], starting.yscale);
  const layout = selectField('面板排布', [['auto', '自动（上下）'], ['row', '左右并排'], ['column', '上下排列']], starting.panel_layout);
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

  const gridInline = div('awb-settings-inline');
  gridInline.append(gridX.row, gridY.row);
  form.append(
    sectionTitle('标题与轴名称'),
    title.row, xlabel.row, ylabel.row, ylabel2.row,
    sectionTitle('坐标轴与分布'),
    xscale.row, yscale.row, layout.row,
    sectionTitle('网格'),
    grid.row, gridInline,
    gridColorRow, gridWidth.row, gridStyle.row, gridOpacity.row,
    sectionTitle('图例与曲线 label'),
    legend.row,
  );

  const curveRows: Array<{ id: string; input: HTMLInputElement }> = [];
  if (options.curves.length) {
    const curveBox = div('awb-settings-curves');
    for (const curve of options.curves) {
      const input = el('input', 'awb-settings-input') as HTMLInputElement;
      input.type = 'text';
      input.value = starting.curve_labels[curve.id] || '';
      input.placeholder = curve.label || curve.id;
      const row = div('awb-settings-row');
      row.append(el('span', 'awb-settings-label', curve.label || curve.id), input);
      curveBox.append(row);
      curveRows.push({ id: curve.id, input });
    }
    form.append(curveBox);
  }

  function read(): ChartAppearance {
    const curveLabels: Record<string, string> = {};
    for (const item of curveRows) {
      const value = item.input.value.trim();
      if (value) curveLabels[item.id] = value;
    }
    return normalizeChartAppearance({
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
      curve_labels: curveLabels,
    });
  }

  let previewFrame = 0;
  function preview(): void {
    if (closed || previewFrame) return;
    previewFrame = requestAnimationFrame(() => {
      previewFrame = 0;
      if (!closed) options.onPreview(read());
    });
  }

  for (const input of [title.input, xlabel.input, ylabel.input, ylabel2.input, gridColor, gridWidth.input, gridOpacity.input, ...curveRows.map((item) => item.input)]) {
    input.addEventListener('input', preview);
  }
  for (const select of [xscale.select, yscale.select, layout.select, gridStyle.select]) {
    select.addEventListener('change', preview);
  }
  for (const input of [grid.input, gridX.input, gridY.input, legend.input]) {
    input.addEventListener('change', preview);
  }
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
    const d = DEFAULT_CHART_APPEARANCE;
    title.input.value = d.title;
    xlabel.input.value = d.xlabel;
    ylabel.input.value = d.ylabel;
    ylabel2.input.value = d.ylabel2;
    xscale.select.value = d.xscale;
    yscale.select.value = d.yscale;
    layout.select.value = d.panel_layout;
    grid.input.checked = d.grid;
    gridX.input.checked = d.grid_x;
    gridY.input.checked = d.grid_y;
    gridColor.value = '#64748b';
    gridWidth.input.value = String(d.grid_width);
    gridStyle.select.value = d.grid_style;
    gridOpacity.input.value = String(d.grid_opacity);
    legend.input.checked = d.legend;
    for (const item of curveRows) item.input.value = '';
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
