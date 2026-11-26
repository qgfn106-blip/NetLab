/* Netlab session store：app.ts 会话/状态读写接口（P1-02 S2 抽取；行为等价）。 */
import type { DegradedItemRec, DegradedRec, EdgeItem, NodeItem, SnapshotRec } from './types.js';
import { state } from './state.js';

/** app.ts 注入给会话状态层的视图/选择回调，避免 store 反向依赖入口内部函数。 */
export interface SessionStoreDeps {
  scheduleChartDraw(): void;
  clearSelection(): void;
  requestDraw(): void;
  updateModeUI(): void;
  syncUI(): void;
  updateInfoBar(): void;
  showBanner(message: string): void;
  hideBanner(): void;
  updateScenePanelValues(): void;
  updateSignalKeyCache(): void;
  updateInspectorLive(): void;
  renderVectorNodeList(): void;
  schedulePhaseDraw(): void;
  nodeById(id: string | null): NodeItem | null;
  edgeById(id: string | null): EdgeItem | null;
}

let deps: SessionStoreDeps | null = null;

/** 由 app.ts 启动装配时注入依赖；store 不直接依赖入口内部函数。 */
export function initSessionStore(next: SessionStoreDeps): void {
  deps = next;
}

function store(): SessionStoreDeps {
  if (!deps) throw new Error('SessionStore 尚未初始化');
  return deps;
}

/**
 * 把后端快照写入本地会话状态：场景/仿真/限值、帧缓存、选择集与降级横幅。
 * 依赖视图刷新回调，但状态字段读写全部收敛在本模块。
 */
export function applySnapshot(snapshot: SnapshotRec): void {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.scene) return;
  const sim = snapshot.sim || state.sim;
  const previousCursor = state.cursor;
  const resetFrames = !state.sim || (sim && sim.steps === 0 && sim.time === 0);

  state.scene = snapshot.scene;
  state.sim = sim;
  // 电路变了（revision 变化），旧的扫频结果不再成立：清掉缓存并提示重算
  const nextRevision = snapshot.scene.revision ?? null;
  // 场景被重置或替换后，旧预计算数据不再对应，恢复“首次运行提示”
  if (resetFrames || (state.precomputedRevision != null && nextRevision !== state.precomputedRevision)) {
    state.precomputedSeconds = null;
    state.precomputedRevision = null;
  }
  if (snapshot.limits) state.limits = snapshot.limits;
  state.mode = state.scene!.mode || state.mode;

  if (resetFrames || (sim && Number(sim.cursor) < previousCursor)) {
    state.frames = [];
    state.values.clear();
    state.nodeValues.clear();
    state.edgeValues.clear();
    state.cursor = Number(sim?.cursor) || 0;
    store().scheduleChartDraw();
  }

  if (state.selection.type && !lookupSelection()) {
    store().clearSelection();
  }
  // 场景被换掉/节点被删后，多选集合里的旧 id 要清掉，否则「封装选中」
  // 会拿着一批已经不存在的节点去请求，后端只能报「节点不存在」。
  const liveNodes = new Set((state.scene?.nodes || []).map((node) => node.id));
  const liveEdges = new Set((state.scene?.edges || []).map((edge) => edge.id));
  let staleSelection = false;
  for (const id of [...(state.multi?.nodes || [])]) {
    if (!liveNodes.has(id)) {
      state.multi.nodes.delete(id);
      staleSelection = true;
    }
  }
  for (const id of [...(state.multi?.edges || [])]) {
    if (!liveEdges.has(id)) {
      state.multi.edges.delete(id);
      staleSelection = true;
    }
  }
  if (staleSelection) store().requestDraw();
  store().updateModeUI();
  store().syncUI();
  store().updateInfoBar();
  const degraded = (sim && sim.degraded) as DegradedRec | null;
  if (degraded && degraded.read_only) {
    const missing = (degraded.missing || []).map((item: DegradedItemRec) => `${item.id}@v${item.version}`).join('、');
    store().showBanner(`降级只读：${degraded.message}${missing ? `（缺失：${missing}）` : ''}`);
    state.degradedBanner = true;
  } else if (state.degradedBanner) {
    state.degradedBanner = false;
    store().hideBanner();
  }
  store().updateScenePanelValues();
  store().updateSignalKeyCache();
  store().requestDraw();
  store().updateInspectorLive();
  store().renderVectorNodeList();
  store().schedulePhaseDraw();
}

/** 当前单选命中的节点/连接；选择失效时返回 null。 */
export function lookupSelection(): NodeItem | EdgeItem | null {
  if (state.selection.type === 'node') return store().nodeById(state.selection.id);
  if (state.selection.type === 'edge') return store().edgeById(state.selection.id);
  return null;
}
