// P3-06: editor 服务注册表（仅 boot 首行调用，避免运行时环）。
import * as canvas_commands from './editor_canvas_commands.js';
import * as menus from './editor_menus.js';
import * as node_actions from './editor_node_actions.js';
import * as base from './editor_base.js';
import * as loop from './editor_loop.js';
import * as appearance from './editor_appearance.js';
import * as panels from './editor_panels.js';
import * as help from './editor_help.js';
import * as shell from './editor_shell.js';
import * as blocks from './editor_blocks.js';
import { setEditorServices } from './editor_services.js';

export function installEditorServices(): void {
  setEditorServices({
    scheduleChartDraw: canvas_commands.scheduleChartDraw,
    completeWireTool: canvas_commands.completeWireTool,
    onContextMenu: canvas_commands.onContextMenu,
    patchEdgeGeometry: canvas_commands.patchEdgeGeometry,
    patchNodeGeometry: canvas_commands.patchNodeGeometry,
    queuePositionSave: canvas_commands.queuePositionSave,
    wireToolEndpointAt: canvas_commands.wireToolEndpointAt,
    startWireTool: canvas_commands.startWireTool,
    cancelWireTool: canvas_commands.cancelWireTool,
    closePopups: menus.closePopups,
    openAddMenu: menus.openAddMenu,
    openLinkMenu: menus.openLinkMenu,
    buildAddMenuItems: menus.buildAddMenuItems,
    openGenericMenu: menus.openGenericMenu,
    centerPlacement: menus.centerPlacement,
    showHelp: menus.showHelp,
    createWire: node_actions.createWire,
    renderInspector: node_actions.renderInspector,
    selectEntity: node_actions.selectEntity,
    addWireWaypoint: node_actions.addWireWaypoint,
    alignSelection: node_actions.alignSelection,
    autoLayout: node_actions.autoLayout,
    batchResizeSelection: node_actions.batchResizeSelection,
    clearWireWaypoints: node_actions.clearWireWaypoints,
    createWireBetween: node_actions.createWireBetween,
    deleteEdge: node_actions.deleteEdge,
    deleteNode: node_actions.deleteNode,
    deleteSelection: node_actions.deleteSelection,
    distributeSelection: node_actions.distributeSelection,
    selectWireNetwork: node_actions.selectWireNetwork,
    toggleEdgeDelay: node_actions.toggleEdgeDelay,
    addDeviceAt: node_actions.addDeviceAt,
    addNodeAt: node_actions.addNodeAt,
    createEdge: node_actions.createEdge,
    openWireDialog: node_actions.openWireDialog,
    hitTest: base.hitTest,
    nearestNodeWithin: base.nearestNodeWithin,
    zoomAt: base.zoomAt,
    colorForKey: base.colorForKey,
    fitView: base.fitView,
    syncUI: base.syncUI,
    resizeChart: base.resizeChart,
    resizeGraph: base.resizeGraph,
    ingestFrame: base.ingestFrame,
    updateSignalKeyCache: base.updateSignalKeyCache,
    zoomCenter: base.zoomCenter,
    control: loop.control,
    refreshState: loop.refreshState,
    openPrecomputeDialog: loop.openPrecomputeDialog,
    shutdownApp: loop.shutdownApp,
    switchWorkspace: loop.switchWorkspace,
    openViewDesigner: appearance.openViewDesigner,
    togglePanel: panels.togglePanel,
    syncFnRoleToSelection: help.syncFnRoleToSelection,
    openDocSearch: help.openDocSearch,
    initMenus: shell.initMenus,
    refreshBlocks: blocks.refreshBlocks,
    task: base.runTask,
  });
}
