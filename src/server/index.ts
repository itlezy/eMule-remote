import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { PipeClient } from './pipe/PipeClient.js';

const config = loadConfig();
const pipeClient = new PipeClient(config.pipeName, config.requestTimeoutMs, config.reconnectDelayMs);
const app = await createApp(config, pipeClient);

pipeClient.start();

pipeClient.on('connected', () => {
  app.log.info('pipe connected');
});

pipeClient.on('disconnected', () => {
  app.log.warn('pipe disconnected');
});

pipeClient.on('error', (error) => {
  app.log.warn({ err: error }, 'pipe client error');
});

await app.listen({
  host: config.host,
  port: config.port,
});
