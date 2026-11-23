import { button, div, el } from "./ui.js";
import { ui } from "./state.js";
import {
  DEFAULT_CHART_APPEARANCE,
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
  const note = el("p", "awb-settings-note", "\u8FD9\u4E9B\u8BBE\u7F6E\u53EA\u5F71\u54CD\u5F53\u524D\u5B50\u56FE\uFF0C\u5E76\u968F\u5DE5\u7A0B\u4FDD\u5B58\u3002");
  const form = div("awb-settings-form");
  const title = textField("\u5927\u6807\u9898", starting.title, "\u4F8B\u5982\uFF1A\u95ED\u73AF\u9891\u7387\u54CD\u5E94");
  const xlabel = textField("X \u8F74\u540D\u79F0", starting.xlabel, "\u7559\u7A7A\u4F7F\u7528\u9ED8\u8BA4\u8F74\u540D");
  const ylabel = textField("Y \u8F74\u540D\u79F0\uFF08\u4E3B\u56FE\uFF09", starting.ylabel, "\u7559\u7A7A\u4F7F\u7528\u9ED8\u8BA4\u8F74\u540D");
  const ylabel2 = textField("Y \u8F74\u540D\u79F0\uFF08\u526F\u56FE\uFF09", starting.ylabel2, "\u4EC5 Bode \u526F\u56FE\u4F7F\u7528");
  const xscale = selectField("X \u8F74\u523B\u5EA6", [["auto", "\u81EA\u52A8"], ["linear", "\u7EBF\u6027"], ["log", "\u5BF9\u6570"]], starting.xscale);
  const yscale = selectField("Y \u8F74\u523B\u5EA6", [["auto", "\u81EA\u52A8"], ["linear", "\u7EBF\u6027"], ["log", "\u5BF9\u6570"]], starting.yscale);
  const layout = selectField("\u9762\u677F\u6392\u5E03", [["auto", "\u81EA\u52A8\uFF08\u4E0A\u4E0B\uFF09"], ["row", "\u5DE6\u53F3\u5E76\u6392"], ["column", "\u4E0A\u4E0B\u6392\u5217"]], starting.panel_layout);
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
  const gridInline = div("awb-settings-inline");
  gridInline.append(gridX.row, gridY.row);
  form.append(
    sectionTitle("\u6807\u9898\u4E0E\u8F74\u540D\u79F0"),
    title.row,
    xlabel.row,
    ylabel.row,
    ylabel2.row,
    sectionTitle("\u5750\u6807\u8F74\u4E0E\u5206\u5E03"),
    xscale.row,
    yscale.row,
    layout.row,
    sectionTitle("\u7F51\u683C"),
    grid.row,
    gridInline,
    gridColorRow,
    gridWidth.row,
    gridStyle.row,
    gridOpacity.row,
    sectionTitle("\u56FE\u4F8B\u4E0E\u66F2\u7EBF label"),
    legend.row
  );
  const curveRows = [];
  if (options.curves.length) {
    const curveBox = div("awb-settings-curves");
    for (const curve of options.curves) {
      const input = el("input", "awb-settings-input");
      input.type = "text";
      input.value = starting.curve_labels[curve.id] || "";
      input.placeholder = curve.label || curve.id;
      const row = div("awb-settings-row");
      row.append(el("span", "awb-settings-label", curve.label || curve.id), input);
      curveBox.append(row);
      curveRows.push({ id: curve.id, input });
    }
    form.append(curveBox);
  }
  function read() {
    const curveLabels = {};
    for (const item of curveRows) {
      const value = item.input.value.trim();
      if (value) curveLabels[item.id] = value;
    }
    return normalizeChartAppearance({
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
      curve_labels: curveLabels
    });
  }
  let previewFrame = 0;
  function preview() {
    if (closed || previewFrame) return;
    previewFrame = requestAnimationFrame(() => {
      previewFrame = 0;
      if (!closed) options.onPreview(read());
    });
  }
  for (const input of [title.input, xlabel.input, ylabel.input, ylabel2.input, gridColor, gridWidth.input, gridOpacity.input, ...curveRows.map((item) => item.input)]) {
    input.addEventListener("input", preview);
  }
  for (const select of [xscale.select, yscale.select, layout.select, gridStyle.select]) {
    select.addEventListener("change", preview);
  }
  for (const input of [grid.input, gridX.input, gridY.input, legend.input]) {
    input.addEventListener("change", preview);
  }
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
    gridColor.value = "#64748b";
    gridWidth.input.value = String(d.grid_width);
    gridStyle.select.value = d.grid_style;
    gridOpacity.input.value = String(d.grid_opacity);
    legend.input.checked = d.legend;
    for (const item of curveRows) item.input.value = "";
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
