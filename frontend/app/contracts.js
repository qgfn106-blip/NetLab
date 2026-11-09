const CONTRACT_VERSIONS = {
  channel_key: 1,
  frame: 1,
  project: 6,
  plot_spec: "0.1"
};
const PLOTKIT_API_VERSION = "1";
const PLOT_SEMANTICS = {
  timeField: "t",
  valueField: "values",
  lineWidth: 1.6,
  gridWidth: 1,
  maxPoints: 2e4,
  syncPullLimit: 6e3,
  maxChannels: 64,
  downsample: "minmax"
};
export {
  CONTRACT_VERSIONS,
  PLOTKIT_API_VERSION,
  PLOT_SEMANTICS
};
