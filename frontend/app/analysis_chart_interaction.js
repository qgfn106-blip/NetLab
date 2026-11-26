import { clampRange, panelFor } from "./analysis_chart_model.js";
function nearestMarker(envelope, axis, visibleCategories, px, py) {
  let bestMarker = null;
  let bestDist = 12;
  for (const marker of envelope.markers) {
    if (!visibleCategories.has(marker.category)) continue;
    if (panelFor(envelope, marker.axis_y) !== axis.slot) continue;
    const mx = axis.sx.to(marker.x);
    const my = axis.sy.to(marker.y);
    if (mx === null || my === null) continue;
    const dist = Math.hypot(mx - px, my - py);
    if (dist < bestDist) {
      bestDist = dist;
      bestMarker = marker;
    }
  }
  return bestMarker;
}
function nearestCurve(envelope, axis, px) {
  let best = null;
  for (const curve of envelope.curves) {
    if (panelFor(envelope, curve.axes[1]) !== axis.slot) continue;
    for (let i = 0; i < curve.x.length; i++) {
      const mx = axis.sx.to(curve.x[i]);
      if (mx === null) continue;
      const distance = Math.abs(mx - px);
      if (!best || distance < best.distance) best = { curve, index: i, distance };
    }
  }
  return best ? { curve: best.curve, index: best.index } : null;
}
function boxSelectionRange(axis, startPx, startPy, currentPx, currentPy) {
  if (Math.abs(currentPx - startPx) <= 4 || Math.abs(currentPy - startPy) <= 4) return null;
  const x0 = axis.sx.from(Math.min(startPx, currentPx));
  const x1 = axis.sx.from(Math.max(startPx, currentPx));
  const y0 = axis.sy.from(Math.max(startPy, currentPy));
  const y1 = axis.sy.from(Math.min(startPy, currentPy));
  return { xlim: clampRange(Math.min(x0, x1), Math.max(x0, x1)), ylim: clampRange(Math.min(y0, y1), Math.max(y0, y1)) };
}
export {
  boxSelectionRange,
  nearestCurve,
  nearestMarker
};
