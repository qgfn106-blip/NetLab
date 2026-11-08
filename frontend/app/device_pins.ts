// S5-18 电路引脚查询与引脚清单（从 app.ts 原样迁出）
import type { NodeItem, PortSpec, SpecRec } from './types.js';
import { div, el } from './ui.js';
import { state } from './state.js';
import { nodeById } from './model.js';

export function modulePorts(node: NodeItem) {
  return Array.isArray(node?.params?.ports) ? node.params.ports : [];
}

export function deviceElementSpec(node: NodeItem) {
  const element = String(node?.params?.element || '');
  return (state.catalog?.elements || []).find((spec: SpecRec) => spec.kind === element) || null;
}

export function isPinNode(node: NodeItem) {
  return state.scene?.mode === 'circuit'
    && (node?.kind === 'device' || node?.kind === 'module');
}

export function devicePins(node: NodeItem): PortSpec[] {
  if (node?.kind === 'module') {
    // R24/D49：模块实例的端口就是引脚，方向决定它画在哪一侧。
    return modulePorts(node).map((port: PortSpec) => ({
      name: String(port?.name || ''),
      role: port?.direction === 'input'
        ? 'input'
        : port?.direction === 'output'
          ? 'output'
          : 'passive',
      required: false,
      module: true,
    }));
  }
  return (deviceElementSpec(node)?.pins || []) as PortSpec[];
}

export function buildDevicePinList(node: NodeItem) {
  const container = div('kv');
  const wires = (state.scene?.edges || []).filter((edge) => edge.kind === 'wire');
  const pins = devicePins(node);
  if (!pins.length) {
    container.appendChild(div('help', '该元件没有引脚声明。'));
    return container;
  }
  for (const pin of pins) {
    const row = div('kv-row');
    row.appendChild(el('span', null, `${pin.name}${pin.required ? ' *' : ''}`));
    const wire = wires.find((edge) => (edge.source === node.id && edge.source_pin === pin.name)
      || (edge.target === node.id && edge.target_pin === pin.name));
    const netId = wire ? (wire.source === node.id ? wire.target : wire.source) : '';
    const net = netId ? nodeById(netId) : null;
    row.appendChild(el('b', null, net ? net.name : (pin.required ? '未接' : '—')));
    container.appendChild(row);
  }
  return container;
}
