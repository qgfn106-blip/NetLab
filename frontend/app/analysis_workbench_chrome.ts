/* 分析工作台外壳（interaction 层）：侧栏拖拽、尺寸与折叠/专注态、UI 状态记录组装。
 * 只操作宿主元素与尺寸/折叠状态，不触碰画布布局树或分析数据。
 */
import { WORKBENCH_SCHEMA, writeWorkbenchUi, type WorkbenchCanvasRec, type WorkbenchUiRec } from './analysis_workbench_layout.js';
import type { WorkbenchLayoutRecV2 } from './analysis_workbench_layout_tree.js';
import type { AnalysisKind } from './analysis_workbench_meta.js';

export interface WorkbenchSizes { sidebar: number; detail: number }
export interface WorkbenchCollapsed { sidebar: boolean; detail: boolean }

export function beginWorkbenchResize(event: PointerEvent, handle: HTMLElement, host: HTMLElement, sizes: WorkbenchSizes, persist: () => void): void {
  event.preventDefault();
  const target = handle.getAttribute('data-awb-resize');
  const startX = event.clientX;
  const style = getComputedStyle(host);
  const startNav = parseFloat(style.getPropertyValue('--awb-nav-width')) || sizes.sidebar;
  const startDetail = parseFloat(style.getPropertyValue('--awb-detail-width')) || sizes.detail;
  const move = (moveEvent: PointerEvent) => {
    const dx = moveEvent.clientX - startX;
    if (target === 'nav') {
      sizes.sidebar = Math.max(180, Math.min(420, startNav + dx));
      host.style.setProperty('--awb-nav-width', sizes.sidebar + 'px');
    } else {
      sizes.detail = Math.max(220, Math.min(520, startDetail - dx));
      host.style.setProperty('--awb-detail-width', sizes.detail + 'px');
    }
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    persist();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

export function applyWorkbenchSizes(host: HTMLElement, sizes: WorkbenchSizes): void {
  host.style.setProperty('--awb-nav-width', sizes.sidebar + 'px');
  host.style.setProperty('--awb-detail-width', sizes.detail + 'px');
}

export function applyWorkbenchChrome(host: HTMLElement, collapsed: WorkbenchCollapsed, focusMode: boolean): void {
  host.dataset.navCollapsed = collapsed.sidebar ? 'true' : 'false';
  host.dataset.detailCollapsed = collapsed.detail ? 'true' : 'false';
  host.dataset.focus = focusMode ? 'true' : 'false';
  host.classList.toggle('awb-focus', focusMode);
}

export function buildWorkbenchUiRecord(
  activeAnalysis: AnalysisKind,
  canvases: WorkbenchCanvasRec[],
  layout: WorkbenchLayoutRecV2,
  sizes: WorkbenchSizes,
  collapsed: WorkbenchCollapsed,
  selectedStateIds: string[],
): WorkbenchUiRec {
  return writeWorkbenchUi({
    schema: WORKBENCH_SCHEMA,
    active_analysis: activeAnalysis,
    canvases,
    layout,
    sizes,
    collapsed,
    selected_state_ids: selectedStateIds,
  });
}
export function applyWorkbenchCursor(
  workspace: { setCursor(frequency: number | null, canvasId: string, unit: string, axisKey: string): void } | undefined,
  frequency: number | null,
  canvasId: string,
  unit: string,
  axisKey: string,
): { frequency: number; unit: string; canvasId: string } | null {
  workspace?.setCursor(frequency, canvasId, unit, axisKey);
  if (frequency === null) return null;
  return { frequency, unit, canvasId };
}

