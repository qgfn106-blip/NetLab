import { el, div, button } from "./ui.js";
import { ui } from "./state.js";
let modalResolver = null;
function closeModal() {
  ui.modal.classList.add("hidden");
  ui.modalCard.replaceChildren();
  const resolver = modalResolver;
  modalResolver = null;
  if (resolver) resolver(false);
}
function openConfirmModal(title, message, confirmLabel = "\u786E\u5B9A", danger = false) {
  return new Promise((resolve) => {
    if (modalResolver) modalResolver(false);
    modalResolver = resolve;
    ui.modalCard.replaceChildren();
    const heading = el("h3", null, title);
    const body = message instanceof Node ? message : el("p", null, message);
    const actions = div("modal-actions");
    const cancel = button("\u53D6\u6D88", "btn", () => {
      ui.modal.classList.add("hidden");
      const inner = modalResolver;
      modalResolver = null;
      if (inner) inner(false);
    });
    const okay = button(confirmLabel, danger ? "btn danger" : "btn primary", () => {
      ui.modal.classList.add("hidden");
      const inner = modalResolver;
      modalResolver = null;
      if (inner) inner(true);
    });
    actions.append(cancel, okay);
    ui.modalCard.append(heading, body, actions);
    ui.modal.classList.remove("hidden");
    setTimeout(() => okay.focus(), 30);
    ui.modal.onclick = (event) => {
      if (event.target === ui.modal) cancel.click();
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        document.removeEventListener("keydown", onKey, true);
        cancel.click();
      }
    };
    document.addEventListener("keydown", onKey, true);
  });
}
let modeResolver = null;
function openModeModal() {
  return new Promise((resolve) => {
    if (modeResolver) modeResolver(null);
    modeResolver = resolve;
    ui.modalCard.replaceChildren();
    const finish = (value) => {
      ui.modal.classList.add("hidden");
      ui.modalCard.replaceChildren();
      const inner = modeResolver;
      modeResolver = null;
      if (inner) inner(value);
    };
    const heading = el("h3", null, "\u65B0\u5EFA\u5DE5\u7A0B\uFF1A\u9009\u62E9\u573A\u666F\u6A21\u5F0F");
    const body = el("p", null, "\u6A21\u5F0F\u51B3\u5B9A\u53EF\u7528\u5143\u4EF6\u4E0E\u6C42\u89E3\u5668\uFF1B\u521B\u5EFA\u540E\u4ECD\u53EF\u901A\u8FC7\u6253\u5F00\u5DE5\u7A0B\u5207\u6362\u3002");
    const list = div("modal-actions");
    const make = (mode, label, hint) => {
      const item = button(`${label} \xB7 ${hint}`, "btn", () => finish(mode));
      item.style.flex = "1";
      return item;
    };
    const cancel = button("\u53D6\u6D88", "btn", () => finish(null));
    list.append(
      make("signal", "\u4FE1\u53F7\u6D41", "\u589E\u76CA/\u6C42\u548C/\u6EE4\u6CE2"),
      make("circuit", "\u7535\u8DEF", "\u5668\u4EF6\u8282\u70B9\u4E0E MNA"),
      make("vector", "\u77E2\u91CF\u573A", "\u6709\u9650\u5143/\u573A\u6C42\u89E3")
    );
    const actions = div("modal-actions");
    actions.append(cancel);
    ui.modalCard.append(heading, body, list, actions);
    ui.modal.classList.remove("hidden");
    ui.modal.onclick = (event) => {
      if (event.target === ui.modal) finish(null);
    };
  });
}
export {
  closeModal,
  modalResolver,
  modeResolver,
  openConfirmModal,
  openModeModal
};
