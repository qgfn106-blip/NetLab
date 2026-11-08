/** AC 扫频默认探针选择（纯函数，行为测试见 frontend/tests/ac_probe.test.mjs）。 */

export interface AcProbeNode {
  kind?: string;
  name?: string;
}

export function probeNamesForAc(nodes: readonly AcProbeNode[]): string[] {
  return nodes
    .filter((node) => node.kind === 'node')
    .map((node) => node.name)
    .filter((name): name is string => Boolean(name));
}
