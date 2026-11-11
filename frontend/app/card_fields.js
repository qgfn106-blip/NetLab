const CARD_FIELDS = ["kind", "name", "value", "id"];
const CARD_FIELD_LABELS = {
  kind: "\u8282\u70B9\u7C7B\u578B",
  name: "\u8282\u70B9\u540D\u79F0",
  value: "\u8282\u70B9\u6570\u503C",
  id: "\u7F16\u53F7\u5C3E\u53F7"
};
const DEFAULT_CARD_FIELDS = ["kind", "name", "value"];
function normalizeCardFields(value) {
  if (!Array.isArray(value)) return [...DEFAULT_CARD_FIELDS];
  const result = [];
  for (const item of value) {
    if (typeof item !== "string" || !CARD_FIELDS.includes(item)) continue;
    if (result.includes(item)) continue;
    result.push(item);
  }
  return result;
}
function cardFieldOffsets(count) {
  if (count <= 0) return [];
  if (count === 3) return [-0.56, -0.06, 0.38];
  if (count === 1) return [-0.06];
  const top = -0.56;
  const bottom = 0.38;
  const step = (bottom - top) / (count - 1);
  return Array.from({ length: count }, (_, index) => top + step * index);
}
function isDefaultCardFields(fields) {
  return fields.length === DEFAULT_CARD_FIELDS.length && fields.every((field, index) => field === DEFAULT_CARD_FIELDS[index]);
}
export {
  CARD_FIELDS,
  CARD_FIELD_LABELS,
  DEFAULT_CARD_FIELDS,
  cardFieldOffsets,
  isDefaultCardFields,
  normalizeCardFields
};
