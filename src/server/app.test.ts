import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import type { FastifyInstance } from 'fastify';

import { createApp } from './app.js';
import type { RemoteConfig } from './config.js';
import { HttpError } from './errors.js';
import type { EmuleBridge, RequestMethod } from './rest/EmuleRestClient.js';

interface RecordedRequest {
  method: RequestMethod;
  path: string;
  body: unknown;
}

class MockEmuleBridge implements EmuleBridge {
  reachable = true;
  readonly requests: RecordedRequest[] = [];
  private readonly handlers = new Map<string, () => unknown>();

  setResponse(method: RequestMethod, path: string, response: unknown): void {
    this.handlers.set(`${method} ${path}`, () => response);
  }

  setFailure(method: RequestMethod, path: string, error: HttpError): void {
    this.handlers.set(`${method} ${path}`, () => {
      throw error;
    });
  }

  async probe(): Promise<boolean> {
    return this.reachable;
  }

  async requestJson<T>(method: RequestMethod, path: string, body?: unknown): Promise<T> {
    this.requests.push({ method, path, body });
    const handler = this.handlers.get(`${method} ${path}`);
    if (!handler) {
      throw new HttpError(404, 'NOT_FOUND', `no handler for ${method} ${path}`);
    }
    return handler() as T;
  }
}

async function withApp(run: (app: FastifyInstance, emule: MockEmuleBridge) => Promise<void>): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'emule-remote-test-'));
  const webRoot = path.join(tempRoot, 'web');
  const assetsRoot = path.join(webRoot, 'assets');
  await mkdir(webRoot, { recursive: true });
  await mkdir(assetsRoot, { recursive: true });
  await writeFile(path.join(webRoot, 'index.html'), '<!doctype html><title>eMule Remote</title>', 'utf8');

  const config: RemoteConfig = {
    host: '127.0.0.1',
    port: 0,
    bearerToken: 'test-token',
    emuleBaseUrl: 'http://127.0.0.1:4711',
    emuleApiKey: 'test-api-key',
    requestTimeoutMs: 500,
    webRoot,
  };

  const emule = new MockEmuleBridge();
  const app = await createApp(config, emule);

  try {
    await run(app, emule);
  } finally {
    await app.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
}

test('rejects API requests without auth', async () => {
  await withApp(async (app) => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/app/version',
    });

    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), {
      error: 'UNAUTHORIZED',
      message: 'missing or invalid bearer token',
    });
  });
});

test('allows UI root and sets the UI cookie', async () => {
  await withApp(async (app) => {
    const response = await app.inject({
      method: 'GET',
      url: '/',
    });
    const setCookieHeader = response.headers['set-cookie'];
    const setCookie = Array.isArray(setCookieHeader) ? setCookieHeader.join('; ') : (setCookieHeader ?? '');

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /eMule Remote/);
    assert.match(setCookie, /emule_remote_ui=1/);
  });
});

test('reports eMule reachability in health checks', async () => {
  await withApp(async (app, emule) => {
    emule.reachable = false;

    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      ok: true,
      emuleReachable: false,
    });
  });
});

test('proxies GET routes 1:1 to the upstream REST surface', async () => {
  await withApp(async (app, emule) => {
    emule.setResponse('GET', '/api/v1/app/version', { appName: 'eMule' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/app/version',
      headers: {
        authorization: 'Bearer test-token',
      },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { appName: 'eMule' });
    assert.deepEqual(emule.requests, [
      {
        method: 'GET',
        path: '/api/v1/app/version',
        body: undefined,
      },
    ]);
  });
});

test('preserves query strings exactly when proxying', async () => {
  await withApp(async (app, emule) => {
    emule.setResponse('GET', '/api/v1/log?limit=9999', []);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/log?limit=9999',
      headers: {
        authorization: 'Bearer test-token',
      },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), []);
    assert.deepEqual(emule.requests, [
      {
        method: 'GET',
        path: '/api/v1/log?limit=9999',
        body: undefined,
      },
    ]);
  });
});

test('proxies POST bodies 1:1 without batching or reshaping', async () => {
  await withApp(async (app, emule) => {
    emule.setResponse('POST', '/api/v1/transfers/add', {
      hash: '8958fd13501ed0347af4df142e8f5f9e',
      name: 'Example.bin',
    });

    const payload = { link: 'ed2k://|file|Example.bin|123|8958fd13501ed0347af4df142e8f5f9e|/' };
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transfers/add',
      headers: {
        authorization: 'Bearer test-token',
      },
      payload,
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      hash: '8958fd13501ed0347af4df142e8f5f9e',
      name: 'Example.bin',
    });
    assert.deepEqual(emule.requests, [
      {
        method: 'POST',
        path: '/api/v1/transfers/add',
        body: payload,
      },
    ]);
  });
});

test('keeps upstream search payloads unchanged', async () => {
  await withApp(async (app, emule) => {
    emule.setResponse('POST', '/api/v1/search/start', { search_id: '123' });
    const payload = {
      query: '1080p',
      method: 'kad',
      type: 'video',
      min_size: 700,
      max_size: 4096,
      ext: '.mkv',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/search/start',
      headers: {
        authorization: 'Bearer test-token',
      },
      payload,
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { search_id: '123' });
    assert.deepEqual(emule.requests, [
      {
        method: 'POST',
        path: '/api/v1/search/start',
        body: payload,
      },
    ]);
  });
});

test('propagates upstream REST errors without remapping the route contract', async () => {
  await withApp(async (app, emule) => {
    emule.setFailure('GET', '/api/v1/stats/global', new HttpError(503, 'EMULE_UNAVAILABLE', 'eMule REST is not reachable'));

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/stats/global',
      headers: {
        authorization: 'Bearer test-token',
      },
    });

    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), {
      error: 'EMULE_UNAVAILABLE',
      message: 'eMule REST is not reachable',
    });
  });
});
