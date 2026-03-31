export interface ErrorPayload {
  error: string;
  message: string;
}

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  toPayload(): ErrorPayload {
    return {
      error: this.code,
      message: this.message,
    };
  }
}

export function mapPipeErrorToHttpStatus(code: string): number {
  switch (code) {
    case 'INVALID_ARGUMENT':
      return 400;
    case 'NOT_FOUND':
      return 404;
    case 'UNAUTHORIZED':
      return 401;
    case 'EMULE_UNAVAILABLE':
      return 503;
    case 'EMULE_TIMEOUT':
      return 504;
    default:
      return 500;
  }
}
