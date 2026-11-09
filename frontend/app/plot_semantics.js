import { PLOT_SEMANTICS } from "./contracts.js";
function frameSeriesToPoints(time, values, limit = PLOT_SEMANTICS.maxPoints) {
  const n = Math.min(time.length, values.length, limit);
  const x = new Array(n);
  const y = new Array(n);
  for (let i = 0; i < n; i += 1) {
    x[i] = time[i];
    y[i] = values[i];
  }
  return { x, y };
}
function plotLineStyle() {
  return { mode: "lines", width: PLOT_SEMANTICS.lineWidth, marker: { symbol: "" } };
}
function buildPlotLineLayers(signals, columns, colorForKey) {
  const layers = [];
  for (const key of signals) {
    const values = columns[key];
    if (!values || !values.length) continue;
    layers.push({
      kind: "line",
      data: { x: PLOT_SEMANTICS.timeField, y: key },
      style: { color: colorForKey(key), width: PLOT_SEMANTICS.lineWidth },
      label: key,
      legend: true
    });
  }
  return layers;
}
export {
  PLOT_SEMANTICS,
  buildPlotLineLayers,
  frameSeriesToPoints,
  plotLineStyle
};
