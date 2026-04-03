import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import net from 'node:net';

import type { PipeErrorBody, PipeEvent, PipeRequest, PipeResponse } from '../pipe/protocol.js';

export interface FakePipeRequestContext {
  request: PipeRequest;
  socket: net.Socket;
  respond: (result: unknown) => void;
  reject: (error: PipeErrorBody) => void;
  sendRawLine: (line: string) => void;
  emitEvent: (event: PipeEvent) => void;
  close: () => void;
}

export type FakePipeHandler = (context: FakePipeRequestContext) => void | Promise<void>;

/**
 * Creates a unique Windows named-pipe path for one test server instance.
 */
export function createTestPipeName(prefix = 'emule-remote-test'): string {
  return `\\\\.\\pipe\\${prefix}-${process.pid}-${randomUUID()}`;
}

/**
 * Provides a controllable named-pipe server for deterministic transport and app tests.
 */
export class FakePipeServer {
  private server?: net.Server;
  private readonly sockets = new Set<net.Socket>();
  private readonly readBuffers = new Map<net.Socket, string>();
  private readonly handlers = new Map<string, FakePipeHandler>();
  private fallbackHandler?: FakePipeHandler;

  readonly connections: net.Socket[] = [];
  readonly receivedRequests: PipeRequest[] = [];

  constructor(readonly pipeName: string = createTestPipeName()) {
  }

  /**
   * Starts listening on the configured named-pipe endpoint.
   */
  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    const server = net.createServer((socket) => {
      socket.setEncoding('utf8');
      this.sockets.add(socket);
      this.connections.push(socket);
      this.readBuffers.set(socket, '');

      socket.on('data', (chunk: string) => {
        const buffered = `${this.readBuffers.get(socket) ?? ''}${chunk}`;
        this.processBufferedData(socket, buffered);
      });

      socket.on('close', () => {
        this.sockets.delete(socket);
        this.readBuffers.delete(socket);
      });
    });

    this.server = server;
    server.listen(this.pipeName);
    await once(server, 'listening');
  }

  /**
   * Stops the server and closes every active client socket.
   */
  async stop(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();
    this.readBuffers.clear();

    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = undefined;
    server.close();
    await once(server, 'close');
  }

  /**
   * Registers a handler for one pipe command.
   */
  onCommand(command: string, handler: FakePipeHandler): this {
    this.handlers.set(command, handler);
    return this;
  }

  /**
   * Registers a fallback handler used when a command has no dedicated handler.
   */
  onUnhandled(handler: FakePipeHandler): this {
    this.fallbackHandler = handler;
    return this;
  }

  /**
   * Pushes one unsolicited event frame to every connected client.
   */
  emitEvent(event: PipeEvent): void {
    const payload = `${JSON.stringify(event)}\n`;
    for (const socket of this.sockets) {
      socket.write(payload, 'utf8');
    }
  }

  /**
   * Pushes one raw line to every connected client.
   */
  sendRawLine(line: string): void {
    const payload = line.endsWith('\n') ? line : `${line}\n`;
    for (const socket of this.sockets) {
      socket.write(payload, 'utf8');
    }
  }

  /**
   * Closes every active client connection without shutting down the listening server.
   */
  closeConnections(): void {
    for (const socket of this.sockets) {
      socket.destroy();
    }
  }

  private processBufferedData(socket: net.Socket, buffered: string): void {
    let workingBuffer = buffered;
    let newlineIndex = workingBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = workingBuffer.slice(0, newlineIndex).replace(/\r$/, '');
      workingBuffer = workingBuffer.slice(newlineIndex + 1);
      void this.handleLine(socket, line);
      newlineIndex = workingBuffer.indexOf('\n');
    }

    this.readBuffers.set(socket, workingBuffer);
  }

  private async handleLine(socket: net.Socket, line: string): Promise<void> {
    if (!line.trim()) {
      return;
    }

    const request = JSON.parse(line) as PipeRequest;
    this.receivedRequests.push(request);

    const context: FakePipeRequestContext = {
      request,
      socket,
      respond: (result) => {
        const response: PipeResponse = {
          id: request.id,
          result,
        };
        socket.write(`${JSON.stringify(response)}\n`, 'utf8');
      },
      reject: (error) => {
        const response: PipeResponse = {
          id: request.id,
          error,
        };
        socket.write(`${JSON.stringify(response)}\n`, 'utf8');
      },
      sendRawLine: (rawLine) => {
        const payload = rawLine.endsWith('\n') ? rawLine : `${rawLine}\n`;
        socket.write(payload, 'utf8');
      },
      emitEvent: (event) => {
        socket.write(`${JSON.stringify(event)}\n`, 'utf8');
      },
      close: () => {
        socket.destroy();
      },
    };

    const handler = this.handlers.get(request.cmd) ?? this.fallbackHandler;
    if (!handler) {
      context.reject({
        code: 'NOT_FOUND',
        message: `no fake pipe handler for ${request.cmd}`,
      });
      return;
    }

    await handler(context);
  }
}
