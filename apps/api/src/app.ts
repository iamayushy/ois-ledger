import compress from '@fastify/compress';
import cors from '@fastify/cors';
import etag from '@fastify/etag';
import helmet from '@fastify/helmet';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import { generateUuidV7 } from '@ois/shared/uuidv7';
import type { DbClient } from '@ois/db/client';
import { canonicalLogPlugin, REQUEST_ID_HEADER } from './plugins/canonical-log.js';
import { dbPlugin } from './plugins/db.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { createPoolBackpressureHook } from './plugins/pool-backpressure.js';
import { pressurePlugin } from './plugins/pressure.js';
import { proxyAuthPlugin } from './plugins/proxy-auth.js';
import { swaggerPlugin } from './plugins/swagger.js';
import { healthRoutes } from './routes/health.js';
import { inventoryRoutes } from './routes/inventory.js';
import { orderRoutes } from './routes/orders.js';

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
  readonly buildId?: string;
  readonly logStream?: LogStream;
}

export interface LogStream {
  readonly write: (message: string) => void;
}

const SERVICE_NAME = 'ois-api';

const SEVERITY_BY_LEVEL: Readonly<Record<string, string>> = {
  trace: 'DEBUG',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
};

const REDACTED_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-proxy-secret"]',
  'headers.authorization',
  'headers.cookie',
  'headers["x-proxy-secret"]',
];

function buildLoggerOptions(options: BuildAppOptions) {
  const buildId = options.buildId ?? process.env['K_REVISION'] ?? 'local';
  return {
    level: options.logLevel ?? 'info',
    messageKey: 'message',
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    formatters: {
      level: (label: string) => ({ severity: SEVERITY_BY_LEVEL[label] ?? 'DEFAULT', level: label }),
      bindings: () => ({ service: SERVICE_NAME, build_id: buildId }),
    },
    redact: { paths: [...REDACTED_PATHS], censor: '[redacted]' },
    ...(options.logStream !== undefined ? { stream: options.logStream } : {}),
  };
}

const DEFAULT_POOL_MAX_WAITING = 100;

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logLevel === 'silent' ? false : buildLoggerOptions(options),
    logController: new LogController({ disableRequestLogging: true, requestIdLogLabel: 'request_id' }),
    genReqId: () => generateUuidV7(),
    ajv: {
      customOptions: {
        removeAdditional: false,
        coerceTypes: true,
        allErrors: false,
      },
    },
  }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(canonicalLogPlugin);

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
    exposedHeaders: ['Idempotency-Replayed', 'X-Response-Time', 'Retry-After', 'ETag', REQUEST_ID_HEADER],
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
      });
    },
    { prefix: '/api' },
  );

  return app;
}
