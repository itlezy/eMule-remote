export interface PipeRequest {
  id: string;
  cmd: string;
  params?: Record<string, unknown>;
}

export interface PipeSuccessResponse {
  id: string;
  result: unknown;
}

export interface PipeErrorBody {
  code: string;
  message: string;
}

export interface PipeErrorResponse {
  id: string;
  error: PipeErrorBody;
}

export interface PipeEvent {
  event: string;
  data: unknown;
}

export type PipeResponse = PipeSuccessResponse | PipeErrorResponse;

export function isPipeEvent(value: unknown): value is PipeEvent {
  return typeof value === 'object' && value !== null && 'event' in value;
}

export function isPipeResponse(value: unknown): value is PipeResponse {
  return typeof value === 'object' && value !== null && 'id' in value && !('cmd' in value);
}
