function niceStep(span, target) {
  if (!isFinite(span) || span <= 0) return 1;
  const raw = span / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1;
  return step * mag;
}
function ticksLinear(lo, hi, target) {
  if (!isFinite(lo) || !isFinite(hi) || hi === lo) return { ticks: [lo], step: 1 };
  const step = niceStep(hi - lo, target);
  const start = Math.ceil(lo / step) * step;
  const out = [];
  for (let v = start; v <= hi + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return { ticks: out, step };
}
function ticksLog(lo, hi, target) {
  if (!(lo > 0) || !(hi > 0)) return { ticks: [] };
  const e0 = Math.floor(Math.log10(lo));
  const e1 = Math.ceil(Math.log10(hi));
  const stride = Math.max(1, Math.round((e1 - e0) / Math.max(2, target)));
  const out = [];
  for (let e = e0; e <= e1; e += stride) {
    const v = Math.pow(10, e);
    if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v);
  }
  return { ticks: out, log: true };
}
function fmtNum(v, step) {
  if (!isFinite(v)) return "";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-4) {
    const e = Math.floor(Math.log10(a));
    const m = v / Math.pow(10, e);
    return `${+m.toFixed(2)}e${e}`;
  }
  const dec = step ? Math.max(0, Math.min(6, -Math.floor(Math.log10(step)))) : a < 1 ? 3 : a < 10 ? 2 : 0;
  return (+v.toFixed(dec)).toString();
}
function extent(arr) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v !== v) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!isFinite(lo) || !isFinite(hi)) return null;
  if (lo === hi) {
    const pad = Math.abs(lo) * 0.1 || 1;
    return [lo - pad, hi + pad];
  }
  return [lo, hi];
}
function padRange(range, frac) {
  if (!range) return [0, 1];
  const d = range[1] - range[0] || Math.abs(range[0]) || 1;
  return [range[0] - d * frac, range[1] + d * frac];
}
function union(a, b) {
  if (!a) return b;
  if (!b) return a;
  return [Math.min(a[0], b[0]), Math.max(a[1], b[1])];
}
function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function hexAlpha(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return `rgba(79,195,247,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}
function colorRamp(v, lo, hi, _tokens) {
  if (!isFinite(lo)) lo = 0;
  if (!isFinite(hi) || hi === lo) hi = lo + 1;
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1)));
  const stops = [
    [49, 54, 149],
    [69, 117, 180],
    [116, 173, 209],
    [171, 217, 233],
    [224, 243, 248],
    [254, 224, 144],
    [253, 174, 97],
    [244, 109, 67],
    [215, 48, 39]
  ];
  const pos = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(pos));
  const f = pos - i;
  const c = stops[i].map((ch, k) => Math.round(ch + (stops[i + 1][k] - ch) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
export {
  colorRamp,
  extent,
  fmtNum,
  hexAlpha,
  niceStep,
  padRange,
  quantile,
  ticksLinear,
  ticksLog,
  union
};
