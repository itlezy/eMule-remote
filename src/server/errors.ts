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
