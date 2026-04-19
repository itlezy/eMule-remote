import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import assert from 'node:assert/strict';
import test from 'node:test';

import { HttpError } from '../errors.js';
import { EmuleRestClient } from './EmuleRestClient.js';

interface TestServerHandle {
  baseUrl: string;
  close(): Promise<void>;
}

async function withHttpServer(
  handler: (request: IncomingMessage, response: ServerResponse<IncomingMessage>) => void | Promise<void>,
  run: (server: TestServerHandle) => Promise<void>,
): Promise<void> {
  const server = createServer((request, response) => {
    void handler(request, response);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to bind test HTTP server');
  }

  try {
    await run({
      baseUrl: `http://127.0.0.1:${address.port}`,
      close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const payload = Buffer.concat(chunks).toString('utf8');
  return payload === '' ? undefined : JSON.parse(payload) as unknown;
}

test('sends the upstream API key and parses JSON responses', async () => {
  await withHttpServer(async (request, response) => {
    assert.equal(request.method, 'GET');
    assert.equal(request.url, '/api/v1/app/version');
    assert.equal(request.headers['x-api-key'], 'secret-key');
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ appName: 'eMule' }));
  }, async (server) => {
    const client = new EmuleRestClient(server.baseUrl, 'secret-key', 500);
    const payload = await client.requestJson<{ appName: string }>('GET', '/api/v1/app/version');
    assert.deepEqual(payload, { appName: 'eMule' });
  });
});

test('preserves POST JSON bodies when calling eMule REST', async () => {
  await withHttpServer(async (request, response) => {
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/api/v1/transfers/add');
    assert.deepEqual(await readJsonBody(request), { link: 'ed2k://|file|Example.bin|/' });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ hash: 'abc', name: 'Example.bin' }));
  }, async (server) => {
    const client = new EmuleRestClient(server.baseUrl, 'secret-key', 500);
    const payload = await client.requestJson<{ hash: string; name: string }>('POST', '/api/v1/transfers/add', {
      link: 'ed2k://|file|Example.bin|/',
    });
    assert.deepEqual(payload, { hash: 'abc', name: 'Example.bin' });
  });
});

test('surfaces upstream JSON errors with the original HTTP status', async () => {
  await withHttpServer(async (_request, response) => {
    response.writeHead(409, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      error: 'INVALID_STATE',
      message: 'search is already running',
    }));
  }, async (server) => {
    const client = new EmuleRestClient(server.baseUrl, 'secret-key', 500);

    await assert.rejects(
      client.requestJson('POST', '/api/v1/search/start', { query: 'test' }),
      (error: unknown) => {
        assert(error instanceof HttpError);
        assert.equal(error.statusCode, 409);
        assert.equal(error.code, 'INVALID_STATE');
        assert.equal(error.message, 'search is already running');
        return true;
      },
    );
  });
});

test('maps transport failures to EMULE_UNAVAILABLE', async () => {
  const client = new EmuleRestClient('http://127.0.0.1:1', 'secret-key', 100);

  await assert.rejects(
    client.requestJson('GET', '/api/v1/app/version'),
    (error: unknown) => {
      assert(error instanceof HttpError);
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, 'EMULE_UNAVAILABLE');
      return true;
    },
  );
});

test('probe returns false when the upstream cannot be reached', async () => {
  const client = new EmuleRestClient('http://127.0.0.1:1', 'secret-key', 100);
  assert.equal(await client.probe(), false);
});
