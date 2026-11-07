// P-A4 外观面板 · 设置持久化 / 默认不变 的最小自测（Node ESM，零依赖）
// 运行：node frontend/scripts/selftest_pa4_appearance.mjs
// 说明：app.ts 的 applyAppearance()/computeRuntimeOverride() 依赖 DOM，无法直接 import；
//       此处用同一份 theme.tokens.js 令牌 + 复刻其纯计算逻辑，验证「9 项写读」「默认零变化」契约。
import {
  CANVAS_LIGHT, CANVAS_DARK,
  CHART_PALETTE_HC_LIGHT, CHART_PALETTE_HC_DARK,
  CHART_PALETTE_CB_LIGHT, CHART_PALETTE_CB_DARK,
} from '../theme.tokens.js';

const PREF_DEFAULTS = {
  theme: 'system', motion: 'low', perf: 'perf', accent: '', accentDark: '',
  fontScale: 12, density: 'standard', surfaceTone: 0, radius: 0, lineWidth: 1, chartPalette: 'theme',
};

function hexToRgb(hex) {
  const m = String(hex).replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}
function mixHex(fg, bg, amount) {
  const a = hexToRgb(fg), b = hexToRgb(bg);
  if (!a || !b) return fg;
  const t = Math.min(1, Math.max(0, Number(amount) || 0));
  const out = a.map((c, i) => Math.round(c + (b[i] - c) * t));
  return `rgb(${out[0]}, ${out[1]}, ${out[2]})`;
}
// 复刻 app.ts computeRuntimeOverride（只记录与默认不同的键）
function computeRuntimeOverride(theme, pref) {
  const base = theme === 'dark' ? CANVAS_DARK : CANVAS_LIGHT;
  const ov = {};
  const accent = (theme === 'dark' ? pref.accentDark : pref.accent) || base.accent;
  if (accent && accent !== base.accent) {
    ov.accent = accent;
    ov.accentSoft = mixHex(base.paper, accent, 0.28);
  }
  const tone = Math.min(1, Math.max(-1, Number(pref.surfaceTone) || 0));
  if (tone !== 0) {
    const anchor = tone > 0 ? base.toneWhite : base.toneBlack;
    const amount = Math.abs(tone) * 0.16;
    for (const key of ['paper', 'panel', 'surface', 'paper3']) {
      if (base[key]) ov[key] = mixHex(base[key], anchor, amount);
    }
  }
  return ov;
}

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('  ✗ FAIL:', msg); } };

// 1) 默认不变：默认偏好 → 运行期覆盖为空（DOM/画布与静态令牌逐像素一致）
ok(Object.keys(computeRuntimeOverride('light', { ...PREF_DEFAULTS })).length === 0, '默认(light) 覆盖应空');
ok(Object.keys(computeRuntimeOverride('dark', { ...PREF_DEFAULTS })).length === 0, '默认(dark) 覆盖应空');

// 2) 字号档 --ui-font-scale 默认=1 → calc(Npx*1)=Npx（逐像素不变）
const ratio = (px) => px / 12;
ok(ratio(12) === 1, '12px 缩放比例 = 1（默认字号不变）');
ok(Number((ratio(14)).toFixed(5)) === 1.16667, '14px 比例 ≈ 1.16667');
ok(Number((ratio(11)).toFixed(5)) === 0.91667, '11px 比例 ≈ 0.91667');

// 3) 9 项写入 → 模拟 localStorage 序列化 → 重启读取合并 → 全等
const storage = {};
const writePrefCache = (prefs) => { storage['netlab.ui.prefs'] = JSON.stringify(prefs); };
const readPrefCache = () => JSON.parse(storage['netlab.ui.prefs'] || 'null');

let prefs = { ...PREF_DEFAULTS };
// 改动全部 9 项（含 accent 浅色 / accentDark 深色）
prefs.theme = 'dark';
prefs.accent = '#3366cc';
prefs.accentDark = '#ffaa00';
prefs.fontScale = 14;
prefs.density = 'loose';
prefs.surfaceTone = 0.5;
prefs.radius = 4;
prefs.lineWidth = 1.5;
prefs.motion = 'high';
prefs.perf = 'quality';
prefs.chartPalette = 'colorblind';
writePrefCache(prefs);

// 模拟重启：从默认值出发合并缓存
const reloaded = { ...PREF_DEFAULTS, ...(readPrefCache() || {}) };
const keys9 = ['theme', 'accent', 'accentDark', 'fontScale', 'density', 'surfaceTone', 'radius', 'lineWidth', 'motion', 'perf', 'chartPalette'];
for (const k of keys9) ok(reloaded[k] === prefs[k], `持久化往返相等: ${k} (${reloaded[k]} vs ${prefs[k]})`);

// 4) 非默认确实产生覆盖（自定义 accent 同时进画布 token 与 DOM 变量源）
const ovDark = computeRuntimeOverride('dark', reloaded);
ok(ovDark.accent === '#ffaa00', '深色自定义 accent 进入覆盖表（画布+DOM 同源）');
ok(typeof ovDark.accentSoft === 'string' && ovDark.accentSoft.startsWith('rgb('), 'accent-soft 由 accent 混出');
ok(typeof ovDark.panel === 'string', '明暗强度微调改写 panel/paper-2');

// 5) 画布配色替代方案：四套各 10 色，且高对比浅/深与色盲友好互不相同
for (const [name, arr] of Object.entries({
  CHART_PALETTE_HC_LIGHT, CHART_PALETTE_HC_DARK, CHART_PALETTE_CB_LIGHT, CHART_PALETTE_CB_DARK,
})) {
  ok(Array.isArray(arr) && arr.length === 10, `${name} 长度应为 10`);
}
ok(CHART_PALETTE_HC_LIGHT[0] !== CHART_PALETTE_CB_LIGHT[0], '高对比与色盲友好色板不同');

// 6) 恢复默认：覆盖回默认 → 覆盖表再次为空
const reset = { ...PREF_DEFAULTS };
ok(Object.keys(computeRuntimeOverride('dark', reset)).length === 0, '恢复默认后深色覆盖应为空');

console.log(`\nP-A4 自测结果：${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
