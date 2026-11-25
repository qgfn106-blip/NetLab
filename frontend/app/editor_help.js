import { $, $$ } from "./dom.js";
import { state, ui } from "./state.js";
import { button } from "./ui.js";
import { hideHelpCard, showHelpCard, paramRangeText } from "./help_card.js";
import { renderSpecPane } from "./spec_panel.js";
import { closeAnalysis } from "./ac_analysis.js";
import { openDoc, closeDoc } from "./docs.js";
import { closeSettings } from "./settings_guide.js";
import { floatingMenu } from "./editor_shell.js";
import { networkControl } from "./editor_loop.js";
import { closeFloatingMenu } from "./editor_shell.js";
function attachParamHelp(cell, param, spec, role) {
  if (!cell) return;
  const ask = button("?", "qbtn", (event) => {
    event.preventDefault();
    event.stopPropagation();
    showHelpCard(ask, {
      title: `${param.label || param.key}\uFF08${param.key}\uFF09`,
      description: param.help,
      range: paramRangeText(param),
      unit: param.unit,
      def: param.default,
      formula: spec?.formula || "",
      source: spec?.source_path || "",
      role
    });
  });
  ask.title = "\u56DB\u6BB5\u5F0F\u53C2\u6570\u8BF4\u660E\uFF08\u8BF4\u660E / \u53D6\u503C / \u5355\u4F4D\u4E0E\u9ED8\u8BA4 / \u516C\u5F0F\uFF09";
  ask.setAttribute("aria-label", `\u67E5\u770B ${param.key} \u7684\u8BF4\u660E`);
  cell.appendChild(ask);
}
async function ensureStoppedOnBoot() {
  try {
    if (state.sim?.running) await networkControl("pause");
  } catch (error) {
  }
}
function initShellKeys() {
  document.addEventListener("keydown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const typing = target?.closest('input, textarea, select, [contenteditable="true"]');
    if (event.key === "Escape") {
      if (floatingMenu) {
        closeFloatingMenu();
        event.preventDefault();
        return;
      }
      if (ui.qcard && !ui.qcard.hidden) {
        hideHelpCard();
        event.preventDefault();
        return;
      }
      if (ui.moduleWin && !ui.moduleWin.hidden) {
        ui.moduleWin.hidden = true;
        event.preventDefault();
        return;
      }
      if (ui.settingsWin && !ui.settingsWin.hidden) {
        closeSettings();
        event.preventDefault();
        return;
      }
      if (ui.analWin && !ui.analWin.hidden) {
        closeAnalysis();
        event.preventDefault();
        return;
      }
      if (ui.docWin && !ui.docWin.hidden) {
        closeDoc();
        event.preventDefault();
      }
      return;
    }
    if (typing) return;
    const key = event.key.toLowerCase();
    if (event.ctrlKey && key === "k") {
      event.preventDefault();
      openDoc(state.docSlug || "quickstart");
      setTimeout(() => ui.docSearch?.focus(), 60);
      return;
    }
    if (key === "h") {
      event.preventDefault();
      openDoc("quickstart");
    }
    if (event.key === "?") {
      event.preventDefault();
      openDoc("shortcuts");
    }
  });
  document.addEventListener("click", (event) => {
    if (ui.qcard && !ui.qcard.hidden && !event.target.closest("#qcard, .qbtn")) hideHelpCard();
  });
}
function openDocSearch() {
  openDoc(state.docSlug || "quickstart");
  setTimeout(() => {
    if (ui.docSearch) {
      ui.docSearch.focus();
      ui.docSearch.select();
    }
  }, 90);
}
function syncFnRoleToSelection() {
  const type = state.selection?.type;
  if (type !== "node" && type !== "edge") return;
  const role = type === "edge" ? "edge" : "node";
  if (state.fnRole === role) return;
  state.fnRole = role;
  state.specKind = "";
  $$("#panel .group-subnav [data-fnrole]").forEach((node) => {
    node.classList.toggle("active", node.dataset.fnrole === role);
  });
  if ($(".panel-group.active")?.dataset.group === "fn") renderSpecPane();
}
export {
  attachParamHelp,
  ensureStoppedOnBoot,
  initShellKeys,
  openDocSearch,
  syncFnRoleToSelection
};
