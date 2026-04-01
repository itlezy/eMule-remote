import type { ApiError, Download, LogEntry, MutationResponse, PipeEventEnvelope, Source, SystemStats, SystemVersion } from './types';

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

export const api = {
  health: () => request<{ ok: boolean; pipeConnected: boolean }>('/health'),
  systemVersion: () => request<SystemVersion>('/api/v2/app/version'),
  systemStats: () => request<SystemStats>('/api/v2/stats/global'),
  downloads: () => request<Download[]>('/api/v2/transfers'),
  download: (hash: string) => request<Download>(`/api/v2/transfers/${hash}`),
  sources: (hash: string) => request<Source[]>(`/api/v2/transfers/${hash}/sources`),
  logs: (limit = 120) => request<LogEntry[]>(`/api/v2/log?limit=${limit}`),
  addLinks: (links: string[]) => request<MutationResponse>('/api/v2/transfers/add', { method: 'POST', body: JSON.stringify({ links }) }),
  pause: (hashes: string[]) => request<MutationResponse>('/api/v2/transfers/pause', { method: 'POST', body: JSON.stringify({ hashes }) }),
  resume: (hashes: string[]) => request<MutationResponse>('/api/v2/transfers/resume', { method: 'POST', body: JSON.stringify({ hashes }) }),
  stop: (hashes: string[]) => request<MutationResponse>('/api/v2/transfers/stop', { method: 'POST', body: JSON.stringify({ hashes }) }),
  remove: (hashes: string[], deleteFiles = true) => request<MutationResponse>('/api/v2/transfers/delete', { method: 'POST', body: JSON.stringify({ hashes, deleteFiles }) }),
  recheck: (hash: string) => request<{ ok: boolean }>(`/api/v2/transfers/${hash}/recheck`, { method: 'POST' }),
  events(onEvent: (event: PipeEventEnvelope) => void): EventSource {
    const source = new EventSource('/api/v2/events', { withCredentials: true });
    source.onmessage = (message) => {
      onEvent(JSON.parse(message.data) as PipeEventEnvelope);
    };
    return source;
  },
};
