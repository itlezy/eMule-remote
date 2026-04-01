import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';

import type { FastifyInstance } from 'fastify';

import { createApp, type PipeBridge } from './app.js';
import type { RemoteConfig } from './config.js';

class MockPipeClient extends EventEmitter implements PipeBridge {
  private connected = true;
  private readonly handlers = new Map<string, (params: Record<string, unknown> | undefined) => unknown>();

  setConnected(connected: boolean): void {
    this.connected = connected;
  }

  register(cmd: string, handler: (params: Record<string, unknown> | undefined) => unknown): void {
    this.handlers.set(cmd, handler);
  }

  isConnected(): boolean {
    return this.connected;
  }

  async sendCommand<T>(cmd: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.connected) {
      throw { code: 'EMULE_UNAVAILABLE', message: 'eMule pipe is not connected' };
    }

    const handler = this.handlers.get(cmd);
    if (!handler) {
      throw new Error(`no handler for ${cmd}`);
    }

    return handler(params) as T;
  }

  stop(): void {
  }
}

async function withApp(run: (app: FastifyInstance, pipe: MockPipeClient) => Promise<void>): Promise<void> {
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
    pipeName: '\\\\.\\pipe\\test',
    requestTimeoutMs: 500,
    reconnectDelayMs: 500,
    webRoot,
  };

  const pipe = new MockPipeClient();
  const app = await createApp(config, pipe);

  try {
    await run(app, pipe);
  } finally {
    await app.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
}

test('rejects API requests without auth', async () => {
  await withApp(async (app, pipe) => {
    pipe.register('app/version', () => ({ appName: 'eMule' }));
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/app/version',
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

test('validates MD4 hash parameters', async () => {
  await withApp(async (app) => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/transfers/not-a-hash',
      headers: {
        authorization: 'Bearer test-token',
      },
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), {
      error: 'INVALID_ARGUMENT',
      message: 'hash must be a 32-character lowercase MD4 hex string',
    });
  });
});

test('returns 503 when the pipe is disconnected', async () => {
  await withApp(async (app, pipe) => {
    pipe.setConnected(false);
    pipe.register('stats/global', () => ({ connected: false }));

    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/stats/global',
      headers: {
        authorization: 'Bearer test-token',
      },
    });

    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), {
      error: 'EMULE_UNAVAILABLE',
      message: 'eMule pipe is not connected',
    });
  });
});

test('clamps the log limit to the documented maximum', async () => {
  await withApp(async (app, pipe) => {
    let observedLimit = 0;
    pipe.register('log/get', (params) => {
      observedLimit = Number(params?.limit ?? 0);
      return [];
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/log?limit=9999',
      headers: {
        authorization: 'Bearer test-token',
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(observedLimit, 500);
    assert.deepEqual(response.json(), []);
  });
});

test('preserves delete semantics for partial downloads', async () => {
  await withApp(async (app, pipe) => {
    pipe.register('transfers/delete', (params) => ({
      results: [
        {
          hash: params?.hashes && Array.isArray(params.hashes) ? params.hashes[0] : null,
          ok: params?.deleteFiles === true,
          ...(params?.deleteFiles === true ? {} : { error: 'partial download deletion requires deleteFiles=true' }),
        },
      ],
    }));

    const withoutDeleteFiles = await app.inject({
      method: 'POST',
      url: '/api/v2/transfers/delete',
      headers: {
        authorization: 'Bearer test-token',
      },
      payload: {
        hashes: ['8958fd13501ed0347af4df142e8f5f9e'],
      },
    });

    assert.equal(withoutDeleteFiles.statusCode, 200);
    assert.deepEqual(withoutDeleteFiles.json(), {
      results: [
        {
          hash: '8958fd13501ed0347af4df142e8f5f9e',
          ok: false,
          error: 'partial download deletion requires deleteFiles=true',
        },
      ],
    });

    const withDeleteFiles = await app.inject({
      method: 'POST',
      url: '/api/v2/transfers/delete',
      headers: {
        authorization: 'Bearer test-token',
      },
      payload: {
        hashes: ['8958fd13501ed0347af4df142e8f5f9e'],
        deleteFiles: true,
      },
    });

    assert.equal(withDeleteFiles.statusCode, 200);
    assert.deepEqual(withDeleteFiles.json(), {
      results: [
        {
          hash: '8958fd13501ed0347af4df142e8f5f9e',
          ok: true,
        },
      ],
    });
  });
});

test('maps transfer detail routes to the final pipe surface', async () => {
  await withApp(async (app, pipe) => {
    pipe.register('transfers/get', (params) => ({
      hash: params?.hash,
      name: 'Example.bin',
    }));

    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/transfers/8958fd13501ed0347af4df142e8f5f9e',
      headers: {
        authorization: 'Bearer test-token',
      },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      hash: '8958fd13501ed0347af4df142e8f5f9e',
      name: 'Example.bin',
    });
  });
});

test('batches transfer add requests over the single-link pipe command', async () => {
  await withApp(async (app, pipe) => {
    let callCount = 0;
    pipe.register('transfers/add', (params) => {
      callCount += 1;
      return {
        hash: `hash-${callCount}`,
        name: params?.link,
      };
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/transfers/add',
      headers: {
        authorization: 'Bearer test-token',
      },
      payload: {
        links: ['ed2k://|file|one|/', 'ed2k://|file|two|/'],
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(callCount, 2);
    assert.deepEqual(response.json(), {
      results: [
        { hash: 'hash-1', ok: true, name: 'ed2k://|file|one|/' },
        { hash: 'hash-2', ok: true, name: 'ed2k://|file|two|/' },
      ],
    });
  });
});
