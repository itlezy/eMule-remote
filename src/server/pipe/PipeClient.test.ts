import { once } from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';

import { PipeClient } from './PipeClient.js';
import { FakePipeServer, createTestPipeName } from '../testsupport/FakePipeServer.js';

async function waitForConnected(client: PipeClient): Promise<void> {
  if (client.isConnected()) {
    return;
  }

  await once(client, 'connected');
}

/**
 * Ensures each transport test cleans up both the fake server and the client.
 */
async function withPipeClient(
  run: (server: FakePipeServer, client: PipeClient) => Promise<void>,
  options?: {
    requestTimeoutMs?: number;
    reconnectDelayMs?: number;
    pipeName?: string;
  },
): Promise<void> {
  const server = new FakePipeServer(options?.pipeName ?? createTestPipeName());
  await server.start();

  const client = new PipeClient(
    server.pipeName,
    options?.requestTimeoutMs ?? 50,
    options?.reconnectDelayMs ?? 20,
  );

  try {
    client.start();
    await waitForConnected(client);
    await run(server, client);
  } finally {
    client.stop();
    await server.stop();
  }
}

test('resolves a successful request over a real named pipe', async () => {
  await withPipeClient(async (server, client) => {
    server.onCommand('app/version', ({ respond }) => {
      respond({ appName: 'eMule', version: 'test' });
    });

    const result = await client.sendCommand<{ appName: string; version: string }>('app/version');
    assert.deepEqual(result, {
      appName: 'eMule',
      version: 'test',
    });
  });
});

test('correlates concurrent responses by request id', async () => {
  await withPipeClient(async (server, client) => {
    server.onCommand('echo', async ({ request, respond }) => {
      const value = String(request.params?.value ?? '');
      if (value === 'first') {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      respond({
        value,
      });
    });

    const secondPromise = client.sendCommand<{ value: string }>('echo', { value: 'second' });
    const firstPromise = client.sendCommand<{ value: string }>('echo', { value: 'first' });

    assert.deepEqual(await secondPromise, { value: 'second' });
    assert.deepEqual(await firstPromise, { value: 'first' });
  });
});

test('rejects timed out requests', async () => {
  await withPipeClient(async (server, client) => {
    server.onCommand('stats/global', () => {
    });

    await assert.rejects(
      client.sendCommand('stats/global'),
      (error: unknown) => {
        assert.deepEqual(error, {
          code: 'EMULE_TIMEOUT',
          message: 'command timed out: stats/global',
        });
        return true;
      },
    );
  }, {
    requestTimeoutMs: 25,
  });
});

test('rejects pending requests when the pipe connection closes', async () => {
  await withPipeClient(async (server, client) => {
    server.onCommand('stats/global', ({ close }) => {
      close();
    });

    await assert.rejects(
      client.sendCommand('stats/global'),
      (error: unknown) => {
        assert.deepEqual(error, {
          code: 'EMULE_UNAVAILABLE',
          message: 'pipe connection closed',
        });
        return true;
      },
    );
  });
});

test('emits pipe events pushed by the server', async () => {
  await withPipeClient(async (server, client) => {
    server.onCommand('app/version', ({ respond }) => {
      respond({ ok: true });
    });

    await client.sendCommand('app/version');
    const eventPromise = once(client, 'event');
    server.emitEvent({
      event: 'server_connected',
      data: {
        address: '127.0.0.1',
      },
    });

    const [event] = await eventPromise;
    assert.deepEqual(event, {
      event: 'server_connected',
      data: {
        address: '127.0.0.1',
      },
    });
  });
});

test('emits an error for malformed frames', async () => {
  await withPipeClient(async (server, client) => {
    const errorPromise = new Promise<unknown>((resolve) => {
      client.once('error', resolve);
    });
    server.onCommand('app/version', async ({ sendRawLine, close }) => {
      sendRawLine('{broken-json');
      await new Promise((resolve) => setTimeout(resolve, 10));
      close();
    });

    const commandError = await client.sendCommand('app/version').catch((error) => error);
    const error = await errorPromise;
    assert.deepEqual(commandError, {
      code: 'EMULE_UNAVAILABLE',
      message: 'pipe connection closed',
    });
    assert.match(String(error), /syntaxerror/i);
  });
});

test('reconnects after the server closes the active pipe connection', async () => {
  const pipeName = createTestPipeName();
  const server = new FakePipeServer(pipeName);
  await server.start();

  const client = new PipeClient(pipeName, 50, 15);

  try {
    client.start();
    await waitForConnected(client);

    server.onCommand('stats/global', ({ close }) => {
      close();
    });

    const reconnectPromise = new Promise<void>((resolve) => {
      let sawDisconnect = false;
      client.on('disconnected', () => {
        sawDisconnect = true;
      });
      client.on('connected', () => {
        if (sawDisconnect) {
          resolve();
        }
      });
    });

    await assert.rejects(client.sendCommand('stats/global'));
    await reconnectPromise;
  } finally {
    client.stop();
    await server.stop();
  }
});

test('does not reconnect after stop is called', async () => {
  await withPipeClient(async (_server, client) => {
    let reconnected = false;
    client.on('connected', () => {
      reconnected = true;
    });

    client.stop();

    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(client.isConnected(), false);
    assert.equal(reconnected, false);
  });
});
