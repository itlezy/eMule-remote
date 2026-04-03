import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';

import type { FastifyInstance } from 'fastify';

import { createApp } from './app.js';
import type { RemoteConfig } from './config.js';
import { PipeClient } from './pipe/PipeClient.js';
import { FakePipeServer } from './testsupport/FakePipeServer.js';

interface RealPipeHarness {
  app: FastifyInstance;
  client: PipeClient;
  config: RemoteConfig;
  server: FakePipeServer;
}

async function waitForConnected(client: PipeClient): Promise<void> {
  if (client.isConnected()) {
    return;
  }

  await once(client, 'connected');
}

async function createTempWebRoot(): Promise<{ tempRoot: string; webRoot: string }> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'emule-remote-pipe-test-'));
  const webRoot = path.join(tempRoot, 'web');
  const assetsRoot = path.join(webRoot, 'assets');
  await mkdir(assetsRoot, { recursive: true });
  await writeFile(path.join(webRoot, 'index.html'), '<!doctype html><title>eMule Remote</title>', 'utf8');

  return {
    tempRoot,
    webRoot,
  };
}

/**
 * Builds a Fastify app that talks to a real PipeClient backed by the fake pipe server.
 */
async function withRealPipeHarness(
  run: (harness: RealPipeHarness) => Promise<void>,
  options?: {
    autoStartClient?: boolean;
    requestTimeoutMs?: number;
  },
): Promise<void> {
  const { tempRoot, webRoot } = await createTempWebRoot();
  const server = new FakePipeServer();
  await server.start();

  const config: RemoteConfig = {
    host: '127.0.0.1',
    port: 0,
    bearerToken: 'test-token',
    pipeName: server.pipeName,
    requestTimeoutMs: options?.requestTimeoutMs ?? 50,
    reconnectDelayMs: 20,
    webRoot,
  };

  const client = new PipeClient(config.pipeName, config.requestTimeoutMs, config.reconnectDelayMs);
  const app = await createApp(config, client);

  try {
    if (options?.autoStartClient !== false) {
      client.start();
      await waitForConnected(client);
    }

    await run({
      app,
      client,
      config,
      server,
    });
  } finally {
    client.stop();
    await app.close();
    await server.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function authHeader(config: RemoteConfig): Record<string, string> {
  return {
    authorization: `Bearer ${config.bearerToken}`,
  };
}

test('reports health before and after the real pipe connects', async () => {
  await withRealPipeHarness(async ({ app, client }) => {
    const disconnectedResponse = await app.inject({
      method: 'GET',
      url: '/health',
    });

    assert.equal(disconnectedResponse.statusCode, 200);
    assert.deepEqual(disconnectedResponse.json(), {
      ok: true,
      pipeConnected: false,
    });

    client.start();
    await waitForConnected(client);

    const connectedResponse = await app.inject({
      method: 'GET',
      url: '/health',
    });

    assert.equal(connectedResponse.statusCode, 200);
    assert.deepEqual(connectedResponse.json(), {
      ok: true,
      pipeConnected: true,
    });
  }, {
    autoStartClient: false,
  });
});

test('forwards representative route groups over the real pipe transport', async () => {
  await withRealPipeHarness(async ({ app, config, server }) => {
    server.onCommand('app/version', ({ respond }) => {
      respond({ appName: 'eMule' });
    });
    server.onCommand('stats/global', ({ respond }) => {
      respond({ connected: true });
    });
    server.onCommand('transfers/get', ({ request, respond }) => {
      respond({ hash: request.params?.hash, name: 'Example.bin' });
    });
    server.onCommand('uploads/list', ({ respond }) => {
      respond([]);
    });
    server.onCommand('servers/list', ({ respond }) => {
      respond([]);
    });
    server.onCommand('kad/status', ({ respond }) => {
      respond({ running: true });
    });
    server.onCommand('shared/add', ({ request, respond }) => {
      respond({ ok: true, path: request.params?.path });
    });
    server.onCommand('search/start', ({ request, respond }) => {
      respond({ search_id: request.params?.query });
    });
    server.onCommand('log/get', ({ request, respond }) => {
      respond([{ limit: request.params?.limit }]);
    });

    const headers = authHeader(config);
    const transferHash = '8958fd13501ed0347af4df142e8f5f9e';

    assert.equal((await app.inject({ method: 'GET', url: '/api/v2/app/version', headers })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v2/stats/global', headers })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: `/api/v2/transfers/${transferHash}`, headers })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v2/uploads/list', headers })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v2/servers/list', headers })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v2/kad/status', headers })).statusCode, 200);
    assert.equal((await app.inject({
      method: 'POST',
      url: '/api/v2/shared/add',
      headers,
      payload: { path: 'C:\\share\\example.bin' },
    })).statusCode, 200);
    assert.equal((await app.inject({
      method: 'POST',
      url: '/api/v2/search/start',
      headers,
      payload: { query: '1080p', method: 'kad' },
    })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v2/log?limit=42', headers })).statusCode, 200);

    assert.deepEqual(
      server.receivedRequests.map((request) => ({
        cmd: request.cmd,
        params: request.params ?? {},
      })),
      [
        { cmd: 'app/version', params: {} },
        { cmd: 'stats/global', params: {} },
        { cmd: 'transfers/get', params: { hash: transferHash } },
        { cmd: 'uploads/list', params: {} },
        { cmd: 'servers/list', params: {} },
        { cmd: 'kad/status', params: {} },
        { cmd: 'shared/add', params: { path: 'C:\\share\\example.bin' } },
        { cmd: 'search/start', params: { query: '1080p', method: 'kad' } },
        { cmd: 'log/get', params: { limit: 42 } },
      ],
    );
  });
});

