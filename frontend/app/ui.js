function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== void 0 && text !== null) node.textContent = String(text);
  return node;
}
function div(cls, text) {
  return el("div", cls, text);
}
function button(label, cls, onClick) {
  const node = el("button", cls || "btn", label);
  node.type = "button";
  if (onClick) node.addEventListener("click", onClick);
  return node;
}
function clone(value) {
  return value === void 0 ? void 0 : JSON.parse(JSON.stringify(value));
}
function isFormTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON";
}
export {
  button,
  clone,
  div,
  el,
  isFormTarget
};
