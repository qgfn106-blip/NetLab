export const SHELL_KEYS = {
  netWidth: 'netlab.networks.width',
  netCollapsed: 'netlab.networks.collapsed',
  panelCollapsed: 'netlab.panel.collapsed',
  panelWidth: 'netlab.panel.width',
};

export const MODULE_DIR_GLYPH = { input: '→', output: '←', inout: '↔' };

export const MODULE_DIR_LABEL = { input: '输入', output: '输出', inout: '双向' };

export const PORT_DIRECTION_CHOICES = [
  ['input', '输入', '引脚画在模块左侧，表示从外部流进来'],
  ['output', '输出', '引脚画在模块右侧，表示向外流出'],
  ['inout', '双向', '电气网络默认，两侧都可接线，也可当测试点'],
];
