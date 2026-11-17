import { C, tokens } from './colors.js';
import { modulePortList } from './ui_helpers.js';
import type { BlockItem, NodeItem, PortSpec, PreviewNode, State, Ui } from './types.js';

export function drawModulePreview(deps: { state: State; ui: Ui }): void {
  const canvas = deps.ui.moduleCanvas;
  const block = deps.state.moduleBlock as BlockItem | null;
  const stage = deps.ui.moduleStage;
  if (!canvas || !stage || !block) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const box = stage.getBoundingClientRect();
  const width = Math.round(box.width);
  const height = Math.round(box.height);
  if (width < 20 || height < 20) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = C('#faf8f2');
  ctx.fillRect(0, 0, width, height);

  const nodes = (block.nodes || []).map((node: NodeItem) => ({
    id: String(node.id || ''),
    label: String(node.params?.port_name || node.name || node.label || node.kind || node.id || '?'),
    kind: String(node.kind || ''),
    x: Number(node.position?.x ?? node.x ?? 0),
    y: Number(node.position?.y ?? node.y ?? 0),
  }));
  const isEmpty = !nodes.length;
  if (deps.ui.moduleEmpty) deps.ui.moduleEmpty.hidden = !isEmpty;
  canvas.hidden = isEmpty;
  if (isEmpty) return;

  const portNets = new Set(modulePortList(block).map((port: PortSpec) => port.net).filter(Boolean));
  const xs = nodes.map((node: PreviewNode) => node.x);
  const ys = nodes.map((node: PreviewNode) => node.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 34;
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY, 1.15);
  const offsetX = (width - spanX * scale) / 2 - minX * scale;
  const offsetY = (height - spanY * scale) / 2 - minY * scale;
  const project = (node: NodeItem | PreviewNode) => ({ x: node.x * scale + offsetX, y: node.y * scale + offsetY });
  const byId = new Map(nodes.map((node: PreviewNode) => [node.id, node]));

  ctx.strokeStyle = C('#ded7c8');
  ctx.lineWidth = 1;
  for (const edge of block.edges || []) {
    const source = byId.get(String(edge.source || ''));
    const target = byId.get(String(edge.target || ''));
    if (!source || !target) continue;
    const a = project(source);
    const b = project(target);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  ctx.font = '10px "Segoe UI", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const node of nodes) {
    const point = project((node as NodeItem));
    const isPort = portNets.has(node.id);
    const isGround = node.kind === 'ground';
    const isDevice = node.kind === 'device';
    const text = node.label.length > 12 ? `${node.label.slice(0, 11)}…` : node.label;
    const w = Math.max(54, Math.round(ctx.measureText(text).width) + 18);
    const h = 22;
    // 端口 > 接地 > 器件 > 普通网络，四档配色让内部结构一眼分清
    const fill = isPort ? tokens().modPortFill : isGround ? tokens().modGroundFill : isDevice ? tokens().modDeviceFill : tokens().modFill;
    const stroke = isPort ? tokens().modPortStroke : isGround ? tokens().modGroundStroke : isDevice ? tokens().modDeviceStroke : tokens().modStroke;
    const ink = isPort ? tokens().modPortInk : isGround ? tokens().modGroundInk : isDevice ? tokens().modDeviceInk : tokens().modInk;
    ctx.beginPath();
    ctx.rect(point.x - w / 2, point.y - h / 2, w, h);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = isPort ? 1.6 : 1;
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.fillText(text, point.x, point.y);
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = C('#969083');
  ctx.font = '9.5px "Segoe UI", "Microsoft YaHei", sans-serif';
  ctx.fillText(`只读预览 · ${block.name || block.id} · ${nodes.length} 节点 / ${(block.edges || []).length} 连线`, 12, height - 12);
}
