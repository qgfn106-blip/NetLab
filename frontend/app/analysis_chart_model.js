function clampRange(lo, hi) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (hi - lo > 1e-12) return [lo, hi];
  const pad = Math.max(Math.abs(lo) * 0.1, 1e-9);
  return [lo - pad, hi + pad];
}
function paddedRange(lo, hi, fraction = 0.05) {
  const [a, b] = clampRange(lo, hi);
  const span = b - a;
  return [a - span * fraction, b + span * fraction];
}
function logSafeRange(lo, hi) {
  if (!(lo > 0) || !(hi > 0)) return [1, 10];
  const la = Math.log10(lo) - 0.02;
  const lb = Math.log10(hi) + 0.02;
  return [Math.pow(10, la), Math.pow(10, lb)];
}
function axisMap(envelope) {
  return new Map(envelope.axes.map((axis) => [axis.id, axis]));
}
function panelCount(envelope) {
  if (envelope.kind !== "bode") return 1;
  return envelope.curves.some((curve) => curve.axes[1] === "phase_deg") ? 2 : 1;
}
function panelFor(envelope, axisId) {
  if (envelope.kind !== "bode") return 0;
  if (axisId === "phase_deg") return 1;
  return 0;
}
function overridesFromView(view) {
  if (!view) return {};
  const out = {};
  for (const [slotText, ylim] of Object.entries(view.ylims)) {
    out[Number(slotText)] = { xlim: view.xlim, ylim };
  }
  return out;
}
export {
  axisMap,
  clampRange,
  logSafeRange,
  overridesFromView,
  paddedRange,
  panelCount,
  panelFor
};
