import { el, div, button } from "./ui.js";
import { ui } from "./state.js";
import { closeModal } from "./dialogs_build.js";
function selectField(label, values, current) {
  const select = el("select", "export-select");
  for (const [value, text] of values) {
    const option = el("option", null, text);
    option.value = value;
    select.appendChild(option);
  }
  select.value = current;
  const row = div("export-row");
  row.append(el("span", "export-row-label", label), select);
  return { select, row };
}
function styleText(style, projectStyle) {
  if (style === "follow-project") return `\u8DDF\u968F\u5DE5\u7A0B\uFF08\u5F53\u524D ${projectStyle === "classic" ? "\u7ECF\u5178" : "GB"}\uFF09`;
  return style === "classic" ? "\u7ECF\u5178" : "GB";
}
function modeText(mode) {
  return mode === "schematic" ? "\u539F\u7406\u56FE" : "\u573A\u666F\u6570\u636E";
}
function destinationText(destination) {
  return destination === "desktop-save-dialog" ? "\u684C\u9762\u4FDD\u5B58\u5BF9\u8BDD\u6846" : "\u6D4F\u89C8\u5668\u4E0B\u8F7D";
}
function openExportDialog(options) {
  return new Promise((resolve) => {
    closeModal();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKey, true);
      ui.modal.classList.add("hidden");
      ui.modalCard.replaceChildren();
      resolve();
    };
    const cancel = () => finish();
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    };
    const heading = el("h3", null, "\u5BFC\u51FA");
    const help = el("p", "help", "\u6E32\u67D3\u5668\u3001\u6837\u5F0F\u3001\u6E32\u67D3\u6A21\u5F0F\u4E0E\u76EE\u6807\u5F7C\u6B64\u72EC\u7ACB\uFF1B\u539F\u7406\u56FE\u53EA\u8F93\u51FA SVG\uFF0C\u573A\u666F\u6570\u636E\u53EA\u8F93\u51FA JSON\u3002");
    const form = div("export-form");
    const renderer = selectField("\u6E32\u67D3\u5668", [["schemdraw", "SchemDraw"]], "schemdraw");
    renderer.select.dataset.role = "renderer";
    renderer.select.disabled = true;
    const style = selectField("\u6837\u5F0F", [
      ["follow-project", "\u8DDF\u968F\u5DE5\u7A0B"],
      ["gb", "GB"],
      ["classic", "\u7ECF\u5178"]
    ], "follow-project");
    style.select.dataset.role = "style";
    const initialMode = options.initialMode === "scene-data" ? "scene-data" : "schematic";
    const mode = selectField("\u6E32\u67D3\u6A21\u5F0F", [
      ["schematic", "\u539F\u7406\u56FE"],
      ["scene-data", "\u573A\u666F\u6570\u636E"]
    ], initialMode);
    mode.select.dataset.role = "mode";
    const initialFormats = initialMode === "schematic" ? [["svg", "SVG"]] : [["json", "JSON"]];
    const format = selectField("\u683C\u5F0F", initialFormats, initialFormats[0][0]);
    format.select.dataset.role = "format";
    const destination = selectField("\u76EE\u6807", options.desktopAvailable ? [["desktop-save-dialog", "\u684C\u9762\u4FDD\u5B58\u5BF9\u8BDD\u6846"], ["browser-download", "\u6D4F\u89C8\u5668\u4E0B\u8F7D"]] : [["browser-download", "\u6D4F\u89C8\u5668\u4E0B\u8F7D"]], options.desktopAvailable ? "desktop-save-dialog" : "browser-download");
    destination.select.dataset.role = "destination";
    destination.select.disabled = !options.desktopAvailable;
    const syncFormat = () => {
      const wanted = mode.select.value === "schematic" ? [["svg", "SVG"]] : [["json", "JSON"]];
      format.select.replaceChildren();
      for (const [value, text] of wanted) {
        const option = el("option", null, text);
        option.value = value;
        format.select.appendChild(option);
      }
      format.select.value = wanted[0][0];
    };
    mode.select.addEventListener("change", () => {
      syncFormat();
      refresh();
    });
    style.select.addEventListener("change", () => refresh());
    destination.select.addEventListener("change", () => refresh());
    const preview = div("export-preview");
    const errorBox = div("export-error hidden");
    const refresh = () => {
      const styleValue = style.select.value;
      const modeValue = mode.select.value;
      const formatValue = format.select.value;
      const destinationValue = destination.select.value;
      preview.textContent = `SchemDraw \xB7 ${styleText(styleValue, options.projectStyle)} \xB7 ${modeText(modeValue)} \xB7 ${formatValue.toUpperCase()} \xB7 ${destinationText(destinationValue)}`;
    };
    refresh();
    form.append(renderer.row, style.row, mode.row, format.row, destination.row);
    const actions = div("modal-actions");
    const cancelBtn = button("\u53D6\u6D88", "btn", cancel);
    const exportBtn = button("\u5BFC\u51FA", "btn primary", () => {
      void submit();
    });
    actions.append(cancelBtn, exportBtn);
    async function submit() {
      const choice = {
        renderer: "schemdraw",
        style: style.select.value,
        mode: mode.select.value,
        format: format.select.value,
        destination: destination.select.value
      };
      errorBox.classList.add("hidden");
      exportBtn.disabled = true;
      exportBtn.textContent = "\u5BFC\u51FA\u4E2D\u2026";
      try {
        await options.run(choice);
        finish();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errorBox.textContent = `\u5BFC\u51FA\u5931\u8D25\uFF1A${message}`;
        errorBox.classList.remove("hidden");
      } finally {
        exportBtn.disabled = false;
        exportBtn.textContent = "\u5BFC\u51FA";
      }
    }
    ui.modalCard.append(heading, help, form, preview, errorBox, actions);
    ui.modal.classList.remove("hidden");
    setTimeout(() => exportBtn.focus(), 30);
    ui.modal.onclick = (event) => {
      if (event.target === ui.modal) cancel();
    };
    document.addEventListener("keydown", onKey, true);
  });
}
export {
  openExportDialog
};
