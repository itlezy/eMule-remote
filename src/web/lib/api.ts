import type {
  ApiError,
  AppVersion,
  GlobalStats,
  KadStatus,
  LogEntry,
  MutationResponse,
  PipeEventEnvelope,
  Preferences,
  SearchResultsResponse,
  SearchSession,
  SearchResult,
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

function postJson<T>(url: string, body?: Record<string, unknown>): Promise<T> {
  return request<T>(url, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  });
}

export const api = {
  health: () => request<{ ok: boolean; pipeConnected: boolean }>('/health'),
  appVersion: () => request<AppVersion>('/api/v2/app/version'),
  appPreferencesGet: () => request<Preferences>('/api/v2/app/preferences'),
  appPreferencesSet: (prefs: Partial<Preferences>) => postJson<{ ok: boolean }>('/api/v2/app/preferences', { prefs }),
  appShutdown: () => postJson<{ ok: boolean }>('/api/v2/app/shutdown'),
  statsGlobal: () => request<GlobalStats>('/api/v2/stats/global'),
  transfersList: () => request<Transfer[]>('/api/v2/transfers'),
  transferGet: (hash: string) => request<Transfer>(`/api/v2/transfers/${hash}`),
  transferSources: (hash: string) => request<Source[]>(`/api/v2/transfers/${hash}/sources`),
  transfersAdd: (links: string[]) => postJson<MutationResponse>('/api/v2/transfers/add', { links }),
  transfersPause: (hashes: string[]) => postJson<MutationResponse>('/api/v2/transfers/pause', { hashes }),
  transfersResume: (hashes: string[]) => postJson<MutationResponse>('/api/v2/transfers/resume', { hashes }),
  transfersStop: (hashes: string[]) => postJson<MutationResponse>('/api/v2/transfers/stop', { hashes }),
  transfersDelete: (hashes: string[], deleteFiles = true) => postJson<MutationResponse>('/api/v2/transfers/delete', { hashes, deleteFiles }),
  transferRecheck: (hash: string) => postJson<{ ok: boolean }>(`/api/v2/transfers/${hash}/recheck`),
  transferSetPriority: (hash: string, priority: string) => postJson<{ ok: boolean }>(`/api/v2/transfers/${hash}/priority`, { priority }),
  transferSetCategory: (hash: string, category: number) => postJson<{ ok: boolean }>(`/api/v2/transfers/${hash}/category`, { category }),
  uploadsList: () => request<UploadEntry[]>('/api/v2/uploads/list'),
  uploadsQueue: () => request<UploadEntry[]>('/api/v2/uploads/queue'),
  uploadsRemove: (selector: { userHash?: string; ip?: string; port?: number }) => postJson<UploadControlResponse>('/api/v2/uploads/remove', selector),
  uploadsReleaseSlot: (selector: { userHash?: string; ip?: string; port?: number }) => postJson<UploadControlResponse>('/api/v2/uploads/release_slot', selector),
  serversList: () => request<Server[]>('/api/v2/servers/list'),
  serversStatus: () => request<ServerStatus>('/api/v2/servers/status'),
  serversConnect: (server?: { addr: string; port: number }) => postJson<ServerStatus>('/api/v2/servers/connect', server),
  serversDisconnect: () => postJson<ServerStatus>('/api/v2/servers/disconnect'),
  serversAdd: (server: { addr: string; port: number; name?: string }) => postJson<Server>('/api/v2/servers/add', server),
  serversRemove: (server: { addr: string; port: number }) => postJson<Server>('/api/v2/servers/remove', server),
  kadStatus: () => request<KadStatus>('/api/v2/kad/status'),
  kadConnect: () => postJson<KadStatus>('/api/v2/kad/connect'),
  kadDisconnect: () => postJson<KadStatus>('/api/v2/kad/disconnect'),
  kadRecheckFirewall: () => postJson<KadStatus>('/api/v2/kad/recheck_firewall'),
  sharedList: () => request<SharedFile[]>('/api/v2/shared/list'),
  sharedGet: (hash: string) => request<SharedFile>(`/api/v2/shared/${hash}`),
  sharedAdd: (path: string) => postJson<SharedAddResponse>('/api/v2/shared/add', { path }),
  sharedRemoveByHash: (hash: string) => postJson<SharedRemoveResponse>('/api/v2/shared/remove', { hash }),
  sharedRemoveByPath: (path: string) => postJson<SharedRemoveResponse>('/api/v2/shared/remove', { path }),
  searchStart: (params: { query: string; method?: string; type?: string; min_size?: number; max_size?: number; ext?: string }) => postJson<SearchSession>('/api/v2/search/start', params),
  searchResults: (searchId: string) => request<SearchResultsResponse>(`/api/v2/search/results?search_id=${encodeURIComponent(searchId)}`),
  searchStop: (searchId: string) => postJson<{ ok: boolean }>('/api/v2/search/stop', { search_id: searchId }),
  logGet: (limit = 120) => request<LogEntry[]>(`/api/v2/log?limit=${limit}`),
  events(onEvent: (event: PipeEventEnvelope) => void): EventSource {
    const source = new EventSource('/api/v2/events', { withCredentials: true });
    source.onmessage = (message) => {
      onEvent(JSON.parse(message.data) as PipeEventEnvelope<SearchResult[]>);
    };
    return source;
  },
};
