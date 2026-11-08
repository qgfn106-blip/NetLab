/* Netlab app DOM helpers and element refs (S5 split from app.ts). */

export const $ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T => root.querySelector<T>(selector) as T;
export const $$ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] => Array.from(root.querySelectorAll<T>(selector));
export const stage = $('#stage')!;
export const canvas = $<HTMLCanvasElement>('#graph')!;
export const ctx = canvas.getContext('2d')!;
export const chartCanvas = $<HTMLCanvasElement>('#chart')!;
export const chartCtx = chartCanvas.getContext('2d')!;
export const phaseCanvas = $<HTMLCanvasElement>('#phase')!;
export const phaseCtx = phaseCanvas.getContext('2d')!;
export const scopeCanvas = $<HTMLCanvasElement>('#scope')!;
export const scopeCtx = scopeCanvas?.getContext('2d');
export const lissCanvas = $<HTMLCanvasElement>('#lissajous')!;
export const lissCtx = lissCanvas?.getContext('2d');
