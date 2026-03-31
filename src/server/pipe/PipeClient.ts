import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import net from 'node:net';

import type { PipeErrorBody, PipeEvent, PipeRequest, PipeResponse } from './protocol.js';
import { isPipeEvent, isPipeResponse } from './protocol.js';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: NodeJS.Timeout;
}

export class PipeClient extends EventEmitter {
  private socket?: net.Socket;
  private reconnectTimer?: NodeJS.Timeout;
  private readBuffer = '';
  private connected = false;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(
    private readonly pipeName: string,
    private readonly requestTimeoutMs: number,
    private readonly reconnectDelayMs: number,
  ) {
    super();
  }

  start(): void {
    this.connect();
  }

  stop(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject({ code: 'EMULE_UNAVAILABLE', message: 'pipe client stopped' } satisfies PipeErrorBody);
      this.pending.delete(id);
    }

    this.socket?.destroy();
    this.socket = undefined;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async sendCommand<T>(cmd: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.socket || !this.connected || !this.socket.writable) {
      throw { code: 'EMULE_UNAVAILABLE', message: 'eMule pipe is not connected' } satisfies PipeErrorBody;
    }

    const id = randomUUID();
    const request: PipeRequest = { id, cmd, params: params ?? {} };
    const payload = `${JSON.stringify(request)}\n`;

    const result = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject({ code: 'EMULE_TIMEOUT', message: `command timed out: ${cmd}` } satisfies PipeErrorBody);
      }, this.requestTimeoutMs);

      this.pending.set(id, { resolve: resolve as PendingRequest['resolve'], reject, timer });
    });

    this.socket.write(payload, 'utf8');
    return result;
  }

  private connect(): void {
    const socket = net.createConnection(this.pipeName);
    this.socket = socket;
    socket.setEncoding('utf8');

    socket.on('connect', () => {
      this.connected = true;
      this.emit('connected');
    });

    socket.on('data', (chunk: string) => {
      this.readBuffer += chunk;
      let newlineIndex = this.readBuffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = this.readBuffer.slice(0, newlineIndex).replace(/\r$/, '');
        this.readBuffer = this.readBuffer.slice(newlineIndex + 1);
        this.handleLine(line);
        newlineIndex = this.readBuffer.indexOf('\n');
      }
    });

    socket.on('error', (error) => {
      this.emit('error', error);
    });

    socket.on('close', () => {
      this.connected = false;
      this.socket = undefined;
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject({ code: 'EMULE_UNAVAILABLE', message: 'pipe connection closed' } satisfies PipeErrorBody);
        this.pending.delete(id);
      }

      this.emit('disconnected');
      this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelayMs);
    });
  }

  private handleLine(line: string): void {
    if (!line.trim()) {
      return;
    }

    let parsed: PipeEvent | PipeResponse;
    try {
      parsed = JSON.parse(line) as PipeEvent | PipeResponse;
    } catch (error) {
      this.emit('error', error);
      return;
    }

    if (isPipeEvent(parsed)) {
      this.emit('event', parsed);
      return;
    }

    if (!isPipeResponse(parsed)) {
      this.emit('error', new Error(`unsupported pipe message: ${line}`));
      return;
    }

    const pending = this.pending.get(parsed.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(parsed.id);

    if ('error' in parsed) {
      pending.reject(parsed.error);
      return;
    }

    pending.resolve(parsed.result);
  }
}
