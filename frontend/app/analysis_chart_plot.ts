export interface PlotScale {
  kind: 'linear' | 'log';
  d0: number;
  d1: number;
  to(v: number): number | null;
  from(px: number): number;
}

export interface PlotAxis {
  slot: number;
  box: { x: number; y: number; w: number; h: number };
  xlim: number[];
  ylim: number[];
  xscale: string;
  yscale: string;
  sx: PlotScale;
  sy: PlotScale;
}

export interface PlotPickable {
  slot: number;
  color?: string;
  layer: { label?: string };
}

export interface PlotRenderResult {
  axes: PlotAxis[];
  pickables: PlotPickable[];
  cssW: number;
  cssH: number;
}

export interface Plot2DApi {
  render(canvas: HTMLCanvasElement, spec: unknown, store: unknown, opts?: unknown): PlotRenderResult;
  PALETTE: string[];
}

export function plot2d(): Plot2DApi | null {
  const holder = window as unknown as { Plot2D?: Plot2DApi };
  return holder.Plot2D || null;
}

let loader: Promise<Plot2DApi | null> | null = null;

export async function loadPlot2D(): Promise<Plot2DApi | null> {
  const existing = plot2d();
  if (existing) return existing;
  if (loader) return loader;
  const url = '/plotkit/static/render2d.js';
  loader = import(/* @vite-ignore */ url)
    .then(() => plot2d())
    .catch(() => null);
  return loader;
}
