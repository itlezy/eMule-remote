import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { AddressInfo } from 'node:net';

import { createApp } from '../src/server/app.js';
import type { RemoteConfig } from '../src/server/config.js';
import { EmuleRestClient } from '../src/server/rest/EmuleRestClient.js';

interface HttpResult {
  status: number;
  contentType: string;
  body: unknown;
}

function getEnv(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the live smoke`);
  }
  return value;
}

async function createTempWebRoot(): Promise<string> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'emule-remote-live-smoke-'));
  const webRoot = path.join(tempRoot, 'web');
  await mkdir(path.join(webRoot, 'assets'), { recursive: true });
  await writeFile(path.join(webRoot, 'index.html'), '<!doctype html><title>eMule Remote Live Smoke</title>\n', 'utf8');
  return tempRoot;
}

async function fetchJson(url: string, init?: RequestInit): Promise<HttpResult> {
  const response = await fetch(url, init);
  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();
  const body = text === '' ? null : JSON.parse(text) as unknown;
  return {
    status: response.status,
    contentType,
    body,
  };
}

async function compareProxyPassThrough(
  emuleBaseUrl: string,
  emuleApiKey: string,
  remoteBaseUrl: string,
  remoteToken: string,
  method: 'GET' | 'POST',
  requestPath: string,
  body?: unknown,
): Promise<void> {
  const direct = await fetchJson(`${emuleBaseUrl}${requestPath}`, {
    method,
    headers: {
      'X-API-Key': emuleApiKey,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const proxied = await fetchJson(`${remoteBaseUrl}${requestPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${remoteToken}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  assert.equal(proxied.status, direct.status, `${requestPath} status drift`);
  assert.deepEqual(proxied.body, direct.body, `${requestPath} JSON body drift`);
}

async function main(): Promise<void> {
  const emuleBaseUrl = getEnv('EMULE_REMOTE_EMULE_BASE_URL', 'http://127.0.0.1:4711').replace(/\/+$/, '');
  const emuleApiKey = getRequiredEnv('EMULE_REMOTE_EMULE_API_KEY');
  const remoteToken = getEnv('EMULE_REMOTE_TOKEN', 'live-smoke-token');
  const requestTimeoutMs = Number.parseInt(getEnv('EMULE_REMOTE_TIMEOUT_MS', '5000'), 10) || 5000;

  const tempRoot = await createTempWebRoot();
  const webRoot = path.join(tempRoot, 'web');
  const config: RemoteConfig = {
    host: '127.0.0.1',
    port: 0,
    bearerToken: remoteToken,
    emuleBaseUrl,
    emuleApiKey,
    requestTimeoutMs,
    webRoot,
  };

  const emule = new EmuleRestClient(config.emuleBaseUrl, config.emuleApiKey, config.requestTimeoutMs);
  const app = await createApp(config, emule);

  try {
    await app.listen({
      host: config.host,
      port: config.port,
    });

    const address = app.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('failed to determine live remote address');
    }

    const remoteBaseUrl = `http://${address.address}:${(address as AddressInfo).port}`;

    const health = await fetchJson(`${remoteBaseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, {
      ok: true,
      emuleReachable: Boolean((health.body as { emuleReachable?: boolean } | null)?.emuleReachable),
    });
    if ((health.body as { emuleReachable?: boolean } | null)?.emuleReachable !== true) {
      throw new Error(
        `eMule REST is not reachable at ${emuleBaseUrl}; start eMule with WebServer REST enabled and set EMULE_REMOTE_EMULE_API_KEY to the active token`,
      );
    }

    const unauthenticated = await fetchJson(`${remoteBaseUrl}/api/v1/app/version`);
    assert.equal(unauthenticated.status, 401);
    assert.deepEqual(unauthenticated.body, {
      error: 'UNAUTHORIZED',
      message: 'missing or invalid bearer token',
    });

    await compareProxyPassThrough(emuleBaseUrl, emuleApiKey, remoteBaseUrl, remoteToken, 'GET', '/api/v1/app/version');
    await compareProxyPassThrough(emuleBaseUrl, emuleApiKey, remoteBaseUrl, remoteToken, 'GET', '/api/v1/stats/global');
    await compareProxyPassThrough(emuleBaseUrl, emuleApiKey, remoteBaseUrl, remoteToken, 'GET', '/api/v1/servers/status');
    await compareProxyPassThrough(emuleBaseUrl, emuleApiKey, remoteBaseUrl, remoteToken, 'GET', '/api/v1/kad/status');
    await compareProxyPassThrough(emuleBaseUrl, emuleApiKey, remoteBaseUrl, remoteToken, 'GET', '/api/v1/log?limit=5');
    await compareProxyPassThrough(emuleBaseUrl, emuleApiKey, remoteBaseUrl, remoteToken, 'GET', '/api/v1/transfers/not-a-valid-hash');

    console.log(JSON.stringify({
      ok: true,
      emuleBaseUrl,
      remoteBaseUrl,
      checkedRoutes: [
        '/api/v1/app/version',
        '/api/v1/stats/global',
        '/api/v1/servers/status',
        '/api/v1/kad/status',
        '/api/v1/log?limit=5',
        '/api/v1/transfers/not-a-valid-hash',
      ],
    }, null, 2));
  } finally {
    await app.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
}

await main();
