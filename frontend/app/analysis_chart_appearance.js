const DEFAULT_CHART_APPEARANCE = {
  title: "",
  xlabel: "",
  ylabel: "",
  ylabel2: "",
  xscale: "auto",
  yscale: "auto",
  panel_layout: "auto",
  grid: true,
  grid_x: true,
  grid_y: true,
  grid_color: "",
  grid_width: 1,
  grid_style: "solid",
  grid_opacity: 0.35,
  legend: false,
  curve_labels: {}
};
function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function text(value, fallback = "") {
  return typeof value === "string" ? value.slice(0, 200) : fallback;
}
function bool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}
function number(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
function choice(value, values, fallback) {
  return typeof value === "string" && values.includes(value) ? value : fallback;
}
function normalizeChartAppearance(value) {
  const raw = record(value);
  const labels = record(raw.curve_labels);
  const curveLabels = {};
  for (const [key, label] of Object.entries(labels)) {
    if (typeof label === "string" && key && label.trim()) curveLabels[key.slice(0, 120)] = label.trim().slice(0, 120);
  }
  return {
    title: text(raw.title),
    xlabel: text(raw.xlabel),
    ylabel: text(raw.ylabel),
    ylabel2: text(raw.ylabel2),
    xscale: choice(raw.xscale, ["auto", "linear", "log"], "auto"),
    yscale: choice(raw.yscale, ["auto", "linear", "log"], "auto"),
    panel_layout: choice(raw.panel_layout, ["auto", "row", "column"], "auto"),
    grid: bool(raw.grid, true),
    grid_x: bool(raw.grid_x, true),
    grid_y: bool(raw.grid_y, true),
    grid_color: text(raw.grid_color, ""),
    grid_width: number(raw.grid_width, 1, 0.2, 4),
    grid_style: choice(raw.grid_style, ["solid", "dashed", "dotted", "dashdot"], "solid"),
    grid_opacity: number(raw.grid_opacity, 0.35, 0.05, 1),
    legend: bool(raw.legend, false),
    curve_labels: curveLabels
  };
}
function cloneChartAppearance(value) {
  return {
    ...value,
    curve_labels: { ...value.curve_labels }
  };
}
function chartAppearanceIsDefault(value) {
  return JSON.stringify(normalizeChartAppearance(value)) === JSON.stringify(DEFAULT_CHART_APPEARANCE);
}
export {
  DEFAULT_CHART_APPEARANCE,
  chartAppearanceIsDefault,
  cloneChartAppearance,
  normalizeChartAppearance
};
