// R40 阶段 3：节点卡片字段（声明式白名单）。
// 字段 id 固定，前端只能选择显示哪些以及它们的上下顺序；
// 不允许携带任意 HTML/CSS/JS 或表达式。
export const CARD_FIELDS: readonly string[] = ['kind', 'name', 'value', 'id'];
export const CARD_FIELD_LABELS: Record<string, string> = {
  kind: '节点类型',
  name: '节点名称',
  value: '节点数值',
  id: '编号尾号',
};
export const DEFAULT_CARD_FIELDS: readonly string[] = ['kind', 'name', 'value'];

/** 白名单 + 去重 + 保序；非数组回退默认，保证旧工程视觉不变。 */
export function normalizeCardFields(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_CARD_FIELDS];
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !CARD_FIELDS.includes(item)) continue;
    if (result.includes(item)) continue;
    result.push(item);
  }
  return result;
}

/** 相对 radius 的纵向偏移；count=3 沿用旧版像素位置。 */
export function cardFieldOffsets(count: number): number[] {
  if (count <= 0) return [];
  if (count === 3) return [-0.56, -0.06, 0.38];
  if (count === 1) return [-0.06];
  const top = -0.56;
  const bottom = 0.38;
  const step = (bottom - top) / (count - 1);
  return Array.from({ length: count }, (_, index) => top + step * index);
}

export function isDefaultCardFields(fields: readonly string[]): boolean {
  return fields.length === DEFAULT_CARD_FIELDS.length
    && fields.every((field, index) => field === DEFAULT_CARD_FIELDS[index]);
}
