export interface ViewState {
  version: 1;
  hiddenNodeIds: string[];
  labels: Record<string, string>;
  pinned: Record<string, { x: number; y: number }>;
  relation: string;
  dataMode: string;
  owner?: string;
  app?: string;
  zoom: number;
  mode?: 'system' | 'data';
}

const MAX_ENTRIES = 2000;

export function defaultViewState(): ViewState {
  return { version: 1, hiddenNodeIds: [], labels: {}, pinned: {}, relation: 'all', dataMode: 'domain', zoom: 100 };
}

export function sanitizeViewState(input: unknown): ViewState {
  const base = defaultViewState();
  if (!input || typeof input !== 'object') return base;
  const candidate = input as Record<string, unknown>;
  const hiddenNodeIds = Array.isArray(candidate.hiddenNodeIds)
    ? candidate.hiddenNodeIds.filter((id): id is string => typeof id === 'string' && id.length <= 90 && /^(?:[a-f0-9]{20}|group:.{1,80})$/.test(id)).slice(0, MAX_ENTRIES)
    : [];
  const labels: Record<string, string> = {};
  if (candidate.labels && typeof candidate.labels === 'object') {
    for (const [id, label] of Object.entries(candidate.labels as Record<string, unknown>)) {
      if (Object.keys(labels).length >= MAX_ENTRIES) break;
      if (typeof label === 'string' && label.length > 0 && label.length <= 80 && /^(?:[a-f0-9]{20}|group:.{1,80})$/.test(id)) labels[id] = label;
    }
  }
  const pinned: Record<string, { x: number; y: number }> = {};
  if (candidate.pinned && typeof candidate.pinned === 'object') {
    for (const [id, position] of Object.entries(candidate.pinned as Record<string, unknown>)) {
      if (Object.keys(pinned).length >= MAX_ENTRIES) break;
      if (!position || typeof position !== 'object' || !/^(?:[a-f0-9]{20}|group:.{1,80})$/.test(id)) continue;
      const { x, y } = position as Record<string, unknown>;
      if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)) {
        pinned[id] = { x: Math.max(-5000, Math.min(5000, x)), y: Math.max(-5000, Math.min(5000, y)) };
      }
    }
  }
  return {
    version: 1,
    hiddenNodeIds,
    labels,
    pinned,
    relation: typeof candidate.relation === 'string' && /^[\w-]{1,40}$/.test(candidate.relation) ? candidate.relation : base.relation,
    dataMode: candidate.dataMode === 'physical' ? 'physical' : 'domain',
    owner: typeof candidate.owner === 'string' && candidate.owner.length <= 80 ? candidate.owner : undefined,
    app: typeof candidate.app === 'string' && candidate.app.length <= 80 ? candidate.app : undefined,
    zoom: typeof candidate.zoom === 'number' && Number.isFinite(candidate.zoom) ? Math.max(50, Math.min(180, candidate.zoom)) : base.zoom,
    mode: candidate.mode === 'data' ? 'data' : candidate.mode === 'system' ? 'system' : undefined,
  };
}
