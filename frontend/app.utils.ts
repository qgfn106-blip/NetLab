// 前端纯函数工具（P17.3 拆分：无 DOM、无状态依赖，可 node 单测）。
// 注意：netlab 前端零构建发包，app.utils.js 为同名运行产物（浏览器按 ES Module 导入）。

export function fmt(value: unknown, digits: number = 4): string {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return '—';
  const magnitude = Math.abs(number);
  if (magnitude !== 0 && (magnitude >= 1e5 || magnitude < 1e-3)) {
    return number.toExponential(3);
  }
  let text = number.toFixed(digits);
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
  return text === '-0' ? '0' : text;
}

export function intText(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.round(number)) : '0';
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function hashString(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function baseName(path: string): string {
  const text = String(path || '').replace(/[\\/]+$/, '');
  const cut = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
  return cut >= 0 ? text.slice(cut + 1) : text;
}
