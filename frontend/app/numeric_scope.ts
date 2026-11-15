// 工程级数值精度/显示位数的纯函数：供前端工程加载与单元测试复用（无浏览器依赖）。

export function resolveProjectNumeric(
  ui: Record<string, unknown> | undefined | null,
): { numericPrecision: 'exact' | 'standard'; numericDigits: number } {
  const p = ui && (ui as Record<string, unknown>).numericPrecision === 'standard' ? 'standard' : 'exact';
  const n = Number(ui ? (ui as Record<string, unknown>).numericDigits : NaN);
  const d = Number.isFinite(n) ? Math.max(3, Math.min(17, Math.round(n))) : 6;
  return { numericPrecision: p, numericDigits: d };
}

export function formatPolynomial(coeffs: unknown, digits: number): string {
  if (!Array.isArray(coeffs) || !coeffs.length) return '';
  const parts: string[] = [];
  const n = coeffs.length;
  for (let i = 0; i < n; i += 1) {
    const raw = coeffs[i];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return '';
    const c = raw;
    if (c === 0) continue;
    const pow = n - 1 - i;
    let num = Math.abs(c).toPrecision(digits);
    if (num.includes('.')) num = num.replace(/0+$/, '').replace(/\.$/, '');
    const term = pow === 0 ? num : pow === 1 ? `${num}s` : `${num}s^${pow}`;
    const sign = c < 0 ? '\u2212' : parts.length ? '+' : '';
    parts.push(`${sign}${term}`);
  }
  return parts.length ? parts.join('') : '0';
}
