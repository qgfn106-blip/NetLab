const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const stage = $("#stage");
const canvas = $("#graph");
const ctx = canvas.getContext("2d");
const chartCanvas = $("#chart");
const chartCtx = chartCanvas.getContext("2d");
const phaseCanvas = $("#phase");
const phaseCtx = phaseCanvas.getContext("2d");
const scopeCanvas = $("#scope");
const scopeCtx = scopeCanvas?.getContext("2d");
const lissCanvas = $("#lissajous");
const lissCtx = lissCanvas?.getContext("2d");
export {
  $,
  $$,
  canvas,
  chartCanvas,
  chartCtx,
  ctx,
  lissCanvas,
  lissCtx,
  phaseCanvas,
  phaseCtx,
  scopeCanvas,
  scopeCtx,
  stage
};
