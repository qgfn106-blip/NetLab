import { WORKBENCH_SCHEMA, writeWorkbenchUi } from "./analysis_workbench_layout.js";
function beginWorkbenchResize(event, handle, host, sizes, persist) {
  event.preventDefault();
  const target = handle.getAttribute("data-awb-resize");
  const startX = event.clientX;
  const style = getComputedStyle(host);
  const startNav = parseFloat(style.getPropertyValue("--awb-nav-width")) || sizes.sidebar;
  const startDetail = parseFloat(style.getPropertyValue("--awb-detail-width")) || sizes.detail;
  const move = (moveEvent) => {
    const dx = moveEvent.clientX - startX;
    if (target === "nav") {
      sizes.sidebar = Math.max(180, Math.min(420, startNav + dx));
      host.style.setProperty("--awb-nav-width", sizes.sidebar + "px");
    } else {
      sizes.detail = Math.max(220, Math.min(520, startDetail - dx));
      host.style.setProperty("--awb-detail-width", sizes.detail + "px");
    }
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    persist();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}
function applyWorkbenchSizes(host, sizes) {
  host.style.setProperty("--awb-nav-width", sizes.sidebar + "px");
  host.style.setProperty("--awb-detail-width", sizes.detail + "px");
}
function applyWorkbenchChrome(host, collapsed, focusMode) {
  host.dataset.navCollapsed = collapsed.sidebar ? "true" : "false";
  host.dataset.detailCollapsed = collapsed.detail ? "true" : "false";
  host.dataset.focus = focusMode ? "true" : "false";
  host.classList.toggle("awb-focus", focusMode);
}
function buildWorkbenchUiRecord(activeAnalysis, canvases, layout, sizes, collapsed, selectedStateIds) {
  return writeWorkbenchUi({
    schema: WORKBENCH_SCHEMA,
    active_analysis: activeAnalysis,
    canvases,
    layout,
    sizes,
    collapsed,
    selected_state_ids: selectedStateIds
  });
}
function applyWorkbenchCursor(workspace, frequency, canvasId, unit, axisKey) {
  workspace?.setCursor(frequency, canvasId, unit, axisKey);
  if (frequency === null) return null;
  return { frequency, unit, canvasId };
}
export {
  applyWorkbenchChrome,
  applyWorkbenchCursor,
  applyWorkbenchSizes,
  beginWorkbenchResize,
  buildWorkbenchUiRecord
};
