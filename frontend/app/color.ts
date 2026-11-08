import { clamp } from '../app.utils.js';

export function hexToRgb(hex: string) {
  const text = String(hex || '').trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(text)) {
    return [0, 1, 2].map((index: number) => parseInt(text[index] + text[index], 16));
  }
  if (!/^[0-9a-fA-F]{6}$/.test(text)) return null;
  return [0, 2, 4].map((index: number) => parseInt(text.slice(index, index + 2), 16));
}

export function hexToRgbString(hex: string) {
  const rgb = hexToRgb(hex);
  return rgb ? rgb.join(', ') : '155, 114, 71';
}

export function mixHex(foreground: string, background: string, amount: number) {
  const a = hexToRgb(foreground);
  const b = hexToRgb(background);
  if (!a || !b) return foreground;
  const t = clamp(Number(amount) || 0, 0, 1);
  const out = a.map((channel, index: number) => Math.round(channel + (b[index] - channel) * t));
  return `rgb(${out[0]}, ${out[1]}, ${out[2]})`;
}
