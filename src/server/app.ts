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
const prioritySchema = z.object({
  priority: z.string().trim().min(1, 'priority must not be empty'),
});
const categorySchema = z.object({
  category: z.coerce.number().int().nonnegative('category must be a non-negative integer'),
});
const preferencesSchema = z.object({
  prefs: z.record(z.unknown()),
});
const pathSchema = z.object({
  path: z.string().trim().min(1, 'path must not be empty'),
});
const sharedRemoveSchema = z.object({
  hash: hashSchema.optional(),
  path: z.string().trim().min(1, 'path must not be empty').optional(),
}).superRefine((value, ctx) => {
  const selected = Number(value.hash !== undefined) + Number(value.path !== undefined);
  if (selected !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'exactly one of hash or path must be provided',
    });
  }
});
const serverEndpointBaseSchema = z.object({
  addr: z.string().trim().min(1, 'addr must not be empty').optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
});
const serverConnectSchema = serverEndpointBaseSchema.superRefine((value, ctx) => {
  if ((value.addr === undefined) !== (value.port === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'addr and port must be provided together',
    });
  }
});
const serverAddSchema = serverEndpointBaseSchema.extend({
  addr: z.string().trim().min(1, 'addr must not be empty'),
  port: z.coerce.number().int().min(1).max(65535),
  name: z.string().trim().min(1, 'name must not be empty').optional(),
});
const searchStartSchema = z.object({
  query: z.string().trim().min(1, 'query must not be empty'),
  type: z.string().trim().optional(),
  method: z.string().trim().optional(),
  min_size: z.coerce.number().int().nonnegative().optional(),
  max_size: z.coerce.number().int().nonnegative().optional(),
  ext: z.string().trim().optional(),
});
const uploadSelectorSchema = z.object({
  userHash: hashSchema.optional(),
  ip: z.string().trim().min(1, 'ip must not be empty').optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
}).superRefine((value, ctx) => {
  const hasUserHash = value.userHash !== undefined;
  const hasIp = value.ip !== undefined;
  const hasPort = value.port !== undefined;
  if (!hasUserHash && !hasIp && !hasPort) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'userHash or ip and port are required',
    });
  }
  if (hasIp !== hasPort) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'ip and port must be provided together',
    });
  }
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

function parseOptionalCategory(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const result = z.coerce.number().int().nonnegative('category must be a non-negative integer').safeParse(value);
  if (!result.success) {
    throw new HttpError(400, 'INVALID_ARGUMENT', result.error.issues.map((issue) => issue.message).join('; '));
  }

  return result.data;
}

