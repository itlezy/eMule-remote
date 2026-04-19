import { HttpError } from '../errors.js';

export type RequestMethod = 'GET' | 'POST';

export interface EmuleBridge {
  probe(): Promise<boolean>;
  requestJson<T>(method: RequestMethod, path: string, body?: unknown): Promise<T>;
  stop?(): void;
}

interface UpstreamErrorPayload {
  error?: string;
  message?: string;
}

function buildUrl(baseUrl: string, requestPath: string): string {
  return new URL(requestPath.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

function normalizeFallbackCode(statusCode: number): string {
  switch (statusCode) {
    case 400:
      return 'INVALID_ARGUMENT';
    case 401:
      return 'UNAUTHORIZED';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'INVALID_STATE';
    case 503:
      return 'EMULE_UNAVAILABLE';
    default:
      return 'EMULE_ERROR';
  }
}

export class EmuleRestClient implements EmuleBridge {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly requestTimeoutMs: number,
  ) {
  }

  async probe(): Promise<boolean> {
    try {
      await this.requestJson('GET', '/api/v1/app/version');
      return true;
    } catch {
      return false;
    }
  }

  async requestJson<T>(method: RequestMethod, requestPath: string, body?: unknown): Promise<T> {
    return this.request<T>(method, requestPath, body);
  }

  private async request<T>(method: RequestMethod, requestPath: string, body?: unknown): Promise<T> {
    const targetUrl = buildUrl(this.baseUrl, requestPath);
    let response: Response;
    try {
      response = await fetch(targetUrl, {
        method,
        headers: {
          Accept: 'application/json',
          'X-API-Key': this.apiKey,
          ...(body !== undefined ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new HttpError(504, 'EMULE_TIMEOUT', `upstream request timed out: ${method} ${requestPath}`);
      }
      throw new HttpError(503, 'EMULE_UNAVAILABLE', error instanceof Error ? error.message : 'failed to reach eMule REST');
    }

    const responseText = await response.text();
    let payload: UpstreamErrorPayload | unknown = null;
    if (responseText.trim() !== '') {
      try {
        payload = JSON.parse(responseText) as UpstreamErrorPayload | unknown;
      } catch {
        payload = responseText;
      }
    }

    if (!response.ok) {
      const errorPayload = typeof payload === 'object' && payload !== null ? payload as UpstreamErrorPayload : {};
      throw new HttpError(
        response.status,
        typeof errorPayload.error === 'string' ? errorPayload.error : normalizeFallbackCode(response.status),
        typeof errorPayload.message === 'string' ? errorPayload.message : `upstream request failed: ${response.status}`,
      );
    }

    return payload as T;
  }
}
