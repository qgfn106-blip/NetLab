import { button, div, el } from "./ui.js";
import { state, ui } from "./state.js";
const emptyActions = {};
function setEmptyInspectorActions(actions) {
  Object.assign(emptyActions, actions);
}
function sectionLabel(text, note) {
  const label = div("section-label");
  label.appendChild(el("span", null, text));
  if (note) label.appendChild(el("em", null, note));
  return label;
}
function section(title, note, ...children) {
  const wrapper = div("section");
  wrapper.appendChild(sectionLabel(title, note));
  for (const child of children) wrapper.appendChild(child);
  return wrapper;
}
function buildHeader(titleText, subtitle, specLabel) {
  const head = div("insp-head");
  const title = div("insp-title");
  const heading = el("h2", null, titleText);
  const sub = el("p", null, subtitle);
  title.append(heading, sub);
  const badges = div("insp-badges");
  const badge = el("span", "badge", specLabel);
  badges.appendChild(badge);
  const dirty = el("span", "badge gray hidden", "\u672A\u5E94\u7528");
  dirty.dataset.role = "dirty-badge";
  badges.appendChild(dirty);
  head.append(title, badges);
  return { head, heading, badge };
}
function renderEmptyInspector() {
  const host = div("empty-state");
  host.appendChild(el("b", null, "\u672A\u9009\u62E9\u5BF9\u8C61"));
  host.appendChild(div("help", "\u5728\u753B\u5E03\u4E0A\u5355\u51FB\u8282\u70B9\u6216\u8FDE\u63A5\u4EE5\u68C0\u67E5\u53C2\u6570\uFF1B\u53CC\u51FB\u53EF\u76F4\u63A5\u7F16\u8F91\u3002\u4E5F\u53EF\u4EE5\u4ECE\u4E0B\u9762\u7684\u5165\u53E3\u5F00\u59CB\uFF1A"));
  const actions = div("insp-actions");
  actions.appendChild(button("\u6DFB\u52A0\u8282\u70B9", "btn primary", () => {
    const place = emptyActions.centerPlacement();
    emptyActions.openAddMenu(state.canvasSize.w / 2, state.canvasSize.h / 2, place.x, place.y);
  }));
  actions.appendChild(button("\u9002\u914D\u89C6\u56FE", "btn", () => emptyActions.fitView(true)));
  host.appendChild(actions);
  const hint = div("help");
  hint.style.marginTop = "12px";
  if (state.mode === "vector") {
    hint.textContent = "\u77E2\u91CF\uFF1A\u975E\u7EBF\u6027\u52A8\u6001\u6E90\u4EA7\u751F x/y/vx/vy\uFF0C\u8FDE\u63A5\u53EF\u4F20\u9012\u6216\u6269\u6563\u4E8C\u7EF4\u77E2\u91CF\uFF1B\u753B\u5E03\u7BAD\u5934\u8868\u793A\u72B6\u6001\u65B9\u5411\uFF0C\u76F8\u56FE\u663E\u793A\u8F68\u8FF9\u3002";
  } else if (state.mode === "circuit") {
    hint.textContent = "\u7535\u8DEF\uFF1A\u8282\u70B9\u662F\u7B49\u7535\u4F4D\u70B9\uFF0C\u8FDE\u63A5\u662F R/L/C/\u7535\u6E90/\u4E8C\u6781\u7BA1/\u5F00\u5173/\u53D7\u63A7\u6E90\uFF0C\u4F7F\u7528\u8282\u70B9\u7535\u538B\u6CD5\uFF08MNA\uFF09\u9010\u6B65\u6C42\u89E3\u3002";
  } else {
    hint.textContent = "\u4FE1\u53F7\u6D41\uFF1A\u8282\u70B9\u5BF9\u5165\u8FB9\u6570\u636E\u6C42\u548C/\u53D8\u6362\uFF0C\u8FDE\u63A5\u8D1F\u8D23\u5B57\u6BB5\u4F20\u9012\u3001\u5EF6\u8FDF\u3001\u4F20\u9012\u51FD\u6570\u4E0E\u79EF\u5206\u3002\u4EE3\u6570\u73AF\u4F1A\u81EA\u52A8\u63D2\u5165\u5EF6\u8FDF\u3002";
  }
  host.appendChild(hint);
  ui.inspector.replaceChildren(host);
  state.inspectorId = null;
}
export {
  buildHeader,
  renderEmptyInspector,
  section,
  sectionLabel,
  setEmptyInspectorActions
};
