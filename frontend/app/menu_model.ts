// 信号流/矢量场「添加节点」菜单的分组模型（纯函数，便于 node 行为测试）。
// R22/D46：与后端 ELEMENT_GROUP_ORDER 同名同序；这里只决定展示顺序，
// 不重复分类逻辑；未列出的组按 catalog 出现顺序补在后面。
import type { SpecRec } from './types.js';

export const COMPUTE_GROUP_ORDER = ['基础', '动态', '高级', '矢量', '模块', '接口'];

export interface SpecGroup {
  group: string;
  specs: SpecRec[];
}

/** 矢量模式把「矢量」提到最前，其余保持 COMPUTE_GROUP_ORDER。 */
export function computeGroupOrder(mode: string): string[] {
  if (mode !== 'vector') return COMPUTE_GROUP_ORDER;
  return ['矢量', ...COMPUTE_GROUP_ORDER.filter((group) => group !== '矢量')];
}

/**
 * 按 catalog 分组并排序。`addable === false` 的模块实例/端口节点被过滤：
 * 它们只能由模块库实例化或封装生成，手动添加会得到没有 block_id 的坏节点（P0-0）。
 */
export function groupNodeSpecs(specs: SpecRec[], mode: string): SpecGroup[] {
  const byGroup = new Map<string, SpecRec[]>();
  for (const spec of specs) {
    if (spec.addable === false) continue;
    const group = String(spec.group || '未分类');
    const bucket = byGroup.get(group);
    if (bucket) bucket.push(spec);
    else byGroup.set(group, [spec]);
  }
  const emitted = new Set<string>();
  const out: SpecGroup[] = [];
  for (const group of [...computeGroupOrder(mode), ...byGroup.keys()]) {
    if (emitted.has(group)) continue;
    const bucket = byGroup.get(group);
    if (!bucket || !bucket.length) continue;
    emitted.add(group);
    out.push({ group, specs: bucket });
  }
  return out;
}
