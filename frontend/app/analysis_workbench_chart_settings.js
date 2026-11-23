import { button, div, el } from "./ui.js";
import { ui } from "./state.js";
import {
  DEFAULT_CHART_APPEARANCE,
  applyChartPreset,
  cloneChartAppearance,
  normalizeChartAppearance
} from "./analysis_chart_appearance.js";
function selectField(label, values, current) {
  const select = el("select", "awb-settings-input");
  for (const [value, text] of values) {
    const option = el("option", null, text);
    option.value = value;
    select.append(option);
  }
  select.value = current;
  const row = div("awb-settings-row");
  row.append(el("span", "awb-settings-label", label), select);
  return { row, select };
}
function textField(label, value, placeholder = "") {
  const input = el("input", "awb-settings-input");
  input.type = "text";
  input.value = value;
  input.placeholder = placeholder;
  const row = div("awb-settings-row");
  row.append(el("span", "awb-settings-label", label), input);
  return { row, input };
}
function numberField(label, value, min, max, step) {
  const input = el("input", "awb-settings-input");
  input.type = "number";
  input.value = String(value);
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  const row = div("awb-settings-row");
  row.append(el("span", "awb-settings-label", label), input);
  return { row, input };
}
function checkField(label, checked) {
  const input = el("input");
  input.type = "checkbox";
  input.checked = checked;
  const row = el("label", "awb-settings-check");
  row.append(input, el("span", null, label));
  return { row, input };
}
function sectionTitle(text) {
  return el("div", "awb-settings-section", text);
}
function openChartSettingsDialog(options) {
  const original = cloneChartAppearance(normalizeChartAppearance(options.initial));
  const starting = cloneChartAppearance(original);
  let closed = false;
  const heading = el("h3", null, "\u56FE\u8868\u8BBE\u7F6E");
  const note = el("p", "awb-settings-note", "\u8FD9\u4E9B\u8BBE\u7F6E\u53EA\u5F71\u54CD\u5F53\u524D\u5B50\u56FE\uFF0C\u5E76\u968F\u5DE5\u7A0B\u4FDD\u5B58\uFF1B\u5BFC\u51FA PNG/SVG/PDF \u65F6\u540C\u6B65\u751F\u6548\u3002");
  const form = div("awb-settings-form");
  const preset = selectField("\u9884\u8BBE\u6A21\u677F", [
    ["default", "\u9ED8\u8BA4"],
    ["matlab", "MATLAB \u98CE\u683C"],
    ["publication", "\u79D1\u7814\u51FA\u7248"],
    ["minimal", "\u7B80\u6D01"]
  ], starting.preset);
  const title = textField("\u5927\u6807\u9898", starting.title, "\u4F8B\u5982\uFF1A\u95ED\u73AF\u9891\u7387\u54CD\u5E94");
  const xlabel = textField("X \u8F74\u540D\u79F0", starting.xlabel, "\u7559\u7A7A\u4F7F\u7528\u9ED8\u8BA4\u8F74\u540D");
  const ylabel = textField("Y \u8F74\u540D\u79F0\uFF08\u4E3B\u56FE\uFF09", starting.ylabel, "\u7559\u7A7A\u4F7F\u7528\u9ED8\u8BA4\u8F74\u540D");
  const ylabel2 = textField("Y \u8F74\u540D\u79F0\uFF08\u526F\u56FE\uFF09", starting.ylabel2, "\u4EC5 Bode \u526F\u56FE\u4F7F\u7528");
  const xscale = selectField("X \u8F74\u523B\u5EA6", [["auto", "\u81EA\u52A8"], ["linear", "\u7EBF\u6027"], ["log", "\u5BF9\u6570"]], starting.xscale);
  const yscale = selectField("Y \u8F74\u523B\u5EA6", [["auto", "\u81EA\u52A8"], ["linear", "\u7EBF\u6027"], ["log", "\u5BF9\u6570"]], starting.yscale);
  const xMin = textField("X \u8F74\u6700\u5C0F\u503C", starting.x_min, "\u7559\u7A7A\u81EA\u52A8");
  const xMax = textField("X \u8F74\u6700\u5927\u503C", starting.x_max, "\u7559\u7A7A\u81EA\u52A8");
  const yMin = textField("Y \u8F74\u6700\u5C0F\u503C", starting.y_min, "\u7559\u7A7A\u81EA\u52A8");
  const yMax = textField("Y \u8F74\u6700\u5927\u503C", starting.y_max, "\u7559\u7A7A\u81EA\u52A8");
  const layout = selectField("\u9762\u677F\u6392\u5E03", [["auto", "\u81EA\u52A8\uFF08\u4E0A\u4E0B\uFF09"], ["row", "\u5DE6\u53F3\u5E76\u6392"], ["column", "\u4E0A\u4E0B\u6392\u5217"]], starting.panel_layout);
  const width = numberField("\u753B\u5E03\u5BBD\uFF08\u82F1\u5BF8\uFF09", starting.figure_width, 0, 40, 0.5);
  const height = numberField("\u753B\u5E03\u9AD8\uFF08\u82F1\u5BF8\uFF09", starting.figure_height, 0, 40, 0.5);
  const dpi = numberField("\u5BFC\u51FA DPI", starting.dpi, 60, 600, 10);
  const fontTitle = numberField("\u6807\u9898\u5B57\u53F7", starting.font_title, 6, 40, 1);
  const fontAxis = numberField("\u8F74\u6807\u7B7E\u5B57\u53F7", starting.font_axis, 6, 40, 1);
  const fontTick = numberField("\u523B\u5EA6\u5B57\u53F7", starting.font_tick, 6, 40, 1);
  const fontLegend = numberField("\u56FE\u4F8B\u5B57\u53F7", starting.font_legend, 6, 40, 1);
  const lineWidth = numberField("\u9ED8\u8BA4\u7EBF\u5BBD", starting.line_width, 0.2, 8, 0.1);
  const facecolor = textField("\u80CC\u666F\u8272", starting.facecolor, "#ffffff\uFF0C\u7559\u7A7A\u81EA\u52A8");
  const textColor = textField("\u6587\u5B57\u8272", starting.text_color, "#111111\uFF0C\u7559\u7A7A\u81EA\u52A8");
  const axisColor = textField("\u5750\u6807\u8F74\u989C\u8272", starting.axis_color, "#333333\uFF0C\u7559\u7A7A\u81EA\u52A8");
  const grid = checkField("\u663E\u793A\u7F51\u683C", starting.grid);
  const gridX = checkField("\u7AD6\u5411\u7F51\u683C", starting.grid_x);
  const gridY = checkField("\u6A2A\u5411\u7F51\u683C", starting.grid_y);
  const gridColor = el("input", "awb-settings-input awb-settings-color");
  gridColor.type = "color";
  gridColor.value = starting.grid_color || "#64748b";
  const gridColorRow = div("awb-settings-row");
  gridColorRow.append(el("span", "awb-settings-label", "\u7F51\u683C\u989C\u8272"), gridColor);
  const gridWidth = numberField("\u7F51\u683C\u7EBF\u5BBD", starting.grid_width, 0.2, 4, 0.1);
  const gridStyle = selectField("\u7F51\u683C\u7EBF\u578B", [["solid", "\u5B9E\u7EBF"], ["dashed", "\u865A\u7EBF"], ["dotted", "\u70B9\u7EBF"], ["dashdot", "\u70B9\u5212\u7EBF"]], starting.grid_style);
  const gridOpacity = numberField("\u7F51\u683C\u900F\u660E\u5EA6", starting.grid_opacity, 0.05, 1, 0.05);
  const legend = checkField("\u663E\u793A\u56FE\u4F8B", starting.legend);
  const legendPosition = selectField("\u56FE\u4F8B\u4F4D\u7F6E", [
    ["auto", "\u81EA\u52A8"],
    ["upper right", "\u53F3\u4E0A"],
    ["upper left", "\u5DE6\u4E0A"],
    ["lower left", "\u5DE6\u4E0B"],
    ["lower right", "\u53F3\u4E0B"],
    ["right", "\u53F3\u4FA7"],
    ["none", "\u4E0D\u663E\u793A"]
  ], starting.legend_position);
  const showMarkers = checkField("\u663E\u793A\u6807\u8BB0\u70B9", starting.show_markers);
  const showAnnotations = checkField("\u663E\u793A\u7BAD\u5934/\u6587\u5B57\u6807\u6CE8", starting.show_annotations);
  const gridInline = div("awb-settings-inline");
  gridInline.append(gridX.row, gridY.row);
  const markerInline = div("awb-settings-inline");
  markerInline.append(showMarkers.row, showAnnotations.row);
  form.append(
    sectionTitle("\u9884\u8BBE\u4E0E\u753B\u5E03"),
    preset.row,
    width.row,
    height.row,
    dpi.row,
    sectionTitle("\u5B57\u4F53\u4E0E\u7EBF\u5BBD"),
    fontTitle.row,
    fontAxis.row,
    fontTick.row,
    fontLegend.row,
    lineWidth.row,
    facecolor.row,
    textColor.row,
    axisColor.row,
    sectionTitle("\u6807\u9898\u4E0E\u8F74\u540D\u79F0"),
    title.row,
    xlabel.row,
    ylabel.row,
    ylabel2.row,
    sectionTitle("\u5750\u6807\u8F74\u8303\u56F4\u4E0E\u5206\u5E03"),
    xscale.row,
    yscale.row,
    xMin.row,
    xMax.row,
    yMin.row,
    yMax.row,
    layout.row,
    sectionTitle("\u7F51\u683C"),
    grid.row,
    gridInline,
    gridColorRow,
    gridWidth.row,
    gridStyle.row,
    gridOpacity.row,
    sectionTitle("\u56FE\u4F8B\u4E0E\u6807\u6CE8"),
    legend.row,
    legendPosition.row,
    markerInline
  );
  const curveRows = [];
  if (options.curves.length) {
    const curveBox = div("awb-settings-curves");
    curveBox.append(el("div", "awb-settings-section", "\u9010\u66F2\u7EBF\u6837\u5F0F"));
    for (const curve of options.curves) {
      const label = el("input", "awb-settings-input");
      label.type = "text";
      label.value = starting.curve_labels[curve.id] || "";
      label.placeholder = curve.label || curve.id;
      const color = el("input", "awb-settings-input");
      color.type = "text";
      color.value = starting.curve_colors[curve.id] || "";
      color.placeholder = "\u81EA\u52A8\u989C\u8272";
      const widthInput = el("input", "awb-settings-input awb-settings-narrow");
      widthInput.type = "number";
      widthInput.min = "0.2";
      widthInput.max = "8";
      widthInput.step = "0.1";
      widthInput.value = starting.curve_widths[curve.id] ? String(starting.curve_widths[curve.id]) : "";
      widthInput.placeholder = "\u7EBF\u5BBD";
      const styleSelect = selectField("", [
        ["auto", "\u9ED8\u8BA4\u7EBF\u578B"],
        ["solid", "\u5B9E\u7EBF"],
        ["dashed", "\u865A\u7EBF"],
        ["dotted", "\u70B9\u7EBF"],
        ["dashdot", "\u70B9\u5212\u7EBF"]
      ], starting.curve_styles[curve.id] || "auto").select;
      const row = div("awb-settings-row awb-settings-curve-row");
      row.append(el("span", "awb-settings-label", curve.label || curve.id), label, color, widthInput, styleSelect);
      curveBox.append(row);
      curveRows.push({ id: curve.id, label, color, width: widthInput, style: styleSelect });
    }
    form.append(curveBox);
  }
  function read() {
    const curveLabels = {};
    const curveColors = {};
    const curveWidths = {};
    const curveStyles = {};
    for (const item of curveRows) {
      const labelValue = item.label.value.trim();
      if (labelValue) curveLabels[item.id] = labelValue;
      const colorValue = item.color.value.trim();
      if (colorValue) curveColors[item.id] = colorValue;
      const widthValue = Number(item.width.value);
      if (Number.isFinite(widthValue) && widthValue > 0) curveWidths[item.id] = widthValue;
      const styleValue = item.style.value;
      if (styleValue !== "auto") curveStyles[item.id] = styleValue;
    }
    return normalizeChartAppearance({
      preset: preset.select.value,
      title: title.input.value,
      xlabel: xlabel.input.value,
      ylabel: ylabel.input.value,
      ylabel2: ylabel2.input.value,
      xscale: xscale.select.value,
      yscale: yscale.select.value,
      panel_layout: layout.select.value,
      grid: grid.input.checked,
      grid_x: gridX.input.checked,
      grid_y: gridY.input.checked,
      grid_color: gridColor.value,
      grid_width: gridWidth.input.value,
      grid_style: gridStyle.select.value,
      grid_opacity: gridOpacity.input.value,
      legend: legend.input.checked,
      legend_position: legendPosition.select.value,
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
      curve_styles: curveStyles
    });
  }
  function syncControls(value) {
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
    gridColor.value = value.grid_color || "#64748b";
    gridWidth.input.value = String(value.grid_width);
    gridStyle.select.value = value.grid_style;
    gridOpacity.input.value = String(value.grid_opacity);
    legend.input.checked = value.legend;
    legendPosition.select.value = value.legend_position;
    showMarkers.input.checked = value.show_markers;
    showAnnotations.input.checked = value.show_annotations;
    for (const item of curveRows) {
      item.label.value = value.curve_labels[item.id] || "";
      item.color.value = value.curve_colors[item.id] || "";
      item.width.value = value.curve_widths[item.id] ? String(value.curve_widths[item.id]) : "";
      item.style.value = value.curve_styles[item.id] || "auto";
    }
  }
  let previewFrame = 0;
  function preview() {
    if (closed || previewFrame) return;
    previewFrame = requestAnimationFrame(() => {
      previewFrame = 0;
      if (!closed) options.onPreview(read());
    });
  }
  const textInputs = [
    title.input,
    xlabel.input,
    ylabel.input,
    ylabel2.input,
    xMin.input,
    xMax.input,
    yMin.input,
    yMax.input,
    width.input,
    height.input,
    dpi.input,
    fontTitle.input,
    fontAxis.input,
    fontTick.input,
    fontLegend.input,
    lineWidth.input,
    facecolor.input,
    textColor.input,
    axisColor.input,
    gridColor,
    gridWidth.input,
    gridOpacity.input,
    ...curveRows.flatMap((item) => [item.label, item.color, item.width])
  ];
  for (const input of textInputs) input.addEventListener("input", preview);
  const selects = [
    xscale.select,
    yscale.select,
    layout.select,
    gridStyle.select,
    legendPosition.select,
    ...curveRows.map((item) => item.style)
  ];
  for (const select of selects) select.addEventListener("change", preview);
  const checks = [
    grid.input,
    gridX.input,
    gridY.input,
    legend.input,
    showMarkers.input,
    showAnnotations.input
  ];
  for (const input of checks) input.addEventListener("change", preview);
  preset.select.addEventListener("change", () => {
    const next = applyChartPreset(read(), preset.select.value);
    syncControls(next);
    preview();
  });
  if (options.panelCount < 2) layout.row.hidden = true;
  if (options.panelCount < 2) ylabel2.row.hidden = true;
  function close(commit) {
    if (closed) return;
    closed = true;
    if (previewFrame) cancelAnimationFrame(previewFrame);
    document.removeEventListener("keydown", onKey, true);
    ui.modal.classList.add("hidden");
    ui.modal.classList.remove("awb-settings-modal");
    ui.modalCard.classList.remove("awb-settings-card");
    ui.modalCard.replaceChildren();
    ui.modal.onclick = null;
    if (commit) options.onCommit(read());
    else options.onCancel?.();
  }
  function reset() {
    syncControls(cloneChartAppearance(DEFAULT_CHART_APPEARANCE));
    preview();
  }
  const onKey = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(false);
    }
  };
  document.addEventListener("keydown", onKey, true);
  ui.modal.onclick = (event) => {
    if (event.target === ui.modal) close(false);
  };
  const actions = div("modal-actions");
  actions.append(
    button("\u6062\u590D\u9ED8\u8BA4", "btn", reset),
    button("\u53D6\u6D88", "btn", () => close(false)),
    button("\u5E94\u7528", "btn primary", () => close(true))
  );
  ui.modalCard.replaceChildren(heading, note, form, actions);
  ui.modalCard.classList.add("awb-settings-card");
  ui.modal.classList.add("awb-settings-modal");
  ui.modal.classList.remove("hidden");
  window.setTimeout(() => title.input.focus(), 30);
}
export {
  openChartSettingsDialog
};