test('maps pipe timeout responses to HTTP 504', async () => {
  await withRealPipeHarness(async ({ app, config, server }) => {
    server.onCommand('stats/global', () => {
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v2/stats/global',
      headers: authHeader(config),
    });

    assert.equal(response.statusCode, 504);
    assert.deepEqual(response.json(), {
      error: 'EMULE_TIMEOUT',
      message: 'command timed out: stats/global',
    });
  }, {
    requestTimeoutMs: 25,
  });
});

test('maps pipe error codes to the expected HTTP statuses', async () => {
  await withRealPipeHarness(async ({ app, config, server }) => {
    server.onCommand('stats/global', ({ reject }) => {
      reject({
        code: 'EMULE_UNAVAILABLE',
        message: 'live pipe is down',
      });
    });

    const unavailableResponse = await app.inject({
      method: 'GET',
      url: '/api/v2/stats/global',
      headers: authHeader(config),
    });

    assert.equal(unavailableResponse.statusCode, 503);
    assert.deepEqual(unavailableResponse.json(), {
      error: 'EMULE_UNAVAILABLE',
      message: 'live pipe is down',
    });

    server.receivedRequests.length = 0;
    server.onCommand('stats/global', ({ reject }) => {
      reject({
        code: 'EMULE_BROKEN',
        message: 'unexpected failure',
      });
    });

    const brokenResponse = await app.inject({
      method: 'GET',
      url: '/api/v2/stats/global',
      headers: authHeader(config),
    });

    assert.equal(brokenResponse.statusCode, 500);
    assert.deepEqual(brokenResponse.json(), {
      error: 'EMULE_BROKEN',
      message: 'unexpected failure',
    });
  });
});

async function readUntilChunk(reader: ReadableStreamDefaultReader<Uint8Array>, pattern: string): Promise<string> {
  let buffered = '';
  while (!buffered.includes(pattern)) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffered += Buffer.from(value).toString('utf8');
  }

  return buffered;
}

test('forwards unsolicited pipe events over the SSE endpoint', async () => {
  await withRealPipeHarness(async ({ app, config, server }) => {
    const baseUrl = await app.listen({
      host: config.host,
      port: 0,
    });

    const response = await fetch(`${baseUrl}/api/v2/events`, {
      headers: authHeader(config),
    });

    assert.equal(response.status, 200);
    assert.ok(response.body);

    const reader = response.body.getReader();
    try {
      const readyPayload = await readUntilChunk(reader, '"event":"ready"');
      assert.match(readyPayload, /"pipeConnected":true/);

      server.emitEvent({
        event: 'server_connected',
        data: {
          address: '127.0.0.1',
        },
      });

      const eventPayload = await readUntilChunk(reader, '"event":"server_connected"');
      assert.match(eventPayload, /"address":"127.0.0.1"/);
    } finally {
      await reader.cancel();
    }
  });
});
