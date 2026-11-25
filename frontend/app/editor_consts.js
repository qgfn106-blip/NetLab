const SHELL_KEYS = {
  netWidth: "netlab.networks.width",
  netCollapsed: "netlab.networks.collapsed",
  panelCollapsed: "netlab.panel.collapsed",
  panelWidth: "netlab.panel.width"
};
const MODULE_DIR_GLYPH = { input: "\u2192", output: "\u2190", inout: "\u2194" };
const MODULE_DIR_LABEL = { input: "\u8F93\u5165", output: "\u8F93\u51FA", inout: "\u53CC\u5411" };
const PORT_DIRECTION_CHOICES = [
  ["input", "\u8F93\u5165", "\u5F15\u811A\u753B\u5728\u6A21\u5757\u5DE6\u4FA7\uFF0C\u8868\u793A\u4ECE\u5916\u90E8\u6D41\u8FDB\u6765"],
  ["output", "\u8F93\u51FA", "\u5F15\u811A\u753B\u5728\u6A21\u5757\u53F3\u4FA7\uFF0C\u8868\u793A\u5411\u5916\u6D41\u51FA"],
  ["inout", "\u53CC\u5411", "\u7535\u6C14\u7F51\u7EDC\u9ED8\u8BA4\uFF0C\u4E24\u4FA7\u90FD\u53EF\u63A5\u7EBF\uFF0C\u4E5F\u53EF\u5F53\u6D4B\u8BD5\u70B9"]
];
export {
  MODULE_DIR_GLYPH,
  MODULE_DIR_LABEL,
  PORT_DIRECTION_CHOICES,
  SHELL_KEYS
};
