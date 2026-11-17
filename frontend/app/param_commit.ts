/* 参数写回（S3 切片：从 app.ts 外提；逻辑字节等价，仅 deps 注入）。 */
import type { EdgeItem, NodeItem, SimRec, SnapshotRec } from './types.js';
import { collectParamValues } from './param_fields.js';

export interface ParamCommitDeps {
    state: { sim: unknown; scene?: { nodes?: NodeItem[]; edges?: EdgeItem[] } | null };
    toast: (message: string, kind: string, duration: number) => void;
    jsonRequest: (url: string, method: string, body?: unknown) => Promise<unknown>;
    wbMarkDirty: () => void;
    applySnapshot: (snapshot: SnapshotRec) => void;
}

export async function wbCommitNodeParam(
    deps: ParamCommitDeps,
  nodeId: string,
  control: HTMLElement,
  baseParams: Record<string, unknown>,
): Promise<void> {
  let values: Record<string, unknown>;
  try {
    values = collectParamValues(control.parentElement || control);
  } catch (error) {
    deps.toast((error as Error).message, 'error', 5000);
    return;
  }
  const merged = Object.assign({}, baseParams, values);
  try {
    const resp = (await deps.jsonRequest(`/api/nodes/${encodeURIComponent(nodeId)}`, 'PATCH', {
      params: merged,
    })) as { node?: NodeItem; sim?: SimRec } | null;
    if (!resp) return;
    Object.assign(baseParams, values);
    if (resp.node) {
      const list = deps.state.scene?.nodes || [];
      const index = list.findIndex((item) => item.id === nodeId);
      if (index >= 0) list[index] = Object.assign({}, list[index], resp.node);
    }
    if (resp.sim) deps.state.sim = resp.sim;
    deps.wbMarkDirty();
  } catch (error) {
    deps.toast((error as Error)?.message || String(error), 'error', 6000);
  }
}

export async function wbCommitEdgeParam(
    deps: ParamCommitDeps,
  edgeId: string,
  control: HTMLElement,
  baseParams: Record<string, unknown>,
): Promise<void> {
  let values: Record<string, unknown>;
  try {
    values = collectParamValues(control.parentElement || control);
  } catch (error) {
    deps.toast((error as Error).message, 'error', 5000);
    return;
  }
  const merged = Object.assign({}, baseParams, values);
  try {
    const resp = (await deps.jsonRequest(`/api/edges/${encodeURIComponent(edgeId)}`, 'PATCH', {
      params: merged,
    })) as { edge?: EdgeItem; sim?: SimRec } | null;
    if (!resp) return;
    Object.assign(baseParams, values);
    if (resp.edge) {
      const list = deps.state.scene?.edges || [];
      const index = list.findIndex((item) => item.id === edgeId);
      if (index >= 0) list[index] = Object.assign({}, list[index], resp.edge);
    }
    if (resp.sim) deps.state.sim = resp.sim;
    deps.wbMarkDirty();
  } catch (error) {
    deps.toast((error as Error)?.message || String(error), 'error', 6000);
  }
}

export async function wbCommitSimParam(
    deps: ParamCommitDeps,
    key: string,
    control: HTMLElement,
): Promise<void> {
  let values: Record<string, unknown>;
  try {
    values = collectParamValues(control.parentElement || control);
  } catch (error) {
    deps.toast((error as Error).message, 'error', 5000);
    return;
  }
  try {
    const resp = (await deps.jsonRequest('/api/config', 'PATCH', {
      [key]: values[key],
    })) as { config?: unknown; sim?: SimRec } | null;
    if (!resp) return;
    if (resp.sim) deps.state.sim = resp.sim;
    deps.wbMarkDirty();
  } catch (error) {
    deps.toast((error as Error)?.message || String(error), 'error', 6000);
  }
}

export async function wbCommitIntegration(
    deps: ParamCommitDeps,
    control: HTMLElement,
): Promise<void> {
  let values: Record<string, unknown>;
  try {
    values = collectParamValues(control.parentElement || control);
  } catch (error) {
    deps.toast((error as Error).message, 'error', 5000);
    return;
  }
  try {
    const resp = (await deps.jsonRequest('/api/scene', 'PATCH', {
      integration: values['integration'],
    })) as SnapshotRec | null;
    if (!resp) return;
    deps.applySnapshot(resp);
    deps.wbMarkDirty();
  } catch (error) {
    deps.toast((error as Error)?.message || String(error), 'error', 6000);
  }
}
