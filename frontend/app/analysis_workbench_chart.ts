import { clamp } from '../app.utils.js';
import { C, tokens } from './colors.js';
import { drawWbSubplot } from './wb_subplot.js';
import { PLOT_SEMANTICS, frameSeriesToPoints, buildPlotLineLayers } from './plot_semantics.js';

export interface WbChartEntry {
  state_id?: string;
  name?: string;
  ok?: boolean;
  missing?: boolean;
  stale?: boolean;
  reason?: string;
  t?: number[];
  series?: Record<string, number[]>;
  meta?: Record<string, unknown>;
}

export interface WbChartEnv {
  colorForKey: (key: string) => string;
  getCompareLayout: () => { cols: number; height: number };
}

let chartEnv: WbChartEnv;

export function initWorkbenchChart(env: WbChartEnv): void {
  chartEnv = env;
}

// ===== W3：绘图渲染器抽象（PlotKit 去 iframe 化的内嵌渲染） =====
// 规格（Q8=A）：PlotKit 保留渲染内核、去掉 iframe 独立外壳，作为 netlab 内嵌绘图模块；
// netlab 自带简易 chart 保留；建/对比子图时可选绘制器。kind 与规格一致：'simple-chart' / 'plotkit'。
export type WbRendererKind = 'simple-chart' | 'plotkit';

interface WbChartSeries {
  entry: WbChartEntry;
  signals: string[];
  xMin?: number;
  xMax?: number;
  height?: number;
}

interface WbChartMountOptions {
  height?: number;
  title?: string;
}

export interface ChartRenderer {
  readonly kind: WbRendererKind;
  mount(el: HTMLElement, opts?: WbChartMountOptions): void;
  setSeries(series: WbChartSeries): void;
  resize(): void;
  destroy(): void;
}

// PlotKit render2d ESM 的同源静态路径：plotkit_bridge 把 PlotKit 子应用挂到 /plotkit，
// 其静态资源在此前缀下（见 netlab/_vendor/plotkit/server/app.py 的 /static 挂载）。
const PLOTKIT_RENDER2D_URL = '/plotkit/static/render2d.js';

// PlotKit 渲染内核最小类型面：运行时由 render2d.js 挂到 window.Plot2D，仅用 render 出图。
interface Plot2DLayer {
  kind?: string;
  subplot?: number;
  data?: Record<string, string>;
  style?: Record<string, string | number>;
  label?: string;
  legend?: boolean;
}
interface Plot2DSpec {
  figure?: { title?: string; xlabel?: string; ylabel?: string; subplots?: number; ncols?: number };
  layers?: Plot2DLayer[];
}
interface Plot2DSeriesData { values: Float32Array; }
interface Plot2DStore { get(name: string): Plot2DSeriesData | null; }
interface Plot2DRenderOptions {
  dpr?: number;
  width?: number;
  height?: number;
  tokens?: Record<string, string>;
}
interface Plot2DApi {
  render(canvas: HTMLCanvasElement, spec: Plot2DSpec, store: Plot2DStore, opts?: Plot2DRenderOptions): unknown;
}
function readPlot2D(): Plot2DApi | undefined {
  const holder = window as unknown as { Plot2D?: Plot2DApi };
  return holder.Plot2D;
}

let plot2dLoading: Promise<Plot2DApi> | null = null;
async function loadPlot2DApi(): Promise<Plot2DApi> {
  const existing = readPlot2D();
  if (existing) return existing;
  if (!plot2dLoading) {
    const url = PLOTKIT_RENDER2D_URL;
    plot2dLoading = (async () => {
      // 动态加载 PlotKit 渲染 ESM（变量路径 → 不静态打包进 netlab bundle）。
      await import(url);
      const api = readPlot2D();
      if (!api) throw new Error('PlotKit render2d 未注册 window.Plot2D');
      return api;
    })();
  }
  return plot2dLoading;
}

/** 简易 canvas 渲染器：封装现有 drawWbSubplot，行为与旧对比图完全一致。 */
class SimpleCanvasRenderer implements ChartRenderer {
  readonly kind: WbRendererKind = 'simple-chart';
  private host: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private series: WbChartSeries | null = null;
  private height = chartEnv.getCompareLayout().height;

  mount(host: HTMLElement, opts?: WbChartMountOptions): void {
    this.host = host;
    this.height = opts?.height ?? chartEnv.getCompareLayout().height;
    host.replaceChildren();
    const canvas = document.createElement('canvas');
    canvas.className = 'wb-subplot-canvas';
    host.appendChild(canvas);
    this.canvas = canvas;
  }

  setSeries(series: WbChartSeries): void {
    this.series = series;
    this.draw();
  }

