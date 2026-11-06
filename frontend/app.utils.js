function fmt(value, digits = 4) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return "\u2014";
  const magnitude = Math.abs(number);
  if (magnitude !== 0 && (magnitude >= 1e5 || magnitude < 1e-3)) {
    return number.toExponential(3);
  }
  let text = number.toFixed(digits);
  if (text.includes(".")) text = text.replace(/0+$/, "").replace(/\.$/, "");
  return text === "-0" ? "0" : text;
}
function intText(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.round(number)) : "0";
}
function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}
function hashString(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
function baseName(path) {
  const text = String(path || "").replace(/[\\/]+$/, "");
  const cut = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));
  return cut >= 0 ? text.slice(cut + 1) : text;
}
export {
  baseName,
  clamp,
  fmt,
  hashString,
  intText
};
