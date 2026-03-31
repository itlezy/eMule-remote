import type { ApiError, Download, LogEntry, PipeEventEnvelope, Source, SystemStats } from './types';

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
  systemVersion: () => request<Record<string, string>>('/api/v1/system/version'),
  systemStats: () => request<SystemStats>('/api/v1/system/stats'),
  downloads: () => request<Download[]>('/api/v1/downloads'),
  sources: (hash: string) => request<Source[]>(`/api/v1/downloads/${hash}/sources`),
  logs: (limit = 120) => request<LogEntry[]>(`/api/v1/log?limit=${limit}`),
  addLinks: (links: string[]) => request('/api/v1/downloads', { method: 'POST', body: JSON.stringify({ links }) }),
  pause: (hashes: string[]) => request('/api/v1/downloads/pause', { method: 'POST', body: JSON.stringify({ hashes }) }),
  resume: (hashes: string[]) => request('/api/v1/downloads/resume', { method: 'POST', body: JSON.stringify({ hashes }) }),
  stop: (hashes: string[]) => request('/api/v1/downloads/stop', { method: 'POST', body: JSON.stringify({ hashes }) }),
  remove: (hashes: string[], deleteFiles = true) => request('/api/v1/downloads/delete', { method: 'POST', body: JSON.stringify({ hashes, deleteFiles }) }),
  recheck: (hash: string) => request(`/api/v1/downloads/${hash}/recheck`, { method: 'POST' }),
  events(onEvent: (event: PipeEventEnvelope) => void): EventSource {
    const source = new EventSource('/api/v1/events', { withCredentials: true });
    source.onmessage = (message) => {
      onEvent(JSON.parse(message.data) as PipeEventEnvelope);
    };
    return source;
  },
};
