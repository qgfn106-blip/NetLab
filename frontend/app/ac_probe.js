function probeNamesForAc(nodes) {
  return nodes.filter((node) => node.kind === "node").map((node) => node.name).filter((name) => Boolean(name));
}
export {
  probeNamesForAc
};