  private draw(): void {
    if (!this.canvas || !this.series) return;
    const { entry, signals, xMin, xMax, height } = this.series;
    drawWbSubplot(this.canvas, entry, signals, xMin ?? 0, xMax ?? 1, height ?? this.height, { colorForKey: chartEnv.colorForKey, wbCompareLayout: chartEnv.getCompareLayout() });
  }

  resize(): void {
    this.draw();
  }

  destroy(): void {
    this.canvas = null;
    this.series = null;
    this.host = null;
  }
}

/** PlotKit 内嵌渲染器：动态 import PlotKit render2d ESM，直接把二维内核画到 netlab 的 canvas，无 iframe。 */
class PlotKitRenderer implements ChartRenderer {
  readonly kind: WbRendererKind = 'plotkit';
  private host: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private series: WbChartSeries | null = null;
  private height = chartEnv.getCompareLayout().height;
  private renderToken = 0;

  mount(host: HTMLElement, opts?: WbChartMountOptions): void {
    this.host = host;
    this.height = opts?.height ?? chartEnv.getCompareLayout().height;
    host.replaceChildren();
    const canvas = document.createElement('canvas');
    canvas.className = 'wb-subplot-canvas';
    host.appendChild(canvas);
    this.canvas = canvas;
  }

  setSeries(series: WbChartSeries): void {
    this.series = series;
    this.renderToken += 1;
    void this.renderAsync(this.renderToken);
  }

  private async renderAsync(token: number): Promise<void> {
    const canvas = this.canvas;
    const series = this.series;
    if (!canvas || !series) return;
    try {
      const api = await loadPlot2DApi();
      if (token !== this.renderToken || this.canvas !== canvas || !this.series) return;
      this.drawWithPlotKit(api, canvas, series);
      if (this.host) this.host.removeAttribute('data-renderer-fallback');
    } catch (error) {
      // PlotKit 未挂载 / 加载失败：优雅回退到简易渲染，不打断界面、不抛错。
      if (token !== this.renderToken || this.canvas !== canvas || !this.series) return;
      const { entry, signals, xMin, xMax, height } = series;
      drawWbSubplot(canvas, entry, signals, xMin ?? 0, xMax ?? 1, height ?? this.height, { colorForKey: chartEnv.colorForKey, wbCompareLayout: chartEnv.getCompareLayout() });
      if (this.host) this.host.setAttribute('data-renderer-fallback', '1');
      console.warn('[W3] PlotKit 渲染不可用，已回退简易渲染：', (error as Error)?.message || error);
    }
  }

  private drawWithPlotKit(api: Plot2DApi, canvas: HTMLCanvasElement, series: WbChartSeries): void {
    const { entry, signals, height } = series;
    const times = entry.t || [];
    if (!times.length) return;
    const hostW = canvas.parentElement?.getBoundingClientRect().width || 320;
    const cssW = Math.max(120, Math.round(hostW));
    const cssH = Math.max(80, Math.round(height ?? this.height));
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    // 组装 PlotKit Store：共享时间轴（语义契约的 timeField）+ 各信号序列转 Float32Array。
    const columns: Record<string, Float32Array> = {};
    columns[PLOT_SEMANTICS.timeField] = Float32Array.from(times);
    for (const key of signals) {
      const arr = entry.series?.[key] || [];
      const n = Math.min(arr.length, times.length);
      const values = new Float32Array(n);
      for (let i = 0; i < n; i += 1) values[i] = arr[i];
      columns[key] = values;
    }
    const store: Plot2DStore = {
      get(name: string): Plot2DSeriesData | null {
        const values = columns[name];
        return values ? { values } : null;
      },
    };

    const layers: Plot2DLayer[] = buildPlotLineLayers(signals, columns, chartEnv.colorForKey) as Plot2DLayer[];

    const toks = tokens();
    const themeTokens: Record<string, string> = {
      paper: C('#faf8f2'),
      plot: C('#fbf9f4'),
      text: C('#3a3a33'),
      muted: C('#969083'),
      grid: C('#e6e2d6'),
      accent: String(toks.accent || C('#a8541f')),
    };

    const spec: Plot2DSpec = {
      figure: {
        title: entry.name || String(entry.state_id || ''),
        xlabel: 't',
        ylabel: '',
        subplots: 1,
        ncols: 1,
      },
      layers,
    };
    api.render(canvas, spec, store, {
      dpr: clamp(window.devicePixelRatio || 1, 1, 2.5),
      width: cssW,
      height: cssH,
      tokens: themeTokens,
    });
  }

  resize(): void {
    if (!this.canvas || !this.series) return;
    this.renderToken += 1;
    void this.renderAsync(this.renderToken);
  }

  destroy(): void {
    this.renderToken += 1;
    this.canvas = null;
    this.series = null;
    this.host = null;
  }
}

export function createChartRenderer(kind: WbRendererKind): ChartRenderer {
  return kind === 'plotkit' ? new PlotKitRenderer() : new SimpleCanvasRenderer();
}
