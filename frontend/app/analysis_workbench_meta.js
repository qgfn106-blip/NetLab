const KIND_LABELS = {
  bode: "Bode",
  time: "\u65F6\u57DF",
  nyquist: "Nyquist",
  loop: "\u73AF\u8DEF",
  metrics: "\u6307\u6807",
  poles: "\u6781\u70B9/\u96F6\u70B9",
  loop_closed: "\u95ED\u73AF Bode",
  loop_step: "\u95ED\u73AF\u9636\u8DC3"
};
const KIND_HINTS = {
  bode: "\u5F00\u73AF/\u95ED\u73AF\u9891\u54CD\uFF1A\u5E45\u503C\u3001\u76F8\u4F4D\u3001\u6781\u70B9\u96F6\u70B9\u4E0E\u5173\u952E\u70B9",
  time: "\u9636\u8DC3/\u8109\u51B2\u54CD\u5E94\uFF1A\u5CF0\u503C\u3001\u4E0A\u5347\u3001\u8C03\u8282\u65F6\u95F4",
  nyquist: "\u56DE\u8DEF\u589E\u76CA\u8F6E\u5ED3\u3001-1 \u70B9\u5305\u56F4\u4E0E\u7A33\u5B9A\u88D5\u5EA6",
  loop: "\u663E\u5F0F\u65AD\u73AF G/H/T\uFF0C\u6216\u672A\u65AD\u73AF\u65F6\u6309\u865A\u62DF\u5355\u4F4D\u8D1F\u53CD\u9988\u663E\u793A G/(1+G)",
  metrics: "\u5DE5\u4F5C\u70B9\u4E0E\u7A33\u5B9A\u6027\u6307\u6807\u6C47\u603B",
  poles: "\u5F00\u73AF\u4F20\u51FD\u6781\u70B9/\u96F6\u70B9\u4E0E\u7A33\u5B9A\u88D5\u5EA6",
  loop_closed: "\u95ED\u73AF T(s)=L/(1+L)\uFF1A\u5408\u6210\u4E0E\u76F4\u63A5\u95ED\u73AF\u5E45\u76F8\u6838\u5BF9",
  loop_step: "\u95ED\u73AF\u9636\u8DC3\u54CD\u5E94\u4E0E\u7A33\u5B9A\u88D5\u5EA6"
};
const STATE_COLORS = ["#9b7247", "#7a6fb0", "#4f8a8b", "#c05a7a", "#6f8f45", "#b07a3a"];
function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
}
function shortFingerprint(value) {
  const text = String(value ?? "");
  return text ? text.slice(0, 12) : "\u2014";
}
function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function optionHtml(value, label, selected) {
  return '<option value="' + escapeHtml(value) + '"' + (selected ? " selected" : "") + ">" + escapeHtml(label) + "</option>";
}
function loopElementOptions(candidates, activeElement, allowVirtual) {
  const candidatesHtml = candidates.map((candidate) => {
    const element = String(candidate.element || "");
    return optionHtml(element, element + " \xB7 " + String(candidate.kind || ""), element === activeElement);
  }).join("");
  const virtualHtml = allowVirtual ? optionHtml("__virtual__", "\u865A\u62DF\u5355\u4F4D\u8D1F\u53CD\u9988\uFF08\u65E0\u5B9E\u4F53\u73AF\uFF09", activeElement === "__virtual__" || !activeElement && !candidates.length) : "";
  return candidatesHtml + virtualHtml || optionHtml("", "\uFF08\u5148\u9009\u62E9\u53D7\u63A7\u6E90\uFF09", true);
}
function describeRunStatus(envelope) {
  const source = envelope?.source || {};
  const metrics = envelope?.metrics || {};
  const path = String(source["path"] || "");
  const approximate = metrics["approximate"] === true || source["approximate"] === true || path === "fft_trajectory";
  const label = path === "fft_trajectory" ? "FFT \u8FD1\u4F3C" : path === "descriptor_linearized" ? "\u63CF\u8FF0\u5668\u7EBF\u6027\u5316" : String(source["model"] || "\u2014");
  const sourceText = label + (source["loop_origin"] === "virtual_unit_feedback" ? " \xB7 \u865A\u62DF\u5355\u4F4D\u8D1F\u53CD\u9988" : "") + (approximate ? " \xB7 \u8FD1\u4F3C" : "");
  const stable = typeof metrics["stable"] === "boolean" ? metrics["stable"] ? "\u662F" : "\u5426" : approximate ? "\u4E0D\u53C2\u4E0E\u5224\u7A33" : "\u2014";
  return { source: sourceText, stability: stable };
}
export {
  KIND_HINTS,
  KIND_LABELS,
  STATE_COLORS,
  describeRunStatus,
  escapeHtml,
  loopElementOptions,
  num,
  optionHtml,
  shortFingerprint
};
