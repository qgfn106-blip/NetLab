import { clamp } from "../app.utils.js";
import { C, tokens } from "./colors.js";
import { drawWbSubplot } from "./wb_subplot.js";
import { PLOT_SEMANTICS, buildPlotLineLayers } from "./plot_semantics.js";
let chartEnv;
function initWorkbenchChart(env) {
  chartEnv = env;
}
const PLOTKIT_RENDER2D_URL = "/plotkit/static/render2d.js";
function readPlot2D() {
  const holder = window;
  return holder.Plot2D;
}
let plot2dLoading = null;
async function loadPlot2DApi() {
  const existing = readPlot2D();
  if (existing) return existing;
  if (!plot2dLoading) {
    const url = PLOTKIT_RENDER2D_URL;
    plot2dLoading = (async () => {
      await import(url);
      const api = readPlot2D();
      if (!api) throw new Error("PlotKit render2d \u672A\u6CE8\u518C window.Plot2D");
      return api;
    })();
  }
  return plot2dLoading;
}
class SimpleCanvasRenderer {
  constructor() {
    this.kind = "simple-chart";
    this.host = null;
    this.canvas = null;
    this.series = null;
    this.height = chartEnv.getCompareLayout().height;
  }
  mount(host, opts) {
    this.host = host;
    this.height = opts?.height ?? chartEnv.getCompareLayout().height;
    host.replaceChildren();
    const canvas = document.createElement("canvas");
    canvas.className = "wb-subplot-canvas";
    host.appendChild(canvas);
    this.canvas = canvas;
  }
  setSeries(series) {
    this.series = series;
    this.draw();
  }
  draw() {
    if (!this.canvas || !this.series) return;
    const { entry, signals, xMin, xMax, height } = this.series;
    drawWbSubplot(this.canvas, entry, signals, xMin ?? 0, xMax ?? 1, height ?? this.height, { colorForKey: chartEnv.colorForKey, wbCompareLayout: chartEnv.getCompareLayout() });
  }
  resize() {
    this.draw();
  }
  destroy() {
    this.canvas = null;
    this.series = null;
    this.host = null;
  }
}
class PlotKitRenderer {
  constructor() {
    this.kind = "plotkit";
    this.host = null;
    this.canvas = null;
    this.series = null;
    this.height = chartEnv.getCompareLayout().height;
    this.renderToken = 0;
  }
  mount(host, opts) {
    this.host = host;
    this.height = opts?.height ?? chartEnv.getCompareLayout().height;
    host.replaceChildren();
    const canvas = document.createElement("canvas");
    canvas.className = "wb-subplot-canvas";
    host.appendChild(canvas);
    this.canvas = canvas;
  }
  setSeries(series) {
    this.series = series;
    this.renderToken += 1;
    void this.renderAsync(this.renderToken);
  }
  async renderAsync(token) {
    const canvas = this.canvas;
    const series = this.series;
    if (!canvas || !series) return;
    try {
      const api = await loadPlot2DApi();
      if (token !== this.renderToken || this.canvas !== canvas || !this.series) return;
      this.drawWithPlotKit(api, canvas, series);
      if (this.host) this.host.removeAttribute("data-renderer-fallback");
    } catch (error) {
      if (token !== this.renderToken || this.canvas !== canvas || !this.series) return;
      const { entry, signals, xMin, xMax, height } = series;
      drawWbSubplot(canvas, entry, signals, xMin ?? 0, xMax ?? 1, height ?? this.height, { colorForKey: chartEnv.colorForKey, wbCompareLayout: chartEnv.getCompareLayout() });
      if (this.host) this.host.setAttribute("data-renderer-fallback", "1");
      console.warn("[W3] PlotKit \u6E32\u67D3\u4E0D\u53EF\u7528\uFF0C\u5DF2\u56DE\u9000\u7B80\u6613\u6E32\u67D3\uFF1A", error?.message || error);
    }
  }
  drawWithPlotKit(api, canvas, series) {
    const { entry, signals, height } = series;
    const times = entry.t || [];
    if (!times.length) return;
    const hostW = canvas.parentElement?.getBoundingClientRect().width || 320;
    const cssW = Math.max(120, Math.round(hostW));
    const cssH = Math.max(80, Math.round(height ?? this.height));
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const columns = {};
    columns[PLOT_SEMANTICS.timeField] = Float32Array.from(times);
    for (const key of signals) {
      const arr = entry.series?.[key] || [];
      const n = Math.min(arr.length, times.length);
      const values = new Float32Array(n);
      for (let i = 0; i < n; i += 1) values[i] = arr[i];
      columns[key] = values;
    }
    const store = {
      get(name) {
        const values = columns[name];
        return values ? { values } : null;
      }
    };
    const layers = buildPlotLineLayers(signals, columns, chartEnv.colorForKey);
    const toks = tokens();
    const themeTokens = {
      paper: C("#faf8f2"),
      plot: C("#fbf9f4"),
      text: C("#3a3a33"),
      muted: C("#969083"),
      grid: C("#e6e2d6"),
      accent: String(toks.accent || C("#a8541f"))
    };
    const spec = {
      figure: {
        title: entry.name || String(entry.state_id || ""),
        xlabel: "t",
        ylabel: "",
        subplots: 1,
        ncols: 1
      },
      layers
    };
    api.render(canvas, spec, store, {
      dpr: clamp(window.devicePixelRatio || 1, 1, 2.5),
      width: cssW,
      height: cssH,
      tokens: themeTokens
    });
  }
  resize() {
    if (!this.canvas || !this.series) return;
    this.renderToken += 1;
    void this.renderAsync(this.renderToken);
  }
  destroy() {
    this.renderToken += 1;
    this.canvas = null;
    this.series = null;
    this.host = null;
  }
}
function createChartRenderer(kind) {
  return kind === "plotkit" ? new PlotKitRenderer() : new SimpleCanvasRenderer();
}
export {
  createChartRenderer,
  initWorkbenchChart
};
