let scheduleChartDraw;
let completeWireTool;
let onContextMenu;
let patchEdgeGeometry;
let patchNodeGeometry;
let queuePositionSave;
let wireToolEndpointAt;
let startWireTool;
let cancelWireTool;
let closePopups;
let openAddMenu;
let openLinkMenu;
let buildAddMenuItems;
let openGenericMenu;
let centerPlacement;
let showHelp;
let createWire;
let renderInspector;
let selectEntity;
let addWireWaypoint;
let alignSelection;
let autoLayout;
let batchResizeSelection;
let clearWireWaypoints;
let createWireBetween;
let deleteEdge;
let deleteNode;
let deleteSelection;
let distributeSelection;
let selectWireNetwork;
let toggleEdgeDelay;
let addDeviceAt;
let addNodeAt;
let createEdge;
let openWireDialog;
let hitTest;
let nearestNodeWithin;
let zoomAt;
let colorForKey;
let fitView;
let syncUI;
let resizeChart;
let resizeGraph;
let ingestFrame;
let updateSignalKeyCache;
let zoomCenter;
let control;
let refreshState;
let openPrecomputeDialog;
let shutdownApp;
let switchWorkspace;
let openViewDesigner;
let togglePanel;
let syncFnRoleToSelection;
let openDocSearch;
let initMenus;
let refreshBlocks;
let task;
function setEditorServices(values) {
  scheduleChartDraw = values.scheduleChartDraw;
  completeWireTool = values.completeWireTool;
  onContextMenu = values.onContextMenu;
  patchEdgeGeometry = values.patchEdgeGeometry;
  patchNodeGeometry = values.patchNodeGeometry;
  queuePositionSave = values.queuePositionSave;
  wireToolEndpointAt = values.wireToolEndpointAt;
  startWireTool = values.startWireTool;
  cancelWireTool = values.cancelWireTool;
  closePopups = values.closePopups;
  openAddMenu = values.openAddMenu;
  openLinkMenu = values.openLinkMenu;
  buildAddMenuItems = values.buildAddMenuItems;
  openGenericMenu = values.openGenericMenu;
  centerPlacement = values.centerPlacement;
  showHelp = values.showHelp;
  createWire = values.createWire;
  renderInspector = values.renderInspector;
  selectEntity = values.selectEntity;
  addWireWaypoint = values.addWireWaypoint;
  alignSelection = values.alignSelection;
  autoLayout = values.autoLayout;
  batchResizeSelection = values.batchResizeSelection;
  clearWireWaypoints = values.clearWireWaypoints;
  createWireBetween = values.createWireBetween;
  deleteEdge = values.deleteEdge;
  deleteNode = values.deleteNode;
  deleteSelection = values.deleteSelection;
  distributeSelection = values.distributeSelection;
  selectWireNetwork = values.selectWireNetwork;
  toggleEdgeDelay = values.toggleEdgeDelay;
  addDeviceAt = values.addDeviceAt;
  addNodeAt = values.addNodeAt;
  createEdge = values.createEdge;
  openWireDialog = values.openWireDialog;
  hitTest = values.hitTest;
  nearestNodeWithin = values.nearestNodeWithin;
  zoomAt = values.zoomAt;
  colorForKey = values.colorForKey;
  fitView = values.fitView;
  syncUI = values.syncUI;
  resizeChart = values.resizeChart;
  resizeGraph = values.resizeGraph;
  ingestFrame = values.ingestFrame;
  updateSignalKeyCache = values.updateSignalKeyCache;
  zoomCenter = values.zoomCenter;
  control = values.control;
  refreshState = values.refreshState;
  openPrecomputeDialog = values.openPrecomputeDialog;
  shutdownApp = values.shutdownApp;
  switchWorkspace = values.switchWorkspace;
  openViewDesigner = values.openViewDesigner;
  togglePanel = values.togglePanel;
  syncFnRoleToSelection = values.syncFnRoleToSelection;
  openDocSearch = values.openDocSearch;
  initMenus = values.initMenus;
  refreshBlocks = values.refreshBlocks;
  task = values.task;
}
export {
  addDeviceAt,
  addNodeAt,
  addWireWaypoint,
  alignSelection,
  autoLayout,
  batchResizeSelection,
  buildAddMenuItems,
  cancelWireTool,
  centerPlacement,
  clearWireWaypoints,
  closePopups,
  colorForKey,
  completeWireTool,
  control,
  createEdge,
  createWire,
  createWireBetween,
  deleteEdge,
  deleteNode,
  deleteSelection,
  distributeSelection,
  fitView,
  hitTest,
  ingestFrame,
  initMenus,
  nearestNodeWithin,
  onContextMenu,
  openAddMenu,
  openDocSearch,
  openGenericMenu,
  openLinkMenu,
  openPrecomputeDialog,
  openViewDesigner,
  openWireDialog,
  patchEdgeGeometry,
  patchNodeGeometry,
  queuePositionSave,
  refreshBlocks,
  refreshState,
  renderInspector,
  resizeChart,
  resizeGraph,
  scheduleChartDraw,
  selectEntity,
  selectWireNetwork,
  setEditorServices,
  showHelp,
  shutdownApp,
  startWireTool,
  switchWorkspace,
  syncFnRoleToSelection,
  syncUI,
  task,
  toggleEdgeDelay,
  togglePanel,
  updateSignalKeyCache,
  wireToolEndpointAt,
  zoomAt,
  zoomCenter
};
