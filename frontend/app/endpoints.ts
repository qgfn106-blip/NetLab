// P1-02 S1：前端 /api 路径唯一声明式注册表。
// 本模块只保存路径模板，不发起请求；app.ts 及后续拆分模块通过它取路径，
// 从而让 endpoint 清单集中可审计（快照见 tools/app_endpoint_snapshot.json）。

const enc = (value: string | number | boolean | null | undefined): string => encodeURIComponent(String(value));

export const ENDPOINTS = {
  catalog: '/api/catalog',
  config: '/api/config',
  state: '/api/state',
  positions: '/api/positions',
  control: '/api/control',
  scene: '/api/scene',
  sceneAppearance: '/api/scene/appearance',
  live: (cursor: number, limit = 600): string => `/api/live?cursor=${cursor}&limit=${limit}`,

  nodes: '/api/nodes',
  node: (id: string | number | boolean | null | undefined): string => `/api/nodes/${enc(id)}`,
  edges: '/api/edges',
  edge: (id: string | number | boolean | null | undefined): string => `/api/edges/${enc(id)}`,

  networks: '/api/networks',
  network: (id: string | number | boolean | null | undefined): string => `/api/networks/${enc(id)}`,
  networkActivate: (id: string | number | boolean | null | undefined): string => `/api/networks/${enc(id)}/activate`,

  blocks: '/api/blocks',
  block: (id: string | number | boolean | null | undefined): string => `/api/blocks/${enc(id)}`,
  blockOpenInternal: (id: string | number | boolean | null | undefined): string => `/api/blocks/${enc(id)}/open-internal`,
  blockCompare: (id: string | number | boolean | null | undefined): string => `/api/blocks/${enc(id)}/compare`,
  blockRename: (id: string | number | boolean | null | undefined): string => `/api/blocks/${enc(id)}/rename`,
  blockDelete: (id: string | number | boolean | null | undefined): string => `/api/blocks/${enc(id)}/delete`,
  blockInstantiate: '/api/blocks/instantiate',
  blockEncapsulate: '/api/blocks/encapsulate',
  blockSaveCopy: '/api/blocks/save-copy',
  blockValidate: '/api/blocks/validate',
  blockImport: '/api/blocks/import',
  projectRetry: '/api/project/retry',

  profile: '/api/profile',
  profileTop: (top: number): string => `/api/profile?top=${top}`,
  ui: '/api/ui',
  plugins: '/api/plugins',
  pluginScan: '/api/plugins/scan',
  pluginEnable: (id: string | number | boolean | null | undefined): string => `/api/plugins/${enc(id)}/enable`,
  pluginReload: (id: string | number | boolean | null | undefined): string => `/api/plugins/${enc(id)}/reload`,

  plotkitActive: '/api/plotkit/active',
  plotkitPrecompute: '/api/plotkit/precompute',
  networkStatePrecompute: '/api/network/state/precompute',
  solveWindow: '/api/solve-window',
  shutdown: '/api/shutdown',
} as const;

export type EndpointRegistry = typeof ENDPOINTS;
