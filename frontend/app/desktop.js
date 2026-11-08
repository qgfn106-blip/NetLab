import { state, ui } from "./state.js";
import { div, el } from "./ui.js";
function desktopBridge() {
  return window.netlabDesktop || null;
}
function isDesktop() {
  return Boolean(desktopBridge());
}
function callBridge(method, args = []) {
  const bridge = desktopBridge();
  if (!bridge || typeof bridge[method] !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      bridge[method](...args, (result) => resolve(result));
    } catch (error) {
      toast(`\u684C\u9762\u6865\u8C03\u7528\u5931\u8D25\uFF08${method}\uFF09\uFF1A${error?.message || error}`, "error", 6e3);
      resolve(null);
    }
  });
}
function toast(message, type = "info", timeout = 4200) {
  const node = div(`toast ${type}`, message);
  ui.toasts.appendChild(node);
  while (ui.toasts.children.length > 4) ui.toasts.firstChild.remove();
  setTimeout(() => {
    node.style.opacity = "0";
    node.style.transform = "translateY(4px)";
    node.style.transition = "opacity .2s, transform .2s";
    setTimeout(() => node.remove(), 220);
  }, timeout);
  return node;
}
function showBanner(message) {
  const text = String(message || "").trim();
  if (!text) return;
  ui.errorBanner.replaceChildren();
  const icon = el("span", null, "\u26A0");
  const body = el("span", null, text);
  body.style.flex = "1";
  const close = el("button", null, "\xD7");
  close.type = "button";
  close.title = "\u5173\u95ED\u63D0\u793A";
  close.addEventListener("click", () => {
    state.dismissedError = text;
    ui.errorBanner.classList.add("hidden");
  });
  ui.errorBanner.append(icon, body, close);
  ui.errorBanner.classList.remove("hidden");
}
function hideBanner() {
  ui.errorBanner.classList.add("hidden");
}
export {
  callBridge,
  desktopBridge,
  hideBanner,
  isDesktop,
  showBanner,
  toast
};
