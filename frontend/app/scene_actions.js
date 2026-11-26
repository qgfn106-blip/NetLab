import { state, ui } from "./state.js";
import { section } from "./inspector_shell.js";
import { div, button, el } from "./ui.js";
import { numberInput, fieldFor } from "./ui_helpers.js";
import { trimNumber } from "./fields.js";
import { modeLabel } from "./model.js";
import { fmt } from "../app.utils.js";
import { markProjectDirty, updateProjectPanel, saveProject, openProject, recoverAutosave, AUTOSAVE_ENABLED_KEY, setProjectFileInput, importProjectText } from "./project.js";
import { toast, desktopBridge, callBridge } from "./desktop.js";
import { requestDraw } from "./canvas_render.js";
import { normaliseAngleSet } from "./grid_prefs.js";
import { C } from "./colors.js";
import { $$ } from "./dom.js";
import { jsonRequest, api } from "./net.js";
import { openConfirmModal as confirmModal } from "./dialogs_build.js";
import { openExportDialog } from "./export_dialog.js";
import { MAX_IMPORT_BYTES } from "./constants.js";
import { updateScenePanelValues, applySimConfig } from "./scene_panel.js";
let deps;
function initSceneActions(d) {
  deps = d;
}
function renderScenePanel() {
  const pane = ui.scenePane;
  if (!pane) return;
  pane.replaceChildren();
  pane.dataset.ready = "1";
  const modes = state.catalog?.modes || [
    { value: "signal", label: "\u4FE1\u53F7\u6D41" },
    { value: "circuit", label: "\u7535\u8DEF" }
  ];
  const modeSection = section("\u5DE5\u4F5C\u6A21\u5F0F", "\u5207\u6362\u4F1A\u91CD\u5EFA\u7A7A\u767D\u573A\u666F");
  const segmented = div("segmented");
  segmented.dataset.role = "mode";
  for (const item of modes) {
    const btn = button(item.label, "", () => void switchMode(item.value));
    btn.dataset.mode = item.value;
    btn.classList.toggle("active", item.value === state.mode);
    btn.title = item.description || "";
    segmented.appendChild(btn);
  }
  modeSection.appendChild(segmented);
  modeSection.appendChild(div("help", "\u4FE1\u53F7\u6D41\u6309\u62D3\u6251\u987A\u5E8F\u4F20\u64AD\u5B57\u5178\u6570\u636E\uFF1B\u7535\u8DEF\u7528\u8282\u70B9\u7535\u538B\u6CD5\u6C42\u89E3\uFF1B\u77E2\u91CF\u6A21\u5F0F\u63D0\u4F9B\u975E\u7EBF\u6027\u52A8\u6001\u6E90\u3001\u4E8C\u7EF4\u77E2\u91CF\u8FDE\u63A5\u4E0E\u76F8\u56FE\u3002"));
  pane.appendChild(modeSection);
  const simSection = section("\u4EFF\u771F\u8282\u594F", "\u4FEE\u6539\u540E\u81EA\u52A8\u5E94\u7528");
  const simGrid = div("inline-fields");
  const fpsInput = numberInput(30, { min: 1, max: 240, step: 1 });
  fpsInput.dataset.sim = "fps";
  const stepsInput = numberInput(1, { min: 1, max: 200, step: 1 });
  stepsInput.dataset.sim = "steps";
  const dtInput = numberInput(0.01, { min: 1e-9, max: 10, step: "any" });
  dtInput.dataset.sim = "dt";
  const sampleInput = numberInput(1, { min: 1, max: 100, step: 1 });
  sampleInput.dataset.sim = "sample";
  simGrid.append(
    fieldFor("\u5E27\u7387", "fps", fpsInput),
    fieldFor("\u6BCF\u5E27\u6B65\u6570", "steps", stepsInput),
    (() => {
      const field = fieldFor("\u65F6\u95F4\u6B65\u957F", "s", dtInput);
      const tools = div("inline-fields");
      const stepDown = button("\xF710", "btn tiny", () => {
        dtInput.value = trimNumber(Math.max(1e-9, Number(dtInput.value) / 10));
        dtInput.dispatchEvent(new Event("change", { bubbles: true }));
      });
      const stepUp = button("\xD710", "btn tiny", () => {
        dtInput.value = trimNumber(Math.min(10, Number(dtInput.value) * 10));
        dtInput.dispatchEvent(new Event("change", { bubbles: true }));
      });
      stepDown.title = "\u65F6\u95F4\u6B65\u957F \xF710\uFF08\u66F4\u7EC6\uFF09";
      stepUp.title = "\u65F6\u95F4\u6B65\u957F \xD710\uFF08\u66F4\u7C97\uFF09";
      tools.append(stepDown, stepUp);
      field.appendChild(tools);
      return field;
    })(),
    fieldFor("\u91C7\u6837\u95F4\u9694", "\u5E27", sampleInput)
  );
  simSection.appendChild(simGrid);
  const lockRow = div("switch-row");
  lockRow.appendChild(el("span", null, "\u9501\u5B9A dt = 1 / (fps \xD7 \u6B65\u6570)"));
  const lockInput = el("input");
  lockInput.type = "checkbox";
  lockInput.dataset.sim = "lock";
  lockRow.appendChild(lockInput);
  simSection.appendChild(lockRow);
  const realtimeRow = div("switch-row");
  realtimeRow.appendChild(el("span", null, "\u5B9E\u65F6\u8282\u62CD\uFF08\u5173\u95ED\u5219\u6781\u901F\u8FED\u4EE3\uFF09"));
  const realtimeInput = el("input");
  realtimeInput.type = "checkbox";
  realtimeInput.dataset.sim = "realtime";
  realtimeRow.appendChild(realtimeInput);
  simSection.appendChild(realtimeRow);
  const precisionRow = div("inline-fields");
  precisionRow.appendChild(el("span", null, "\u65F6\u95F4\u6B65\u957F\u9884\u8BBE"));
  for (const [label, value] of [["\u5FEB\u901F 1e-4", 1e-4], ["\u6807\u51C6 1e-5", 1e-5], ["\u9AD8\u7CBE\u5EA6 1e-6", 1e-6], ["\u8D85\u9AD8 1e-7", 1e-7]]) {
    const preset = button(label, "btn tiny", () => {
      dtInput.value = String(value);
      if (lockInput.checked) {
        lockInput.checked = false;
        dtInput.disabled = false;
      }
      void applySimConfig();
    });
    preset.dataset.dtPreset = String(value);
    preset.title = `\u65F6\u95F4\u6B65\u957F\u8BBE\u4E3A ${value} s`;
    precisionRow.appendChild(preset);
  }
  simSection.appendChild(precisionRow);
  simSection.appendChild(div("help", "\u65F6\u95F4\u6B65\u957F\u8D8A\u5C0F\u6C42\u89E3\u8D8A\u7EC6\uFF0C\u4F46\u6BCF\u5E27\u8BA1\u7B97\u91CF\u8D8A\u5927\uFF1B\u66F2\u7EBF\u5206\u8FA8\u7387\u8FD8\u53D7\u300C\u91C7\u6837\u95F4\u9694\u300D\u5F71\u54CD\u3002"));
  const simNote = div("help");
  simNote.dataset.role = "sim-note";
  simSection.appendChild(simNote);
  pane.appendChild(simSection);
  const solverSection = section("\u6C42\u89E3\u5668\u8BBE\u7F6E", "\u7535\u8DEF\u6A21\u5F0F\uFF1ANewton \u6536\u655B\u4E0E\u5931\u8D25\u6551\u6025");
  const solverGrid = div("inline-fields");
  const solverInput = (label, unit, name, value, min, max, step) => {
    const input = numberInput(value, { min, max, step });
    input.dataset.solver = name;
    return fieldFor(label, unit, input);
  };
  solverGrid.append(
    solverInput("\u76F8\u5BF9\u5BB9\u5DEE reltol", "", "reltol", 1e-9, 1e-15, 0.1, "any"),
    solverInput("\u7535\u538B\u5BB9\u5DEE vntol", "V", "vntol", 1e-6, 1e-15, 1, "any"),
    solverInput("\u7535\u6D41\u5BB9\u5DEE abstol", "A", "abstol", 1e-6, 1e-15, 1, "any"),
    solverInput("Newton \u4E0A\u9650", "\u6B21", "max_iter", 60, 1, 500, 1),
    solverInput("gmin \u6B65\u6570", "\u6B65", "gmin_steps", 10, 0, 100, 1),
    solverInput("source \u6B65\u6570", "\u6B65", "src_steps", 10, 0, 100, 1),
    solverInput("\u6B8B\u5DEE\u5BB9\u5DEE", "", "residual_tol", 0, 0, 1, "any")
  );
  solverSection.appendChild(solverGrid);
  solverSection.appendChild(div("help", "\u6B8B\u5DEE\u5BB9\u5DEE 0 = \u53EA\u8BB0\u5F55\u4E0D\u5F3A\u5236\uFF1B\u5931\u8D25\u65F6\u81EA\u52A8 gmin/source stepping\uFF0C\u4ECD\u5931\u8D25\u4F1A\u62A5\u6700\u5927\u8282\u70B9\u3002\u4FEE\u6539\u540E\u7ACB\u5373\u751F\u6548\uFF08\u91CD\u5EFA\u7535\u8DEF\u5F15\u64CE\uFF09\u3002"));
  pane.appendChild(solverSection);
  if (state.mode !== "circuit") {
    const algebraicSection = section("\u4FE1\u53F7\u6D41\u4EE3\u6570\u73AF", "\u663E\u5F0F\u9009\u62E9\uFF1B\u4E0D\u518D\u9759\u9ED8\u6539\u5199\u62D3\u6251");
    const algebraicRow = div("set-row");
    const algebraicLabel = el("label", null, "\u76F4\u63A5\u9988\u901A\u6C42\u89E3");
    algebraicLabel.appendChild(el("em", null, "\u5F00\u542F\u540E\u73AF\u8DEF\u7531 solver_plan/SCC \u6C42\u7EBF\u6027\u89E3\uFF1B\u5173\u95ED\u65F6\u542B\u73AF\u8FDE\u63A5\u62A5\u9519\uFF0C\u9664\u975E\u663E\u5F0F\u8BBE\u7F6E\u5355\u6B65\u5EF6\u8FDF"));
    const algebraicControl = div("set-control");
    const algebraicInput = el("input");
    algebraicInput.type = "checkbox";
    algebraicInput.dataset.role = "algebraic";
    algebraicInput.checked = Boolean(state.scene?.solve_algebraic);
    algebraicInput.addEventListener("change", () => void changeAlgebraicSolver(algebraicInput.checked));
    algebraicControl.appendChild(algebraicInput);
    algebraicRow.append(algebraicLabel, algebraicControl);
    algebraicSection.appendChild(algebraicRow);
    pane.appendChild(algebraicSection);
  }
  const statsSection = section("\u7F51\u7EDC\u7EDF\u8BA1", "\u8FD0\u884C\u65F6\u66F4\u65B0");
  const statsGrid = div("stat-grid");
  const statSpecs = [
    ["\u8282\u70B9", "nodes"],
    ["\u8FDE\u63A5", "edges"],
    ["\u6B65\u8017\u65F6", "step"],
    ["\u5B9E\u9645\u5E27\u7387", "fps"],
    ["\u77E9\u9635", "matrix"],
    ["Newton", "iterations"],
    ["\u5F55\u5236\u5E27", "frames"],
    ["\u4FEE\u8BA2", "revision"]
  ];
  for (const [labelText, key] of statSpecs) {
    const stat = div("stat");
    stat.appendChild(el("span", null, labelText));
    const value = el("b", null, "\u2014");
    value.dataset.stat = key;
    stat.appendChild(value);
    statsGrid.appendChild(stat);
  }
  statsSection.appendChild(statsGrid);
  pane.appendChild(statsSection);
  const integrationSection = section("\u79EF\u5206\u65B9\u6CD5", "\u4EC5\u7535\u8DEF\u6A21\u5F0F");
  const integration = el("select");
  integration.dataset.role = "integration";
  for (const item of state.catalog?.integration || []) {
    const option = el("option", null, item.label || item.value);
    option.value = item.value;
    integration.appendChild(option);
  }
  integration.addEventListener("change", () => void changeIntegration(integration.value));
  integrationSection.appendChild(integration);
  const integrationNote = div("help");
  integrationNote.dataset.role = "integration-note";
  integrationSection.appendChild(integrationNote);
  pane.appendChild(integrationSection);
  const templateSection = section("\u573A\u666F\u6A21\u677F", "\u4E00\u952E\u66FF\u6362");
  const templateList = div("template-list");
  templateList.dataset.role = "templates";
  for (const template of state.templates) {
    const item = el("button", "template");
    item.type = "button";
    const title = el("strong");
    title.append(el("span", null, template.label));
    title.append(document.createTextNode("  "));
    const modeBadge = el("span", "tpl-mode", modeLabel(template.mode));
    title.appendChild(modeBadge);
    item.appendChild(title);
    item.appendChild(el("small", null, template.description));
    if (template.sim && Object.keys(template.sim).length) {
      const bits = [];
      if (template.sim.fps) bits.push(`${template.sim.fps} fps`);
      if (template.sim.dt) bits.push(`dt ${fmt(template.sim.dt, 3)}`);
      if (template.sim.steps_per_frame) bits.push(`${template.sim.steps_per_frame} \u6B65/\u5E27`);
      item.appendChild(el("small", null, bits.join(" \xB7 ")));
    }
    item.addEventListener("click", () => void loadTemplate(template.name, template.label));
    templateList.appendChild(item);
  }
  if (!state.templates.length) templateList.appendChild(div("help", "\u6A21\u677F\u76EE\u5F55\u4E0D\u53EF\u7528\u3002"));
  templateSection.appendChild(templateList);
  pane.appendChild(templateSection);
  const projectSection = section("\u5DE5\u7A0B\u6587\u4EF6", "\u7248\u672C\u5316 .netlab \xB7 \u539F\u5B50\u5199\u5165");
  const projectName = el("input");
  projectName.type = "text";
  projectName.maxLength = 120;
  projectName.dataset.role = "project-name";
  projectName.value = state.project.name || "";
  projectName.addEventListener("change", () => {
    const value = projectName.value.trim() || "\u672A\u547D\u540D\u5DE5\u7A0B";
    if (value !== state.project.name) {
      state.project.name = value.slice(0, 120);
      markProjectDirty();
    }
    updateProjectPanel();
  });
  projectSection.appendChild(fieldFor("\u5DE5\u7A0B\u540D\u79F0", "", projectName));
  const projectPath = div("project-path");
  projectPath.dataset.role = "project-path";
  projectSection.appendChild(projectPath);
  const projectRow = div("file-row");
  projectRow.append(
    button("\u4FDD\u5B58", "btn", () => void saveProject(false)),
    button("\u53E6\u5B58\u4E3A\u2026", "btn", () => void saveProject(true)),
    button("\u6253\u5F00\u2026", "btn", () => void openProject()),
    button("\u6062\u590D\u81EA\u52A8\u4FDD\u5B58", "btn", () => void recoverAutosave())
  );
  projectSection.appendChild(projectRow);
  const autosaveRow = div("switch-row");
  autosaveRow.appendChild(
    el("span", null, `\u6BCF ${Math.round(state.project.autosaveInterval / 1e3)} \u79D2\u5199\u5DE5\u7A0B\u5FEB\u7167\uFF08\u53EA\u5199 backups/\uFF0C\u4E0D\u52A8\u6B63\u672C\uFF09`)
  );
  const autosaveToggle = el("input");
  autosaveToggle.type = "checkbox";
  autosaveToggle.dataset.role = "project-autosave";
  autosaveToggle.checked = Boolean(state.project.autosave);
  autosaveToggle.addEventListener("change", () => {
    state.project.autosave = Boolean(autosaveToggle.checked);
    try {
      localStorage.setItem(AUTOSAVE_ENABLED_KEY, state.project.autosave ? "1" : "0");
    } catch (error) {
    }
    toast(state.project.autosave ? "\u5DF2\u5F00\u542F\u81EA\u52A8\u4FDD\u5B58" : "\u5DF2\u5173\u95ED\u81EA\u52A8\u4FDD\u5B58", "info", 2e3);
  });
  autosaveRow.appendChild(autosaveToggle);
  projectSection.appendChild(autosaveRow);
  const recentBox = div("recent-projects");
  recentBox.dataset.role = "project-recent";
  projectSection.appendChild(recentBox);
  const fileInput = el("input");
  setProjectFileInput(fileInput);
  fileInput.type = "file";
  fileInput.accept = ".netlab,application/json,.json";
  fileInput.className = "hidden-input";
  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toast("\u5DE5\u7A0B\u6587\u4EF6\u8D85\u8FC7 8 MB\uFF0C\u5DF2\u62D2\u7EDD", "error", 6e3);
      return;
    }
    void file.text().then((text) => importProjectText(text, ""));
  });
  projectSection.appendChild(fileInput);
  projectSection.appendChild(div("help", "\u5DE5\u7A0B\u53EA\u4FDD\u5B58\u62D3\u6251\u3001\u53C2\u6570\u3001\u6A21\u5757\u5B9A\u4E49\u4E0E\u754C\u9762\u504F\u597D\uFF0C\u4E0D\u4FDD\u5B58\u8FD0\u884C\u72B6\u6001\u4E0E\u5F55\u5236\u5E27\u3002\u6D4F\u89C8\u5668\u6A21\u5F0F\u901A\u8FC7\u4E0B\u8F7D/\u4E0A\u4F20\u6587\u4EF6\u4FDD\u5B58\u3002"));
  pane.appendChild(projectSection);
  const gridSection = section("\u753B\u5E03\u4E0E\u6807\u51C6\u7F51\u683C", "\u5438\u9644 \xB7 \u6B63\u4EA4\u5E03\u7EBF \xB7 \u6574\u7406");
  const gridRow = div("field-row");
  const snapBox = el("input");
  snapBox.type = "checkbox";
  snapBox.checked = Boolean(state.ui.snap);
  snapBox.addEventListener("change", () => {
    state.ui.snap = Boolean(snapBox.checked);
    markProjectDirty();
    toast(state.ui.snap ? "\u7F51\u683C\u5438\u9644\u5DF2\u5F00\u542F" : "\u7F51\u683C\u5438\u9644\u5DF2\u5173\u95ED", "info", 1800);
  });
  const spacing = document.createElement("input");
  spacing.className = "input";
  spacing.type = "number";
  spacing.min = "5";
  spacing.max = "80";
  spacing.step = "1";
  spacing.value = String(Number(state.ui.grid) || 20);
  spacing.dataset.role = "grid-spacing";
  const setSpacing = (next) => {
    const value = Math.max(5, Math.min(80, Math.round(next)));
    state.ui.grid = value;
    spacing.value = String(value);
    markProjectDirty();
    requestDraw();
  };
  spacing.addEventListener("change", () => setSpacing(Number(spacing.value) || 20));
  const spacingMinus = button("\u2212", "btn tiny", () => setSpacing((Number(state.ui.grid) || 20) - 1));
  spacingMinus.dataset.role = "grid-spacing-minus";
  const spacingPlus = button("\uFF0B", "btn tiny", () => setSpacing((Number(state.ui.grid) || 20) + 1));
  spacingPlus.dataset.role = "grid-spacing-plus";
  const spacingField = div("field");
  spacingField.appendChild(el("label", null, "\u95F4\u8DDD\uFF08\u5355\u4F4D\uFF09"));
  spacingField.appendChild(spacing);
  const spacingWrap = div("inline-fields");
  spacingWrap.dataset.role = "grid-spacing-control";
  spacingWrap.append(spacingMinus, spacingField, spacingPlus);
  gridRow.append(el("label", null, "\u5438\u9644"), snapBox, spacingWrap);
  gridSection.appendChild(gridRow);
  const subRow = div("field-row");
  const subInput = document.createElement("input");
  subInput.className = "input";
  subInput.type = "number";
  subInput.min = "1";
  subInput.max = "20";
  subInput.step = "1";
  subInput.value = String(Number(state.ui.gridSubdivisions) || 4);
  subInput.dataset.role = "grid-subdivisions";
  subInput.addEventListener("change", () => {
    state.ui.gridSubdivisions = Math.max(1, Math.min(20, Math.round(Number(subInput.value) || 4)));
    markProjectDirty();
    requestDraw();
  });
  const showBox = document.createElement("input");
  showBox.type = "checkbox";
  showBox.checked = state.ui.showGrid !== false;
  showBox.dataset.role = "grid-show";
  showBox.addEventListener("change", () => {
    state.ui.showGrid = showBox.checked;
    markProjectDirty();
    requestDraw();
  });
  const markersBox = document.createElement("input");
  markersBox.type = "checkbox";
  markersBox.checked = state.ui.snapMarkers !== false;
  markersBox.dataset.role = "grid-markers";
  markersBox.addEventListener("change", () => {
    state.ui.snapMarkers = markersBox.checked;
    markProjectDirty();
    requestDraw();
  });
  subRow.append(el("label", null, "\u7EC6\u5206"), subInput, el("label", null, "\u663E\u793A\u7F51\u683C"), showBox, el("label", null, "\u6355\u6349\u70B9"), markersBox);
  gridSection.appendChild(subRow);
  const angleRow = div("field-row");
  const angleMode = el("select", "input");
  for (const [value, label] of [["constrained", "\u7EA6\u675F\u89D2\u96C6"], ["free", "\u81EA\u7531\u89D2\u5EA6"]]) {
    const option = el("option", null, label);
    option.value = value;
    angleMode.appendChild(option);
  }
  angleMode.value = state.ui.angleMode === "free" ? "free" : "constrained";
  angleMode.dataset.role = "grid-angle-mode";
  angleMode.addEventListener("change", () => {
    state.ui.angleMode = angleMode.value === "free" ? "free" : "constrained";
    markProjectDirty();
  });
  const tolerance = document.createElement("input");
  tolerance.className = "input";
  tolerance.type = "number";
  tolerance.min = "0.5";
  tolerance.max = "15";
  tolerance.step = "0.5";
  tolerance.value = String(Number(state.ui.angleToleranceDeg) || 3);
  tolerance.dataset.role = "grid-angle-tolerance";
  tolerance.addEventListener("change", () => {
    state.ui.angleToleranceDeg = Math.max(0.5, Math.min(15, Number(tolerance.value) || 3));
    markProjectDirty();
  });
  angleRow.append(el("label", null, "\u89D2\u5EA6\u6A21\u5F0F"), angleMode, el("label", null, "\u5438\u9644\u5BB9\u5DEE\xB0"), tolerance);
  gridSection.appendChild(angleRow);
  const angleSetRow = div("field-row");
  angleSetRow.dataset.role = "grid-angle-set";
  angleSetRow.appendChild(el("label", null, "\u5141\u8BB8\u89D2\u5EA6"));
  const currentAngles = normaliseAngleSet(state.ui.angleSet);
  for (const angle of [0, 45, 60, 90]) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = String(angle);
    box.checked = currentAngles.includes(angle);
    box.dataset.angle = String(angle);
    box.addEventListener("change", () => {
      const boxes = [...angleSetRow.querySelectorAll('input[type="checkbox"]')];
      state.ui.angleSet = normaliseAngleSet(boxes.filter((item) => item.checked).map((item) => Number(item.value)));
      markProjectDirty();
    });
    angleSetRow.append(box, el("span", null, `${angle}\xB0`));
  }
  gridSection.appendChild(angleSetRow);
  const viewRow = div("field-row");
  const originBox = document.createElement("input");
  originBox.type = "checkbox";
  originBox.checked = state.ui.showOrigin !== false;
  originBox.dataset.role = "grid-show-origin";
  originBox.addEventListener("change", () => {
    state.ui.showOrigin = originBox.checked;
    markProjectDirty();
    requestDraw();
  });
  const rulerBox = document.createElement("input");
  rulerBox.type = "checkbox";
  rulerBox.checked = Boolean(state.ui.showRuler);
  rulerBox.dataset.role = "grid-show-ruler";
  rulerBox.addEventListener("change", () => {
    state.ui.showRuler = rulerBox.checked;
    markProjectDirty();
    requestDraw();
  });
  const adaptiveBox = document.createElement("input");
  adaptiveBox.type = "checkbox";
  adaptiveBox.checked = state.ui.adaptiveZoom !== false;
  adaptiveBox.dataset.role = "grid-adaptive-zoom";
  adaptiveBox.addEventListener("change", () => {
    state.ui.adaptiveZoom = adaptiveBox.checked;
    markProjectDirty();
    requestDraw();
  });
  viewRow.append(el("label", null, "\u663E\u793A\u539F\u70B9"), originBox, el("label", null, "\u6807\u5C3A"), rulerBox, el("label", null, "\u7F29\u653E\u81EA\u9002\u5E94"), adaptiveBox);
  gridSection.appendChild(viewRow);
  gridSection.appendChild(div("help", "\u7F51\u683C\u9ED8\u8BA4\u503C\u968F\u5DE5\u7A0B\u4FDD\u5B58\uFF1B\u53EA\u5F71\u54CD\u65B0\u5EFA\u5BFC\u7EBF\u548C\u5BFC\u51FA\uFF0C\u4E0D\u4F1A\u6539\u5199\u5DF2\u6709\u624B\u5DE5\u6298\u70B9\u3002"));
  const styleRow = div("field-row");
  const nodeStyleSelect = el("select", "input");
  for (const [value, label] of [["circle", "\u7A7A\u5FC3\u5706"], ["dot", "\u5B9E\u5FC3\u70B9"], ["box", "\u5C0F\u65B9\u6846"]]) {
    const option = el("option", null, label);
    option.value = value;
    nodeStyleSelect.appendChild(option);
  }
  nodeStyleSelect.value = state.ui.nodeStyle || "circle";
  nodeStyleSelect.addEventListener("change", () => {
    state.ui.nodeStyle = nodeStyleSelect.value;
    markProjectDirty();
    requestDraw();
  });
  const scaleSelect = el("select", "input");
  for (const size of [0.8, 1, 1.2, 1.6]) {
    const option = el("option", null, `${size}\xD7`);
    option.value = String(size);
    scaleSelect.appendChild(option);
  }
  scaleSelect.value = String(Number(state.ui.symbolScale) || 1.2);
  scaleSelect.addEventListener("change", () => {
    state.ui.symbolScale = Number(scaleSelect.value) || 1.2;
    markProjectDirty();
    requestDraw();
  });
  const colorSelect = el("select", "input");
  for (const [value, label] of [["#1f5f5b", "\u9752\u7EFF"], [C("#a8541f"), "\u6696\u6A59"], ["#2563a8", "\u975B\u84DD"]]) {
    const option = el("option", null, label);
    option.value = value;
    colorSelect.appendChild(option);
  }
  colorSelect.value = state.ui.glyphColor || "#1f5f5b";
  colorSelect.addEventListener("change", () => {
    state.ui.glyphColor = colorSelect.value;
    markProjectDirty();
    requestDraw();
  });
  styleRow.append(
    el("label", null, "\u8282\u70B9\u6837\u5F0F"),
    nodeStyleSelect,
    el("label", null, "\u7B26\u53F7\u5927\u5C0F"),
    scaleSelect,
    el("label", null, "\u7B26\u53F7\u989C\u8272"),
    colorSelect
  );
  gridSection.appendChild(styleRow);
  gridSection.appendChild(
    button("\u6574\u7406\u5230\u7F51\u683C", "btn", () => void deps.snapSceneToGrid())
  );
  gridSection.appendChild(div("help", "\u5143\u4EF6\u4F4D\u7F6E\u7531\u5143\u4EF6\u81EA\u8EAB layout \u51B3\u5B9A\uFF08\u53EF\u5728\u68C0\u67E5\u5668\u5FAE\u8C03\uFF09\uFF1B\u4E0D\u518D\u81EA\u52A8\u91CD\u6392\uFF0C\u907F\u514D\u6253\u4E71\u624B\u5DE5\u56FE\u3002"));
  gridSection.appendChild(
    div("help", "\u7535\u8DEF\u6A21\u5F0F\u65B0\u5EFA\u8FDE\u7EBF\u9ED8\u8BA4\u6B63\u4EA4\u8DEF\u7531\uFF1B\u62D6\u52A8/\u65B0\u5EFA\u8282\u70B9\u5438\u9644\u5230\u7F51\u683C\uFF1B\u6309\u4F4F Alt \u4E34\u65F6\u6682\u505C\u5438\u9644\u3002\u6574\u7406\u4F1A\u6309\u5F53\u524D\u7F51\u683C\u5BF9\u9F50\u5168\u90E8\u8282\u70B9\u4E0E\u624B\u52A8\u62D0\u70B9\uFF08\u53EF\u64A4\u9500\uFF09\u3002")
  );
  pane.appendChild(gridSection);
  updateProjectPanel();
  const dataSection = section("\u573A\u666F\u6570\u636E", "JSON");
  const fileRow = div("file-row");
  fileRow.appendChild(button("\u5BFC\u51FA JSON", "btn", () => void openExport("scene-data")));
  fileRow.appendChild(button("\u5BFC\u51FA\u539F\u7406\u56FE SVG", "btn", () => void openExport("schematic")));
  fileRow.appendChild(button("\u5BFC\u5165 JSON", "btn", () => importInput.click()));
  dataSection.appendChild(fileRow);
  const importInput = el("input");
  importInput.type = "file";
  importInput.accept = "application/json,.json";
  importInput.className = "hidden-input";
  importInput.addEventListener("change", () => {
    const file = importInput.files && importInput.files[0];
    importInput.value = "";
    if (file) void importSceneFile(file);
  });
  dataSection.appendChild(importInput);
  dataSection.appendChild(div("help", "\u5BFC\u51FA\u4E0D\u542B\u8FD0\u884C\u65F6\u72B6\u6001\uFF1B\u5BFC\u5165\u4E0A\u9650 2 MB\uFF0C\u5BFC\u5165\u524D\u4F1A\u518D\u6B21\u786E\u8BA4\u3002\u670D\u52A1\u7AEF\u4F1A\u6821\u9A8C\u8282\u70B9\u3001\u8FDE\u63A5\u3001\u53C2\u6570\u4E0E\u62D3\u6251\u3002"));
  pane.appendChild(dataSection);
  for (const input of [fpsInput, stepsInput, dtInput, sampleInput, lockInput, realtimeInput]) {
    input.addEventListener("change", () => void applySimConfig());
  }
  for (const input of $$("[data-solver]", pane)) {
    input.addEventListener("change", () => void applySimConfig());
  }
  lockInput.addEventListener("change", () => {
    dtInput.disabled = lockInput.checked;
  });
  deps.updateModeUI();
  updateScenePanelValues();
}
async function switchMode(mode, options = {}) {
  if (mode === state.mode) return;
  if (!options.skipConfirm) {
    const confirmed = await confirmModal(
      `\u5207\u6362\u5230${modeLabel(mode)}\u6A21\u5F0F\uFF1F`,
      "\u5207\u6362\u4F1A\u628A\u5F53\u524D\u573A\u666F\u66FF\u6362\u4E3A\u8BE5\u6A21\u5F0F\u7684\u7A7A\u767D\u6A21\u677F\uFF0C\u8282\u70B9\u3001\u8FDE\u63A5\u3001\u53C2\u6570\u4E0E\u5F55\u5236\u6570\u636E\u90FD\u4F1A\u6E05\u7A7A\u3002\u8BF7\u5148\u5BFC\u51FA\u9700\u8981\u4FDD\u7559\u7684\u573A\u666F\u3002",
      "\u5207\u6362",
      true
    );
    if (!confirmed) return;
  }
  const response = await deps.task(() => jsonRequest("/api/mode", "POST", { mode }));
  if (!response) return;
  state.selection = { type: null, id: null };
  state.inspectorId = null;
  state.frames = [];
  state.values.clear();
  state.nodeValues.clear();
  state.edgeValues.clear();
  deps.applySnapshot(response);
  state.cursor = Number(response.sim?.cursor) || 0;
  deps.renderInspector();
  renderScenePanel();
  deps.renderSignalList();
  await deps.fetchNetworks();
  deps.fitView();
  toast(`\u5DF2\u5207\u6362\u5230${modeLabel(mode)}\u6A21\u5F0F`, "ok", 2200);
}
async function loadTemplate(name, label) {
  const nodeCount = state.scene?.nodes?.length || 0;
  if (nodeCount > 0) {
    const confirmed = await confirmModal(
      `\u8F7D\u5165\u6A21\u677F\u300C${label}\u300D\uFF1F`,
      `\u5F53\u524D\u573A\u666F\u6709 ${nodeCount} \u4E2A\u8282\u70B9\uFF0C\u5C06\u88AB\u6A21\u677F\u5B8C\u5168\u66FF\u6362\u3002\u8BF7\u5148\u5BFC\u51FA\u9700\u8981\u4FDD\u7559\u7684\u573A\u666F\u3002`,
      "\u8F7D\u5165",
      true
    );
    if (!confirmed) return;
  }
  const response = await deps.task(() => jsonRequest(`/api/templates/${encodeURIComponent(name)}`, "POST"));
  if (!response) return;
  state.selection = { type: null, id: null };
  state.inspectorId = null;
  deps.applySnapshot(response);
  state.cursor = Number(response.sim?.cursor) || 0;
  deps.renderInspector();
  renderScenePanel();
  deps.renderSignalList();
  deps.fitView();
  toast(`\u5DF2\u8F7D\u5165\u6A21\u677F\uFF1A${label}`, "ok", 2200);
}
async function migrateSceneToDevices() {
  if (state.mode !== "circuit") {
    toast("\u53EA\u6709\u7535\u8DEF\u573A\u666F\u53EF\u4EE5\u8FC1\u79FB\u4E3A\u5668\u4EF6\u6A21\u578B", "error", 3500);
    return;
  }
  const confirmed = await confirmModal(
    "\u8FC1\u79FB\u4E3A\u5668\u4EF6\u6A21\u578B\uFF08R20\uFF09",
    "\u5C06\u628A\u5F53\u524D\u573A\u666F\u7684\u5143\u4EF6\u8FB9\u8F6C\u6362\u4E3A\u300C\u5668\u4EF6\u8282\u70B9 + \u5F15\u811A\u5BFC\u7EBF\u300D\uFF0C\u7F51\u7EDC\u8282\u70B9\u4FDD\u7559\uFF1B\u4E4B\u540E\u5DE5\u7A0B\u6309 v4 \u4FDD\u5B58\u3002\u8BE5\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002",
    "\u8FC1\u79FB",
    false
  );
  if (!confirmed) return;
  const response = await deps.task(() => jsonRequest("/api/scene/migrate-devices", "POST", {}));
  if (!response) return;
  deps.applySnapshot(response);
  const converted = Number(response.migration?.converted || 0);
  toast(`\u5DF2\u8FC1\u79FB ${converted} \u4E2A\u5143\u4EF6\u4E3A\u5668\u4EF6\u8282\u70B9`, "ok", 3e3);
  deps.fitView(true);
}
async function clearScene() {
  const confirmed = await confirmModal(
    "\u6E05\u7A7A\u5F53\u524D\u573A\u666F\uFF1F",
    "\u5C06\u5220\u9664\u6240\u6709\u8282\u70B9\u4E0E\u8FDE\u63A5\uFF0C\u5E76\u91CD\u5EFA\u4E3A\u7A7A\u767D\u6A21\u677F\u3002\u8BE5\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002",
    "\u6E05\u7A7A",
    true
  );
  if (!confirmed) return;
  const response = await deps.task(() => jsonRequest("/api/scene/clear", "POST"));
  if (!response) return;
  state.selection = { type: null, id: null };
  state.inspectorId = null;
  deps.applySnapshot(response);
  state.cursor = Number(response.sim?.cursor) || 0;
  deps.renderInspector();
  renderScenePanel();
  deps.renderSignalList();
  deps.fitView();
  toast("\u573A\u666F\u5DF2\u6E05\u7A7A", "ok", 2e3);
}
async function exportScene(destination = "browser-download") {
  const payload = await deps.task(() => api("/api/scene/export?include_state=false"), { dirty: false });
  if (!payload) throw new Error("\u540E\u7AEF\u672A\u8FD4\u56DE\u573A\u666F\u6570\u636E");
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `netlab-${state.mode}-${stamp}.json`;
  const text = JSON.stringify(payload, null, 2);
  if (await saveTextViaDesktop(text, fileName, destination)) return;
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = el("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2e3);
  toast("\u573A\u666F\u5DF2\u4EA4\u7ED9\u6D4F\u89C8\u5668\u4E0B\u8F7D", "ok", 2400);
}
async function saveTextViaDesktop(text, defaultName, destination = "auto") {
  if (destination === "browser-download") return false;
  if (!desktopBridge()) {
    if (destination === "desktop-save-dialog") throw new Error("\u5F53\u524D\u73AF\u5883\u6CA1\u6709\u684C\u9762\u4FDD\u5B58\u5BF9\u8BDD\u6846\uFF0C\u8BF7\u6539\u7528\u6D4F\u89C8\u5668\u4E0B\u8F7D");
    return false;
  }
  const result = await callBridge("saveText", [defaultName, text]);
  if (result === null) {
    if (destination === "desktop-save-dialog") throw new Error("\u684C\u9762\u4FDD\u5B58\u6865\u672A\u8FDE\u63A5");
    return false;
  }
  const path = String(result);
  if (!path) return true;
  if (path.startsWith("__error__")) {
    const message = path.slice("__error__".length);
    if (destination === "desktop-save-dialog") throw new Error(message);
    toast(`\u5BFC\u51FA\u5931\u8D25\uFF1A${message}`, "error", 7e3);
    return true;
  }
  toast(`\u5DF2\u5BFC\u51FA\u5230 ${path}`, "ok", 6e3);
  return true;
}
async function exportSchematic(destination = "browser-download", style = "follow-project") {
  if (state.scene?.mode !== "circuit") {
    throw new Error("\u539F\u7406\u56FE\u5BFC\u51FA\u4EC5\u652F\u6301\u7535\u8DEF\u6A21\u5F0F");
  }
  const params = new URLSearchParams({
    name: state.project?.name || "",
    network: state.currentNetwork?.name || ""
  });
  if (style !== "follow-project") params.set("style", style);
  const payload = await deps.task(
    () => jsonRequest(`/api/export/schematic?${params.toString()}`, "GET"),
    { dirty: false }
  );
  if (!payload?.svg) throw new Error("\u540E\u7AEF\u672A\u8FD4\u56DE\u539F\u7406\u56FE SVG");
  const svg = String(payload.svg);
  const fileName = String(payload.filename || "schematic.svg");
  if (await saveTextViaDesktop(svg, fileName, destination)) return;
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const link = el("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2e3);
  toast("\u539F\u7406\u56FE SVG \u5DF2\u4EA4\u7ED9\u6D4F\u89C8\u5668\u4E0B\u8F7D", "ok", 2400);
}
async function performExport(choice) {
  if (choice.mode === "scene-data") {
    await exportScene(choice.destination);
    return;
  }
  await exportSchematic(choice.destination, choice.style);
}
async function openExport(initialMode = "schematic") {
  await openExportDialog({
    projectStyle: String(state.ui?.symbol || "classic") === "gb" ? "gb" : "classic",
    initialMode,
    desktopAvailable: Boolean(desktopBridge()),
    run: performExport
  });
}
async function importSceneFile(file) {
  if (file.size > MAX_IMPORT_BYTES) {
    toast("\u573A\u666F\u6587\u4EF6\u8D85\u8FC7 2 MB\uFF0C\u5DF2\u62D2\u7EDD", "error", 6e3);
    return;
  }
  let payload;
  try {
    const text = await file.text();
    payload = JSON.parse(text);
  } catch (error) {
    toast(`JSON \u89E3\u6790\u5931\u8D25\uFF1A${error.message}`, "error", 6e3);
    return;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    toast("\u573A\u666F\u5FC5\u987B\u662F JSON \u5BF9\u8C61", "error", 5e3);
    return;
  }
  if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) {
    toast("\u573A\u666F\u5FC5\u987B\u5305\u542B nodes \u4E0E edges \u6570\u7EC4", "error", 5e3);
    return;
  }
  const confirmed = await confirmModal(
    "\u5BFC\u5165\u5E76\u66FF\u6362\u5F53\u524D\u573A\u666F\uFF1F",
    `\u6587\u4EF6\u5305\u542B ${payload.nodes.length} \u4E2A\u8282\u70B9\u3001${payload.edges.length} \u6761\u8FDE\u63A5\u3002\u5BFC\u5165\u4F1A\u6E05\u7A7A\u5F53\u524D\u573A\u666F\u7684\u8282\u70B9\u3001\u8FDE\u63A5\u4E0E\u5F55\u5236\u6570\u636E\u3002`,
    "\u5BFC\u5165",
    true
  );
  if (!confirmed) return;
  const response = await deps.task(() => jsonRequest("/api/scene", "POST", payload));
  if (!response) return;
  state.selection = { type: null, id: null };
  state.inspectorId = null;
  state.frames = [];
  state.values.clear();
  state.nodeValues.clear();
  state.edgeValues.clear();
  deps.applySnapshot(response);
  state.cursor = Number(response.sim?.cursor) || 0;
  deps.renderInspector();
  renderScenePanel();
  deps.renderSignalList();
  deps.fitView();
  toast("\u573A\u666F\u5DF2\u5BFC\u5165", "ok", 2200);
}
async function changeIntegration(value) {
  if (state.mode !== "circuit") {
    toast("\u79EF\u5206\u65B9\u6CD5\u53EA\u7528\u4E8E\u7535\u8DEF\u6A21\u5F0F", "info", 1800);
    updateScenePanelValues();
    return;
  }
  const response = await deps.task(() => jsonRequest("/api/scene", "PATCH", { integration: value }));
  if (!response) {
    updateScenePanelValues();
    return;
  }
  deps.applySnapshot(response);
  renderScenePanel();
  toast(`\u79EF\u5206\u65B9\u6CD5\u5DF2\u5207\u6362\u4E3A ${value === "trapezoidal" ? "\u68AF\u5F62\u6CD5" : "\u540E\u5411\u6B27\u62C9"}`, "ok", 2e3);
}
async function changeAlgebraicSolver(enabled) {
  const response = await deps.task(() => jsonRequest("/api/scene/algebraic", "PUT", { enabled }));
  if (!response) {
    updateScenePanelValues();
    return;
  }
  deps.applySnapshot(response);
  renderScenePanel();
  toast(enabled ? "\u5DF2\u5F00\u542F\u4FE1\u53F7\u6D41\u4EE3\u6570\u73AF\u76F4\u63A5\u6C42\u89E3" : "\u5DF2\u5173\u95ED\u4EE3\u6570\u73AF\u76F4\u63A5\u6C42\u89E3", "ok", 2e3);
}
export {
  clearScene,
  initSceneActions,
  loadTemplate,
  migrateSceneToDevices,
  openExport,
  renderScenePanel,
  switchMode
};
