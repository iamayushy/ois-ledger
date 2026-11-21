import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyEnv from '@fastify/env';
import { Type, type Static } from '@fastify/type-provider-typebox';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));

export const AppConfigSchema = Type.Object({
  DATABASE_URL: Type.String({ minLength: 1 }),
  API_HOST: Type.String({ default: '0.0.0.0' }),
  API_PORT: Type.Integer({ minimum: 1, maximum: 65535, default: 3001 }),
  PG_POOL_MAX: Type.Integer({ minimum: 1, maximum: 100, default: 20 }),
  PG_IDLE_TIMEOUT_MS: Type.Integer({ minimum: 1000, default: 20000 }),
  PG_CONNECTION_TIMEOUT_MS: Type.Integer({ minimum: 500, default: 5000 }),
  PG_POOL_MAX_WAITING: Type.Integer({ minimum: 1, default: 100 }),
  CORS_ORIGIN: Type.String({ default: 'http://localhost:5173' }),
  LOG_LEVEL: Type.String({ default: 'info' }),
});

export type AppConfig = Static<typeof AppConfigSchema>;

declare module 'fastify' {
  interface FastifyInstance {
    readonly config: AppConfig;
  }
}

export const envPlugin = fp(
  async function registerEnvPlugin(fastify: FastifyInstance) {
    await fastify.register(fastifyEnv, {
      confKey: 'config',
      schema: AppConfigSchema,
      dotenv: {
        path: resolve(CURRENT_DIR, '../../../../.env'),
      },
    });
  },
  {
    name: 'ois-env-plugin',
  },
);
