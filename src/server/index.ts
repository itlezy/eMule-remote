import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { EmuleRestClient } from './rest/EmuleRestClient.js';

const config = loadConfig();
const emule = new EmuleRestClient(config.emuleBaseUrl, config.emuleApiKey, config.requestTimeoutMs);
const app = await createApp(config, emule);

await app.listen({
  host: config.host,
  port: config.port,
});
