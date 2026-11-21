import closeWithGrace from 'close-with-grace';
import Fastify from 'fastify';
import { buildApp } from './app.js';
import { envPlugin } from './plugins/env.js';

async function start(): Promise<void> {
  const envLoader = Fastify({ logger: false });
  await envLoader.register(envPlugin);
  await envLoader.ready();
  const config = envLoader.config;
  await envLoader.close();

  const app = await buildApp({
    databaseUrl: config.DATABASE_URL,
    poolMax: config.PG_POOL_MAX,
    poolIdleTimeoutMs: config.PG_IDLE_TIMEOUT_MS,
    poolConnectionTimeoutMs: config.PG_CONNECTION_TIMEOUT_MS,
    poolMaxWaiting: config.PG_POOL_MAX_WAITING,
    corsOrigin: config.CORS_ORIGIN,
    logLevel: config.LOG_LEVEL,
    ...(config.PROXY_SHARED_SECRET !== undefined
      ? { proxySharedSecret: config.PROXY_SHARED_SECRET }
      : {}),
    enableDocs: true,
  });

  const closeListeners = closeWithGrace({ delay: 10000 }, async ({ signal, err }) => {
    if (err) {
      app.log.error({ err }, 'Closing server due to uncaught error');
    } else {
      app.log.info({ signal }, 'Shutting down gracefully');
    }
    await app.close();
  });

  app.addHook('onClose', async () => {
    closeListeners.uninstall();
  });

  await app.listen({ host: config.API_HOST, port: config.API_PORT });
}

await start();
