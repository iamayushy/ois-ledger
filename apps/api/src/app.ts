import compress from '@fastify/compress';
import cors from '@fastify/cors';
import etag from '@fastify/etag';
import helmet from '@fastify/helmet';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify, { type FastifyInstance } from 'fastify';
import type { DbClient } from '@ois/db/client';
import { dbPlugin } from './plugins/db.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { createPoolBackpressureHook } from './plugins/pool-backpressure.js';
import { pressurePlugin } from './plugins/pressure.js';
import { proxyAuthPlugin } from './plugins/proxy-auth.js';
import { swaggerPlugin } from './plugins/swagger.js';
import { healthRoutes } from './routes/health.js';
import { inventoryRoutes } from './routes/inventory.js';
import { orderRoutes } from './routes/orders.js';
import { rejectionRoutes } from './routes/rejections.js';

declare module 'fastify' {
  interface FastifyRequest {
    requestStartTimeNs?: bigint;
  }
}

export interface BuildAppOptions {
  readonly databaseUrl?: string;
  readonly dbClient?: DbClient;
  readonly poolMax?: number;
  readonly poolIdleTimeoutMs?: number;
  readonly poolConnectionTimeoutMs?: number;
  readonly poolMaxWaiting?: number;
  readonly corsOrigin?: string | boolean;
  readonly logLevel?: string;
  readonly enablePressure?: boolean;
  readonly proxySharedSecret?: string;
  readonly enableDocs?: boolean;
}

const DEFAULT_POOL_MAX_WAITING = 100;

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      options.logLevel === 'silent'
        ? false
        : {
            level: options.logLevel ?? 'info',
          },
    ajv: {
      customOptions: {
        removeAdditional: false,
        coerceTypes: true,
        allErrors: false,
      },
    },
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.addHook('onRequest', async (request) => {
    request.requestStartTimeNs = process.hrtime.bigint();
  });

  app.addHook('onSend', async (request, reply, payload) => {
    if (request.requestStartTimeNs !== undefined) {
      const durationMs =
        Number(process.hrtime.bigint() - request.requestStartTimeNs) / 1_000_000;
      reply.header('X-Response-Time', `${durationMs.toFixed(2)}ms`);
    }
    return payload;
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin: options.corsOrigin ?? true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Idempotency-Key'],
    exposedHeaders: ['Idempotency-Replayed', 'X-Response-Time', 'Retry-After', 'ETag'],
  });

  await app.register(compress, { global: true });
  await app.register(etag);

  await app.register(errorHandlerPlugin);
  await app.register(proxyAuthPlugin, {
    ...(options.proxySharedSecret !== undefined ? { secret: options.proxySharedSecret } : {}),
  });
  await app.register(pressurePlugin, {
    ...(options.enablePressure !== undefined ? { enabled: options.enablePressure } : {}),
  });
  await app.register(swaggerPlugin, {
    ...(options.enableDocs !== undefined ? { enabled: options.enableDocs } : {}),
  });
  await app.register(dbPlugin, {
    ...(options.databaseUrl !== undefined ? { connectionString: options.databaseUrl } : {}),
    ...(options.dbClient !== undefined ? { dbClient: options.dbClient } : {}),
    ...(options.poolMax !== undefined ? { max: options.poolMax } : {}),
    ...(options.poolIdleTimeoutMs !== undefined
      ? { idleTimeoutMs: options.poolIdleTimeoutMs }
      : {}),
    ...(options.poolConnectionTimeoutMs !== undefined
      ? { connectionTimeoutMs: options.poolConnectionTimeoutMs }
      : {}),
  });

  const poolBackpressureHook = createPoolBackpressureHook({
    pool: app.pgPool,
    maxWaiting: options.poolMaxWaiting ?? DEFAULT_POOL_MAX_WAITING,
  });

  await app.register(
    async function apiRoutes(scoped) {
      await scoped.register(healthRoutes);
      await scoped.register(async function dbBoundRoutes(bound) {
        bound.addHook('onRequest', poolBackpressureHook);
        await bound.register(inventoryRoutes);
        await bound.register(orderRoutes);
        await bound.register(rejectionRoutes);
      });
    },
    { prefix: '/api' },
  );

  return app;
}
