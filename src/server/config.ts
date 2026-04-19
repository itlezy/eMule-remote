import path from 'node:path';

export const UI_SESSION_COOKIE = 'emule_remote_ui';

export interface RemoteConfig {
  host: string;
  port: number;
  bearerToken: string;
  emuleBaseUrl: string;
  emuleApiKey: string;
  requestTimeoutMs: number;
  webRoot: string;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(): RemoteConfig {
  return {
    host: process.env.EMULE_REMOTE_HOST ?? '127.0.0.1',
    port: parseNumber(process.env.EMULE_REMOTE_PORT, 4713),
    bearerToken: process.env.EMULE_REMOTE_TOKEN ?? 'change-me',
    emuleBaseUrl: process.env.EMULE_REMOTE_EMULE_BASE_URL ?? 'http://127.0.0.1:4711',
    emuleApiKey: process.env.EMULE_REMOTE_EMULE_API_KEY ?? '',
    requestTimeoutMs: parseNumber(process.env.EMULE_REMOTE_TIMEOUT_MS, 5000),
    webRoot: path.resolve(process.cwd(), 'dist', 'web'),
  };
}
