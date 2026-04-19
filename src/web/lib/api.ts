import type {
  ApiError,
  AppVersion,
  GlobalStats,
  KadStatus,
  LogEntry,
  Preferences,
  SearchResultsResponse,
  Server,
  ServerStatus,
  SharedAddResponse,
  SharedFile,
  SharedRemoveResponse,
  Source,
  Transfer,
  UploadControlResponse,
  UploadEntry,
} from './types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const error = (await response.json()) as ApiError;
    throw new Error(error.message);
  }

  return response.json() as Promise<T>;
}

function postJson<T>(url: string, body?: unknown): Promise<T> {
  return request<T>(url, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  });
}

export const api = {
  health: () => request<{ ok: boolean; emuleReachable: boolean }>('/health'),
  appVersion: () => request<AppVersion>('/api/v1/app/version'),
  appPreferencesGet: () => request<Preferences>('/api/v1/app/preferences'),
  appPreferencesSet: (prefs: Partial<Preferences>) => postJson<{ ok: boolean }>('/api/v1/app/preferences', { prefs }),
  appShutdown: () => postJson<{ ok: boolean }>('/api/v1/app/shutdown'),
  statsGlobal: () => request<GlobalStats>('/api/v1/stats/global'),
  transfersList: () => request<Transfer[]>('/api/v1/transfers'),
  transferGet: (hash: string) => request<Transfer>(`/api/v1/transfers/${hash}`),
  transferSources: (hash: string) => request<Source[]>(`/api/v1/transfers/${hash}/sources`),
  transferAdd: (link: string) => postJson<{ hash: string; name: string }>('/api/v1/transfers/add', { link }),
  transfersPause: (hashes: string[]) => postJson<{ results: Array<{ hash: string | null; ok: boolean; error?: string | null }> }>('/api/v1/transfers/pause', { hashes }),
  transfersResume: (hashes: string[]) => postJson<{ results: Array<{ hash: string | null; ok: boolean; error?: string | null }> }>('/api/v1/transfers/resume', { hashes }),
  transfersStop: (hashes: string[]) => postJson<{ results: Array<{ hash: string | null; ok: boolean; error?: string | null }> }>('/api/v1/transfers/stop', { hashes }),
  transfersDelete: (hashes: string[], deleteFiles = true) => postJson<{ results: Array<{ hash: string | null; ok: boolean; error?: string | null }> }>('/api/v1/transfers/delete', { hashes, deleteFiles }),
  transferRecheck: (hash: string) => postJson<{ ok: boolean }>(`/api/v1/transfers/${hash}/recheck`),
  transferSetPriority: (hash: string, priority: string) => postJson<{ ok: boolean }>(`/api/v1/transfers/${hash}/priority`, { priority }),
  transferSetCategory: (hash: string, category: number) => postJson<{ ok: boolean }>(`/api/v1/transfers/${hash}/category`, { category }),
  uploadsList: () => request<UploadEntry[]>('/api/v1/uploads/list'),
  uploadsQueue: () => request<UploadEntry[]>('/api/v1/uploads/queue'),
  uploadsRemove: (selector: { userHash?: string; ip?: string; port?: number }) => postJson<UploadControlResponse>('/api/v1/uploads/remove', selector),
  uploadsReleaseSlot: (selector: { userHash?: string; ip?: string; port?: number }) => postJson<UploadControlResponse>('/api/v1/uploads/release_slot', selector),
  serversList: () => request<Server[]>('/api/v1/servers/list'),
  serversStatus: () => request<ServerStatus>('/api/v1/servers/status'),
  serversConnect: (server?: { addr: string; port: number }) => postJson<ServerStatus>('/api/v1/servers/connect', server),
  serversDisconnect: () => postJson<ServerStatus>('/api/v1/servers/disconnect'),
  serversAdd: (server: { addr: string; port: number; name?: string }) => postJson<Server>('/api/v1/servers/add', server),
  serversRemove: (server: { addr: string; port: number }) => postJson<Server>('/api/v1/servers/remove', server),
  kadStatus: () => request<KadStatus>('/api/v1/kad/status'),
  kadConnect: () => postJson<KadStatus>('/api/v1/kad/connect'),
  kadDisconnect: () => postJson<KadStatus>('/api/v1/kad/disconnect'),
  kadRecheckFirewall: () => postJson<KadStatus>('/api/v1/kad/recheck_firewall'),
  sharedList: () => request<SharedFile[]>('/api/v1/shared/list'),
  sharedGet: (hash: string) => request<SharedFile>(`/api/v1/shared/${hash}`),
  sharedAdd: (path: string) => postJson<SharedAddResponse>('/api/v1/shared/add', { path }),
  sharedRemoveByHash: (hash: string) => postJson<SharedRemoveResponse>('/api/v1/shared/remove', { hash }),
  sharedRemoveByPath: (path: string) => postJson<SharedRemoveResponse>('/api/v1/shared/remove', { path }),
  searchStart: (params: { query: string; method?: string; type?: string; min_size?: number; max_size?: number; ext?: string }) => postJson<{ search_id: string }>('/api/v1/search/start', params),
  searchResults: (searchId: string) => request<SearchResultsResponse>(`/api/v1/search/results?search_id=${encodeURIComponent(searchId)}`),
  searchStop: (searchId: string) => postJson<{ ok: boolean }>('/api/v1/search/stop', { search_id: searchId }),
  logGet: (limit = 120) => request<LogEntry[]>(`/api/v1/log?limit=${limit}`),
};