function parseSearchId(value: unknown): string {
  const result = z.string().trim().min(1, 'search_id must not be empty').safeParse(value);
  if (!result.success) {
    throw new HttpError(400, 'INVALID_ARGUMENT', result.error.issues.map((issue) => issue.message).join('; '));
  }
  return result.data;
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
    root: path.join(config.webRoot, 'assets'),
    prefix: '/assets/',
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

  app.get('/api/v2/app/version', async () => callPipe('app/version'));
  app.get('/api/v2/app/preferences', async () => callPipe('app/preferences/get'));
  app.post('/api/v2/app/preferences', async (request) => {
    const body = parseBody(preferencesSchema, request.body);
    return callPipe('app/preferences/set', body);
  });
  app.post('/api/v2/app/shutdown', async () => callPipe('app/shutdown'));

  app.get('/api/v2/stats/global', async () => callPipe('stats/global'));

  app.get('/api/v2/transfers', async (request) => {
    const query = request.query as { filter?: unknown; category?: unknown };
    const params: Record<string, unknown> = {};
    if (typeof query.filter === 'string' && query.filter.trim() !== '') {
      params.filter = query.filter.trim();
    }

    const category = parseOptionalCategory(query.category);
    if (category !== undefined) {
      params.category = category;
    }

    return callPipe('transfers/list', params);
  });

  app.get('/api/v2/transfers/:hash', async (request) => {
    const hash = parseHashParam((request.params as { hash?: string }).hash);
    return callPipe('transfers/get', { hash });
  });

  app.get('/api/v2/transfers/:hash/sources', async (request) => {
    const hash = parseHashParam((request.params as { hash?: string }).hash);
    return callPipe('transfers/sources', { hash });
  });

  app.post('/api/v2/transfers/add', async (request) => {
    const body = parseBody(addLinksSchema, request.body);
    const results: Array<{ hash: string | null; ok: boolean; error?: string; name?: string }> = [];

    for (const link of body.links) {
      try {
        const result = await callPipe<{ hash: string; name: string }>('transfers/add', { link });
        results.push({
          hash: result.hash,
          ok: true,
          name: result.name,
        });
      } catch (error) {
        const pipeError = error instanceof HttpError
          ? error
          : new HttpError(500, 'EMULE_ERROR', error instanceof Error ? error.message : 'unexpected pipe error');
        results.push({
          hash: null,
          ok: false,
          error: pipeError.message,
        });
      }
    }

    return { results };
  });

  app.post('/api/v2/transfers/pause', async (request) => {
    const body = parseBody(hashesSchema, request.body);
    return callPipe('transfers/pause', body);
  });

  app.post('/api/v2/transfers/resume', async (request) => {
    const body = parseBody(hashesSchema, request.body);
    return callPipe('transfers/resume', body);
  });

  app.post('/api/v2/transfers/stop', async (request) => {
    const body = parseBody(hashesSchema, request.body);
    return callPipe('transfers/stop', body);
  });

  app.post('/api/v2/transfers/delete', async (request) => {
    const body = parseBody(deleteSchema, request.body);
    return callPipe('transfers/delete', body);
  });

  app.post('/api/v2/transfers/:hash/recheck', async (request) => {
    const hash = parseHashParam((request.params as { hash?: string }).hash);
    return callPipe('transfers/recheck', { hash });
  });

  app.post('/api/v2/transfers/:hash/priority', async (request) => {
    const hash = parseHashParam((request.params as { hash?: string }).hash);
    const body = parseBody(prioritySchema, request.body);
    return callPipe('transfers/set_priority', { hash, priority: body.priority });
  });

  app.post('/api/v2/transfers/:hash/category', async (request) => {
    const hash = parseHashParam((request.params as { hash?: string }).hash);
    const body = parseBody(categorySchema, request.body);
    return callPipe('transfers/set_category', { hash, category: body.category });
  });

  app.get('/api/v2/uploads/list', async () => callPipe('uploads/list'));
  app.get('/api/v2/uploads/queue', async () => callPipe('uploads/queue'));
  app.post('/api/v2/uploads/remove', async (request) => {
    const body = parseBody(uploadSelectorSchema, request.body);
    return callPipe('uploads/remove', body);
  });
  app.post('/api/v2/uploads/release_slot', async (request) => {
    const body = parseBody(uploadSelectorSchema, request.body);
    return callPipe('uploads/release_slot', body);
  });

  app.get('/api/v2/servers/list', async () => callPipe('servers/list'));
  app.get('/api/v2/servers/status', async () => callPipe('servers/status'));
  app.post('/api/v2/servers/connect', async (request) => {
    const body = parseBody(serverConnectSchema, request.body);
    return callPipe('servers/connect', body);
  });
  app.post('/api/v2/servers/disconnect', async () => callPipe('servers/disconnect'));
  app.post('/api/v2/servers/add', async (request) => {
    const body = parseBody(serverAddSchema, request.body);
    return callPipe('servers/add', body);
  });
  app.post('/api/v2/servers/remove', async (request) => {
    const body = parseBody(serverEndpointBaseSchema.extend({
      addr: z.string().trim().min(1, 'addr must not be empty'),
      port: z.coerce.number().int().min(1).max(65535),
    }), request.body);
    return callPipe('servers/remove', body);
  });

  app.get('/api/v2/kad/status', async () => callPipe('kad/status'));
  app.post('/api/v2/kad/connect', async () => callPipe('kad/connect'));
  app.post('/api/v2/kad/disconnect', async () => callPipe('kad/disconnect'));
  app.post('/api/v2/kad/recheck_firewall', async () => callPipe('kad/recheck_firewall'));

  app.get('/api/v2/shared/list', async () => callPipe('shared/list'));
  app.get('/api/v2/shared/:hash', async (request) => {
    const hash = parseHashParam((request.params as { hash?: string }).hash);
    return callPipe('shared/get', { hash });
  });
  app.post('/api/v2/shared/add', async (request) => {
    const body = parseBody(pathSchema, request.body);
    return callPipe('shared/add', body);
  });
  app.post('/api/v2/shared/remove', async (request) => {
    const body = parseBody(sharedRemoveSchema, request.body);
    return callPipe('shared/remove', body);
  });

  app.post('/api/v2/search/start', async (request) => {
    const body = parseBody(searchStartSchema, request.body);
    return callPipe('search/start', body);
  });
  app.get('/api/v2/search/results', async (request) => {
    const search_id = parseSearchId((request.query as { search_id?: unknown }).search_id);
    return callPipe('search/results', { search_id });
  });
  app.post('/api/v2/search/stop', async (request) => {
    const body = parseBody(z.object({ search_id: z.string().trim().min(1, 'search_id must not be empty') }), request.body);
    return callPipe('search/stop', body);
  });

  app.get('/api/v2/log', async (request) => {
    const limit = parseLimit((request.query as { limit?: unknown }).limit);
    return callPipe('log/get', { limit });
  });

  app.get('/api/v2/events', async (request, reply) => {
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
    const indexPath = path.join(config.webRoot, 'index.html');
    reply.setCookie(UI_SESSION_COOKIE, '1', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });

    if (!(await fileExists(indexPath))) {
      throw new HttpError(503, 'EMULE_REMOTE_NOT_BUILT', 'frontend build output is missing, run npm run build');
    }

    const indexHtml = await fs.readFile(indexPath, 'utf8');
    reply.type('text/html; charset=utf-8');
    return reply.send(indexHtml);
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
