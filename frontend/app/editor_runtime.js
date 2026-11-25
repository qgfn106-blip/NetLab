let switchTab = () => {
};
let bindPanelNavigation = () => {
};
let fetchNetworks = async () => [];
let switchNetwork = async () => {
};
let addNetwork = async () => {
};
let renameNetwork = async () => {
};
let deleteNetwork = async () => {
};
let openNetworkMenu = () => {
};
let renderAnalysisPanel = () => {
};
let renderBlocksPanel = () => {
};
let renderModuleSide = () => {
};
let syncChromeEdges = () => {
};
let applyNetCollapsed = () => {
};
let toggleNetworks = () => {
};
let initNetworkSidebar = () => {
};
function setEditorRuntime(values) {
  switchTab = values.switchTab;
  bindPanelNavigation = values.bindPanelNavigation;
  fetchNetworks = values.fetchNetworks;
  switchNetwork = values.switchNetwork;
  addNetwork = values.addNetwork;
  renameNetwork = values.renameNetwork;
  deleteNetwork = values.deleteNetwork;
  openNetworkMenu = values.openNetworkMenu;
  renderAnalysisPanel = values.renderAnalysisPanel;
  renderBlocksPanel = values.renderBlocksPanel;
  renderModuleSide = values.renderModuleSide;
  syncChromeEdges = values.syncChromeEdges;
  applyNetCollapsed = values.applyNetCollapsed;
  toggleNetworks = values.toggleNetworks;
  initNetworkSidebar = values.initNetworkSidebar;
}
export {
  addNetwork,
  applyNetCollapsed,
  bindPanelNavigation,
  deleteNetwork,
  fetchNetworks,
  initNetworkSidebar,
  openNetworkMenu,
  renameNetwork,
  renderAnalysisPanel,
  renderBlocksPanel,
  renderModuleSide,
  setEditorRuntime,
  switchNetwork,
  switchTab,
  syncChromeEdges,
  toggleNetworks
};
