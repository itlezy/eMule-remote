import path from 'node:path';
import fs from 'node:fs/promises';

import cookie from '@fastify/cookie';
import staticPlugin from '@fastify/static';
import fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { RemoteConfig } from './config.js';
import { UI_SESSION_COOKIE } from './config.js';
import { HttpError, mapPipeErrorToHttpStatus } from './errors.js';
import type { PipeErrorBody, PipeEvent } from './pipe/protocol.js';

const MD4_HASH_PATTERN = /^[0-9a-f]{32}$/;
const hashSchema = z.string().regex(MD4_HASH_PATTERN, 'hash must be a 32-character lowercase MD4 hex string');
const hashesSchema = z.object({
  hashes: z.array(hashSchema).min(1, 'hashes must contain at least one hash'),
});
const deleteSchema = hashesSchema.extend({
  deleteFiles: z.boolean().optional(),
});
const addLinksSchema = z.object({
  links: z.array(z.string().trim().min(1, 'links must not contain empty values')).min(1, 'links must contain at least one link'),
});
const limitSchema = z.coerce.number().int().catch(200);

/**
 * Defines the minimal pipe operations the HTTP layer depends on.
 */
export interface PipeBridge {
  isConnected(): boolean;
  sendCommand<T>(cmd: string, params?: Record<string, unknown>): Promise<T>;
  on(event: 'event', listener: (event: PipeEvent) => void): this;
  on(event: 'connected' | 'disconnected', listener: () => void): this;
  on(event: 'error', listener: (error: unknown) => void): this;
  off(event: 'event', listener: (event: PipeEvent) => void): this;
  stop?(): void;
}

function hasValidBearerToken(authHeader: string | undefined, token: string): boolean {
  if (!authHeader) {
    return false;
  }

  const prefix = 'Bearer ';
  return authHeader.startsWith(prefix) && authHeader.slice(prefix.length) === token;
}

function normalizePipeError(error: unknown): PipeErrorBody {
  if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
    return error as PipeErrorBody;
  }

  return {
    code: 'EMULE_ERROR',
    message: error instanceof Error ? error.message : 'unexpected pipe error',
  };
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(400, 'INVALID_ARGUMENT', result.error.issues.map((issue) => issue.message).join('; '));
  }
  return result.data;
}

function parseHashParam(value: unknown): string {
  const result = hashSchema.safeParse(value);
  if (!result.success) {
    throw new HttpError(400, 'INVALID_ARGUMENT', result.error.issues.map((issue) => issue.message).join('; '));
  }
  return result.data;
}

function parseLimit(value: unknown): number {
  const parsed = limitSchema.parse(value);
  return Math.min(Math.max(parsed, 1), 500);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds the Fastify app around one pipe bridge instance.
 */
export async function createApp(config: RemoteConfig, pipeClient: PipeBridge): Promise<FastifyInstance> {
  const app = fastify({ logger: true });

  async function callPipe<T>(cmd: string, params?: Record<string, unknown>): Promise<T> {
    try {
      return await pipeClient.sendCommand<T>(cmd, params);
    } catch (error) {
      const pipeError = normalizePipeError(error);
      throw new HttpError(mapPipeErrorToHttpStatus(pipeError.code), pipeError.code, pipeError.message);
    }
  }

  await app.register(cookie);

  await app.register(staticPlugin, {
    root: config.webRoot,
    prefix: '/assets/',
    wildcard: false,
  });

  app.addHook('preHandler', async (request) => {
    if (!request.url.startsWith('/api/')) {
      return;
    }

    if (request.cookies[UI_SESSION_COOKIE] === '1') {
      return;
    }

    if (hasValidBearerToken(request.headers.authorization, config.bearerToken)) {
      return;
    }

    throw new HttpError(401, 'UNAUTHORIZED', 'missing or invalid bearer token');
  });

  app.addHook('onClose', async () => {
    pipeClient.stop?.();
  });

  app.get('/health', async () => ({
    ok: true,
    pipeConnected: pipeClient.isConnected(),
  }));

  app.get('/api/v1/system/version', async () => callPipe('system/version'));
  app.get('/api/v1/system/stats', async () => callPipe('system/stats'));
  app.get('/api/v1/downloads', async () => callPipe('downloads/list'));

  app.get('/api/v1/downloads/:hash', async (request) => {
    const hash = parseHashParam((request.params as { hash?: string }).hash);
    return callPipe('downloads/get', { hash });
  });

  app.get('/api/v1/downloads/:hash/sources', async (request) => {
    const hash = parseHashParam((request.params as { hash?: string }).hash);
    return callPipe('downloads/sources', { hash });
  });

  app.post('/api/v1/downloads', async (request) => {
    const body = parseBody(addLinksSchema, request.body);
    return callPipe('downloads/add', body);
  });

  app.post('/api/v1/downloads/pause', async (request) => {
    const body = parseBody(hashesSchema, request.body);
    return callPipe('downloads/pause', body);
  });

  app.post('/api/v1/downloads/resume', async (request) => {
    const body = parseBody(hashesSchema, request.body);
    return callPipe('downloads/resume', body);
  });

  app.post('/api/v1/downloads/stop', async (request) => {
    const body = parseBody(hashesSchema, request.body);
    return callPipe('downloads/stop', body);
  });

  app.post('/api/v1/downloads/delete', async (request) => {
    const body = parseBody(deleteSchema, request.body);
    return callPipe('downloads/delete', body);
  });

  app.post('/api/v1/downloads/:hash/recheck', async (request) => {
    const hash = parseHashParam((request.params as { hash?: string }).hash);
    return callPipe('downloads/recheck', { hash });
  });

  app.get('/api/v1/log', async (request) => {
    const limit = parseLimit((request.query as { limit?: unknown }).limit);
    return callPipe('log/get', { limit });
  });

  app.get('/api/v1/events', async (request, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders?.();

    const sendEvent = (event: PipeEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    pipeClient.on('event', sendEvent);
    request.raw.on('close', () => {
      pipeClient.off('event', sendEvent);
    });

    reply.raw.write(`data: ${JSON.stringify({ event: 'ready', data: { pipeConnected: pipeClient.isConnected() } })}\n\n`);
    return reply;
  });

  app.get('/', async (_request, reply) => {
    reply.setCookie(UI_SESSION_COOKIE, '1', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });

    if (!(await fileExists(path.join(config.webRoot, 'index.html')))) {
      throw new HttpError(503, 'EMULE_REMOTE_NOT_BUILT', 'frontend build output is missing, run npm run build');
    }

    return reply.sendFile('index.html');
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      reply.status(error.statusCode).send(error.toPayload());
      return;
    }

    app.log.error({ err: error }, 'request failed');
    const message = error instanceof Error ? error.message : 'unexpected server error';
    reply.status(500).send({
      error: 'EMULE_ERROR',
      message,
    });
  });

  return app;
}
