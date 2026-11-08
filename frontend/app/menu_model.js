const COMPUTE_GROUP_ORDER = ["\u57FA\u7840", "\u52A8\u6001", "\u9AD8\u7EA7", "\u77E2\u91CF", "\u6A21\u5757", "\u63A5\u53E3"];
function computeGroupOrder(mode) {
  if (mode !== "vector") return COMPUTE_GROUP_ORDER;
  return ["\u77E2\u91CF", ...COMPUTE_GROUP_ORDER.filter((group) => group !== "\u77E2\u91CF")];
}
function groupNodeSpecs(specs, mode) {
  const byGroup = /* @__PURE__ */ new Map();
  for (const spec of specs) {
    if (spec.addable === false) continue;
    const group = String(spec.group || "\u672A\u5206\u7C7B");
    const bucket = byGroup.get(group);
    if (bucket) bucket.push(spec);
    else byGroup.set(group, [spec]);
  }
  const emitted = /* @__PURE__ */ new Set();
  const out = [];
  for (const group of [...computeGroupOrder(mode), ...byGroup.keys()]) {
    if (emitted.has(group)) continue;
    const bucket = byGroup.get(group);
    if (!bucket || !bucket.length) continue;
    emitted.add(group);
    out.push({ group, specs: bucket });
  }
  return out;
}
export {
  COMPUTE_GROUP_ORDER,
  computeGroupOrder,
  groupNodeSpecs
};
