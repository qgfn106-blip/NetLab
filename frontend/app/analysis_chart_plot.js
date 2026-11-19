function plot2d() {
  const holder = window;
  return holder.Plot2D || null;
}
let loader = null;
async function loadPlot2D() {
  const existing = plot2d();
  if (existing) return existing;
  if (loader) return loader;
  const url = "/plotkit/static/render2d.js";
  loader = import(
    /* @vite-ignore */
    url
  ).then(() => plot2d()).catch(() => null);
  return loader;
}
export {
  loadPlot2D,
  plot2d
};
