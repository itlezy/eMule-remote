import path from 'node:path';
import fs from 'node:fs/promises';

import cookie from '@fastify/cookie';
import staticPlugin from '@fastify/static';
import fastify, { type FastifyInstance } from 'fastify';

import type { RemoteConfig } from './config.js';
import { UI_SESSION_COOKIE } from './config.js';
import { HttpError } from './errors.js';
import type { EmuleBridge, RequestMethod } from './rest/EmuleRestClient.js';

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function hasValidBearerToken(authHeader: string | undefined, token: string): boolean {
  if (!authHeader) {
    return false;
  }

  const prefix = 'Bearer ';
  return authHeader.startsWith(prefix) && authHeader.slice(prefix.length) === token;
}

function getUpstreamRequestPath(rawUrl: string | undefined): string {
  if (!rawUrl) {
    return '/api/v1';
  }

  const parsed = new URL(rawUrl, 'http://127.0.0.1');
  return `${parsed.pathname}${parsed.search}`;
}

async function proxyRequest(
  emule: EmuleBridge,
  method: RequestMethod,
  rawUrl: string | undefined,
  body: unknown,
): Promise<unknown> {
  const requestPath = getUpstreamRequestPath(rawUrl);
  return emule.requestJson(method, requestPath, method === 'POST' ? body : undefined);
}

/**
 * Builds the Fastify app around one upstream eMule REST bridge.
 */
export async function createApp(config: RemoteConfig, emule: EmuleBridge): Promise<FastifyInstance> {
  const app = fastify({ logger: true });

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
    emule.stop?.();
  });

  app.get('/health', async () => ({
    ok: true,
    emuleReachable: await emule.probe(),
  }));

  const proxyHandler = async (request: { method: string; raw: { url?: string }; body: unknown }) => {
    const method = request.method.toUpperCase();
    if (method !== 'GET' && method !== 'POST') {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', `unsupported method: ${request.method}`);
    }
    return proxyRequest(emule, method, request.raw.url, request.body);
  };

  app.get('/api/v1', proxyHandler);
  app.post('/api/v1', proxyHandler);
  app.get('/api/v1/*', proxyHandler);
  app.post('/api/v1/*', proxyHandler);

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
